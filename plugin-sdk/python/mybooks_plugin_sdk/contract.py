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


JOB_STATUSES = ("completed", "failed", "cancelled")
JOB_STATUS_ALIASES = {"done": "completed"}


def normalize_options(value, allowed, name):
    """校验结构化参数：必须是 dict，且只允许白名单字段。

    存在非法字段时显式失败，绝不把 dict 隐式 str() 成查询条件或文件路径。
    """
    if not isinstance(value, dict):
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "%s 参数必须是对象" % name, 400)
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        raise PluginError(
            "PLUGIN_ARGUMENT_INVALID",
            "%s 不支持字段: %s" % (name, ", ".join(str(key) for key in unknown)), 400)
    return dict(value)


def _pick(options, *names, **kwargs):
    """从 dict 中取第一个存在的字段；同时给出多个等价字段时显式报错。"""
    present = [name for name in names if name in options]
    if len(present) > 1:
        raise PluginError(
            "PLUGIN_ARGUMENT_INVALID",
            "字段 %s 不能同时出现" % " / ".join(present), 400)
    if present:
        return options[present[0]]
    return kwargs.get("default")


# 公开别名：其它能力模块只依赖这个函数读取等价字段。
pick_option = _pick


def _as_int(value, name, minimum=0):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "%s 必须是整数" % name, 400)
    if number < minimum:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "%s 不能小于 %d" % (name, minimum), 400)
    return number


def normalize_search_args(query="", limit=None):
    """books.search / metadata.search 兼容 `(query, limit)` 与 `({"q": ...})`。"""
    if isinstance(query, dict):
        options = normalize_options(query, ("q", "query", "limit"), "search")
        if limit is not None and "limit" in options:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "limit 不能同时以参数和字段传入", 400)
        value = _pick(options, "q", "query", default="")
        if limit is None:
            limit = options.get("limit", 50)
    else:
        value = query
    return normalize_search(value, 50 if limit is None else limit)


def normalize_book_id(value, name="book_id"):
    if isinstance(value, dict):
        options = normalize_options(value, (name, "id"), name)
        value = _pick(options, name, "id")
        if value is None:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "缺少 %s" % name, 400)
    return _as_int(value, name, 1)


def normalize_update_args(book_id, fields=None):
    if isinstance(book_id, dict):
        if fields is not None:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "更新参数不能同时使用对象和位置参数", 400)
        options = normalize_options(book_id, ("book_id", "id", "fields"), "books.update")
        fields = options.get("fields")
        book_id = _pick(options, "book_id", "id")
        if book_id is None:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "缺少 book_id", 400)
        if fields is None:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "缺少 fields", 400)
    elif fields is None:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "缺少 fields", 400)
    return normalize_book_id(book_id), normalize_book_update(fields)


def normalize_publish_args(path, job_id=None, fmt="", title="", sha256="", max_bytes=None):
    """兼容 `publish(path, job_id=...)` 与 `publish({"path": ...})`。"""
    if isinstance(path, dict):
        options = normalize_options(path, (
            "path", "file_path", "job_id", "task_id", "format", "fmt",
            "title", "sha256", "max_bytes",
        ), "files.publish")
        if job_id is not None and ("job_id" in options or "task_id" in options):
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "job_id 不能同时以参数和字段传入", 400)
        if fmt and ("format" in options or "fmt" in options):
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "format 不能同时以参数和字段传入", 400)
        path = _pick(options, "path", "file_path")
        job_id = _pick(options, "job_id", "task_id", default=job_id)
        if not fmt:
            fmt = _pick(options, "format", "fmt", default="")
        title = title or options.get("title", "")
        sha256 = sha256 or options.get("sha256", "")
        if max_bytes is None:
            max_bytes = options.get("max_bytes")
    if path is None:
        raise PluginError("ARTIFACT_PATH_INVALID", "缺少产物路径", 400)
    return normalize_publish(
        path=path, task_id=job_id, fmt=fmt, title=title,
        sha256=sha256, max_bytes=max_bytes)


def normalize_import_args(job_id, path=None, title=None, authors=None):
    """兼容 `import_file(job_id, path, title)` 与 `import_file({"job_id": ...})`。

    宿主入库接口只接受 job_id/path/title/authors；format/sha256/max_bytes
    不属于该接口，传入时显式报错而不是静默丢弃。
    """
    if isinstance(job_id, dict):
        if path is not None or title is not None or authors is not None:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "入库参数不能同时使用对象和位置参数", 400)
        options = normalize_options(job_id, (
            "job_id", "task_id", "path", "file_path", "title", "authors",
        ), "files.import_file")
        job_id = _pick(options, "job_id", "task_id")
        path = _pick(options, "path", "file_path")
        title = options.get("title")
        authors = options.get("authors")
    if job_id is None:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "缺少 job_id", 400)
    task_id = _as_int(job_id, "job_id", 0)
    file_path = str(path or "").strip()
    if not file_path:
        raise PluginError("TOOL_IMPORT_PATH", "缺少入库文件路径", 400)
    clean_title = str(title or "").strip()
    if not clean_title:
        raise PluginError("TOOL_IMPORT_TITLE", "缺少书名", 400)
    if authors is None:
        author_list = []
    elif isinstance(authors, str):
        author_list = [part.strip() for part in authors.split("、") if part.strip()]
    elif isinstance(authors, (list, tuple)):
        author_list = [str(name).strip() for name in authors if str(name).strip()]
    else:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "authors 必须是数组或字符串", 400)
    if len(author_list) > AUTHORS_MAX:
        raise PluginError("PLUGIN_ARGUMENT_INVALID", "作者数量不能超过 %d" % AUTHORS_MAX, 400)
    return task_id, file_path, clean_title, author_list


def normalize_artifact_id(value, name="artifact_id"):
    if isinstance(value, dict):
        options = normalize_options(value, (name, "id"), name)
        value = _pick(options, name, "id")
    identifier = str(value or "").strip()
    if not identifier:
        raise PluginError("ARTIFACT_NOT_FOUND", "缺少产物 ID", 404)
    return identifier


def normalize_create_args(operation="convert", details=None):
    if isinstance(operation, dict):
        if details is not None:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "创建参数不能同时使用对象和位置参数", 400)
        options = normalize_options(operation, ("operation", "details"), "jobs.create")
        details = options.get("details")
        operation = options.get("operation", "convert")
    return normalize_operation(operation), normalize_job_details(details)


def normalize_progress_args(job_id, value=None):
    if isinstance(job_id, dict):
        if value is not None:
            raise PluginError("PLUGIN_ARGUMENT_INVALID", "进度参数不能同时使用对象和位置参数", 400)
        options = normalize_options(job_id, (
            "job_id", "task_id", "progress", "value",
        ), "jobs.progress")
        value = _pick(options, "progress", "value")
        job_id = _pick(options, "job_id", "task_id")
    task_id = normalize_book_id(job_id, "job_id")
    if value is None:
        return task_id, None
    progress = _as_int(value, "progress", 0)
    if progress > 100:
        raise PluginError("TASK_PROGRESS_INVALID", "进度必须在 0..100", 400)
    return task_id, progress


def normalize_complete_args(job_id, status=None, error="", message="", result_book_id=None):
    """统一任务终态：completed / failed / cancelled（done 明确映射为 completed）。

    未知状态一律抛 TASK_STATUS_INVALID；不支持旧的 `complete(job_id, error_text)`
    位置写法（错误文本必须用 error= 传入），避免把错误文本误当状态。
    """
    if isinstance(job_id, dict):
        options = normalize_options(job_id, (
            "job_id", "task_id", "status", "error", "message", "result_book_id",
        ), "jobs.complete")
        status = pick_option(options, "status", default=status)
        error = options.get("error", error)
        message = options.get("message", message)
        result_book_id = options.get("result_book_id", result_book_id)
        job_id = pick_option(options, "job_id", "task_id")
    task_id = normalize_book_id(job_id, "job_id")
    value = str(status or "").strip().lower()
    if not value:
        value = "failed" if error else "completed"
    if value in JOB_STATUS_ALIASES:
        value = JOB_STATUS_ALIASES[value]
    if value not in JOB_STATUSES:
        raise PluginError("TASK_STATUS_INVALID", "不支持的任务状态: %s" % value, 400)
    if value == "completed" and error:
        raise PluginError("TASK_STATUS_INVALID", "completed 状态不能携带 error", 400)
    if result_book_id is not None:
        result_book_id = _as_int(result_book_id, "result_book_id", 1)
    return task_id, value, str(error or ""), str(message or "")[:1000], result_book_id


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
