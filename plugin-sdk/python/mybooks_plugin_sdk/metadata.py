# -*- coding: utf-8 -*-
"""元数据能力：metadata.search@1 / isbn@1。

宿主内部复用 CapabilityRouter 与豆瓣 / Open Library Provider；
SDK 不实现任何 Provider，也不绕过宿主网络策略。
"""

from . import contract
from .errors import PluginError


class MetadataAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    async def search(self, query="", limit=20):
        q, size = contract.normalize_search(query, min(int(limit or 20), 20))
        return await self._sdk._client.run(self._sdk._node.metadata_search, q, "", size)

    async def isbn(self, isbn):
        value = str(isbn or "").strip()
        if not value:
            raise PluginError("METADATA_QUERY_REQUIRED", "缺少 ISBN", 400)
        candidates = await self._sdk._client.run(self._sdk._node.metadata_search, "", value, 10)
        return {"isbn": value, "match": candidates[0] if candidates else None, "candidates": candidates}
