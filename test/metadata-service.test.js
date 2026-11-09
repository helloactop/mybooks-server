const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ServiceRegistry } = require('../src/core/plugins/registry');
const { MetadataSearchService } = require('../src/core/plugins/services/metadata');
const {
  CAPABILITY,
  VERSION,
  normalizeInput,
} = require('../src/core/plugins/capabilities/metadata-search');

function makeService(entries, options = {}) {
  const registry = new ServiceRegistry();
  for (const entry of entries) {
    registry.register({
      capability: CAPABILITY,
      version: VERSION,
      instanceId: entry.instanceId || `inst.${entry.providerId}`,
      providerId: entry.providerId,
      priority: entry.priority === undefined ? 10 : entry.priority,
      invoke: entry.invoke || (async () => ({ candidates: [] })),
    });
  }
  return {
    registry,
    service: new MetadataSearchService({ registry, logger: { error() {} }, ...options }),
  };
}

function candidate(overrides = {}) {
  return {
    title: '三体',
    authors: ['刘慈欣'],
    isbn: '9787020002207',
    publisher: '重庆出版社',
    pubYear: '2008',
    description: '简介',
    cover: 'https://img.example/c.jpg',
    source: 'douban',
    sourceId: '2567698',
    sourceUrl: 'https://book.douban.com/subject/2567698/',
    rating: 9.0,
    tags: ['科幻'],
    translators: [],
    ...overrides,
  };
}

test('normalizeInput：query / title+authors / isbn / 默认值', () => {
  assert.deepEqual(normalizeInput({ query: '  三体  ' }), {
    query: '三体', isbn: '', title: '', authors: [], limit: 10, locale: 'zh-CN',
  });
  const byTitle = normalizeInput({ title: '三体', authors: ['刘慈欣'] });
  assert.equal(byTitle.query, '三体 刘慈欣');
  assert.deepEqual(byTitle.authors, ['刘慈欣']);
  const byIsbn = normalizeInput({ isbn: '9787020002207' });
  assert.equal(byIsbn.isbn, '9787020002207');
  assert.equal(normalizeInput({ query: 'x', limit: 2 }).limit, 2);
});

test('normalizeInput：非法输入直接拒绝', () => {
  for (const input of [null, [], {}, { limit: 2 }, { query: 'x', limit: 0 }, { query: 'x', limit: 21 }, { query: 'x', limit: '5' }]) {
    assert.throws(() => normalizeInput(input), (err) => err.code === 'INVALID_INPUT');
  }
  assert.throws(() => normalizeInput({ isbn: '123' }), (err) => err.code === 'INVALID_INPUT');
  assert.throws(() => normalizeInput({ query: 'x'.repeat(201) }), (err) => err.code === 'INVALID_INPUT');
  assert.throws(
    () => normalizeInput({ title: 'x', authors: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    (err) => err.code === 'INVALID_INPUT',
  );
});

test('默认选择优先级最高的 Provider，并规范化候选', async () => {
  const { service } = makeService([
    { providerId: 'low', priority: 10, invoke: async () => ({ candidates: [candidate({ source: 'low' })] }) },
    {
      providerId: 'high',
      priority: 100,
      invoke: async () => ({
        candidates: [candidate({
          title: '  ' + 'x'.repeat(600) + '  ',
          rating: 42,
          tags: Array.from({ length: 25 }, (_, i) => `t${i}`),
          source: '',
        })],
      }),
    },
  ]);

  const out = await service.search({ query: '三体' });
  assert.equal(out.providerId, 'high');
  assert.equal(out.candidates.length, 1);
  const item = out.candidates[0];
  assert.equal(item.title.length, 500);
  assert.equal(item.rating, 10);
  assert.equal(item.tags.length, 20);
  assert.equal(item.source, 'high');
  assert.equal(Object.isFrozen(item), true);
  assert.equal(Object.isFrozen(item.tags), true);
});

test('显式 providerId 可切换到另一来源，未知 Provider 报 404', async () => {
  const { service } = makeService([
    { providerId: 'douban', priority: 100, invoke: async () => ({ candidates: [candidate()] }) },
    { providerId: 'openlibrary', priority: 50, invoke: async () => ({ candidates: [candidate({ source: 'openlibrary', sourceId: 'OL1' })] }) },
  ]);

  const swapped = await service.search({ query: 'x' }, { providerId: 'openlibrary' });
  assert.equal(swapped.providerId, 'openlibrary');
  assert.equal(swapped.candidates[0].source, 'openlibrary');

  await assert.rejects(
    () => service.search({ query: 'x' }, { providerId: 'missing' }),
    (err) => err.code === 'PROVIDER_NOT_FOUND' && err.status === 404,
  );
});

test('没有 Provider 时返回 503', async () => {
  const { service } = makeService([]);
  await assert.rejects(
    () => service.search({ query: 'x' }),
    (err) => err.code === 'NO_PROVIDER' && err.status === 503,
  );
});

test('limit 在服务层再次截断', async () => {
  const { service } = makeService([
    {
      providerId: 'many',
      invoke: async () => ({ candidates: [candidate({ title: 'A' }), candidate({ title: 'B' }), candidate({ title: 'C' })] }),
    },
  ]);
  const out = await service.search({ query: 'x', limit: 2 });
  assert.equal(out.candidates.length, 2);
});

test('Provider 错误映射为稳定错误码', async () => {
  const cases = [
    [Object.assign(new Error('豆瓣拒绝访问'), { code: 'BLOCKED' }), 'UPSTREAM_BLOCKED', 502],
    [Object.assign(new Error('HTTP 500'), { code: 'UPSTREAM' }), 'UPSTREAM_ERROR', 502],
    [Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 'UPSTREAM_TIMEOUT', 504],
    [new Error('unexpected crash'), 'PROVIDER_ERROR', 500],
  ];
  for (const [thrown, code, status] of cases) {
    const { service } = makeService([
      { providerId: 'bad', invoke: async () => { throw thrown; } },
    ]);
    await assert.rejects(
      () => service.search({ query: 'x' }),
      (err) => err.code === code && err.status === status,
    );
  }
});

test('服务级超时对挂起的 Provider 生效', async () => {
  const { service } = makeService([
    { providerId: 'hang', invoke: () => new Promise(() => {}) },
  ], { timeoutMs: 20 });

  await assert.rejects(
    () => service.search({ query: 'x' }),
    (err) => err.code === 'UPSTREAM_TIMEOUT' && err.status === 504,
  );
});

test('Provider 输出结构不合法时拒绝', async () => {
  for (const output of [{}, { candidates: [{ authors: ['x'] }] }]) {
    const { service } = makeService([
      { providerId: 'bad', invoke: async () => output },
    ]);
    await assert.rejects(
      () => service.search({ query: 'x' }),
      (err) => err.code === 'PROVIDER_INVALID_OUTPUT',
    );
  }
});
