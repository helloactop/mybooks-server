const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createLegacyRuntimeAdapter } = require('../src/core/plugins/adapters/legacy-runtime');
const { RuntimeManager } = require('../src/core/plugins/runtime-manager');

test('把 runtimeHealth 结果规范化为运行时状态', async () => {
  const adapter = createLegacyRuntimeAdapter({
    health: async () => ({
      online: true,
      status: 200,
      info: {
        status: 'ok',
        plugins: ['zlibrary', 'book_dedup'],
        isolated: true,
        children: [{ tool_id: 'zlibrary' }],
        deferred: ['book_dedup'],
      },
    }),
  });

  assert.equal(adapter.runtimeId, 'legacy-toolbox');
  assert.equal(adapter.kind, 'legacy-toolbox');
  assert.deepEqual(await adapter.health(), {
    online: true,
    status: 200,
    error: '',
    details: { workerStatus: 'ok', loaded: 2, isolated: true, children: 1, deferred: 1 },
  });
});

test('离线时保留错误信息，不泄露密钥', async () => {
  const adapter = createLegacyRuntimeAdapter({
    health: async () => ({ online: false, status: 0, error: '插件运行环境未就绪' }),
  });

  const health = await adapter.health();
  assert.equal(health.online, false);
  assert.equal(health.status, 0);
  assert.equal(health.error, '插件运行环境未就绪');
  assert.deepEqual(health.details, { workerStatus: '', loaded: 0, isolated: false, children: 0, deferred: 0 });
  assert.equal(JSON.stringify(health).includes('secret'), false);
});

test('缺少 health 注入时立即报错', () => {
  assert.throws(() => createLegacyRuntimeAdapter({}), TypeError);
});

test('start/stop/invoke 转发 toolId，非法实例显式拒绝', async () => {
  const calls = [];
  const adapter = createLegacyRuntimeAdapter({
    health: async () => ({ online: true }),
    start: async (toolId) => { calls.push(['start', toolId]); return { ok: true }; },
    stop: async (toolId) => { calls.push(['stop', toolId]); return { ok: true }; },
    invoke: async (toolId, request) => { calls.push(['invoke', toolId, request]); return { status: 200 }; },
    reload: async () => { calls.push(['reload']); return { ok: true }; },
  });

  assert.deepEqual(await adapter.start({ toolId: 'zlibrary' }), { ok: true });
  assert.deepEqual(await adapter.stop({ toolId: 'zlibrary' }), { ok: true });
  assert.deepEqual(await adapter.invoke({ toolId: 'zlibrary' }, { route: 'books' }), { status: 200 });
  assert.deepEqual(await adapter.reload(), { ok: true });
  assert.deepEqual(calls, [
    ['start', 'zlibrary'],
    ['stop', 'zlibrary'],
    ['invoke', 'zlibrary', { route: 'books' }],
    ['reload'],
  ]);

  await assert.rejects(
    () => adapter.start({ toolId: '../etc' }),
    (err) => err.code === 'TOOL_ID_INVALID' && err.status === 400,
  );
});

test('cancel 未注入实现时显式 unsupported，不伪装成功', async () => {
  const adapter = createLegacyRuntimeAdapter({ health: async () => ({ online: true }) });
  await assert.rejects(
    () => adapter.cancel({ toolId: 'zlibrary' }, 42),
    (err) => err.code === 'RUNTIME_UNSUPPORTED' && err.status === 501,
  );
});

test('cancel 注入后转发 toolId/taskId/userId，非法实例仍拒绝', async () => {
  const calls = [];
  const adapter = createLegacyRuntimeAdapter({
    health: async () => ({ online: true }),
    cancel: async (toolId, taskId, options) => {
      calls.push(['cancel', toolId, taskId, options]);
      return { ok: true };
    },
  });

  assert.deepEqual(await adapter.cancel({ toolId: 'zlibrary', userId: 'u1' }, 42), { ok: true });
  assert.deepEqual(calls, [['cancel', 'zlibrary', 42, { userId: 'u1' }]]);
  await assert.rejects(
    () => adapter.cancel({ toolId: '../etc' }, 42),
    (err) => err.code === 'TOOL_ID_INVALID' && err.status === 400,
  );
});

test('RuntimeManager 与 Toolbox 适配器的生命周期调用互通', async () => {
  const calls = [];
  const manager = new RuntimeManager();
  manager.register(createLegacyRuntimeAdapter({
    health: async () => ({ online: true, status: 200, info: { status: 'ok', plugins: ['zlibrary'] } }),
    start: async (toolId) => { calls.push(['start', toolId]); return { tool_id: toolId, ok: true }; },
    stop: async (toolId) => { calls.push(['stop', toolId]); return { tool_id: toolId, stopped: true }; },
    invoke: async (toolId, request) => { calls.push(['invoke', toolId, request.route]); return { status: 200 }; },
    cancel: async (toolId, taskId, options) => {
      calls.push(['cancel', toolId, taskId, options.userId]);
      return { ok: true };
    },
    reload: async () => ({ ok: true }),
  }));

  assert.equal((await manager.health('legacy-toolbox')).details.loaded, 1);
  assert.deepEqual(await manager.start('legacy-toolbox', { toolId: 'zlibrary' }), { tool_id: 'zlibrary', ok: true });
  assert.deepEqual(await manager.stop('legacy-toolbox', { toolId: 'zlibrary' }), { tool_id: 'zlibrary', stopped: true });
  assert.deepEqual(
    await manager.invoke('legacy-toolbox', { toolId: 'zlibrary' }, { route: 'books' }),
    { status: 200 },
  );
  assert.deepEqual(
    await manager.cancel('legacy-toolbox', { toolId: 'zlibrary', userId: 'u1' }, 42),
    { ok: true },
  );
  assert.deepEqual(calls, [
    ['start', 'zlibrary'],
    ['stop', 'zlibrary'],
    ['invoke', 'zlibrary', 'books'],
    ['cancel', 'zlibrary', 42, 'u1'],
  ]);
});
