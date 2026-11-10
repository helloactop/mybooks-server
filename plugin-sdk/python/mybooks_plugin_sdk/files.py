# -*- coding: utf-8 -*-
"""文件能力：files.publish@1 / metadata@1 / import@1 / export@1。

publish 与 import_file 同时支持文档中的结构化 dict 与位置参数；
所有路径、任务归属、权限检查仍由宿主完成，SDK 只做参数归一化。
"""

import os

from . import contract


class FilesAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    def _absolute(self, path):
        """相对路径按插件数据目录解析；绝对路径原样交给宿主校验。"""
        value = str(path or "").strip()
        if not value or os.path.isabs(value):
            return value
        storage = self._sdk._storage
        tool_root = getattr(storage, "tool_root", None)
        if callable(tool_root):
            return os.path.normpath(os.path.join(tool_root(self._sdk.tool_id), value))
        return value

    async def publish(self, path, job_id=None, format="", title="", sha256="", max_bytes=None):
        """publish(path, job_id=...) 或 publish({"path": ..., "job_id": ...})。"""
        payload = contract.normalize_publish_args(
            path, job_id=job_id, fmt=format, title=title, sha256=sha256, max_bytes=max_bytes)
        return await self._sdk._client.run(
            self._sdk._node.publish_artifact,
            payload["task_id"], payload["path"], payload["fmt"], payload["title"],
            payload["sha256"], payload["max_bytes"])

    async def metadata(self, artifact_id):
        """metadata(artifact_id) 或 metadata({"artifact_id": "art_..."})。"""
        return await self._sdk._client.run(
            self._sdk._node.get_artifact, contract.normalize_artifact_id(artifact_id))

    async def delete(self, artifact_id):
        return await self._sdk._client.run(
            self._sdk._node.delete_artifact, contract.normalize_artifact_id(artifact_id))

    async def import_file(self, job_id, path=None, title=None, authors=None):
        """import_file(job_id, path, title, authors) 或 import_file({...})。

        宿主会再次检查 books.write；SDK 不接受 format/sha256/max_bytes，
        这些字段属于 files.publish，传入时会显式报错。
        """
        task_id, file_path, clean_title, author_list = contract.normalize_import_args(
            job_id, path=path, title=title, authors=authors)
        return await self._sdk._client.run(
            self._sdk._node.import_file, self._sdk.tool_id, task_id,
            self._absolute(file_path), clean_title, author_list)

    async def export(self, book_id, format):
        return await self._sdk._client.run(
            self._sdk._node.export_file, self._sdk.tool_id,
            contract.normalize_book_id(book_id), str(format))
