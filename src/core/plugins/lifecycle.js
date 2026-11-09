/* ============================================================
 * 插件生命周期：installed → starting → active → stopping → disabled
 *
 * 规则：
 *   · start()/stop() 幂等；并发启动共享同一个 promise，不会双注册；
 *   · 激活失败必须逆序释放已注册资源，并记录 lastError；
 *   · 停用先撤销能力（Registry 立即拒绝新调用），再执行 deactivate，
 *     最后注销 Context 中的全部资源；
 *   · 运行中失联由宿主调用 fail()，直接撤销能力并进入 error。
 * ============================================================ */

const { PLUGIN_ID_RE } = require('./registry');
const { PluginContext } = require('./context');

const LIFECYCLE_STATES = Object.freeze([
  'discovered',
  'validated',
  'installed',
  'disabled',
  'starting',
  'active',
  'stopping',
  'error',
]);

class LifecycleError extends Error {
  constructor(code, message, status = 400, details) {
    super(message || code);
    this.name = 'LifecycleError';
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function errorText(err, cleanupErrors) {
  const base = err && err.message ? err.message : String(err);
  const suffix = (cleanupErrors || [])
    .map((item) => (item && item.message ? item.message : String(item)))
    .join('; ');
  return (suffix ? `${base}; 清理失败: ${suffix}` : base).slice(0, 2000);
}

class PluginLifecycle {
  constructor({
    instanceId,
    providerId,
    pluginId,
    activate,
    deactivate,
    registry,
    events,
    grants,
    logger,
  } = {}) {
    if (typeof instanceId !== 'string' || !PLUGIN_ID_RE.test(instanceId)) {
      throw new LifecycleError('LIFECYCLE_INVALID_CONFIG', 'instanceId 不合法');
    }
    if (providerId !== undefined && (typeof providerId !== 'string' || !PLUGIN_ID_RE.test(providerId))) {
      throw new LifecycleError('LIFECYCLE_INVALID_CONFIG', 'providerId 不合法');
    }
    if (pluginId !== undefined && (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId))) {
      throw new LifecycleError('LIFECYCLE_INVALID_CONFIG', 'pluginId 不合法');
    }
    if (typeof activate !== 'function') {
      throw new LifecycleError('LIFECYCLE_INVALID_CONFIG', 'activate 必须是函数');
    }
    if (deactivate !== undefined && typeof deactivate !== 'function') {
      throw new LifecycleError('LIFECYCLE_INVALID_CONFIG', 'deactivate 必须是函数');
    }

    this._instanceId = instanceId;
    this._providerId = providerId || instanceId;
    this._pluginId = pluginId || instanceId;
    this._activate = activate;
    this._deactivate = deactivate || null;
    this._registry = registry || null;
    this._events = events || null;
    this._grants = grants || null;
    this._logger = logger || console;
    this._state = 'installed';
    this._lastError = '';
    this._context = null;
    this._startPromise = null;
    this._stopPromise = null;
  }

  get state() {
    return this._state;
  }

  get lastError() {
    return this._lastError;
  }

  get instanceId() {
    return this._instanceId;
  }

  status() {
    return Object.freeze({
      instanceId: this._instanceId,
      state: this._state,
      lastError: this._lastError,
    });
  }

  start() {
    if (this._startPromise) return this._startPromise;
    if (this._stopPromise) {
      return this._stopPromise.then(() => this.start(), () => this.start());
    }
    if (this._state === 'active') return Promise.resolve(this);

    const run = this._doStart();
    const tracked = run.finally(() => { this._startPromise = null; });
    this._startPromise = tracked;
    return tracked;
  }

  stop() {
    if (this._stopPromise) return this._stopPromise;
    if (this._startPromise) {
      return this._startPromise.catch(() => {}).then(() => this.stop());
    }
    if (!this._context) {
      this._state = 'disabled';
      this._lastError = '';
      return Promise.resolve(this);
    }

    const run = this._doStop();
    const tracked = run.finally(() => { this._stopPromise = null; });
    this._stopPromise = tracked;
    return tracked;
  }

  async fail(error) {
    if (this._startPromise) {
      try { await this._startPromise; } catch { /* start 已记录 */ }
    }
    if (this._stopPromise) {
      try { await this._stopPromise; } catch { /* stop 已记录 */ }
    }
    const ctx = this._context;
    this._context = null;
    try { this._setActive(false); } catch { /* 失败路径保留原始错误 */ }
    const cleanupErrors = ctx ? ctx.dispose() : [];
    this._state = 'error';
    this._lastError = errorText(error, cleanupErrors);
    return this;
  }

  async _doStart() {
    this._state = 'starting';
    this._lastError = '';
    let ctx = null;
    try {
      this._setActive(true);
      ctx = new PluginContext({
        instanceId: this._instanceId,
        providerId: this._providerId,
        pluginId: this._pluginId,
        registry: this._registry,
        events: this._events,
        grants: this._grants,
        logger: this._logger,
      });
      this._context = ctx;
      await this._activate(ctx);
      if (ctx.disposed) {
        throw new LifecycleError('LIFECYCLE_CONTEXT_DISPOSED', '插件在激活阶段释放了上下文', 409);
      }
      this._state = 'active';
      return this;
    } catch (err) {
      this._context = null;
      const cleanupErrors = ctx ? ctx.dispose() : [];
      try { this._setActive(false); } catch { /* 原始错误优先 */ }
      this._state = 'error';
      this._lastError = errorText(err, cleanupErrors);
      throw err;
    }
  }

  async _doStop() {
    this._state = 'stopping';
    const ctx = this._context;
    let actionError = null;

    try { this._setActive(false); } catch (err) { actionError = err; }
    try {
      if (this._deactivate) await this._deactivate(ctx);
    } catch (err) {
      if (!actionError) actionError = err;
    }
    const cleanupErrors = ctx ? ctx.dispose() : [];
    this._context = null;

    if (actionError) {
      this._state = 'error';
      this._lastError = errorText(actionError, cleanupErrors);
      throw actionError;
    }
    if (cleanupErrors.length) {
      const error = new LifecycleError(
        'LIFECYCLE_CLEANUP_FAILED',
        '插件资源清理失败',
        500,
        cleanupErrors.map((item) => (item && item.message ? item.message : String(item))),
      );
      this._state = 'error';
      this._lastError = errorText(error, cleanupErrors);
      throw error;
    }

    this._state = 'disabled';
    this._lastError = '';
    return this;
  }

  _setActive(active) {
    if (!this._registry) return;
    try {
      this._registry.setInstanceActive(this._instanceId, active);
    } catch (err) {
      if (err && err.code === 'REGISTRY_UNKNOWN_INSTANCE') return;
      throw err;
    }
  }
}

module.exports = { PluginLifecycle, LifecycleError, LIFECYCLE_STATES };
