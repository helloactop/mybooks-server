# -*- coding: utf-8 -*-
"""Tornado BaseHandler 兼容层。

只接受 Node 内部转发：请求必须带共享 runtime-secret 和用户 ID。
插件页面永远拿不到这个 secret，也不能直接访问本服务。
"""
import asyncio
import hmac
import inspect
import json
import logging
import os
import re
import threading
from types import SimpleNamespace

import tornado.web

from webserver.toolbox import config

_SECRET_LOCK = threading.Lock()
_SECRET_CACHE = {}


def runtime_secret():
    with _SECRET_LOCK:
        if _SECRET_CACHE.get("value"):
            return _SECRET_CACHE["value"]
        value = os.environ.get("MYBOOKS_TOOLBOX_RUNTIME_SECRET", "").strip()
        if not value:
            try:
                with open(os.path.join(config.STATE_DIR, "runtime-secret"), "r", encoding="utf-8") as handle:
                    value = handle.read().strip()
            except OSError:
                value = ""
        if value:
            _SECRET_CACHE["value"] = value
        return value


def js(func):
    async def do(self, *args, **kwargs):
        try:
            rsp = func(self, *args, **kwargs)
            if inspect.isawaitable(rsp):
                rsp = await rsp
            if rsp is None:
                rsp = {}
            self.set_header("Content-Type", "application/json; charset=utf-8")
            self.set_header("Cache-Control", "no-store")
            self.write(json.dumps(rsp, ensure_ascii=False, default=str))
            self.finish()
        except tornado.web.Finish:
            return
        except Exception:
            logging.exception("[handler] uncaught error")
            if not self._finished:
                self.set_status(500)
                self.set_header("Content-Type", "application/json; charset=utf-8")
                self.write(json.dumps({"err": "exception", "msg": "工具执行失败，请查看运行日志"},
                                      ensure_ascii=False))
                self.finish()
        return

    return do


def auth(func):
    def do(self, *args, **kwargs):
        if not getattr(self, "current_user", None):
            return {"err": "user.need_login", "msg": "请先登录"}
        return func(self, *args, **kwargs)

    return do


def is_admin(func):
    def do(self, *args, **kwargs):
        if not getattr(self, "current_user", None):
            return {"err": "user.need_login", "msg": "请先登录"}
        if not getattr(self, "admin_user", None):
            return {"err": "permission.not_admin", "msg": "当前用户非管理员, 无权限操作"}
        return func(self, *args, **kwargs)

    return do


class BaseHandler(tornado.web.RequestHandler):
    def check_xsrf_cookie(self):
        # 内部接口不使用浏览器 Cookie/XSRF；鉴权由共享密钥完成。
        return

    def prepare(self):
        expected = runtime_secret()
        provided = self.request.headers.get("X-Mybooks-Runtime-Secret", "")
        if not expected or not hmac.compare_digest(str(provided), str(expected)):
            self.set_status(403)
            self.set_header("Content-Type", "application/json; charset=utf-8")
            self.finish(json.dumps({"err": "forbidden", "msg": "运行时鉴权失败"}, ensure_ascii=False))
            return
        user_id = str(self.request.headers.get("X-Mybooks-User-Id", "")).strip()
        # Mybooks 的设备会话 ID 是 UUID；Poxen 的 Reader ID 是整数。
        # 插件只把 current_user.id 当作上下文标识，不做数值运算。
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", user_id):
            self.set_status(401)
            self.set_header("Content-Type", "application/json; charset=utf-8")
            self.finish(json.dumps({"err": "user.need_login", "msg": "缺少用户上下文"}, ensure_ascii=False))
            return
        user = SimpleNamespace(id=user_id, name="admin", admin=True)
        self.current_user = user
        self.admin_user = user

    def get_current_user(self):
        return getattr(self, "_current_user", None)

    def user_id(self):
        user = getattr(self, "current_user", None)
        return getattr(user, "id", None) if user else None

    def is_admin(self):
        return bool(getattr(self, "admin_user", None))

    def write_error(self, status_code, **kwargs):
        self.set_header("Content-Type", "application/json; charset=utf-8")
        self.finish(json.dumps({"err": "http.%d" % status_code, "msg": "请求未能完成"},
                               ensure_ascii=False))
