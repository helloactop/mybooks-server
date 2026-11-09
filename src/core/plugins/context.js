/* ============================================================
 * 插件上下文：绑定实例身份，并记录该实例产生的所有副作用
 *
 * 插件只能拿到这个对象，不能拿到 Registry、Express app、数据库或密钥。
 * register() / on() / track() 都返回幂等 disposer，dispose() 逆序释放；
 * dispose 之后的新注册会被拒绝，迟到的 disposer 会立即执行以避免泄漏。
 *
 * 内部状态放在 WeakMap 中，实例上不保留任何 _registry / _grants 之类的
 * 可枚举字段；插件即使拿到 Context 也无法通过属性访问宿主可变对象。
 * 注意：这只是“不主动泄漏”的封装，不能替代进程/容器级隔离。
 * ============================================================ */

const { PLUGIN_ID_RE } = require('./registry');

const EVENT_NAME_MAX = 128;

// 每个实例的私有状态：外部无法枚举，也无法从 Context 上取回。
const STATE = new WeakMap();

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

function stateOf(ctx) {
  const state = STATE.get(ctx);
  if (!state) throw new ContextError('CONTEXT_INVALID_INPUT', '插件上下文不合法');
  return state;
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

    const state = {
      instanceId,
      registry: registry || null,
      events: events || null,
      grants: grants || null,
      disposers: [],
      disposed: false,
    };
    STATE.set(this, state);

    this.plugin = Object.freeze({
      instanceId,
      providerId: providerId || instanceId,
      pluginId: pluginId || instanceId,
    });
    this.logger = makeLogger(instanceId, logger);

    // 闭包只捕获私有 state，不捕获 this 以外的宿主对象。
    this.permissions = Object.freeze({
      can: (permission, resource) => {
        if (!state.grants || state.disposed) return false;
        return state.grants.has(state.instanceId, permission, resource);
      },
      require: (permission, resource) => {
        if (state.disposed) {
          throw new ContextError('CONTEXT_DISPOSED', '插件上下文已释放', 409);
        }
        if (!state.grants) throw new ContextError('CONTEXT_UNAVAILABLE', '上下文未绑定 Permission Store');
        return state.grants.require(state.instanceId, permission, resource);
      },
    });

    // 冻结实例：插件无法给 Context 挂载新的内部引用，也无法替换方法。
    Object.freeze(this);
  }

  get disposed() {
    return stateOf(this).disposed;
  }

  assertActive() {
    if (stateOf(this).disposed) throw new ContextError('CONTEXT_DISPOSED', '插件上下文已释放', 409);
  }

  register(spec = {}) {
    const state = stateOf(this);
    if (state.disposed) throw new ContextError('CONTEXT_DISPOSED', '插件上下文已释放', 409);
    if (!state.registry) throw new ContextError('CONTEXT_UNAVAILABLE', '上下文未绑定 Registry');
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new ContextError('CONTEXT_INVALID_INPUT', '注册参数必须是对象');
    }
    if (spec.instanceId !== undefined && spec.instanceId !== state.instanceId) {
      throw new ContextError('CONTEXT_IDENTITY_MISMATCH', '插件不能以其他实例身份注册', 403);
    }
    const dispose = state.registry.register({ ...spec, instanceId: state.instanceId });
    return this.track(dispose);
  }

  on(event, handler) {
    const state = stateOf(this);
    if (state.disposed) throw new ContextError('CONTEXT_DISPOSED', '插件上下文已释放', 409);
    if (!state.events || typeof state.events.on !== 'function') {
      throw new ContextError('CONTEXT_UNAVAILABLE', '上下文未绑定 Event Bus');
    }
    if (typeof event !== 'string' || event.length === 0 || event.length > EVENT_NAME_MAX) {
      throw new ContextError('CONTEXT_INVALID_INPUT', '事件名不合法');
    }
    if (typeof handler !== 'function') {
      throw new ContextError('CONTEXT_INVALID_INPUT', '事件处理器必须是函数');
    }
    const dispose = state.events.on(event, handler, { instanceId: state.instanceId });
    return this.track(dispose);
  }

  track(disposer) {
    const state = stateOf(this);
    if (typeof disposer !== 'function') {
      throw new ContextError('CONTEXT_INVALID_INPUT', 'disposer 必须是函数');
    }
    if (state.disposed) {
      try { disposer(); } catch { /* 迟到的清理仍需尝试 */ }
      throw new ContextError('CONTEXT_DISPOSED', '插件上下文已释放', 409);
    }

    let done = false;
    const wrapped = () => {
      if (done) return false;
      done = true;
      const index = state.disposers.indexOf(wrapped);
      if (index !== -1) state.disposers.splice(index, 1);
      disposer();
      return true;
    };
    state.disposers.push(wrapped);
    return wrapped;
  }

  dispose() {
    const state = stateOf(this);
    if (state.disposed) return [];
    state.disposed = true;
    const pending = state.disposers.splice(0).reverse();
    const errors = [];
    for (const fn of pending) {
      try { fn(); } catch (err) { errors.push(err); }
    }
    return errors;
  }
}

module.exports = { PluginContext, ContextError };
