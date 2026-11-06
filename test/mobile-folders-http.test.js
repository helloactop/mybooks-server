const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { once } = require('node:events');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-folders-'));
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_SEED_DEMO = 'false';
const { db } = require('../src/db');
const { getPortableState } = require('../src/db/mobile-portable');
const { authStore } = require('../src/http/middleware.auth');
const search = require('../src/db/search');
let server;
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('App 同步分类：树、归属、子分类、分页筛选和快照身份隔离；仅登录可读且不改同步状态', async () => {
  const app = express(); app.use(express.json());
  app.use(require('../src/http/routes.auth'));
  app.use(require('../src/http/middleware.auth').requireSession);
  app.use(require('../src/http/routes.sync'));
  app.use(require('../src/http/routes.books'));
  app.use(require('../src/http/routes.collections'));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  await authStore.initialize('fixture-admin', 'folders-integration-password');
  const session = authStore.issueSession('App');
  const headers = { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' };
  const call = (url, options = {}) => fetch(base + url, { headers, ...options });
  assert.equal((await fetch(base + '/api/sync/folders')).status, 401);
  assert.deepEqual(await (await call('/api/sync/folders')).json(), { revision: 0, folders: [] });
  const books = [];
  for (const title of ['父分类图书', '子分类图书', '其他分类图书', '空分类外的图书']) {
    books.push(await (await call('/api/books', { method: 'POST', body: JSON.stringify({ title, author: '作者', publisher: '出版社' }) })).json());
  }
  const current = getPortableState(db);
  const data = { schemaVersion: 1, createdAt: 1, sourceDeviceId: 'android', bookIdentities: {}, preferences: [], assets: [],
    folders: [
      { id: 'parent', name: 'App 分类', normalizedName: 'app 分类', parentId: null, createdAt: 1, updatedAt: 1 },
      { id: 'child / 书', name: '子分类', normalizedName: '子分类', parentId: 'parent', createdAt: 1, updatedAt: 1 },
      { id: 'other', name: 'App 分类', normalizedName: 'app 分类', parentId: null, createdAt: 1, updatedAt: 1 },
      { id: 'empty', name: '空分类', normalizedName: '空分类', parentId: null, createdAt: 1, updatedAt: 1 },
    ], bookFolderLinks: books.slice(0, 3).map((book, index) => ({ bookId: 'mybooks-' + book.id, folderId: ['parent', 'child / 书', 'other'][index], updatedAt: 1 })) };
  data.books = books.map(book => {
    const id = 'mybooks-' + book.id; data.bookIdentities[id] = book.uuid;
    return { id, title: book.title, author: book.author, format: 'EPUB', lastReadTime: 0, readingProgress: 0, locatorJson: null,
      createdAt: 1, isFavorite: false, isCloudOnly: true, metadataUpdatedAt: 1, bodyAssetId: null, coverAssetId: null, remoteFileSize: 0 };
  });
  for (const key of ['tags','annotationTags','bookTagLinks','readingRecords','bookmarks','notes','tombstones','highlightRules','bookHighlightRuleStates','bookHighlightSettings','highlightRuleExclusions']) data[key] = [];
  const save = await call('/api/sync/state', { method: 'PUT', body: JSON.stringify({ library_id: current.library_id, expected_revision: 0, data }) });
  assert.equal(save.status, 200);
  const saved = await save.json();
  const folders = await call('/api/sync/folders');
  assert.equal(folders.headers.get('cache-control'), 'private, no-store');
  const rows = await folders.json();
  assert.equal(rows.revision, 1); assert.equal(rows.folders.length, 4);
  assert.deepEqual(rows.folders[1], { id: 'child / 书', name: '子分类', parentId: 'parent' });
  const read = async (folder, extra = {}) => {
    const response = await call('/api/books?' + new URLSearchParams({ folder, size: '1', sort: 'title', ...extra }));
    assert.equal(response.status, 200);
    return { total: Number(response.headers.get('x-total-count')), books: await response.json() };
  };
  assert.equal((await read('parent')).total, 2, '父分类包含子分类书籍');
  assert.equal((await read('parent', { start: '1' })).books.length, 1);
  assert.equal((await read('child / 书')).books[0].id, books[1].id);
  assert.equal((await read('other')).books[0].id, books[2].id, '同名分类按 ID 分开');
  assert.equal((await read('empty')).total, 0); assert.equal((await read('missing')).total, 0);
  assert.equal((await read('parent', { q: '子分类 or 其他分类', publisher: '出版社', author_exact: '作者' })).total, 1, 'or 不能越过分类范围');
  assert.equal((await read('parent', { publisher: '不存在' })).total, 0);
  assert.equal((await call('/api/books?folder=parent&folder=other&size=48')).status, 400);
  assert.equal((await call('/api/books?folder=&size=48')).status, 400);
  assert.equal(search.searchBooksPage(db, { folder: 'parent', scopeIds: [books[1].id] }, { start: 0, size: 48 }).total, 1);
  assert.equal(search.searchBooksPage(db, { folder: 'parent', scopeIds: [] }, { start: 0, size: 48 }).total, 0);
  assert.deepEqual(getPortableState(db), saved, '读取和筛选不修改快照或版本');
  assert.deepEqual(await (await call('/api/collections')).json(), [], '没有创建或复制 Web 藏书集');
  db.prepare('UPDATE books SET uuid = ? WHERE id = ?').run('different-book-identity', books[1].id);
  assert.equal((await read('child / 书')).total, 0, '旧快照不能把重用数字 ID 的新书归类');
  db.prepare('UPDATE books SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), books[0].id);
  assert.equal((await read('parent')).total, 0, '不包含回收站图书');
  data.tombstones = [{ namespace: 'folder', itemId: 'other', deletedAt: 1, deviceId: 'android' },
    { namespace: 'book_folder', itemId: 'mybooks-' + books[2].id, deletedAt: 1, deviceId: 'android' }];
  db.prepare('UPDATE mobile_portable_state SET data = ? WHERE id = 1').run(JSON.stringify(data));
  assert.equal((await (await call('/api/sync/folders')).json()).folders.some(folder => folder.id === 'other'), false);
  assert.equal((await read('other')).total, 0);
});
