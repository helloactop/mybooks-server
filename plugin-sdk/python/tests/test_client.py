# -*- coding: utf-8 -*-
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mybooks_plugin_sdk import SDK  # noqa: E402
from mybooks_plugin_sdk.errors import PluginError  # noqa: E402


class FakeNodeError(Exception):
    def __init__(self, code, message, status=400):
        super(FakeNodeError, self).__init__(message)
        self.code = code
        self.message = message
        self.status = status


class FakeNode(object):
    def __init__(self):
        self.calls = []
        self.fail_with = None

    def _record(self, name, *args):
        self.calls.append((name,) + args)
        if self.fail_with is not None:
            raise self.fail_with

    def search_books(self, query, limit):
        self._record("search_books", query, limit)
        return [{"id": 1, "title": "三体"}]

    def get_metadata(self, book_id):
        self._record("get_metadata", book_id)
        return {"id": book_id, "title": "三体"}

    def create_book(self, fields):
        self._record("create_book", fields)
        return {"id": 9, "title": fields["title"]}

    def create_task(self, tool_id, operation, details):
        self._record("create_task", tool_id, operation, details)
        return 42

    def get_task(self, task_id):
        self._record("get_task", task_id)
        return {"job_id": task_id, "status": "running", "progress": 10}

    def publish_artifact(self, task_id, path, fmt, title, sha256, max_bytes):
        self._record("publish_artifact", task_id, path, fmt, title, sha256, max_bytes)
        return {"artifact_id": "art_" + "a" * 32, "task_id": task_id, "format": "EPUB"}

    def task_result(self, task_id):
        self._record("task_result", task_id)
        return {"job_id": task_id, "status": "completed", "artifacts": []}

    def validate_config(self, values):
        self._record("validate_config", values)
        return {"ok": True, "errors": []}

    def metadata_search(self, query, isbn, limit):
        self._record("metadata_search", query, isbn, limit)
        return [{"title": "三体", "source": "douban"}]


class ClientTest(unittest.TestCase):
    def run_async(self, coro):
        return asyncio.run(coro)

    def test_books_and_jobs_roundtrip(self):
        sdk = SDK(tool_id="zlibrary", node_client=FakeNode())
        books = self.run_async(sdk.books.search("三体", 10))
        self.assertEqual(books[0]["title"], "三体")
        job = self.run_async(sdk.jobs.create("convert", {"source": "a.md"}))
        self.assertEqual(job["job_id"], 42)
        progress = self.run_async(sdk.jobs.progress(42))
        self.assertEqual(progress["progress"], 10)
        artifact = self.run_async(sdk.files.publish("work/a.epub", job_id=42, format="epub"))
        self.assertEqual(artifact["task_id"], 42)

    def test_node_error_maps_to_plugin_error(self):
        node = FakeNode()
        node.fail_with = FakeNodeError("ARTIFACT_TOO_LARGE", "too big", 400)
        sdk = SDK(tool_id="zlibrary", node_client=node)
        with self.assertRaises(PluginError) as ctx:
            self.run_async(sdk.files.publish("work/a.epub", job_id=1))
        self.assertEqual(ctx.exception.code, "ARTIFACT_TOO_LARGE")
        self.assertEqual(ctx.exception.status, 400)
        self.assertFalse(ctx.exception.retryable)

    def test_retryable_flag(self):
        node = FakeNode()
        node.fail_with = FakeNodeError("METADATA_TIMEOUT", "timeout", 504)
        sdk = SDK(tool_id="zlibrary", node_client=node)
        with self.assertRaises(PluginError) as ctx:
            self.run_async(sdk.metadata.search("三体"))
        self.assertTrue(ctx.exception.retryable)

    def test_missing_client_is_rejected(self):
        with self.assertRaises(PluginError) as ctx:
            SDK(tool_id="zlibrary")
        self.assertEqual(ctx.exception.code, "PLUGIN_IDENTITY_MISSING")


if __name__ == "__main__":
    unittest.main()
