/* ============================================================
 * 能力注册表：登记 capability + version + providerId + instanceId
 *
 * 边界：
 *   · 只做注册、查询、停用与注销，不做权限裁决、参数校验或调用；
 *   · 对外只给描述符，invoke 通过 resolve() 交给可信宿主；
 *   · 注册与注销必须可逆，重复 dispose / 启停都是幂等的。
 * ============================================================ */

const CAPABILITY_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/;
const VERSION_RE = /^[1-9][0-9]{0,5}$/;
const ID_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const META_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const META_MAX_KEYS = 32;
const META_MAX_STRING = 256;
const SEP = '\u0000';

class RegistryError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'RegistryError';
    this.code = code;
    this.status = status;
  }
}

function assertPattern(value, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new RegistryError('REGISTRY_INVALID_INPUT', `${field} 不合法`);
  }
  return value;
}

function normalizeVersion(version) {
  const value = typeof version === 'number' && Number.isSafeInteger(version) ? String(version) : version;
  return assertPattern(value, VERSION_RE, 'version');
}

function copyMetadata(metadata) {
  if (metadata === undefined) return Object.freeze({});
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new RegistryError('REGISTRY_INVALID_INPUT', 'metadata 必须是对象');
  }
  const pairs = Object.entries(metadata);
  if (pairs.length > META_MAX_KEYS) {
    throw new RegistryError('REGISTRY_INVALID_INPUT', `metadata 最多 ${META_MAX_KEYS} 个字段`);
  }
  const copy = {};
  for (const [key, value] of pairs) {
    if (!META_KEY_RE.test(key)) throw new RegistryError('REGISTRY_INVALID_INPUT', `metadata 字段名不合法：${key}`);
    if (typeof value === 'string') {
      if (value.length > META_MAX_STRING) {
        throw new RegistryError('REGISTRY_INVALID_INPUT', `metadata 字符串过长：${key}`);
      }
      copy[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RegistryError('REGISTRY_INVALID_INPUT', `metadata 数值不合法：${key}`);
      copy[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      copy[key] = value;
    } else {
      throw new RegistryError('REGISTRY_INVALID_INPUT', `metadata 只接受原始值：${key}`);
    }
  }
  return Object.freeze(copy);
}

function entryKey(capability, version, providerId) {
  return [capability, version, providerId].join(SEP);
}

function describe(entry) {
  return Object.freeze({
    capability: entry.capability,
    version: entry.version,
    providerId: entry.providerId,
    instanceId: entry.instanceId,
    priority: entry.priority,
    metadata: entry.metadata,
  });
}

function compareDescriptors(a, b) {
  if (a.version !== b.version) return Number(a.version) - Number(b.version);
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.providerId !== b.providerId) return a.providerId < b.providerId ? -1 : 1;
  if (a.instanceId !== b.instanceId) return a.instanceId < b.instanceId ? -1 : 1;
  return 0;
}

class ServiceRegistry {
  constructor() {
    this._byKey = new Map();
    this._byInstance = new Map();
    this._disabled = new Set();
  }

  register(spec = {}) {
    const capability = assertPattern(spec.capability, CAPABILITY_RE, 'capability');
    const version = normalizeVersion(spec.version);
    const providerId = assertPattern(spec.providerId, ID_RE, 'providerId');
    const instanceId = assertPattern(spec.instanceId, ID_RE, 'instanceId');
    if (typeof spec.invoke !== 'function') {
      throw new RegistryError('REGISTRY_INVALID_INPUT', 'invoke 必须是函数');
    }
    const priority = spec.priority === undefined ? 0 : spec.priority;
    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
      throw new RegistryError('REGISTRY_INVALID_INPUT', 'priority 必须是有限数值');
    }

    const key = entryKey(capability, version, providerId);
    if (this._byKey.has(key)) {
      throw new RegistryError(
        'REGISTRY_DUPLICATE',
        `${capability}@${version} 的 provider ${providerId} 已注册`,
        409,
      );
    }
    for (const other of this._instanceEntries(instanceId)) {
      if (other.capability === capability && other.version === version) {
        throw new RegistryError(
          'REGISTRY_DUPLICATE',
          `实例 ${instanceId} 重复注册 ${capability}@${version}`,
          409,
        );
      }
    }

    const entry = {
      capability,
      version,
      providerId,
      instanceId,
      priority,
      metadata: copyMetadata(spec.metadata),
      invoke: spec.invoke,
      disposed: false,
    };
    this._byKey.set(key, entry);
    if (!this._byInstance.has(instanceId)) this._byInstance.set(instanceId, new Set());
    this._byInstance.get(instanceId).add(key);

    return () => this._drop(entry);
  }

  list(capability, version) {
    const cap = assertPattern(capability, CAPABILITY_RE, 'capability');
    const ver = version === undefined ? null : normalizeVersion(version);
    const out = [];
    for (const entry of this._byKey.values()) {
      if (entry.capability !== cap) continue;
      if (ver !== null && entry.version !== ver) continue;
      if (this._disabled.has(entry.instanceId)) continue;
      out.push(describe(entry));
    }
    return out.sort(compareDescriptors);
  }

  versions(capability) {
    const cap = assertPattern(capability, CAPABILITY_RE, 'capability');
    const found = new Set();
    for (const entry of this._byKey.values()) {
      if (entry.capability === cap && !this._disabled.has(entry.instanceId)) found.add(entry.version);
    }
    return [...found].sort((a, b) => Number(a) - Number(b));
  }

  get(capability, version, providerId) {
    const entry = this._find(capability, version, providerId);
    if (!entry || this._disabled.has(entry.instanceId)) return null;
    return describe(entry);
  }

  has(capability, version, providerId) {
    return this.get(capability, version, providerId) !== null;
  }

  /**
   * 宿主内部使用：返回描述符与 invoke。
   * 调用方必须先完成权限、Schema、超时与取消校验；这里只解析，不执行。
   */
  resolve(capability, version, providerId) {
    const cap = assertPattern(capability, CAPABILITY_RE, 'capability');
    const ver = normalizeVersion(version);
    const provider = assertPattern(providerId, ID_RE, 'providerId');
    let capabilityKnown = false;
    let versionKnown = false;
    for (const entry of this._byKey.values()) {
      if (entry.capability !== cap) continue;
      capabilityKnown = true;
      if (entry.version === ver) versionKnown = true;
    }
    if (!capabilityKnown) {
      throw new RegistryError('CAPABILITY_NOT_FOUND', `未知能力：${cap}`, 404);
    }
    if (!versionKnown) {
      throw new RegistryError('CAPABILITY_VERSION_UNSUPPORTED', `能力 ${cap} 不支持版本 ${ver}`, 409);
    }
    const entry = this._byKey.get(entryKey(cap, ver, provider));
    if (!entry) {
      throw new RegistryError('PROVIDER_NOT_FOUND', `能力 ${cap}@${ver} 没有 provider ${provider}`, 404);
    }
    if (this._disabled.has(entry.instanceId)) {
      throw new RegistryError('PLUGIN_NOT_ACTIVE', `实例 ${entry.instanceId} 已停用`, 409);
    }
    return { descriptor: describe(entry), invoke: entry.invoke };
  }

  setInstanceActive(instanceId, active = true) {
    assertPattern(instanceId, ID_RE, 'instanceId');
    const keys = this._byInstance.get(instanceId);
    if (!keys) {
      throw new RegistryError('REGISTRY_UNKNOWN_INSTANCE', `未知实例：${instanceId}`, 404);
    }
    if (active) this._disabled.delete(instanceId);
    else this._disabled.add(instanceId);
    return keys.size;
  }

  instances() {
    return [...this._byInstance.keys()].sort().map((instanceId) => ({
      instanceId,
      status: this._disabled.has(instanceId) ? 'disabled' : 'active',
      registrations: this._byInstance.get(instanceId).size,
    }));
  }

  disposeAll() {
    const count = this._byKey.size;
    for (const entry of this._byKey.values()) entry.disposed = true;
    this._byKey.clear();
    this._byInstance.clear();
    this._disabled.clear();
    return count;
  }

  _instanceEntries(instanceId) {
    const keys = this._byInstance.get(instanceId);
    if (!keys) return [];
    const entries = [];
    for (const key of keys) {
      const entry = this._byKey.get(key);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  _find(capability, version, providerId) {
    const cap = assertPattern(capability, CAPABILITY_RE, 'capability');
    const ver = normalizeVersion(version);
    const provider = assertPattern(providerId, ID_RE, 'providerId');
    return this._byKey.get(entryKey(cap, ver, provider)) || null;
  }

  _drop(entry) {
    if (entry.disposed) return false;
    entry.disposed = true;
    this._byKey.delete(entryKey(entry.capability, entry.version, entry.providerId));
    const keys = this._byInstance.get(entry.instanceId);
    // 保留空实例记录：停用后再启用、或先 enable 后注册都不能因“实例已消失”报错。
    if (keys) keys.delete(entryKey(entry.capability, entry.version, entry.providerId));
    return true;
  }
}

module.exports = { ServiceRegistry, RegistryError };
