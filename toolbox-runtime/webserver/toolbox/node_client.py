# -*- coding: utf-8 -*-
"""Node 内部 API 客户端。

Python runtime 通过共享卷内的 internal-secret 调用 Mybooks 的
/internal/toolbox/*；这些接口不经过用户会话，也不暴露给插件前端。
"""
import json
import logging
import os
import threading

import requests

from . import config, identity


class NodeError(RuntimeError):
    def __init__(self, code, message="", status=0):
        super(NodeError, self).__init__(message or code)
        self.code = code
        self.message = message or code
        self.status = status


class NodeClient(object):
    _lock = threading.Lock()
    _secret = None

    def __init__(self, tool_id=""):
        self.tool_id = str(tool_id or "")
        self.session = requests.Session()
        self.session.trust_env = False

    @classmethod
    def for_tool(cls, tool_id):
        return cls(tool_id)

    @classmethod
    def secret(cls):
        with cls._lock:
            if cls._secret:
                return cls._secret
            value = os.environ.get("MYBOOKS_TOOLBOX_INTERNAL_SECRET", "").strip()
            if not value:
                path = os.path.join(config.STATE_DIR, "internal-secret")
                try:
                    with open(path, "r", encoding="utf-8") as handle:
                        value = handle.read().strip()
                except OSError:
                    value = ""
            if not value:
                raise NodeError("INTERNAL_SECRET_MISSING", "Node 内部密钥尚未生成")
            cls._secret = value
            return value

    def _identity_headers(self):
        """按部署模式生成认证头。

        隔离模式（MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY）只用本插件令牌，绝不读取
        宿主共享 internal-secret；令牌缺失即失败，不允许退回共享密钥。
        """
        if not self.tool_id:
            raise NodeError("PLUGIN_IDENTITY_MISSING", "插件身份缺失，无法调用内部接口", 403)
        try:
            token = identity.token_for(self.tool_id)
        except identity.IdentityUnavailable as err:
            # 身份文件损坏/不可读时显式失败：不能让请求悄悄退回共享密钥模式。
            raise NodeError("PLUGIN_IDENTITY_UNAVAILABLE", str(err), 403) from err
        if not token:
            raise NodeError("PLUGIN_IDENTITY_MISSING", "插件身份令牌缺失", 403)
        return {
            "X-Mybooks-Plugin-Id": self.tool_id,
            "X-Mybooks-Plugin-Token": token,
        }

    def _request(self, method, path, payload=None, timeout=20):
        url = config.NODE_URL + path
        if config.plugin_auth_only():
            headers = self._identity_headers()
        else:
            headers = {"X-Toolbox-Internal-Secret": self.secret()}
            if self.tool_id:
                try:
                    token = identity.token_for(self.tool_id)
                except identity.IdentityUnavailable as err:
                    # 身份文件损坏/不可读时显式失败：不能让请求悄悄退回共享密钥模式。
                    raise NodeError("PLUGIN_IDENTITY_UNAVAILABLE", str(err), 403) from err
                if token:
                    headers["X-Mybooks-Plugin-Id"] = self.tool_id
                    headers["X-Mybooks-Plugin-Token"] = token
        try:
            if payload is None:
                response = self.session.request(method, url, headers=headers, timeout=timeout)
            else:
                headers["Content-Type"] = "application/json"
                response = self.session.request(
                    method, url, headers=headers, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    timeout=timeout)
        except requests.RequestException as err:
            raise NodeError("NODE_UNAVAILABLE", "无法连接 Mybooks 内部接口") from err
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code >= 400:
            raise NodeError(
                data.get("code") or "NODE_HTTP_%d" % response.status_code,
                data.get("error") or "Mybooks 内部接口返回 HTTP %d" % response.status_code,
                response.status_code,
            )
        return data

    def create_task(self, tool_id, operation="download", details=None, runtime_task_id=None):
        data = self._request("POST", "/internal/toolbox/tasks", {
            "tool_id": tool_id,
            "operation": operation,
            "details": details or {},
            "runtime_task_id": runtime_task_id,
        }, timeout=15)
        return int(data["task_id"])

    def update_task(self, task_id, patch):
        if not task_id:
            return None
        return self._request("PATCH", "/internal/toolbox/tasks/%d" % int(task_id), patch, timeout=15)["task"]

    def complete_task(self, task_id, status, error="", message="", result_book_id=None):
        return self.update_task(task_id, {
            "status": status,
            "error": error,
            "message": message,
            "result_book_id": result_book_id,
        })

    def task_message(self, task_id, message):
        if not task_id:
            return None
        try:
            return self._request("POST", "/internal/toolbox/tasks/%d/message" % int(task_id),
                                 {"message": message}, timeout=10)
        except NodeError as err:
            logging.warning("[NodeClient] task message failed: %s", err.code)
            return None

    def import_file(self, tool_id, task_id, file_path, title, authors):
        return self._request("POST", "/internal/toolbox/import", {
            "tool_id": tool_id,
            "task_id": task_id,
            "file_path": file_path,
            "title": title,
            "authors": authors or [],
        }, timeout=120)

    def get_metadata(self, book_id):
        books = self.books([int(book_id)])
        if not books:
            raise NodeError("BOOK_NOT_FOUND", "书籍不存在", 404)
        return books[0]

    def book_ids(self, query="", limit=100000):
        from urllib.parse import quote
        path = "/internal/toolbox/library/ids?limit=%d" % int(limit)
        if query:
            path += "&q=" + quote(str(query))
        return self._request("GET", path, timeout=30)["ids"]

    def books(self, ids):
        if not ids:
            return []
        joined = ",".join(str(int(book_id)) for book_id in ids)
        return self._request("GET", "/internal/toolbox/library/books?ids=" + joined, timeout=60)["books"]

    def search_books(self, query, limit=50):
        from urllib.parse import quote
        return self._request(
            "GET", "/internal/toolbox/library/books?q=%s&limit=%d" % (
                quote(str(query or "")), int(limit)), timeout=60)["books"]

    def fields(self, field, ids):
        from urllib.parse import quote
        joined = ",".join(str(int(book_id)) for book_id in ids)
        return self._request(
            "GET", "/internal/toolbox/library/fields?field=%s&ids=%s" % (
                quote(str(field)), joined), timeout=60)["values"]

    def export_file(self, tool_id, book_id, fmt):
        return self._request("POST", "/internal/toolbox/library/export", {
            "tool_id": tool_id,
            "book_id": int(book_id),
            "format": str(fmt),
        }, timeout=60)["file"]

    def cover(self, book_id):
        data = self._request("GET", "/internal/toolbox/library/cover/%d" % int(book_id), timeout=30)
        if not data.get("data"):
            return None
        import base64
        return base64.b64decode(data["data"])

    def set_metadata(self, book_id, fields):
        return self._request("POST", "/internal/toolbox/library/books/%d/metadata" % int(book_id),
                             fields, timeout=30)["metadata"]

    def delete_book(self, book_id):
        return self._request("POST", "/internal/toolbox/library/books/%d/delete" % int(book_id), {}, timeout=30)

    def merge_formats(self, source_id, target_id):
        return self._request("POST", "/internal/toolbox/library/books/%d/merge-formats" % int(source_id),
                             {"target_id": int(target_id)}, timeout=120)

    def create_item(self, book_id, user_id):
        return self._request("POST", "/internal/toolbox/library/items", {
            "book_id": int(book_id), "user_id": user_id,
        }, timeout=15)["item"]

    # -- Phase 4B：统一能力接口（供 mybooks_plugin_sdk 薄封装复用） ----------
    def request(self, method, path, payload=None, timeout=20):
        """公开的通用请求入口；参数与 _request 完全一致。"""
        return self._request(method, path, payload, timeout)

    def create_book(self, fields):
        payload = dict(fields or {})
        payload.setdefault("tool_id", self.tool_id)
        return self._request("POST", "/internal/toolbox/books", payload, timeout=30)["book"]

    def update_book(self, book_id, fields):
        payload = dict(fields or {})
        payload.setdefault("tool_id", self.tool_id)
        return self._request(
            "PATCH", "/internal/toolbox/books/%d" % int(book_id), payload, timeout=30)["book"]

    def reading_status(self, book_id):
        from urllib.parse import quote
        return self._request(
            "GET", "/internal/toolbox/books/%d/reading?tool_id=%s" % (
                int(book_id), quote(self.tool_id)), timeout=15)["reading"]

    def publish_artifact(self, task_id, file_path, fmt="", title="", sha256="", max_bytes=None):
        payload = {
            "tool_id": self.tool_id,
            "task_id": task_id,
            "path": file_path,
            "format": fmt,
            "title": title,
            "sha256": sha256,
        }
        if max_bytes is not None:
            payload["max_bytes"] = int(max_bytes)
        return self._request("POST", "/internal/toolbox/artifacts", payload, timeout=120)["artifact"]

    def get_artifact(self, artifact_id):
        from urllib.parse import quote
        return self._request(
            "GET", "/internal/toolbox/artifacts/%s?tool_id=%s" % (
                quote(str(artifact_id)), quote(self.tool_id)), timeout=15)["artifact"]

    def delete_artifact(self, artifact_id):
        from urllib.parse import quote
        return self._request(
            "DELETE", "/internal/toolbox/artifacts/%s?tool_id=%s" % (
                quote(str(artifact_id)), quote(self.tool_id)), timeout=15)

    def get_task(self, task_id):
        return self._request("GET", "/internal/toolbox/tasks/%d" % int(task_id), timeout=15)["task"]

    def task_result(self, task_id):
        return self._request("GET", "/internal/toolbox/tasks/%d/result" % int(task_id), timeout=30)["result"]

    def cancel_task(self, task_id):
        return self._request("POST", "/internal/toolbox/tasks/%d/cancel" % int(task_id), {}, timeout=30)

    def validate_config(self, values):
        return self._request("POST", "/internal/toolbox/config/validate", {
            "tool_id": self.tool_id,
            "values": values or {},
        }, timeout=15)

    def metadata_search(self, query="", isbn="", limit=20):
        payload = {"tool_id": self.tool_id, "limit": int(limit)}
        if isbn:
            payload["isbn"] = str(isbn)
        else:
            payload["query"] = str(query or "")
        return self._request("POST", "/internal/toolbox/metadata/search", payload, timeout=30)["candidates"]
