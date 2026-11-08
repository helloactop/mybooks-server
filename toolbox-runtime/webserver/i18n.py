# -*- coding: utf-8 -*-
"""i18n 兼容层。

插件后端实际只使用 `_()` 做运行时文案；真正的语言切换由插件前端自己的
locales/*.json 负责，因此这里保持 gettext 风格的直接返回。
"""


def _(message):
    return message


def choose_language(*_args, **_kwargs):
    return "zh"


def set_language(*_args, **_kwargs):
    return None


DEFAULT_LANGUAGE = "zh"
SUPPORTED_LANGUAGES = ("zh", "zh-TW", "en")
