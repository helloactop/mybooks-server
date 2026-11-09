# -*- coding: utf-8 -*-
"""Mybooks Plugin SDK 统一入口。"""

from .books import BooksAPI
from .client import HostClient
from .config import ConfigAPI
from .errors import ERRORS, PluginError, RETRYABLE_CODES, from_exception
from .files import FilesAPI
from .jobs import JobsAPI
from .metadata import MetadataAPI


class SDK(object):
    VERSION = "1.0.0"

    def __init__(self, tool_id="", node_client=None, storage=None, config_schema=None):
        self.tool_id = str(tool_id or "")
        self._node = node_client
        self._client = HostClient(node_client)
        self._storage = storage
        self.config_schema = config_schema or None
        self.books = BooksAPI(self)
        self.files = FilesAPI(self)
        self.jobs = JobsAPI(self)
        self.config = ConfigAPI(self)
        self.metadata = MetadataAPI(self)

    @property
    def version(self):
        return self.VERSION
