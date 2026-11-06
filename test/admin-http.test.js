const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { createAdminRouter } = require('../src/http/routes.admin');
const { createAuthStore } = require('../src/db/auth');
const { createAuthMiddleware } = require('../src/http/middleware.auth');

test('新版面板：公开外壳、子路径刷新、静态资源与构建缺失隔离', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-admin-http-'));
  const distDir = path.join(root, 'dist');
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(distDir, 'assets', 'main-fixture.js'), 'export {};');
  const store = createAuthStore(path.join(root, 'auth.json'));
  const session = store.issueSession('测试浏览器');
  const { authenticate } = createAuthMiddleware({ store, legacyToken: () => '' });
  const app = express();
  app.use('/mybooks', createAdminRouter({ distDir }));
  app.get('/api/example', (req, res) => res.json({ ok: true }));
  app.get('/shelf', (req, res) => res.send('legacy shelf'));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { Cookie: 'mybooks_session=' + session.token };
  const page = (url, options = {}) => fetch(base + url, { headers, redirect: 'manual', ...options });

  const anonymous = await page('/mybooks/books/1?tab=details', { headers: {} });
  assert.equal(anonymous.status, 200);
  assert.match(await anonymous.text(), /id="root"/, '匿名仅获得不含书籍数据的外壳');
  assert.match(anonymous.headers.get('cache-control'), /no-store/);
  const canonical = await page('/mybooks?tab=details');
  assert.equal(canonical.status, 308);
  assert.equal(canonical.headers.get('location'), '/mybooks/?tab=details');

  for (const url of ['/mybooks/', '/mybooks/index.html', '/mybooks/books/1']) {
    const response = await page(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(await response.text(), /id="root"/);
  }
  assert.equal((await page('/mybooks/books/1', { method: 'HEAD' })).status, 200);
  const asset = await page('/mybooks/assets/main-fixture.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /private.*immutable/);
  assert.match(asset.headers.get('content-type'), /javascript/);
  for (const url of ['/mybooks/assets/missing.js', '/mybooks/assets/missing', '/mybooks/missing.css']) {
    assert.equal((await page(url)).status, 404, url);
  }
  assert.equal((await page('/mybooks/books/1', { method: 'POST' })).status, 404);
  assert.deepEqual(await (await page('/api/example')).json(), { ok: true });
  assert.equal(await (await page('/shelf')).text(), 'legacy shelf');

  fs.unlinkSync(path.join(distDir, 'index.html'));
  const unbuilt = await page('/mybooks/');
  assert.equal(unbuilt.status, 503);
  assert.match(unbuilt.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await unbuilt.json(), { error: '新版管理面板暂不可用' });
  store.revoke(session.id);
  assert.equal(authenticate({ headers: { cookie: headers.Cookie } }), null, '撤销会话后不再通过认证');
  assert.equal((await page('/mybooks/')).status, 503, '外壳仍可访问，私有数据由独立 API 认证');
});
