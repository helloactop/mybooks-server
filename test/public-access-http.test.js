const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createAuthStore } = require('../src/db/auth');

test('公开 API 与新面板外壳；旧面板路径归档跳转', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-public-http-'));
  fs.mkdirSync(path.join(root, 'books-files'));
  fs.writeFileSync(path.join(root, 'books-files', 'fixture.txt'), 'private ebook');
  const store = createAuthStore(path.join(root, 'data', 'auth.json'));
  await store.initialize('admin', 'integration-password-123');

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', ADMIN_TOKEN: '',
      MYBOOKS_STORAGE_DIR: root, MYBOOKS_SEED_DEMO: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stderr.on('data', (data) => { log += data; });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('服务器启动超时：' + log)), 15000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('服务器退出：' + log)); });
      child.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
      });
    });

    const page = (url) => fetch(base + url, { redirect: 'manual' });
    for (const [url, target] of [
      ['/', '/mybooks/'],
      ['/rank', '/mybooks/'],
      ['/stats', '/mybooks/statistics'],
      ['/login?next=%2Fshelf', '/mybooks/'],
      ['/shelf', '/mybooks/books/all'],
      ['/shelf.html', '/mybooks/books/all'],
      ['/tags', '/mybooks/'],
      ['/notes/1', '/mybooks/notes'],
      ['/notes.html', '/mybooks/notes'],
    ]) {
      const response = await page(url);
      assert.equal(response.status, 308, url + ' 旧面板已归档');
      assert.equal(response.headers.get('location'), target, url);
    }
    assert.equal((await page('/mybooks')).status, 308);
    const sw = await page('/sw.js');
    assert.equal(sw.status, 200);
    assert.match(await sw.text(), /unregister/, '旧 Service Worker 注销脚本仍可下发');
    const publicShell = await page('/mybooks/books/all');
    assert.ok([200, 503].includes(publicShell.status), '未构建时返回 503，已构建时匿名返回外壳');
    const shellText = await publicShell.text();
    if (publicShell.status === 200) assert.match(shellText, /id="root"/);
    else assert.match(shellText, /新版管理面板暂不可用/);
    assert.equal(shellText.includes('公开白名单测试'), false, '外壳不嵌入私人书籍数据');

    const publicApis = ['/api/public/home/feed', '/api/home/feed', '/api/public/stats',
      '/api/public/authors', '/api/public/tags'];
    for (const url of publicApis) assert.equal((await fetch(base + url)).status, 200, url);
    for (const url of ['/api/books', '/api/authors', '/api/publishers', '/api/translators', '/api/tags', '/api/stats',
      '/api/stats?vl=private', '/api/sync/books', '/api/sync/folders', '/books-files/fixture.txt']) {
      assert.equal((await fetch(base + url)).status, 401, url + ' 不应匿名开放');
    }
    assert.equal((await fetch(base + '/api/public/books/999')).status, 404);
    assert.equal((await fetch(base + '/api/public/books/abc')).status, 400);

    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'integration-password-123' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const created = await (await fetch(base + '/api/books', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '公开白名单测试', author: '测试作者', summary: '公开简介',
        tags: ['公开'], isbn: '9780000000001',
      }),
    })).json();
    assert.ok(created.id > 0);

    const detail = await (await fetch(base + '/api/public/books/' + created.id)).json();
    assert.equal(detail.title, '公开白名单测试');
    for (const key of ['uuid', 'files', 'notes', 'has_notes', 'custom', 'collections',
      'identifier_list', 'revision', 'deleted_at', 'notes_size']) {
      assert.equal(Object.hasOwn(detail, key), false, `公开详情不能包含 ${key}`);
    }
    assert.equal((await fetch(base + '/api/books/' + created.id)).status, 401);
    assert.equal((await fetch(base + '/api/books/' + created.id, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/stats', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/publishers', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/translators', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(base + '/shelf', { headers: { Cookie: cookie }, redirect: 'manual' })).status, 308);
    assert.equal((await fetch(base + '/books-files/fixture.txt', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/sync/books', { headers: { Cookie: cookie } })).status, 200);
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
