# -*- coding: utf-8 -*-
"""任务桥：插件任务 → Mybooks SQLite 任务记录。

插件只看到 create_task/complete_task 的 Poxen 语义；真正的持久化在
Node 的 toolbox_tasks 表。线程局部状态跟踪“当前 worker 的任务/入库结果”，
避免不同插件、不同线程串任务。
"""
import logging
import threading

from webserver.services.background_service import BackgroundService

from .node_client import NodeClient, NodeError

_local = threading.local()


def _state():
    if not hasattr(_local, "task_ids"):
        _local.task_ids = {}
        _local.last_book_ids = {}
    return _local


class TasksAPI(object):
    def __init__(self, owner):
        self._owner = owner

    def current_task_id(self):
        return _state().task_ids.get(self._owner.tool_id())

    def set_last_book_id(self, book_id):
        _state().last_book_ids[self._owner.tool_id()] = int(book_id)

    def create_task(self, progress_data=None):
        tool_id = self._owner.tool_id()
        task_id = NodeClient.for_tool(tool_id).create_task(
            tool_id, operation="download", details=progress_data or {})
        _state().task_ids[tool_id] = int(task_id)
        _state().last_book_ids.pop(tool_id, None)
        try:
            BackgroundService().register_mirror(
                task_id, "other", self._owner.service_item_name or tool_id, progress_data=progress_data)
        except Exception:
            logging.debug("[tasks] background mirror failed", exc_info=True)
        return int(task_id)

    def update_progress(self, task_id, progress, progress_data=None):
        if not task_id:
            return None
        patch = {"progress": max(0, min(100, int(progress)))}
        if progress_data:
            patch["details"] = progress_data
        try:
            BackgroundService().update_progress(task_id, patch["progress"], progress_data)
        except Exception:
            logging.debug("[tasks] background progress mirror failed", exc_info=True)
        try:
            return NodeClient.for_tool(self._owner.tool_id()).update_task(task_id, patch)
        except NodeError as err:
            logging.warning("[tasks] update failed: %s", err.code)
            return None

    def complete_task(self, task_id, error_message=None):
        if not task_id:
            return None
        tool_id = self._owner.tool_id()
        error = str(error_message or "")
        lowered = error.lower()
        if error and ("取消" in error or "cancelled" in lowered or "canceled" in lowered):
            status = "cancelled"
        elif error:
            status = "failed"
        else:
            status = "completed"
        book_id = _state().last_book_ids.get(tool_id)
        try:
            BackgroundService().complete_task(task_id, error_message=error or None)
        except Exception:
            logging.debug("[tasks] background complete mirror failed", exc_info=True)
        try:
            NodeClient.for_tool(tool_id).complete_task(task_id, status, error=error,
                                       message="", result_book_id=book_id)
        except NodeError as err:
            logging.warning("[tasks] complete failed: %s", err.code)
        finally:
            # 保留 task_id：Poxen 插件在 complete_task() 之后还会 add_msg()，
            # 那条消息应挂到刚结束的任务上，而不是丢进日志。
            _state().last_book_ids.pop(tool_id, None)
        return None

    def make_progress_callback(self, task_id, progress_data_factory=None, outer_callback=None):
        def callback(progress):
            data = progress_data_factory(progress) if progress_data_factory else None
            self.update_progress(task_id, progress, data)
            if outer_callback:
                outer_callback(progress)
        return callback
