const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CAPABILITY, VERSION } = require('../src/core/plugins/capabilities/metadata-search');
const { createDoubanProvider } = require('../src/core/plugins/providers/douban');
const { createOpenLibraryProvider } = require('../src/core/plugins/providers/openlibrary');
const { createBuiltinMetadataService } = require('../src/core/plugins/services/metadata');

const DOUBAN_BOOK = {
  title: '三体',
  authors: ['刘慈欣'],
  author: '刘慈欣',
  translators: [],
  summary: '简介',
  publisher: '重庆出版社',
  pubYear: '2008',
  isbn: '9787020002207',
  rating: 9.0,
  doubanId: '2567698',
  doubanUrl: 'https://book.douban.com/subject/2567698/',
  tags: ['科幻'],
  cover: 'https://img.example/c.jpg',
};

const OL_BOOK = {
  title: 'The Pragmatic Programmer',
  authors: ['Andrew Hunt', 'David Thomas'],
  author: 'Andrew Hunt / David Thomas',
  summary: '',
  publisher: 'Addison-Wesley',
  pubYear: '1999',
  isbn: '9780201616224',
  rating: 0,
  tags: [],
  cover: '',
  openlibraryId: 'OL7353617M',
  openlibraryUrl: 'https://openlibrary.org/books/OL7353617M',
};

test('豆瓣 Provider：关键词与 ISBN 两条路径都产出统一候选', async () => {
  const provider = createDoubanProvider({
    search: async () => [DOUBAN_BOOK],
    lookupIsbn: async () => ({ status: 'found', book: DOUBAN_BOOK }),
  });

  const byQuery = await provider.invoke({ query: '三体', isbn: '', limit: 10 });
  assert.equal(byQuery.candidates.length, 1);
  assert.equal(byQuery.candidates[0].source, 'douban');
  assert.equal(byQuery.candidates[0].sourceId, '2567698');
  assert.equal(byQuery.candidates[0].description, '简介');

  const byIsbn = await provider.invoke({ query: '', isbn: '9787020002207', limit: 10 });
  assert.equal(byIsbn.candidates.length, 1);
  assert.equal(byIsbn.candidates[0].isbn, '9787020002207');
});

test('豆瓣 Provider：blocked 与 not_found 区分', async () => {
  const blocked = createDoubanProvider({
    search: async () => [],
    lookupIsbn: async () => ({ status: 'blocked' }),
  });
  await assert.rejects(
    () => blocked.invoke({ query: '', isbn: '9787020002207', limit: 10 }),
    (err) => err.code === 'BLOCKED',
  );

  const missing = createDoubanProvider({
    search: async () => [],
    lookupIsbn: async () => ({ status: 'not_found' }),
  });
  assert.deepEqual(await missing.invoke({ query: '', isbn: '9787020002207', limit: 10 }), { candidates: [] });
});

test('Open Library Provider：关键词与 ISBN 都产出 openlibrary 候选', async () => {
  const provider = createOpenLibraryProvider({
    search: async () => [OL_BOOK],
    lookupIsbn: async () => ({ status: 'found', book: OL_BOOK }),
  });

  const byQuery = await provider.invoke({ query: 'pragmatic', isbn: '', limit: 10 });
  assert.equal(byQuery.candidates[0].source, 'openlibrary');
  assert.equal(byQuery.candidates[0].sourceId, 'OL7353617M');

  const byIsbn = await provider.invoke({ query: '', isbn: '9780201616224', limit: 10 });
  assert.equal(byIsbn.candidates[0].title, 'The Pragmatic Programmer');
});

test('内置服务默认豆瓣，显式选择可平替为 Open Library', async () => {
  const builtin = createBuiltinMetadataService({
    providers: {
      douban: {
        search: async () => [DOUBAN_BOOK],
        lookupIsbn: async () => ({ status: 'found', book: DOUBAN_BOOK }),
      },
      openlibrary: {
        search: async () => [OL_BOOK],
        lookupIsbn: async () => ({ status: 'found', book: OL_BOOK }),
      },
    },
  });

  try {
    const preferred = await builtin.service.search({ query: '三体' });
    assert.equal(preferred.providerId, 'douban');
    assert.equal(preferred.candidates[0].source, 'douban');

    const swapped = await builtin.service.search({ query: 'pragmatic' }, { providerId: 'openlibrary' });
    assert.equal(swapped.providerId, 'openlibrary');
    assert.equal(swapped.candidates[0].source, 'openlibrary');
  } finally {
    builtin.dispose();
  }

  assert.deepEqual(builtin.registry.list(CAPABILITY, VERSION), []);
});

test('Provider 工厂缺依赖时立即报错', () => {
  assert.throws(() => createDoubanProvider({}), TypeError);
  assert.throws(() => createOpenLibraryProvider({ search: async () => [] }), TypeError);
});
