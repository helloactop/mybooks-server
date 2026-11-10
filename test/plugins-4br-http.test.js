/* ============================================================
 * Phase 4B-R：任务状态机 HTTP 回归（P2-1 / P2-2）
 *
 * 真实 express + 临时 SQLite：
 *   · 终态任务不能再次 PATCH（状态或进度）；
 *   · 进度只能单调递增，且必须在 0..100。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4br-http-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');

const MANIFEST = {
  manifest_version: 1,
  tool_id: 'zlibrary',
  name: 'Z-Library',
  version: '0.1.0',
  author: 'tester',
  core_api_version: '1.3.0',
  repo_url: 'https://example.invalid/zlibrary',
  runtime: { type: 'python', entry: 'tool.ZlibraryTool' },
  entry_backend: 'tool.ZlibraryTool',
  entry_frontend: 'index.html',
};

toolboxRepo.insertTool(db, {
  tool_id: 'zlibrary',
  name: 'Z-Library',
  revision: '0.1.0',
  install_path: 'plugins/zlibrary',
  sha256: 'a'.repeat(64),
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: { raw: MANIFEST },
  pending_restart: false,
});
db.close();

fs.mkdirSync(path.join(toolboxRoot, 'state'), { recursive: true });
fs.writeFileSync(path.join(toolboxRoot, 'state', 'grants.json'), JSON.stringify({
  version: 1,
  tools: { zlibrary: ['jobs.create'] },
}));

function startServer() {
  let log = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      ADMIN_TOKEN: '',
      MYBOOKS_STORAGE_DIR: root,
      MYBOOKS_TOOLBOX_DIR: toolboxRoot,
      MYBOOKS_SEED_DEMO: 'false',
      MYBOOKS_TOOLBOX_RUNTIME_URL: 'http://127.0.0.1:1',
      MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY: 'true',
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

test('P2-1/P2-2：终态任务禁改、进度不可回退', async () => {
  const { child, ready } = startServer();
  try {
    const base = await ready;
    const tokens = JSON.parse(
      fs.readFileSync(path.join(toolboxRoot, 'state', 'identities.json'), 'utf8')).tokens;
    const headers = {
      'X-Mybooks-Plugin-Id': 'zlibrary',
      'X-Mybooks-Plugin-Token': tokens.zlibrary,
      'Content-Type': 'application/json',
    };
    async function call(pathname, method = 'GET', body) {
      const response = await fetch(base + pathname, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    }

    const created = await call('/internal/toolbox/tasks', 'POST', { operation: 'download' });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const jobId = created.data.task_id;

    const up = await call(`/internal/toolbox/tasks/${jobId}`, 'PATCH', { progress: 42 });
    assert.equal(up.status, 200);
    assert.equal(up.data.task.progress, 42);

    const back = await call(`/internal/toolbox/tasks/${jobId}`, 'PATCH', { progress: 10 });
    assert.equal(back.status, 409);
    assert.equal(back.data.code, 'TASK_PROGRESS_REGRESSION');

    const invalid = await call(`/internal/toolbox/tasks/${jobId}`, 'PATCH', { progress: 101 });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'TASK_PROGRESS_INVALID');

    const done = await call(`/internal/toolbox/tasks/${jobId}`, 'PATCH', {
      status: 'completed', message: 'ok',
    });
    assert.equal(done.status, 200);
    assert.equal(done.data.task.status, 'completed');
    assert.equal(done.data.task.progress, 100);

    const reopen = await call(`/internal/toolbox/tasks/${jobId}`, 'PATCH', { status: 'cancelled' });
    assert.equal(reopen.status, 409);
    assert.equal(reopen.data.code, 'TASK_ALREADY_FINISHED');

    const progressAfterDone = await call(`/internal/toolbox/tasks/${jobId}`, 'PATCH', { progress: 5 });
    assert.equal(progressAfterDone.status, 409);
    assert.equal(progressAfterDone.data.code, 'TASK_ALREADY_FINISHED');

    const fetched = await call(`/internal/toolbox/tasks/${jobId}`);
    assert.equal(fetched.data.task.status, 'completed');
    assert.equal(fetched.data.task.progress, 100);
  } finally {
    child.kill();
  }
});
