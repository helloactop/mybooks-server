# -*- coding: utf-8 -*-
"""Phase 4B-R：compat.from_tool 在真实 Runtime 包路径下的装配回归测试。

覆盖两个 P1-2 失败点：
  1. 只存在 webserver.toolbox.*（镜像内布局）时不再 ModuleNotFoundError；
  2. from_tool / CoreAPI.sdk 复用同一个 sdk_for 缓存实例，且配置能力可用。
"""

import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RUNTIME_ROOT = os.path.abspath(os.path.join(HERE, ".."))
SDK_ROOT = os.path.abspath(os.path.join(RUNTIME_ROOT, "..", "plugin-sdk", "python"))
for candidate in (RUNTIME_ROOT, SDK_ROOT):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("MYBOOKS_TOOLBOX_DIR", tempfile.mkdtemp(prefix="mybooks-compat-"))

from mybooks_plugin_sdk import compat  # noqa: E402


def runtime_sdk_module():
    """延迟导入：让 test_runtime 先设置共享环境变量，避免污染其集成测试。"""
    from webserver.toolbox import sdk as runtime_sdk
    return runtime_sdk


def core_api_class():
    from webserver.toolbox.core_api import CoreAPI
    return CoreAPI


class FakeTool(object):
    def __init__(self, tool_id="compat_fixture"):
        self._tool_id = tool_id

    def tool_id(self):
        return self._tool_id


class CompatRuntimeTest(unittest.TestCase):
    def setUp(self):
        runtime_sdk_module().reset_cache()

    def tearDown(self):
        runtime_sdk_module().reset_cache()

    def test_runtime_modules_use_real_package(self):
        node_module, storage_module, sdk_module = compat._runtime_modules()
        self.assertEqual(node_module.__name__, "webserver.toolbox.node_client")
        self.assertEqual(storage_module.__name__, "webserver.toolbox.storage")
        self.assertEqual(sdk_module.__name__, "webserver.toolbox.sdk")

    def test_from_tool_without_module_not_found(self):
        tool = FakeTool()
        sdk = compat.from_tool(tool)
        self.assertEqual(sdk.tool_id, "compat_fixture")
        # 没有悄悄禁用配置能力：storage 真实可用。
        self.assertTrue(hasattr(sdk._storage, "get_config"))
        self.assertEqual(sdk._node.tool_id, "compat_fixture")

    def test_from_tool_shares_sdk_for_cache(self):
        tool = FakeTool()
        first = compat.from_tool(tool)
        second = runtime_sdk_module().sdk_for(tool)
        self.assertIs(first, second)

    def test_core_api_sdk_consistent(self):
        tool = FakeTool()
        api = core_api_class()(tool)
        self.assertIs(api.sdk, compat.from_tool(tool))

    def test_attach_is_idempotent_and_keeps_legacy_attrs(self):
        tool = FakeTool()
        tool.api = "legacy"
        first = compat.attach(tool)
        second = compat.attach(tool)
        self.assertIs(first, second)
        self.assertEqual(tool.api, "legacy")

    def test_missing_runtime_modules_raise_with_cause(self):
        original = compat.RUNTIME_PACKAGES
        compat.RUNTIME_PACKAGES = ("definitely_missing_package",)
        try:
            with self.assertRaises(compat.CompatSetupError) as ctx:
                compat._runtime_modules()
            self.assertIsInstance(ctx.exception.__cause__, ImportError)
            self.assertIn("definitely_missing_package", str(ctx.exception))
        finally:
            compat.RUNTIME_PACKAGES = original

    def test_missing_storage_is_not_silently_disabled(self):
        original = compat.RUNTIME_PACKAGES
        compat.RUNTIME_PACKAGES = ("definitely_missing_package",)
        try:
            with self.assertRaises(compat.CompatSetupError):
                compat.from_tool(FakeTool())
        finally:
            compat.RUNTIME_PACKAGES = original


if __name__ == "__main__":
    unittest.main()
