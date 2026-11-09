const { test } = require('node:test');
const assert = require('node:assert/strict');

const services = require('../src/http/plugin-services');

test('宿主组合根只创建一个 Kernel / Registry，内置 Provider 统一注册', async () => {
  await services.start();

  const list = services.kernel.registry.list('metadata.search', '1');
  assert.deepEqual(
    list.map((item) => item.instanceId).sort(),
    ['builtin.douban', 'builtin.openlibrary'],
  );
  assert.deepEqual(
    services.kernel.list().map((item) => item.state),
    ['active', 'active'],
  );
  assert.equal(services.metadata.registry, services.kernel.registry, '元数据服务必须复用宿主 Registry');
  assert.equal(services.kernel.grants.list('builtin.douban').length, 0, '默认不授予任何业务权限');
});

test('RuntimeManager 由宿主统一持有并只登记 Legacy 适配器', () => {
  const runtimes = services.runtimes.list();
  assert.deepEqual(runtimes.map((item) => item.runtimeId), ['legacy-toolbox']);
});

test('停用内置 Provider 后能力立即不可调用', async () => {
  await services.start();
  await services.kernel.stop('builtin.douban');

  assert.deepEqual(
    services.kernel.registry.list('metadata.search', '1').map((item) => item.providerId),
    ['openlibrary'],
  );
  await assert.rejects(
    () => services.metadata.service.search({ query: 'x' }, { providerId: 'douban' }),
    (err) => err.code === 'PROVIDER_NOT_FOUND' && err.status === 404,
  );

  // 重新启用，避免影响同一进程内的其他测试。
  await services.kernel.start('builtin.douban');
  assert.equal(services.kernel.registry.list('metadata.search', '1').length, 2);
});
