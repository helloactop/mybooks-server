/* ============================================================
 * Phase 4C.2：插件管理审计单元测试
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c2-audit-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const audit = require('../src/core/toolbox/audit');

test('审计文件不存在时返回空结果', async () => {
  const result = await audit.list({ toolId: 'zlibrary' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.entries, []);
});

test('追加、分页、按插件过滤、最新在前', async () => {
  assert.equal(await audit.record({ action: 'plugin.install', tool_id: 'md_to_epub' }), true);
  assert.equal(await audit.record({
    action: 'plugin.disable', tool_id: 'zlibrary', result: 'success',
  }), true);
  assert.equal(await audit.record({
    action: 'plugin.enable', tool_id: 'zlibrary', result: 'error', error_code: 'TOOL_DISABLED',
  }), true);

  const first = await audit.list({ toolId: 'zlibrary', limit: 1, offset: 0 });
  assert.equal(first.total, 2);
  assert.equal(first.entries[0].action, 'plugin.enable');
  assert.equal(first.entries[0].result, 'error');
  assert.equal(first.entries[0].error_code, 'TOOL_DISABLED');

  const second = await audit.list({ toolId: 'zlibrary', limit: 1, offset: 1 });
  assert.equal(second.entries[0].action, 'plugin.disable');

  const all = await audit.list({ limit: 10 });
  assert.equal(all.total, 3);
  assert.equal(all.entries[0].action, 'plugin.enable');
});

test('敏感字段与绝对路径脱敏，非法事件被拒绝', async () => {
  await audit.record({
    action: 'plugin.install',
    tool_id: 'md_to_epub',
    detail: {
      token: 'should-not-leak',
      config_path: path.join(toolboxRoot, 'data', 'md_to_epub', 'config.json'),
      before: true,
      note: 'ok',
    },
  });
  const result = await audit.list({ toolId: 'md_to_epub', limit: 10 });
  const entry = result.entries[0];
  assert.equal(entry.detail.token, '[redacted]');
  assert.ok(!JSON.stringify(entry).includes('should-not-leak'));
  assert.ok(!JSON.stringify(entry).includes(toolboxRoot));
  assert.equal(entry.detail.before, true);

  assert.equal(await audit.record({ action: 'Bad Action!', tool_id: 'x' }), false);
  assert.equal(await audit.record({ action: 'plugin.install', tool_id: '../escape' }), false);
  assert.equal(await audit.record({ action: 'plugin.install', tool_id: 'ok', result: 'nope' }), false);
});

test('单条日志有大小上限', async () => {
  const detail = {};
  for (let index = 0; index < 20; index += 1) {
    detail[`field_${index}`] = '存'.repeat(300);
  }
  await audit.record({ action: 'plugin.update', tool_id: 'md_to_epub', detail });
  const text = fs.readFileSync(audit.auditPath(), 'utf8').trim().split('\n');
  const line = text[text.length - 1];
  assert.ok(Buffer.byteLength(line) <= audit.MAX_LINE_BYTES);
  assert.doesNotThrow(() => JSON.parse(line));
});

test('并发写入不产生交错 JSON', async () => {
  await Promise.all(Array.from({ length: 30 }, (_, index) => audit.record({
    action: 'plugin.update',
    tool_id: 'md_to_epub',
    detail: { seq: index },
  })));
  const text = fs.readFileSync(audit.auditPath(), 'utf8').trim().split('\n');
  const tail = text.slice(-30);
  for (const line of tail) {
    const item = JSON.parse(line);
    assert.equal(item.tool_id, 'md_to_epub');
    assert.equal(item.action, 'plugin.update');
  }
});

test('损坏行被跳过并计数', async () => {
  fs.appendFileSync(audit.auditPath(), '{ broken json\n');
  const result = await audit.list({ toolId: 'md_to_epub', limit: 100 });
  assert.equal(result.skipped, 1);
  assert.ok(result.entries.length >= 30);
});

test('超过 1MB 自动轮转，最多保留 3 份', async () => {
  fs.writeFileSync(audit.auditPath(), `${'x'.repeat(audit.MAX_FILE_BYTES + 10)}\n`);
  await audit.record({ action: 'plugin.install', tool_id: 'md_to_epub' });
  assert.equal(fs.existsSync(audit.rotatedPath(1)), true);
  const current = fs.readFileSync(audit.auditPath(), 'utf8');
  assert.ok(current.includes('plugin.install'));
  assert.ok(fs.statSync(audit.rotatedPath(1)).size > audit.MAX_FILE_BYTES);
});

test('非法 limit 被收敛到安全范围', async () => {
  const result = await audit.list({ limit: 9999, offset: -5 });
  assert.equal(result.limit, 200);
  assert.equal(result.offset, 0);
});
