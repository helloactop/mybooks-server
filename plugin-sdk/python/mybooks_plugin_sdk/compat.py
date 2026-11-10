# -*- coding: utf-8 -*-
"""旧插件兼容入口。

复用现有 BaseTool / NodeClient / storage，不引入新的加载器，
也不要求旧插件改继承关系。

装配路径与实际 Runtime 镜像保持一致：
  · 源码目录运行时是 `webserver.toolbox.*`；
  · 旧布局/单文件部署可能是 `toolbox.*`；
  · 两者都不可用时抛出带原始原因的 RuntimeError，绝不静默返回缺配置的 SDK。
"""

import importlib

from .client import HostClient
from .sdk import SDK

RUNTIME_PACKAGES = ("webserver.toolbox", "toolbox")


class CompatSetupError(RuntimeError):
    """兼容入口装配失败；保留底层 ImportError 作为 __cause__。"""

    def __init__(self, message, attempts):
        super(CompatSetupError, self).__init__(
            "%s；已尝试：%s" % (message, "; ".join(attempts)))
        self.attempts = list(attempts)


def tool_id_of(tool):
    value = getattr(tool, "tool_id", None)
    if callable(value):
        value = value()
    text = str(value or "").strip()
    if not text:
        raise RuntimeError("无法从工具对象取得 tool_id")
    return text


def _runtime_modules():
    """按真实包路径导入 Runtime 侧 NodeClient / storage / sdk。

    返回 (node_client_module, storage_module, sdk_module)。
    """
    attempts = []
    last_error = None
    for package in RUNTIME_PACKAGES:
        try:
            node_module = importlib.import_module(package + ".node_client")
            storage_module = importlib.import_module(package + ".storage")
            sdk_module = importlib.import_module(package + ".sdk")
            return node_module, storage_module, sdk_module
        except ImportError as err:
            last_error = err
            attempts.append("%s -> %s" % (package, err))
    error = CompatSetupError("无法在 Runtime 中装配 Plugin SDK", attempts)
    raise error from last_error


def from_tool(tool, node_client=None, storage=None, config_schema=None):
    """从现有 BaseTool 实例构造 SDK。

    默认从 Runtime 模块导入 NodeClient 与 storage，并复用 `sdk_for` 缓存，
    保证 `CoreAPI.sdk` 与 `compat.from_tool` 得到同一个实例。测试可显式注入。
    """
    tool_id = tool_id_of(tool)
    runtime_sdk = None
    if node_client is None or storage is None:
        node_module, storage_module, sdk_module = _runtime_modules()
        runtime_sdk = sdk_module
        if node_client is None:
            node_client = node_module.NodeClient.for_tool(tool_id)
        if storage is None:
            storage = storage_module
    if config_schema is None and runtime_sdk is not None:
        # Runtime 装配入口统一走 sdk_for：同一 tool_id 只存在一个 SDK 实例。
        return runtime_sdk.sdk_for(tool)
    return SDK(tool_id=tool_id, node_client=node_client, storage=storage,
               config_schema=config_schema)


def attach(tool, **kwargs):
    """幂等地把 sdk 挂到旧工具实例上，不改动原有属性。"""
    existing = getattr(tool, "sdk", None)
    if existing is not None:
        return existing
    sdk = from_tool(tool, **kwargs)
    setattr(tool, "sdk", sdk)
    return sdk


def host_client(node_client):
    """给需要直接使用传输层的调用方一个薄包装。"""
    return HostClient(node_client)
