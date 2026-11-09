# -*- coding: utf-8 -*-
"""书籍能力：books.search@1 / get@1 / create@1 / update@1 / reading-status@1。"""

from . import contract


class BooksAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    async def search(self, query="", limit=50):
        q, size = contract.normalize_search(query, limit)
        return await self._sdk._client.run(self._sdk._node.search_books, q, size)

    async def get(self, book_id):
        book = await self._sdk._client.run(self._sdk._node.get_metadata, int(book_id))
        return book

    async def create(self, fields):
        payload = contract.normalize_book_create(fields)
        return await self._sdk._client.run(self._sdk._node.create_book, payload)

    async def update(self, book_id, fields):
        payload = contract.normalize_book_update(fields)
        return await self._sdk._client.run(self._sdk._node.update_book, int(book_id), payload)

    async def reading_status(self, book_id):
        return await self._sdk._client.run(self._sdk._node.reading_status, int(book_id))
