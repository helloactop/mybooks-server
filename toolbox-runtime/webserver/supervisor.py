# -*- coding: utf-8 -*-
"""每插件子进程 supervisor（容器内隔离）。

约束（2GB 服务器）：
  · 懒启动：只有请求到来才拉起插件进程；
  · 最多 TOOLBOX_MAX_CHILDREN 个（默认 2），每进程 RLIMIT_AS 默认 384MB；
  · 容量满时淘汰“空闲且无后台任务”的最久未用子进程；
  · 崩溃只影响对应子进程，supervisor 在下次请求时重启。

独立 UID（TOOLBOX_CHILD_UID_BASE>0）：
  · UID 由持久化注册表 state/uid-map.json 分配，同一 tool_id 永远同一 UID；
  · 注册表损坏/重复/容量耗尽一律显式失败，绝不静默共用 UID；
  · 通过 subprocess.Popen(user=/group=/extra_groups=) 降权，不用 preexec_fn；
  · 未以 root 启动、缺少 capabilities 或 Node/Python 配置不一致时拒绝启动子进程。

注意：同一容器、共享 /toolbox 与网络，这是故障/资源/文件权限隔离，
不是恶意代码沙箱。
"""
import asyncio
import base64
import json
import logging
import os
import re
import secrets
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.request

import tornado.httpclient
import tornado.ioloop

from webserver.handlers.base import runtime_secret
from webserver.toolbox import config

LOGGER = logging.getLogger("toolbox.supervisor")
TOOL_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")


class SupervisorError(RuntimeError):
    code = "runtime.error"


class CapacityError(SupervisorError):
    code = "runtime.capacity"


class ChildNotFound(SupervisorError):
    code = "tool.disabled"


class ReloadingError(SupervisorError):
    code = "runtime.reloading"


class IsolationError(SupervisorError):
    """独立 UID 配置/权限不可用；必须显式失败，绝不退回共享 UID。"""

    code = "runtime.isolation"


class ModeMismatchError(SupervisorError):
    """Node 与 Python 的 MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY 不一致。"""

    code = "runtime.mode"


# Linux capability 位（/proc/self/status CapEff）。用于在启用独立 UID 前
# 确认容器真的具备降权/改属主/跨 UID 发信号的能力，而不是“配置了就算”。
REQUIRED_CAPABILITIES = {
    "CAP_CHOWN": 0,
    "CAP_DAC_OVERRIDE": 1,
    # chown 到插件 UID 之后，root 需要 FOWNER 才能继续 chmod 收紧权限位；
    # 设置目录 setgid 位时还需要 FSETID（root 不在宿主属组里）。
    "CAP_FOWNER": 3,
    "CAP_FSETID": 4,
    "CAP_KILL": 5,
    "CAP_SETGID": 6,
    "CAP_SETUID": 7,
}
DEFAULT_UID_COUNT = 200
UID_REGISTRY_VERSION = 1
UID_REGISTRY_NAME = "uid-map.json"


def missing_capabilities(status_path=None):
    """返回当前进程缺少的必需 capability 名称；非 Linux 或无 procfs 时返回空表。"""
    if status_path is None:
        if not sys.platform.startswith("linux"):
            return []
        status_path = "/proc/self/status"
    try:
        with open(status_path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
    except OSError:
        return []
    match = re.search(r"^CapEff:\s*([0-9a-fA-F]+)", text, re.MULTILINE)
    if not match:
        return []
    mask = int(match.group(1), 16)
    return [name for name, bit in REQUIRED_CAPABILITIES.items() if not mask & (1 << bit)]


class UidRegistry(object):
    """持久化、无冲突的插件 UID 分配（state/uid-map.json，0600）。

    设计要点：
      · 同一 tool_id 一旦分配就固定，安装/回滚/重启都不会漂移；
      · 新插件取当前区间内最小的空闲 UID，绝不与已有分配重复；
      · 卸载后如果数据目录已被清理，UID 才回收；数据仍存在则继续保留，
        避免重装插件时无法读取旧数据、也避免被别的插件接管；
      · 升级前按哈希分配的旧数据目录，其属主 UID 会被“采纳”为正式分配；
      · 文件损坏、分配重复、池耗尽都抛 IsolationError（fail-closed）。
    """

    def __init__(self, path, base, count=DEFAULT_UID_COUNT):
        if base <= 0:
            raise ValueError("UID base 必须大于 0")
        self.path = path
        self.base = int(base)
        self.count = max(1, int(count))
        self._lock = threading.RLock()
        self._loaded = False
        self._assignments = {}
        self._recorded_base = 0

    # ---------- io ----------

    def _ensure_loaded(self):
        if self._loaded:
            return
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        except FileNotFoundError:
            self._loaded = True
            return
        except (OSError, ValueError) as err:
            raise IsolationError(
                "UID 注册表 %s 无法读取：%s；拒绝启动插件（不会退化为共用 UID）" % (self.path, err))
        if not isinstance(document, dict) or document.get("version") != UID_REGISTRY_VERSION:
            raise IsolationError("UID 注册表 %s 结构不受支持" % self.path)
        raw = document.get("assignments")
        if not isinstance(raw, dict):
            raise IsolationError("UID 注册表 %s 缺少 assignments" % self.path)
        assignments = {}
        owners = {}
        for tool_id, uid in raw.items():
            if not isinstance(tool_id, str) or not TOOL_ID_RE.match(tool_id):
                raise IsolationError("UID 注册表包含非法 tool_id：%r" % (tool_id,))
            if not isinstance(uid, int) or isinstance(uid, bool) or uid <= 0:
                raise IsolationError("UID 注册表 %s 中 %s 的 UID 非法：%r" % (self.path, tool_id, uid))
            if uid in owners:
                raise IsolationError(
                    "UID 注册表冲突：%s 与 %s 共用 UID %d；请先修复 %s"
                    % (owners[uid], tool_id, uid, self.path))
            owners[uid] = tool_id
            assignments[tool_id] = uid
        self._assignments = assignments
        recorded_base = document.get("base")
        self._recorded_base = recorded_base if isinstance(recorded_base, int) else 0
        if self._recorded_base and self._recorded_base != self.base:
            LOGGER.warning(
                "[supervisor] UID 注册表基准 %s 与当前 TOOLBOX_CHILD_UID_BASE=%s 不同："
                "已有插件保留原 UID，新插件从当前基准分配",
                self._recorded_base, self.base)
        self._loaded = True

    def _save(self):
        payload = {
            "version": UID_REGISTRY_VERSION,
            "base": self.base,
            "count": self.count,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "assignments": dict(sorted(self._assignments.items())),
        }
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = "%s.tmp-%d" % (self.path, os.getpid())
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except OSError as err:
            raise IsolationError(
                "无法持久化 UID 注册表 %s：%s；拒绝启动插件以避免重启后 UID 漂移" % (self.path, err))
        self._recorded_base = self.base

    # ---------- allocation ----------

    def _owner_uid(self, path):
        """独立方法便于测试替换（非 root 无法真的造出别的属主）。"""
        return os.stat(path).st_uid

    def reconcile(self, installed_ids=None, data_root=None):
        """采纳历史数据属主、回收已彻底卸载的 UID。"""
        with self._lock:
            self._ensure_loaded()
            changed = False
            owners = {}
            if data_root and os.path.isdir(data_root):
                try:
                    names = sorted(os.listdir(data_root))
                except OSError:
                    names = []
                for name in names:
                    if not TOOL_ID_RE.match(name):
                        continue
                    try:
                        owners[name] = self._owner_uid(os.path.join(data_root, name))
                    except OSError:
                        continue
            if installed_ids is not None:
                for tool_id in list(self._assignments):
                    if tool_id in installed_ids or tool_id in owners:
                        continue
                    del self._assignments[tool_id]
                    changed = True
            used = set(self._assignments.values())
            for tool_id, uid in owners.items():
                if tool_id in self._assignments:
                    continue
                if not (self.base <= uid < self.base + self.count):
                    # 旧基准或宿主 UID：启动时由 _prepare_tool_data 迁移到新分配。
                    continue
                if uid in used:
                    LOGGER.warning(
                        "[supervisor] 数据目录 %s 的属主 UID %d 已被其他插件占用，"
                        "将为它分配新 UID 并迁移属主", tool_id, uid)
                    continue
                self._assignments[tool_id] = uid
                used.add(uid)
                changed = True
            if changed:
                self._save()
            return dict(self._assignments)

    def allocate(self, tool_id, installed_ids=None, data_root=None):
        if not TOOL_ID_RE.match(str(tool_id or "")):
            raise IsolationError("非法 tool_id：%r" % (tool_id,))
        with self._lock:
            self._ensure_loaded()
            if tool_id in self._assignments:
                return self._assignments[tool_id]
        self.reconcile(installed_ids, data_root)
        with self._lock:
            if tool_id in self._assignments:
                return self._assignments[tool_id]
            used = set(self._assignments.values())
            for offset in range(self.count):
                uid = self.base + offset
                if uid in used:
                    continue
                self._assignments[tool_id] = uid
                self._save()
                return uid
            raise IsolationError(
                "独立 UID 池已耗尽（base=%d, count=%d）；请清理已卸载插件的数据目录，"
                "或提高 TOOLBOX_CHILD_UID_COUNT 后重启 toolbox-runtime（不会复用已有 UID）"
                % (self.base, self.count))

    def snapshot(self):
        with self._lock:
            self._ensure_loaded()
            return {
                "path": self.path,
                "base": self.base,
                "count": self.count,
                "assignments": dict(sorted(self._assignments.items())),
            }


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ChildProcess(object):
    def __init__(self, tool_id, revision, port, process, secret, uid=0):
        self.tool_id = tool_id
        self.revision = revision
        self.port = port
        self.process = process
        # 每个子进程独立的 runtime-secret：插件进程无法拿它调用 supervisor 的
        # /internal/reload|start|stop（这些接口只认宿主密钥）。
        self.secret = secret
        # 独立 UID 模式下实际使用的 UID；0 表示未启用（共享 UID）。
        self.uid = int(uid or 0)
        self.started_at = time.time()
        self.last_used = time.time()
        self.inflight = 0
        self.error = ""

    def alive(self):
        return self.process is not None and self.process.poll() is None

    def summary(self):
        return {
            "tool_id": self.tool_id,
            "revision": self.revision,
            "port": self.port,
            "uid": self.uid,
            "online": self.alive(),
            "inflight": self.inflight,
            "idle_seconds": max(0, int(time.time() - self.last_used)),
        }


class PluginSupervisor(object):
    def __init__(self, child_command=None):
        self.max_children = max(1, int(os.environ.get("TOOLBOX_MAX_CHILDREN", "2")))
        self.memory_mb = max(0, int(os.environ.get("TOOLBOX_CHILD_MEMORY_MB", "384")))
        self.idle_seconds = max(0, int(os.environ.get("TOOLBOX_CHILD_IDLE_SECONDS", "600")))
        self.start_timeout = max(1.0, float(os.environ.get("TOOLBOX_CHILD_START_TIMEOUT", "20")))
        self.proxy_timeout = max(1.0, float(os.environ.get("TOOLBOX_PROXY_TIMEOUT", "180")))
        # 0 = 关闭独立 UID（默认，保持旧部署）；>0 时按持久化注册表为每个插件
        # 分配唯一 UID（需 root + capabilities，否则构造时直接失败）。
        self.child_uid_base = max(0, int(os.environ.get("TOOLBOX_CHILD_UID_BASE", "0")))
        self.child_uid_count = max(1, int(os.environ.get("TOOLBOX_CHILD_UID_COUNT", str(DEFAULT_UID_COUNT))))
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self._child_command = child_command or [sys.executable, os.path.join(root, "runtime.py")]
        self._root = root
        self._children = {}
        self._state_items = {}
        self._lock = threading.RLock()
        self._ensure_lock = asyncio.Lock()
        self._reloading = False
        self._generation = 0
        self._uid_registry = None
        if self.child_uid_base > 0:
            # 显式启用独立 UID 时先自检：失败必须让部署停下来，不能静默共用 UID。
            self._verify_uid_isolation()
            self._uid_registry = UidRegistry(
                os.path.join(config.STATE_DIR, UID_REGISTRY_NAME),
                self.child_uid_base,
                self.child_uid_count,
            )

    # ---------- state ----------

    def _read_state(self):
        """始终返回 dict；文件缺失/损坏/结构非法时返回空表，绝不返回 list。"""
        try:
            with open(config.STATE_FILE, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as err:
            LOGGER.error("[supervisor] state file invalid: %s", err)
            return {}
        tools = document.get("tools") if isinstance(document, dict) else None
        if not isinstance(tools, list):
            LOGGER.error("[supervisor] state file tools must be a list")
            return {}
        items = {}
        for item in tools:
            if not isinstance(item, dict) or not item.get("enabled"):
                continue
            tool_id = str(item.get("tool_id") or "")
            if not TOOL_ID_RE.match(tool_id):
                continue
            items[tool_id] = item
        return items

    # ---------- lifecycle ----------

    def reload(self):
        with self._lock:
            self._generation += 1
            self._reloading = True
            existing = list(self._children)
        # 终止子进程可能阻塞（需要回收管道），必须在锁外执行，
        # 否则 /healthz 与请求代理会被一起卡住。
        for tool_id in existing:
            self._stop_child(tool_id)
        reports = []
        started = 0
        try:
            state = self._read_state()
            with self._lock:
                self._state_items = state
            for tool_id, item in state.items():
                revision = str(item.get("revision") or "")
                if started >= self.max_children:
                    reports.append({"tool_id": tool_id, "loaded": False, "deferred": True,
                                    "revision": revision, "error": ""})
                    continue
                try:
                    child = self._spawn_sync(tool_id, item)
                    with self._lock:
                        self._children[tool_id] = child
                    started += 1
                    reports.append({"tool_id": tool_id, "loaded": True, "deferred": False,
                                    "revision": revision, "error": ""})
                except Exception as err:
                    LOGGER.exception("[supervisor] failed to start %s", tool_id)
                    reports.append({"tool_id": tool_id, "loaded": False, "deferred": False,
                                    "revision": revision, "error": str(err)})
        except Exception:
            # reload 是 Node 的“更新插件”入口，任何异常都必须转成报告，不能把调用方打挂。
            LOGGER.exception("[supervisor] reload failed")
        finally:
            with self._lock:
                self._reloading = False
        LOGGER.info("[supervisor] reload complete: %s", ", ".join(sorted(self._children)) or "none")
        return reports

    def summary(self):
        with self._lock:
            return [child.summary() for child in self._children.values()]

    def deferred(self):
        with self._lock:
            return sorted(set(self._state_items) - set(self._children))

    def shutdown(self):
        with self._lock:
            for tool_id in list(self._children):
                self._stop_child(tool_id)

    # ---------- spawn ----------

    def _spawn_sync(self, tool_id, item):
        # Node 与 Python 的隔离开关必须一致；不一致时拒绝启动插件而不是“带病运行”。
        self._check_mode_consistency()
        port = _free_port()
        secret = secrets.token_hex(24)
        token = self._plugin_token(tool_id)
        uid = self._child_uid(tool_id)
        data_dir = self._prepare_tool_data(tool_id, uid)
        env = os.environ.copy()
        # 子进程不需要宿主 internal-secret；NodeClient 在隔离模式只用每插件令牌。
        env.pop("MYBOOKS_TOOLBOX_INTERNAL_SECRET", None)
        env.update({
            "TOOLBOX_ONLY_TOOL": tool_id,
            "TOOLBOX_RUNTIME_PORT": str(port),
            "TOOLBOX_RUNTIME_HOST": "127.0.0.1",
            "TOOLBOX_ISOLATE_PLUGINS": "0",
            "MYBOOKS_TOOLBOX_RUNTIME_SECRET": secret,
            "MYBOOKS_PLUGIN_ID": tool_id,
            "MYBOOKS_TOOL_DATA_DIR": data_dir,
            # 隔离部署默认不允许回退共享密钥；显式设为 0 可回滚（见 isolation-design.md）。
            "MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY": os.environ.get("MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY", "1"),
            "PYTHONUNBUFFERED": "1",
        })
        if uid:
            # storage 据此使用 0710/2750；产物通过宿主属组交付给 Node。
            env["MYBOOKS_TOOLBOX_PRIVATE_DATA"] = "1"
        else:
            env.pop("MYBOOKS_TOOLBOX_PRIVATE_DATA", None)
        if token:
            env["MYBOOKS_PLUGIN_TOKEN"] = token
        else:
            env.pop("MYBOOKS_PLUGIN_TOKEN", None)
        self._inject_data_key(env)
        command = self._limited_command(self._child_command)
        kwargs = self._popen_options(uid, env)
        process = subprocess.Popen(command, **kwargs)
        threading.Thread(target=self._pump, args=(process.stdout, tool_id, "stdout"), daemon=True).start()
        threading.Thread(target=self._pump, args=(process.stderr, tool_id, "stderr"), daemon=True).start()

        child = ChildProcess(tool_id, str(item.get("revision") or ""), port, process, secret, uid=uid)
        deadline = time.time() + self.start_timeout
        while time.time() < deadline:
            if process.poll() is not None:
                raise SupervisorError("插件进程启动失败，退出码 %s" % process.returncode)
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/healthz" % port, timeout=0.5) as response:
                    response.read()
                return child
            except Exception:
                time.sleep(0.1)
        self._terminate(process)
        raise SupervisorError("插件进程启动超时")

    def _limited_command(self, command):
        """POSIX 下用 shell 设置 RLIMIT_AS/NOFILE。

        这不是“配置了就等于生效”：tests/test_runtime.py 会启动真实子进程读取
        RLIMIT_AS 并验证超限分配失败。ulimit 不受支持时显式退出而不是静默无限。
        """
        if os.name != "posix" or self.memory_mb <= 0:
            return list(command)
        return [
            "/bin/sh", "-c",
            ('ulimit -v %d 2>/dev/null || { echo "ulimit -v 不受支持" >&2; exit 126; }; '
             'ulimit -n 256 2>/dev/null; exec "$@"') % (self.memory_mb * 1024),
            "sh",
        ] + list(command)

    def _popen_options(self, uid, env):
        """构造 Popen 参数：独立 UID 用 user/group/extra_groups，绝不用 preexec_fn。"""
        options = {
            "cwd": self._root,
            "env": env,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True,
            "bufsize": 1,
        }
        if os.name == "posix":
            options["start_new_session"] = True
        if uid:
            if os.name != "posix":
                raise IsolationError("独立 UID 仅支持 Linux/POSIX，当前平台为 %s" % os.name)
            if sys.version_info < (3, 9):
                raise IsolationError(
                    "独立 UID 需要 Python 3.9+ 的 subprocess user/group 参数，"
                    "当前为 %s；不会退回不安全的 preexec_fn" % sys.version.split()[0])
            options.update({
                "user": uid,
                "group": uid,
                "extra_groups": [],
                # 创建文件 0640、目录 0750；配合 work 目录 setgid，产物只对宿主属组可读。
                "umask": 0o027,
            })
        return options

    def _verify_uid_isolation(self):
        """启用独立 UID 前的启动自检；任何不满足都显式失败（fail-closed）。"""
        if os.name != "posix":
            raise IsolationError(
                "TOOLBOX_CHILD_UID_BASE=%d 仅支持 Linux/POSIX，当前平台为 %s；"
                "请关闭独立 UID 或改用 Linux 部署" % (self.child_uid_base, os.name))
        if sys.version_info < (3, 9):
            raise IsolationError(
                "独立 UID 需要 Python 3.9+ 的 subprocess user/group 参数，当前为 %s"
                % sys.version.split()[0])
        euid = os.geteuid() if hasattr(os, "geteuid") else 1
        if euid != 0:
            raise IsolationError(
                "已启用独立 UID（TOOLBOX_CHILD_UID_BASE=%d），但运行时 euid=%d 不是 root："
                "无法降权，也不会退回共享 UID。请设置 TOOLBOX_RUNTIME_USER=0:0 "
                "或移除 TOOLBOX_CHILD_UID_BASE" % (self.child_uid_base, euid))
        missing = missing_capabilities()
        if missing:
            raise IsolationError(
                "已启用独立 UID，但容器缺少 capabilities：%s。"
                "请在 compose 中 cap_add 这些能力"
                "（SETUID/SETGID/CHOWN/FOWNER/FSETID/DAC_OVERRIDE/KILL），"
                "或移除 TOOLBOX_CHILD_UID_BASE" % ", ".join(missing))

    def _check_mode_consistency(self):
        """Node 与 Python 的 MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY 必须一致。"""
        node_value = config.node_runtime_mode()
        if node_value is None:
            # Node 尚未写入模式文件（例如 toolbox 先于 Node 启动）：下次 spawn/reload 再校验。
            return
        own = config.plugin_auth_only()
        if node_value != own:
            raise ModeMismatchError(
                "部署配置不一致：Node 的 MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=%s，Python 为 %s。"
                "两个容器必须使用同一配置，否则插件请求会被 403 或隔离失效；"
                "请统一环境变量后重启两个容器"
                % ("true" if node_value else "false", "true" if own else "false"))

    def isolation_status(self):
        """healthz 用：暴露真实生效的隔离配置（不含密钥）。"""
        registry = {}
        if self._uid_registry is not None:
            try:
                registry = self._uid_registry.snapshot()
            except IsolationError as err:
                registry = {"error": str(err)}
        return {
            "uid_enabled": self.child_uid_base > 0,
            "uid_base": self.child_uid_base,
            "uid_count": self.child_uid_count,
            "host_gid": config.host_gid(),
            "missing_capabilities": missing_capabilities(),
            "assignments": registry.get("assignments", {}),
        }

    def _child_uid(self, tool_id):
        """独立 UID 模式（TOOLBOX_CHILD_UID_BASE>0）下返回该插件的持久化唯一 UID。

        未启用时返回 0（共享 UID，保持旧部署）。启用后若注册表不可用则抛
        IsolationError，绝不返回 0 静默降级。
        """
        if self.child_uid_base <= 0:
            return 0
        if self._uid_registry is None:
            raise IsolationError(
                "TOOLBOX_CHILD_UID_BASE=%d 但 UID 注册表未初始化；拒绝以共享 UID 启动插件"
                % self.child_uid_base)
        installed = set(self._state_items) if self._state_items else None
        return self._uid_registry.allocate(tool_id, installed_ids=installed, data_root=config.DATA_ROOT)

    def _prepare_tool_data(self, tool_id, uid):
        """创建插件数据目录；独立 UID 下迁移属主并收紧到“插件 + 宿主属组”。

        权限布局（uid 模式）：
          data/<tool_id>        2710  属主插件 UID / 属组宿主 GID（setgid 供继承）
          data/<tool_id>/<work> 2750  同上（setgid 让新文件继承宿主属组）
          work 内文件           0640  插件可写、宿主属组可读、其他插件不可读
          data/<tool_id>/*.json 0600  插件私有配置
        """
        path = os.path.join(config.DATA_ROOT, tool_id)
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as err:
            if uid:
                raise IsolationError("无法创建插件数据目录 %s：%s" % (path, err))
            LOGGER.error("[supervisor] cannot create data dir for %s: %s", tool_id, err)
            return path
        if os.name != "posix":
            return path
        host_gid = config.host_gid()
        if not uid:
            try:
                # 旧部署/共享 UID：0711 让宿主 Node 穿透读取产物，行为保持不变。
                os.chmod(path, 0o711)
            except OSError:
                pass
            return path
        try:
            info = os.stat(path)
            if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, host_gid, 0o2710):
                return path  # 已迁移完成，避免每次懒启动都全量遍历
        except OSError:
            pass
        try:
            os.chown(path, uid, host_gid)
            for root, dirs, files in os.walk(path):
                for name in dirs:
                    target = os.path.join(root, name)
                    if os.path.islink(target):
                        os.chown(target, uid, host_gid, follow_symlinks=False)
                        continue
                    os.chown(target, uid, host_gid)
                    os.chmod(target, 0o2750)
                for name in files:
                    target = os.path.join(root, name)
                    os.chown(target, uid, host_gid, follow_symlinks=False)
                    if os.path.islink(target):
                        continue
                    # 根目录下的文件是 config.json 等私有配置；work 子目录里的是交付产物。
                    os.chmod(target, 0o600 if root == path else 0o640)
            # 最后再改根目录模式：setgid 让插件新建的 work 目录继承宿主属组；
            # 中途失败时下次启动会重新完整迁移。
            os.chmod(path, 0o2710)
        except OSError as err:
            raise IsolationError(
                "无法把插件数据目录 %s 交给 UID %d/GID %d：%s"
                "（请检查 TOOLBOX_RUNTIME_USER=0:0 与 CHOWN/FOWNER/DAC_OVERRIDE 能力）"
                % (path, uid, host_gid, err))
        return path

    def _inject_data_key(self, env):
        """独立 UID 下插件读不到 0600 的配置密钥，由 supervisor 代为注入。

        子进程以独立 UID 运行时无法在 state/ 下创建 config.key，因此缺失时
        由 supervisor（root）先生成 0600 的密钥文件再注入；已有文件直接复用，
        避免插件各自生成不同密钥导致配置互相解密失败。
        """
        if not self.child_uid_base or "MYBOOKS_TOOLBOX_DATA_KEY" in env:
            return
        path = os.path.join(config.STATE_DIR, "config.key")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                value = handle.read().strip()
        except FileNotFoundError:
            value = ""
        except OSError as err:
            LOGGER.warning("[supervisor] cannot read %s: %s", path, err)
            return
        if not value:
            value = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
            try:
                os.makedirs(config.STATE_DIR, exist_ok=True)
                tmp = path + ".tmp-%d" % os.getpid()
                with open(tmp, "w", encoding="utf-8") as handle:
                    handle.write(value + "\n")
                os.chmod(tmp, 0o600)
                os.replace(tmp, path)
            except OSError as err:
                LOGGER.warning("[supervisor] cannot create %s: %s", path, err)
                return
        # 密钥文件归属运行目录的属主（旧 Worker 以该 UID 运行），保持 0600：
        # 独立 UID 的子进程读不到，只能靠本方法注入。
        try:
            if os.name != "posix":
                raise OSError("chown 仅在 POSIX 可用")
            owner = os.stat(config.STATE_DIR)
            os.chown(path, owner.st_uid, owner.st_gid)
        except OSError:
            pass
        env["MYBOOKS_TOOLBOX_DATA_KEY"] = value

    def _plugin_token(self, tool_id):
        """从 state/identities.json 取该插件自己的令牌；不存在或结构异常时返回空。"""
        path = os.path.join(config.STATE_DIR, "identities.json")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        except (OSError, ValueError):
            return ""
        if not isinstance(document, dict) or document.get("version") != 1:
            return ""
        tokens = document.get("tokens")
        if not isinstance(tokens, dict):
            return ""
        token = tokens.get(tool_id)
        if not isinstance(token, str) or not re.match(r"^[a-f0-9]{48}$", token):
            return ""
        return token

    def _pump(self, stream, tool_id, channel):
        try:
            for line in stream:
                LOGGER.info("[child:%s:%s] %s", tool_id, channel, line.rstrip())
        except Exception:
            pass

    def stop_child(self, tool_id):
        """供 Node / Runtime Manager 显式停止单个插件进程（下次请求会重新懒启动）。"""
        return self._stop_child(tool_id)

    def _stop_child(self, tool_id):
        with self._lock:
            child = self._children.pop(tool_id, None)
        if not child:
            return False
        self._terminate(child.process)
        LOGGER.info("[supervisor] stopped %s", tool_id)
        return True

    def _terminate(self, process):
        if process is None:
            return
        if process.poll() is None:
            for action in (process.terminate, process.kill):
                try:
                    action()
                except Exception as err:
                    # 独立 UID 模式下 root 需要 CAP_KILL 才能给别的 UID 发信号。
                    LOGGER.warning("[supervisor] cannot signal pid=%s: %s", process.pid, err)
                    continue
                try:
                    process.wait(timeout=5)
                    break
                except Exception:
                    continue
        if process.poll() is None:
            # 子进程仍存活时绝不能关闭管道：采集线程正阻塞在 readline 上，
            # close() 会永久等待其内部锁，进而拖死整个 supervisor。
            LOGGER.error("[supervisor] pid=%s still alive, skip pipe close", process.pid)
            return
        # 子进程已退出，显式关闭管道，避免长期运行累积文件句柄。
        for stream in (process.stdout, process.stderr):
            try:
                if stream:
                    stream.close()
            except Exception:
                pass

    # ---------- dispatch ----------

    async def ensure_child(self, tool_id):
        async with self._ensure_lock:
            with self._lock:
                if self._reloading:
                    raise ReloadingError("插件运行时正在重载，请稍后重试")
                child = self._children.get(tool_id)
                if child and child.alive():
                    return child
                dead = None
                if child:
                    # 崩溃/被外部杀掉的子进程仍占着 stdout/stderr 管道；
                    # 先移除再在锁外回收，避免终止阻塞 healthz。
                    self._children.pop(tool_id, None)
                    dead = child.process
                item = self._state_items.get(tool_id)
                if item is None:
                    raise ChildNotFound("工具未启用或不存在")
                at_capacity = len(self._children) >= self.max_children
                generation = self._generation

            if dead is not None:
                self._terminate(dead)

            if at_capacity:
                evicted = await self._evict_one()
                if not evicted:
                    raise CapacityError("插件运行时容量已满，请稍后重试")

            loop = tornado.ioloop.IOLoop.current()
            child = await loop.run_in_executor(None, self._spawn_sync, tool_id, item)
            with self._lock:
                stale = self._reloading or generation != self._generation
                if not stale:
                    self._children[tool_id] = child
            if stale:
                # 启动期间发生了 reload：丢弃旧世代的进程，让调用方重试。
                self._terminate(child.process)
                raise ReloadingError("插件运行时已更新，请重试")
            return child

    def _child_current(self, child):
        with self._lock:
            return child.alive() and self._children.get(child.tool_id) is child

    async def _evict_one(self):
        now = time.time()
        with self._lock:
            candidates = [
                child for child in self._children.values()
                if child.inflight == 0 and now - child.last_used >= self.idle_seconds
            ]
        candidates.sort(key=lambda child: child.last_used)
        for child in candidates:
            if await self._is_busy(child):
                continue
            self._stop_child(child.tool_id)
            return True
        return False

    async def _is_busy(self, child):
        client = tornado.httpclient.AsyncHTTPClient()
        try:
            response = await client.fetch(tornado.httpclient.HTTPRequest(
                "http://127.0.0.1:%d/internal/busy" % child.port,
                headers={"X-Mybooks-Runtime-Secret": child.secret},
                request_timeout=2,
            ), raise_error=False)
            if response.code != 200:
                return True
            payload = json.loads(response.body or b"{}")
            return bool(payload.get("busy"))
        except Exception as err:
            # 探活失败按“忙”处理（不淘汰），但要留下日志，避免容量被静默卡死。
            LOGGER.warning("[supervisor] busy probe failed for %s: %s", child.tool_id, err)
            return True

    async def proxy(self, tool_id, request):
        attempt = 0
        while True:
            child = await self.ensure_child(tool_id)
            with self._lock:
                child.inflight += 1
                child.last_used = time.time()
            try:
                headers = {
                    key: value for key, value in request.headers.items()
                    if key.lower() not in ("host", "content-length", "connection")
                }
                # 主机只把“该子进程自己的”密钥转发进去；Node 发来的宿主密钥不会进入插件。
                headers["X-Mybooks-Runtime-Secret"] = child.secret
                body = request.body if request.method not in ("GET", "HEAD") else None
                client = tornado.httpclient.AsyncHTTPClient()
                response = await client.fetch(tornado.httpclient.HTTPRequest(
                    "http://127.0.0.1:%d%s" % (child.port, request.uri),
                    method=request.method,
                    headers=headers,
                    body=body,
                    request_timeout=self.proxy_timeout,
                    follow_redirects=False,
                ), raise_error=False)
            except Exception:
                # 子进程可能在请求期间崩溃或被 reload 停掉：重启后重试一次。
                if attempt == 0 and not self._child_current(child):
                    attempt = 1
                    continue
                raise
            finally:
                with self._lock:
                    child.inflight = max(0, child.inflight - 1)
                    child.last_used = time.time()
            if attempt == 0 and response.code == 599 and not self._child_current(child):
                attempt = 1
                continue
            return response
