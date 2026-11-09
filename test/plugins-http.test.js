const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-plugins-http-'));
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const { createAuthStore } = require('../src/db/auth');

toolboxRepo.insertTool(db, {
  tool_id: 'zlibrary',
  name: 'Z-Library',
  revision: '0.1.0',
  install_path: 'plugins/zlibrary',
  sha256: 'a'.repeat(64),
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: { tool_id: 'zlibrary', entry_backend: 'backend.main:Tool' },
  pending_restart: false,
});
toolboxRepo.insertTool(db, {
  tool_id: 'md_to_epub',
  name: 'MD to EPUB',
  revision: '1.2.0',
  enabled: false,
  install_path: 'plugins/md_to_epub',
  sha256: 'b'.repeat(64),
  compatibility: {},
  manifest: { tool_id: 'md_to_epub' },
  pending_restart: false,
});
db.close();

test('GET /api/plugins 需要会话、只读且脱敏，旧工具箱接口不变', async () => {
  const store = createAuthStore(path.join(root, 'data', 'auth.json'));
  await store.initialize('admin', 'integration-password');

  let child = null;
  let log = '';
  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        ADMIN_TOKEN: '',
        MYBOOKS_STORAGE_DIR: root,
        MYBOOKS_PUBLIC_READ: 'false',
        MYBOOKS_SEED_DEMO: 'false',
        MYBOOKS_TOOLBOX_RUNTIME_URL: 'http://127.0.0.1:1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (data) => { log += data; });

    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('服务器启动超时：' + log)), 15000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('服务器退出：' + log)); });
      child.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
      });
    });

    assert.equal((await fetch(base + '/api/plugins')).status, 401);

    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'integration-password', device_name: 'android' }),
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    const headers = { Authorization: 'Bearer ' + session.token };

    const response = await fetch(base + '/api/plugins', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.plugins.length, 2);

    const zlib = body.plugins.find((item) => item.instanceId === 'legacy.zlibrary');
    assert.ok(zlib);
    assert.equal(zlib.name, 'Z-Library');
    assert.equal(zlib.revision, '0.1.0');
    assert.equal(zlib.enabled, true);
    assert.equal(zlib.reviewed, true);
    assert.deepEqual(zlib.capabilities, ['legacy.toolbox@1']);

    const raw = JSON.stringify(body);
    assert.equal(raw.includes('plugins/zlibrary'), false, '不能输出 install_path');
    assert.equal(raw.includes('a'.repeat(64)), false, '不能输出 sha256');
    assert.equal(raw.includes('entry_backend'), false, '不能输出 Manifest');

    const legacyList = await fetch(base + '/api/toolbox/list?include_disabled=1', { headers });
    assert.equal(legacyList.status, 200);
    const legacyBody = await legacyList.json();
    assert.equal(legacyBody.tools.length, 2);
    assert.equal(legacyBody.store_enabled, true);
  } finally {
    if (child) {
      child.kill();
      if (child.exitCode === null) await once(child, 'exit');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
