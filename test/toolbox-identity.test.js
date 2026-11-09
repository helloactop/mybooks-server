const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-toolbox-identity-'));
process.env.MYBOOKS_TOOLBOX_DIR = suiteRoot;

const {
  identitiesPath,
  ensureIdentityTokens,
  loadIdentityTokens,
  verifyIdentity,
} = require('../src/core/toolbox/identities');

test('令牌生成、落盘与重启复用', () => {
  const first = ensureIdentityTokens([{ tool_id: 'tool_a' }, { tool_id: 'tool_b' }]);
  assert.match(first.tool_a, /^[a-f0-9]{48}$/);
  assert.match(first.tool_b, /^[a-f0-9]{48}$/);
  assert.notEqual(first.tool_a, first.tool_b);

  const second = ensureIdentityTokens([{ tool_id: 'tool_a' }, { tool_id: 'tool_b' }]);
  assert.deepEqual(second, first, '同一工具必须复用旧令牌');

  const third = ensureIdentityTokens([{ tool_id: 'tool_b' }]);
  assert.equal(third.tool_b, first.tool_b);
  assert.equal(Object.hasOwn(third, 'tool_a'), false, '卸载工具的令牌应移除');
  assert.deepEqual(loadIdentityTokens(), third);

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(identitiesPath()).mode & 0o777, 0o600);
  }
});

test('verifyIdentity 只接受匹配的工具与令牌', () => {
  const tokens = ensureIdentityTokens([{ tool_id: 'tool_a' }, { tool_id: 'tool_b' }]);

  assert.equal(verifyIdentity('tool_a', tokens.tool_a), true);
  assert.equal(verifyIdentity('tool_a', tokens.tool_b), false);
  assert.equal(verifyIdentity('tool_a', tokens.tool_a.toUpperCase()), false);
  assert.equal(verifyIdentity('missing', tokens.tool_a), false);
  assert.equal(verifyIdentity('bad id', tokens.tool_a), false);
  assert.equal(verifyIdentity('tool_a', 'short'), false);
});

test('非法 tool_id 被跳过', () => {
  const tokens = ensureIdentityTokens([
    { tool_id: 'BAD ID' },
    { tool_id: '' },
    {},
    null,
    { tool_id: 'ok_tool' },
  ]);
  assert.deepEqual(Object.keys(tokens), ['ok_tool']);
});
