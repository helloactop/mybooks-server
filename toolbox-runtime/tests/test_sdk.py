# -*- coding: utf-8 -*-
"""Phase 4B：Python SDK 在 Runtime 测试目录中的可导入性与链路验证。

本测试不依赖外网 / Docker；它验证 SDK 契约。
镜像内导入验证由 `python -c "import mybooks_plugin_sdk"` 单独执行。
"""

import asyncio
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SDK_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "plugin-sdk", "python"))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

import mybooks_plugin_sdk  # noqa: E402
from mybooks_plugin_sdk import SDK  # noqa: E402


class FakeNode(object):
    def __init__(self):
        self.task = {"job_id": 7, "status": "running", "stage": "start", "progress": 0, "message": ""}
        self.published = None
        self.completed = None
        self.calls = []

    def create_task(self, tool_id, operation, details):
        self.calls.append(("create_task", tool_id, operation, details))
        return 7

    def get_task(self, task_id):
        return dict(self.task)

    def publish_artifact(self, task_id, path, fmt, title, sha256, max_bytes):
        self.published = {"task_id": task_id, "path": path, "format": fmt}
        return {"artifact_id": "art_" + "b" * 32, "task_id": task_id, "format": "EPUB"}

    def task_result(self, task_id):
        return {"job_id": task_id, "status": "completed", "artifacts": [self.published]}

    def complete_task(self, task_id, status, error="", message="", result_book_id=None):
        self.completed = {"task_id": task_id, "status": status, "result_book_id": result_book_id}
        self.task = {"job_id": task_id, "status": status, "progress": 100, "stage": "done", "message": message}
        return {"ok": True}

    def validate_config(self, values):
        return {"ok": True, "errors": []}

    def metadata_search(self, query, isbn, limit):
        return [{"title": query or isbn, "source": "douban"}]


class FakeStorage(object):
    def __init__(self):
        self.config = {"api_token": "secret", "font_size": 12}

    def get_config(self, tool_id):
        return dict(self.config)

    def set_config(self, tool_id, values):
        self.config = dict(values)


class SdkImportTest(unittest.TestCase):
    def test_version(self):
        self.assertEqual(mybooks_plugin_sdk.__version__, "1.0.0")

    def test_full_task_chain(self):
        node = FakeNode()
        sdk = SDK(tool_id="md_to_epub", node_client=node, storage=FakeStorage())

        job = asyncio.run(sdk.jobs.create("convert", {"source": "a.md"}))
        self.assertEqual(job["job_id"], 7)

        progress = asyncio.run(sdk.jobs.progress(7))
        self.assertEqual(progress["status"], "running")

        artifact = asyncio.run(sdk.files.publish("work/a.epub", job_id=7, format="epub"))
        self.assertEqual(artifact["task_id"], 7)

        asyncio.run(sdk.jobs.complete(7, message="done"))
        self.assertEqual(node.completed["status"], "completed")

        result = asyncio.run(sdk.jobs.result(7))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["artifacts"][0]["task_id"], 7)
        self.assertEqual(node.published["format"], "EPUB")

    def test_wait_stops_on_terminal(self):
        node = FakeNode()
        node.task = {"job_id": 7, "status": "completed", "progress": 100, "stage": "done", "message": ""}
        sdk = SDK(tool_id="md_to_epub", node_client=node)
        state = asyncio.run(sdk.jobs.wait(7, timeout=1, interval=0.1))
        self.assertEqual(state["status"], "completed")

    def test_config_masks_sensitive(self):
        sdk = SDK(tool_id="md_to_epub", node_client=FakeNode(), storage=FakeStorage())
        value = asyncio.run(sdk.config.get())
        self.assertEqual(value["api_token"], "******")
        self.assertEqual(value["font_size"], 12)


if __name__ == "__main__":
    unittest.main()
