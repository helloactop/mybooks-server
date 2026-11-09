# -*- coding: utf-8 -*-
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mybooks_plugin_sdk import compat  # noqa: E402


class FakeNode(object):
    def __init__(self, tool_id):
        self.tool_id = tool_id

    def search_books(self, query, limit):
        return []


class FakeStorage(object):
    def __init__(self):
        self.saved = {}

    def get_config(self, tool_id):
        return dict(self.saved)

    def set_config(self, tool_id, values):
        self.saved = dict(values)


class FakeTool(object):
    @classmethod
    def tool_id(cls):
        return "zlibrary"

    def __init__(self):
        self.api = "legacy-api"
        self.other = 1


class CompatTest(unittest.TestCase):
    def test_from_tool_keeps_legacy_attributes(self):
        tool = FakeTool()
        sdk = compat.from_tool(tool, node_client=FakeNode("zlibrary"), storage=FakeStorage())
        self.assertEqual(sdk.tool_id, "zlibrary")
        self.assertEqual(tool.api, "legacy-api")
        self.assertEqual(tool.other, 1)

    def test_attach_is_idempotent(self):
        tool = FakeTool()
        first = compat.attach(tool, node_client=FakeNode("zlibrary"), storage=FakeStorage())
        second = compat.attach(tool, node_client=FakeNode("zlibrary"), storage=FakeStorage())
        self.assertIs(first, second)
        self.assertIs(tool.sdk, first)

    def test_tool_id_of_invalid(self):
        with self.assertRaises(RuntimeError):
            compat.tool_id_of(object())


if __name__ == "__main__":
    unittest.main()
