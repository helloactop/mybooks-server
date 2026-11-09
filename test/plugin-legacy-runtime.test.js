const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createLegacyRuntimeAdapter } = require('../src/core/plugins/adapters/legacy-runtime');

test('把 runtimeHealth 结果规范化为运行时状态', async () => {
  const adapter = createLegacyRuntimeAdapter({
    health: async () => ({
      online: true,
      status: 200,
      info: { status: 'ok', plugins: ['zlibrary', 'book_dedup'] },
    }),
  });

  assert.equal(adapter.runtimeId, 'legacy-toolbox');
  assert.equal(adapter.kind, 'legacy-toolbox');
  assert.deepEqual(await adapter.health(), {
    online: true,
    status: 200,
    error: '',
    details: { workerStatus: 'ok', loaded: 2 },
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
  assert.deepEqual(health.details, { workerStatus: '', loaded: 0 });
  assert.equal(JSON.stringify(health).includes('secret'), false);
});

test('缺少 health 注入时立即报错', () => {
  assert.throws(() => createLegacyRuntimeAdapter({}), TypeError);
});
