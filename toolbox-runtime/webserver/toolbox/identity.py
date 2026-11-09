# -*- coding: utf-8 -*-
"""读取 Node 下发的插件身份令牌（state/identities.json）。

安全语义：
  · 文件不存在（旧 Node 未生成）→ 返回空表，NodeClient 走 Legacy 兼容协议；
  · 文件存在但读取/解析/结构校验失败 → 抛 IdentityUnavailable，绝不静默退回更宽松协议；
  · 文件存在但没有该工具的令牌 → 同样抛 IdentityUnavailable：已安装插件必须有令牌，
    不能因为缺条目就悄悄改为无身份请求。
"""
import json
import logging
import os
import re
import threading

from . import config

_lock = threading.Lock()
_cache = {"mtime": None, "tokens": {}, "present": False}
_reported = {"error": ""}

TOOL_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
TOKEN_RE = re.compile(r"^[a-f0-9]{48}$")


class IdentityUnavailable(RuntimeError):
    """身份文件存在但无法安全使用：调用方必须显式失败，不能降级授权。"""

    code = "PLUGIN_IDENTITY_UNAVAILABLE"


def _path():
    return os.path.join(config.STATE_DIR, "identities.json")


def _unavailable(reason):
    reason = str(reason)
    if _reported["error"] != reason:
        _reported["error"] = reason
        logging.error(
            "[identity] identities.json 不可用，拒绝降级到无身份协议: %s", reason)
    return IdentityUnavailable("插件身份文件不可用: %s" % reason)


def _sanitize(document):
    """严格校验文件结构；任何异常形状都必须显式失败，而不是产出空表。"""
    if not isinstance(document, dict):
        raise _unavailable("identities.json 顶层必须是对象")
    if document.get("version") != 1:
        raise _unavailable("identities.json 的 version 不受支持")
    tokens = document.get("tokens")
    if not isinstance(tokens, dict):
        raise _unavailable("identities.json 的 tokens 必须是对象")
    out = {}
    for key, value in tokens.items():
        tool_id = str(key or "")
        token = str(value or "")
        if not TOOL_ID_RE.match(tool_id) or not TOKEN_RE.match(token):
            raise _unavailable("identities.json 含非法工具 ID 或令牌")
        out[tool_id] = token
    return out


def _load():
    """返回 (tokens, present)。present=False 表示可以确认文件不存在（旧部署）。"""
    path = _path()
    try:
        mtime = os.path.getmtime(path)
    except FileNotFoundError:
        # 只有确认文件不存在，才允许旧协议（Legacy 兼容路径）。
        _clear_cache()
        return {}, False
    except OSError as err:
        # 权限不足、存储异常等不能伪装成“没有身份文件”。
        raise _unavailable(err) from err
    with _lock:
        if _cache["present"] and _cache["mtime"] == mtime:
            return _cache["tokens"], True
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except FileNotFoundError:
        # stat 与 open 之间被删除：按不存在处理，仍属可确认的缺失。
        _clear_cache()
        return {}, False
    except (OSError, ValueError) as err:
        raise _unavailable(err) from err
    tokens = _sanitize(document)
    with _lock:
        _cache["mtime"] = mtime
        _cache["tokens"] = tokens
        _cache["present"] = True
    _reported["error"] = ""
    return tokens, True


def _clear_cache():
    with _lock:
        _cache["mtime"] = None
        _cache["tokens"] = {}
        _cache["present"] = False


def _env_token(tool_id):
    """supervisor 按子进程注入的令牌：只接受与本进程 tool_id 匹配的值。"""
    plugin_id = os.environ.get("MYBOOKS_PLUGIN_ID", "").strip()
    token = os.environ.get("MYBOOKS_PLUGIN_TOKEN", "").strip()
    if plugin_id == str(tool_id or "") and TOKEN_RE.match(token):
        return token
    return ""


def token_for(tool_id):
    env_token = _env_token(tool_id)
    if env_token:
        return env_token
    tokens, present = _load()
    token = tokens.get(str(tool_id or ""), "")
    if token:
        return token
    if present:
        raise _unavailable("identities.json 中没有工具 %s 的令牌" % (tool_id or "<empty>"))
    return ""


def reset_cache():
    _clear_cache()
    _reported["error"] = ""
