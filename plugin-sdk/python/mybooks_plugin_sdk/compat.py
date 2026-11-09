# -*- coding: utf-8 -*-
"""旧插件兼容入口。

复用现有 BaseTool / NodeClient / storage，不引入新的加载器，
也不要求旧插件改继承关系。
"""

import logging

from .client import HostClient
from .sdk import SDK

LOG = logging.getLogger(__name__)


def tool_id_of(tool):
    value = getattr(tool, "tool_id", None)
    if callable(value):
        value = value()
    if not value:
        raise RuntimeError("无法从工具对象取得 tool_id")
    return str(value)


def from_tool(tool, node_client=None, storage=None, config_schema=None):
    """从现有 BaseTool 实例构造 SDK。

    默认从 Runtime 模块导入 NodeClient 与 storage；测试可显式注入。
    """
    tool_id = tool_id_of(tool)
    if node_client is None:
        from toolbox.node_client import NodeClient  # 延迟导入，SDK 可独立测试
        node_client = NodeClient.for_tool(tool_id)
    if storage is None:
        try:
            from toolbox import storage as runtime_storage
            storage = runtime_storage
        except ImportError:
            LOG.debug("toolbox.storage 不可用，config 能力将不可用")
            storage = None
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
