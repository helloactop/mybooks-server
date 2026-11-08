# -*- coding: utf-8 -*-
"""上游 BackgroundService 的内存版兼容实现。

插件（book_dedup / quality_check）直接用它保存/读取自己的任务状态；
宿主的持久任务记录仍由 CoreAPI.tasks 写入 Node SQLite。两者职责分开：
- BackgroundService：插件进程内的实时状态，供 /progress 等接口读取；
- api.tasks：Mybooks 任务中心的历史记录。
"""
import datetime
import logging
import threading


class BackgroundTask:
    SERVICE_TYPE_AUTOFILL = "autofill"
    SERVICE_TYPE_SCAN = "scan"
    SERVICE_TYPE_AUDIO = "audio"
    SERVICE_TYPE_AUDIO_IMPORT = "audio_import"
    SERVICE_TYPE_CONVERT = "convert"
    SERVICE_TYPE_AI_FILL = "ai_fill"
    SERVICE_TYPE_TITLE_SORT_UPDATE = "title_sort_update"
    SERVICE_TYPE_METADATA_UPDATE = "metadata_update"
    SERVICE_TYPE_COVER_UPDATE = "cover_update"
    SERVICE_TYPE_SAVE_META = "save_meta"
    SERVICE_TYPE_CATALOG_EXTRACT = "catalog_extract"
    SERVICE_TYPE_BULK_DELETE = "bulk_delete"
    SERVICE_TYPE_OTHER = "other"

    STATUS_RUNNING = "running"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"
    STATUS_FAILED = "failed"

    _id_counter = 0
    _id_lock = threading.Lock()

    def __init__(self, service_type, service_item, book_id=0, progress=0, progress_data=None):
        with BackgroundTask._id_lock:
            BackgroundTask._id_counter += 1
            self.id = BackgroundTask._id_counter
        self.service_type = service_type
        self.service_item = service_item
        self.status = self.STATUS_RUNNING
        self.progress = progress
        self.progress_data = progress_data or {}
        self.create_time = datetime.datetime.now()
        self.update_time = datetime.datetime.now()
        self.error_message = None
        self.service_book_id = book_id

    def to_dict(self):
        return {
            "id": self.id,
            "service_type": self.service_type,
            "service_item": self.service_item,
            "service_book_id": self.service_book_id,
            "status": self.status,
            "progress": self.progress,
            "progress_data": self.progress_data,
            "create_time": self.create_time.isoformat() if self.create_time else None,
            "update_time": self.update_time.isoformat() if self.update_time else None,
            "error_message": self.error_message,
        }


class BackgroundService:
    _instance = None
    _instance_lock = threading.Lock()
    # 上游 book_dedup 通过 getattr(BackgroundService, "_lock") 判断“真宿主”并加锁。
    _lock = threading.RLock()

    def __new__(cls):
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super(BackgroundService, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._tasks = {}
        self._tasks_lock = threading.RLock()
        self._initialized = True

    def add_task(self, service_type, service_item, book_id=0):
        return self.update_task(service_type, service_item, book_id=book_id, progress=0,
                                progress_data={"total": 1, "done": 0})

    def update_task(self, service_type, service_item, book_id=0, progress=0,
                    progress_data=None, error_message=None):
        with self._tasks_lock:
            task = BackgroundTask(service_type, service_item, book_id, progress, progress_data)
            if error_message:
                task.error_message = error_message
                task.status = BackgroundTask.STATUS_FAILED
            self._tasks[task.id] = task
            return task

    def update_progress(self, task_id, progress, progress_data=None, error_message=None):
        with self._tasks_lock:
            task = self._tasks.get(task_id)
            if not task:
                return False
            task.progress = progress
            task.update_time = datetime.datetime.now()
            if progress_data:
                task.progress_data = progress_data
            if error_message:
                task.error_message = error_message
                task.status = BackgroundTask.STATUS_FAILED
            return True

    def complete_task(self, task_id, error_message=None):
        with self._tasks_lock:
            task = self._tasks.get(task_id)
            if not task:
                return False
            task.status = BackgroundTask.STATUS_COMPLETED
            task.progress = 100
            task.update_time = datetime.datetime.now()
            if error_message:
                task.error_message = error_message
                task.status = BackgroundTask.STATUS_FAILED
            return True

    def register_mirror(self, task_id, service_type, service_item, progress=0, progress_data=None):
        """把 Node SQLite 任务镜像到插件的 BackgroundService，供 get_task 读取。"""
        with self._tasks_lock:
            task = BackgroundTask(service_type, service_item, 0, progress, progress_data)
            task.id = int(task_id)
            self._tasks[task.id] = task
            return task.to_dict()

    def get_task(self, task_id):
        with self._tasks_lock:
            task = self._tasks.get(task_id)
            return task.to_dict() if task else None

    def get_task_by_service(self, service_type, service_item):
        with self._tasks_lock:
            matches = [task for task in self._tasks.values()
                       if task.service_type == service_type and task.service_item == service_item
                       and task.status == BackgroundTask.STATUS_RUNNING]
            matches.sort(key=lambda task: task.create_time, reverse=True)
            return matches[0].to_dict() if matches else None

    def _cleanup_audio_tasks(self):
        return None


logging.debug("[background_service] compatibility module loaded")
