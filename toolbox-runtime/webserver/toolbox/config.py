# -*- coding: utf-8 -*-
"""Runtime 路径与外部地址（只读环境变量）。"""
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
