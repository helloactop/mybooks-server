/* ============================================================
 * Phase 4C.2：Plugin Center 聚合服务单元测试
 *
 * 使用临时 SQLite 与注入的商店/Runtime 桩，不访问外网、不启动 Python。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c2-center-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const store = require('../src/core/toolbox/store');
const audit = require('../src/core/toolbox/audit');
const { createCenter } = require('../src/core/plugins/center');

const REVIEWED_SHA = '9b5dde1dc3c523605d36eb80a3b1a7dd4be3133ecb056f9a858dd538b5907483';

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
    permissions: [{ name: 'books.read', scope: 'library:*', reason: '搜索书库' }],
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
          font_size: { type: 'integer', minimum: 8, maximum: 32 },
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

const failed = toolboxRepo.createTask(db, { toolId: 'zlibrary', operation: 'download' });
toolboxRepo.finishTask(db, failed.id, {
  status: 'failed', error: `转换失败 ${path.join(toolboxRoot, 'data', 'zlibrary', 'x.epub')}`,
});
const done = toolboxRepo.createTask(db, { toolId: 'md_to_epub', operation: 'convert' });
toolboxRepo.finishTask(db, done.id, { status: 'completed', message: 'ok' });
toolboxRepo.insertTool(db, {
  tool_id: 'broken_one',
  name: 'Broken',
  revision: '1.0.0',
  install_path: 'plugins/broken_one',
  sha256: 'b'.repeat(64),
  source: 'store',
  compatibility: {},
  manifest: { raw: manifestFor('broken_one', '1.0.0') },
  pending_restart: true,
  last_error: `运行时错误：${path.join(toolboxRoot, 'plugins', 'broken_one')} 不存在`,
});

const now = Date.now();
const storeTools = [{
  tool_id: 'md_to_epub',
  name: 'Markdown转EPUB',
  description: 'md → epub',
  author: 'QA',
  publish_date: '2026-11-09',
  latest_revision: '1.2.0',
  core_api_version: '1.3.0',
  repo_url: '',
  icon_url: '',
  download_url: 'https://example.invalid/md.zip',
  sha256: 'c'.repeat(64),
  archive_kind: 'zip',
  reviewed: true,
  review: { reviewed_at: '2026-11-09', notes: 'ok', limitations: [] },
  compatibility: { supported: true, reasons: [], warnings: [] },
}, {
  tool_id: 'zlibrary',
  name: 'Z-Library',
  description: 'download',
  author: 'QA',
  publish_date: '2026-11-08',
  latest_revision: '0.1.1',
  core_api_version: '1.3.0',
  repo_url: '',
  icon_url: '',
  download_url: 'https://example.invalid/z.zip',
  sha256: 'd'.repeat(64),
  archive_kind: 'zip',
  reviewed: false,
  review: null,
  compatibility: { supported: false, reasons: [{ code: 'REVIEW_REQUIRED', message: '待审查' }], warnings: [] },
}];

const fakeStore = {
  STORE_URL: 'https://example.invalid/fulllist.json',
  peekIndex: () => ({ tools: storeTools, fetchedAt: now, error: '', cached: true, loaded: true }),
  getIndex: async () => ({ tools: storeTools, fetchedAt: now, error: '', cached: true }),
  annotate: store.annotate,
};

const center = createCenter({
  db,
  store: fakeStore,
  runtimeHealth: async () => ({
    online: true,
    status: 200,
    info: {
      plugins: ['md_to_epub'],
      isolated: false,
      isolation_mode: 'shared',
      plugin_auth_only: false,
      toolbox_dir: toolboxRoot,
      uid_isolation: { uid_enabled: false, missing_capabilities: [] },
    },
  }),
  callRuntime: async () => ({
    ok: true,
    status: 200,
    json: {
      ok: true,
      config: { api_token: 'super-secret', font_size: 14, accounts: [{ key: 'x' }] },
    },
  }),
});

test('overview：真实计数、更新数来自商店缓存、无路径泄露', async () => {
  const data = await center.overview();
  assert.equal(data.counts.installed, 3);
  assert.equal(data.counts.enabled, 3);
  assert.equal(data.counts.disabled, 0);
  assert.equal(data.counts.pending_restart, 1);
  assert.equal(data.counts.failed, 1);
  assert.equal(data.counts.updates_available, 1);
  assert.equal(data.tasks.failed, 1);
  assert.equal(data.tasks.completed, 1);
  assert.equal(data.runtime.online, true);
  assert.equal(data.runtime.isolation_mode, 'shared');
  assert.equal(data.security.risk, 'high');
  assert.deepEqual(data.security.unreviewed.sort(), ['broken_one', 'zlibrary']);
  assert.ok(data.recent_errors.some((item) => item.source === 'task'));
  assert.ok(data.recent_errors.some((item) => item.source === 'plugin'));
  const text = JSON.stringify(data);
  assert.ok(!text.includes(toolboxRoot), '不得返回绝对路径');
  assert.ok(!text.includes('super-secret'));
});

test('store/index：过滤、排序、移除 download_url、zlibrary 0.1.1 未审查', async () => {
  const data = await center.storeIndex({ q: 'zlib', sort: 'name' });
  assert.equal(data.tools.length, 1);
  assert.equal(data.tools[0].tool_id, 'zlibrary');
  assert.equal(data.tools[0].reviewed, false);
  assert.equal(data.tools[0].installable, false);
  assert.equal(data.tools[0].download_url, undefined);
  assert.equal(data.store_url, fakeStore.STORE_URL);
  const all = await center.storeIndex({ sort: 'installed' });
  assert.equal(all.tools.length, 2);
  assert.equal(all.tools[0].installed !== null, true);
});

test('installed：运行状态区分 runtime_offline/loaded/disabled，不把 enabled 当成运行', async () => {
  toolboxRepo.setEnabled(db, 'broken_one', false);
  const data = await center.installed();
  const byId = new Map(data.tools.map((item) => [item.tool_id, item]));
  assert.equal(byId.get('md_to_epub').runtime_status, 'loaded');
  assert.equal(byId.get('zlibrary').runtime_status, 'not_loaded');
  assert.equal(byId.get('broken_one').runtime_status, 'disabled');
  assert.equal(byId.get('md_to_epub').trust, 'reviewed');
  assert.equal(byId.get('zlibrary').trust, 'unreviewed');
  assert.equal(byId.get('zlibrary').compatibility.supported, false);
  assert.equal(byId.get('md_to_epub').update_available, true);
  assert.equal(byId.get('md_to_epub').latest_revision, '1.2.0');
  toolboxRepo.setEnabled(db, 'broken_one', true);
});

test('detail/versions：区分 Manifest 与运行态，只展示真实回滚', async () => {
  const data = await center.detail('md_to_epub');
  assert.equal(data.plugin.id, 'md_to_epub');
  assert.equal(data.plugin.raw, undefined);
  assert.equal(data.installed.revision, '1.1.0');
  assert.equal(data.runtime.loaded, true);
  assert.equal(data.latest.revision, '1.2.0');
  assert.equal(data.rollback.available, false);
  assert.deepEqual(data.task_counts.completed, 1);

  const versions = await center.versions('md_to_epub');
  assert.equal(versions.current.revision, '1.1.0');
  assert.equal(versions.latest.revision, '1.2.0');
  assert.equal(versions.update_available, true);
  assert.equal(versions.rollback.available, false);
});

test('permissions：absent 明确降级，broken 只读拒绝', async () => {
  const absent = await center.permissions('md_to_epub');
  assert.equal(absent.policy_state, 'absent');
  assert.equal(absent.strict, false);
  assert.equal(absent.configured, false);
  // 4C.4 起允许在 absent 状态下首次建立严格策略。
  assert.equal(absent.can_modify, true);
  assert.equal(absent.write_supported, true);
  assert.ok(Array.isArray(absent.catalog) && absent.catalog.length > 0);
  assert.ok(absent.warnings[0].includes('grants.json'));
  assert.equal(absent.requested[0].name, 'books.read');
  assert.equal(absent.requested[0].resource_scoped, true);

  fs.mkdirSync(path.join(toolboxRoot, 'state'), { recursive: true });
  fs.writeFileSync(path.join(toolboxRoot, 'state', 'grants.json'), '{ not json');
  const broken = await center.permissions('md_to_epub');
  assert.equal(broken.policy_state, 'broken');
  assert.equal(broken.strict, true);
  assert.equal(broken.can_modify, false);
  assert.equal(broken.granted.length, 0);
  assert.ok(broken.warnings[0].includes('损坏'));
});

test('config：敏感字段掩码、未声明字段不回显、Runtime 离线明确失败', async () => {
  const data = await center.config('md_to_epub');
  assert.equal(data.values.api_token, '******');
  assert.equal(data.values.font_size, 14);
  assert.equal(data.values.accounts, undefined);
  assert.equal(data.sensitive.api_token, true);
  assert.equal(data.runtime_online, true);
  assert.equal(data.validation.ok, true);

  const offline = createCenter({
    db,
    store: fakeStore,
    runtimeHealth: async () => ({ online: false, error: 'offline' }),
  });
  await assert.rejects(
    () => offline.config('md_to_epub'),
    (err) => err.code === 'RUNTIME_UNAVAILABLE' && err.status === 503,
  );
});

test('tasks/logs：筛选、分页、stdout 明确不可用、错误脱敏', async () => {
  const tasks = center.tasks({ toolId: 'zlibrary', status: 'failed', limit: 10 });
  assert.equal(tasks.total, 1);
  assert.equal(tasks.tasks[0].tool_id, 'zlibrary');
  assert.ok(!JSON.stringify(tasks).includes(toolboxRoot));

  const detail = center.taskDetail(failed.id);
  assert.equal(detail.task.status, 'failed');
  assert.equal(detail.plugin.tool_id, 'zlibrary');
  assert.ok(!JSON.stringify(detail).includes(toolboxRoot));

  const stdout = await center.logs('zlibrary', { type: 'stdout' });
  assert.equal(stdout.available, false);
  assert.equal(stdout.reason, 'SOURCE_NOT_IMPLEMENTED');

  const errors = await center.logs('zlibrary', { type: 'errors' });
  assert.equal(errors.available, true);
  assert.ok(errors.entries.some((item) => item.source === 'task'));
  assert.ok(!JSON.stringify(errors).includes(toolboxRoot));

  await audit.record({ action: 'plugin.disable', tool_id: 'zlibrary', result: 'success' });
  const logs = await center.logs('zlibrary', { type: 'audit' });
  assert.equal(logs.entries[0].source, 'audit');
  assert.equal(logs.entries[0].code, 'plugin.disable');
});

test('security：共享 Worker + 未审查插件 = 高风险，且不返回绝对路径', async () => {
  const data = await center.security();
  assert.equal(data.runtime.online, true);
  assert.equal(data.runtime.isolation_mode, 'shared');
  assert.equal(data.plugins.reviewed, 1);
  assert.ok(data.plugins.unreviewed.includes('zlibrary'));
  assert.ok(data.risks.some((item) => item.code === 'SHARED_WORKER_UNREVIEWED' && item.level === 'high'));
  assert.ok(data.risks.some((item) => item.code === 'LEGACY_AUTH_COMPAT'));
  assert.equal(data.runtime.path.checked, true);
  assert.equal(data.runtime.path.mismatch, false);
  const text = JSON.stringify(data);
  assert.ok(!text.includes(toolboxRoot));

  const runtime = await center.runtimeAndSecurity();
  assert.equal(runtime.toolbox.info.toolbox_dir, undefined);
  assert.equal(runtime.toolbox.path.node, undefined);
  assert.equal(runtime.security.risk, 'high');
});

test('非法插件 ID 与不存在插件返回明确错误码', async () => {
  await assert.rejects(() => center.detail('../etc'), (err) => err.code === 'INVALID_PLUGIN_ID');
  await assert.rejects(() => center.detail('not_installed'), (err) => err.code === 'PLUGIN_NOT_FOUND');
  assert.throws(() => center.tasks({ status: 'unknown' }), (err) => err.code === 'INVALID_QUERY');
});
