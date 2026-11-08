# -*- coding: utf-8 -*-
"""PoxenStudio webserver.utils 的最小兼容实现。

只覆盖插件实际用到的纯函数；不引入 Calibre。
"""
import datetime
import re
import unicodedata

_LEADING_ARTICLES = ("the ", "a ", "an ")


def super_strip(value):
    text = unicodedata.normalize("NFKC", str(value or ""))
    return "".join(ch for ch in text if ch.isprintable() or ch in "\n\t").strip()


def get_title_sort(title):
    text = super_strip(title)
    lower = text.lower()
    for article in _LEADING_ARTICLES:
        if lower.startswith(article):
            text = text[len(article):].strip() + ", " + text[:len(article) - 1].strip()
            break
    text = re.sub(r"^[\"'“‘《]+|[\"'”’》]+$", "", text).strip()
    return text.lower()


def guess_title_author_from_filename(name):
    text = str(name or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    text = re.sub(r"\.[A-Za-z0-9]{1,8}$", "", text).strip()
    match = re.match(r"^《(.+?)》\s*(?:作者[:：]\s*)?(.+)?$", text)
    if match:
        return match.group(1).strip(), (match.group(2) or "").strip() or None
    match = re.match(r"^(.+?)\s*[-—–]\s*(.+)$", text)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return text or None, None


def parse_date(value):
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y年%m月%d日", "%Y-%m", "%Y"):
        try:
            return datetime.datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None
