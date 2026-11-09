const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PluginKernel } = require('../src/core/plugins/kernel');
const { ServiceRegistry } = require('../src/core/plugins/registry');
const { EventBus } = require('../src/core/plugins/events');

function provider(overrides = {}) {
  return {
    capability: 'metadata.search',
    version: '1',
    providerId: 'douban',
    priority: 100,
    invoke: async () => ({ candidates: [] }),
    ...overrides,
  };
}

function kernelWith(options = {}) {
  return new PluginKernel({ logger: { error() {}, warn() {} }, ...options });
}

test('define 登记实例并返回 installed 状态的 lifecycle', () => {
  const kernel = kernelWith();
  const lifecycle = kernel.define({
    instanceId: 'inst.alpha',
    providerId: 'douban',
    activate: async (ctx) => { ctx.register(provider()); },
  });

  assert.equal(kernel.get('inst.alpha'), lifecycle);
  assert.equal(kernel.has('inst.alpha'), true);
  assert.equal(kernel.get('missing'), null);
  assert.deepEqual(kernel.list(), [{ instanceId: 'inst.alpha', state: 'installed', lastError: '' }]);
  assert.equal(Object.isFrozen(kernel.list()[0]), true);
});

test('重复实例显式报错', () => {
  const kernel = kernelWith();
  const spec = { instanceId: 'inst.alpha', activate: async () => {} };
  kernel.define(spec);
  assert.throws(
    () => kernel.define(spec),
    (err) => err.code === 'KERNEL_INSTANCE_DUPLICATE' && err.status === 409,
  );
});

test('start / stop 复用注入的 Registry 与 EventBus', async () => {
  const registry = new ServiceRegistry();
  const events = new EventBus({ logger: { error() {} } });
  const kernel = kernelWith({ registry, events });
  kernel.define({
    instanceId: 'inst.alpha',
    providerId: 'douban',
    activate: async (ctx) => { ctx.register(provider()); },
  });

  await kernel.start('inst.alpha');
  assert.equal(kernel.get('inst.alpha').state, 'active');
  assert.equal(registry.list('metadata.search', '1').length, 1);

  await kernel.stop('inst.alpha');
  assert.equal(kernel.get('inst.alpha').state, 'disabled');
  assert.deepEqual(registry.list('metadata.search', '1'), []);
});

test('未知实例的 start / stop / fail 返回 KERNEL_INSTANCE_NOT_FOUND', async () => {
  const kernel = kernelWith();
  for (const method of ['start', 'stop']) {
    await assert.rejects(
      () => kernel[method]('missing'),
      (err) => err.code === 'KERNEL_INSTANCE_NOT_FOUND' && err.status === 404,
    );
  }
  await assert.rejects(
    () => kernel.fail('missing', new Error('x')),
    (err) => err.code === 'KERNEL_INSTANCE_NOT_FOUND',
  );
});

test('remove 先停止再移除，重复移除返回 false', async () => {
  const kernel = kernelWith();
  kernel.define({
    instanceId: 'inst.alpha',
    providerId: 'douban',
    activate: async (ctx) => { ctx.register(provider()); },
  });
  await kernel.start('inst.alpha');

  assert.equal(await kernel.remove('inst.alpha'), true);
  assert.equal(kernel.has('inst.alpha'), false);
  assert.equal(await kernel.remove('inst.alpha'), false);
});

test('dispose 逆序停止全部实例、清空事件并关闭内核', async () => {
  const kernel = kernelWith();
  const order = [];
  kernel.define({
    instanceId: 'inst.one',
    providerId: 'one',
    activate: async (ctx) => { ctx.register(provider({ providerId: 'one' })); },
    deactivate: async () => order.push('one'),
  });
  kernel.define({
    instanceId: 'inst.two',
    providerId: 'two',
    activate: async (ctx) => { ctx.register(provider({ providerId: 'two' })); },
    deactivate: async () => order.push('two'),
  });
  kernel.define({
    instanceId: 'inst.listener',
    providerId: 'listener',
    activate: async (ctx) => { ctx.on('book.imported', () => {}); },
  });
  await kernel.start('inst.one');
  await kernel.start('inst.two');
  await kernel.start('inst.listener');
  assert.equal(kernel.events.listenerCount('book.imported'), 1);

  assert.deepEqual(await kernel.dispose(), []);
  assert.deepEqual(order, ['two', 'one']);
  assert.deepEqual(kernel.list(), []);
  assert.equal(kernel.events.listenerCount('book.imported'), 0);

  assert.throws(
    () => kernel.define({ instanceId: 'inst.three', activate: async () => {} }),
    (err) => err.code === 'KERNEL_DISPOSED' && err.status === 409,
  );
  await assert.rejects(
    () => kernel.start('inst.one'),
    (err) => err.code === 'KERNEL_DISPOSED',
  );
  assert.deepEqual(await kernel.dispose(), []);
});

test('插件经 Context 订阅事件，停用后立即停止接收', async () => {
  const kernel = kernelWith();
  const received = [];
  kernel.define({
    instanceId: 'inst.listener',
    providerId: 'listener',
    activate: async (ctx) => {
      ctx.on('book.imported', (payload, meta) => received.push([payload, meta.traceId]));
    },
  });

  await kernel.start('inst.listener');
  kernel.events.emit('book.imported', { bookId: 7 }, { traceId: 'trace-7' });
  assert.deepEqual(received, [[{ bookId: 7 }, 'trace-7']]);

  await kernel.stop('inst.listener');
  kernel.events.emit('book.imported', { bookId: 8 });
  assert.equal(received.length, 1);
});

test('fail 立即撤销能力并记录错误', async () => {
  const registry = new ServiceRegistry();
  const kernel = kernelWith({ registry });
  kernel.define({
    instanceId: 'inst.alpha',
    providerId: 'douban',
    activate: async (ctx) => { ctx.register(provider()); },
  });
  await kernel.start('inst.alpha');

  await kernel.fail('inst.alpha', new Error('worker lost'));
  assert.equal(kernel.get('inst.alpha').state, 'error');
  assert.match(kernel.get('inst.alpha').lastError, /worker lost/);
  assert.deepEqual(registry.list('metadata.search', '1'), []);
});

test('define 透传 Lifecycle 配置校验', () => {
  const kernel = kernelWith();
  assert.throws(
    () => kernel.define({ instanceId: 'bad id', activate: async () => {} }),
    (err) => err.code === 'LIFECYCLE_INVALID_CONFIG',
  );
  assert.throws(
    () => kernel.define({ instanceId: 'inst.noop' }),
    (err) => err.code === 'LIFECYCLE_INVALID_CONFIG',
  );
});

test('Kernel 的 GrantStore 传入 Context，未授权时启动失败', async () => {
  const kernel = kernelWith();
  kernel.define({
    instanceId: 'inst.alpha',
    providerId: 'douban',
    activate: async (ctx) => {
      ctx.permissions.require('metadata.read');
      ctx.register(provider());
    },
  });

  await assert.rejects(
    () => kernel.start('inst.alpha'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );
  assert.equal(kernel.get('inst.alpha').state, 'error');

  kernel.grants.grant('inst.alpha', 'metadata.read');
  await kernel.start('inst.alpha');
  assert.equal(kernel.get('inst.alpha').state, 'active');
});
