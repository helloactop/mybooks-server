/* ============================================================
 * Phase 4C.4.3：配置管理后端测试
 *
 * 用注入的假 Runtime 验证 Node 侧行为：Schema 校验、敏感字段保留/清除、
 * 版本冲突、并发字段合并、Runtime 离线与不泄露明文。
 * Runtime 本身的加解密与原子写入由 toolbox-runtime 的 Python 测试覆盖。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c4-config-'));
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = path.join(root, 'toolbox');
process.env.MYBOOKS_SEED_DEMO = 'false';

const { createConfigService, versionOf, MASK } = require('../src/core/toolbox/plugin-config');
const audit = require('../src/core/toolbox/audit');

const SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', enum: ['zh-CN', 'en-US'], default: 'zh-CN', title: '界面语言' },
    font_size: { type: 'integer', minimum: 8, maximum: 72, title: '字号' },
    enabled: { type: 'boolean', title: '启用转换' },
    api_key: { type: 'string', 'x-sensitive': true, title: 'API Key' },
    webhook_secret: { type: 'string', 'x-sensitive': true, title: '回调密钥' },
  },
  required: ['language', 'api_key'],
};

function createHarness(initial = {}) {
  const store = { config: { ...initial }, online: true };
  const descriptor = {
    configuration: { schema: SCHEMA },
    frontend: { entry: 'index.html' },
    ui: { pages: [] },
  };
  const service = createConfigService({
    runtimeHealth: async () => ({ online: store.online }),
    descriptorOf: () => descriptor,
    audit,
    callRuntime: async (routePath, options = {}) => {
      assert.match(routePath, /^\/internal\/tool\/demo\/config$/);
      if (!store.online) throw Object.assign(new Error('offline'), { code: 'RUNTIME_UNAVAILABLE' });
      if (options.method === 'GET') {
        const data = { ...store.config };
        return { ok: true, status: 200, json: { ok: true, config: data, version: versionOf(data) } };
      }
      if (options.method === 'PUT') {
        const body = options.body || {};
        const current = { ...store.config };
        const currentVersion = versionOf(current);
        if (body.version !== undefined && body.version !== currentVersion) {
          return { ok: false, status: 409, json: { ok: false, code: 'CONFIG_VERSION_CONFLICT', version: currentVersion } };
        }
        const merged = { ...current, ...(body.values || {}) };
        for (const field of body.clear || []) delete merged[field];
        store.config = merged;
        return {
          ok: true,
          status: 200,
          json: { ok: true, version: versionOf(merged), changed_fields: Object.keys(body.values || {}) },
        };
      }
      throw new Error('unexpected method');
    },
  });
  return { store, service };
}

test.after(() => {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 句柄 */ }
});

test('读取配置：敏感字段掩码，非敏感字段原样', async () => {
  const { service } = createHarness({ language: 'zh-CN', api_key: 'sk-live-secret', font_size: 12, enabled: true });
  const view = await service.read('demo');
  assert.equal(view.values.api_key, MASK);
  assert.equal(view.sensitive.api_key, true);
  assert.equal(view.values.language, 'zh-CN');
  assert.equal(view.values.font_size, 12);
  assert.equal(view.values.enabled, true);
  assert.ok(view.version.startsWith('sha256:'));
  assert.equal(JSON.stringify(view).includes('sk-live-secret'), false);
});

test('普通字段（文本/数字/布尔/枚举）可保存并返回实际结果', async () => {
  const { store, service } = createHarness({ language: 'zh-CN', api_key: 'k', font_size: 12, enabled: false });
  const result = await service.save('demo', {
    values: { language: 'en-US', font_size: 30, enabled: true },
    ifVersion: versionOf(store.config),
  });
  assert.equal(store.config.language, 'en-US');
  assert.equal(store.config.font_size, 30);
  assert.equal(store.config.enabled, true);
  assert.equal(result.changed.fields.length, 3);
  assert.equal(JSON.stringify(result).includes('"k"'), false);
});

test('必填缺失、类型错误与未知字段都返回 CONFIG_VALIDATION_FAILED', async () => {
  const { service } = createHarness({ language: 'zh-CN', api_key: 'k' });

  await assert.rejects(
    service.save('demo', { values: {}, clearSensitive: ['api_key'] }),
    (err) => {
      assert.equal(err.code, 'CONFIG_VALIDATION_FAILED');
      assert.ok(err.details.errors.some((item) => item.code === 'CONFIG_REQUIRED'));
      return true;
    },
  );

  await assert.rejects(
    service.save('demo', { values: { font_size: 'abc' } }),
    (err) => {
      assert.equal(err.code, 'CONFIG_VALIDATION_FAILED');
      assert.ok(err.details.errors.some((item) => item.code === 'CONFIG_TYPE'));
      return true;
    },
  );

  await assert.rejects(
    service.save('demo', { values: { unknown_field: 1 } }),
    (err) => {
      assert.equal(err.code, 'CONFIG_VALIDATION_FAILED');
      assert.ok(err.details.errors.some((item) => item.code === 'CONFIG_UNKNOWN_FIELD'));
      return true;
    },
  );
});

test('掩码值不会覆盖真实密钥；留空表示保持原值', async () => {
  const { store, service } = createHarness({ language: 'zh-CN', api_key: 'real-secret' });

  await service.save('demo', { values: { api_key: MASK, font_size: 14 } });
  assert.equal(store.config.api_key, 'real-secret');

  await service.save('demo', { values: { font_size: 16 } });
  assert.equal(store.config.api_key, 'real-secret');
});

test('显式清除敏感字段才删除，并记录审计', async () => {
  const { store, service } = createHarness({
    language: 'zh-CN', api_key: 'real-secret', webhook_secret: 'hook-secret',
  });

  const cleared = await service.save('demo', { values: {}, clearSensitive: ['webhook_secret'] });
  assert.deepEqual(cleared.changed.cleared, ['webhook_secret']);
  assert.equal('webhook_secret' in store.config, false);
  assert.equal(store.config.api_key, 'real-secret');
  assert.equal(JSON.stringify(cleared).includes('hook-secret'), false);

  const listing = await audit.list({ toolId: 'demo', limit: 20 });
  assert.ok(listing.entries.some((item) => item.action === 'config.update'));
  assert.ok(listing.entries.some((item) => item.action === 'config.secret.clear'));
  assert.equal(JSON.stringify(listing.entries).includes('hook-secret'), false);
});

test('清除未声明的或非敏感字段被拒绝', async () => {
  const { service } = createHarness({ language: 'zh-CN', api_key: 'k' });
  await assert.rejects(
    service.save('demo', { values: {}, clearSensitive: ['language'] }),
    (err) => {
      assert.equal(err.code, 'CONFIG_VALIDATION_FAILED');
      assert.ok(err.details.errors.some((item) => item.code === 'CONFIG_CLEAR_INVALID'));
      return true;
    },
  );
  await assert.rejects(
    service.save('demo', { values: {}, clearSensitive: ['nope'] }),
    (err) => err.code === 'CONFIG_VALIDATION_FAILED',
  );
});

test('版本冲突返回 409 且不写入', async () => {
  const { store, service } = createHarness({ language: 'zh-CN', api_key: 'k' });
  await assert.rejects(
    service.save('demo', { values: { language: 'en-US' }, ifVersion: 'sha256:stale' }),
    (err) => {
      assert.equal(err.code, 'CONFIG_VERSION_CONFLICT');
      assert.equal(err.status, 409);
      assert.ok(err.details.current_version.startsWith('sha256:'));
      return true;
    },
  );
  assert.equal(store.config.language, 'zh-CN');
});

test('并发字段更新：后写者收到 409，重试后两者都不丢失', async () => {
  const { store, service } = createHarness({ language: 'zh-CN', api_key: 'k' });
  const startVersion = versionOf(store.config);

  await service.save('demo', { values: { language: 'en-US' }, ifVersion: startVersion });
  await assert.rejects(
    service.save('demo', { values: { api_key: 'k2' }, ifVersion: startVersion }),
    (err) => err.code === 'CONFIG_VERSION_CONFLICT',
  );

  const retry = await service.save('demo', {
    values: { api_key: 'k2' },
    ifVersion: versionOf(store.config),
  });
  assert.equal(store.config.language, 'en-US');
  assert.equal(store.config.api_key, 'k2');
  assert.equal(retry.sensitive.api_key, true);
});

test('Runtime 离线时读写都明确失败，不回退到 Node 读文件', async () => {
  const { store, service } = createHarness({ language: 'zh-CN', api_key: 'k' });
  store.online = false;

  await assert.rejects(service.read('demo'), (err) => {
    assert.equal(err.code, 'RUNTIME_UNAVAILABLE');
    assert.equal(err.status, 503);
    return true;
  });
  await assert.rejects(service.save('demo', { values: { language: 'en-US' } }), (err) => {
    assert.equal(err.code, 'RUNTIME_UNAVAILABLE');
    return true;
  });
  assert.equal(store.config.language, 'zh-CN');
});

test('非法插件 ID 被拒绝', async () => {
  const { service } = createHarness({});
  await assert.rejects(service.read('../etc'), (err) => err.code === 'INVALID_PLUGIN_ID');
});
