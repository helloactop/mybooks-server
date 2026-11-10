# -*- coding: utf-8 -*-
"""配置桥的插件身份边界测试。

背景：隔离模式下每个插件子进程持有自己的 runtime-secret，但子进程同样注册了
/internal/tool/<id>/config。若 handler 只校验 secret 而不校验“进程绑定的插件”，
插件 A 就能用自己的 secret 读取或改写插件 B 的加密配置。

修复：绑定信息在 create_app 时固化为 handler 参数（子进程 = TOOLBOX_ONLY_TOOL，
Supervisor/共享宿主 = 空），请求目标必须与绑定一致。
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 与 test_runtime 保持一致：先固定测试用路径与 Node 内部地址，
# 避免按文件名字母序导入时把默认端口（3000）缓存下来。
_TMP = tempfile.mkdtemp(prefix="mybooks-config-identity-")
os.environ.setdefault("MYBOOKS_TOOLBOX_DIR", _TMP)
os.environ.setdefault("MYBOOKS_TOOLBOX_RUNTIME_SECRET", "unit-test-secret")
os.environ.setdefault("MYBOOKS_NODE_INTERNAL_URL", "http://127.0.0.1:19099")

from tornado.testing import AsyncHTTPTestCase  # noqa: E402

from webserver.toolbox import storage  # noqa: E402

SECRET = os.environ["MYBOOKS_TOOLBOX_RUNTIME_SECRET"]
HEADERS = {"X-Mybooks-Runtime-Secret": SECRET}


def seed():
    storage.set_config("plugin_alpha", {"api_key": "alpha-secret", "theme": "light"})
    storage.set_config("plugin_beta", {"api_key": "beta-secret", "theme": "dark"})


class _BaseConfigHttp(AsyncHTTPTestCase):
    def _get(self, tool_id, headers=None):
        return self.fetch("/internal/tool/%s/config" % tool_id, headers=HEADERS if headers is None else headers)

    def _put(self, tool_id, body, headers=None):
        return self.fetch(
            "/internal/tool/%s/config" % tool_id,
            method="PUT",
            headers=HEADERS if headers is None else headers,
            body=json.dumps(body),
        )


class ChildProcessAppTests(_BaseConfigHttp):
    """模拟插件子进程：应用启动时绑定 plugin_alpha。"""

    def setUp(self):
        os.environ["TOOLBOX_ONLY_TOOL"] = "plugin_alpha"
        try:
            super(ChildProcessAppTests, self).setUp()
            seed()
        finally:
            os.environ.pop("TOOLBOX_ONLY_TOOL", None)

    @staticmethod
    def get_app():
        # 环境变量只在创建 app 时读一次，运行时修改 os.environ 不会解除绑定。
        import runtime
        return runtime.make_app()

    def test_child_process_can_read_own_config(self):
        response = self._get("plugin_alpha")
        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.body)["config"]["api_key"], "alpha-secret")

    def test_child_process_cannot_read_other_plugin_config(self):
        response = self._get("plugin_beta")
        self.assertEqual(response.code, 403)
        self.assertEqual(json.loads(response.body)["code"], "CROSS_PLUGIN_DENIED")
        self.assertNotIn(b"beta-secret", response.body)

    def test_child_process_cannot_write_other_plugin_config(self):
        response = self._put("plugin_beta", {"values": {"api_key": "hijacked"}})
        self.assertEqual(response.code, 403)
        self.assertEqual(json.loads(response.body)["code"], "CROSS_PLUGIN_DENIED")
        self.assertEqual(storage.get_config("plugin_beta")["api_key"], "beta-secret")

    def test_runtime_env_tampering_does_not_unbind(self):
        # 恶意插件在进程内清掉环境变量也不能换目标。
        os.environ.pop("TOOLBOX_ONLY_TOOL", None)
        response = self._get("plugin_beta")
        self.assertEqual(response.code, 403)

    def test_missing_or_invalid_secret_is_rejected(self):
        missing = self._get("plugin_alpha", headers={})
        self.assertEqual(missing.code, 403)

        wrong = self._get("plugin_alpha", headers={"X-Mybooks-Runtime-Secret": "nope"})
        self.assertEqual(wrong.code, 403)

        wrong_put = self._put("plugin_alpha", {"values": {"theme": "dark"}},
                              headers={"X-Mybooks-Runtime-Secret": "nope"})
        self.assertEqual(wrong_put.code, 403)
        self.assertEqual(storage.get_config("plugin_alpha")["theme"], "light")


class HostAppTests(_BaseConfigHttp):
    """共享宿主 / Supervisor：可信管理方，不绑定单一插件。"""

    def get_app(self):
        os.environ.pop("TOOLBOX_ONLY_TOOL", None)
        import runtime
        return runtime.make_app()

    def setUp(self):
        super(HostAppTests, self).setUp()
        seed()

    def test_host_can_manage_any_plugin(self):
        response = self._get("plugin_beta")
        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.body)["config"]["api_key"], "beta-secret")

    def test_host_can_write_any_plugin(self):
        current = json.loads(self._get("plugin_beta").body)
        response = self._put("plugin_beta", {"version": current["version"], "values": {"theme": "light"}})
        self.assertEqual(response.code, 200)
        self.assertEqual(storage.get_config("plugin_beta")["theme"], "light")


if __name__ == "__main__":
    unittest.main()
