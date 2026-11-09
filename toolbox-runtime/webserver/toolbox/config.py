# -*- coding: utf-8 -*-
"""Runtime 路径与外部地址（只读环境变量）。"""
import json
import os

TOOLBOX_ROOT = os.path.abspath(os.environ.get("MYBOOKS_TOOLBOX_DIR", "/toolbox"))
PLUGINS_ROOT = os.path.join(TOOLBOX_ROOT, "plugins")
DATA_ROOT = os.path.abspath(os.environ.get("TOOLBOX_DATA_ROOT", os.path.join(TOOLBOX_ROOT, "data")))
STATE_DIR = os.path.join(TOOLBOX_ROOT, "state")
STATE_FILE = os.path.abspath(os.environ.get("TOOLBOX_STATE_FILE", os.path.join(STATE_DIR, "installed.json")))
NODE_URL = os.environ.get("MYBOOKS_NODE_INTERNAL_URL", "http://127.0.0.1:3000").rstrip("/")
RUNTIME_PORT = int(os.environ.get("TOOLBOX_RUNTIME_PORT", "8765"))
# md_to_epub 等工具会 multipart 上传 Markdown + 图片；100MB 与 Node 侧网关上限一致。
MAX_BODY_BYTES = int(os.environ.get("TOOLBOX_MAX_BODY_BYTES", str(100 * 1024 * 1024)))


def plugin_auth_only():
    """隔离部署：Node 内部接口只接受每插件令牌，禁止读取共享 internal-secret。"""
    return os.environ.get("MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY", "").strip().lower() in ("1", "true")


def private_data():
    """独立 UID 子进程：数据目录只允许插件属主与宿主属组访问。"""
    return os.environ.get("MYBOOKS_TOOLBOX_PRIVATE_DATA", "").strip().lower() in ("1", "true")


def host_gid():
    """宿主 Node 的属组 GID；work/ 产物以该组可读，其他插件不可读。"""
    try:
        return max(0, int(os.environ.get("TOOLBOX_HOST_GID", "1000")))
    except ValueError:
        return 1000


def node_runtime_mode():
    """读取 Node 写入共享卷的运行时模式；文件缺失/损坏时返回 None。

    用于校验 Node 与 Python 两端的 MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY 是否一致。
    Node 在启动与每次写 installed.json 时刷新该文件，避免读到跨部署的旧值。
    """
    path = os.path.join(STATE_DIR, "runtime-mode.json")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(document, dict) or document.get("version") != 1:
        return None
    value = document.get("plugin_auth_only")
    return value if isinstance(value, bool) else None
