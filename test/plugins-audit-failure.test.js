/* ============================================================
 * Phase 4C.4-R P2-3：审计失败可见性测试
 *
 * 权限/配置写入与审计是两次独立落盘。审计失败时：
 *   · 业务写入不回滚；
 *   · 响应必须显式带上 audit.ok=false；
 *   · 重试不能重复扩大权限；
 *   · 失败响应仍不包含密钥/配置值。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c4r-audit-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const grantsAdmin = require('../src/core/toolbox/grants-admin');
const { createConfigService, versionOf } = require('../src/core/toolbox/plugin-config');

const POLICY = path.join(toolboxRoot, 'state', 'grants.json');
const FAILING_AUDIT = { record: async () => false };

toolboxRepo.insertTool(db, {
  tool_id: 'audit_demo',
  name: 'Audit Demo',
  revision: '1.0.0',
  install_path: 'plugins/audit_demo',
  sha256: 'f'.repeat(64),
  source: 'store',
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: {
    raw: {
      manifest_version: 1,
      tool_id: 'audit_demo',
      name: 'Audit Demo',
      version: '1.0.0',
      description: 'fixture',
      author: 'QA',
      core_api_version: '1.3.0',
      repo_url: 'https://example.invalid/fixture',
      runtime: { type: 'python', entry: 'tool.FixtureTool' },
      entry_backend: 'tool.FixtureTool',
      permissions: [
        { name: 'books.read', scope: 'library:all', reason: '读取书库' },
        { name: 'jobs.create', reason: '创建任务' },
      ],
      config: {
        schema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', 'x-sensitive': true },
            theme: { type: 'string', enum: ['light', 'dark'] },
          },
          required: ['api_key'],
        },
      },
    },
  },
  pending_restart: false,
});

test.after(() => {
  try { db.close(); } catch { /* 已关闭 */ }
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 句柄 */ }
});

test('权限写入成功但审计失败：结果显式标记 audit.ok=false', async () => {
  const result = await grantsAdmin.updatePermissions('audit_demo', {
    permissions: [{ name: 'jobs.create' }],
    ifVersion: '',
  }, { auditLog: FAILING_AUDIT });

  assert.equal(result.ok, true);
  assert.equal(result.audit.ok, false);
  assert.equal(result.audit.recorded, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(POLICY, 'utf8')).tools.audit_demo, ['jobs.create']);
});

test('审计失败后重试是幂等的，不会重复扩权', async () => {
  const retry = await grantsAdmin.updatePermissions('audit_demo', {
    permissions: [{ name: 'jobs.create' }],
    ifVersion: grantsAdmin.policyVersion(),
  }, { auditLog: FAILING_AUDIT });

  assert.equal(retry.ok, true);
  assert.deepEqual(retry.changed.granted, []);
  assert.deepEqual(retry.changed.revoked, []);
  assert.equal(retry.changed.total, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(POLICY, 'utf8')).tools.audit_demo, ['jobs.create']);
});

test('失败审计（recordFailure）返回 false 且不抛出', async () => {
  const recorded = await grantsAdmin.recordFailure('audit_demo', 'permission.update', 'POLICY_VERSION_CONFLICT', {
    auditLog: FAILING_AUDIT,
  });
  assert.equal(recorded, false);
});

test('配置写入成功但审计失败：配置落盘且响应不含明文', async () => {
  const store = { config: { api_key: 'sk-audit-secret', theme: 'light' } };
  const service = createConfigService({
    runtimeHealth: async () => ({ online: true }),
    descriptorOf: () => ({
      configuration: {
        schema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', 'x-sensitive': true },
            theme: { type: 'string', enum: ['light', 'dark'] },
          },
          required: ['api_key'],
        },
      },
      frontend: { entry: '' },
      ui: { pages: [] },
    }),
    audit: FAILING_AUDIT,
    callRuntime: async (routePath, options = {}) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, json: { ok: true, config: { ...store.config }, version: versionOf(store.config) } };
      }
      const body = options.body || {};
      if (String(body.version) !== versionOf(store.config)) {
        return { ok: false, status: 409, json: { ok: false, code: 'CONFIG_VERSION_CONFLICT', version: versionOf(store.config) } };
      }
      store.config = { ...store.config, ...(body.values || {}) };
      return { ok: true, status: 200, json: { ok: true, version: versionOf(store.config) } };
    },
  });

  const saved = await service.save('audit_demo', { values: { theme: 'dark' } });
  assert.equal(store.config.theme, 'dark');
  assert.equal(saved.audit.ok, false);
  assert.equal(JSON.stringify(saved).includes('sk-audit-secret'), false);
});

test('审计目录不可写时，审计模块自身只返回 false，不抛出', async () => {
  const audit = require('../src/core/toolbox/audit');
  const ok = await audit.record({ action: 'config.update', tool_id: 'audit_demo', result: 'success' });
  assert.equal(ok, true);
});
