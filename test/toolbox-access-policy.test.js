const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ENV_LEGACY_COMPAT,
  legacyCompatEnabled,
  resolveAccess,
  requireAccess,
} = require('../src/core/toolbox/access-policy');
const { GrantStore } = require('../src/core/plugins/permissions');

function configuredPolicy() {
  const store = new GrantStore();
  store.grant('legacy_tool', 'books.read', 'book:1');
  return { state: 'ok', configured: true, store };
}

function withLegacyCompat(value, fn) {
  const previous = process.env[ENV_LEGACY_COMPAT];
  if (value === undefined) delete process.env[ENV_LEGACY_COMPAT];
  else process.env[ENV_LEGACY_COMPAT] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[ENV_LEGACY_COMPAT];
    else process.env[ENV_LEGACY_COMPAT] = previous;
  }
}

test('默认启用 Legacy 兼容：无身份的内部调用保持旧行为', () => {
  withLegacyCompat(undefined, () => {
    assert.equal(legacyCompatEnabled(), true);
    const access = resolveAccess({ identity: null, policy: null, toolInstalled: false });
    assert.equal(access.mode, 'legacy-compat');
    assert.equal(access.strict, false);
    assert.doesNotThrow(() => requireAccess(access, null, 'books.read', 'library:all'));
  });
});

test('关闭 Legacy 兼容后，无身份的内部调用一律 403', () => {
  withLegacyCompat('false', () => {
    assert.equal(legacyCompatEnabled(), false);
    assert.throws(
      () => resolveAccess({ identity: null, policy: null, toolInstalled: false }),
      (err) => err.code === 'LEGACY_MODE_DISABLED' && err.status === 403,
    );
  });
});

test('已配置策略的插件进入 Strict，按权限与资源范围校验', () => {
  const access = resolveAccess({
    identity: { toolId: 'legacy_tool' },
    policy: configuredPolicy(),
    toolInstalled: true,
  });
  assert.equal(access.mode, 'strict');
  assert.equal(access.strict, true);

  assert.doesNotThrow(() => requireAccess(access, 'legacy_tool', 'books.read', 'book:1'));
  assert.throws(
    () => requireAccess(access, 'legacy_tool', 'books.read', 'book:2'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );
  assert.throws(
    () => requireAccess(access, 'legacy_tool', 'books.delete', 'book:1'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );
});

test('未配置策略但已安装的旧插件：带身份时是 legacy-verified 兼容', () => {
  const access = resolveAccess({
    identity: { toolId: 'md_to_epub' },
    policy: { state: 'ok', configured: false, store: null },
    toolInstalled: true,
  });
  assert.equal(access.mode, 'legacy-verified');
  assert.equal(access.strict, false);
  assert.doesNotThrow(() => requireAccess(access, 'md_to_epub', 'books.read', 'library:all'));
});

test('未知/未安装的新插件没有策略时默认拒绝', () => {
  const access = resolveAccess({
    identity: { toolId: 'new_runtime_plugin' },
    policy: { state: 'absent', configured: false, store: null },
    toolInstalled: false,
  });
  assert.equal(access.mode, 'strict');
  assert.equal(access.strict, true);
  assert.throws(
    () => requireAccess(access, 'new_runtime_plugin', 'books.read', 'library:all'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );

  // 关闭 Legacy 兼容后，已安装但未配置的旧插件也不再自动获得宽松权限。
  withLegacyCompat('false', () => {
    const closed = resolveAccess({
      identity: { toolId: 'md_to_epub' },
      policy: { state: 'ok', configured: false, store: null },
      toolInstalled: true,
    });
    assert.equal(closed.strict, true);
    assert.throws(
      () => requireAccess(closed, 'md_to_epub', 'books.read', 'library:all'),
      (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
    );
  });
});

test('策略整体损坏（broken）时，无身份 Legacy 调用也被拒绝', () => {
  const access = resolveAccess({
    identity: null,
    policy: null,
    toolInstalled: false,
    policyState: 'broken',
  });
  assert.equal(access.mode, 'strict');
  assert.equal(access.reason, 'policy-broken');
  assert.throws(
    () => requireAccess(access, null, 'jobs.create'),
    (err) => err.code === 'PLUGIN_IDENTITY_REQUIRED' && err.status === 403,
  );

  // 即使 Legacy 兼容开关打开，也不能绕过损坏策略的 fail-closed。
  withLegacyCompat('true', () => {
    const stillClosed = resolveAccess({
      identity: null,
      policy: null,
      toolInstalled: false,
      policyState: 'broken',
    });
    assert.equal(stillClosed.strict, true);
    assert.equal(stillClosed.reason, 'policy-broken');
  });
});

test('策略损坏（broken）时带身份的调用默认拒绝，不提供兼容回退', () => {
  const access = resolveAccess({
    identity: { toolId: 'zlibrary' },
    policy: { state: 'broken', configured: true, store: new GrantStore() },
    toolInstalled: true,
  });
  assert.equal(access.mode, 'strict');
  assert.equal(access.reason, 'policy-broken');
  assert.throws(
    () => requireAccess(access, 'zlibrary', 'jobs.create'),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );
});

test('严格模式下资源绑定的权限仍必须显式给出 resource', () => {
  const access = resolveAccess({
    identity: { toolId: 'legacy_tool' },
    policy: configuredPolicy(),
    toolInstalled: true,
  });
  assert.throws(
    () => requireAccess(access, 'legacy_tool', 'books.read'),
    (err) => err.code === 'PERMISSION_RESOURCE_REQUIRED' && err.status === 403,
  );
});
