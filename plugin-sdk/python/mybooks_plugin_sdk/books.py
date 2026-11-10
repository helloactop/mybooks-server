# -*- coding: utf-8 -*-
"""书籍能力：books.search@1 / get@1 / create@1 / update@1 / reading-status@1。

每个方法同时接受文档中的结构化 dict 与位置参数；dict 不会退化成 str。
"""

from . import contract


class BooksAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    async def search(self, query="", limit=None):
        """search(query, limit) 或 search({"q": "...", "limit": 20})。"""
        q, size = contract.normalize_search_args(query, limit)
        return await self._sdk._client.run(self._sdk._node.search_books, q, size)

    async def get(self, book_id):
        """get(book_id) 或 get({"book_id": 1})。"""
        return await self._sdk._client.run(
            self._sdk._node.get_metadata, contract.normalize_book_id(book_id))

    async def create(self, fields):
        payload = contract.normalize_book_create(fields)
        return await self._sdk._client.run(self._sdk._node.create_book, payload)

    async def update(self, book_id, fields=None):
        """update(book_id, fields) 或 update({"book_id": 1, "fields": {...}})。"""
        target, payload = contract.normalize_update_args(book_id, fields)
        return await self._sdk._client.run(self._sdk._node.update_book, target, payload)

    async def reading_status(self, book_id):
        """reading_status(book_id) 或 reading_status({"book_id": 1})。"""
        return await self._sdk._client.run(
            self._sdk._node.reading_status, contract.normalize_book_id(book_id))
