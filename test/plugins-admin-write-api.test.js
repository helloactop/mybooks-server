/* ============================================================
 * Phase 4C.4：权限 / 配置写入 HTTP 接口测试
 *
 * 真实 express + 临时 SQLite + 本地假 Runtime（只实现 /healthz 与配置桥）。
 * 覆盖认证、错误码、版本冲突、敏感字段与审计可见性。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c4-http-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');

const TOKEN = 'test-admin-token';
const PLUGIN = 'md_to_epub';
const POLICY = path.join(toolboxRoot, 'state', 'grants.json');

toolboxRepo.insertTool(db, {
  tool_id: PLUGIN,
  name: 'Markdown转EPUB',
  revision: '1.1.0',
  install_path: 'plugins/md_to_epub',
  sha256: 'c'.repeat(64),
  source: 'store',
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: {
    raw: {
      manifest_version: 1,
      tool_id: PLUGIN,
      name: 'Markdown转EPUB',
      version: '1.1.0',
      description: 'fixture plugin',
      author: 'QA',
      core_api_version: '1.3.0',
      repo_url: 'https://example.invalid/fixture',
      runtime: { type: 'python', entry: 'tool.FixtureTool' },
      entry_backend: 'tool.FixtureTool',
      entry_frontend: 'index.html',
      permissions: [
        { name: 'books.read', scope: 'library:all', reason: '读取书库' },
        { name: 'jobs.create', reason: '创建任务' },
      ],
      config: {
        schema: {
          type: 'object',
          properties: {
            theme: { type: 'string', enum: ['light', 'dark'] },
            retries: { type: 'integer', minimum: 0, maximum: 10 },
            api_key: { type: 'string', 'x-sensitive': true },
          },
          required: ['api_key'],
        },
      },
    },
  },
  pending_restart: false,
});
db.close();

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function versionOf(data) {
  return 'sha256:' + crypto.createHash('sha256').update(stableJson(data || {})).digest('hex');
}

const runtimeState = { config: { theme: 'light', api_key: 'sk-real-secret', retries: 3 } };

function startFakeRuntime() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const send = (status, payload) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (url.pathname === '/healthz') {
          return send(200, {
            status: 'ok',
            plugins: [PLUGIN],
            isolated: false,
            isolation_mode: 'shared',
            plugin_auth_only: false,
            toolbox_dir: toolboxRoot,
          });
        }
        if (url.pathname === `/internal/tool/${PLUGIN}/config`) {
          if (req.method === 'GET') {
            return send(200, { ok: true, config: runtimeState.config, version: versionOf(runtimeState.config) });
          }
          if (req.method === 'PUT') {
            const payload = JSON.parse(body || '{}');
            if (payload.version !== undefined && payload.version !== versionOf(runtimeState.config)) {
              return send(409, { ok: false, code: 'CONFIG_VERSION_CONFLICT', version: versionOf(runtimeState.config) });
            }
            const merged = { ...runtimeState.config, ...(payload.values || {}) };
            for (const field of payload.clear || []) delete merged[field];
            runtimeState.config = merged;
            return send(200, { ok: true, version: versionOf(merged), changed_fields: Object.keys(payload.values || {}) });
          }
        }
        return send(404, { ok: false, code: 'NOT_FOUND' });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function startServer(runtimePort) {
  let log = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      ADMIN_TOKEN: TOKEN,
      MYBOOKS_STORAGE_DIR: root,
      MYBOOKS_TOOLBOX_DIR: toolboxRoot,
      MYBOOKS_SEED_DEMO: 'false',
      MYBOOKS_TOOLBOX_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
      MYBOOKS_TOOLBOX_STORE_URL: 'http://127.0.0.1:9/store.json',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (data) => { log += data; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务器启动超时：' + log)), 15000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('服务器退出：' + log)); });
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
    });
  });
  return { child, ready };
}

async function call(base, pathname, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (auth) headers.Authorization = 'Bearer ' + TOKEN;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('权限与配置写入接口：认证、校验、冲突、脱敏与审计', async (t) => {
  const runtime = await startFakeRuntime();
  const server = startServer(runtime.address().port);
  const base = await server.ready;
  t.after(async () => {
    server.child.kill();
    await new Promise((resolve) => {
      if (server.child.exitCode !== null) return resolve();
      server.child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    runtime.close();
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 句柄 */ }
  });

  await t.test('未登录写入被拒绝', async () => {
    const res = await call(base, `/api/plugins/${PLUGIN}/permissions`, {
      method: 'PUT', auth: false, body: { permissions: [] },
    });
    assert.equal(res.status, 401);
  });

  await t.test('授予权限成功并返回最新实际授权', async () => {
    const before = await call(base, `/api/plugins/${PLUGIN}/permissions`);
    assert.equal(before.status, 200);
    assert.equal(before.json.policy_state, 'absent');

    const saved = await call(base, `/api/plugins/${PLUGIN}/permissions`, {
      method: 'PUT',
      body: { if_version: '', permissions: [{ name: 'books.read', scope: 'library:all' }, { name: 'jobs.create' }] },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.ok, true);
    assert.equal(saved.json.permissions.policy_state, 'ok');
    assert.deepEqual(
      saved.json.permissions.effective.map((item) => `${item.permission}:${item.scope}`).sort(),
      ['books.read:library:all', 'jobs.create:*'],
    );

    const document = JSON.parse(fs.readFileSync(POLICY, 'utf8'));
    assert.deepEqual(document.tools[PLUGIN].sort(), ['books.read:library:all', 'jobs.create']);
  });

  await t.test('版本冲突与未声明权限返回明确错误码', async () => {
    const stale = await call(base, `/api/plugins/${PLUGIN}/permissions`, {
      method: 'PUT',
      body: { if_version: 'sha256:stale', permissions: [{ name: 'jobs.create' }] },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'POLICY_VERSION_CONFLICT');
    assert.ok(stale.json.details.current_version.startsWith('sha256:'));

    const current = await call(base, `/api/plugins/${PLUGIN}/permissions`);
    const undeclared = await call(base, `/api/plugins/${PLUGIN}/permissions`, {
      method: 'PUT',
      body: { if_version: current.json.version, permissions: [{ name: 'network.private', scope: '10.0.0.0/8' }] },
    });
    assert.equal(undeclared.status, 400);
    assert.equal(undeclared.json.code, 'PERMISSION_NOT_DECLARED');
  });

  await t.test('配置读取掩码，写入合并字段且不回传明文', async () => {
    const read = await call(base, `/api/plugins/${PLUGIN}/config`);
    assert.equal(read.status, 200);
    assert.equal(read.json.values.api_key, '******');
    assert.equal(JSON.stringify(read.json).includes('sk-real-secret'), false);

    const saved = await call(base, `/api/plugins/${PLUGIN}/config`, {
      method: 'PUT',
      body: { if_version: read.json.version, values: { theme: 'dark', retries: 5 }, clear_sensitive: [] },
    });
    assert.equal(saved.status, 200);
    assert.equal(runtimeState.config.theme, 'dark');
    assert.equal(runtimeState.config.retries, 5);
    assert.equal(runtimeState.config.api_key, 'sk-real-secret');
    assert.equal(JSON.stringify(saved.json).includes('sk-real-secret'), false);

    const stale = await call(base, `/api/plugins/${PLUGIN}/config`, {
      method: 'PUT',
      body: { if_version: read.json.version, values: { theme: 'light' } },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'CONFIG_VERSION_CONFLICT');
    assert.equal(runtimeState.config.theme, 'dark');
  });

  await t.test('配置校验失败返回 CONFIG_VALIDATION_FAILED 且不落盘', async () => {
    const read = await call(base, `/api/plugins/${PLUGIN}/config`);
    const bad = await call(base, `/api/plugins/${PLUGIN}/config`, {
      method: 'PUT',
      body: { if_version: read.json.version, values: { retries: 99 } },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'CONFIG_VALIDATION_FAILED');
    assert.ok(Array.isArray(bad.json.details.errors));
    assert.equal(runtimeState.config.retries, 5);
  });

  await t.test('审计日志可查询且不含密钥明文', async () => {
    const logs = await call(base, `/api/plugins/${PLUGIN}/logs?type=audit&limit=50`);
    assert.equal(logs.status, 200);
    const actions = logs.json.entries.map((item) => item.code);
    assert.ok(actions.includes('permission.grant'));
    assert.ok(actions.includes('config.update'));
    for (const entry of logs.json.entries) {
      assert.equal(String(entry.message).includes('sk-real-secret'), false);
      assert.equal(entry.actor, 'admin');
    }
  });
});
