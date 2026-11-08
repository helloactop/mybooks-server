const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migrations, runMigrations } = require('../src/db');
const { parseBook, mergeUpdate } = require('../src/core/book');
const { parseBookPage, mapToBook } = require('../src/core/douban');
const { parseTranslators, translatorDto } = require('../src/core/translators');
const { buildPatch, toIncoming } = require('../src/core/enrich');
const { toBookBody } = require('../src/core/isbn_import');
const books = require('../src/db/books');
const { getBookSnapshot } = require('../src/db/sync');
const { getSyncChanges } = require('../src/db/sync-v3');

for (const names of [[], ['译者甲'], ['译者甲', '译者乙']]) {
  test(`豆瓣解析 ${names.length} 位译者，作者与译者同父节点也不会混淆`, () => {
    const html = `<span property="v:itemreviewed">书</span><div id="info">
      <span class="pl">作者:</span><a href="/author/1">作者甲</a><br>
      <span class="pl">译者:</span>${names.map((n) => `<a href="/search/${n}">${n}</a>`).join(' / ')}<br>
      <span class="pl">出版社:</span>出版社</div>`;
    const meta = parseBookPage(html, '1');
    assert.deepEqual(meta.authors, ['作者甲']);
    assert.deepEqual(meta.translators, names);
    assert.deepEqual(mapToBook(meta).translators, names);
    assert.equal(mapToBook({ ...meta, authors: [] }).author, '');
    assert.deepEqual(toBookBody(mapToBook(meta), '9787536692930', []).translators, names);
  });
}

test('译者纯文本、整名数组和 JSON TEXT 归一化，保留姓名间隔号', () => {
  assert.deepEqual(parseTranslators('甲、乙 / 甲'), ['甲', '乙']);
  assert.deepEqual(parseTranslators('Smith, John、Jones, Mary'), ['Smith, John', 'Jones, Mary']);
  assert.deepEqual(parseTranslators('[" A  B ","a b",null,"加西亚·马尔克斯"]'), ['A B', '加西亚·马尔克斯']);
  const m = parseBookPage('<span property="v:itemreviewed">书</span><div><span class="pl">译者:</span>甲 / 乙<br></div>');
  assert.deepEqual(m.translators, ['甲', '乙']);
});

test('v24→v25 增量迁移保留完整原行、UUID、版本及同步游标；译者保存与增量同步', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-translators-'));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  try {
    migrations.slice(0, 24).forEach((migration) => migration(db, dir));
    db.exec('PRAGMA user_version=24');
    const old = parseBook({ title: '旧书', author: '原作者', publisher: '原出版社', pub_year: '2000', rating: 9.2, douban_id: '123' }).values;
    delete old.translators;
    // 迁移前通过原表插入真实旧行，避免用新 CRUD 写旧 schema。
    db.prepare("INSERT INTO books(title,author,publisher,pub_year,rating,douban_id,uuid,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'2020','2020')")
      .run(old.title, old.author, old.publisher, old.pub_year, old.rating, old.douban_id, 'stable-uuid');
    const before = db.prepare('SELECT * FROM books').get();
    const cursor = getSyncChanges(db).cursor;
    assert.deepEqual(runMigrations(db, dir), { from: 24, to: migrations.length, ran: migrations.length - 24 });
    const after = db.prepare('SELECT * FROM books').get();
    const { translators, ...unchanged } = after;
    assert.deepEqual(unchanged, { ...before });
    assert.equal(translators, '[]');
    assert.deepEqual(getSyncChanges(db, cursor).books, []);

    const created = books.addBook(parseBook({ title: '新书', author: '作者', translators: ['甲', '乙'], publisher: 'P', pub_year: '2001', rating: 8.8, douban_id: '2' }).values, null, db);
    assert.deepEqual(translatorDto(created).translators, ['甲', '乙']);
    const catalog = require('../src/db/catalog').buildCatalog(db);
    const mapped = require('../src/core/import').mapHeaders(catalog.headers);
    const row = catalog.rows.find((r) => r[0] === created.id).map((value) => String(value ?? ''));
    const roundTrip = require('../src/core/import').rowToBook(catalog.headers, row, mapped);
    assert.deepEqual(roundTrip.body.translators, ['甲', '乙']);
    const sync = getSyncChanges(db);
    assert.equal(getBookSnapshot(db).books.find((b) => b.id === created.id).translators_display, '甲、乙');
    const body = { title: '改名', status: 'reading' }; // 旧客户端不认识 translators
    const updated = books.updateBook(created.id, mergeUpdate(created, parseBook(body).values, body), null, db);
    for (const key of ['translators', 'publisher', 'pub_year', 'rating', 'douban_id']) assert.equal(updated[key], created[key]);
    const delta = getSyncChanges(db, sync.cursor);
    assert.deepEqual(delta.books[0].translators, ['甲', '乙']);
    assert.ok(updated.revision > created.revision);
    assert.deepEqual(runMigrations(db, dir), { from: migrations.length, to: migrations.length, ran: 0 });
    const patch = buildPatch(updated, toIncoming({ translators: [] }), { overwrite: true }).patch;
    assert.equal('translators' in patch, false);
    const filled = books.enrichBook(db, updated.id, buildPatch(updated, toIncoming({ translators: ['丙'] }), { overwrite: true }).patch);
    assert.deepEqual(translatorDto(filled).translators, ['丙']);
    const clear = { title: filled.title, translators: [] };
    assert.equal(books.updateBook(filled.id, mergeUpdate(filled, parseBook(clear).values, clear), null, db).translators, '[]');
  } finally {
    db.close();
    if (path.dirname(dir) !== path.resolve(os.tmpdir())) throw new Error('拒绝清理非临时测试目录');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
