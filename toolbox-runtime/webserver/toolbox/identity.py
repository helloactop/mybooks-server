# -*- coding: utf-8 -*-
"""读取 Node 下发的插件身份令牌（state/identities.json）。

文件不存在或旧 Node 未生成时返回空串，NodeClient 会自动退回旧协议
（只带 internal-secret），不阻塞现有插件。
"""
import json
import os
import threading

from . import config

_lock = threading.Lock()
_cache = {"mtime": None, "tokens": {}}


def _path():
    return os.path.join(config.STATE_DIR, "identities.json")


def _sanitize(raw):
    if not isinstance(raw, dict):
        return {}
    tokens = {}
    for key, value in raw.items():
        key = str(key or "")
        value = str(value or "")
        if key and len(value) >= 16:
            tokens[key] = value
    return tokens


def _load():
    path = _path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    with _lock:
        if _cache["mtime"] == mtime:
            return _cache["tokens"]
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError):
        return {}
    tokens = _sanitize(document.get("tokens") if isinstance(document, dict) else {})
    with _lock:
        _cache["mtime"] = mtime
        _cache["tokens"] = tokens
    return tokens


def token_for(tool_id):
    return _load().get(str(tool_id or ""), "")


def reset_cache():
    with _lock:
        _cache["mtime"] = None
        _cache["tokens"] = {}
