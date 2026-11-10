#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mybooks Toolbox Runtime —— 独立 Python 插件宿主。

启动：
    MYBOOKS_TOOLBOX_DIR=/toolbox MYBOOKS_NODE_INTERNAL_URL=http://my-books:3000 \
    TOOLBOX_RUNTIME_HOST=0.0.0.0 python runtime.py

不发布公网端口；只接受 Node 带 runtime-secret 的内部转发。
"""
import hmac
import inspect
import json
import logging
import os
import signal
import threading
from urllib.parse import unquote

import tornado.ioloop
import tornado.web

from webserver.handlers.base import BaseHandler, runtime_secret
from webserver.services import AsyncService
from webserver.services.background_service import BackgroundService
from webserver.toolbox import config, storage
from webserver.toolbox.plugin_host import host

logging.basicConfig(
    level=os.environ.get("TOOLBOX_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOGGER = logging.getLogger("toolbox.runtime")

# 配置写入锁：保证“读取 → 版本校验 → 合并 → 落盘”在进程内串行，
# 多个管理端并发保存不会互相覆盖。
_CONFIG_WRITE_LOCK = threading.Lock()


def json_response(handler, status, payload):
    handler.set_status(status)
    handler.set_header("Content-Type", "application/json; charset=utf-8")
    handler.set_header("Cache-Control", "no-store")
    handler.finish(json.dumps(payload, ensure_ascii=False, default=str))


def runtime_authorized(handler):
    expected = runtime_secret()
    provided = handler.request.headers.get("X-Mybooks-Runtime-Secret", "")
    return bool(expected) and hmac.compare_digest(str(provided), str(expected))


class HealthHandler(tornado.web.RequestHandler):
    def get(self):
        json_response(self, 200, {
            "status": "ok",
            "isolated": False,
            "isolation_mode": "shared",
            "plugins": [item["tool_id"] for item in host.summary()],
            # 部署自检：Node 与本 Runtime 必须指向同一个共享卷路径。
            "toolbox_dir": config.TOOLBOX_ROOT,
            "data_dir": config.DATA_ROOT,
            "plugin_auth_only": config.plugin_auth_only(),
        })


class ReloadHandler(tornado.web.RequestHandler):
    def post(self):
        if not runtime_authorized(self):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        reports = host.reload()
        return json_response(self, 200, {"ok": True, "plugins": reports, "loaded": host.summary()})


class BusyHandler(tornado.web.RequestHandler):
    """供 supervisor 判断子进程是否能安全淘汰。"""

    def get(self):
        if not runtime_authorized(self):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        background = 0
        try:
            background = sum(1 for task in BackgroundService()._tasks.values()
                             if task.status == "running")
        except Exception:
            LOGGER.exception("[busy] background snapshot failed")
        pending = 0
        try:
            for _thread, jobs in getattr(AsyncService, "_running", {}).values():
                pending += int(getattr(jobs, "unfinished_tasks", 0))
        except Exception:
            LOGGER.exception("[busy] async snapshot failed")
        json_response(self, 200, {
            "busy": background > 0 or pending > 0,
            "background_running": background,
            "async_pending": pending,
        })


class InternalConfigHandler(tornado.web.RequestHandler):
    """Node 读写插件配置的唯一入口。

    不执行插件代码；只调用 storage.get_config / set_config。
    返回原始配置，敏感字段由 Node 按 Manifest schema 掩码后再下发给浏览器。
    写入支持版本校验与字段级合并，避免管理端并发修改互相覆盖。
    """

    def initialize(self, storage_module):
        self._storage = storage_module

    def get(self, tool_id):
        if not runtime_authorized(self):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        data_dir = os.path.join(config.DATA_ROOT, tool_id)
        if not os.path.isdir(data_dir):
            return json_response(self, 404, {
                "ok": False, "code": "CONFIG_NOT_FOUND", "error": "插件配置目录不存在",
            })
        try:
            data = self._storage.get_config(tool_id)
        except self._storage.StorageError as err:
            LOGGER.warning("[config] read failed tool=%s: %s", tool_id, err)
            return json_response(self, 500, {
                "ok": False, "code": "CONFIG_DECRYPT_FAILED", "error": str(err),
            })
        except Exception:
            LOGGER.exception("[config] unexpected failure tool=%s", tool_id)
            return json_response(self, 500, {
                "ok": False, "code": "CONFIG_READ_FAILED", "error": "配置读取失败",
            })
        return json_response(self, 200, {
            "ok": True,
            "tool_id": tool_id,
            "config": data,
            "version": self._storage.config_version(data),
        })

    def put(self, tool_id):
        """字段级合并写入：values 覆盖指定字段，clear 删除敏感字段。

        整个“读取 → 版本校验 → 合并 → 落盘”在同一把锁内完成，
        版本不一致返回 409，绝不静默覆盖其他管理操作。
        """
        if not runtime_authorized(self):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        try:
            body = json.loads(self.request.body.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return json_response(self, 400, {
                "ok": False, "code": "CONFIG_INVALID", "error": "请求体必须是 JSON",
            })
        if not isinstance(body, dict):
            return json_response(self, 400, {
                "ok": False, "code": "CONFIG_INVALID", "error": "请求体必须是对象",
            })
        values = body.get("values", {})
        clear = body.get("clear", [])
        if not isinstance(values, dict):
            return json_response(self, 400, {
                "ok": False, "code": "CONFIG_INVALID", "error": "values 必须是对象",
            })
        if not isinstance(clear, list) or any(not isinstance(item, str) for item in clear):
            return json_response(self, 400, {
                "ok": False, "code": "CONFIG_INVALID", "error": "clear 必须是字符串数组",
            })
        if len(values) > 64 or len(clear) > 32:
            return json_response(self, 400, {
                "ok": False, "code": "CONFIG_INVALID", "error": "一次提交的字段过多",
            })

        with _CONFIG_WRITE_LOCK:
            try:
                current = self._storage.get_config(tool_id)
            except self._storage.StorageError as err:
                LOGGER.warning("[config] write read failed tool=%s: %s", tool_id, err)
                return json_response(self, 500, {
                    "ok": False, "code": "CONFIG_DECRYPT_FAILED", "error": str(err),
                })
            current_version = self._storage.config_version(current)
            expected = body.get("version")
            if expected is not None and str(expected) != current_version:
                return json_response(self, 409, {
                    "ok": False,
                    "code": "CONFIG_VERSION_CONFLICT",
                    "error": "配置已被其他操作修改",
                    "version": current_version,
                })
            merged = dict(current)
            merged.update(values)
            for field in clear:
                merged.pop(field, None)
            try:
                self._storage.set_config(tool_id, merged)
            except self._storage.StorageError as err:
                LOGGER.warning("[config] write failed tool=%s: %s", tool_id, err)
                return json_response(self, 500, {
                    "ok": False, "code": "CONFIG_WRITE_FAILED", "error": "配置写入失败",
                })
            except Exception:
                LOGGER.exception("[config] unexpected write failure tool=%s", tool_id)
                return json_response(self, 500, {
                    "ok": False, "code": "CONFIG_WRITE_FAILED", "error": "配置写入失败",
                })
            return json_response(self, 200, {
                "ok": True,
                "tool_id": tool_id,
                "version": self._storage.config_version(merged),
                "changed_fields": sorted(values.keys()),
                "cleared": sorted(set(clear)),
            })


class ToolDispatchHandler(BaseHandler):
    def prepare(self):
        super().prepare()
        if self._finished:
            return
        tool_id = self.path_args[0]
        entry = host.get(tool_id)
        if not entry:
            self._entry = None
            return
        self._entry = entry

    async def _dispatch(self):
        if self._finished:
            return
        entry = getattr(self, "_entry", None)
        if entry is None:
            return json_response(self, 404, {"err": "tool.disabled", "msg": "工具未启用或不存在"})
        route = unquote(self.path_args[1] if len(self.path_args) > 1 else "").strip("/")
        handler_cls = entry.routes.get(route)
        if handler_cls is None:
            return json_response(self, 404, {"err": "route.not_found", "msg": "插件没有声明这个接口"})
        verb = self.request.method.lower()
        method = getattr(handler_cls, verb, None)
        if not callable(method):
            return json_response(self, 405, {"err": "method.not_allowed", "msg": "接口不支持该 HTTP 方法"})
        # 真实 handler 实例：插件可能定义 _deny/_json 等辅助方法（md_to_epub
        # 的 DownloadHandler 就用 self._deny）。不能把未绑定方法直接套在 dispatcher 上，
        # 否则这些 helper 会 AttributeError。
        try:
            handler = handler_cls(self.application, self.request)
            # 正常路径由 _execute 初始化；手工构造时补齐 finish/flush 依赖的最小状态。
            handler._transforms = []
            handler.path_args = self.path_args
            handler.path_kwargs = self.path_kwargs
            handler.current_user = self.current_user
            handler.admin_user = self.admin_user
            result = method(handler)
            if inspect.isawaitable(result):
                result = await result
            if not handler._finished:
                # 有些 raw handler（如 md_to_epub 的 _deny）只 write/set_status，
                # 把 finish 留给框架；此时不能再用 200 JSON 覆盖它。
                if handler._write_buffer or handler.get_status() != 200:
                    handler.finish()
                else:
                    if result is None:
                        result = {}
                    json_response(handler, 200, result)
            # 请求已经由 handler 写回；阻止 Tornado 对 dispatcher 再走一遍 finish。
            self._finished = True
        except tornado.web.Finish:
            self._finished = True
            return
        except Exception:
            LOGGER.exception("[tool] %s/%s crashed", entry.tool_id, route)
            if not self._finished and not getattr(self.request, "_disconnected", False):
                json_response(self, 500, {"err": "exception", "msg": "工具执行失败，请查看运行日志"})
            self._finished = True

    async def get(self, *_args):
        await self._dispatch()

    async def post(self, *_args):
        await self._dispatch()

    async def put(self, *_args):
        await self._dispatch()

    async def patch(self, *_args):
        await self._dispatch()

    async def delete(self, *_args):
        await self._dispatch()


class SupervisorHealthHandler(tornado.web.RequestHandler):
    def initialize(self, supervisor):
        self._supervisor = supervisor

    def get(self):
        children = self._supervisor.summary()
        json_response(self, 200, {
            "status": "ok",
            "isolated": True,
            "isolation_mode": "uid" if self._supervisor.isolation_status().get("uid_enabled") else "process",
            "plugins": [child["tool_id"] for child in children if child.get("online")],
            "children": children,
            "deferred": self._supervisor.deferred(),
            # 两侧配置与真实生效的隔离能力，便于部署核对（不含任何密钥）。
            "toolbox_dir": config.TOOLBOX_ROOT,
            "data_dir": config.DATA_ROOT,
            "plugin_auth_only": config.plugin_auth_only(),
            "node_plugin_auth_only": config.node_runtime_mode(),
            "uid_isolation": self._supervisor.isolation_status(),
        })


class SupervisorReloadHandler(tornado.web.RequestHandler):
    def initialize(self, supervisor):
        self._supervisor = supervisor

    async def post(self):
        if not runtime_authorized(self):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        loop = tornado.ioloop.IOLoop.current()
        reports = await loop.run_in_executor(None, self._supervisor.reload)
        json_response(self, 200, {
            "ok": True,
            "plugins": reports,
            "loaded": self._supervisor.summary(),
        })


class SupervisorStartHandler(tornado.web.RequestHandler):
    """预热单个插件子进程（懒启动语义，失败显式返回错误）。"""

    def initialize(self, supervisor):
        self._supervisor = supervisor

    async def post(self, tool_id):
        from webserver.supervisor import (
            CapacityError, ChildNotFound, IsolationError, ModeMismatchError, ReloadingError)

        if not runtime_authorized(self):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        try:
            child = await self._supervisor.ensure_child(tool_id)
        except ChildNotFound as err:
            return json_response(self, 404, {"ok": False, "err": "tool.disabled", "msg": str(err)})
        except (CapacityError, ReloadingError, IsolationError, ModeMismatchError) as err:
            return json_response(self, 503, {"ok": False, "err": err.code, "msg": str(err)})
        except Exception:
            LOGGER.exception("[supervisor] start %s failed", tool_id)
            return json_response(self, 502, {"ok": False, "err": "runtime.unavailable", "msg": "插件进程不可用"})
        json_response(self, 200, {"ok": True, "tool_id": tool_id, "port": child.port})


class SupervisorStopHandler(tornado.web.RequestHandler):
    """停止单个插件子进程；下一次请求会重新懒启动。"""

    def initialize(self, supervisor):
        self._supervisor = supervisor

    async def post(self, tool_id):
        if not runtime_authorized(self):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        loop = tornado.ioloop.IOLoop.current()
        stopped = await loop.run_in_executor(None, self._supervisor.stop_child, tool_id)
        json_response(self, 200, {"ok": True, "tool_id": tool_id, "stopped": bool(stopped)})


class SupervisorToolHandler(tornado.web.RequestHandler):
    def initialize(self, supervisor):
        self._supervisor = supervisor

    async def get(self, *_args):
        await self._dispatch()

    async def post(self, *_args):
        await self._dispatch()

    async def put(self, *_args):
        await self._dispatch()

    async def patch(self, *_args):
        await self._dispatch()

    async def delete(self, *_args):
        await self._dispatch()

    async def _dispatch(self):
        from webserver.supervisor import (
            CapacityError, ChildNotFound, IsolationError, ModeMismatchError, ReloadingError)

        tool_id = self.path_args[0]
        try:
            response = await self._supervisor.proxy(tool_id, self.request)
        except ChildNotFound as err:
            return json_response(self, 404, {"err": "tool.disabled", "msg": str(err)})
        except (CapacityError, ReloadingError, IsolationError, ModeMismatchError) as err:
            return json_response(self, 503, {"err": err.code, "msg": str(err)})
        except Exception:
            LOGGER.exception("[supervisor] proxy %s failed", tool_id)
            return json_response(self, 502, {"err": "runtime.unavailable", "msg": "插件进程不可用"})

        self.set_status(response.code)
        for header in ("content-type", "content-disposition", "cache-control", "etag", "last-modified"):
            value = response.headers.get(header)
            if value:
                self.set_header(header, value)
        self.finish(response.body or b"")


def make_app():
    return tornado.web.Application(
        [
            (r"/healthz", HealthHandler),
            (r"/internal/reload", ReloadHandler),
            (r"/internal/busy", BusyHandler),
            (r"/internal/tool/([a-z0-9_]+)/config", InternalConfigHandler,
             {"storage_module": storage}),
            (r"/tool/([a-z0-9_]+)/(.*)", ToolDispatchHandler),
        ],
        compress_response=True,
        max_body_size=config.MAX_BODY_BYTES,
        autoreload=False,
    )


def make_supervisor_app(supervisor):
    return tornado.web.Application(
        [
            (r"/healthz", SupervisorHealthHandler, {"supervisor": supervisor}),
            (r"/internal/reload", SupervisorReloadHandler, {"supervisor": supervisor}),
            (r"/internal/start/([a-z0-9_]+)", SupervisorStartHandler, {"supervisor": supervisor}),
            (r"/internal/stop/([a-z0-9_]+)", SupervisorStopHandler, {"supervisor": supervisor}),
            (r"/internal/tool/([a-z0-9_]+)/config", InternalConfigHandler,
             {"storage_module": storage}),
            (r"/tool/([a-z0-9_]+)/(.*)", SupervisorToolHandler, {"supervisor": supervisor}),
        ],
        compress_response=True,
        max_body_size=config.MAX_BODY_BYTES,
        autoreload=False,
    )


def main():
    port = config.RUNTIME_PORT
    address = os.environ.get("TOOLBOX_RUNTIME_HOST", "127.0.0.1")
    supervisor = None
    if os.environ.get("TOOLBOX_ISOLATE_PLUGINS", "0") == "1":
        # 容器内每插件子进程：supervisor 只代理，不在本进程加载插件代码。
        from webserver.supervisor import IsolationError, PluginSupervisor

        try:
            supervisor = PluginSupervisor()
        except IsolationError as err:
            # 显式启用隔离但环境不满足：直接失败，绝不退回共享 UID 继续对外服务。
            LOGGER.error("[supervisor] 隔离配置不可用，拒绝启动：%s", err)
            raise SystemExit(2)
        supervisor.reload()
        app = make_supervisor_app(supervisor)
        LOGGER.info("Toolbox supervisor listening on %s:%d, children=%s", address, port,
                    ", ".join(child["tool_id"] for child in supervisor.summary()) or "none")
    else:
        host.reload()
        app = make_app()
        LOGGER.info("Toolbox runtime listening on %s:%d, plugins=%s", address, port,
                    ", ".join(item["tool_id"] for item in host.summary()) or "none")
    app.listen(port, address=address)

    def stop(*_args):
        LOGGER.info("Toolbox runtime shutting down")
        if supervisor is not None:
            supervisor.shutdown()
        tornado.ioloop.IOLoop.current().stop()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    tornado.ioloop.IOLoop.current().start()


if __name__ == "__main__":
    main()
