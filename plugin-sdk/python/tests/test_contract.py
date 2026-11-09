# -*- coding: utf-8 -*-
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mybooks_plugin_sdk import contract  # noqa: E402
from mybooks_plugin_sdk.errors import PluginError  # noqa: E402


class ContractTest(unittest.TestCase):
    def test_search_normalization(self):
        self.assertEqual(contract.normalize_search(" 三体 "), ("三体", 50))
        self.assertEqual(contract.normalize_search("x", 500), ("x", 500))
        with self.assertRaises(PluginError) as ctx:
            contract.normalize_search("x", 0)
        self.assertEqual(ctx.exception.code, "PLUGIN_ARGUMENT_INVALID")

    def test_book_create_requires_title(self):
        with self.assertRaises(PluginError) as ctx:
            contract.normalize_book_create({"authors": ["a"]})
        self.assertEqual(ctx.exception.code, "BOOK_INVALID")

    def test_book_fields_whitelist(self):
        out = contract.normalize_book_create({
            "title": " 三体 ", "authors": "刘慈欣", "status": "read", "unknown": 1,
        })
        self.assertEqual(out["title"], "三体")
        self.assertEqual(out["authors"], ["刘慈欣"])
        self.assertNotIn("status", out)
        self.assertNotIn("unknown", out)

    def test_update_requires_fields(self):
        with self.assertRaises(PluginError):
            contract.normalize_book_update({"status": "read"})

    def test_publish_rejects_bad_format_and_sha(self):
        with self.assertRaises(PluginError) as ctx:
            contract.normalize_publish(path="a.txt", fmt="EXE")
        self.assertEqual(ctx.exception.code, "ARTIFACT_FORMAT")
        with self.assertRaises(PluginError) as ctx:
            contract.normalize_publish(path="a.txt", sha256="xyz")
        self.assertEqual(ctx.exception.code, "ARTIFACT_SHA_MISMATCH")

    def test_publish_defaults(self):
        out = contract.normalize_publish(path="/w/a.epub", task_id=3, fmt="epub")
        self.assertEqual(out["task_id"], 3)
        self.assertEqual(out["fmt"], "EPUB")
        self.assertEqual(out["max_bytes"], contract.ARTIFACT_MAX_BYTES)


if __name__ == "__main__":
    unittest.main()
