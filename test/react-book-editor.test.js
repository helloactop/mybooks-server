const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-react-editor-'));
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_SEED_DEMO = 'false';
const { db } = require('../src/db/index');
let server;
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  db.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('React 编辑：精确豆瓣匹配、歧义不自动覆盖、上传边界与版本条件', async () => {
  const { emptyBook, exactMetadata, validateCoverFile, validateBookFile, bookPayload, splitNames } = await import('../web-react/src/features/book-editor/book-editor.ts');
  const book = { ...emptyBook(), title: '同名书', isbn: '978-7-000000-01-1' };
  const other = { ...book, isbn: '9787000000028' };
  assert.equal(exactMetadata([other, book], book), book);
  assert.equal(exactMetadata([book, { ...book }], book), undefined);
  assert.equal(exactMetadata([other], book), undefined);
  assert.equal(exactMetadata([book, other], { ...book, isbn: '' }), undefined);
  assert.deepEqual(splitNames('李青、江明，李青'), ['李青', '江明']);
  assert.throws(() => validateCoverFile({ type: 'image/svg+xml', size: 10 }));
  assert.throws(() => validateCoverFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }));
  assert.throws(() => validateBookFile({ name: 'a.epub', size: 0 }));
  assert.throws(() => validateBookFile({ name: 'a.exe', size: 10 }));
  assert.throws(() => validateBookFile({ name: 'a.pdf', size: 80 * 1024 * 1024 + 1 }));
  validateBookFile({ name: 'a.EPUB', size: 20 });
  assert.throws(() => bookPayload({ ...book, id: 1 }));
  assert.throws(() => bookPayload(emptyBook()));
});

test('React 编辑：添加、局部更新保留阅读历史、冲突拒绝、封面与电子书上传', async () => {
  const { apiRequest, apiGet } = await import('../web-react/src/shared/api.ts');
  const { bookPayload, parseEditableBook } = await import('../web-react/src/features/book-editor/book-editor.ts');
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use(require('../src/http/routes.books'));
  app.use(require('../src/http/routes.misc'));
  app.use(require('../src/http/routes.files'));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const initial = { title: '演示书籍', author: '原作者', translators: ['原译者'], tags: ['原标签'], status: 'done',
    publisher: '保留出版社', rating: 8.5, read_logs: [{ start: '2026-01-01', finish: '2026-01-03' }] };
  const added = (await apiRequest(base + '/api/books', { method: 'POST', ...json(initial) })).data;
  assert.ok(added.id); assert.ok(added.uuid); assert.ok(added.revision);
  const draft = parseEditableBook(added); draft.author = '新作者'; draft.translators = []; draft.tags = ['旅行']; draft.summary = '新简介'; draft.isbn = '9780000000001';
  const payload = bookPayload(draft);
  assert.equal('read_logs' in payload, false); assert.equal('status' in payload, false); assert.equal('rating' in payload, false);
  const updated = (await apiRequest(base + '/api/books/' + added.id, { method: 'PATCH', ...json(payload) })).data;
  assert.equal(updated.author, '新作者'); assert.deepEqual(updated.translators, []);
  assert.deepEqual(JSON.parse(updated.tags), ['旅行']); assert.equal(updated.summary, '新简介');
  assert.equal(updated.status, 'done'); assert.equal(updated.publisher, '保留出版社'); assert.equal(updated.rating, 8.5);
  assert.equal(updated.read_logs, added.read_logs); assert.equal(updated.read_count, added.read_count);
  await assert.rejects(apiRequest(base + '/api/books/' + added.id, { method: 'PATCH', ...json(payload) }), err => err.status === 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM books').get().n, 1);
  const cover = (await apiRequest(base + '/api/upload', { method: 'POST', ...json({ data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }) })).data;
  assert.match(cover.url, /^\/uploads\//);
  const body = new FormData(); body.append('file', new Blob(['fixture epub bytes']), 'book.epub');
  await apiRequest(base + '/api/books/' + added.id + '/file', { method: 'POST', body });
  const final = (await apiGet(base + '/api/books/' + added.id)).data;
  assert.equal(final.files.length, 1); assert.equal(final.files[0].format, 'EPUB');
  assert.equal(final.read_logs, added.read_logs);
});
