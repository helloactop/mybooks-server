# -*- coding: utf-8 -*-
"""SDK 输入归一化与上限。

这些规则与宿主内部接口保持一致；超出范围时抛 PluginError，
避免把明显非法的请求发到 Node 侧。
"""

from .errors import PluginError

SEARCH_LIMIT_MAX = 500
AUTHORS_MAX = 20
TITLE_MAX = 500
DETAILS_KEYS_MAX = 32
ARTIFACT_MAX_BYTES = 80 * 1024 * 1024
ARTIFACT_FORMATS = frozenset({"EPUB", "PDF", "AZW3", "MOBI", "TXT"})

BOOK_CREATE_FIELDS = (
    "title", "authors", "author", "tags", "translators", "publisher", "pubdate",
    "pub_year", "isbn", "series", "series_index", "rating", "summary", "comments",
)
BOOK_UPDATE_FIELDS = (
    "title", "authors", "author", "tags", "translators", "publisher", "pubdate",
    "isbn", "series", "series_index", "rating", "comments", "summary",
)


def _require_tool_id(tool_id):
    value = str(tool_id or "").strip()
    if not value:
        raise PluginError("PLUGIN_IDENTITY_MISSING", "缺少插件身份", 403)
    return value


def normalize_search(query="", limit=50):
    q = str(query or "").strip()
    try:
        size = int(limit)
    except (TypeError, ValueError):
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "limit 必须是整数", 400)
    if size < 1 or size > SEARCH_LIMIT_MAX:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "limit 超出范围 1..%d" % SEARCH_LIMIT_MAX, 400)
    return q, size


def normalize_book_fields(fields, allowed):
    if not isinstance(fields, dict):
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "书籍字段必须是对象", 400)
    out = {key: fields[key] for key in allowed if key in fields}
    if "title" in out:
        title = str(out["title"] or "").strip()
        if not title or len(title) > TITLE_MAX:
            raise PluginError("BOOK_INVALID", "书名不能为空且不超过 %d 字符" % TITLE_MAX, 400)
        out["title"] = title
    if "authors" in out:
        authors = out["authors"]
        if isinstance(authors, str):
            authors = [part.strip() for part in authors.split("、") if part.strip()]
        if not isinstance(authors, (list, tuple)):
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "authors 必须是数组", 400)
        if len(authors) > AUTHORS_MAX:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "作者数量不能超过 %d" % AUTHORS_MAX, 400)
        out["authors"] = [str(name).strip() for name in authors if str(name).strip()]
    return out


def normalize_book_create(fields):
    out = normalize_book_fields(fields, BOOK_CREATE_FIELDS)
    if not out.get("title"):
        raise PluginError("BOOK_INVALID", "缺少书名", 400)
    return out


def normalize_book_update(fields):
    out = normalize_book_fields(fields, BOOK_UPDATE_FIELDS)
    if not out:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "没有可更新的字段", 400)
    return out


def normalize_job_details(details):
    if details is None:
        return {}
    if not isinstance(details, dict):
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "details 必须是对象", 400)
    if len(details) > DETAILS_KEYS_MAX:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "details 字段过多", 400)
    return dict(details)


def normalize_operation(operation):
    value = str(operation or "").strip()
    if not value:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "缺少 operation", 400)
    if len(value) > 40:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "operation 过长", 400)
    return value


def normalize_publish(*, path, task_id=None, fmt="", title="", sha256="", max_bytes=None):
    file_path = str(path or "").strip()
    if not file_path:
        raise PluginError("ARTIFACT_PATH_INVALID", "缺少产物路径", 400)
    size = int(max_bytes) if max_bytes is not None else ARTIFACT_MAX_BYTES
    if size < 1 or size > ARTIFACT_MAX_BYTES:
        raise PluginError("ARTIFACT_TOO_LARGE", "max_bytes 超出范围", 400)
    declared = str(fmt or "").strip().upper()
    if declared and declared not in ARTIFACT_FORMATS:
        raise PluginError("ARTIFACT_FORMAT", "不支持的产物格式 %s" % declared, 400)
    digest = str(sha256 or "").strip().lower()
    if digest and (len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest)):
        raise PluginError("ARTIFACT_SHA_MISMATCH", "sha256 格式无效", 400)
    return {
        "path": file_path,
        "task_id": None if task_id is None else int(task_id),
        "fmt": declared,
        "title": str(title or "").strip()[:200],
        "sha256": digest,
        "max_bytes": size,
    }
