const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { openDb } = require('../src/db');
const search = require('../src/db/search');

const model = import('../web-react/src/features/library/library-books.ts');
const navigation = import('../web-react/src/features/library/library-navigation.ts');

test('React 书库：规范路径保留查询、分类、排序和分页；非法页码回退', async () => {
  const { libraryHref, readLibraryLocation } = await navigation;
  const location = { view: 'collection', collectionId: '12', query: '书 & 海', sort: 'title', page: 2, author: 'A"B\'s', publisher: '100%_ 出版社', translator: '李青' };
  const href = libraryHref(location);
  assert.equal(href.startsWith('/mybooks/collections/12?'), true, '分类使用规范路径');
  const url = new URL(href, 'http://localhost');
  assert.deepEqual(readLibraryLocation(url.pathname, url.search), location);
  for (const page of ['-1', '1e3', 'NaN', '9007199254740991']) assert.equal(readLibraryLocation('/mybooks/books/all', '?page=' + page).page, undefined);
  assert.equal(readLibraryLocation('/mybooks', '?view=collection').view, 'all');
  assert.equal(readLibraryLocation('/mybooks', '').view, 'home', '新版默认进入公开首页');
  assert.equal(readLibraryLocation('/mybooks', '?sort=updated').view, 'all', '兼容旧书库查询链接');
  assert.equal(readLibraryLocation('/mybooks/books/all', '').view, 'all');
  assert.equal(readLibraryLocation('/mybooks/books/unread', '').view, 'unread');
  assert.equal(readLibraryLocation('/mybooks/settings', '').view, 'settings');
  assert.equal(readLibraryLocation('/mybooks/collections/abc', '').collectionId, 'abc');
  assert.equal(readLibraryLocation('/mybooks/playground/library/books/all', '', '/mybooks/playground/library').view, 'all');
  assert.equal(libraryHref({ view: 'settings', query: '' }, '/mybooks/playground/library'), '/mybooks/playground/library/settings');
});

test('旧侧栏预览地址跳到对应正式功能，保留筛选、分类和分页', async () => {
  const { legacySidebarHref } = await navigation;
  const base = '/mybooks/playground/sidebar';
  for (const [suffix, expected] of [
    ['', '/mybooks/books/all'], ['/', '/mybooks/books/all'],
    ['/books/all', '/mybooks/books/all'], ['/books/unread', '/mybooks/books/unread'],
    ['/books/finished', '/mybooks/books/finished'], ['/books/ebooks', '/mybooks/books/ebooks'], ['/books/pdf', '/mybooks/books/pdf'],
    ['/home', '/mybooks/'], ['/statistics', '/mybooks/statistics'], ['/notes', '/mybooks/notes'], ['/settings', '/mybooks/settings'],
    ['/collections/12', '/mybooks/collections/12'], ['/all', '/mybooks/books/all'], ['/settings/', '/mybooks/settings'],
  ]) assert.equal(legacySidebarHref(base + suffix), expected, suffix);
  assert.equal(legacySidebarHref(base, '?view=settings'), '/mybooks/settings');
  const query = '?q=%E4%B9%A6&sort=title&author=A&publisher=B&translator=C&page=2';
  assert.equal(legacySidebarHref(base + '/collections/12', query), '/mybooks/collections/12' + query);
  assert.equal(legacySidebarHref(base + '/books/all', '?page=-1&sort=unknown'), '/mybooks/books/all');
  for (const pathname of ['/mybooks/books/all', '/mybooks/playground/sidebar-other/books/all', '/mybooks/playground/library/books/all']) {
    assert.equal(legacySidebarHref(pathname), null, '不改写其他页面');
  }
});

test('React 书库：筛选与分页使用既有搜索层，格式限制不会被 or 绕过', async (t) => {
  const { bookQuery, BOOK_PAGE_SIZE } = await model;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-react-library-'));
  const db = openDb(dir, { seedDemo: false });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const insert = db.prepare("INSERT INTO books (title, status, created_at, updated_at) VALUES (?, ?, '2026-01-01', '2026-01-01')");
  for (let i = 0; i < 65; i++) {
    const id = Number(insert.run(i % 2 ? '海上旅行' : '星空旅行', ['wish', 'reading', 'done'][i % 3]).lastInsertRowid);
    search.indexBook(db, db.prepare('SELECT * FROM books WHERE id = ?').get(id));
    if (i % 3 === 0) db.prepare("INSERT INTO book_files (book, format, path, created_at, updated_at) VALUES (?, 'PDF', 'test.pdf', '', '')").run(id);
    if (i % 3 === 1) db.prepare("INSERT INTO book_files (book, format, path, created_at, updated_at) VALUES (?, 'EPUB', 'test.epub', '', '')").run(id);
  }
  const collection = Number(db.prepare("INSERT INTO collections (name, created_at, updated_at) VALUES ('演示分类', '', '')").run().lastInsertRowid);
  db.prepare("INSERT INTO book_collections (collection_id, book_id, added_at) SELECT ?, id, '' FROM books WHERE id <= 5").run(collection);
  const fetchPage = (location) => {
    const params = Object.fromEntries(bookQuery({ query: '', ...location }));
    return search.searchBooksPage(db, params, { start: Number(params.start), size: Number(params.size) });
  };
  const first = fetchPage({ view: 'all' });
  const second = fetchPage({ view: 'all', page: 2 });
  assert.equal(first.total, 65);
  assert.equal(first.rows.length, BOOK_PAGE_SIZE);
  assert.equal(second.rows.length, 65 - BOOK_PAGE_SIZE);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 65);
  assert.ok(fetchPage({ view: 'unread' }).rows.every((row) => row.status === 'wish'));
  assert.ok(fetchPage({ view: 'finished' }).rows.every((row) => row.status === 'done'));
  assert.equal(fetchPage({ view: 'collection', collectionId: String(collection) }).total, 5);
  assert.equal(fetchPage({ view: 'ebooks' }).total, 44);
  const pdf = fetchPage({ view: 'pdf', query: 'title:星空 or title:海上' });
  assert.equal(pdf.total, 22);
  assert.ok(pdf.rows.every((row) => db.prepare("SELECT 1 FROM book_files WHERE book = ? AND format = 'PDF'").get(row.id)));
  assert.equal(fetchPage({ view: 'all', query: '不存在的书名' }).total, 0);
});

test('React 书库：封面限制同源路径与代理；译者使用服务端数组', async () => {
  const { bookCoverSource, parseLibraryBooks } = await model;
  for (const url of ['javascript:alert(1)', '//example.com/cover.jpg', '/\\example.com/a', 'data:image/png;base64,x']) assert.equal(bookCoverSource(url), undefined);
  assert.equal(bookCoverSource('/uploads/cover.jpg'), '/uploads/cover.jpg');
  assert.equal(bookCoverSource('https://example.com/a.jpg'), '/api/img-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg');
  assert.deepEqual(parseLibraryBooks([{ id: 1, title: '<script>', translators: ['译者', null] }])[0].translators, ['译者']);
  assert.throws(() => parseLibraryBooks({ error: 'invalid' }));
});

test('React 筛选：作者与出版社精确组合，特殊字符不进入搜索语法，回收站和作用域隔离', async (t) => {
  const { bookQuery } = await model;
  const categories = require('../src/db/categories');
  const publishers = require('../src/db/publishers');
  const translators = require('../src/db/translators');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-react-filters-'));
  const db = openDb(dir, { seedDemo: false });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const samples = [
    ['甲', '林一', '青禾出版社', null], ['乙', '林一二', '青禾出版社', null],
    ['丙', '林一', '青禾出版社·子品牌', null], ['丁', 'A"B\'s', '100%_ "Press"', null],
    ['戊', '林一', ' 青禾出版社 ', null], ['回收图书', '林一', '已删除出版社', '2026-01-01'],
  ];
  const ids = [];
  for (const [index, [title, author, publisher, deleted]] of samples.entries()) {
    const id = Number(db.prepare("INSERT INTO books (title, author, publisher, created_at, updated_at, deleted_at) VALUES (?, ?, ?, '', '', ?)").run(title, author, publisher, deleted).lastInsertRowid);
    categories.syncBookAuthors(db, id, [author]);
    db.prepare('UPDATE books SET translators = ? WHERE id = ?').run([
      '["李青","李青","江明"]', '["李青二"]', '李青、王 海', '["A\\"B\'s"]', '["李青"', '["回收站译者"]',
    ][index], id);
    search.indexBook(db, db.prepare('SELECT * FROM books WHERE id = ?').get(id)); ids.push(id);
  }
  const fetchPage = (filters) => {
    const params = Object.fromEntries(bookQuery({ view: 'all', query: '', ...filters }));
    return search.searchBooksPage(db, params, { start: Number(params.start), size: Number(params.size) });
  };
  assert.deepEqual(fetchPage({ author: '林一', publisher: '青禾出版社' }).rows.map((r) => r.title).sort(), ['甲', '戊'].sort());
  assert.equal(fetchPage({ author: '林' }).total, 0, '选择作者不能模糊命中其他作者');
  assert.equal(fetchPage({ author: 'A"B\'s', publisher: '100%_ "Press"' }).total, 1);
  assert.deepEqual(publishers.listPublishers(db).map((r) => r.name).sort(), ['青禾出版社', '青禾出版社·子品牌', '100%_ "Press"'].sort());
  assert.equal(publishers.listPublishers(db).find((r) => r.name === '青禾出版社').count, 3);
  assert.equal(publishers.searchPublishers(db, { q: '%' }).total, 1, '通配符按字面搜索');
  assert.equal(publishers.searchPublishers(db, { limit: 1, offset: 1 }).items.length, 1);
  assert.deepEqual(publishers.listPublishers(db, { scopeIds: [] }), []);
  assert.deepEqual(publishers.listPublishers(db, { scopeIds: [ids[0]] }).map((r) => r.name), ['青禾出版社']);
  assert.equal(fetchPage({ translator: '李青' }).total, 2, 'JSON 与历史字符串译者使用一致的归一化');
  assert.equal(fetchPage({ translator: '李' }).total, 0, '不能按姓名子串命中');
  assert.equal(fetchPage({ author: '林一', publisher: '青禾出版社', translator: '李青' }).total, 1);
  assert.equal(fetchPage({ translator: 'A"B\'s', publisher: '100%_ "Press"' }).total, 1);
  const translatorList = translators.listTranslators(db);
  assert.equal(translatorList.find((r) => r.name === '李青').count, 2, '同一本书内重复译者只计一次');
  assert.equal(translatorList.some((r) => r.name === '回收站译者'), false);
  assert.deepEqual(translators.listTranslators(db, { scopeIds: [] }), []);
  assert.deepEqual(translators.listTranslators(db, { scopeIds: [ids[1]] }).map((r) => r.name), ['李青二']);
  assert.equal(translators.searchTranslators(db, { q: '李', limit: 1 }).total, 2);
});

test('React 详情：字段解析、10 分制、缺失值及响应图书身份检查', async () => {
  const { parseBookDetail } = await import('../web-react/src/features/book-detail/book-detail.ts');
  const detail = parseBookDetail({ id: 1, title: '图书', author: '作者', translators: ['李青'], cover: '/uploads/a.jpg', isbn: '9780000000001', rating: 8.6, summary: '<script>plain text</script>', tags: '["文学","旅行","文学"]' }, 1);
  assert.equal(detail.rating, 8.6);
  assert.deepEqual(detail.translators, ['李青']);
  assert.equal(detail.summary, '<script>plain text</script>');
  assert.deepEqual(detail.tags, ['文学', '旅行']);
  assert.deepEqual(parseBookDetail({ id: 1, title: '图书', tags: ['标签', null, ''] }, 1).tags, ['标签']);
  assert.deepEqual(parseBookDetail({ id: 1, title: '图书', tags: 'invalid' }, 1).tags, []);
  assert.equal(parseBookDetail({ id: 1, title: '图书', rating: 0 }, 1).rating, null);
  assert.equal(parseBookDetail({ id: 1, title: '图书', rating: 11 }, 1).rating, null);
  assert.equal(parseBookDetail({ id: 1, title: '图书' }, 1).isbn, '');
  assert.throws(() => parseBookDetail({ id: 2, title: '另一图书' }, 1));
  assert.throws(() => parseBookDetail(null, 1));
});

test('React 公共请求：分页总数、错误码、取消请求和失效登录事件', async (t) => {
  const { apiGet, ApiError } = await import('../web-react/src/shared/api.ts');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/bad') { res.writeHead(400); return res.end(JSON.stringify({ error: '检索语法有误', code: 'VALIDATION' })); }
    if (req.url === '/auth') { res.writeHead(401); return res.end(JSON.stringify({ code: 'AUTH_REQUIRED' })); }
    if (req.url === '/missing-count') return res.end('[]');
    res.setHeader('X-Total-Count', '65'); res.end('[]');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  let redirect = ''; let removed = false; let dispatched = '';
  global.window = { location: { pathname: '/mybooks/books/unread', search: '?page=2', assign: (url) => { redirect = url; } },
    dispatchEvent: (event) => { dispatched = event.type; return false; } };
  global.localStorage = { getItem: () => '', removeItem: () => { removed = true; } };
  t.after(() => { delete global.window; delete global.localStorage; });
  assert.deepEqual(await apiGet(base), { data: [], total: 65 });
  assert.equal((await apiGet(base + '/missing-count')).total, null);
  await assert.rejects(apiGet(base + '/bad'), (error) => error instanceof ApiError && error.status === 400 && error.code === 'VALIDATION');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(apiGet(base, controller.signal), { name: 'AbortError' });
  await assert.rejects(apiGet(base + '/auth'), (error) => error.status === 401);
  assert.equal(removed, true);
  assert.equal(dispatched, 'mybooks:login-required');
  assert.equal(redirect, '', '不再跳转旧登录页');
});
