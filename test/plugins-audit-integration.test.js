/* ============================================================
 * Phase 4C.4.5：审计集成测试
 *
 * 覆盖权限/配置操作写入的审计事件、失败记录、分页、时间过滤、
 * 日志注入防护与敏感字段脱敏。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c4-audit-'));
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = path.join(root, 'toolbox');
process.env.MYBOOKS_SEED_DEMO = 'false';

const audit = require('../src/core/toolbox/audit');

const TOOL = 'demo_plugin';

test.after(() => {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 句柄 */ }
});

test('权限与配置事件按最新在前返回，包含结果与错误码', async () => {
  await audit.record({ action: 'permission.grant', tool_id: TOOL, result: 'success', detail: { changed_fields: ['books.read:library:all'] } });
  await audit.record({ action: 'permission.revoke', tool_id: TOOL, result: 'success', detail: { changed_fields: ['jobs.create'] } });
  await audit.record({ action: 'permission.scope.update', tool_id: TOOL, result: 'success', detail: { changed_fields: ['books.read:book:1'] } });
  await audit.record({ action: 'permission.update', tool_id: TOOL, result: 'error', error_code: 'POLICY_VERSION_CONFLICT' });
  await audit.record({ action: 'config.update', tool_id: TOOL, result: 'success', detail: { changed_fields: ['language'] } });
  await audit.record({ action: 'config.secret.clear', tool_id: TOOL, result: 'success', detail: { changed_fields: ['webhook_secret'] } });

  const listing = await audit.list({ toolId: TOOL, limit: 50 });
  const actions = listing.entries.map((item) => item.action);
  for (const action of ['permission.grant', 'permission.revoke', 'permission.scope.update', 'permission.update', 'config.update', 'config.secret.clear']) {
    assert.ok(actions.includes(action), `缺少审计事件 ${action}`);
  }
  const failure = listing.entries.find((item) => item.action === 'permission.update');
  assert.equal(failure.result, 'error');
  assert.equal(failure.error_code, 'POLICY_VERSION_CONFLICT');
  assert.equal(listing.entries[0].action, 'config.secret.clear');
});

test('分页与时间过滤有效', async () => {
  const page = await audit.list({ toolId: TOOL, limit: 2, offset: 0 });
  assert.equal(page.entries.length, 2);
  assert.equal(page.total, 6);

  const second = await audit.list({ toolId: TOOL, limit: 2, offset: 2 });
  assert.equal(second.entries.length, 2);
  assert.notEqual(page.entries[0].at + page.entries[0].action, second.entries[0].at + second.entries[0].action);

  const future = new Date(Date.now() + 60_000).toISOString();
  const empty = await audit.list({ toolId: TOOL, since: future });
  assert.equal(empty.total, 0);

  const past = new Date(Date.now() - 60_000).toISOString();
  const all = await audit.list({ toolId: TOOL, since: past });
  assert.equal(all.total, 6);
});

test('日志注入：控制字符与换行不会生成额外记录', async () => {
  await audit.record({
    action: 'config.update',
    tool_id: TOOL,
    result: 'error',
    error_code: 'CONFIG_SAVE_FAILED',
    detail: { changed_fields: ['language\n{"action":"permission.grant","tool_id":"evil"}'] },
  });
  const listing = await audit.list({ toolId: TOOL, limit: 50 });
  const injected = listing.entries.find((entry) => entry.error_code === 'CONFIG_SAVE_FAILED');
  assert.ok(injected);
  assert.equal(listing.entries.filter((entry) => entry.tool_id === 'evil').length, 0);
  assert.doesNotMatch(injected.detail.changed_fields[0], /\n/);

  const lines = fs.readFileSync(audit.auditPath(), 'utf8').trim().split('\n');
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

test('敏感字段与绝对路径不会落盘', async () => {
  await audit.record({
    action: 'config.update',
    tool_id: TOOL,
    result: 'success',
    detail: {
      api_key: 'sk-should-not-appear',
      authorization: 'Bearer abc',
      note: `失败：${path.join(root, 'toolbox', 'data', TOOL, 'config.json')} 无法读取`,
    },
  });
  const raw = fs.readFileSync(audit.auditPath(), 'utf8');
  assert.equal(raw.includes('sk-should-not-appear'), false);
  assert.equal(raw.includes('Bearer abc'), false);
  assert.equal(raw.includes(root), false);

  const listing = await audit.list({ toolId: TOOL, limit: 50 });
  const entry = listing.entries[0];
  assert.equal(entry.detail.api_key, '[redacted]');
  assert.equal(entry.detail.authorization, '[redacted]');
});

test('并发写入不会交错损坏 JSONL', async () => {
  const jobs = Array.from({ length: 20 }, (_, index) => audit.record({
    action: 'permission.grant',
    tool_id: 'concurrent',
    result: 'success',
    detail: { changed_fields: [`jobs.create:${index}`] },
  }));
  await Promise.all(jobs);
  const text = fs.readFileSync(audit.auditPath(), 'utf8').trim();
  const lines = text.split('\n');
  assert.equal(lines.length >= 20, true);
  for (const line of lines) {
    const item = JSON.parse(line);
    assert.ok(item.ts && item.action);
  }
  const listing = await audit.list({ toolId: 'concurrent', limit: 100 });
  assert.equal(listing.total, 20);
});

test('非法动作被拒绝，不影响后续写入', async () => {
  const before = (await audit.list({ toolId: TOOL })).total;
  const ok = await audit.record({ action: '../../etc/passwd', tool_id: TOOL });
  assert.equal(ok, false);
  const after = (await audit.list({ toolId: TOOL })).total;
  assert.equal(after, before);
  assert.equal(await audit.record({ action: 'config.update', tool_id: TOOL }), true);
});
