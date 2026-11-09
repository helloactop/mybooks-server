# -*- coding: utf-8 -*-
"""Runtime 侧 SDK 装配。

SDK 包由镜像提供（构建前 npm run sdk:sync）；本模块延迟导入，
避免本地未安装 SDK 时影响旧插件的 CoreAPI 导入。
"""

import threading

from . import storage
from .node_client import NodeClient

_cache = {}
_lock = threading.Lock()


def sdk_for(owner):
    tool_id = owner.tool_id() if callable(getattr(owner, "tool_id", None)) else getattr(owner, "tool_id", "")
    tool_id = str(tool_id or "")
    if not tool_id:
        raise RuntimeError("无法确定插件身份")
    with _lock:
        cached = _cache.get(tool_id)
        if cached is not None:
            return cached
        from mybooks_plugin_sdk import SDK
        sdk = SDK(tool_id=tool_id, node_client=NodeClient.for_tool(tool_id), storage=storage)
        _cache[tool_id] = sdk
        return sdk


def reset_cache():
    with _lock:
        _cache.clear()
