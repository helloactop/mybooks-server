/* ============================================================
 * Phase 4C.4.1：权限管理后端测试（grants.json 受控写入）
 *
 * 直接调用 grants-admin，不经过 HTTP；覆盖：
 * 授权/撤销/scope、未声明拒绝、非法 scope、absent/broken/last-good、
 * 版本冲突、并发写入、其他插件保留、撤销即时生效、审计事件。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c4-perm-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const grants = require('../src/core/toolbox/plugin-grants');
const grantsAdmin = require('../src/core/toolbox/grants-admin');
const audit = require('../src/core/toolbox/audit');
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
  tool_id: 'alpha',
  name: 'Alpha',
  revision: '1.0.0',
  install_path: 'plugins/alpha',
  sha256: 'a'.repeat(64),
  source: 'store',
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: { raw: manifest('alpha', [
    { name: 'books.read', scope: 'library:all', reason: '读取书库' },
    { name: 'books.delete', scope: 'library:all', reason: '删除书籍' },
    { name: 'jobs.create', reason: '创建任务' },
  ]) },
  pending_restart: false,
});
toolboxRepo.insertTool(db, {
  tool_id: 'beta',
  name: 'Beta',
  revision: '1.0.0',
  install_path: 'plugins/beta',
  sha256: 'b'.repeat(64),
  source: 'store',
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: { raw: manifest('beta', [{ name: 'jobs.create', reason: '创建任务' }]) },
  pending_restart: false,
});

function readPolicy() {
  return JSON.parse(fs.readFileSync(POLICY, 'utf8'));
}

function accessFor(toolId) {
  const policy = grants.pluginGrantsFor(toolId);
  return { policy, access: resolveAccess({ identity: { toolId }, policy, toolInstalled: true, policyState: policy.state }) };
}

test.after(() => {
  try { db.close(); } catch { /* 已关闭 */ }
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 句柄 */ }
});

test('absent 策略首次保存：建立 strict 授权并保留其他插件', async () => {
  assert.equal(grants.pluginGrantsFor('alpha').state, 'absent');

  const first = await grantsAdmin.updatePermissions('beta', {
    permissions: [{ name: 'jobs.create', scope: '*' }],
    ifVersion: '',
  });
  assert.equal(first.policy_state, 'ok');

  const second = await grantsAdmin.updatePermissions('alpha', {
    permissions: [
      { name: 'books.read', scope: 'library:all' },
      { name: 'jobs.create' },
    ],
    ifVersion: first.version,
  });
  assert.equal(second.ok, true);
  assert.deepEqual(second.changed.granted.sort(), ['books.read:library:all', 'jobs.create']);

  const document = readPolicy();
  assert.equal(document.version, 1);
  assert.deepEqual(document.tools.beta, ['jobs.create']);
  assert.deepEqual(document.tools.alpha.sort(), ['books.read:library:all', 'jobs.create']);

  const view = await center.permissions('alpha');
  assert.equal(view.policy_state, 'ok');
  assert.equal(view.strict, true);
  assert.equal(view.can_modify, true);
  assert.equal(view.write_supported, true);
  assert.ok(Array.isArray(view.catalog) && view.catalog.length >= 10);
});

test('撤销权限立即生效：严格模式下后续调用被拒绝', async () => {
  const current = grantsAdmin.policyVersion();
  await grantsAdmin.updatePermissions('alpha', {
    permissions: [{ name: 'jobs.create' }],
    ifVersion: current,
  });

  const { policy, access } = accessFor('alpha');
  assert.equal(policy.state, 'ok');
  assert.equal(access.strict, true);
  assert.throws(() => requireAccess(access, 'alpha', 'books.read', 'library:all'), (err) => {
    assert.equal(err.code, 'PERMISSION_DENIED');
    assert.equal(err.status, 403);
    return true;
  });
  assert.equal(requireAccess(access, 'alpha', 'jobs.create'), undefined);
});

test('只能授予 Manifest 声明过的权限，未知权限同样拒绝', async () => {
  await assert.rejects(
    grantsAdmin.updatePermissions('alpha', {
      permissions: [{ name: 'network.public' }],
      ifVersion: grantsAdmin.policyVersion(),
    }),
    (err) => {
      assert.equal(err.code, 'PERMISSION_NOT_DECLARED');
      assert.equal(err.status, 400);
      return true;
    },
  );

  await assert.rejects(
    grantsAdmin.updatePermissions('alpha', {
      permissions: [{ name: 'books.destroy' }],
      ifVersion: grantsAdmin.policyVersion(),
    }),
    (err) => {
      assert.equal(err.code, 'PERMISSION_INVALID');
      return true;
    },
  );
});

test('资源型权限缺少或携带非法 scope 被拒绝', async () => {
  await assert.rejects(
    grantsAdmin.updatePermissions('alpha', {
      permissions: [{ name: 'books.read' }],
      ifVersion: grantsAdmin.policyVersion(),
    }),
    (err) => {
      assert.equal(err.code, 'PERMISSION_SCOPE_REQUIRED');
      return true;
    },
  );

  await assert.rejects(
    grantsAdmin.updatePermissions('alpha', {
      permissions: [{ name: 'books.read', scope: 'library all' }],
      ifVersion: grantsAdmin.policyVersion(),
    }),
    (err) => {
      assert.equal(err.code, 'PERMISSION_SCOPE_INVALID');
      return true;
    },
  );
});

test('scope 修改会记录为 scope 变更而不是新增授权', async () => {
  // 先建立基线：books.read 明确授予 library:all。
  await grantsAdmin.updatePermissions('alpha', {
    permissions: [{ name: 'books.read', scope: 'library:all' }, { name: 'jobs.create' }],
    ifVersion: grantsAdmin.policyVersion(),
  });

  const result = await grantsAdmin.updatePermissions('alpha', {
    permissions: [{ name: 'books.read', scope: 'book:1' }, { name: 'jobs.create' }],
    ifVersion: grantsAdmin.policyVersion(),
  });
  assert.deepEqual(result.changed.granted, []);
  assert.deepEqual(result.changed.scope_updated.sort(), ['books.read:book:1', 'books.read:library:all']);

  const { policy, access } = accessFor('alpha');
  assert.equal(policy.state, 'ok');
  assert.equal(requireAccess(access, 'alpha', 'books.read', 'book:1'), undefined);
  assert.throws(() => requireAccess(access, 'alpha', 'books.read', 'book:2'));
});

test('if_version 不匹配返回 409 且不修改文件', async () => {
  const before = fs.readFileSync(POLICY, 'utf8');
  await assert.rejects(
    grantsAdmin.updatePermissions('alpha', {
      permissions: [{ name: 'books.delete', scope: 'library:all' }],
      ifVersion: 'sha256:deadbeef',
    }),
    (err) => {
      assert.equal(err.code, 'POLICY_VERSION_CONFLICT');
      assert.equal(err.status, 409);
      assert.ok(err.details && err.details.current_version.startsWith('sha256:'));
      return true;
    },
  );
  assert.equal(fs.readFileSync(POLICY, 'utf8'), before);
});

test('并发写入不丢失：同一版本只有一个成功，另一个 409', async () => {
  const version = grantsAdmin.policyVersion();
  const results = await Promise.allSettled([
    grantsAdmin.updatePermissions('alpha', { permissions: [{ name: 'jobs.create' }], ifVersion: version }),
    grantsAdmin.updatePermissions('beta', { permissions: [{ name: 'jobs.create' }], ifVersion: version }),
  ]);
  const fulfilled = results.filter((item) => item.status === 'fulfilled');
  const rejected = results.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'POLICY_VERSION_CONFLICT');

  const document = readPolicy();
  assert.ok(document.tools.alpha || document.tools.beta);
});

test('空授权列表仍保持 strict，不会退回 Legacy 宽松模式', async () => {
  const result = await grantsAdmin.updatePermissions('beta', {
    permissions: [],
    ifVersion: grantsAdmin.policyVersion(),
  });
  assert.equal(result.policy_state, 'ok');
  assert.deepEqual(readPolicy().tools.beta, []);

  const policy = grants.pluginGrantsFor('beta');
  assert.equal(policy.configured, true);
  const access = resolveAccess({ identity: { toolId: 'beta' }, policy, toolInstalled: true, policyState: 'ok' });
  assert.equal(access.strict, true);
  assert.throws(() => requireAccess(access, 'beta', 'jobs.create'), (err) => err.code === 'PERMISSION_DENIED');
});

test('策略损坏时拒绝写入，原文件保持不变', async () => {
  const original = fs.readFileSync(POLICY, 'utf8');
  // 同时移除可信快照，才会进入 broken（否则只会降级到 last-good）。
  try { fs.unlinkSync(grants.lastGoodPath()); } catch { /* 不存在 */ }
  fs.writeFileSync(POLICY, '{"version": 1, "tools": ', 'utf8');
  grants.invalidateCache();
  assert.equal(grants.pluginGrantsFor('alpha').state, 'broken');

  await assert.rejects(
    grantsAdmin.updatePermissions('alpha', { permissions: [], ifVersion: '' }),
    (err) => {
      assert.equal(err.code, 'POLICY_BROKEN');
      assert.equal(err.status, 409);
      return true;
    },
  );
  assert.equal(fs.readFileSync(POLICY, 'utf8'), '{"version": 1, "tools": ');

  fs.writeFileSync(POLICY, original, 'utf8');
  grants.invalidateCache();
  assert.equal(grants.pluginGrantsFor('alpha').state, 'ok');
});

test('仅有历史快照（文件缺失）时也拒绝写入', async () => {
  // 直接构造可信快照，避免依赖 last-good 的写入节流缓存。
  fs.mkdirSync(path.dirname(grants.lastGoodPath()), { recursive: true });
  fs.writeFileSync(grants.lastGoodPath(), JSON.stringify({
    version: 1,
    tools: { alpha: ['jobs.create'] },
  }), 'utf8');
  try { fs.unlinkSync(POLICY); } catch { /* 已删除 */ }
  grants.invalidateCache();
  assert.equal(grants.pluginGrantsFor('alpha').state, 'last-good');
  assert.equal(grants.pluginGrantsFor('alpha').configured, true);

  await assert.rejects(
    grantsAdmin.updatePermissions('alpha', { permissions: [], ifVersion: '' }),
    (err) => {
      assert.equal(err.code, 'POLICY_NOT_WRITABLE');
      return true;
    },
  );
});

test('写入产生审计事件且不包含实际授权范围之外的敏感信息', async () => {
  grants.loadGrants();
  const listing = await audit.list({ toolId: 'alpha', limit: 50 });
  const actions = listing.entries.map((item) => item.action);
  assert.ok(actions.includes('permission.grant'));
  assert.ok(actions.includes('permission.revoke'));
  assert.ok(actions.includes('permission.scope.update'));

  for (const entry of listing.entries) {
    const text = JSON.stringify(entry);
    assert.doesNotMatch(text, /MYBOOKS_TOOLBOX_DATA_KEY|config\.json|TextEncoder/);
    assert.doesNotMatch(text, /[A-Za-z]:\\\\/);
  }
});
