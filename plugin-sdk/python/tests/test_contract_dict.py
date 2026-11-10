# -*- coding: utf-8 -*-
"""Phase 4B-R：SDK 公开契约回归测试（dict / 位置参数 / 错误传播）。

这些用例对应 `docs/plugins/phase4/SDK-SPEC.md` 的可执行示例，
任何一处文档与实现不一致都会在这里失败。
"""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mybooks_plugin_sdk import SDK  # noqa: E402
from mybooks_plugin_sdk import contract  # noqa: E402
from mybooks_plugin_sdk.errors import PluginError  # noqa: E402


class FakeNode(object):
    def __init__(self):
        self.calls = []

    def _record(self, name, *args):
        self.calls.append((name,) + args)

    def search_books(self, query, limit):
        self._record("search_books", query, limit)
        return [{"id": 1, "title": "三体"}]

    def get_metadata(self, book_id):
        self._record("get_metadata", book_id)
        return {"id": book_id, "title": "三体"}

    def create_book(self, fields):
        self._record("create_book", fields)
        return {"id": 9, "title": fields["title"]}

    def update_book(self, book_id, fields):
        self._record("update_book", book_id, fields)
        return {"id": book_id, **fields}

    def reading_status(self, book_id):
        self._record("reading_status", book_id)
        return {"book_id": book_id, "status": "reading", "progress": 12}

    def create_task(self, tool_id, operation, details):
        self._record("create_task", tool_id, operation, details)
        return 12

    def get_task(self, task_id):
        self._record("get_task", task_id)
        return {"job_id": task_id, "status": "running", "progress": 42, "stage": "convert"}

    def update_task(self, task_id, patch):
        self._record("update_task", task_id, patch)
        return {"job_id": task_id, "status": "running", "progress": patch.get("progress", 0)}

    def complete_task(self, task_id, status, error="", message="", result_book_id=None):
        self._record("complete_task", task_id, status, error, message, result_book_id)
        return {"job_id": task_id, "status": status}

    def publish_artifact(self, task_id, path, fmt, title, sha256, max_bytes):
        self._record("publish_artifact", task_id, path, fmt, title, sha256, max_bytes)
        return {"artifact_id": "art_" + "a" * 32, "task_id": task_id, "format": fmt}

    def import_file(self, tool_id, task_id, path, title, authors):
        self._record("import_file", tool_id, task_id, path, title, authors)
        return {"book_id": 5, "format": "EPUB"}

    def get_artifact(self, artifact_id):
        self._record("get_artifact", artifact_id)
        return {"artifact_id": artifact_id}

    def delete_artifact(self, artifact_id):
        self._record("delete_artifact", artifact_id)
        return {"artifact_id": artifact_id, "deleted": True}

    def metadata_search(self, query, isbn, limit):
        self._record("metadata_search", query, isbn, limit)
        return [{"title": "三体", "source": "douban"}]


class FakeStorage(object):
    def tool_root(self, tool_id):
        return os.path.join(os.sep, "toolbox", "data", tool_id)


class DictContractTest(unittest.TestCase):
    def setUp(self):
        self.node = FakeNode()
        self.sdk = SDK(tool_id="md_to_epub", node_client=self.node)

    def run_async(self, coro):
        return asyncio.run(coro)

    def test_books_search_dict(self):
        result = self.run_async(self.sdk.books.search({"q": "三体", "limit": 20}))
        self.assertEqual(result[0]["title"], "三体")
        self.assertEqual(self.node.calls[-1], ("search_books", "三体", 20))

    def test_books_search_positional_still_supported(self):
        self.run_async(self.sdk.books.search("三体", 10))
        self.assertEqual(self.node.calls[-1], ("search_books", "三体", 10))

    def test_metadata_search_isbn_dict(self):
        self.run_async(self.sdk.metadata.search({"isbn": "9787020002207"}))
        self.assertEqual(self.node.calls[-1], ("metadata_search", "", "9787020002207", 20))

    def test_metadata_search_query_dict(self):
        self.run_async(self.sdk.metadata.search({"query": "三体", "limit": 5}))
        self.assertEqual(self.node.calls[-1], ("metadata_search", "三体", "", 5))

    def test_files_publish_dict(self):
        artifact = self.run_async(self.sdk.files.publish({
            "job_id": 12,
            "path": "work/out.epub",
            "format": "epub",
            "title": "三体",
            "sha256": "a" * 64,
            "max_bytes": 1024,
        }))
        self.assertEqual(artifact["artifact_id"], "art_" + "a" * 32)
        self.assertEqual(
            self.node.calls[-1],
            ("publish_artifact", 12, "work/out.epub", "EPUB", "三体", "a" * 64, 1024))

    def test_files_import_dict(self):
        result = self.run_async(self.sdk.files.import_file({
            "job_id": 12,
            "path": "work/out.epub",
            "title": "三体",
            "authors": ["刘慈欣"],
        }))
        self.assertEqual(result["book_id"], 5)
        self.assertEqual(
            self.node.calls[-1],
            ("import_file", "md_to_epub", 12, "work/out.epub", "三体", ["刘慈欣"]))

    def test_jobs_create_dict(self):
        job = self.run_async(self.sdk.jobs.create({
            "operation": "convert",
            "details": {"title": "示例"},
        }))
        self.assertEqual(job["job_id"], 12)
        self.assertEqual(
            self.node.calls[-1],
            ("create_task", "md_to_epub", "convert", {"title": "示例"}))

    def test_jobs_progress_update_and_read(self):
        updated = self.run_async(self.sdk.jobs.progress(12, 42))
        self.assertEqual(updated["progress"], 42)
        self.assertEqual(self.node.calls[-1], ("update_task", 12, {"progress": 42}))
        read = self.run_async(self.sdk.jobs.progress(12))
        self.assertEqual(read["progress"], 42)
        self.assertEqual(read["status"], "running")

    def test_jobs_complete_statuses(self):
        self.run_async(self.sdk.jobs.complete(12, status="completed"))
        self.assertEqual(self.node.calls[-1], ("complete_task", 12, "completed", "", "", None))
        self.run_async(self.sdk.jobs.complete(12, status="done"))
        self.assertEqual(self.node.calls[-1][2], "completed")
        self.run_async(self.sdk.jobs.complete(12, status="failed", error="boom"))
        self.assertEqual(self.node.calls[-1][2], "failed")
        self.assertEqual(self.node.calls[-1][3], "boom")
        self.run_async(self.sdk.jobs.complete(12, status="cancelled"))
        self.assertEqual(self.node.calls[-1][2], "cancelled")

    def test_jobs_complete_error_keyword_derives_failed(self):
        # 旧语义 `complete(job_id, error=...)` 仍落为 failed。
        self.run_async(self.sdk.jobs.complete(12, error="network down"))
        self.assertEqual(self.node.calls[-1][2], "failed")
        self.assertEqual(self.node.calls[-1][3], "network down")

    def test_jobs_complete_rejects_unknown_positional(self):
        # 错误文本不再被当作状态静默接受。
        with self.assertRaises(PluginError) as ctx:
            self.run_async(self.sdk.jobs.complete(12, "network down"))
        self.assertEqual(ctx.exception.code, "TASK_STATUS_INVALID")

    def test_jobs_complete_rejects_unknown_status(self):
        with self.assertRaises(PluginError) as ctx:
            self.run_async(self.sdk.jobs.complete(12, status="running"))
        self.assertEqual(ctx.exception.code, "TASK_STATUS_INVALID")

    def test_dict_is_not_stringified(self):
        self.run_async(self.sdk.books.search({"q": "test", "limit": 10}))
        query = self.node.calls[-1][1]
        self.assertEqual(query, "test")
        self.assertNotIn("{", query)

    def test_invalid_dict_field_raises(self):
        with self.assertRaises(PluginError) as ctx:
            self.run_async(self.sdk.books.search({"q": "x", "bogus": 1}))
        self.assertEqual(ctx.exception.code, "PLUGIN_ARGUMENT_INVALID")

    def test_missing_required_fields(self):
        with self.assertRaises(PluginError):
            self.run_async(self.sdk.files.publish({"job_id": 1}))
        with self.assertRaises(PluginError):
            self.run_async(self.sdk.files.import_file({"job_id": 1, "path": "a.epub"}))
        with self.assertRaises(PluginError):
            self.run_async(self.sdk.jobs.create({"operation": ""}))

    def test_import_rejects_publish_only_fields(self):
        with self.assertRaises(PluginError) as ctx:
            self.run_async(self.sdk.files.import_file({
                "job_id": 1, "path": "a.epub", "title": "x", "sha256": "b" * 64,
            }))
        self.assertEqual(ctx.exception.code, "PLUGIN_ARGUMENT_INVALID")

    def test_progress_rejects_out_of_range(self):
        with self.assertRaises(PluginError) as ctx:
            self.run_async(self.sdk.jobs.progress(12, 101))
        self.assertEqual(ctx.exception.code, "TASK_PROGRESS_INVALID")

    def test_metadata_requires_single_query(self):
        with self.assertRaises(PluginError):
            self.run_async(self.sdk.metadata.search({"query": "x", "isbn": "978"}))
        with self.assertRaises(PluginError):
            self.run_async(self.sdk.metadata.search({}))

    def test_import_relative_path_resolves_against_plugin_data(self):
        sdk = SDK(tool_id="md_to_epub", node_client=self.node, storage=FakeStorage())
        self.run_async(sdk.files.import_file({
            "job_id": 1, "path": "work/out.epub", "title": "三体",
        }))
        self.assertEqual(
            self.node.calls[-1][3],
            os.path.join(os.sep, "toolbox", "data", "md_to_epub", "work", "out.epub"))

    def test_error_code_propagation(self):
        class FailingNode(FakeNode):
            def search_books(self, query, limit):
                raise RuntimeError("upstream")
        sdk = SDK(tool_id="md_to_epub", node_client=FailingNode())
        with self.assertRaises(PluginError) as ctx:
            self.run_async(sdk.books.search({"q": "x"}))
        self.assertEqual(ctx.exception.code, "PLUGIN_ERROR")


class ContractHelpersTest(unittest.TestCase):
    def test_normalize_options_rejects_non_dict(self):
        with self.assertRaises(PluginError):
            contract.normalize_options("q", ("q",), "search")

    def test_normalize_complete_defaults(self):
        task_id, status, error, message, book = contract.normalize_complete_args(1, None, "err")
        self.assertEqual((task_id, status, error, book), (1, "failed", "err", None))
        self.assertEqual(message, "")


if __name__ == "__main__":
    unittest.main()
