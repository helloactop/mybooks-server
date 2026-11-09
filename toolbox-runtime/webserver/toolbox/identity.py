# -*- coding: utf-8 -*-
"""读取 Node 下发的插件身份令牌（state/identities.json）。

安全语义：
  · 文件不存在（旧 Node 未生成）→ 返回空表，NodeClient 走 Legacy 兼容协议；
  · 文件存在但读取/解析失败 → 抛 IdentityUnavailable，绝不静默退回更宽松协议；
  · 未知工具没有令牌 → 返回空串（Node 侧按 Legacy/严格策略判定）。
"""
import json
import logging
import os
import re
import threading

from . import config

_lock = threading.Lock()
_cache = {"mtime": None, "tokens": {}}
_reported = {"error": ""}

TOOL_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
TOKEN_RE = re.compile(r"^[a-f0-9]{48}$")


class IdentityUnavailable(RuntimeError):
    """身份文件存在但无法安全读取：调用方必须显式失败，不能降级授权。"""

    code = "PLUGIN_IDENTITY_UNAVAILABLE"


def _path():
    return os.path.join(config.STATE_DIR, "identities.json")


def _sanitize(raw):
    if not isinstance(raw, dict):
        return {}
    tokens = {}
    for key, value in raw.items():
        key = str(key or "")
        value = str(value or "")
        if TOOL_ID_RE.match(key) and TOKEN_RE.match(value):
            tokens[key] = value
    return tokens


def _unavailable(err):
    if _reported["error"] != str(err):
        _reported["error"] = str(err)
        logging.error(
            "[identity] identities.json 无法读取（权限或格式问题），拒绝降级到无身份协议: %s", err)
    return IdentityUnavailable(
        "插件身份文件不可读，请检查 state/identities.json 的属主与权限")


def _load():
    path = _path()
    try:
        mtime = os.path.getmtime(path)
    except FileNotFoundError:
        # 只有确认文件不存在，才允许旧协议（Legacy 兼容路径）。
        return {}
    except OSError as err:
        # 权限不足、存储异常等不能伪装成“没有身份文件”。
        raise _unavailable(err) from err
    with _lock:
        if _cache["mtime"] == mtime:
            return _cache["tokens"]
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except FileNotFoundError:
        # stat 与 open 之间被删除：按不存在处理，仍属可确认的缺失。
        return {}
    except (OSError, ValueError) as err:
        raise _unavailable(err) from err
    tokens = _sanitize(document.get("tokens") if isinstance(document, dict) else {})
    with _lock:
        _cache["mtime"] = mtime
        _cache["tokens"] = tokens
    _reported["error"] = ""
    return tokens


def token_for(tool_id):
    return _load().get(str(tool_id or ""), "")


def reset_cache():
    with _lock:
        _cache["mtime"] = None
        _cache["tokens"] = {}
    _reported["error"] = ""
