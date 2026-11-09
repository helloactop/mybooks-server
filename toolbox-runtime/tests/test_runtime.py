# -*- coding: utf-8 -*-
"""Python Runtime 兼容层离线测试。

这些测试只覆盖宿主兼容层本身（storage / BackgroundService / AsyncService /
BaseHandler / PluginHost / NodeClient），不需要真实 Node、网络或第三方插件依赖。
真实插件加载与入库链路在仓库根目录的集成测试/验收记录中单独执行。
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import types
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_TMP = tempfile.mkdtemp(prefix="mybooks-runtime-test-")
os.environ["MYBOOKS_TOOLBOX_DIR"] = _TMP
os.environ["MYBOOKS_TOOLBOX_RUNTIME_SECRET"] = "unit-test-secret"
os.environ["MYBOOKS_NODE_INTERNAL_URL"] = "http://127.0.0.1:19099"
os.environ["TOOLBOX_ASYNC"] = "1"

from webserver.services import AsyncService  # noqa: E402
from webserver.services.background_service import BackgroundService, BackgroundTask  # noqa: E402
from webserver.toolbox import config, storage  # noqa: E402
from webserver.toolbox.plugin_host import PluginHost  # noqa: E402
from webserver.handlers.base import BaseHandler, is_admin, js  # noqa: E402
from tornado.testing import AsyncHTTPTestCase  # noqa: E402
from tornado.web import Application  # noqa: E402


class StorageTests(unittest.TestCase):
    def test_config_is_encrypted_and_roundtrips(self):
        tool_id = "storage_test"
        storage.set_config(tool_id, {"accounts": [{"key": "super-secret-value"}]})
        path = os.path.join(config.DATA_ROOT, tool_id, "config.json")
        raw = Path(path).read_text(encoding="utf-8")
        self.assertNotIn("super-secret-value", raw)
        self.assertIn("aes-256-gcm", raw)
        self.assertEqual(storage.get_config(tool_id)["accounts"][0]["key"], "super-secret-value")


class BackgroundServiceTests(unittest.TestCase):
    def test_mirror_supports_get_task_and_completion(self):
        service = BackgroundService()
        mirrored = service.register_mirror(991, "other", "fixture", progress_data={"total": 2})
        self.assertEqual(mirrored["id"], 991)
        self.assertEqual(service.get_task(991)["status"], BackgroundTask.STATUS_RUNNING)
        service.update_progress(991, 55, {"done": 1})
        self.assertEqual(service.get_task(991)["progress"], 55)
        service.complete_task(991)
        self.assertEqual(service.get_task(991)["status"], BackgroundTask.STATUS_COMPLETED)
        self.assertTrue(hasattr(BackgroundService, "_lock"))


class AsyncServiceTests(unittest.TestCase):
    def test_register_service_runs_on_worker(self):
        done = threading.Event()
        seen = []

        @AsyncService.register_service
        def job(instance, value):
            seen.append(value)
            done.set()

        job(AsyncService(), "ok")
        self.assertTrue(done.wait(2))
        self.assertEqual(seen, ["ok"])

    def test_register_function_stays_synchronous(self):
        @AsyncService.register_function
        def calc(instance, value):
            return value * 2

        self.assertEqual(calc(object(), 21), 42)


class PluginHostTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(_TMP) / "plugin-host"
        self.state_dir = self.root / "state"
        self.plugins = self.root / "plugins"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.plugins.mkdir(parents=True, exist_ok=True)
        self.old_root = config.TOOLBOX_ROOT
        self.old_plugins = config.PLUGINS_ROOT
        self.old_data = config.DATA_ROOT
        self.old_state = config.STATE_FILE
        config.TOOLBOX_ROOT = str(self.root)
        config.PLUGINS_ROOT = str(self.plugins)
        config.DATA_ROOT = str(self.root / "data")
        config.STATE_FILE = str(self.state_dir / "installed.json")
        storage.config.DATA_ROOT = config.DATA_ROOT
        self._write_fixture()

    def tearDown(self):
        config.TOOLBOX_ROOT = self.old_root
        config.PLUGINS_ROOT = self.old_plugins
        config.DATA_ROOT = self.old_data
        config.STATE_FILE = self.old_state
        storage.config.DATA_ROOT = self.old_data
        shutil.rmtree(self.root, ignore_errors=True)

    def _write_fixture(self):
        tool = self.plugins / "fixture"
        (tool / "backend").mkdir(parents=True, exist_ok=True)
        (tool / "frontend").mkdir(parents=True, exist_ok=True)
        (tool / "manifest.json").write_text(json.dumps({
            "tool_id": "fixture",
            "name": "Fixture",
            "description": "fixture",
            "revision": "1.0.0",
            "author": "QA",
            "core_api_version": "1.3.0",
            "entry_backend": "tool.FixtureTool",
            "entry_frontend": "index.html",
            "repo_url": "https://example.invalid",
            "api_routes": [{"path": "ping", "handler": "tool.PingHandler"}],
        }), encoding="utf-8")
        (tool / "backend" / "__init__.py").write_text("", encoding="utf-8")
        (tool / "backend" / "tool.py").write_text(
            "from webserver.toolbox.base_tool import BaseTool\n"
            "from webserver.handlers.base import BaseHandler, js, is_admin\n"
            "class FixtureTool(BaseTool):\n"
            "    @staticmethod\n"
            "    def info():\n"
            "        return {'tool_id': 'fixture', 'name': 'Fixture', 'revision': '1.0.0'}\n"
            "class PingHandler(BaseHandler):\n"
            "    @js\n"
            "    @is_admin\n"
            "    def get(self):\n"
            "        return {'err': 'ok', 'data': {'pong': True, 'user': self.user_id()}}\n",
            encoding="utf-8")
        (tool / "frontend" / "index.html").write_text("<!doctype html><title>fixture</title>", encoding="utf-8")
        (self.state_dir / "installed.json").write_text(json.dumps({"version": 1, "tools": [{
            "tool_id": "fixture", "revision": "1.0.0", "enabled": True,
            "install_path": "plugins/fixture",
        }]}), encoding="utf-8")

    def test_reload_and_route_registry(self):
        host = PluginHost()
        reports = host.reload()
        self.assertTrue(reports[0]["loaded"])
        self.assertIn("ping", host.get("fixture").routes)


class _FakeNodeHandler(BaseHTTPRequestHandler):
    calls = []
    headers_seen = []

    def do_GET(self):
        self.calls.append(("GET", self.path))
        self.headers_seen.append(dict(self.headers))
        if self.path.startswith("/internal/toolbox/library/ids"):
            payload = {"ok": True, "ids": [3, 1]}
        elif self.path.startswith("/internal/toolbox/library/books"):
            payload = {"ok": True, "books": [{"id": 1, "title": "T"}]}
        else:
            payload = {"ok": True}
        self._json(payload)

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        self.calls.append(("POST", self.path, body))
        self.headers_seen.append(dict(self.headers))
        if self.path.endswith("/export"):
            payload = {"ok": True, "file": {"path": "C:/tmp/book.epub", "size": 1, "sha256": "x"}}
        elif self.path.endswith("/metadata"):
            payload = {"ok": True, "metadata": {"id": 1, "tags": body.get("tags", [])}}
        else:
            payload = {"ok": True}
        self._json(payload)

    def _json(self, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        return


def _header(headers, name):
    for key, value in headers.items():
        if key.lower() == name:
            return value
    return None


class NodeClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 19099), _FakeNodeHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        secret_dir = Path(config.STATE_DIR)
        secret_dir.mkdir(parents=True, exist_ok=True)
        (secret_dir / "internal-secret").write_text("unit-test-internal\n", encoding="utf-8")
        os.environ["MYBOOKS_TOOLBOX_INTERNAL_SECRET"] = "unit-test-internal"
        from webserver.toolbox.node_client import NodeClient
        NodeClient._secret = None
        cls.client = NodeClient()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_library_calls(self):
        self.assertEqual(self.client.book_ids(), [3, 1])
        self.assertEqual(self.client.books([1])[0]["title"], "T")
        self.assertEqual(self.client.export_file("fixture", 1, "EPUB")["path"], "C:/tmp/book.epub")

    def test_identity_file_unreadable_fails_loud(self):
        """身份文件存在但损坏时必须显式失败，不能静默退回共享密钥模式。"""
        from webserver.toolbox import identity
        from webserver.toolbox.node_client import NodeClient, NodeError

        path = Path(config.STATE_DIR) / "identities.json"
        path.write_text("{ not json", encoding="utf-8")
        identity.reset_cache()

        with self.assertRaises(NodeError) as raised:
            NodeClient.for_tool("fixture").book_ids()
        self.assertEqual(raised.exception.code, "PLUGIN_IDENTITY_UNAVAILABLE")
        self.assertEqual(raised.exception.status, 403)

    def test_identity_permission_error_does_not_downgrade(self):
        """getmtime 抛出 PermissionError 时不能当作“文件不存在”。"""
        from unittest import mock
        from webserver.toolbox import identity

        identity.reset_cache()
        with mock.patch.object(identity.os.path, "getmtime", side_effect=PermissionError("denied")):
            with self.assertRaises(identity.IdentityUnavailable):
                identity.token_for("fixture")

    def test_identity_headers(self):
        from webserver.toolbox import identity
        from webserver.toolbox.node_client import NodeClient

        token = "a" * 48
        path = Path(config.STATE_DIR) / "identities.json"
        path.write_text(json.dumps({"version": 1, "tokens": {"fixture": token}}), encoding="utf-8")
        identity.reset_cache()

        NodeClient.for_tool("fixture").book_ids()
        headers = _FakeNodeHandler.headers_seen[-1]
        self.assertEqual(_header(headers, "x-mybooks-plugin-id"), "fixture")
        self.assertEqual(_header(headers, "x-mybooks-plugin-token"), token)

        NodeClient.for_tool("unknown-tool").book_ids()
        headers = _FakeNodeHandler.headers_seen[-1]
        self.assertIsNone(_header(headers, "x-mybooks-plugin-id"))
        self.assertIsNone(_header(headers, "x-mybooks-plugin-token"))


class _PingHandler(BaseHandler):
    @js
    @is_admin
    def get(self):
        return {"err": "ok", "data": {"user": self.user_id(), "admin": self.is_admin()}}


class BaseHandlerAuthTests(AsyncHTTPTestCase):
    def get_app(self):
        return Application([(r"/ping", _PingHandler)])

    def test_requires_runtime_secret(self):
        response = self.fetch("/ping", headers={"X-Mybooks-User-Id": "uuid-user"})
        self.assertEqual(response.code, 403)

    def test_accepts_uuid_user(self):
        response = self.fetch("/ping", headers={
            "X-Mybooks-Runtime-Secret": "unit-test-secret",
            "X-Mybooks-User-Id": "8d766bfe-cbe6-4a3c-99f5-4f720df6327d",
        })
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertTrue(data["data"]["admin"])
        self.assertEqual(data["data"]["user"], "8d766bfe-cbe6-4a3c-99f5-4f720df6327d")

    def test_requires_user_context(self):
        response = self.fetch("/ping", headers={"X-Mybooks-Runtime-Secret": "unit-test-secret"})
        self.assertEqual(response.code, 401)


if __name__ == "__main__":
    unittest.main()
