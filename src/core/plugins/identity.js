/* ============================================================
 * 运行时身份绑定：不透明会话令牌 → 插件实例身份
 *
 * 令牌由可信 Runtime 会话签发/登记，插件请求体里的 tool_id / pluginId
 * 不能作为身份。令牌只保存在内存中，list()/resolve() 不返回令牌本身。
 * ============================================================ */

const { PLUGIN_ID_RE } = require('./registry');

const TOKEN_RE = /^[A-Za-z0-9._~-]{16,255}$/;

class IdentityError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'IdentityError';
    this.code = code;
    this.status = status;
  }
}

function assertId(value, field) {
  if (typeof value !== 'string' || !PLUGIN_ID_RE.test(value)) {
    throw new IdentityError('IDENTITY_INVALID', `${field} 不合法`);
  }
  return value;
}

class IdentityRegistry {
  constructor() {
    this._byToken = new Map();
    this._byInstance = new Map();
  }

  bind({ token, instanceId, pluginId, runtimeId } = {}) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      throw new IdentityError('IDENTITY_INVALID', '会话令牌不合法');
    }
    assertId(instanceId, 'instanceId');
    if (pluginId !== undefined) assertId(pluginId, 'pluginId');
    if (runtimeId !== undefined) assertId(runtimeId, 'runtimeId');

    const existing = this._byToken.get(token);
    if (existing) {
      if (existing.instanceId !== instanceId) {
        throw new IdentityError('IDENTITY_TOKEN_CONFLICT', '会话令牌已绑定其他实例', 409);
      }
      return existing;
    }

    const identity = Object.freeze({
      instanceId,
      pluginId: pluginId || instanceId,
      runtimeId: runtimeId || '',
    });
    this._byToken.set(token, identity);
    if (!this._byInstance.has(instanceId)) this._byInstance.set(instanceId, new Set());
    this._byInstance.get(instanceId).add(token);
    return identity;
  }

  resolve(token) {
    if (typeof token !== 'string') return null;
    return this._byToken.get(token) || null;
  }

  unbind(token) {
    if (typeof token !== 'string') return false;
    const identity = this._byToken.get(token);
    if (!identity) return false;
    this._byToken.delete(token);
    const tokens = this._byInstance.get(identity.instanceId);
    if (tokens) {
      tokens.delete(token);
      if (tokens.size === 0) this._byInstance.delete(identity.instanceId);
    }
    return true;
  }

  revokeInstance(instanceId) {
    assertId(instanceId, 'instanceId');
    const tokens = this._byInstance.get(instanceId);
    if (!tokens) return 0;
    const count = tokens.size;
    for (const token of tokens) this._byToken.delete(token);
    this._byInstance.delete(instanceId);
    return count;
  }

  list() {
    const seen = new Map();
    for (const identity of this._byToken.values()) {
      if (!seen.has(identity.instanceId)) seen.set(identity.instanceId, identity);
    }
    return Object.freeze([...seen.keys()].sort().map((key) => seen.get(key)));
  }

  size() {
    return this._byToken.size;
  }

  dispose() {
    const count = this._byToken.size;
    this._byToken.clear();
    this._byInstance.clear();
    return count;
  }
}

module.exports = { IdentityRegistry, IdentityError };
