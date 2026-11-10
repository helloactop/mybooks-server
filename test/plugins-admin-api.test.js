/* ============================================================
 * Phase 4C.2：Plugin Center 只读管理 API 集成测试
 *
 * 真实 express + 临时 SQLite + 本地假商店/假 Runtime。
 * 覆盖认证、路由顺序、错误码、敏感信息与旧接口兼容。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c2-api-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');

const REVIEWED_SHA = '9b5dde1dc3c523605d36eb80a3b1a7dd4be3133ecb056f9a858dd538b5907483';
const TOKEN = 'test-admin-token';

function manifestFor(toolId, revision, extra = {}) {
  return {
    manifest_version: 1,
    tool_id: toolId,
    name: `插件 ${toolId}`,
    version: revision,
    description: 'fixture plugin',
    author: 'QA',
    core_api_version: '1.3.0',
    repo_url: 'https://example.invalid/fixture',
    runtime: { type: 'python', entry: 'tool.FixtureTool' },
    entry_backend: 'tool.FixtureTool',
    entry_frontend: 'index.html',
    permissions: [{ name: 'jobs.create', reason: '创建任务' }],
    ...extra,
  };
}

toolboxRepo.insertTool(db, {
  tool_id: 'md_to_epub',
  name: 'Markdown转EPUB',
  revision: '1.1.0',
  install_path: 'plugins/md_to_epub',
  sha256: REVIEWED_SHA,
  source: 'store',
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: { raw: manifestFor('md_to_epub', '1.1.0', {
    config: {
      schema: {
        type: 'object',
        properties: {
          api_token: { type: 'string', 'x-sensitive': true },
          font_size: { type: 'integer' },
        },
        required: ['api_token'],
      },
    },
  }) },
  pending_restart: false,
});
toolboxRepo.insertTool(db, {
  tool_id: 'zlibrary',
  name: 'Z-Library',
  revision: '0.1.1',
  install_path: 'plugins/zlibrary',
  sha256: 'a'.repeat(64),
  source: 'store',
  compatibility: { supported: false, reviewed: false, reasons: [], warnings: [] },
  manifest: { raw: manifestFor('zlibrary', '0.1.1') },
  pending_restart: false,
});
const task = toolboxRepo.createTask(db, { toolId: 'zlibrary', operation: 'download' });
toolboxRepo.finishTask(db, task.id, { status: 'failed', error: `失败：${toolboxRoot}/data/x` });
db.close();

function jsonServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = handler(req, body);
        res.writeHead(payload.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload.body));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function portOf(server) {
  return server.address().port;
}

function startServer(env) {
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
      ...env,
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

test('Plugin Center 只读 API：认证、路由、脱敏与兼容', async () => {
  const storeServer = await jsonServer(() => ({
    body: {
      tools: [{
        tool_id: 'md_to_epub',
        name: 'Markdown转EPUB',
        description: 'md → epub',
        author: 'QA',
        publish_date: '2026-11-09',
        latest_revision: '1.2.0',
        core_api_version: '1.3.0',
        download_url: 'https://example.test/md.zip',
        sha256: 'c'.repeat(64),
        icon_url: 'https://example.test/md.png',
      }, {
        tool_id: 'zlibrary',
        name: 'Z-Library',
        description: 'download',
        author: 'QA',
        publish_date: '2026-11-08',
        latest_revision: '0.1.1',
        core_api_version: '1.3.0',
        download_url: 'https://example.test/z.zip',
        sha256: 'd'.repeat(64),
      }],
    },
  }));
  const runtimeServer = await jsonServer((req) => {
    if (req.url === '/healthz') {
      return {
        body: {
          status: 'ok',
          isolated: false,
          isolation_mode: 'shared',
          plugins: ['md_to_epub'],
          toolbox_dir: toolboxRoot,
          data_dir: path.join(toolboxRoot, 'data'),
          plugin_auth_only: false,
          uid_isolation: { uid_enabled: false, missing_capabilities: [] },
        },
      };
    }
    if (req.url === '/internal/tool/md_to_epub/config') {
      return { body: { ok: true, config: { api_token: 'runtime-secret-value', font_size: 14 } } };
    }
    return { status: 404, body: { ok: false, code: 'NOT_FOUND' } };
  });

  const { child, ready } = startServer({
    MYBOOKS_TOOLBOX_STORE_URL: `http://127.0.0.1:${portOf(storeServer)}/fulllist.json`,
    MYBOOKS_TOOLBOX_STORE_HOSTS: 'example.test',
    MYBOOKS_TOOLBOX_RUNTIME_URL: `http://127.0.0.1:${portOf(runtimeServer)}`,
  });

  try {
    const base = await ready;
    async function call(pathname, { method = 'GET', auth = true, body } = {}) {
      const headers = {};
      if (auth) headers.Authorization = `Bearer ${TOKEN}`;
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + pathname, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      return { status: response.status, data, text };
    }

    const anonymous = await call('/api/plugins/overview', { auth: false });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.data.code, 'AUTH_REQUIRED');

    const overview = await call('/api/plugins/overview');
    assert.equal(overview.status, 200, overview.text);
    assert.equal(overview.data.counts.installed, 2);
    assert.equal(overview.data.counts.failed, 0);
    assert.equal(overview.data.tasks.failed, 1);
    assert.equal(overview.data.runtime.online, true);
    assert.equal(overview.data.security.risk, 'high');
    assert.ok(!overview.text.includes(toolboxRoot));
    assert.ok(!overview.text.includes(TOKEN));

    const storeIndex = await call('/api/plugins/store/index');
    assert.equal(storeIndex.status, 200, storeIndex.text);
    assert.equal(storeIndex.data.tools.length, 2);
    const zlibrary = storeIndex.data.tools.find((item) => item.tool_id === 'zlibrary');
    assert.equal(zlibrary.reviewed, false);
    assert.equal(zlibrary.latest_revision, '0.1.1');
    assert.equal(zlibrary.download_url, undefined);
    const storeDetail = await call('/api/plugins/store/zlibrary');
    assert.equal(storeDetail.status, 200);
    assert.equal(storeDetail.data.tool.reviewed, false);
    const storeMissing = await call('/api/plugins/store/unknown_plugin');
    assert.equal(storeMissing.status, 404);
    assert.equal(storeMissing.data.code, 'STORE_NOT_FOUND');
    const storeRoot = await call('/api/plugins/store');
    assert.equal(storeRoot.status, 404);
    assert.equal(storeRoot.data.code, 'STORE_NOT_FOUND');

    const installed = await call('/api/plugins/installed');
    assert.equal(installed.status, 200);
    const installedById = new Map(installed.data.tools.map((item) => [item.tool_id, item]));
    assert.equal(installedById.get('md_to_epub').runtime_status, 'loaded');
    assert.equal(installedById.get('zlibrary').runtime_status, 'not_loaded');
    assert.equal(installedById.get('zlibrary').trust, 'unreviewed');
    assert.equal(installedById.get('zlibrary').compatibility.supported, false);

    const detail = await call('/api/plugins/md_to_epub');
    assert.equal(detail.status, 200);
    assert.equal(detail.data.plugin.id, 'md_to_epub');
    assert.equal(detail.data.plugin.raw, undefined);
    assert.equal(detail.data.latest.revision, '1.2.0');
    assert.ok(!detail.text.includes(toolboxRoot));

    const permissions = await call('/api/plugins/md_to_epub/permissions');
    assert.equal(permissions.status, 200);
    assert.equal(permissions.data.policy_state, 'absent');
    assert.equal(permissions.data.can_modify, false);
    assert.equal(permissions.data.requested[0].name, 'jobs.create');

    fs.mkdirSync(path.join(toolboxRoot, 'state'), { recursive: true });
    fs.writeFileSync(path.join(toolboxRoot, 'state', 'grants.json'), '{ broken');
    const broken = await call('/api/plugins/md_to_epub/permissions');
    assert.equal(broken.status, 200);
    assert.equal(broken.data.policy_state, 'broken');
    assert.equal(broken.data.can_modify, false);
    assert.equal(broken.data.granted.length, 0);

    const config = await call('/api/plugins/md_to_epub/config');
    assert.equal(config.status, 200, config.text);
    assert.equal(config.data.values.api_token, '******');
    assert.equal(config.data.values.font_size, 14);
    assert.equal(config.data.sensitive.api_token, true);
    assert.ok(!config.text.includes('runtime-secret-value'));

    const versions = await call('/api/plugins/md_to_epub/versions');
    assert.equal(versions.status, 200);
    assert.equal(versions.data.current.revision, '1.1.0');
    assert.equal(versions.data.latest.revision, '1.2.0');

    const tasks = await call('/api/plugins/tasks?status=failed&tool_id=zlibrary&limit=10');
    assert.equal(tasks.status, 200, tasks.text);
    assert.equal(tasks.data.total, 1);
    assert.equal(tasks.data.tasks[0].tool_id, 'zlibrary');
    assert.ok(!tasks.text.includes(toolboxRoot));
    const taskDetail = await call(`/api/plugins/tasks/${task.id}`);
    assert.equal(taskDetail.status, 200);
    assert.equal(taskDetail.data.plugin.tool_id, 'zlibrary');
    assert.ok(!taskDetail.text.includes(toolboxRoot));
    const missingTask = await call('/api/plugins/tasks/999999');
    assert.equal(missingTask.status, 404);
    assert.equal(missingTask.data.code, 'TASK_NOT_FOUND');

    const errors = await call('/api/plugins/zlibrary/logs?type=errors');
    assert.equal(errors.status, 200);
    assert.ok(errors.data.entries.some((item) => item.source === 'task'));
    assert.ok(!errors.text.includes(toolboxRoot));
    const stdout = await call('/api/plugins/zlibrary/logs?type=stdout');
    assert.equal(stdout.status, 200);
    assert.equal(stdout.data.available, false);
    assert.equal(stdout.data.reason, 'SOURCE_NOT_IMPLEMENTED');

    // 写接口审计：停用 -> 启用，审计日志可读。
    const disabled = await call('/api/toolbox/zlibrary/disable', { method: 'POST' });
    assert.equal(disabled.status, 200, disabled.text);
    const enabled = await call('/api/toolbox/zlibrary/enable', { method: 'POST' });
    assert.equal(enabled.status, 200, enabled.text);
    const auditLogs = await call('/api/plugins/zlibrary/logs?type=audit');
    assert.equal(auditLogs.status, 200);
    assert.ok(auditLogs.data.entries.some((item) => item.code === 'plugin.disable'));
    assert.ok(!auditLogs.text.includes(TOKEN));

    const security = await call('/api/plugins/security');
    assert.equal(security.status, 200);
    assert.equal(security.data.runtime.isolation_mode, 'shared');
    assert.equal(security.data.plugins.reviewed, 1);
    assert.ok(security.data.plugins.unreviewed.includes('zlibrary'));
    assert.ok(security.data.risks.some((item) => item.code === 'SHARED_WORKER_UNREVIEWED'));
    assert.ok(!security.text.includes(toolboxRoot));

    const runtime = await call('/api/plugins/runtime');
    assert.equal(runtime.status, 200);
    assert.ok(Array.isArray(runtime.data.runtimes));
    assert.ok(Array.isArray(runtime.data.builtinInstances));
    assert.equal(runtime.data.toolbox.online, true);
    assert.equal(runtime.data.security.runtime.isolation_mode, 'shared');
    assert.equal(runtime.data.toolbox.info.toolbox_dir, undefined);
    assert.ok(!runtime.text.includes(toolboxRoot));

    const invalid = await call('/api/plugins/..%2Fescape');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'INVALID_PLUGIN_ID');
    const missing = await call('/api/plugins/not_installed');
    assert.equal(missing.status, 404);
    assert.equal(missing.data.code, 'PLUGIN_NOT_FOUND');
    const badStatus = await call('/api/plugins/tasks?status=unknown');
    assert.equal(badStatus.status, 400);
    assert.equal(badStatus.data.code, 'INVALID_QUERY');

    // 旧接口兼容
    const descriptors = await call('/api/plugins/descriptors');
    assert.equal(descriptors.status, 200);
    assert.equal(descriptors.data.plugins.length, 2);
    const oldInstalled = await call('/api/toolbox/installed');
    assert.equal(oldInstalled.status, 200);
    assert.equal(oldInstalled.data.tools.length, 2);
  } finally {
    child.kill();
    storeServer.close();
    runtimeServer.close();
  }
});
