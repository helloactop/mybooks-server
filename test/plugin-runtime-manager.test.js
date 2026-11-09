const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RuntimeManager } = require('../src/core/plugins/runtime-manager');

function adapter(overrides = {}) {
  return {
    runtimeId: 'runtime-a',
    kind: 'test',
    health: async () => ({ online: true, status: 200, details: { loaded: 1 } }),
    ...overrides,
  };
}

test('注册、查询、列出与幂等 disposer', () => {
  const manager = new RuntimeManager();
  const dispose = manager.register(adapter());

  assert.equal(manager.get('runtime-a').kind, 'test');
  assert.deepEqual(manager.list(), [{ runtimeId: 'runtime-a', kind: 'test' }]);
  assert.equal(manager.get('missing'), null);

  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.equal(manager.get('runtime-a'), null);
});

test('重复 runtimeId 与非法适配器显式报错', () => {
  const manager = new RuntimeManager();
  manager.register(adapter());
  assert.throws(
    () => manager.register(adapter()),
    (err) => err.code === 'RUNTIME_DUPLICATE' && err.status === 409,
  );

  for (const bad of [null, {}, { runtimeId: 'bad id', kind: 'x', health: async () => ({}) },
    { runtimeId: 'ok', kind: '', health: async () => ({}) },
    { runtimeId: 'ok', kind: 'x' }]) {
    assert.throws(() => manager.register(bad), (err) => err.code === 'RUNTIME_INVALID');
  }
});

test('health 返回归一化结果，失败返回 offline 而不是抛出', async () => {
  const manager = new RuntimeManager();
  manager.register(adapter());

  const healthy = await manager.health('runtime-a');
  assert.deepEqual(healthy, {
    runtimeId: 'runtime-a',
    kind: 'test',
    online: true,
    status: 200,
    error: '',
    details: { loaded: 1 },
  });
  assert.equal(Object.isFrozen(healthy), true);
  assert.equal(Object.isFrozen(healthy.details), true);

  manager.register(adapter({
    runtimeId: 'runtime-down',
    health: async () => { throw new Error('worker down'); },
  }));
  const down = await manager.health('runtime-down');
  assert.equal(down.online, false);
  assert.equal(down.error, 'worker down');
  assert.equal(down.status, 0);
});

test('未知运行时与健康检查超时', async () => {
  const manager = new RuntimeManager({ healthTimeoutMs: 20 });
  await assert.rejects(
    () => manager.health('missing'),
    (err) => err.code === 'RUNTIME_NOT_FOUND' && err.status === 404,
  );

  manager.register(adapter({
    runtimeId: 'runtime-hang',
    health: () => new Promise(() => {}),
  }));
  const result = await manager.health('runtime-hang');
  assert.equal(result.online, false);
  assert.match(result.error, /超时/);
});

test('未实现的操作显式 RUNTIME_UNSUPPORTED', async () => {
  const manager = new RuntimeManager();
  manager.register(adapter());

  for (const call of [
    () => manager.start('runtime-a', {}),
    () => manager.stop('runtime-a', {}),
    () => manager.invoke('runtime-a', {}, {}, {}),
    () => manager.cancel('runtime-a', {}, 1),
  ]) {
    await assert.rejects(call, (err) => err.code === 'RUNTIME_UNSUPPORTED' && err.status === 501);
  }
});

test('适配器实现的操作会被转发', async () => {
  const calls = [];
  const manager = new RuntimeManager();
  manager.register(adapter({
    start: async (instance) => { calls.push(['start', instance]); return 'started'; },
    stop: async (instance) => { calls.push(['stop', instance]); return 'stopped'; },
    invoke: async (instance, request) => { calls.push(['invoke', instance, request]); return 'result'; },
    cancel: async (instance, op) => { calls.push(['cancel', instance, op]); return true; },
  }));

  assert.equal(await manager.start('runtime-a', { id: 1 }), 'started');
  assert.equal(await manager.stop('runtime-a', { id: 1 }), 'stopped');
  assert.equal(await manager.invoke('runtime-a', { id: 1 }, { capability: 'x' }), 'result');
  assert.equal(await manager.cancel('runtime-a', { id: 1 }, 9), true);
  assert.deepEqual(calls, [
    ['start', { id: 1 }],
    ['stop', { id: 1 }],
    ['invoke', { id: 1 }, { capability: 'x' }],
    ['cancel', { id: 1 }, 9],
  ]);
});

test('dispose 调用适配器并移除注册', async () => {
  let disposed = 0;
  const manager = new RuntimeManager();
  manager.register(adapter({ dispose: async () => { disposed += 1; } }));

  assert.equal(await manager.dispose('runtime-a'), true);
  assert.equal(disposed, 1);
  assert.equal(manager.get('runtime-a'), null);
  assert.equal(await manager.dispose('runtime-a'), false);
});

test('healthAll 汇总全部运行时', async () => {
  const manager = new RuntimeManager();
  manager.register(adapter({ runtimeId: 'runtime-b', kind: 'b' }));
  manager.register(adapter({ runtimeId: 'runtime-a', kind: 'a' }));

  const all = await manager.healthAll();
  assert.deepEqual(all.map((item) => item.runtimeId), ['runtime-a', 'runtime-b']);
  assert.ok(all.every((item) => item.online === true));
});
