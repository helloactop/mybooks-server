/* ============================================================
 * Phase 4C.4-R P1-1：权限 scope 越权边界测试
 *
 * 复现：Manifest 声明 book:1，管理端提交 * 曾被接受（越权扩大）。
 * 修复：grant-admin 增加资源语义包含校验；本文件覆盖拒绝与合法路径。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c4r-scope-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const grants = require('../src/core/toolbox/plugin-grants');
const grantsAdmin = require('../src/core/toolbox/grants-admin');
const { center } = require('../src/core/plugins/center');
const { resolveAccess, requireAccess } = require('../src/core/toolbox/access-policy');

const POLICY = path.join(toolboxRoot, 'state', 'grants.json');

function manifest(toolId, permissions) {
  return {
    manifest_version: 1,
    tool_id: toolId,
    name: `插件 ${toolId}`,
    version: '1.0.0',
    description: 'fixture',
    author: 'QA',
    core_api_version: '1.3.0',
    repo_url: 'https://example.invalid/fixture',
    runtime: { type: 'python', entry: 'tool.FixtureTool' },
    entry_backend: 'tool.FixtureTool',
    permissions,
  };
}

toolboxRepo.insertTool(db, {
  tool_id: 'scope_demo',
  name: 'Scope Demo',
  revision: '1.0.0',
  install_path: 'plugins/scope_demo',
  sha256: 'e'.repeat(64),
  source: 'store',
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: {
    raw: manifest('scope_demo', [
      { name: 'books.read', scope: 'book:1', reason: '读取单本书' },
      { name: 'books.write', scope: 'library:all', reason: '写整库' },
      { name: 'files.read', scope: 'artifact:1', reason: '读取单个产物' },
      { name: 'metadata.write', scope: 'artifact:*', reason: '写全部产物元数据' },
      { name: 'jobs.create', reason: '创建任务' },
      { name: 'network.public', reason: '访问公网' },
    ]),
  },
  pending_restart: false,
});

function readPolicy() {
  return JSON.parse(fs.readFileSync(POLICY, 'utf8'));
}

async function rejectScope(permission, scope, code = 'PERMISSION_SCOPE_OUT_OF_RANGE') {
  await assert.rejects(
    grantsAdmin.updatePermissions('scope_demo', {
      permissions: [{ name: permission, scope }],
      ifVersion: grantsAdmin.policyVersion(),
    }),
    (err) => {
      assert.equal(err.code, code);
      assert.equal(err.status, 400);
      return true;
    },
  );
}

test.after(() => {
  try { db.close(); } catch { /* 已关闭 */ }
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 句柄 */ }
});

test('scopeCovers：资源语义包含关系', () => {
  const covers = grantsAdmin.scopeCovers;
  assert.equal(covers('*', 'book:1'), true);
  assert.equal(covers('*', 'library:all'), true);
  assert.equal(covers('book:1', 'book:1'), true);
  assert.equal(covers('book:1', '*'), false);
  assert.equal(covers('book:1', 'book:*'), false);
  assert.equal(covers('book:*', 'book:1'), true);
  assert.equal(covers('artifact:1', 'artifact:*'), false);
  assert.equal(covers('artifact:*', 'artifact:5'), true);
  assert.equal(covers('library:all', 'book:1'), true);
  assert.equal(covers('library:all', 'artifact:1'), false);
  assert.equal(covers('book:1', 'library:all'), false);
  assert.equal(covers('library:all', 'library:all'), true);
  assert.equal(covers('artifact:create', 'artifact:create'), true);
  assert.equal(covers('artifact:create', 'artifact:*'), false);
});

test('P1-1 复现点：声明 book:1 时授予 * 被拒绝', async () => {
  await rejectScope('books.read', '*');
  await assert.rejects(
    grantsAdmin.updatePermissions('scope_demo', {
      permissions: [{ name: 'books.read', scope: 'library:all' }],
      ifVersion: '',
    }),
    (err) => err.code === 'PERMISSION_SCOPE_OUT_OF_RANGE',
  );
  assert.equal(fs.existsSync(POLICY), false, '拒绝时不应创建策略文件');
});

test('跨资源类型与通配扩大都被拒绝', async () => {
  await rejectScope('files.read', 'artifact:*');
  await rejectScope('files.read', 'book:1');
  await rejectScope('books.read', 'artifact:1');
  await rejectScope('metadata.write', '*');
  await rejectScope('books.write', 'library:*');
});

test('合法范围与范围缩小可以保存，多 scope 可共存', async () => {
  const first = await grantsAdmin.updatePermissions('scope_demo', {
    permissions: [
      { name: 'books.read', scope: 'book:1' },
      { name: 'books.write', scope: 'library:all' },
      { name: 'metadata.write', scope: 'artifact:*' },
      { name: 'jobs.create' },
    ],
    ifVersion: '',
  });
  assert.equal(first.ok, true);
  assert.deepEqual(
    readPolicy().tools.scope_demo.sort(),
    ['books.read:book:1', 'books.write:library:all', 'jobs.create', 'metadata.write:artifact:*'],
  );

  // library:all 覆盖书级资源：可以缩小到两本具体的书。
  const narrowed = await grantsAdmin.updatePermissions('scope_demo', {
    permissions: [
      { name: 'books.write', scope: 'book:1' },
      { name: 'books.write', scope: 'book:2' },
      { name: 'jobs.create' },
    ],
    ifVersion: first.version,
  });
  assert.deepEqual(narrowed.changed.scope_updated.sort(), [
    'books.write:book:1',
    'books.write:book:2',
    'books.write:library:all',
  ]);
  assert.deepEqual(
    readPolicy().tools.scope_demo.sort(),
    ['books.write:book:1', 'books.write:book:2', 'jobs.create'],
  );
});

test('已存在的超范围授权不会被编辑悄悄保留', async () => {
  // 直接写入一个历史遗留的越权条目（模拟旧版本管理端产生的文件）。
  fs.mkdirSync(path.join(toolboxRoot, 'state'), { recursive: true });
  fs.writeFileSync(POLICY, JSON.stringify({
    version: 1,
    tools: { scope_demo: ['books.read:*', 'jobs.create'] },
  }), 'utf8');
  grants.invalidateCache();

  const view = await center.permissions('scope_demo');
  assert.deepEqual(view.out_of_range, ['books.read']);

  const saved = await grantsAdmin.updatePermissions('scope_demo', {
    permissions: [{ name: 'jobs.create' }],
    ifVersion: grantsAdmin.policyVersion(),
  });
  assert.deepEqual(saved.changed.revoked, ['books.read']);
  assert.deepEqual(readPolicy().tools.scope_demo, ['jobs.create']);
});

test('撤销权限后严格模式下立即拒绝内部调用', async () => {
  const policy = grants.pluginGrantsFor('scope_demo');
  const access = resolveAccess({ identity: { toolId: 'scope_demo' }, policy, toolInstalled: true, policyState: policy.state });
  assert.equal(access.strict, true);
  assert.throws(
    () => requireAccess(access, 'scope_demo', 'books.read', 'book:1'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );
  assert.equal(requireAccess(access, 'scope_demo', 'jobs.create'), undefined);
});

test('Manifest 未写 scope 视为 *（兼容旧 Manifest），未强制权限仍标记 unenforced', async () => {
  const result = await grantsAdmin.updatePermissions('scope_demo', {
    permissions: [{ name: 'jobs.create' }, { name: 'network.public' }],
    ifVersion: grantsAdmin.policyVersion(),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(readPolicy().tools.scope_demo.sort(), ['jobs.create', 'network.public']);

  const view = await center.permissions('scope_demo');
  assert.ok(view.unenforced.includes('network.public'));
  const risk = view.catalog.find((item) => item.name === 'network.public');
  assert.equal(risk.risk, 'medium');
  const privateRisk = view.catalog.find((item) => item.name === 'network.private');
  assert.equal(privateRisk.risk, 'high');
});

test('if_version 冲突时不修改文件', async () => {
  const before = fs.readFileSync(POLICY, 'utf8');
  await assert.rejects(
    grantsAdmin.updatePermissions('scope_demo', {
      permissions: [{ name: 'jobs.create' }],
      ifVersion: 'sha256:stale',
    }),
    (err) => err.code === 'POLICY_VERSION_CONFLICT' && err.status === 409,
  );
  assert.equal(fs.readFileSync(POLICY, 'utf8'), before);
});

test('无 Manifest 声明的权限仍然拒绝（含目录内权限）', async () => {
  await assert.rejects(
    grantsAdmin.updatePermissions('scope_demo', {
      permissions: [{ name: 'books.delete', scope: 'book:1' }],
      ifVersion: grantsAdmin.policyVersion(),
    }),
    (err) => err.code === 'PERMISSION_NOT_DECLARED',
  );
});
