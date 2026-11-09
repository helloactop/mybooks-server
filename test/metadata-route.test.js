/* ============================================================
 * 元数据路由的输入归一化：
 *   · 合法 ISBN（含分隔符/ISBN-10）走 isbn 参数，且用项目原有校验函数；
 *   · 非法 ISBN 明确 400，不伪装成普通书名继续搜索；
 *   · 普通书名才走 query；
 *   · 空结果不写入缓存。
 * 通过替换宿主元数据服务的 search() 驱动，不发真实网络请求。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { metadata } = require('../src/http/plugin-services');
const { handleMetadataSearch, searchCache } = require('../src/http/routes.metadata');

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    jsonBody: null,
    set(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

const reqFor = (q) => ({ query: { q } });

async function withStubSearch(stub, fn) {
  const original = metadata.service.search;
  metadata.service.search = stub;
  try {
    return await fn();
  } finally {
    metadata.service.search = original;
  }
}

test('合法 ISBN-10 / ISBN-13 都归一化后传给能力服务', async () => {
  const calls = [];
  await withStubSearch(async (input) => {
    calls.push(input);
    return { candidates: [], providerId: 'stub' };
  }, async () => {
    searchCache.clear();

    const byIsbn10 = fakeRes();
    await handleMetadataSearch(reqFor('7-020-00220-X'), byIsbn10);
    assert.equal(byIsbn10.statusCode, 200);

    const byIsbn13 = fakeRes();
    await handleMetadataSearch(reqFor('978-7-02-000220-7'), byIsbn13);
    assert.equal(byIsbn13.statusCode, 200);

    assert.deepEqual(calls[0], { isbn: '9787020002207' }, 'ISBN-10 应归一化为 ISBN-13');
    assert.deepEqual(calls[1], { isbn: '9787020002207' });
  });
});

test('非法 ISBN 明确拒绝，不会退回普通关键词搜索', async () => {
  let called = 0;
  await withStubSearch(async () => { called += 1; return { candidates: [], providerId: 'stub' }; }, async () => {
    searchCache.clear();
    const res = fakeRes();
    await handleMetadataSearch(reqFor('9787020002208'), res); // 校验位错误

    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.code, 'VALIDATION');
    assert.match(res.jsonBody.error, /ISBN/);
    assert.equal(called, 0, '非法 ISBN 不应触发任何 Provider 调用');
  });
});

test('普通书名使用 query，数字标题不被误判为 ISBN', async () => {
  const calls = [];
  await withStubSearch(async (input) => {
    calls.push(input);
    return { candidates: [], providerId: 'stub' };
  }, async () => {
    searchCache.clear();

    const title = fakeRes();
    await handleMetadataSearch(reqFor('三体'), title);
    assert.deepEqual(calls[0], { query: '三体' });

    const shortDigits = fakeRes();
    await handleMetadataSearch(reqFor('2024'), shortDigits);
    assert.deepEqual(calls[1], { query: '2024' });
  });
});

test('空结果不写入缓存，后续请求仍会回源', async () => {
  let called = 0;
  await withStubSearch(async () => {
    called += 1;
    return { candidates: [], providerId: 'stub' };
  }, async () => {
    searchCache.clear();
    const first = fakeRes();
    await handleMetadataSearch(reqFor('empty-query-fixture'), first);
    assert.equal(first.headers['X-Cache'], 'miss');
    assert.equal(searchCache.get('empty-query-fixture'), undefined);

    const second = fakeRes();
    await handleMetadataSearch(reqFor('empty-query-fixture'), second);
    assert.equal(second.headers['X-Cache'], 'miss');
    assert.equal(called, 2, '空结果不能被缓存成 10 分钟的假结果');
  });
});
