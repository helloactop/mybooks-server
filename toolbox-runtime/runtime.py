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
from urllib.parse import unquote

import tornado.ioloop
import tornado.web

from webserver.handlers.base import BaseHandler, runtime_secret
from webserver.toolbox import config
from webserver.toolbox.plugin_host import host

logging.basicConfig(
    level=os.environ.get("TOOLBOX_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOGGER = logging.getLogger("toolbox.runtime")


def json_response(handler, status, payload):
    handler.set_status(status)
    handler.set_header("Content-Type", "application/json; charset=utf-8")
    handler.set_header("Cache-Control", "no-store")
    handler.finish(json.dumps(payload, ensure_ascii=False, default=str))


class HealthHandler(tornado.web.RequestHandler):
    def get(self):
        json_response(self, 200, {"status": "ok", "plugins": [item["tool_id"] for item in host.summary()]})


class ReloadHandler(tornado.web.RequestHandler):
    def post(self):
        expected = runtime_secret()
        provided = self.request.headers.get("X-Mybooks-Runtime-Secret", "")
        if not expected or not hmac.compare_digest(str(provided), str(expected)):
            return json_response(self, 403, {"ok": False, "error": "forbidden"})
        reports = host.reload()
        return json_response(self, 200, {"ok": True, "plugins": reports, "loaded": host.summary()})


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


def make_app():
    return tornado.web.Application(
        [
            (r"/healthz", HealthHandler),
            (r"/internal/reload", ReloadHandler),
            (r"/tool/([a-z0-9_]+)/(.*)", ToolDispatchHandler),
        ],
        compress_response=True,
        max_body_size=config.MAX_BODY_BYTES,
        autoreload=False,
    )


def main():
    host.reload()
    port = config.RUNTIME_PORT
    address = os.environ.get("TOOLBOX_RUNTIME_HOST", "127.0.0.1")
    app = make_app()
    app.listen(port, address=address)
    LOGGER.info("Toolbox runtime listening on %s:%d, plugins=%s", address, port,
                ", ".join(item["tool_id"] for item in host.summary()) or "none")

    def stop(*_args):
        LOGGER.info("Toolbox runtime shutting down")
        tornado.ioloop.IOLoop.current().stop()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    tornado.ioloop.IOLoop.current().start()


if __name__ == "__main__":
    main()
