/* ============================================================
 * Runtime Manager：按 runtimeId 管理运行时适配器
 *
 * 适配器接口（按需实现）：
 *   health() / start(instance) / stop(instance) / invoke(instance, request, ctx)
 *   cancel(instance, operationId) / dispose(instance)
 *
 * health 失败返回 offline 而不是抛错；其他未实现的方法显式报
 * RUNTIME_UNSUPPORTED，不伪装成功。当前只登记 Legacy Toolbox。
 * ============================================================ */

const { PLUGIN_ID_RE } = require('./registry');

const DEFAULT_HEALTH_TIMEOUT_MS = 3000;

class RuntimeError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'RuntimeError';
    this.code = code;
    this.status = status;
  }
}

function withTimeout(promise, ms, message) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RuntimeError('RUNTIME_TIMEOUT', message, 504)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new RuntimeError('RUNTIME_INVALID', '运行时适配器必须是对象');
  }
  if (typeof adapter.runtimeId !== 'string' || !PLUGIN_ID_RE.test(adapter.runtimeId)) {
    throw new RuntimeError('RUNTIME_INVALID', 'runtimeId 不合法');
  }
  if (typeof adapter.kind !== 'string' || adapter.kind.length === 0 || adapter.kind.length > 64) {
    throw new RuntimeError('RUNTIME_INVALID', 'kind 不合法');
  }
  if (typeof adapter.health !== 'function') {
    throw new RuntimeError('RUNTIME_INVALID', '运行时适配器必须实现 health()');
  }
  return adapter;
}

function normalizeHealth(adapter, result) {
  const value = result && typeof result === 'object' ? result : {};
  return Object.freeze({
    runtimeId: adapter.runtimeId,
    kind: adapter.kind,
    online: !!value.online,
    status: Number.isSafeInteger(value.status) ? value.status : 0,
    error: typeof value.error === 'string' ? value.error.slice(0, 500) : '',
    details: value.details && typeof value.details === 'object' ? Object.freeze({ ...value.details }) : Object.freeze({}),
  });
}

class RuntimeManager {
  constructor({ logger, healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS } = {}) {
    if (!Number.isFinite(healthTimeoutMs) || healthTimeoutMs < 0) {
      throw new RuntimeError('RUNTIME_INVALID', 'healthTimeoutMs 不能为负数');
    }
    this._logger = logger || console;
    this._healthTimeoutMs = healthTimeoutMs;
    this._adapters = new Map();
  }

  register(adapter) {
    assertAdapter(adapter);
    if (this._adapters.has(adapter.runtimeId)) {
      throw new RuntimeError('RUNTIME_DUPLICATE', `运行时已注册：${adapter.runtimeId}`, 409);
    }
    this._adapters.set(adapter.runtimeId, adapter);
    return () => {
      if (this._adapters.get(adapter.runtimeId) !== adapter) return false;
      this._adapters.delete(adapter.runtimeId);
      return true;
    };
  }

  get(runtimeId) {
    return this._adapters.get(runtimeId) || null;
  }

  list() {
    return [...this._adapters.values()]
      .map((adapter) => Object.freeze({ runtimeId: adapter.runtimeId, kind: adapter.kind }))
      .sort((a, b) => (a.runtimeId < b.runtimeId ? -1 : a.runtimeId > b.runtimeId ? 1 : 0));
  }

  async health(runtimeId) {
    const adapter = this._required(runtimeId);
    try {
      const result = await withTimeout(
        Promise.resolve(adapter.health()),
        this._healthTimeoutMs,
        `${runtimeId} 健康检查超时`,
      );
      return normalizeHealth(adapter, result);
    } catch (err) {
      return Object.freeze({
        runtimeId: adapter.runtimeId,
        kind: adapter.kind,
        online: false,
        status: 0,
        error: (err && err.message ? String(err.message) : '运行环境不可用').slice(0, 500),
        details: Object.freeze({}),
      });
    }
  }

  async healthAll() {
    return Promise.all(this.list().map((item) => this.health(item.runtimeId)));
  }

  async start(runtimeId, instance) {
    return this._call(runtimeId, 'start', instance);
  }

  async stop(runtimeId, instance) {
    return this._call(runtimeId, 'stop', instance);
  }

  async invoke(runtimeId, instance, request, context) {
    return this._call(runtimeId, 'invoke', instance, request, context);
  }

  async cancel(runtimeId, instance, operationId) {
    return this._call(runtimeId, 'cancel', instance, operationId);
  }

  async dispose(runtimeId) {
    const adapter = this._adapters.get(runtimeId);
    if (!adapter) return false;
    try {
      if (typeof adapter.dispose === 'function') await adapter.dispose();
    } finally {
      this._adapters.delete(runtimeId);
    }
    return true;
  }

  _call(runtimeId, method, ...args) {
    const adapter = this._required(runtimeId);
    if (typeof adapter[method] !== 'function') {
      return Promise.reject(new RuntimeError('RUNTIME_UNSUPPORTED', `${runtimeId} 不支持 ${method}`, 501));
    }
    return Promise.resolve(adapter[method](...args));
  }

  _required(runtimeId) {
    const adapter = this._adapters.get(runtimeId);
    if (!adapter) {
      throw new RuntimeError('RUNTIME_NOT_FOUND', `运行时不存在：${runtimeId}`, 404);
    }
    return adapter;
  }
}

module.exports = { RuntimeManager, RuntimeError };
