# -*- coding: utf-8 -*-
"""CoreAPI 兼容层。

按上游 `webserver/toolbox/core_api.py` 的命名空间与方法语义实现；
明确不支持的方法抛 UnsupportedCapability，不返回假数据。

书库读写全部经 Node 内部接口映射到 Mybooks 现有 SQLite 书库；
Python 插件不直接接触数据库或主数据目录。
"""
import logging
import os

from webserver.i18n import _

from . import config, storage
from .metadata import Metadata
from .node_client import NodeClient, NodeError
from .tasks import TasksAPI

CORE_API_VERSION = "1.3.0"


class UnsupportedCapability(RuntimeError):
    def __init__(self, capability):
        super(UnsupportedCapability, self).__init__(
            "Mybooks Host does not implement CoreAPI capability: %s" % capability)
        self.code = "capability.unsupported"
        self.capability = capability


class CalibreAPI(object):
    def __init__(self, owner):
        self._owner = owner
        self._format_cache = {}

    def _client(self):
        return NodeClient.for_tool(self._owner.tool_id())

    # -- 入库/删除 -------------------------------------------------------------

    def import_file(self, user_id, file_path, title, authors, *, delete_after_import=True):
        task_id = self._owner.api.tasks.current_task_id()
        try:
            result = self._client().import_file(
                self._owner.tool_id(), task_id, file_path, title, authors or [])
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err
        book_id = int(result["book_id"])
        self._owner.api.tasks.set_last_book_id(book_id)
        if delete_after_import:
            self._remove_source(file_path)
        return book_id

    def import_book(self, mi, formats):
        if len(formats) != 1:
            raise UnsupportedCapability("calibre.import_book(multiple formats)")
        return self.import_file(0, formats[0], mi.title, getattr(mi, "authors", None) or [],
                                delete_after_import=True)

    def new_metadata(self, title, authors=None):
        return Metadata(title, authors or [_("未知作者")])

    def _remove_source(self, file_path):
        try:
            root = os.path.realpath(config.DATA_ROOT)
            target = os.path.realpath(file_path)
            if target == root or not target.startswith(root + os.sep):
                logging.warning("[calibre] refused to delete source outside toolbox data: %s", target)
                return
            os.remove(target)
        except OSError as err:
            logging.warning("[calibre] failed to delete imported source: %s", err)

    # -- 元数据 ---------------------------------------------------------------

    def get_metadata(self, book_id, get_cover=False, cover_as_data=False):
        try:
            data = self._client().get_metadata(book_id)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err
        mi = Metadata(
            title=data.get("title") or "",
            authors=data.get("authors") or [],
            tags=data.get("tags") or [],
            publisher=data.get("publisher") or "",
            comments=data.get("comments") or "",
            series=data.get("series") or "",
            series_index=data.get("series_index") or 0,
            rating=data.get("rating") or 0,
            identifiers=data.get("identifiers") or {},
            languages=data.get("languages") or [],
            pubdate=data.get("pubdate") or "",
            timestamp=data.get("timestamp") or "",
            uuid=data.get("uuid") or "",
            title_sort=data.get("sort") or "",
            book_type=data.get("#book_type") or 0,
        )
        if get_cover:
            mi.cover_data = ("jpg", self.cover(book_id)) if cover_as_data else self.cover(book_id)
        return mi

    def set_metadata(self, book_id, mi, force_changes=True):
        fields = {
            "tags": list(getattr(mi, "tags", None) or []),
            "title": getattr(mi, "title", None),
            "authors": list(getattr(mi, "authors", None) or []),
            "publisher": getattr(mi, "publisher", None),
            "comments": getattr(mi, "comments", None),
            "series": getattr(mi, "series", None),
            "series_index": getattr(mi, "series_index", None),
            "rating": getattr(mi, "rating", None),
            "translators": getattr(mi, "translators", None),
        }
        fields = {key: value for key, value in fields.items() if value is not None}
        try:
            self._client().set_metadata(book_id, fields)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err
        return None

    def get_custom(self, book_id, label):
        data = self._client().get_metadata(book_id)
        custom = data.get("custom") or {}
        return custom.get(str(label).lstrip("#"))

    def get_field_map(self, field, book_ids):
        try:
            return self._client().fields(field, book_ids)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    # -- 查询 -----------------------------------------------------------------

    def all_book_ids(self):
        try:
            return self._client().book_ids()
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    def search_books(self, query, max_results=20, include_comments=False):
        try:
            return self._client().search_books(query, max_results)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    def search_ids(self, query):
        try:
            return self._client().book_ids(query)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    def get_data_as_dict(self, ids):
        try:
            return self._client().books(ids)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    # -- 文件与封面 ------------------------------------------------------------

    def cover(self, book_id):
        try:
            return self._client().cover(book_id)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    def set_cover(self, book_id, cover):
        raise UnsupportedCapability("calibre.set_cover")

    def format_abspath(self, book_id, fmt):
        key = (int(book_id), str(fmt).upper())
        cached = self._format_cache.get(key)
        if cached and os.path.exists(cached):
            return cached
        try:
            info = self._client().export_file(self._owner.tool_id(), book_id, fmt)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err
        self._format_cache[key] = info["path"]
        return info["path"]

    def add_format(self, book_id, fmt, file_path, replace=True):
        raise UnsupportedCapability("calibre.add_format")

    def remove_formats(self, values):
        raise UnsupportedCapability("calibre.remove_formats")

    def merge_formats(self, source_book_id, target_book_id):
        try:
            result = self._client().merge_formats(source_book_id, target_book_id)
            return result.get("moved") or []
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    # Upstream BaseTool 的旧名字，插件也可能直接调用
    merge_book_formats = merge_formats

    def delete_book(self, book_id):
        try:
            return self._client().delete_book(book_id)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err


class AppDBAPI(object):
    def __init__(self, owner):
        self._owner = owner

    def get_item_by_book_id(self, book_id):
        return None

    def create_item(self, book_id, collector_id):
        try:
            return NodeClient.for_tool(self._owner.tool_id()).create_item(book_id, collector_id)
        except NodeError as err:
            raise RuntimeError(err.message or err.code) from err

    def delete_item_by_book_id(self, book_id):
        return None

    def get_reader(self, user_id):
        return {"id": user_id, "username": "admin", "name": "admin", "admin": True}


class TasksNamespace(TasksAPI):
    pass


class MessagesAPI(object):
    def __init__(self, owner):
        self._owner = owner

    def send_message(self, user_id, msg, status="info"):
        task_id = self._owner.api.tasks.current_task_id()
        if task_id:
            try:
                NodeClient.for_tool(self._owner.tool_id()).task_message(task_id, str(msg))
            except NodeError as err:
                logging.warning("[messages] task message failed: %s", err.code)
        else:
            logging.info("[messages] %s: %s", status, msg)


class StorageAPI(object):
    def __init__(self, owner):
        self._owner = owner

    def get_work_dir(self, unique_key=None):
        return storage.get_work_dir(self._owner.tool_id(), unique_key)

    def cleanup_work_dir(self, work_dir):
        return storage.cleanup_work_dir(self._owner.tool_id(), work_dir)

    def get_config(self):
        return storage.get_config(self._owner.tool_id())

    def set_config(self, data):
        storage.set_config(self._owner.tool_id(), data)


class SettingsAPI(object):
    ALLOWED_KEYS = {
        "DEFAULT_LANGUAGE": "站点默认语言",
        "auto_fill_meta": "自动补全元数据开关",
        "audio_output_folder": "音频工具的输出目录",
    }

    def get(self, key, default=None):
        if key not in self.ALLOWED_KEYS:
            logging.warning("[settings] key %r not allowed", key)
            return default
        if key == "DEFAULT_LANGUAGE":
            return os.environ.get("TOOLBOX_DEFAULT_LANGUAGE", "zh")
        if key == "audio_output_folder":
            # Mybooks 当前没有有声书目录；允许部署时通过环境变量提供一个共享目录。
            return os.environ.get("MYBOOKS_AUDIO_DIR", os.path.join(config.DATA_ROOT, "audio"))
        if key == "auto_fill_meta":
            return False
        return default


class UtilsAPI(object):
    def strip(self, value):
        from webserver.utils import super_strip
        return super_strip(value)

    def get_title_sort(self, title):
        from webserver.utils import get_title_sort
        return get_title_sort(title)

    def guess_title_author_from_filename(self, name):
        from webserver.utils import guess_title_author_from_filename
        return guess_title_author_from_filename(name)

    def parse_date(self, date_str):
        from webserver.utils import parse_date
        return parse_date(date_str)


class CoreAPI(object):
    VERSION = CORE_API_VERSION

    def __init__(self, owner):
        self.calibre = CalibreAPI(owner)
        self.db = AppDBAPI(owner)
        self.tasks = TasksNamespace(owner)
        self.messages = MessagesAPI(owner)
        self.storage = StorageAPI(owner)
        self.settings = SettingsAPI()
        self.utils = UtilsAPI()
