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
    """配置存储错误。

    code 用于 Node / 管理端区分“文件不存在”“内容损坏”“解密失败”“读取失败”，
    避免上层把异常当成空配置后覆盖写入。
    """
    def __init__(self, message, code="CONFIG_READ_FAILED"):
        super(StorageError, self).__init__(message)
        self.code = code


def _key_path():
    return os.path.join(config.STATE_DIR, "config.key")


def _read_key_file(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = base64.b64decode(handle.read().strip())
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as err:
        # 文件存在但读不到/内容非法：绝不重新生成密钥，否则旧配置永久无法解密。
        raise StorageError("配置密钥不可读或已损坏", "CONFIG_KEY_UNREADABLE") from err
    if len(raw) != 32:
        raise StorageError("配置密钥长度非法", "CONFIG_KEY_UNREADABLE")
    return raw


def _create_key_file(path):
    """独占创建密钥：并发首次启动时只有一个进程成功，其余读取同一份。"""
    key = os.urandom(32)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.tmp-%d-%s" % (path, os.getpid(), base64.b16encode(os.urandom(4)).decode("ascii"))
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(base64.b64encode(key).decode("ascii") + "\n")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    try:
        # link() 是原子的“仅当不存在时创建”，避免覆盖另一个进程刚写好的密钥。
        os.link(tmp, path)
        return key
    except FileExistsError:
        existing = _read_key_file(path)
        if existing is None:
            raise StorageError("配置密钥创建失败", "CONFIG_KEY_UNAVAILABLE")
        return existing
    except OSError:
        # 文件系统不支持 link()：退回 O_EXCL 打开。
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            existing = _read_key_file(path)
            if existing is None:
                raise StorageError("配置密钥创建失败", "CONFIG_KEY_UNAVAILABLE")
            return existing
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(base64.b64encode(key).decode("ascii") + "\n")
        return key
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


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
                raise StorageError("TOOLBOX_DATA_KEY 格式不合法", "CONFIG_KEY_UNREADABLE") from err
            if len(key) != 32:
                raise StorageError("配置加密密钥必须为 32 字节", "CONFIG_KEY_UNREADABLE")
        else:
            path = _key_path()
            key = _read_key_file(path)
            if key is None:
                key = _create_key_file(path)
        _KEY_CACHE["key"] = key
        return key


def _encrypt(payload):
    if AESGCM is None:
        raise StorageError("运行环境缺少 cryptography，无法加密插件配置", "CONFIG_CRYPTO_UNAVAILABLE")
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
        raise StorageError("运行环境缺少 cryptography，无法解密插件配置", "CONFIG_CRYPTO_UNAVAILABLE")
    try:
        nonce = base64.b64decode(document["iv"])
        data = base64.b64decode(document["data"])
        plain = AESGCM(_load_key()).decrypt(nonce, data, b"mybooks-toolbox-config-v1")
        return json.loads(plain.decode("utf-8"))
    except StorageError:
        raise
    except Exception as err:
        raise StorageError("插件配置解密失败；配置密钥可能已变化", "CONFIG_DECRYPT_FAILED") from err


def tool_root(tool_id):
    tool_id = str(tool_id or "")
    if not TOOL_ID_RE.match(tool_id):
        raise StorageError("tool_id 不合法")
    root = os.path.join(config.DATA_ROOT, tool_id)
    os.makedirs(root, exist_ok=True)
    if config.private_data():
        # 独立 UID：属主/属组/setgid 由 supervisor 统一设置。插件进程不在宿主属组里，
        # 也没有 CAP_FSETID，任何 chmod 都会把 setgid 位清掉，导致后续产物落到插件组。
        return root
    # 旧部署（0711）：Node（uid 1000）需要穿透读取 work/ 产物，其他插件可穿透但
    # 仍无法读取 0600 的 config.json。
    try:
        os.chmod(root, 0o711)
    except OSError:
        pass
    return root


def _config_path(tool_id):
    return os.path.join(tool_root(tool_id), "config.json")


def config_exists(tool_id):
    """配置文件是否真实存在（用于首次保存的版本语义）。"""
    return os.path.exists(_config_path(tool_id))


def get_config(tool_id):
    """读取配置。

    只有在文件确实不存在时才返回空对象；格式损坏、读取失败、解密失败都必须
    显式抛错，避免上层把“损坏”当成“空配置”后覆盖写入。
    """
    path = _config_path(tool_id)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as err:
        logging.error("[storage] config corrupted tool=%s: %s", tool_id, err)
        raise StorageError("插件配置文件已损坏，拒绝按空配置处理", "CONFIG_CORRUPTED") from err
    except OSError as err:
        logging.error("[storage] config unreadable tool=%s: %s", tool_id, err)
        raise StorageError("插件配置文件不可读", "CONFIG_READ_FAILED") from err
    if isinstance(document, dict) and document.get("alg") == "aes-256-gcm" and "data" in document:
        return _decrypt(document)
    if not isinstance(document, dict):
        raise StorageError("插件配置文件结构非法", "CONFIG_CORRUPTED")
    # 兼容早期明文 config.json；下一次 set_config 会自动加密。
    return document


def set_config(tool_id, data):
    if not isinstance(data, dict):
        raise StorageError("配置必须是 JSON 对象", "CONFIG_INVALID")
    path = _config_path(tool_id)
    text = _encrypt(json.dumps(data, ensure_ascii=False))
    tmp = path + ".tmp-%d" % os.getpid()
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        # 原子替换：任一步失败都不会留下半写入的 config.json。
        os.replace(tmp, path)
    except OSError as err:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise StorageError("插件配置写入失败", "CONFIG_WRITE_FAILED") from err


def config_version(data):
    """配置内容的稳定版本号：键排序后取 SHA-256。

    Node 侧用相同算法兜底，用于管理端“读取 → 校验 → 写入”的乐观并发控制。
    只暴露哈希，不泄露配置内容。
    """
    if not isinstance(data, dict):
        data = {}
    canonical = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def get_work_dir(tool_id, unique_key=None):
    root = tool_root(tool_id)
    if unique_key:
        key_hash = hashlib.md5(str(unique_key).encode("utf-8")).hexdigest()[:16]
        path = os.path.join(root, key_hash)
    else:
        path = root
    if unique_key and config.private_data():
        # 独立 UID：靠父目录的 setgid 继承宿主属组；创建时直接带 2750，
        # 不能事后 chmod（插件进程没有 CAP_FSETID，会清掉 setgid 位）。
        os.makedirs(path, mode=0o2750, exist_ok=True)
    else:
        os.makedirs(path, exist_ok=True)
        if unique_key:
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
