const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ServiceRegistry, RegistryError } = require('../src/core/plugins/registry');

function provider(overrides = {}) {
  return {
    capability: 'metadata.search',
    version: '1',
    providerId: 'douban',
    instanceId: 'builtin.douban',
    priority: 100,
    invoke: async () => ({ candidates: [] }),
    ...overrides,
  };
}

function thrownCode(code) {
  return (err) => err instanceof RegistryError && err.code === code;
}

test('注册后可按能力查询，描述符按优先级降序且不暴露 invoke', () => {
  const registry = new ServiceRegistry();
  registry.register(provider({ providerId: 'low', instanceId: 'inst.low', priority: 10 }));
  registry.register(provider({ providerId: 'high', instanceId: 'inst.high', priority: 200 }));
  registry.register(provider({ providerId: 'mid', instanceId: 'inst.mid', priority: 100 }));

  const list = registry.list('metadata.search', '1');
  assert.deepEqual(list.map((item) => item.providerId), ['high', 'mid', 'low']);
  assert.equal(Object.hasOwn(list[0], 'invoke'), false);
  assert.ok(Object.isFrozen(list[0]));
  assert.ok(Object.isFrozen(list[0].metadata));
  assert.deepEqual(registry.list('metadata.search', '2'), []);
  assert.deepEqual(registry.list('source.search', '1'), []);
});

test('同一能力可并存多个版本，versions 升序返回', () => {
  const registry = new ServiceRegistry();
  registry.register(provider({ version: 2, providerId: 'neo', instanceId: 'inst.neo' }));
  registry.register(provider({ version: '1', providerId: 'douban', instanceId: 'inst.douban' }));

  assert.deepEqual(registry.versions('metadata.search'), ['1', '2']);
  assert.deepEqual(registry.list('metadata.search').map((item) => item.version), ['1', '2']);
});

test('重复 provider 或同一实例重复注册同一能力会显式报错', () => {
  const registry = new ServiceRegistry();
  registry.register(provider());

  assert.throws(
    () => registry.register(provider({ instanceId: 'other.instance' })),
    (err) => err.code === 'REGISTRY_DUPLICATE' && err.status === 409,
  );
  assert.throws(
    () => registry.register(provider({ providerId: 'another' })),
    thrownCode('REGISTRY_DUPLICATE'),
  );
});

test('按显式 ID 精确查询，未命中返回 null', () => {
  const registry = new ServiceRegistry();
  registry.register(provider());
  registry.register(provider({ providerId: 'openlibrary', instanceId: 'builtin.openlibrary', priority: 50 }));

  const hit = registry.get('metadata.search', '1', 'douban');
  assert.equal(hit.providerId, 'douban');
  assert.equal(registry.get('metadata.search', '1', 'missing'), null);
  assert.equal(registry.has('metadata.search', '1', 'openlibrary'), true);
  assert.equal(registry.has('metadata.search', '1', 'missing'), false);
});

test('dispose 撤销注册且重复调用幂等', () => {
  const registry = new ServiceRegistry();
  const dispose = registry.register(provider());

  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.deepEqual(registry.list('metadata.search', '1'), []);
  assert.throws(() => registry.resolve('metadata.search', '1', 'douban'), thrownCode('CAPABILITY_NOT_FOUND'));
});

test('停用实例后立即查不到、不可解析，重新启用恢复', () => {
  const registry = new ServiceRegistry();
  registry.register(provider());

  assert.equal(registry.setInstanceActive('builtin.douban', false), 1);
  assert.equal(registry.setInstanceActive('builtin.douban', false), 1);
  assert.deepEqual(registry.list('metadata.search', '1'), []);
  assert.throws(() => registry.resolve('metadata.search', '1', 'douban'), thrownCode('PLUGIN_NOT_ACTIVE'));

  registry.setInstanceActive('builtin.douban', true);
  assert.equal(registry.list('metadata.search', '1').length, 1);
  assert.equal(registry.resolve('metadata.search', '1', 'douban').descriptor.providerId, 'douban');
  assert.throws(() => registry.setInstanceActive('never.registered', false), thrownCode('REGISTRY_UNKNOWN_INSTANCE'));
});

test('停用只影响本实例，不影响同能力的其他 provider', () => {
  const registry = new ServiceRegistry();
  registry.register(provider());
  registry.register(provider({ providerId: 'openlibrary', instanceId: 'builtin.openlibrary' }));

  registry.setInstanceActive('builtin.douban', false);
  assert.deepEqual(registry.list('metadata.search', '1').map((item) => item.providerId), ['openlibrary']);
});

test('resolve 返回注册的 invoke 供宿主调用，自身不执行', async () => {
  const registry = new ServiceRegistry();
  let calls = 0;
  registry.register(provider({
    invoke: async (input) => {
      calls += 1;
      return { candidates: [], input };
    },
  }));

  const resolved = registry.resolve('metadata.search', '1', 'douban');
  assert.equal(calls, 0);
  assert.equal(resolved.descriptor.instanceId, 'builtin.douban');
  const result = await resolved.invoke({ query: '三体' });
  assert.equal(calls, 1);
  assert.deepEqual(result.input, { query: '三体' });
});

test('版本或能力不存在时给出明确错误码', () => {
  const registry = new ServiceRegistry();
  registry.register(provider());

  assert.throws(
    () => registry.resolve('metadata.search', '2', 'douban'),
    thrownCode('CAPABILITY_VERSION_UNSUPPORTED'),
  );
  assert.throws(
    () => registry.resolve('source.search', '1', 'douban'),
    thrownCode('CAPABILITY_NOT_FOUND'),
  );
  assert.throws(
    () => registry.resolve('metadata.search', '1', 'missing'),
    thrownCode('PROVIDER_NOT_FOUND'),
  );
});

test('非法注册输入被拒绝', () => {
  const registry = new ServiceRegistry();
  const invalid = [
    { capability: 'metadata' },
    { capability: 'Metadata.Search' },
    { capability: 'metadata.search.extra' },
    { version: '0' },
    { version: '01' },
    { version: '1.0' },
    { providerId: '-bad' },
    { instanceId: 'bad id' },
    { invoke: null },
    { priority: Number.NaN },
    { metadata: [] },
    { metadata: { displayName: { nested: true } } },
    { metadata: { ['x'.repeat(65)]: 'value' } },
    { metadata: { displayName: 'x'.repeat(257) } },
  ];
  for (const overrides of invalid) {
    assert.throws(
      () => registry.register(provider(overrides)),
      (err) => err.code === 'REGISTRY_INVALID_INPUT',
      JSON.stringify(overrides).slice(0, 80),
    );
  }
});

test('metadata 是浅拷贝，注册后修改原对象不影响描述符', () => {
  const registry = new ServiceRegistry();
  const metadata = { displayName: '豆瓣', weight: 1, enabled: true, note: null };
  registry.register(provider({ metadata }));

  metadata.displayName = '被篡改';
  delete metadata.weight;
  const descriptor = registry.get('metadata.search', '1', 'douban');
  assert.deepEqual(descriptor.metadata, { displayName: '豆瓣', weight: 1, enabled: true, note: null });
});

test('disposeAll 清空注册并使旧 disposer 幂等', () => {
  const registry = new ServiceRegistry();
  const dispose = registry.register(provider());
  registry.register(provider({ providerId: 'openlibrary', instanceId: 'builtin.openlibrary' }));

  assert.equal(registry.disposeAll(), 2);
  assert.deepEqual(registry.instances(), []);
  assert.equal(dispose(), false);
  assert.deepEqual(registry.list('metadata.search', '1'), []);
});
