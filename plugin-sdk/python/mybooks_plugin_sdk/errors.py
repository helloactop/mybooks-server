# -*- coding: utf-8 -*-
"""Mybooks Plugin SDK 的稳定错误模型。"""


class PluginError(RuntimeError):
    """所有 SDK 调用失败都归一化为 PluginError。

    code 与宿主内部接口保持一致（如 PLUGIN_IDENTITY_MISMATCH / ARTIFACT_TOO_LARGE），
    调用方不应依赖 message 文案做分支判断。
    """

    def __init__(self, code, message="", status=0, retryable=None):
        self.code = str(code or "PLUGIN_ERROR")
        self.message = str(message or self.code)
        self.status = int(status or 0)
        if retryable is None:
            retryable = self.code in RETRYABLE_CODES
        self.retryable = bool(retryable)
        super(PluginError, self).__init__(self.message)

    def to_dict(self):
        return {
            "code": self.code,
            "message": self.message,
            "status": self.status,
            "retryable": self.retryable,
        }

    def __str__(self):
        return "%s: %s" % (self.code, self.message)


# 只有明确可重试的错误才标记；认证/权限/参数错误绝不自动重试。
RETRYABLE_CODES = frozenset({
    "NODE_UNAVAILABLE",
    "METADATA_TIMEOUT",
    "TASK_NOT_FINISHED",
})

# 宿主可能返回的稳定错误码清单（用于文档与前端映射，不做白名单拦截）。
ERRORS = {
    "PLUGIN_ARGUMENT_INVALID": 400,
    "PLUGIN_IDENTITY_MISSING": 403,
    "PLUGIN_IDENTITY_INVALID": 403,
    "PLUGIN_IDENTITY_UNAVAILABLE": 403,
    "PLUGIN_IDENTITY_MISMATCH": 403,
    "PLUGIN_GRANTS_REQUIRED": 403,
    "PERMISSION_DENIED": 403,
    "TOOL_NOT_INSTALLED": 404,
    "TOOL_DISABLED": 403,
    "TASK_NOT_FOUND": 404,
    "TASK_TOOL_MISMATCH": 403,
    "TASK_NOT_FINISHED": 409,
    "TASK_NOT_RUNNING": 409,
    "TASK_ALREADY_FINISHED": 409,
    "TASK_PROGRESS_INVALID": 400,
    "TASK_STATUS_INVALID": 400,
    "CANCEL_UNSUPPORTED": 409,
    "ARTIFACT_PATH_INVALID": 400,
    "ARTIFACT_TOO_LARGE": 400,
    "ARTIFACT_FORMAT": 400,
    "ARTIFACT_SHA_MISMATCH": 400,
    "ARTIFACT_NOT_FOUND": 404,
    "ARTIFACT_TOOL_MISMATCH": 403,
    "BOOK_NOT_FOUND": 404,
    "BOOK_INVALID": 400,
    "CONFIG_SCHEMA_MISSING": 404,
    "CONFIG_INVALID": 400,
    "METADATA_QUERY_REQUIRED": 400,
    "METADATA_TIMEOUT": 504,
}


def from_exception(err):
    """把 NodeError / requests 异常 / 未知异常统一转换为 PluginError。"""
    if isinstance(err, PluginError):
        return err
    code = getattr(err, "code", None)
    status = getattr(err, "status", 0)
    message = getattr(err, "message", None) or str(err)
    if not code:
        name = err.__class__.__name__
        if name in ("TimeoutError", "ReadTimeout", "ConnectTimeout"):
            code = "NODE_TIMEOUT"
            status = 504
        else:
            code = "PLUGIN_ERROR"
    return PluginError(code, message, status)
