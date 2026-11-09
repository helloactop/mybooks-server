const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ServiceRegistry } = require('../src/core/plugins/registry');
const { PluginContext } = require('../src/core/plugins/context');

function provider(overrides = {}) {
  return {
    capability: 'metadata.search',
    version: '1',
    providerId: 'douban',
    instanceId: 'inst.alpha',
    priority: 100,
    invoke: async () => ({ candidates: [] }),
    ...overrides,
  };
}

function fakeEvents() {
  const listeners = new Map();
  const options = new Map();
  return {
    on(event, handler, opts) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      options.set(event, opts);
      return () => listeners.get(event).delete(handler);
    },
    count(event) {
      return listeners.has(event) ? listeners.get(event).size : 0;
    },
    lastOptions(event) {
      return options.get(event);
    },
  };
}

test('身份对象只读，并补全 providerId / pluginId', () => {
  const ctx = new PluginContext({ instanceId: 'inst.alpha', providerId: 'douban' });
  assert.deepEqual(ctx.plugin, {
    instanceId: 'inst.alpha',
    providerId: 'douban',
    pluginId: 'inst.alpha',
  });
  assert.equal(Object.isFrozen(ctx.plugin), true);
  assert.equal(Reflect.set(ctx.plugin, 'instanceId', 'inst.beta'), false);
});

test('register 自动绑定实例身份，禁止冒用其他实例', () => {
  const registry = new ServiceRegistry();
  const ctx = new PluginContext({ instanceId: 'inst.alpha', providerId: 'douban', registry });

  const dispose = ctx.register(provider());
  assert.equal(registry.get('metadata.search', '1', 'douban').instanceId, 'inst.alpha');
  assert.throws(
    () => ctx.register(provider({ instanceId: 'inst.beta' })),
    (err) => err.code === 'CONTEXT_IDENTITY_MISMATCH' && err.status === 403,
  );

  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.deepEqual(registry.list('metadata.search', '1'), []);
});

test('on 把监听器登记到 Event Bus，dispose 时注销', () => {
  const events = fakeEvents();
  const ctx = new PluginContext({ instanceId: 'inst.alpha', events });

  ctx.on('book.imported', () => {});
  ctx.on('book.imported', () => {});
  assert.equal(events.count('book.imported'), 2);
  assert.deepEqual(events.lastOptions('book.imported'), { instanceId: 'inst.alpha' });

  ctx.dispose();
  assert.equal(events.count('book.imported'), 0);
});

test('dispose 逆序执行 disposer，单个失败不阻断其余清理', () => {
  const ctx = new PluginContext({ instanceId: 'inst.alpha' });
  const order = [];
  ctx.track(() => order.push('first'));
  ctx.track(() => {
    order.push('second');
    throw new Error('boom');
  });
  ctx.track(() => order.push('third'));

  const errors = ctx.dispose();
  assert.deepEqual(order, ['third', 'second', 'first']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'boom');
  assert.deepEqual(ctx.dispose(), []);
});

test('dispose 后拒绝新注册，迟到的 disposer 立即执行', () => {
  const ctx = new PluginContext({ instanceId: 'inst.alpha' });
  ctx.dispose();
  let cleaned = 0;

  assert.throws(
    () => ctx.track(() => { cleaned += 1; }),
    (err) => err.code === 'CONTEXT_DISPOSED' && err.status === 409,
  );
  assert.equal(cleaned, 1);
  assert.throws(() => ctx.register(provider()), (err) => err.code === 'CONTEXT_DISPOSED');
  assert.throws(() => ctx.on('book.imported', () => {}), (err) => err.code === 'CONTEXT_DISPOSED');
});

test('未绑定 Registry / Event Bus 时给出 CONTEXT_UNAVAILABLE', () => {
  const ctx = new PluginContext({ instanceId: 'inst.alpha' });
  assert.throws(() => ctx.register(provider()), (err) => err.code === 'CONTEXT_UNAVAILABLE');
  assert.throws(() => ctx.on('book.imported', () => {}), (err) => err.code === 'CONTEXT_UNAVAILABLE');
});

test('非法输入被拒绝', () => {
  assert.throws(() => new PluginContext({ instanceId: '' }), (err) => err.code === 'CONTEXT_INVALID_INPUT');
  assert.throws(() => new PluginContext({ instanceId: 'bad id' }), (err) => err.code === 'CONTEXT_INVALID_INPUT');
  assert.throws(() => new PluginContext({ instanceId: 'inst.alpha', providerId: '' }), (err) => err.code === 'CONTEXT_INVALID_INPUT');

  const ctx = new PluginContext({ instanceId: 'inst.alpha' });
  assert.throws(() => ctx.track(null), (err) => err.code === 'CONTEXT_INVALID_INPUT');

  const wired = new PluginContext({ instanceId: 'inst.alpha', registry: new ServiceRegistry() });
  assert.throws(() => wired.register(null), (err) => err.code === 'CONTEXT_INVALID_INPUT');
});

test('on 校验事件名与处理器', () => {
  const ctx = new PluginContext({ instanceId: 'inst.alpha', events: fakeEvents() });
  assert.throws(() => ctx.on('', () => {}), (err) => err.code === 'CONTEXT_INVALID_INPUT');
  assert.throws(() => ctx.on('book.imported', null), (err) => err.code === 'CONTEXT_INVALID_INPUT');
  assert.throws(() => ctx.on('x'.repeat(129), () => {}), (err) => err.code === 'CONTEXT_INVALID_INPUT');
});

test('logger 带实例前缀，且不把日志异常抛给插件', () => {
  const lines = [];
  const ctx = new PluginContext({
    instanceId: 'inst.log',
    logger: { info: (...args) => lines.push(args) },
  });

  ctx.logger.info('hello', 1);
  assert.deepEqual(lines[0], ['[plugin:inst.log]', 'hello', 1]);
  assert.doesNotThrow(() => ctx.logger.debug('fallback missing'));
  assert.doesNotThrow(() => ctx.logger.warn('still works'));
  assert.equal(Object.isFrozen(ctx.logger), true);
});
