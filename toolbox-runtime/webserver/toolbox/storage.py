# -*- coding: utf-8 -*-
"""插件私有存储：按 tool_id 隔离 + 配置加密落盘。

插件代码通过 CoreAPI.storage 访问；不直接接触主库。
配置整体用 AES-256-GCM 加密（accounts/cookie 等敏感字段不会明文落盘），
密钥来自 MYBOOKS_TOOLBOX_DATA_KEY 或共享卷 state/config.key。
"""
import base64
import hashlib
import json
import logging
import os
import re
import threading

from . import config

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover - 容器/venv 会安装 cryptography
    AESGCM = None

TOOL_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
_KEY_LOCK = threading.Lock()
_KEY_CACHE = {}


class StorageError(RuntimeError):
    pass


def _key_path():
    return os.path.join(config.STATE_DIR, "config.key")


def _load_key():
    with _KEY_LOCK:
        if "key" in _KEY_CACHE:
            return _KEY_CACHE["key"]
        raw = os.environ.get("MYBOOKS_TOOLBOX_DATA_KEY", "").strip()
        if raw:
            try:
                if re.fullmatch(r"[0-9a-fA-F]{64}", raw):
                    key = bytes.fromhex(raw)
                else:
                    key = base64.b64decode(raw)
            except Exception as err:
                raise StorageError("TOOLBOX_DATA_KEY 格式不合法") from err
        else:
            path = _key_path()
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    key = base64.b64decode(handle.read().strip())
            except (OSError, ValueError):
                key = os.urandom(32)
                os.makedirs(config.STATE_DIR, exist_ok=True)
                tmp = path + ".tmp-%d" % os.getpid()
                with open(tmp, "w", encoding="utf-8") as handle:
                    handle.write(base64.b64encode(key).decode("ascii") + "\n")
                try:
                    os.chmod(tmp, 0o600)
                except OSError:
                    pass
                os.replace(tmp, path)
        if len(key) != 32:
            raise StorageError("配置加密密钥必须为 32 字节")
        _KEY_CACHE["key"] = key
        return key


def _encrypt(payload):
    if AESGCM is None:
        raise StorageError("运行环境缺少 cryptography，无法加密插件配置")
    nonce = os.urandom(12)
    ciphertext = AESGCM(_load_key()).encrypt(nonce, payload.encode("utf-8"), b"mybooks-toolbox-config-v1")
    return json.dumps({
        "v": 1,
        "alg": "aes-256-gcm",
        "iv": base64.b64encode(nonce).decode("ascii"),
        "data": base64.b64encode(ciphertext).decode("ascii"),
    }, ensure_ascii=False, indent=2)


def _decrypt(document):
    if AESGCM is None:
        raise StorageError("运行环境缺少 cryptography，无法解密插件配置")
    try:
        nonce = base64.b64decode(document["iv"])
        data = base64.b64decode(document["data"])
        plain = AESGCM(_load_key()).decrypt(nonce, data, b"mybooks-toolbox-config-v1")
        return json.loads(plain.decode("utf-8"))
    except Exception as err:
        raise StorageError("插件配置解密失败；配置密钥可能已变化") from err


def tool_root(tool_id):
    tool_id = str(tool_id or "")
    if not TOOL_ID_RE.match(tool_id):
        raise StorageError("tool_id 不合法")
    root = os.path.join(config.DATA_ROOT, tool_id)
    os.makedirs(root, exist_ok=True)
    # 0711：只允许穿透不允许列举。Node（uid 1000）需要读取 work/ 产物完成入库与下载，
    # 但 config.json 仍是 0600，其他插件无法列出或读取本插件的私有文件。
    try:
        os.chmod(root, 0o711)
    except OSError:
        pass
    return root


def _config_path(tool_id):
    return os.path.join(tool_root(tool_id), "config.json")


def get_config(tool_id):
    path = _config_path(tool_id)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError) as err:
        logging.warning("[storage] config read failed tool=%s: %s", tool_id, err)
        return {}
    if isinstance(document, dict) and document.get("alg") == "aes-256-gcm" and "data" in document:
        return _decrypt(document)
    # 兼容早期明文 config.json；下一次 set_config 会自动加密。
    return document if isinstance(document, dict) else {}


def set_config(tool_id, data):
    if not isinstance(data, dict):
        raise StorageError("配置必须是 JSON 对象")
    path = _config_path(tool_id)
    text = _encrypt(json.dumps(data, ensure_ascii=False))
    tmp = path + ".tmp-%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(text + "\n")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def get_work_dir(tool_id, unique_key=None):
    root = tool_root(tool_id)
    if unique_key:
        key_hash = hashlib.md5(str(unique_key).encode("utf-8")).hexdigest()[:16]
        path = os.path.join(root, key_hash)
    else:
        path = root
    os.makedirs(path, exist_ok=True)
    if unique_key:
        # 产物目录对宿主 Node 可读（0755），私有配置仍在 root 下保持 0600。
        try:
            os.chmod(path, 0o755)
        except OSError:
            pass
    return path


def cleanup_work_dir(tool_id, work_dir):
    root = os.path.realpath(tool_root(tool_id))
    target = os.path.realpath(str(work_dir or ""))
    if target == root or not target.startswith(root + os.sep):
        logging.warning("[storage] refused to remove work dir outside tool root: %s", target)
        return False
    try:
        import shutil
        shutil.rmtree(target, ignore_errors=True)
        return True
    except OSError as err:
        logging.warning("[storage] work dir cleanup failed: %s", err)
        return False
