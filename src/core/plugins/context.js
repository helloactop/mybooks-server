/* ============================================================
 * 插件上下文：绑定实例身份，并记录该实例产生的所有副作用
 *
 * 插件只能拿到这个对象，不能拿到 Registry、Express app、数据库或密钥。
 * register() / on() / track() 都返回幂等 disposer，dispose() 逆序释放；
 * dispose 之后的新注册会被拒绝，迟到的 disposer 会立即执行以避免泄漏。
 * ============================================================ */

const { PLUGIN_ID_RE } = require('./registry');

const EVENT_NAME_MAX = 128;

class ContextError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'ContextError';
    this.code = code;
    this.status = status;
  }
}

function makeLogger(instanceId, sink) {
  const base = sink || console;
  const emit = (level, fallback) => (...args) => {
    const fn = typeof base[level] === 'function' ? base[level] : base[fallback];
    if (typeof fn !== 'function') return;
    try {
      fn.call(base, `[plugin:${instanceId}]`, ...args);
    } catch {
      // 日志失败不能影响插件业务
    }
  };
  return Object.freeze({
    debug: emit('debug', 'log'),
    info: emit('info', 'log'),
    warn: emit('warn', 'warn'),
    error: emit('error', 'error'),
  });
}

class PluginContext {
  constructor({ instanceId, providerId, pluginId, registry, events, grants, logger } = {}) {
    if (typeof instanceId !== 'string' || !PLUGIN_ID_RE.test(instanceId)) {
      throw new ContextError('CONTEXT_INVALID_INPUT', 'instanceId 不合法');
    }
    if (providerId !== undefined && (typeof providerId !== 'string' || !PLUGIN_ID_RE.test(providerId))) {
      throw new ContextError('CONTEXT_INVALID_INPUT', 'providerId 不合法');
    }
    if (pluginId !== undefined && (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId))) {
      throw new ContextError('CONTEXT_INVALID_INPUT', 'pluginId 不合法');
    }

    this.plugin = Object.freeze({
      instanceId,
      providerId: providerId || instanceId,
      pluginId: pluginId || instanceId,
    });
    this.logger = makeLogger(instanceId, logger);
    this._registry = registry || null;
    this._events = events || null;
    this._grants = grants || null;
    this._disposers = [];
    this._disposed = false;
    this.permissions = Object.freeze({
      can: (permission, resource) => {
        if (!this._grants || this._disposed) return false;
        return this._grants.has(this.plugin.instanceId, permission, resource);
      },
      require: (permission, resource) => {
        this.assertActive();
        if (!this._grants) throw new ContextError('CONTEXT_UNAVAILABLE', '上下文未绑定 Permission Store');
        return this._grants.require(this.plugin.instanceId, permission, resource);
      },
    });
  }

  get disposed() {
    return this._disposed;
  }

  assertActive() {
    if (this._disposed) throw new ContextError('CONTEXT_DISPOSED', '插件上下文已释放', 409);
  }

  register(spec = {}) {
    this.assertActive();
    if (!this._registry) throw new ContextError('CONTEXT_UNAVAILABLE', '上下文未绑定 Registry');
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new ContextError('CONTEXT_INVALID_INPUT', '注册参数必须是对象');
    }
    if (spec.instanceId !== undefined && spec.instanceId !== this.plugin.instanceId) {
      throw new ContextError('CONTEXT_IDENTITY_MISMATCH', '插件不能以其他实例身份注册', 403);
    }
    const dispose = this._registry.register({ ...spec, instanceId: this.plugin.instanceId });
    return this.track(dispose);
  }

  on(event, handler) {
    this.assertActive();
    if (!this._events || typeof this._events.on !== 'function') {
      throw new ContextError('CONTEXT_UNAVAILABLE', '上下文未绑定 Event Bus');
    }
    if (typeof event !== 'string' || event.length === 0 || event.length > EVENT_NAME_MAX) {
      throw new ContextError('CONTEXT_INVALID_INPUT', '事件名不合法');
    }
    if (typeof handler !== 'function') {
      throw new ContextError('CONTEXT_INVALID_INPUT', '事件处理器必须是函数');
    }
    const dispose = this._events.on(event, handler, { instanceId: this.plugin.instanceId });
    return this.track(dispose);
  }

  track(disposer) {
    if (typeof disposer !== 'function') {
      throw new ContextError('CONTEXT_INVALID_INPUT', 'disposer 必须是函数');
    }
    if (this._disposed) {
      try { disposer(); } catch { /* 迟到的清理仍需尝试 */ }
      throw new ContextError('CONTEXT_DISPOSED', '插件上下文已释放', 409);
    }

    let done = false;
    const wrapped = () => {
      if (done) return false;
      done = true;
      const index = this._disposers.indexOf(wrapped);
      if (index !== -1) this._disposers.splice(index, 1);
      disposer();
      return true;
    };
    this._disposers.push(wrapped);
    return wrapped;
  }

  dispose() {
    if (this._disposed) return [];
    this._disposed = true;
    const pending = this._disposers.splice(0).reverse();
    const errors = [];
    for (const fn of pending) {
      try { fn(); } catch (err) { errors.push(err); }
    }
    return errors;
  }
}

module.exports = { PluginContext, ContextError };
