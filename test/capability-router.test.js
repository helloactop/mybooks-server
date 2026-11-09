const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ServiceRegistry } = require('../src/core/plugins/registry');
const { GrantStore } = require('../src/core/plugins/permissions');
const { CapabilityRouter } = require('../src/core/plugins/capability-router');

function contract(overrides = {}) {
  return {
    normalizeInput: (input) => ({ ...input, normalized: true }),
    normalizeOutput: (raw, context) => ({ raw, providerId: context.providerId, input: context.input }),
    permission: 'metadata.read',
    ...overrides,
  };
}

function makeRouter(entries, options = {}) {
  const registry = new ServiceRegistry();
  for (const entry of entries) {
    registry.register({
      capability: 'metadata.search',
      version: '1',
      instanceId: entry.instanceId || `inst.${entry.providerId}`,
      providerId: entry.providerId,
      priority: entry.priority === undefined ? 10 : entry.priority,
      invoke: entry.invoke || (async (input) => ({ echo: input })),
    });
  }
  return {
    registry,
    router: new CapabilityRouter({ registry, logger: { error() {} }, ...options }),
  };
}

test('宿主调用：输入规范化 → 选中 Provider → 输出规范化', async () => {
  const calls = [];
  const { router } = makeRouter([
    {
      providerId: 'one',
      invoke: async (input, context) => {
        calls.push({ input, context });
        return { value: 1 };
      },
    },
  ]);

  const result = await router.invoke({
    capability: 'metadata.search',
    version: '1',
    input: { query: 'x' },
    contract: contract(),
  });

  assert.equal(result.providerId, 'one');
  assert.deepEqual(result.output, {
    raw: { value: 1 },
    providerId: 'one',
    input: { query: 'x', normalized: true },
  });
  assert.deepEqual(calls[0].input, { query: 'x', normalized: true });
  assert.equal(calls[0].context.principal, null);
});

test('插件调用必须先授权，拒绝时不会触碰 Provider', async () => {
  let invoked = 0;
  const { router, registry } = makeRouter([
    { providerId: 'one', invoke: async () => { invoked += 1; return {}; } },
  ], { grants: new GrantStore() });

  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search',
      version: '1',
      input: { query: 'x' },
      contract: contract(),
      principal: 'inst.plugin',
    }),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );
  assert.equal(invoked, 0);
  assert.equal(registry.list('metadata.search', '1').length, 1);
});

test('授权按 scope 生效', async () => {
  const grants = new GrantStore();
  grants.grant('inst.plugin', 'metadata.read', 'book:1');
  const { router } = makeRouter([{ providerId: 'one' }], { grants });

  const allowed = await router.invoke({
    capability: 'metadata.search',
    version: '1',
    input: { bookId: 1 },
    contract: contract({ permissionResource: (input) => `book:${input.bookId}` }),
    principal: { instanceId: 'inst.plugin' },
  });
  assert.equal(allowed.providerId, 'one');

  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search',
      version: '1',
      input: { bookId: 2 },
      contract: contract({ permissionResource: (input) => `book:${input.bookId}` }),
      principal: 'inst.plugin',
    }),
    (err) => err.code === 'PERMISSION_DENIED',
  );
});

test('显式 Provider、未知 Provider 与无 Provider', async () => {
  const { router } = makeRouter([
    { providerId: 'one', priority: 100 },
    { providerId: 'two', priority: 1 },
  ]);

  const explicit = await router.invoke({
    capability: 'metadata.search', version: '1', input: {}, contract: contract(), providerId: 'two',
  });
  assert.equal(explicit.providerId, 'two');

  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search', version: '1', input: {}, contract: contract(), providerId: 'missing',
    }),
    (err) => err.code === 'PROVIDER_NOT_FOUND' && err.status === 404,
  );

  const empty = new CapabilityRouter({ registry: new ServiceRegistry(), logger: { error() {} } });
  await assert.rejects(
    () => empty.invoke({ capability: 'metadata.search', version: '1', input: {}, contract: contract() }),
    (err) => err.code === 'NO_PROVIDER' && err.status === 503,
  );
});

test('Provider 错误与超时映射为稳定错误码', async () => {
  const cases = [
    [Object.assign(new Error('blocked'), { code: 'BLOCKED' }), 'UPSTREAM_BLOCKED', 502],
    [Object.assign(new Error('upstream'), { code: 'UPSTREAM' }), 'UPSTREAM_ERROR', 502],
    [new Error('crash'), 'PROVIDER_ERROR', 500],
  ];
  for (const [thrown, code, status] of cases) {
    const { router } = makeRouter([{ providerId: 'bad', invoke: async () => { throw thrown; } }]);
    await assert.rejects(
      () => router.invoke({ capability: 'metadata.search', version: '1', input: {}, contract: contract() }),
      (err) => err.code === code && err.status === status,
    );
  }

  const { router } = makeRouter([{ providerId: 'hang', invoke: () => new Promise(() => {}) }], { timeoutMs: 20 });
  await assert.rejects(
    () => router.invoke({ capability: 'metadata.search', version: '1', input: {}, contract: contract() }),
    (err) => err.code === 'UPSTREAM_TIMEOUT' && err.status === 504,
  );
});

test('契约错误与输入错误原样抛出', async () => {
  const { router } = makeRouter([{ providerId: 'one' }]);

  await assert.rejects(
    () => router.invoke({ capability: 'metadata.search', version: '1', input: {}, contract: {} }),
    (err) => err.code === 'CAPABILITY_INVALID_CONTRACT',
  );

  const inputError = Object.assign(new Error('bad input'), { code: 'INVALID_INPUT', status: 400 });
  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search',
      version: '1',
      input: {},
      contract: contract({ normalizeInput: () => { throw inputError; } }),
    }),
    (err) => err === inputError,
  );
});

test('principal 缺少 instanceId 时拒绝', async () => {
  const { router } = makeRouter([{ providerId: 'one' }]);
  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search',
      version: '1',
      input: {},
      contract: contract(),
      principal: {},
    }),
    (err) => err.code === 'CAPABILITY_INVALID_PRINCIPAL' && err.status === 400,
  );
});

test('AbortSignal：已取消的调用不会触发 Provider', async () => {
  let invoked = 0;
  const { router } = makeRouter([
    { providerId: 'one', invoke: async () => { invoked += 1; return {}; } },
  ]);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search', version: '1', input: {}, contract: contract(),
      signal: controller.signal,
    }),
    (err) => err.code === 'CAPABILITY_ABORTED' && err.status === 499,
  );
  assert.equal(invoked, 0, '取消后不能再调用 Provider');
});

test('AbortSignal 传达到 Provider，并能中断在途调用', async () => {
  const signals = [];
  const { router } = makeRouter([
    {
      providerId: 'slow',
      invoke: (input, context) => {
        signals.push(context.signal);
        return new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      },
    },
  ]);

  const controller = new AbortController();
  const pending = router.invoke({
    capability: 'metadata.search', version: '1', input: {}, contract: contract(),
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(
    () => pending,
    (err) => err.code === 'CAPABILITY_ABORTED' && err.status === 499,
  );
  assert.equal(signals.length, 1, 'Provider 必须收到信号');
  assert.equal(signals[0].aborted, true);
});

test('非法 signal 与非法 timeoutMs 显式拒绝', async () => {
  const { router } = makeRouter([{ providerId: 'one' }]);
  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search', version: '1', input: {}, contract: contract(), signal: {},
    }),
    (err) => err.code === 'CAPABILITY_INVALID_SIGNAL' && err.status === 400,
  );
  await assert.rejects(
    () => router.invoke({
      capability: 'metadata.search', version: '1', input: {}, contract: contract(), timeoutMs: -1,
    }),
    (err) => err.code === 'CAPABILITY_INVALID_TIMEOUT' && err.status === 400,
  );
});
