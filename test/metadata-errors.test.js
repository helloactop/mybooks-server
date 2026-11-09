/* 元数据路由经 Provider 服务后的错误码兼容性：
 * 旧客户端仍看到 BLOCKED / UPSTREAM / UPSTREAM_TIMEOUT / VALIDATION。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const router = require('../src/http/routes.metadata.js');
const { handleMetadataSearch, searchCache } = router;

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    jsonBody: null,
    set(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

async function withFetch(impl, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

test('豆瓣反爬页 → 502 BLOCKED，提示配置 Cookie', async () => {
  await withFetch(
    async () => ({ ok: true, status: 200, text: async () => '<title>禁止访问</title>' }),
    async () => {
      searchCache.clear();
      const res = fakeRes();
      await handleMetadataSearch({ query: { q: 'blocked-case' } }, res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.jsonBody.code, 'BLOCKED');
      assert.match(res.jsonBody.error, /Cookie/);
    },
  );
});

test('上游非 200 → 502 UPSTREAM', async () => {
  await withFetch(
    async () => ({ ok: false, status: 500, text: async () => '' }),
    async () => {
      searchCache.clear();
      const res = fakeRes();
      await handleMetadataSearch({ query: { q: 'upstream-case' } }, res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.jsonBody.code, 'UPSTREAM');
      assert.match(res.jsonBody.error, /HTTP 500/);
    },
  );
});

test('上游超时 → 504 UPSTREAM_TIMEOUT', async () => {
  await withFetch(
    async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
    async () => {
      searchCache.clear();
      const res = fakeRes();
      await handleMetadataSearch({ query: { q: 'timeout-case' } }, res);
      assert.equal(res.statusCode, 504);
      assert.equal(res.jsonBody.code, 'UPSTREAM_TIMEOUT');
    },
  );
});

test('缺少搜索词仍是 400 VALIDATION', async () => {
  const res = fakeRes();
  await handleMetadataSearch({ query: { q: '   ' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.jsonBody.code, 'VALIDATION');
});
