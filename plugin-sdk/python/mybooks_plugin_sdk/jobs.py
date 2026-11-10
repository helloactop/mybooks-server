# -*- coding: utf-8 -*-
"""任务能力：jobs.create@1 / get@1 / progress@1 / result@1 / cancel@1。

任务状态与进度语义（与宿主内部接口一致）：
  · create 只创建 running 任务；
  · progress(job_id) 读取；progress(job_id, value) 更新，value 只能是 0..100；
  · complete 的终态只允许 completed / failed / cancelled，done 明确映射为 completed；
  · 终态任务由宿主拒绝再次修改。
"""

import asyncio
import time

from . import contract
from .errors import PluginError

TERMINAL_STATUSES = frozenset(contract.JOB_STATUSES)


class JobsAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    async def create(self, operation="convert", details=None):
        """create(operation, details) 或 create({"operation": ..., "details": {...}})。"""
        op, payload = contract.normalize_create_args(operation, details)
        task_id = await self._sdk._client.run(
            self._sdk._node.create_task, self._sdk.tool_id, op, payload)
        return {"job_id": int(task_id), "status": "running", "progress": 0}

    async def get(self, job_id):
        return await self._sdk._client.run(
            self._sdk._node.get_task, contract.normalize_book_id(job_id, "job_id"))

    async def progress(self, job_id, value=None):
        """progress(job_id) 读取；progress(job_id, 42) 更新并返回宿主任务。"""
        task_id, progress = contract.normalize_progress_args(job_id, value)
        if progress is not None:
            return await self._sdk._client.run(
                self._sdk._node.update_task, task_id, {"progress": progress})
        task = await self.get(task_id)
        return {
            "job_id": task.get("job_id"),
            "status": task.get("status"),
            "stage": task.get("stage", ""),
            "progress": task.get("progress", 0),
            "message": task.get("message", ""),
        }

    async def result(self, job_id):
        return await self._sdk._client.run(
            self._sdk._node.task_result, contract.normalize_book_id(job_id, "job_id"))

    async def cancel(self, job_id):
        return await self._sdk._client.run(
            self._sdk._node.cancel_task, contract.normalize_book_id(job_id, "job_id"))

    async def complete(self, job_id, status=None, error="", message="", result_book_id=None):
        """向宿主提交终态；兼容旧 `complete(job_id, message=...)` 调用。"""
        task_id, state, error_text, text, book_id = contract.normalize_complete_args(
            job_id, status=status, error=error, message=message, result_book_id=result_book_id)
        return await self._sdk._client.run(
            self._sdk._node.complete_task, task_id, state, error_text, text, book_id)

    async def message(self, job_id, message):
        return await self._sdk._client.run(
            self._sdk._node.task_message,
            contract.normalize_book_id(job_id, "job_id"), str(message)[:1000])

    async def wait(self, job_id, timeout=300, interval=1.0):
        """有上限的等待；只轮询宿主任务状态，不创建额外任务。"""
        deadline = time.monotonic() + max(0.1, float(timeout))
        step = max(0.2, float(interval))
        while True:
            progress = await self.progress(job_id)
            if progress["status"] in TERMINAL_STATUSES:
                return progress
            if time.monotonic() >= deadline:
                raise PluginError("TASK_NOT_FINISHED", "等待任务超时", 409, retryable=True)
            await asyncio.sleep(step)
