const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-legacy-adapter-'));
process.env.MYBOOKS_STORAGE_DIR = suiteRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const { LegacyToolboxAdapter, LegacyAdapterError } = require('../src/core/plugins/adapters/legacy-toolbox');

const adapter = new LegacyToolboxAdapter({ db });

function insert(overrides = {}) {
  const toolId = overrides.tool_id || `tool_${Math.random().toString(36).slice(2, 10)}`;
  return toolboxRepo.insertTool(db, {
    tool_id: toolId,
    name: `Name ${toolId}`,
    revision: '1.0.0',
    install_path: `plugins/${toolId}`,
    sha256: 'a'.repeat(64),
    compatibility: { supported: true, reviewed: false, reasons: [], warnings: [] },
    manifest: { tool_id: toolId, entry_backend: 'backend.main:Tool' },
    pending_restart: false,
    ...overrides,
    tool_id: toolId,
  });
}

test('描述符字段完整，且不泄露安装路径、摘要与 Manifest', () => {
  insert({ tool_id: 'tool_active', name: 'Active Tool' });
  const descriptor = adapter.get('tool_active');

  assert.equal(descriptor.instanceId, 'legacy.tool_active');
  assert.equal(descriptor.pluginId, 'tool_active');
  assert.equal(descriptor.providerId, 'tool_active');
  assert.equal(descriptor.source, 'legacy-toolbox');
  assert.equal(descriptor.name, 'Active Tool');
  assert.equal(descriptor.revision, '1.0.0');
  assert.equal(descriptor.runtime, 'python');
  assert.equal(descriptor.toolType, 'tool');
  assert.equal(descriptor.enabled, true);
  assert.equal(descriptor.status, 'active');
  assert.equal(descriptor.loaded, true);
  assert.deepEqual(descriptor.capabilities, ['legacy.toolbox@1']);
  assert.deepEqual(descriptor.compatibility, { supported: true, reasons: [], warnings: [] });
  assert.equal(descriptor.reviewed, false);
  assert.equal(descriptor.pendingRestart, false);
  assert.equal(descriptor.lastError, '');

  for (const key of ['install_path', 'sha256', 'manifest', 'previous_path', 'previous_revision']) {
    assert.equal(Object.hasOwn(descriptor, key), false, key);
  }
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.capabilities), true);
  assert.equal(Object.isFrozen(descriptor.compatibility), true);
});

test('状态按 enabled / last_error / pending_restart 映射', () => {
  insert({ tool_id: 'tool_disabled', enabled: false });
  insert({ tool_id: 'tool_error', last_error: 'Worker 未加载该工具' });
  insert({ tool_id: 'tool_pending', pending_restart: true });

  const disabled = adapter.get('tool_disabled');
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.loaded, false);

  const failed = adapter.get('tool_error');
  assert.equal(failed.status, 'error');
  assert.equal(failed.loaded, false);
  assert.equal(failed.lastError, 'Worker 未加载该工具');

  const pending = adapter.get('tool_pending');
  assert.equal(pending.status, 'pending_restart');
  assert.equal(pending.loaded, false);
});

test('reviewed 优先取安装时结论，缺失时回退 allowlist', () => {
  insert({ tool_id: 'tool_reviewed', compatibility: { reviewed: true } });
  insert({ tool_id: 'zlibrary', revision: '0.1.0', compatibility: {} });
  insert({ tool_id: 'md_to_epub', revision: '9.9.9', compatibility: {} });

  assert.equal(adapter.get('tool_reviewed').reviewed, true);
  assert.equal(adapter.get('zlibrary').reviewed, true);
  assert.equal(adapter.get('md_to_epub').reviewed, false);
});

test('兼容性只保留结论与错误码，不转发原始说明', () => {
  insert({
    tool_id: 'tool_compat',
    compatibility: {
      supported: false,
      reviewed: false,
      reasons: [{ code: 'REVIEW_REQUIRED', message: '/abs/secret/path' }],
      warnings: [{ code: 'UNREVIEWED_ALLOWED', message: 'internal note' }],
    },
  });

  const descriptor = adapter.get('tool_compat');
  assert.deepEqual(descriptor.compatibility, {
    supported: false,
    reasons: ['REVIEW_REQUIRED'],
    warnings: ['UNREVIEWED_ALLOWED'],
  });
  assert.equal(JSON.stringify(descriptor).includes('/abs/secret/path'), false);
  assert.equal(JSON.stringify(descriptor).includes('internal note'), false);
});

test('list 返回全部旧插件，get 校验 tool_id', () => {
  insert({ tool_id: 'tool_listed' });
  assert.ok(adapter.list().some((item) => item.instanceId === 'legacy.tool_listed'));

  assert.equal(adapter.get('missing_tool'), null);
  assert.throws(
    () => adapter.get('BAD ID'),
    (err) => err instanceof LegacyAdapterError && err.code === 'LEGACY_TOOL_ID_INVALID',
  );
  assert.throws(() => adapter.get(123), (err) => err.code === 'LEGACY_TOOL_ID_INVALID');
  assert.throws(() => new LegacyToolboxAdapter(), (err) => err.code === 'LEGACY_ADAPTER_INVALID');
});
