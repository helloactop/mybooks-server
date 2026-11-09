# -*- coding: utf-8 -*-
"""HostClient：把同步 NodeClient 包装为异步调用并统一错误。

SDK 不保存任何宿主密钥：身份令牌由 Runtime 的 NodeClient/identity 管理，
本层只持有已构造好的客户端引用。
"""

import asyncio

from .errors import PluginError, from_exception


class HostClient(object):
    def __init__(self, node_client):
        if node_client is None:
            raise PluginError("PLUGIN_IDENTITY_MISSING", "缺少 NodeClient", 403)
        self._node = node_client

    @property
    def node(self):
        return self._node

    async def run(self, func, *args, **kwargs):
        """在线程池中执行同步 NodeClient 方法，并把异常归一化。"""
        try:
            return await asyncio.to_thread(func, *args, **kwargs)
        except Exception as err:  # noqa: BLE001 - 统一转换为 PluginError
            raise from_exception(err) from err
