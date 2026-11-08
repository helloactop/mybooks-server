# -*- coding: utf-8 -*-
"""最小 Metadata 对象，结构对齐 Calibre Metadata 的常用字段。

插件实际只读取/修改 title、authors、tags；serie/出版社等字段保留在
_data 中，避免工具扩展时被迫改宿主。
"""


class Metadata(object):
    def __init__(self, title="", authors=None, **fields):
        self.title = title or ""
        self.authors = list(authors or [])
        self.tags = list(fields.pop("tags", []) or [])
        self._data = dict(fields)

    def get(self, field, default=None):
        if hasattr(self, field):
            return getattr(self, field)
        return self._data.get(field, default)

    def set(self, field, value, extra=None):
        if field in ("title", "authors", "tags"):
            setattr(self, field, value)
        else:
            self._data[field] = value

    def is_null(self, field):
        value = self.get(field)
        return value is None or value == "" or value == [] or value == ()

    def __repr__(self):
        return "Metadata(title=%r, authors=%r, tags=%r)" % (self.title, self.authors, self.tags)
