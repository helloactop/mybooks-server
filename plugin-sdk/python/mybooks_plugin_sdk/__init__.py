# -*- coding: utf-8 -*-
"""Mybooks Plugin SDK（Phase 4B）。

用法（在 Runtime 内）：

    sdk = compat.from_tool(self)          # 旧 BaseTool 零改动
    books = await sdk.books.search("三体")
    task = await sdk.jobs.create("convert")
    await sdk.jobs.complete(task["job_id"])

所有调用都会经过 Node 内部接口，由宿主完成身份认证与权限判定。
"""

from .errors import ERRORS, PluginError, RETRYABLE_CODES
from .sdk import SDK

__version__ = SDK.VERSION

__all__ = ["SDK", "PluginError", "ERRORS", "RETRYABLE_CODES", "__version__"]
