const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ServiceRegistry } = require('../src/core/plugins/registry');
const { PluginLifecycle } = require('../src/core/plugins/lifecycle');

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function build({ activate, deactivate, instanceId = 'inst.alpha', providerId = 'douban' } = {}) {
  const registry = new ServiceRegistry();
  const lifecycle = new PluginLifecycle({
    instanceId,
    providerId,
    registry,
    activate: activate || (async (ctx) => { ctx.register(provider()); }),
    deactivate,
  });
  return { registry, lifecycle };
}

test('start 激活后进入 active，注册的能力可查询', async () => {
  let seen = null;
  const { registry, lifecycle } = build({
    activate: async (ctx) => {
      seen = ctx.plugin;
      ctx.register(provider());
    },
  });

  assert.equal(lifecycle.state, 'installed');
  await lifecycle.start();
  assert.equal(lifecycle.state, 'active');
  assert.deepEqual(seen, { instanceId: 'inst.alpha', providerId: 'douban', pluginId: 'inst.alpha' });
  assert.equal(registry.list('metadata.search', '1').length, 1);
});

test('并发 start 共享同一个 promise，只激活一次', async () => {
  let activations = 0;
  const gate = deferred();
  const { lifecycle } = build({
    activate: async (ctx) => {
      activations += 1;
      await gate.promise;
      ctx.register(provider());
    },
  });

  const first = lifecycle.start();
  const second = lifecycle.start();
  assert.equal(first, second);

  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(activations, 1);

  await lifecycle.start();
  assert.equal(activations, 1);
});

test('激活失败会回滚已注册资源并记录 lastError，可重试', async () => {
  let attempts = 0;
  const { registry, lifecycle } = build({
    activate: async (ctx) => {
      attempts += 1;
      ctx.register(provider());
      if (attempts === 1) throw new Error('boom');
    },
  });

  await assert.rejects(() => lifecycle.start(), /boom/);
  assert.equal(lifecycle.state, 'error');
  assert.match(lifecycle.lastError, /boom/);
  assert.deepEqual(registry.list('metadata.search', '1'), []);

  await lifecycle.start();
  assert.equal(lifecycle.state, 'active');
  assert.equal(registry.list('metadata.search', '1').length, 1);
});

test('stop 先摘能力，再执行 deactivate，最后注销资源', async () => {
  const calls = [];
  let visibleDuringDeactivate = null;
  const { registry, lifecycle } = build({
    activate: async (ctx) => {
      calls.push('activate');
      ctx.register(provider());
    },
    deactivate: async () => {
      calls.push('deactivate');
      visibleDuringDeactivate = registry.list('metadata.search', '1').length;
    },
  });

  await lifecycle.start();
  await lifecycle.stop();

  assert.deepEqual(calls, ['activate', 'deactivate']);
  assert.equal(visibleDuringDeactivate, 0);
  assert.equal(registry.list('metadata.search', '1').length, 0);
  assert.equal(lifecycle.state, 'disabled');

  await lifecycle.stop();
  assert.equal(calls.filter((item) => item === 'deactivate').length, 1);
});

test('未启动直接 stop 进入 disabled，且不调用 deactivate', async () => {
  let deactivated = 0;
  const { lifecycle } = build({
    activate: async () => {},
    deactivate: async () => { deactivated += 1; },
  });

  await lifecycle.stop();
  assert.equal(lifecycle.state, 'disabled');
  assert.equal(deactivated, 0);
});

test('start 进行中调用 stop，会等激活完成后再停用', async () => {
  const gate = deferred();
  const { registry, lifecycle } = build({
    activate: async (ctx) => {
      await gate.promise;
      ctx.register(provider());
    },
  });

  const startPromise = lifecycle.start();
  const stopPromise = lifecycle.stop();
  gate.resolve();

  await startPromise;
  await stopPromise;
  assert.equal(lifecycle.state, 'disabled');
  assert.equal(registry.list('metadata.search', '1').length, 0);
});

test('运行中 fail 立即撤销能力并进入 error', async () => {
  const { registry, lifecycle } = build();
  await lifecycle.start();
  assert.equal(registry.list('metadata.search', '1').length, 1);

  await lifecycle.fail(new Error('worker lost'));
  assert.equal(lifecycle.state, 'error');
  assert.match(lifecycle.lastError, /worker lost/);
  assert.equal(registry.list('metadata.search', '1').length, 0);
});

test('deactivate 失败仍会注销资源，并进入 error', async () => {
  const { registry, lifecycle } = build({
    deactivate: async () => { throw new Error('deactivate boom'); },
  });

  await lifecycle.start();
  await assert.rejects(() => lifecycle.stop(), /deactivate boom/);
  assert.equal(lifecycle.state, 'error');
  assert.match(lifecycle.lastError, /deactivate boom/);
  assert.equal(registry.list('metadata.search', '1').length, 0);
});

test('disposer 清理失败会抛出 LIFECYCLE_CLEANUP_FAILED', async () => {
  const { registry, lifecycle } = build({
    activate: async (ctx) => {
      ctx.register(provider());
      ctx.track(() => { throw new Error('cleanup boom'); });
    },
  });

  await lifecycle.start();
  await assert.rejects(
    () => lifecycle.stop(),
    (err) => err.code === 'LIFECYCLE_CLEANUP_FAILED' && err.status === 500,
  );
  assert.equal(lifecycle.state, 'error');
  assert.match(lifecycle.lastError, /cleanup boom/);
  assert.equal(registry.list('metadata.search', '1').length, 0);
});

test('status 返回不可变快照', () => {
  const { lifecycle } = build();
  const status = lifecycle.status();
  assert.deepEqual(status, { instanceId: 'inst.alpha', state: 'installed', lastError: '' });
  assert.equal(Object.isFrozen(status), true);
});

test('非法配置被拒绝', () => {
  assert.throws(
    () => new PluginLifecycle({ instanceId: 'bad id', activate: async () => {} }),
    (err) => err.code === 'LIFECYCLE_INVALID_CONFIG',
  );
  assert.throws(
    () => new PluginLifecycle({ instanceId: 'ok', activate: null }),
    (err) => err.code === 'LIFECYCLE_INVALID_CONFIG',
  );
  assert.throws(
    () => new PluginLifecycle({ instanceId: 'ok', activate: async () => {}, deactivate: 'nope' }),
    (err) => err.code === 'LIFECYCLE_INVALID_CONFIG',
  );
  assert.throws(
    () => new PluginLifecycle({ instanceId: 'ok', providerId: 'bad id', activate: async () => {} }),
    (err) => err.code === 'LIFECYCLE_INVALID_CONFIG',
  );
});

test('激活阶段自行 dispose 上下文会被视为失败', async () => {
  const { registry, lifecycle } = build({
    activate: async (ctx) => {
      ctx.register(provider());
      ctx.dispose();
    },
  });

  await assert.rejects(
    () => lifecycle.start(),
    (err) => err.code === 'LIFECYCLE_CONTEXT_DISPOSED',
  );
  assert.equal(lifecycle.state, 'error');
  assert.deepEqual(registry.list('metadata.search', '1'), []);
});
