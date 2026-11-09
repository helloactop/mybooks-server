const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-internal-auth-'));
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');

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
  revision: '1.1.0',
  enabled: false,
  install_path: 'plugins/md_to_epub',
  sha256: 'b'.repeat(64),
  compatibility: {},
  manifest: { tool_id: 'md_to_epub' },
  pending_restart: false,
});
db.close();

function readState(name) {
  return fs.readFileSync(path.join(root, 'toolbox', 'state', name), 'utf8').trim();
}

test('隔离模式：内部接口只认每插件令牌，共享密钥与未授权插件一律拒绝', async () => {
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
        MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY: 'true',
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

    const internalSecret = readState('internal-secret');
    const tokens = JSON.parse(readState('identities.json')).tokens;
    const sharedOnly = { 'X-Toolbox-Internal-Secret': internalSecret };
    const asZlib = {
      'X-Mybooks-Plugin-Id': 'zlibrary',
      'X-Mybooks-Plugin-Token': tokens.zlibrary,
    };
    const ids = base + '/internal/toolbox/library/ids';

    const anonymous = await fetch(ids);
    assert.equal(anonymous.status, 403);
    assert.equal((await anonymous.json()).code, 'PLUGIN_IDENTITY_REQUIRED');

    const shared = await fetch(ids, { headers: sharedOnly });
    assert.equal(shared.status, 403, '隔离模式不接受共享 internal-secret');
    assert.equal((await shared.json()).code, 'PLUGIN_IDENTITY_REQUIRED');

    const wrong = await fetch(ids, {
      headers: { ...asZlib, 'X-Mybooks-Plugin-Token': 'b'.repeat(48) },
    });
    assert.equal(wrong.status, 403, '错误令牌不可回退');
    assert.equal((await wrong.json()).code, 'PLUGIN_IDENTITY_INVALID');

    const partial = await fetch(ids, {
      headers: { 'X-Mybooks-Plugin-Id': 'zlibrary' },
    });
    assert.equal(partial.status, 403, '缺少令牌头不可回退');

    const noGrants = await fetch(ids, { headers: asZlib });
    assert.equal(noGrants.status, 403);
    assert.equal((await noGrants.json()).code, 'PLUGIN_GRANTS_REQUIRED');

    fs.writeFileSync(path.join(root, 'toolbox', 'state', 'grants.json'), JSON.stringify({
      version: 1,
      tools: { zlibrary: ['books.read:library:all'] },
    }));
    assert.equal((await fetch(ids, { headers: asZlib })).status, 200, '授权后放行');

    const disabled = await fetch(ids, {
      headers: {
        'X-Mybooks-Plugin-Id': 'md_to_epub',
        'X-Mybooks-Plugin-Token': tokens.md_to_epub,
      },
    });
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json()).code, 'TOOL_DISABLED');
  } finally {
    if (child) {
      child.kill();
      if (child.exitCode === null) await once(child, 'exit');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
