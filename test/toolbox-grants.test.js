const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-toolbox-grants-'));
process.env.MYBOOKS_TOOLBOX_DIR = suiteRoot;

const { policyPath, pluginGrantsFor } = require('../src/core/toolbox/plugin-grants');

let bump = 0;
function writePolicy(document) {
  bump += 1000;
  fs.mkdirSync(path.dirname(policyPath()), { recursive: true });
  fs.writeFileSync(policyPath(), JSON.stringify(document));
  const stamp = new Date(Date.now() + bump);
  fs.utimesSync(policyPath(), stamp, stamp);
}

function withoutWarn(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

test('没有策略文件时保持旧行为', () => {
  const policy = pluginGrantsFor('tool_a');
  assert.equal(policy.configured, false);
  assert.equal(policy.store, null);
});

test('配置后按权限与 scope 严格校验', () => {
  writePolicy({
    version: 1,
    tools: {
      zlibrary: ['books.read:library:*', 'books.read:book:1', 'jobs.create'],
    },
  });

  const policy = pluginGrantsFor('zlibrary');
  assert.equal(policy.configured, true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'library:all'), true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'book:1'), true);
  assert.equal(policy.store.has('zlibrary', 'books.read', 'book:2'), false);
  assert.equal(policy.store.has('zlibrary', 'jobs.create'), true);
  assert.equal(policy.store.has('zlibrary', 'books.delete'), false);

  assert.equal(pluginGrantsFor('md_to_epub').configured, false);
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

test('损坏的策略文件不启用裁剪', () => {
  bump += 1000;
  fs.writeFileSync(policyPath(), '{ not json');
  const stamp = new Date(Date.now() + bump);
  fs.utimesSync(policyPath(), stamp, stamp);

  const policy = withoutWarn(() => pluginGrantsFor('zlibrary'));
  assert.equal(policy.configured, false);
});

test('策略更新后按 mtime 重新加载', () => {
  writePolicy({ version: 1, tools: { live: ['books.read:book:1'] } });
  assert.equal(pluginGrantsFor('live').store.has('live', 'books.read', 'book:2'), false);

  writePolicy({ version: 1, tools: { live: ['books.read:book:2'] } });
  const updated = pluginGrantsFor('live');
  assert.equal(updated.store.has('live', 'books.read', 'book:1'), false);
  assert.equal(updated.store.has('live', 'books.read', 'book:2'), true);
});
