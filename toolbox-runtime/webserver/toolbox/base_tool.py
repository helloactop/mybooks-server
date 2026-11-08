# -*- coding: utf-8 -*-
"""BaseTool 兼容层：工作目录、任务、入库、消息。"""
import logging
import os

from webserver.services import AsyncService

from . import config, storage
from .core_api import CoreAPI


class BaseTool(AsyncService):
    service_item_name = ""
    TOOL_DATA_ROOT = config.DATA_ROOT
    SUPPORTED_FORMATS = {"epub", "pdf", "azw3", "mobi", "txt"}
    TOOL_SERVICE_TYPE = None

    def __init__(self):
        super(BaseTool, self).__init__()
        self.api = CoreAPI(self)

    @staticmethod
    def info():
        raise NotImplementedError("Subclass must implement info()")

    @classmethod
    def tool_id(cls):
        return cls.info()["tool_id"]

    def get_work_dir(self, unique_key=""):
        return storage.get_work_dir(self.tool_id(), unique_key or None)

    def cleanup_work_dir(self, work_dir):
        storage.cleanup_work_dir(self.tool_id(), work_dir)

    def create_task(self, progress_data=None):
        return self.api.tasks.create_task(progress_data=progress_data)

    def update_task_progress(self, task_id, progress, progress_data=None):
        return self.api.tasks.update_progress(task_id, progress, progress_data=progress_data)

    def complete_task(self, task_id, error_message=None):
        return self.api.tasks.complete_task(task_id, error_message=error_message)

    def make_progress_callback(self, task_id, progress_data_factory=None, outer_callback=None):
        return self.api.tasks.make_progress_callback(
            task_id, progress_data_factory=progress_data_factory, outer_callback=outer_callback)

    def import_file(self, user_id, file_path, title, authors, *, delete_after_import=True):
        return self.api.calibre.import_file(
            user_id, file_path, title, authors, delete_after_import=delete_after_import)

    def add_msg(self, user_id, status, msg):
        self.api.messages.send_message(user_id, msg, status=status)

    def get_all_book_ids(self):
        return self.api.calibre.all_book_ids()

    def get_book_metadata(self, book_id):
        return self.api.calibre.get_metadata(book_id)

    def set_book_language(self, book_id, language):
        # Mybooks 没有 Calibre 的 languages 字段；保持显式不支持，避免静默丢数据。
        from .core_api import UnsupportedCapability
        raise UnsupportedCapability("base_tool.set_book_language")

    def merge_book_formats(self, source_book_id, target_book_id):
        return self.api.calibre.merge_formats(source_book_id, target_book_id)

    def delete_book_by_id(self, book_id):
        return self.api.calibre.delete_book(book_id)
