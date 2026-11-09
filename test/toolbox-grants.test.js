const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-toolbox-grants-'));
process.env.MYBOOKS_TOOLBOX_DIR = suiteRoot;

const { policyPath, lastGoodPath, pluginGrantsFor, policyState } = require('../src/core/toolbox/plugin-grants');

let bump = 0;
function writePolicy(document) {
  bump += 1000;
  fs.mkdirSync(path.dirname(policyPath()), { recursive: true });
  fs.writeFileSync(policyPath(), JSON.stringify(document));
  const stamp = new Date(Date.now() + bump);
  fs.utimesSync(policyPath(), stamp, stamp);
}

function writeCorrupt() {
  bump += 1000;
  fs.writeFileSync(policyPath(), '{ not json');
  const stamp = new Date(Date.now() + bump);
  fs.utimesSync(policyPath(), stamp, stamp);
}

function withoutWarn(fn) {
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
}

test('没有策略文件时保持 Legacy 兼容（明确标记 absent）', () => {
  const policy = pluginGrantsFor('tool_a');
  assert.equal(policy.state, 'absent');
  assert.equal(policy.configured, false);
  assert.equal(policy.store, null);
  assert.equal(policyState(), 'absent');
});

test('配置后按权限与 scope 严格校验，并写入可信快照', () => {
  writePolicy({
    version: 1,
    tools: {
      zlibrary: ['books.read:library:*', 'books.read:book:1', 'jobs.create'],
    },
  });

  const policy = pluginGrantsFor('zlibrary');
  assert.equal(policy.state, 'ok');
  assert.equal(policy.configured, true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'library:all'), true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'book:1'), true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'book:2'), false);
  assert.equal(policy.store.has('zlibrary', 'jobs.create'), true);
  assert.equal(policy.store.has('zlibrary', 'books.delete', 'book:1'), false);
  assert.equal(fs.existsSync(lastGoodPath()), true, '有效策略必须留下快照');

  // 未出现在 tools 里的旧插件仍是 absent 兼容（不是严格拒绝）。
  const other = pluginGrantsFor('md_to_epub');
  assert.equal(other.state, 'ok');
  assert.equal(other.configured, false);
});

test('空数组表示该工具严格拒绝全部权限', () => {
  writePolicy({ version: 1, tools: { locked: [] } });
  const policy = pluginGrantsFor('locked');
  assert.equal(policy.configured, true);
  assert.equal(policy.store.has('locked', 'books.read', 'library:all'), false);
});

test('非法条目被跳过，但工具仍处于严格模式', () => {
  writePolicy({
    version: 1,
    tools: {
      partial: ['root.all', 'books.read:bad scope', 'books.read:book:1'],
    },
  });

  const policy = withoutWarn(() => pluginGrantsFor('partial'));
  assert.equal(policy.configured, true);
  assert.equal(policy.store.has('partial', 'books.read', 'book:1'), true);
  assert.equal(policy.store.has('partial', 'books.read', 'library:all'), false);
});

test('合法 JSON 中授权值类型错误也必须进入严格模式（不得退回宽松）', () => {
  writePolicy({
    version: 1,
    tools: {
      wrong_type: 'books.read:book:1',
      null_value: null,
    },
  });

  const policy = withoutWarn(() => pluginGrantsFor('wrong_type'));
  assert.equal(policy.state, 'ok');
  assert.equal(policy.configured, true, '写出错误类型仍表示该插件已被配置');
  assert.equal(policy.store.has('wrong_type', 'books.read', 'book:1'), false);
  assert.throws(
    () => policy.store.require('wrong_type', 'books.read', 'book:1'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );

  const nullPolicy = withoutWarn(() => pluginGrantsFor('null_value'));
  assert.equal(nullPolicy.configured, true);
  assert.equal(nullPolicy.store.has('null_value', 'jobs.create'), false);
});

test('策略损坏时沿用最近一次有效快照，绝不放宽授权', () => {
  // 先留下一个确实包含 zlibrary 的有效策略，再把它写坏。
  writePolicy({ version: 1, tools: { zlibrary: ['books.read:library:*', 'books.read:book:1'] } });
  assert.equal(pluginGrantsFor('zlibrary').store.has('zlibrary', 'books.read', 'book:1'), true);

  writeCorrupt();
  const policy = withoutWarn(() => pluginGrantsFor('zlibrary'));

  assert.equal(policy.state, 'last-good');
  assert.equal(policy.configured, true, '曾经严格配置的工具不能退回宽松模式');
  assert.equal(policy.store.has('zlibrary', 'books.read', 'library:all'), true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'book:2'), false);
  assert.equal(pluginGrantsFor('md_to_epub').configured, false);
  assert.equal(policyState(), 'last-good');
});

test('策略损坏且无任何可信快照时 fail-closed：所有工具默认拒绝', () => {
  fs.rmSync(lastGoodPath(), { force: true });
  writeCorrupt();

  const policy = withoutWarn(() => pluginGrantsFor('zlibrary'));
  assert.equal(policy.state, 'broken');
  assert.equal(policy.configured, true, '损坏状态不能提示“未配置”');
  assert.equal(policy.store.has('zlibrary', 'books.read', 'library:all'), false);
  assert.throws(
    () => policy.store.require('zlibrary', 'books.read', 'library:all'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );

  const stranger = withoutWarn(() => pluginGrantsFor('brand_new_tool'));
  assert.equal(stranger.configured, true, '损坏状态对未知工具同样拒绝');
});

test('策略恢复后按新配置生效，撤销权限立即拒绝', () => {
  writePolicy({ version: 1, tools: { live: ['books.read:book:1', 'jobs.create'] } });
  assert.equal(pluginGrantsFor('live').store.has('live', 'books.read', 'book:1'), true);

  writePolicy({ version: 1, tools: { live: ['jobs.create'] } });
  const updated = pluginGrantsFor('live');
  assert.equal(updated.configured, true);
  assert.equal(updated.store.has('live', 'books.read', 'book:1'), false, '撤销后立即拒绝');
  assert.equal(updated.store.has('live', 'jobs.create'), true);
});

test('策略文件被删除但存在历史快照时，继续按快照执行（不回到宽松模式）', () => {
  writePolicy({ version: 1, tools: { zlibrary: ['books.read:book:5'] } });
  assert.equal(pluginGrantsFor('zlibrary').store.has('zlibrary', 'books.read', 'book:5'), true);

  fs.rmSync(policyPath(), { force: true });
  const policy = withoutWarn(() => pluginGrantsFor('zlibrary'));
  assert.equal(policy.state, 'last-good');
  assert.equal(policy.configured, true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'book:5'), true);
});
