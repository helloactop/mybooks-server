# -*- coding: utf-8 -*-
"""任务能力：jobs.create@1 / get@1 / progress@1 / result@1 / cancel@1。"""

import asyncio
import time

from . import contract
from .errors import PluginError

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


class JobsAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    async def create(self, operation="convert", details=None):
        op = contract.normalize_operation(operation)
        payload = contract.normalize_job_details(details)
        task_id = await self._sdk._client.run(
            self._sdk._node.create_task, self._sdk.tool_id, op, payload)
        return {"job_id": int(task_id), "status": "running", "progress": 0}

    async def get(self, job_id):
        return await self._sdk._client.run(self._sdk._node.get_task, int(job_id))

    async def progress(self, job_id):
        task = await self.get(job_id)
        return {
            "job_id": task.get("job_id"),
            "status": task.get("status"),
            "stage": task.get("stage", ""),
            "progress": task.get("progress", 0),
            "message": task.get("message", ""),
        }

    async def result(self, job_id):
        return await self._sdk._client.run(self._sdk._node.task_result, int(job_id))

    async def cancel(self, job_id):
        return await self._sdk._client.run(self._sdk._node.cancel_task, int(job_id))

    async def complete(self, job_id, error="", message="", result_book_id=None):
        status = "failed" if error else "completed"
        result = await self._sdk._client.run(
            self._sdk._node.complete_task, int(job_id), status, error, message, result_book_id)
        return result

    async def message(self, job_id, message):
        return await self._sdk._client.run(self._sdk._node.task_message, int(job_id), str(message)[:1000])

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
