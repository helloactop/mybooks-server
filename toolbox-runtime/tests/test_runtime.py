# -*- coding: utf-8 -*-
"""Python Runtime 兼容层离线测试。

这些测试只覆盖宿主兼容层本身（storage / BackgroundService / AsyncService /
BaseHandler / PluginHost / NodeClient），不需要真实 Node、网络或第三方插件依赖。
真实插件加载与入库链路在仓库根目录的集成测试/验收记录中单独执行。
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

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

    def test_work_dir_is_traversable_but_tool_root_is_not_listable(self):
        import stat

        if os.name != "posix":
            self.skipTest("POSIX 权限语义")
        tool_id = "storage_perms"
        path = storage.get_work_dir(tool_id, "token-1")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(config.DATA_ROOT, tool_id)).st_mode), 0o711)


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


class NodeClientAuthOnlyTests(unittest.TestCase):
    """隔离模式：NodeClient 只用每插件令牌，绝不读取共享 internal-secret。"""

    @classmethod
    def setUpClass(cls):
        from http.server import HTTPServer
        _FakeNodeHandler.headers_seen.clear()
        cls.server = HTTPServer(("127.0.0.1", 19097), _FakeNodeHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:19097"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        from unittest import mock
        from webserver.toolbox import identity
        from webserver.toolbox.node_client import NodeClient

        _FakeNodeHandler.headers_seen.clear()
        patcher = mock.patch.object(config, "NODE_URL", self.base_url)
        patcher.start()
        self.addCleanup(patcher.stop)
        NodeClient._secret = None
        identity.reset_cache()
        token = "d" * 48
        path = Path(config.STATE_DIR) / "identities.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": 1, "tokens": {"fixture": token}}), encoding="utf-8")
        self.token = token
        secret_path = Path(config.STATE_DIR) / "internal-secret"
        if not secret_path.exists():
            secret_path.write_text("f" * 48, encoding="utf-8")

    def test_auth_only_uses_plugin_token_without_shared_secret(self):
        from unittest import mock
        from webserver.toolbox.node_client import NodeClient

        secret_path = Path(config.STATE_DIR) / "internal-secret"
        backup = secret_path.read_text(encoding="utf-8") if secret_path.exists() else None
        secret_path.unlink(missing_ok=True)
        try:
            with mock.patch.dict(os.environ, {"MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY": "1"}):
                NodeClient.for_tool("fixture").book_ids()
        finally:
            if backup is not None:
                secret_path.write_text(backup, encoding="utf-8")

        headers = _FakeNodeHandler.headers_seen[-1]
        self.assertEqual(_header(headers, "x-mybooks-plugin-id"), "fixture")
        self.assertEqual(_header(headers, "x-mybooks-plugin-token"), self.token)
        self.assertIsNone(_header(headers, "x-toolbox-internal-secret"))

    def test_auth_only_missing_token_fails_without_request(self):
        from unittest import mock
        from webserver.toolbox import identity
        from webserver.toolbox.node_client import NodeClient, NodeError

        (Path(config.STATE_DIR) / "identities.json").unlink(missing_ok=True)
        identity.reset_cache()
        with mock.patch.dict(os.environ, {
            "MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY": "1",
            "MYBOOKS_PLUGIN_ID": "", "MYBOOKS_PLUGIN_TOKEN": "",
        }):
            NodeClient._secret = None
            with self.assertRaises(NodeError) as raised:
                NodeClient.for_tool("fixture").book_ids()
        self.assertEqual(raised.exception.code, "PLUGIN_IDENTITY_MISSING")
        self.assertEqual(raised.exception.status, 403)
        self.assertEqual(len(_FakeNodeHandler.headers_seen), 0, "缺令牌不应发出请求")

    def test_legacy_mode_still_sends_shared_secret(self):
        from unittest import mock
        from webserver.toolbox.node_client import NodeClient

        with mock.patch.dict(os.environ, {"MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY": "0"}):
            NodeClient.for_tool("fixture").book_ids()
        headers = _FakeNodeHandler.headers_seen[-1]
        self.assertIsNotNone(_header(headers, "x-toolbox-internal-secret"))
        self.assertEqual(_header(headers, "x-mybooks-plugin-token"), self.token)


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
    "                'auth_only': os.environ.get('MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY', ''),\n"
    "                'data_dir': os.environ.get('MYBOOKS_TOOL_DATA_DIR', ''),\n"
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
        self.old_data_root = config.DATA_ROOT
        config.DATA_ROOT = str(self.root / "data")
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
            config.DATA_ROOT = self.old_data_root
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

    def test_child_uid_disabled_by_default_and_stable_when_enabled(self):
        self.assertEqual(self.supervisor._child_uid("alpha"), 0)

        self.supervisor.child_uid_base = 2000
        self.supervisor._uid_registry = self._module.UidRegistry(
            str(self.root / "uid-map.json"), 2000, 8)
        first = self.supervisor._child_uid("alpha")
        self.assertGreaterEqual(first, 2000)
        self.assertLess(first, 2008)
        self.assertEqual(first, self.supervisor._child_uid("alpha"), "同一插件 UID 必须稳定")
        self.assertNotEqual(first, self.supervisor._child_uid("beta"), "不同插件不得共用 UID")

    def test_private_data_dir_is_owner_only(self):
        import stat

        path = self.supervisor._prepare_tool_data("alpha", 0)
        self.assertTrue(Path(path).is_dir())
        if os.name == "posix":
            # 0711：宿主 Node 可以穿透读取产物，但无法列举插件私有目录。
            mode = stat.S_IMODE(os.stat(path).st_mode)
            self.assertEqual(mode, 0o711)

    def test_inject_data_key_bootstraps_missing_file_for_private_uid(self):
        """独立 UID 下子进程无法写 state/：supervisor 必须先生成并复用配置密钥。"""
        import base64
        import stat
        from unittest import mock

        state_dir = self.root / "state"
        state_dir.mkdir(parents=True, exist_ok=True)
        # 源数据目录布局与真实部署一致：state 目录对子进程只读。
        self.supervisor.child_uid_base = 2000
        with mock.patch.object(config, "STATE_DIR", str(state_dir)):
            if os.name == "posix":
                os.chmod(state_dir, 0o755)
            env = {}
            self.supervisor._inject_data_key(env)
            value = env.get("MYBOOKS_TOOLBOX_DATA_KEY", "")
            self.assertEqual(len(base64.b64decode(value)), 32)
            key_file = state_dir / "config.key"
            self.assertTrue(key_file.is_file())
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(os.stat(key_file).st_mode), 0o600)
            # 第二个子进程必须复用同一密钥，否则配置互相解不开。
            again = {}
            self.supervisor._inject_data_key(again)
            self.assertEqual(again.get("MYBOOKS_TOOLBOX_DATA_KEY"), value)

    def test_private_uid_mode_does_not_inject_key_when_disabled(self):
        from unittest import mock

        state_dir = self.root / "state-off"
        state_dir.mkdir(parents=True, exist_ok=True)
        with mock.patch.object(config, "STATE_DIR", str(state_dir)):
            env = {}
            self.supervisor._inject_data_key(env)
            self.assertNotIn("MYBOOKS_TOOLBOX_DATA_KEY", env)
            self.assertFalse((state_dir / "config.key").exists())

    def test_terminate_closes_pipes_after_child_exits(self):
        class Stream:
            closed = False

            def close(self):
                self.closed = True

        class Process:
            pid = 4242
            stdout = Stream()
            stderr = Stream()
            state = None

            def poll(self):
                return self.state

            def terminate(self):
                self.state = 0

            def kill(self):
                self.state = -9

            def wait(self, timeout=None):
                return self.state

        process = Process()
        self.supervisor._terminate(process)
        self.assertTrue(process.stdout.closed)
        self.assertTrue(process.stderr.closed)

    def test_terminate_never_closes_pipes_of_a_live_untouchable_child(self):
        """没有 CAP_KILL 时终止失败也不能 close 管道，否则会卡死 supervisor。"""
        events = []

        class Stream:
            def close(self):
                events.append("close")

        class Process:
            pid = 4243
            stdout = Stream()
            stderr = Stream()

            def poll(self):
                return None

            def terminate(self):
                raise PermissionError("operation not permitted")

            def kill(self):
                raise PermissionError("operation not permitted")

            def wait(self, timeout=None):
                raise AssertionError("wait 不应在发信号失败后调用")

        self.supervisor._terminate(Process())
        self.assertEqual(events, [])

    def test_spawn_injects_plugin_auth_only_and_private_data_dir(self):
        import asyncio
        import tornado.httputil
        from unittest import mock

        token = "e" * 48
        identities = Path(config.STATE_DIR) / "identities.json"
        identities.parent.mkdir(parents=True, exist_ok=True)
        identities.write_text(json.dumps({"version": 1, "tokens": {"alpha": token}}), encoding="utf-8")
        try:
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY", None)
                self.supervisor.reload()
                request = types.SimpleNamespace(
                    method="GET", uri="/echo",
                    headers=tornado.httputil.HTTPHeaders(), body=None)
                response = asyncio.run(self.supervisor.proxy("alpha", request))
            payload = json.loads(response.body.decode("utf-8"))
            self.assertEqual(payload["auth_only"], "1", "隔离模式默认只认插件令牌")
            self.assertEqual(payload["plugin_id"], "alpha")
            self.assertEqual(payload["plugin_token"], token)
            self.assertTrue(payload["data_dir"].endswith(os.path.join("data", "alpha")))
            self.assertTrue(Path(payload["data_dir"]).is_dir())
        finally:
            identities.unlink(missing_ok=True)

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
        # 部署核对字段：两侧开关 + 真实生效的 UID 隔离状态。
        self.assertIn("plugin_auth_only", payload)
        self.assertIn("node_plugin_auth_only", payload)
        self.assertFalse(payload["uid_isolation"]["uid_enabled"])

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


class UidRegistryTests(unittest.TestCase):
    """持久化、无冲突的 UID 分配（Phase 3g.1）。"""

    def setUp(self):
        from webserver import supervisor as module

        self.module = module
        self.root = Path(tempfile.mkdtemp(prefix="mybooks-uid-reg-", dir=_TMP))
        self.path = str(self.root / "uid-map.json")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _registry(self, base=3000, count=8):
        return self.module.UidRegistry(self.path, base, count)

    def test_allocates_unique_stable_uids_and_persists(self):
        registry = self._registry()
        tool_ids = ["tool_%02d" % index for index in range(8)]
        assigned = [registry.allocate(tool_id) for tool_id in tool_ids]
        self.assertEqual(len(set(assigned)), len(tool_ids), "同一池内不得出现重复 UID")
        self.assertEqual(sorted(assigned), list(range(3000, 3008)))
        # 重启（新实例读同一文件）后同一插件仍是同一 UID。
        reopened = self._registry()
        for tool_id, uid in zip(tool_ids, assigned):
            self.assertEqual(reopened.allocate(tool_id), uid)
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)

    def test_pool_exhaustion_fails_loud(self):
        registry = self._registry(count=2)
        registry.allocate("alpha")
        registry.allocate("beta")
        with self.assertRaises(self.module.IsolationError) as ctx:
            registry.allocate("gamma")
        self.assertIn("池已耗尽", str(ctx.exception))

    def test_corrupted_registry_with_duplicate_uids_fails_closed(self):
        Path(self.path).write_text(json.dumps({
            "version": 1, "base": 3000,
            "assignments": {"alpha": 3000, "beta": 3000},
        }), encoding="utf-8")
        with self.assertRaises(self.module.IsolationError) as ctx:
            self._registry().allocate("gamma")
        self.assertIn("冲突", str(ctx.exception))

    def test_corrupted_registry_json_fails_closed(self):
        Path(self.path).write_text("{not json", encoding="utf-8")
        with self.assertRaises(self.module.IsolationError) as ctx:
            self._registry().allocate("gamma")
        self.assertIn("无法读取", str(ctx.exception))

    def test_historical_owner_uid_is_adopted(self):
        data_root = self.root / "data"
        (data_root / "alpha").mkdir(parents=True)
        registry = self._registry()
        # 非 root 无法真的创建别的属主，替换探测函数模拟 Phase 3g 的哈希 UID。
        registry._owner_uid = lambda path: 3005
        alpha = registry.allocate("alpha", installed_ids={"alpha"}, data_root=str(data_root))
        self.assertEqual(alpha, 3005, "历史数据目录的属主 UID 应被采纳，避免不必要的迁移")
        beta = registry.allocate("beta", installed_ids={"alpha", "beta"}, data_root=str(data_root))
        self.assertNotEqual(beta, alpha)

    def test_duplicate_historical_owners_are_never_shared(self):
        data_root = self.root / "data"
        (data_root / "alpha").mkdir(parents=True)
        (data_root / "beta").mkdir(parents=True)
        registry = self._registry()
        registry._owner_uid = lambda path: 3005
        alpha = registry.allocate("alpha", data_root=str(data_root))
        beta = registry.allocate("beta", data_root=str(data_root))
        self.assertEqual(alpha, 3005)
        self.assertNotEqual(beta, 3005, "历史 UID 冲突时后一个插件必须换 UID")

    def test_uninstalled_uid_is_reclaimed_only_after_data_removed(self):
        data_root = self.root / "data"
        (data_root / "alpha").mkdir(parents=True)
        (data_root / "beta").mkdir(parents=True)
        registry = self._registry(count=4)
        registry._owner_uid = lambda path: 1000  # 不在池区间，不参与采纳
        registry.allocate("alpha", installed_ids={"alpha", "beta"}, data_root=str(data_root))
        beta = registry.allocate("beta", installed_ids={"alpha", "beta"}, data_root=str(data_root))
        gamma = registry.allocate("gamma", installed_ids={"alpha", "gamma"}, data_root=str(data_root))
        self.assertNotEqual(gamma, beta, "数据还在时不能把已卸载插件的 UID 让给别人")

        shutil.rmtree(data_root / "beta")
        reopened = self._registry(count=4)
        reopened.reconcile(installed_ids={"alpha", "gamma"}, data_root=str(data_root))
        self.assertNotIn("beta", reopened.snapshot()["assignments"],
                         "数据已清理的已卸载插件应释放 UID")


class IsolationConfigTests(unittest.TestCase):
    """启用独立 UID 但环境不满足时必须显式失败（fail-closed）。"""

    def setUp(self):
        from webserver import supervisor as module

        self.module = module
        self.root = Path(tempfile.mkdtemp(prefix="mybooks-isolation-", dir=_TMP))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _build(self, **env):
        with mock.patch.dict(os.environ, env):
            return self.module.PluginSupervisor(child_command=[sys.executable, "-c", "pass"])

    def test_uid_mode_without_root_fails_loud(self):
        if os.name != "posix":
            self.skipTest("独立 UID 仅 POSIX")
        with mock.patch.object(self.module.os, "geteuid", return_value=1000, create=True):
            with self.assertRaises(self.module.IsolationError) as ctx:
                self._build(TOOLBOX_CHILD_UID_BASE="2000")
        message = str(ctx.exception)
        self.assertIn("root", message)
        self.assertIn("不会退回共享 UID", message)

    def test_missing_capabilities_fail_loud(self):
        if os.name != "posix":
            self.skipTest("capabilities 仅 Linux")
        with mock.patch.object(self.module.os, "geteuid", return_value=0, create=True), \
                mock.patch.object(self.module, "missing_capabilities", return_value=["CAP_SETUID"]):
            with self.assertRaises(self.module.IsolationError) as ctx:
                self._build(TOOLBOX_CHILD_UID_BASE="2000")
        self.assertIn("CAP_SETUID", str(ctx.exception))

    def test_missing_capability_parser(self):
        path = self.root / "status"
        # CapEff=0xa0：只有 bit5(CAP_KILL) 与 bit7(CAP_SETUID)
        path.write_text("Name:\tpython\nCapEff:\t00000000000000a0\n", encoding="utf-8")
        missing = self.module.missing_capabilities(str(path))
        self.assertEqual(sorted(missing),
                         ["CAP_CHOWN", "CAP_DAC_OVERRIDE", "CAP_FOWNER", "CAP_FSETID", "CAP_SETGID"])

    def test_valid_uid_mode_initializes_persistent_registry(self):
        if os.name != "posix":
            self.skipTest("独立 UID 仅 POSIX")
        with mock.patch.object(self.module.os, "geteuid", return_value=0, create=True), \
                mock.patch.object(self.module, "missing_capabilities", return_value=[]), \
                mock.patch.object(config, "STATE_DIR", str(self.root / "state")):
            supervisor = self._build(TOOLBOX_CHILD_UID_BASE="4000")
            # isolation_status 会重新探测 capabilities，必须在 mock 生效期间调用，
            # 否则在无 capability 的测试容器里结果取决于运行用户。
            status = supervisor.isolation_status()
        self.assertIsNotNone(supervisor._uid_registry)
        self.assertTrue(status["uid_enabled"])
        self.assertEqual(status["uid_base"], 4000)
        self.assertEqual(status["missing_capabilities"], [])

    def test_uid_mode_never_silently_returns_zero(self):
        supervisor = self._build()
        supervisor.child_uid_base = 2000
        supervisor._uid_registry = None
        with self.assertRaises(self.module.IsolationError):
            supervisor._child_uid("alpha")


class PopenOptionsTests(unittest.TestCase):
    """多线程 supervisor 不得使用 preexec_fn。"""

    def setUp(self):
        from webserver import supervisor as module

        self.module = module
        self.supervisor = module.PluginSupervisor(child_command=[sys.executable, "-c", "pass"])

    def test_uid_mode_uses_popen_user_parameters(self):
        if os.name != "posix":
            with self.assertRaises(self.module.IsolationError):
                self.supervisor._popen_options(2077, {})
            return
        options = self.supervisor._popen_options(2077, {})
        self.assertEqual(options["user"], 2077)
        self.assertEqual(options["group"], 2077)
        self.assertEqual(options["extra_groups"], [])
        self.assertEqual(options["umask"], 0o027)
        self.assertNotIn("preexec_fn", options)
        self.assertTrue(options["start_new_session"])

    def test_shared_mode_keeps_legacy_options(self):
        options = self.supervisor._popen_options(0, {})
        self.assertNotIn("user", options)
        self.assertNotIn("group", options)
        self.assertNotIn("extra_groups", options)
        self.assertNotIn("preexec_fn", options)


class PrivateDataTests(unittest.TestCase):
    """独立 UID 下的数据目录权限与失败行为。"""

    def setUp(self):
        from webserver import supervisor as module

        self.module = module
        self.root = Path(tempfile.mkdtemp(prefix="mybooks-private-", dir=_TMP))
        self.old_data_root = config.DATA_ROOT
        config.DATA_ROOT = str(self.root / "data")
        self.supervisor = module.PluginSupervisor(child_command=[sys.executable, "-c", "pass"])

    def tearDown(self):
        config.DATA_ROOT = self.old_data_root
        shutil.rmtree(self.root, ignore_errors=True)

    def test_private_layout_is_group_deliverable_not_world_readable(self):
        if os.name != "posix":
            self.skipTest("POSIX 权限语义")
        data_root = Path(config.DATA_ROOT)
        work = data_root / "alpha" / "abc123"
        work.mkdir(parents=True)
        (work / "book.epub").write_bytes(b"epub")
        (data_root / "alpha" / "config.json").write_text("{}", encoding="utf-8")
        calls = []

        def fake_chown(*args, **kwargs):
            calls.append((args, kwargs))

        with mock.patch.object(os, "chown", side_effect=fake_chown):
            self.supervisor._prepare_tool_data("alpha", 2077)
        self.assertEqual(stat.S_IMODE(os.stat(data_root / "alpha").st_mode), 0o2710)
        self.assertEqual(stat.S_IMODE(os.stat(work).st_mode), 0o2750)
        self.assertEqual(stat.S_IMODE(os.stat(work / "book.epub").st_mode), 0o640)
        self.assertEqual(stat.S_IMODE(os.stat(data_root / "alpha" / "config.json").st_mode), 0o600)
        self.assertTrue(any(len(args) >= 3 and args[2] == config.host_gid() for args, _ in calls),
                        "目录/文件必须改到宿主属组，Node 才能按组读取产物")

    def test_chown_failure_raises_clear_error(self):
        if os.name != "posix":
            self.skipTest("POSIX 权限语义")
        with mock.patch.object(os, "chown", side_effect=PermissionError("operation not permitted")):
            with self.assertRaises(self.module.IsolationError) as ctx:
                self.supervisor._prepare_tool_data("beta", 2078)
        self.assertIn("CHOWN", str(ctx.exception))

    def test_storage_uses_private_modes_when_enabled(self):
        if os.name != "posix":
            self.skipTest("POSIX 权限语义")
        tool_id = "private_storage"
        root = Path(config.DATA_ROOT) / tool_id
        root.mkdir(parents=True, exist_ok=True)
        os.chmod(root, 0o2710)
        with mock.patch.dict(os.environ, {"MYBOOKS_TOOLBOX_PRIVATE_DATA": "1"}):
            work = storage.get_work_dir(tool_id, "token-1")
            self.assertEqual(stat.S_IMODE(os.stat(work).st_mode), 0o2750)
            # 插件进程没有 CAP_FSETID：不能因为 tool_root 的 chmod 把 setgid 清掉。
            self.assertEqual(stat.S_IMODE(os.stat(root).st_mode), 0o2710)


class ModeConsistencyTests(unittest.TestCase):
    """Node 与 Python 的 MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY 必须一致。"""

    def setUp(self):
        from webserver import supervisor as module

        self.module = module
        self.root = Path(tempfile.mkdtemp(prefix="mybooks-mode-", dir=_TMP))
        self.state_dir = self.root / "state"
        self.state_dir.mkdir()
        self._state_patch = mock.patch.object(config, "STATE_DIR", str(self.state_dir))
        self._state_patch.start()
        self.supervisor = module.PluginSupervisor(child_command=[sys.executable, "-c", "pass"])

    def tearDown(self):
        self._state_patch.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def _write_mode(self, value):
        (self.state_dir / "runtime-mode.json").write_text(
            json.dumps({"version": 1, "plugin_auth_only": value}), encoding="utf-8")

    def test_matching_mode_passes(self):
        self._write_mode(False)
        with mock.patch.dict(os.environ, {"MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY": "false"}):
            self.supervisor._check_mode_consistency()

    def test_mismatched_mode_fails_loud(self):
        self._write_mode(True)
        with mock.patch.dict(os.environ, {"MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY": "false"}):
            with self.assertRaises(self.module.ModeMismatchError) as ctx:
                self.supervisor._check_mode_consistency()
        self.assertIn("部署配置不一致", str(ctx.exception))

    def test_missing_or_corrupt_mode_file_is_tolerated(self):
        self.supervisor._check_mode_consistency()
        (self.state_dir / "runtime-mode.json").write_text("{not json", encoding="utf-8")
        self.supervisor._check_mode_consistency()


@unittest.skipUnless(sys.platform.startswith("linux") and Path("/bin/sh").exists(), "需要 Linux shell")
class MemoryLimitTests(unittest.TestCase):
    """验证 ulimit 真的生效，而不是“配置了就算验证过”。"""

    def setUp(self):
        from webserver import supervisor as module

        self.module = module
        self.supervisor = module.PluginSupervisor(child_command=[sys.executable, "-c", "pass"])

    def test_ulimit_really_sets_rlimit_as(self):
        self.supervisor.memory_mb = 128
        command = self.supervisor._limited_command([
            sys.executable, "-c",
            "import json, resource; print(json.dumps(resource.getrlimit(resource.RLIMIT_AS)))",
        ])
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        soft, _hard = json.loads(result.stdout.strip())
        self.assertEqual(soft, 128 * 1024 * 1024)

    def test_memory_limit_blocks_oversized_allocation(self):
        self.supervisor.memory_mb = 128
        command = self.supervisor._limited_command([
            sys.executable, "-c", "block = bytearray(512 * 1024 * 1024); print('allocated')",
        ])
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("allocated", result.stdout)
        self.assertIn("MemoryError", result.stderr)


_IS_ROOT_POSIX = os.name == "posix" and hasattr(os, "geteuid") and os.geteuid() == 0


@unittest.skipUnless(_IS_ROOT_POSIX, "需要 root 才能创建不同属主（Docker 容器内执行）")
class CrossPluginReadTests(unittest.TestCase):
    """跨插件文件读取：其他插件 UID 不可读，宿主属组可读。"""

    def setUp(self):
        from webserver import supervisor as module

        self.module = module
        self.root = Path(tempfile.mkdtemp(prefix="mybooks-cross-", dir=_TMP))
        self.old_data_root = config.DATA_ROOT
        config.DATA_ROOT = str(self.root / "data")
        self.supervisor = module.PluginSupervisor(child_command=[sys.executable, "-c", "pass"])

    def tearDown(self):
        config.DATA_ROOT = self.old_data_root
        shutil.rmtree(self.root, ignore_errors=True)

    def test_other_plugin_cannot_read_work_artifact_but_host_group_can(self):
        work = Path(config.DATA_ROOT) / "alpha" / "work1"
        work.mkdir(parents=True)
        artifact = work / "book.epub"
        artifact.write_bytes(b"secret")
        self.supervisor._prepare_tool_data("alpha", 3001)

        denied = subprocess.run(
            ["/bin/sh", "-c", "cat %s" % artifact], user=3002, group=3002,
            extra_groups=[], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertNotEqual(denied.returncode, 0, "其他插件 UID 不能读 work 产物")
        self.assertIn("Permission denied", denied.stderr)

        allowed = subprocess.run(
            ["/bin/sh", "-c", "cat %s" % artifact], user=3002, group=config.host_gid(),
            extra_groups=[], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        self.assertEqual(allowed.stdout, "secret", "宿主属组必须能读取产物以完成入库")


if __name__ == "__main__":
    unittest.main()
