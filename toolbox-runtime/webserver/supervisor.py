# -*- coding: utf-8 -*-
"""每插件子进程 supervisor（容器内隔离）。

约束（2GB 服务器）：
  · 懒启动：只有请求到来才拉起插件进程；
  · 最多 TOOLBOX_MAX_CHILDREN 个（默认 2），每进程 RLIMIT_AS 默认 384MB；
  · 容量满时淘汰“空闲且无后台任务”的最久未用子进程；
  · 崩溃只影响对应子进程，supervisor 在下次请求时重启。

注意：同一容器、同一 UID、共享 /toolbox 与网络，这是故障/资源隔离，
不是恶意代码沙箱。
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import socket
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


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ChildProcess(object):
    def __init__(self, tool_id, revision, port, process, secret):
        self.tool_id = tool_id
        self.revision = revision
        self.port = port
        self.process = process
        # 每个子进程独立的 runtime-secret：插件进程无法拿它调用 supervisor 的
        # /internal/reload|start|stop（这些接口只认宿主密钥）。
        self.secret = secret
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
        # 0 = 关闭独立 UID（默认，保持旧部署）；>0 时为每个插件分配稳定 UID（需 root）。
        self.child_uid_base = max(0, int(os.environ.get("TOOLBOX_CHILD_UID_BASE", "0")))
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self._child_command = child_command or [sys.executable, os.path.join(root, "runtime.py")]
        self._root = root
        self._children = {}
        self._state_items = {}
        self._lock = threading.RLock()
        self._ensure_lock = asyncio.Lock()
        self._reloading = False
        self._generation = 0

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
        if token:
            env["MYBOOKS_PLUGIN_TOKEN"] = token
        else:
            env.pop("MYBOOKS_PLUGIN_TOKEN", None)
        self._inject_data_key(env)
        command = list(self._child_command)
        if os.name == "posix" and self.memory_mb > 0:
            # 用 shell 设置 rlimit，避免在有多线程的 supervisor 里用 preexec_fn。
            command = [
                "/bin/sh", "-c",
                'ulimit -v %d 2>/dev/null; ulimit -n 256 2>/dev/null; exec "$@"' % (self.memory_mb * 1024),
                "sh",
            ] + command
        kwargs = {
            "cwd": self._root,
            "env": env,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True,
            "bufsize": 1,
        }
        if os.name == "posix":
            kwargs["start_new_session"] = True
        if uid:
            # 独立 UID：子进程在 exec 前降权，无法读取 0600 的 state/ 凭据。
            def _demote(target=uid):
                os.setgid(target)
                os.setuid(target)
            kwargs["preexec_fn"] = _demote
        process = subprocess.Popen(command, **kwargs)
        threading.Thread(target=self._pump, args=(process.stdout, tool_id, "stdout"), daemon=True).start()
        threading.Thread(target=self._pump, args=(process.stderr, tool_id, "stderr"), daemon=True).start()

        child = ChildProcess(tool_id, str(item.get("revision") or ""), port, process, secret)
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

    def _child_uid(self, tool_id):
        """独立 UID 模式（TOOLBOX_CHILD_UID_BASE>0）下为每个插件分配稳定 UID。

        只有 POSIX + root 才能降权；其他情况返回 0（不降权），保持现有行为。
        """
        if self.child_uid_base <= 0 or os.name != "posix":
            return 0
        if getattr(os, "geteuid", lambda: 1)() != 0:
            LOGGER.warning("[supervisor] TOOLBOX_CHILD_UID_BASE 需要 root 才能生效，已跳过")
            return 0
        index = int(hashlib.sha256(tool_id.encode("utf-8")).hexdigest(), 16) % 200
        return self.child_uid_base + index

    def _prepare_tool_data(self, tool_id, uid):
        """创建插件私有数据目录（0711），必要时 chown 给该插件的 UID。"""
        path = os.path.join(config.DATA_ROOT, tool_id)
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as err:
            LOGGER.error("[supervisor] cannot create data dir for %s: %s", tool_id, err)
            return path
        if os.name == "posix":
            if uid:
                try:
                    for root, dirs, files in os.walk(path):
                        os.chown(root, uid, uid)
                        for name in dirs + files:
                            os.chown(os.path.join(root, name), uid, uid, follow_symlinks=False)
                except OSError as err:
                    LOGGER.warning("[supervisor] chown data dir %s failed: %s", path, err)
            try:
                # 先 chown 再 chmod：root 没有 CAP_FOWNER，改不了别人名下的模式位。
                # 0711 只允许穿透：宿主 Node（uid 1000）要读 work/ 产物入库，
                # 但无法列举目录；config.json 在子进程里仍写成 0600。
                os.chmod(path, 0o711)
            except OSError:
                pass
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
