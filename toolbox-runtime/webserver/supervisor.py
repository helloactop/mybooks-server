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
import json
import logging
import os
import re
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
    def __init__(self, tool_id, revision, port, process):
        self.tool_id = tool_id
        self.revision = revision
        self.port = port
        self.process = process
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
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self._child_command = child_command or [sys.executable, os.path.join(root, "runtime.py")]
        self._root = root
        self._children = {}
        self._state_items = {}
        self._lock = threading.RLock()
        self._ensure_lock = asyncio.Lock()
        self._reloading = False

    # ---------- state ----------

    def _read_state(self):
        try:
            with open(config.STATE_FILE, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        except FileNotFoundError:
            return []
        except (OSError, ValueError) as err:
            LOGGER.error("[supervisor] state file invalid: %s", err)
            return []
        tools = document.get("tools") if isinstance(document, dict) else None
        if not isinstance(tools, list):
            return []
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
            self._reloading = True
            for tool_id in list(self._children):
                self._stop_child(tool_id)
            state = self._read_state()
            self._state_items = state

        reports = []
        started = 0
        try:
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
        env = os.environ.copy()
        env.update({
            "TOOLBOX_ONLY_TOOL": tool_id,
            "TOOLBOX_RUNTIME_PORT": str(port),
            "TOOLBOX_RUNTIME_HOST": "127.0.0.1",
            "TOOLBOX_ISOLATE_PLUGINS": "0",
            "PYTHONUNBUFFERED": "1",
        })
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
        process = subprocess.Popen(command, **kwargs)
        threading.Thread(target=self._pump, args=(process.stdout, tool_id, "stdout"), daemon=True).start()
        threading.Thread(target=self._pump, args=(process.stderr, tool_id, "stderr"), daemon=True).start()

        child = ChildProcess(tool_id, str(item.get("revision") or ""), port, process)
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

    def _pump(self, stream, tool_id, channel):
        try:
            for line in stream:
                LOGGER.info("[child:%s:%s] %s", tool_id, channel, line.rstrip())
        except Exception:
            pass

    def _stop_child(self, tool_id):
        child = self._children.pop(tool_id, None)
        if not child:
            return False
        self._terminate(child.process)
        LOGGER.info("[supervisor] stopped %s", tool_id)
        return True

    def _terminate(self, process):
        if process is None:
            return
        try:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
        finally:
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
                if child:
                    self._children.pop(tool_id, None)
                item = self._state_items.get(tool_id)
                if item is None:
                    raise ChildNotFound("工具未启用或不存在")
                at_capacity = len(self._children) >= self.max_children

            if at_capacity:
                evicted = await self._evict_one()
                if not evicted:
                    raise CapacityError("插件运行时容量已满，请稍后重试")

            loop = tornado.ioloop.IOLoop.current()
            child = await loop.run_in_executor(None, self._spawn_sync, tool_id, item)
            with self._lock:
                self._children[tool_id] = child
            return child

    async def _evict_one(self):
        now = time.time()
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
                headers={"X-Mybooks-Runtime-Secret": runtime_secret()},
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
        child = await self.ensure_child(tool_id)
        with self._lock:
            child.inflight += 1
            child.last_used = time.time()
        try:
            headers = {
                key: value for key, value in request.headers.items()
                if key.lower() not in ("host", "content-length", "connection")
            }
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
            return response
        finally:
            with self._lock:
                child.inflight = max(0, child.inflight - 1)
                child.last_used = time.time()
