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

    def test_identity_absent_file_keeps_legacy(self):
        """确实没有 identities.json（旧部署）时才允许无身份请求。"""
        from webserver.toolbox import identity
        from webserver.toolbox.node_client import NodeClient

        path = Path(config.STATE_DIR) / "identities.json"
        path.unlink(missing_ok=True)
        identity.reset_cache()

        NodeClient.for_tool("fixture").book_ids()
        headers = _FakeNodeHandler.headers_seen[-1]
        self.assertIsNone(_header(headers, "x-mybooks-plugin-id"))
        self.assertIsNone(_header(headers, "x-mybooks-plugin-token"))

    def test_identity_env_token_is_scoped_to_plugin(self):
        """supervisor 注入的 MYBOOKS_PLUGIN_TOKEN 只对本子进程 tool_id 生效。"""
        from unittest import mock
        from webserver.toolbox import identity

        token = "c" * 48
        with mock.patch.dict(os.environ, {
            "MYBOOKS_PLUGIN_ID": "other_tool", "MYBOOKS_PLUGIN_TOKEN": token,
        }):
            identity.reset_cache()
            self.assertEqual(identity._env_token("fixture"), "")
            self.assertEqual(identity._env_token("other_tool"), token)

        with mock.patch.dict(os.environ, {
            "MYBOOKS_PLUGIN_ID": "fixture", "MYBOOKS_PLUGIN_TOKEN": token,
        }):
            identity.reset_cache()
            self.assertEqual(identity.token_for("fixture"), token)

    def test_identity_structure_invalid_fails_loud(self):
        """JSON 可解析但结构错误（tokens 为 null / 版本错误 / 非法令牌）必须显式失败。"""
        from webserver.toolbox import identity

        path = Path(config.STATE_DIR) / "identities.json"
        for document in (
            {"version": 1, "tokens": None},
            {"version": 2, "tokens": {}},
            {"version": 1, "tokens": {"fixture": "not-a-token"}},
            ["not", "an", "object"],
        ):
            path.write_text(json.dumps(document), encoding="utf-8")
            identity.reset_cache()
            with self.assertRaises(identity.IdentityUnavailable):
                identity.token_for("fixture")

    def test_identity_headers(self):
        from webserver.toolbox import identity
        from webserver.toolbox.node_client import NodeClient, NodeError

        token = "a" * 48
        path = Path(config.STATE_DIR) / "identities.json"
        path.write_text(json.dumps({"version": 1, "tokens": {"fixture": token}}), encoding="utf-8")
        identity.reset_cache()

        NodeClient.for_tool("fixture").book_ids()
        headers = _FakeNodeHandler.headers_seen[-1]
        self.assertEqual(_header(headers, "x-mybooks-plugin-id"), "fixture")
        self.assertEqual(_header(headers, "x-mybooks-plugin-token"), token)

        # 文件存在但没有该工具令牌：已安装插件不能悄悄退回 Legacy 协议。
        with self.assertRaises(NodeError) as raised:
            NodeClient.for_tool("unknown-tool").book_ids()
        self.assertEqual(raised.exception.code, "PLUGIN_IDENTITY_UNAVAILABLE")
        self.assertEqual(raised.exception.status, 403)


_CHILD_SCRIPT = (
    "import json, os\n"
    "from http.server import BaseHTTPRequestHandler, HTTPServer\n"
    "class H(BaseHTTPRequestHandler):\n"
    "    def do_GET(self):\n"
    "        if self.path.startswith('/internal/busy'):\n"
    "            payload = {'busy': False}\n"
    "        elif self.path.startswith('/healthz'):\n"
    "            payload = {'status': 'ok'}\n"
    "        elif self.path.startswith('/echo'):\n"
    "            payload = {\n"
    "                'path': self.path,\n"
    "                'header_secret': self.headers.get('X-Mybooks-Runtime-Secret', ''),\n"
    "                'env_secret': os.environ.get('MYBOOKS_TOOLBOX_RUNTIME_SECRET', ''),\n"
    "                'internal_env': os.environ.get('MYBOOKS_TOOLBOX_INTERNAL_SECRET', ''),\n"
    "                'plugin_id': os.environ.get('MYBOOKS_PLUGIN_ID', ''),\n"
    "                'has_plugin_token': bool(os.environ.get('MYBOOKS_PLUGIN_TOKEN')),\n"
    "                'plugin_token': os.environ.get('MYBOOKS_PLUGIN_TOKEN', ''),\n"
    "            }\n"
    "        else:\n"
    "            payload = {'path': self.path}\n"
    "        body = json.dumps(payload).encode('utf-8')\n"
    "        self.send_response(200)\n"
    "        self.send_header('Content-Type', 'application/json')\n"
    "        self.send_header('Content-Length', str(len(body)))\n"
    "        self.end_headers()\n"
    "        self.wfile.write(body)\n"
    "    def log_message(self, *args):\n"
    "        return\n"
    "HTTPServer(('127.0.0.1', int(os.environ['TOOLBOX_RUNTIME_PORT'])), H).serve_forever()\n"
)


class _SupervisorFixture(object):
    """共享的 supervisor 测试夹具：独立 state 文件 + 假子进程命令。"""

    def _setup_supervisor(self, name, tools):
        from webserver import supervisor as module

        self._module = module
        self.root = Path(_TMP) / name
        self.root.mkdir(parents=True, exist_ok=True)
        self.old_state = config.STATE_FILE
        config.STATE_FILE = str(self.root / "installed.json")
        Path(config.STATE_FILE).write_text(
            json.dumps({"version": 1, "tools": tools}), encoding="utf-8")
        from unittest import mock
        self._env = mock.patch.dict(os.environ, {
            "TOOLBOX_MAX_CHILDREN": "1",
            "TOOLBOX_CHILD_IDLE_SECONDS": "0",
        })
        self._env.start()
        self.supervisor = module.PluginSupervisor(child_command=[sys.executable, "-c", _CHILD_SCRIPT])
        return self.supervisor

    def _teardown_supervisor(self):
        try:
            self.supervisor.shutdown()
        finally:
            self._env.stop()
            config.STATE_FILE = self.old_state
            shutil.rmtree(self.root, ignore_errors=True)


class SupervisorTests(_SupervisorFixture, unittest.TestCase):
    TOOLS = [
        {"tool_id": "alpha", "revision": "1.0", "enabled": True},
        {"tool_id": "beta", "revision": "1.0", "enabled": True},
        {"tool_id": "off", "revision": "1.0", "enabled": False},
    ]

    def setUp(self):
        self._setup_supervisor("supervisor", list(self.TOOLS))

    def tearDown(self):
        self._teardown_supervisor()

    def test_reload_respects_capacity_and_marks_deferred(self):
        reports = self.supervisor.reload()
        self.assertEqual([item["tool_id"] for item in reports], ["alpha", "beta"])
        self.assertTrue(reports[0]["loaded"])
        self.assertTrue(reports[1]["deferred"])
        self.assertEqual(self.supervisor.deferred(), ["beta"])
        children = self.supervisor.summary()
        self.assertEqual([child["tool_id"] for child in children], ["alpha"])
        self.assertTrue(children[0]["online"])

    def test_proxy_lazily_starts_and_evicts_idle_child(self):
        import asyncio
        import tornado.httputil

        self.supervisor.reload()  # 先占用唯一名额
        request = types.SimpleNamespace(
            method="GET", uri="/tool/beta/ping", headers=tornado.httputil.HTTPHeaders(), body=None)
        response = asyncio.run(self.supervisor.proxy("beta", request))
        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.body.decode("utf-8"))["path"], "/tool/beta/ping")
        self.assertEqual([child["tool_id"] for child in self.supervisor.summary()], ["beta"])

    def test_unknown_and_disabled_tools_are_rejected(self):
        import asyncio

        for tool_id in ("off", "ghost"):
            with self.assertRaises(self._module.ChildNotFound):
                asyncio.run(self.supervisor.ensure_child(tool_id))

    def test_reload_with_invalid_state_never_raises(self):
        Path(config.STATE_FILE).write_text("{ not json", encoding="utf-8")
        reports = self.supervisor.reload()
        self.assertEqual(reports, [])
        self.assertEqual(self.supervisor.summary(), [])
        self.assertEqual(self.supervisor.deferred(), [])

        Path(config.STATE_FILE).write_text(
            json.dumps({"version": 1, "tools": "invalid"}), encoding="utf-8")
        self.assertEqual(self.supervisor.reload(), [])

    def test_crash_recovery_replaces_dead_child(self):
        import asyncio

        self.supervisor.reload()
        child = self.supervisor._children["alpha"]
        child.process.kill()
        child.process.wait(timeout=5)
        recovered = asyncio.run(self.supervisor.ensure_child("alpha"))
        self.assertTrue(recovered.alive())
        self.assertNotEqual(recovered.port, child.port)
        # 崩溃子进程的 stdout/stderr 必须被回收，避免长期运行泄漏文件句柄。
        self.assertTrue(child.process.stdout.closed)
        self.assertTrue(child.process.stderr.closed)

    def test_busy_child_blocks_eviction(self):
        import asyncio
        from unittest import mock

        self.supervisor.reload()
        with mock.patch.object(self.supervisor, "_is_busy", mock.AsyncMock(return_value=True)):
            with self.assertRaises(self._module.CapacityError):
                asyncio.run(self.supervisor.ensure_child("beta"))

        with mock.patch.object(self.supervisor, "_is_busy", mock.AsyncMock(return_value=False)):
            child = asyncio.run(self.supervisor.ensure_child("beta"))
        self.assertTrue(child.alive())
        self.assertNotIn("alpha", self.supervisor._children)

    def test_child_secret_and_token_are_isolated(self):
        import asyncio
        import tornado.httputil
        from unittest import mock

        token = "a" * 48
        identities = Path(config.STATE_DIR) / "identities.json"
        identities.parent.mkdir(parents=True, exist_ok=True)
        identities.write_text(json.dumps(
            {"version": 1, "tokens": {"alpha": token, "beta": "b" * 48}}), encoding="utf-8")
        try:
            with mock.patch.dict(os.environ, {
                "MYBOOKS_TOOLBOX_INTERNAL_SECRET": "host-internal",
                "MYBOOKS_TOOLBOX_RUNTIME_SECRET": "host-runtime",
            }):
                self.supervisor.reload()
                child = self.supervisor._children["alpha"]
                request = types.SimpleNamespace(
                    method="GET", uri="/echo",
                    headers=tornado.httputil.HTTPHeaders(
                        {"X-Mybooks-Runtime-Secret": "host-runtime"}),
                    body=None,
                )
                response = asyncio.run(self.supervisor.proxy("alpha", request))
            payload = json.loads(response.body.decode("utf-8"))
            self.assertNotEqual(child.secret, "host-runtime")
            self.assertEqual(payload["header_secret"], child.secret)
            self.assertEqual(payload["env_secret"], child.secret)
            self.assertEqual(payload["internal_env"], "")
            self.assertEqual(payload["plugin_id"], "alpha")
            self.assertEqual(payload["plugin_token"], token)
        finally:
            identities.unlink(missing_ok=True)

    def test_children_get_distinct_secrets(self):
        self.supervisor.max_children = 2
        self.supervisor.reload()
        children = [self.supervisor._children["alpha"], self.supervisor._children["beta"]]
        self.assertNotEqual(children[0].secret, children[1].secret)

    def test_concurrent_ensure_starts_only_one_child(self):
        import asyncio
        from unittest import mock

        self.supervisor.reload()
        self.supervisor.max_children = 2
        with mock.patch.object(self.supervisor, "_is_busy", mock.AsyncMock(return_value=False)):
            async def start_both():
                return await asyncio.gather(
                    self.supervisor.ensure_child("beta"),
                    self.supervisor.ensure_child("beta"))
            children = asyncio.run(start_both())
        self.assertIs(children[0], children[1])
        self.assertEqual(sorted(self.supervisor._children), ["alpha", "beta"])


class BusyHandlerTests(AsyncHTTPTestCase):
    def get_app(self):
        import runtime
        return runtime.make_app()

    def _busy(self):
        headers = {"X-Mybooks-Runtime-Secret": "unit-test-secret"}
        response = self.fetch("/internal/busy", headers=headers)
        self.assertEqual(response.code, 200)
        return json.loads(response.body)

    def test_busy_requires_runtime_secret(self):
        response = self.fetch("/internal/busy")
        self.assertEqual(response.code, 403)

    def test_busy_reflects_background_tasks(self):
        from webserver.services.background_service import BackgroundService

        self.assertFalse(self._busy()["busy"])
        service = BackgroundService()
        task = service.add_task("other", "busy-test")
        self.assertTrue(self._busy()["busy"])
        service.complete_task(task.id)
        self.assertFalse(self._busy()["busy"])


class SupervisorAppTests(_SupervisorFixture, AsyncHTTPTestCase):
    def setUp(self):
        self._setup_supervisor("supervisor-app", [
            {"tool_id": "alpha", "revision": "1.0", "enabled": True},
        ])
        super(SupervisorAppTests, self).setUp()

    def get_app(self):
        import runtime
        return runtime.make_supervisor_app(self.supervisor)

    def tearDown(self):
        super(SupervisorAppTests, self).tearDown()
        self._teardown_supervisor()

    def test_health_reload_and_proxy(self):
        payload = json.loads(self.fetch("/healthz").body)
        self.assertEqual(payload["status"], "ok")
        self.assertTrue(payload["isolated"])
        self.assertEqual(payload["children"], [])

        response = self.fetch("/internal/reload", method="POST", body="",
                              headers={"X-Mybooks-Runtime-Secret": "unit-test-secret"})
        self.assertEqual(response.code, 200)
        self.assertTrue(json.loads(response.body)["ok"])

        response = self.fetch("/tool/alpha/ping")
        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.body)["path"], "/tool/alpha/ping")

        response = self.fetch("/tool/ghost/ping")
        self.assertEqual(response.code, 404)
        self.assertEqual(json.loads(response.body)["err"], "tool.disabled")

    def test_start_stop_endpoints(self):
        headers = {"X-Mybooks-Runtime-Secret": "unit-test-secret"}
        self.supervisor.reload()

        self.assertEqual(self.fetch("/internal/start/alpha", method="POST", body="").code, 403)

        response = self.fetch("/internal/stop/alpha", method="POST", body="", headers=headers)
        self.assertEqual(response.code, 200)
        self.assertTrue(json.loads(response.body)["stopped"])
        self.assertEqual(self.supervisor.summary(), [])

        response = self.fetch("/internal/stop/alpha", method="POST", body="", headers=headers)
        self.assertFalse(json.loads(response.body)["stopped"])

        response = self.fetch("/internal/start/alpha", method="POST", body="", headers=headers)
        self.assertEqual(response.code, 200)
        self.assertTrue(json.loads(response.body)["ok"])
        self.assertEqual([child["tool_id"] for child in self.supervisor.summary()], ["alpha"])

        response = self.fetch("/internal/start/ghost", method="POST", body="", headers=headers)
        self.assertEqual(response.code, 404)


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
