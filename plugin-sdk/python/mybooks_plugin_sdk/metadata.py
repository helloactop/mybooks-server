# -*- coding: utf-8 -*-
"""元数据能力：metadata.search@1 / isbn@1。

宿主内部复用 CapabilityRouter 与豆瓣 / Open Library Provider；
SDK 不实现任何 Provider，也不绕过宿主网络策略。
"""

from . import contract
from .errors import PluginError

METADATA_LIMIT_MAX = 20


class MetadataAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    async def search(self, query="", limit=None):
        """search(query, limit) 或 search({"query": ...}) / search({"isbn": ...})。

        dict 中的 isbn 会转成 ISBN 查询；query 与 isbn 不能同时提供。
        """
        if isinstance(query, dict):
            options = contract.normalize_options(query, ("query", "q", "isbn", "limit"), "metadata.search")
            if limit is not None and "limit" in options:
                raise PluginError("PLUGIN_ARGUMENT_INVALID", "limit 不能同时以参数和字段传入", 400)
            value = contract.pick_option(options, "query", "q", default="")
            isbn = str(options.get("isbn") or "").strip()
            size = options.get("limit", 20) if limit is None else limit
        else:
            value = query
            isbn = ""
            size = 20 if limit is None else limit
        text = str(value or "").strip()
        if isbn and text:
            raise PluginError("METADATA_QUERY_REQUIRED", "query 与 isbn 只能提供一个", 400)
        if not isbn and not text:
            raise PluginError("METADATA_QUERY_REQUIRED", "缺少查询条件", 400)
        size = contract._as_int(size, "limit", 1)
        if size > METADATA_LIMIT_MAX:
            size = METADATA_LIMIT_MAX
        return await self._sdk._client.run(
            self._sdk._node.metadata_search, text, isbn, size)

    async def isbn(self, isbn):
        value = str(isbn or "").strip()
        if not value:
            raise PluginError("METADATA_QUERY_REQUIRED", "缺少 ISBN", 400)
        candidates = await self._sdk._client.run(self._sdk._node.metadata_search, "", value, 10)
        return {"isbn": value, "match": candidates[0] if candidates else None, "candidates": candidates}
