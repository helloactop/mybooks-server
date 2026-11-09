/* ============================================================
 * 插件内核：把 Registry、Event Bus 与 Lifecycle 组装成宿主入口
 *
 * 这里只做组合与编排，不承载书库、安装、RPC 或权限算法；
 * 插件永远拿不到 Kernel 本身，只能拿到 Lifecycle 创建的 Context。
 * ============================================================ */

const { ServiceRegistry } = require('./registry');
const { EventBus } = require('./events');
const { PluginLifecycle } = require('./lifecycle');

class KernelError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'KernelError';
    this.code = code;
    this.status = status;
  }
}

class PluginKernel {
  constructor({ registry, events, logger } = {}) {
    this.logger = logger || console;
    this.registry = registry || new ServiceRegistry();
    this.events = events || new EventBus({ logger: this.logger });
    this._plugins = new Map();
    this._order = [];
    this._disposed = false;
  }

  define(spec = {}) {
    this._assertOpen();
    const lifecycle = new PluginLifecycle({
      ...spec,
      registry: this.registry,
      events: this.events,
      logger: this.logger,
    });
    if (this._plugins.has(lifecycle.instanceId)) {
      throw new KernelError('KERNEL_INSTANCE_DUPLICATE', `插件实例已存在：${lifecycle.instanceId}`, 409);
    }
    this._plugins.set(lifecycle.instanceId, lifecycle);
    this._order.push(lifecycle.instanceId);
    return lifecycle;
  }

  get(instanceId) {
    return this._plugins.get(instanceId) || null;
  }

  has(instanceId) {
    return this._plugins.has(instanceId);
  }

  list() {
    return this._order.map((instanceId) => this._plugins.get(instanceId).status());
  }

  async start(instanceId) {
    this._assertOpen();
    return this._required(instanceId).start();
  }

  async stop(instanceId) {
    this._assertOpen();
    return this._required(instanceId).stop();
  }

  async fail(instanceId, error) {
    this._assertOpen();
    return this._required(instanceId).fail(error);
  }

  async remove(instanceId) {
    this._assertOpen();
    const lifecycle = this._plugins.get(instanceId);
    if (!lifecycle) return false;
    await lifecycle.stop();
    this._plugins.delete(instanceId);
    this._order = this._order.filter((item) => item !== instanceId);
    return true;
  }

  async dispose() {
    if (this._disposed) return [];
    this._disposed = true;
    const errors = [];
    for (const instanceId of [...this._order].reverse()) {
      const lifecycle = this._plugins.get(instanceId);
      if (!lifecycle) continue;
      try {
        await lifecycle.stop();
      } catch (err) {
        errors.push(err);
      }
    }
    this._plugins.clear();
    this._order = [];
    this.events.disposeAll();
    return errors;
  }

  _required(instanceId) {
    const lifecycle = this._plugins.get(instanceId);
    if (!lifecycle) {
      throw new KernelError('KERNEL_INSTANCE_NOT_FOUND', `插件实例不存在：${instanceId}`, 404);
    }
    return lifecycle;
  }

  _assertOpen() {
    if (this._disposed) throw new KernelError('KERNEL_DISPOSED', '插件内核已关闭', 409);
  }
}

module.exports = { PluginKernel, KernelError };
