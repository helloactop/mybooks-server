/* ============================================================
 * Phase 4C.4-R P2-2 / P2-1：配置首次保存与版本一致性测试
 *
 * 用“文件不存在 → version=''”的假 Runtime 复现首次保存冲突，
 * 并覆盖 Runtime 版本权威、旧 Runtime 兜底与损坏配置不覆盖。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c4r-first-'));
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = path.join(root, 'toolbox');
process.env.MYBOOKS_SEED_DEMO = 'false';

const { createConfigService, versionOf, MASK } = require('../src/core/toolbox/plugin-config');
const audit = require('../src/core/toolbox/audit');

const SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', enum: ['zh-CN', 'en-US'] },
    retries: { type: 'integer', minimum: 0, maximum: 10 },
    api_key: { type: 'string', 'x-sensitive': true },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['api_key'],
};

const descriptor = {
  configuration: { schema: SCHEMA },
  frontend: { entry: 'index.html' },
  ui: { pages: [] },
};

// 与真实 Runtime 一致：文件不存在时版本为空串；存在时按内容哈希。
function createMissingAwareRuntime({ corrupt = false, hideVersion = false } = {}) {
  const store = { config: null };
  const runtime = {
    store,
    callRuntime: async (routePath, options = {}) => {
      assert.match(routePath, /^\/internal\/tool\/demo\/config$/);
      if (corrupt) {
        return { ok: false, status: 500, json: { ok: false, code: 'CONFIG_CORRUPTED' } };
      }
      const current = store.config === null ? {} : store.config;
      const currentVersion = store.config === null ? '' : versionOf(current);
      if (options.method === 'GET') {
        const json = { ok: true, config: current, version: currentVersion };
        if (hideVersion) delete json.version;
        return { ok: true, status: 200, json };
      }
      if (options.method === 'PUT') {
        const body = options.body || {};
        if (body.version !== undefined && String(body.version) !== currentVersion) {
          return { ok: false, status: 409, json: { ok: false, code: 'CONFIG_VERSION_CONFLICT', version: currentVersion } };
        }
        const merged = { ...current, ...(body.values || {}) };
        for (const field of body.clear || []) delete merged[field];
        store.config = merged;
        return { ok: true, status: 200, json: { ok: true, version: versionOf(merged) } };
      }
      throw new Error('unexpected method');
    },
  };
  return runtime;
}

function serviceFor(runtime) {
  return createConfigService({
    runtimeHealth: async () => ({ online: true }),
    descriptorOf: () => descriptor,
    audit,
    callRuntime: runtime.callRuntime,
  });
}

test.after(() => {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 句柄 */ }
});

test('首次读取：文件不存在时 version 为空串且 configured=false', async () => {
  const runtime = createMissingAwareRuntime();
  const view = await serviceFor(runtime).read('demo');
  assert.equal(view.version, '');
  assert.equal(view.configured, false);
  assert.deepEqual(view.values, {});
});

test('首次保存不再返回 CONFIG_VERSION_CONFLICT', async () => {
  const runtime = createMissingAwareRuntime();
  const service = serviceFor(runtime);
  const before = await service.read('demo');
  assert.equal(before.version, '');

  const saved = await service.save('demo', {
    ifVersion: before.version,
    values: { language: 'zh-CN', api_key: 'sk-first' },
  });
  assert.equal(runtime.store.config.api_key, 'sk-first');
  assert.ok(saved.version.startsWith('sha256:'));
  assert.equal(saved.sensitive.api_key, true);
  assert.equal(JSON.stringify(saved).includes('sk-first'), false);
});

test('首次保存后旧版本号再次提交返回 409', async () => {
  const runtime = createMissingAwareRuntime();
  const service = serviceFor(runtime);
  await service.save('demo', { ifVersion: '', values: { api_key: 'a' } });

  await assert.rejects(
    service.save('demo', { ifVersion: '', values: { api_key: 'b' } }),
    (err) => {
      assert.equal(err.code, 'CONFIG_VERSION_CONFLICT');
      assert.equal(err.status, 409);
      assert.ok(err.details.current_version.startsWith('sha256:'));
      return true;
    },
  );
  assert.equal(runtime.store.config.api_key, 'a');
});

test('并发首次保存只有一个成功，另一个 409', async () => {
  const runtime = createMissingAwareRuntime();
  const service = serviceFor(runtime);
  const results = await Promise.allSettled([
    service.save('demo', { ifVersion: '', values: { api_key: 'first' } }),
    service.save('demo', { ifVersion: '', values: { api_key: 'second' } }),
  ]);
  const ok = results.filter((item) => item.status === 'fulfilled');
  const failed = results.filter((item) => item.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.code, 'CONFIG_VERSION_CONFLICT');
  assert.ok(['first', 'second'].includes(runtime.store.config.api_key));
});

test('Runtime 返回的版本是权威来源', async () => {
  const runtime = createMissingAwareRuntime();
  runtime.callRuntime = async (routePath, options = {}) => {
    if (options.method === 'GET') {
      return { ok: true, status: 200, json: { ok: true, config: { api_key: 'x' }, version: 'sha256:runtime-authority' } };
    }
    assert.equal(options.body.version, 'sha256:runtime-authority');
    return { ok: true, status: 200, json: { ok: true, version: 'sha256:after' } };
  };
  const service = serviceFor(runtime);
  const view = await service.read('demo');
  assert.equal(view.version, 'sha256:runtime-authority');
  await service.save('demo', { ifVersion: view.version, values: { language: 'zh-CN' } });
});

test('旧 Runtime 没有 version 字段时使用本地兜底且保持稳定', async () => {
  const runtime = createMissingAwareRuntime({ hideVersion: true });
  runtime.store.config = { language: 'zh-CN', api_key: 'k', nested: { b: [1, 2], a: '中文' } };
  const service = serviceFor(runtime);
  const first = await service.read('demo');
  const second = await service.read('demo');
  assert.ok(first.version.startsWith('sha256:'));
  assert.equal(first.version, second.version);
});

test('损坏的配置不会被当成空配置，也不会被覆盖', async () => {
  const runtime = createMissingAwareRuntime({ corrupt: true });
  const service = serviceFor(runtime);

  await assert.rejects(service.read('demo'), (err) => {
    assert.equal(err.code, 'CONFIG_UNAVAILABLE');
    assert.equal(err.status, 502);
    assert.match(err.message, /损坏/);
    return true;
  });
  await assert.rejects(
    service.save('demo', { values: { api_key: 'overwrite' } }),
    (err) => err.code === 'CONFIG_UNAVAILABLE',
  );
});

test('versionOf 对键顺序、Unicode 与嵌套结构稳定', () => {
  const a = { z: '中文', a: { y: [1, 2], x: true }, n: 3 };
  const b = { n: 3, a: { x: true, y: [1, 2] }, z: '中文' };
  assert.equal(versionOf(a), versionOf(b));
  assert.notEqual(versionOf(a), versionOf({ ...a, n: 4 }));
  assert.equal(MASK, '******');
});
