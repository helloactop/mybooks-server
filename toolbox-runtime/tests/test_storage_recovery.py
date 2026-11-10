# -*- coding: utf-8 -*-
"""Phase 4C.4-R P2-1 / P2-2：配置存储可靠性测试。

覆盖：文件不存在 / JSON 损坏 / 密文损坏 / 密钥不可读 / 磁盘写入失败
/ 首次保存与版本语义 / 旧明文配置兼容。
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 与 test_runtime 保持一致：固定测试用路径与 Node 内部地址，避免导入顺序影响。
_TMP = tempfile.mkdtemp(prefix="mybooks-storage-recovery-")
os.environ.setdefault("MYBOOKS_TOOLBOX_DIR", _TMP)
os.environ.setdefault("MYBOOKS_TOOLBOX_RUNTIME_SECRET", "unit-test-secret")
os.environ.setdefault("MYBOOKS_NODE_INTERNAL_URL", "http://127.0.0.1:19099")

from webserver.toolbox import config, storage  # noqa: E402


def _config_path(tool_id):
    return os.path.join(config.DATA_ROOT, tool_id, "config.json")


class StorageRecoveryTests(unittest.TestCase):
    def setUp(self):
        self._key_path = os.path.join(config.STATE_DIR, "config.key")
        self._key_backup = None
        if os.path.exists(self._key_path):
            with open(self._key_path, "rb") as handle:
                self._key_backup = handle.read()
        storage._KEY_CACHE.clear()

    def tearDown(self):
        storage._KEY_CACHE.clear()
        if self._key_backup is not None:
            with open(self._key_path, "wb") as handle:
                handle.write(self._key_backup)
        else:
            try:
                os.unlink(self._key_path)
            except OSError:
                pass

    def test_missing_config_returns_empty_dict(self):
        tool_id = "recovery_missing"
        path = _config_path(tool_id)
        if os.path.exists(path):
            os.unlink(path)
        self.assertEqual(storage.get_config(tool_id), {})
        self.assertFalse(storage.config_exists(tool_id))

    def test_first_save_creates_file_and_version(self):
        tool_id = "recovery_first"
        path = _config_path(tool_id)
        if os.path.exists(path):
            os.unlink(path)
        self.assertFalse(storage.config_exists(tool_id))
        storage.set_config(tool_id, {"api_key": "first"})
        self.assertTrue(storage.config_exists(tool_id))
        self.assertEqual(storage.get_config(tool_id)["api_key"], "first")
        self.assertTrue(storage.config_version({"api_key": "first"}).startswith("sha256:"))

    def test_corrupt_json_is_not_treated_as_empty(self):
        tool_id = "recovery_corrupt"
        path = _config_path(tool_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("{not json")
        with self.assertRaises(storage.StorageError) as ctx:
            storage.get_config(tool_id)
        self.assertEqual(ctx.exception.code, "CONFIG_CORRUPTED")
        with open(path, "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "{not json")

    def test_corrupt_ciphertext_raises_decrypt_error(self):
        tool_id = "recovery_cipher"
        path = _config_path(tool_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"v": 1, "alg": "aes-256-gcm", "iv": "AAAA", "data": "BBBB"}, handle)
        with self.assertRaises(storage.StorageError) as ctx:
            storage.get_config(tool_id)
        self.assertEqual(ctx.exception.code, "CONFIG_DECRYPT_FAILED")

    def test_unreadable_key_is_never_regenerated(self):
        os.makedirs(config.STATE_DIR, exist_ok=True)
        broken = "!!!not-base64!!!"
        with open(self._key_path, "w", encoding="utf-8") as handle:
            handle.write(broken)
        storage._KEY_CACHE.clear()

        with self.assertRaises(storage.StorageError) as ctx:
            storage._load_key()
        self.assertEqual(ctx.exception.code, "CONFIG_KEY_UNREADABLE")
        with open(self._key_path, "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), broken)

    def test_write_failure_keeps_previous_config(self):
        tool_id = "recovery_writefail"
        storage.set_config(tool_id, {"api_key": "original"})

        original_replace = storage.os.replace

        def boom(*_args, **_kwargs):
            raise OSError("disk full")

        storage.os.replace = boom
        try:
            with self.assertRaises(storage.StorageError) as ctx:
                storage.set_config(tool_id, {"api_key": "replacement"})
            self.assertEqual(ctx.exception.code, "CONFIG_WRITE_FAILED")
        finally:
            storage.os.replace = original_replace

        self.assertEqual(storage.get_config(tool_id)["api_key"], "original")

    def test_key_stays_stable_across_writes(self):
        storage.set_config("recovery_stable_a", {"a": 1})
        with open(self._key_path, "rb") as handle:
            first = handle.read()
        storage.set_config("recovery_stable_b", {"b": 2})
        with open(self._key_path, "rb") as handle:
            second = handle.read()
        self.assertEqual(first, second)

    def test_legacy_plaintext_config_still_readable(self):
        tool_id = "recovery_plain"
        path = _config_path(tool_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"legacy": True, "api_key": "old"}, handle)
        self.assertEqual(storage.get_config(tool_id)["api_key"], "old")

    def test_config_version_is_stable_for_key_order(self):
        self.assertEqual(
            storage.config_version({"b": {"y": 2, "x": 1}, "a": "中文"}),
            storage.config_version({"a": "中文", "b": {"x": 1, "y": 2}}),
        )


if __name__ == "__main__":
    unittest.main()
