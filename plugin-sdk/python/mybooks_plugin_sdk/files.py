# -*- coding: utf-8 -*-
"""文件能力：files.publish@1 / metadata@1 / import@1 / export@1。"""

from . import contract


class FilesAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    async def publish(self, path, job_id=None, format="", title="", sha256="", max_bytes=None):
        payload = contract.normalize_publish(
            path=path, task_id=job_id, fmt=format, title=title, sha256=sha256, max_bytes=max_bytes)
        return await self._sdk._client.run(
            self._sdk._node.publish_artifact,
            payload["task_id"], payload["path"], payload["fmt"], payload["title"],
            payload["sha256"], payload["max_bytes"])

    async def metadata(self, artifact_id):
        return await self._sdk._client.run(self._sdk._node.get_artifact, artifact_id)

    async def delete(self, artifact_id):
        return await self._sdk._client.run(self._sdk._node.delete_artifact, artifact_id)

    async def import_file(self, job_id, path, title, authors=None):
        """把插件产物导入用户书库；宿主会再次检查 books.write。"""
        return await self._sdk._client.run(
            self._sdk._node.import_file, self._sdk.tool_id, int(job_id), str(path), str(title), authors or [])

    async def export(self, book_id, format):
        return await self._sdk._client.run(
            self._sdk._node.export_file, self._sdk.tool_id, int(book_id), str(format))
