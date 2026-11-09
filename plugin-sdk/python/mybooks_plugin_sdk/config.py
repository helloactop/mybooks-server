# -*- coding: utf-8 -*-
"""配置能力：config.get@1 / set@1 / validate@1。

读写继续使用 Runtime 现有的加密存储（storage.get_config/set_config），
SDK 不复制加密逻辑，也不把敏感原文写日志或返回给前端。
"""

from .errors import PluginError

MASK = "******"
SENSITIVE_HINTS = ("token", "secret", "password", "passwd", "cookie", "api_key", "apikey")


def _sensitive_names(schema, values=None):
    properties = (schema or {}).get("properties") if isinstance(schema, dict) else None
    names = set()
    if isinstance(properties, dict):
        names.update(key for key, node in properties.items()
                     if isinstance(node, dict) and node.get("x-sensitive") is True)
    # Schema 未声明时的保守兜底，避免把常见密钥字段返回给前端。
    for key in (values or {}):
        lowered = str(key).lower()
        if any(hint in lowered for hint in SENSITIVE_HINTS):
            names.add(key)
    return sorted(names)


class ConfigAPI(object):
    def __init__(self, sdk):
        self._sdk = sdk

    def _storage(self):
        storage = self._sdk._storage
        if storage is None:
            raise PluginError("CONFIG_STORAGE_UNAVAILABLE", "当前运行环境没有配置存储", 500)
        return storage

    def _schema(self):
        return self._sdk.config_schema

    async def get(self, mask=True):
        raw = self._storage().get_config(self._sdk.tool_id) or {}
        if not mask:
            return raw
        masked = dict(raw)
        for field in _sensitive_names(self._schema(), raw):
            if masked.get(field):
                masked[field] = MASK
        return masked

    async def set(self, values, validate=True):
        if not isinstance(values, dict):
            raise PluginError("CONFIG_INVALID", "配置必须是对象", 400)
        if validate and self._schema():
            result = await self.validate(values)
            if not result.get("ok"):
                raise PluginError("CONFIG_INVALID", "配置校验失败", 400)
        current = self._storage().get_config(self._sdk.tool_id) or {}
        current.update(values)
        self._storage().set_config(self._sdk.tool_id, current)
        return {"ok": True, "fields": sorted(values.keys())}

    async def validate(self, values):
        data = await self._sdk._client.run(self._sdk._node.validate_config, values or {})
        return {"ok": bool(data.get("ok")), "errors": data.get("errors") or []}
