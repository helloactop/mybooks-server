const { test } = require('node:test');
const assert = require('node:assert/strict');

const { IdentityRegistry } = require('../src/core/plugins/identity');

const TOKEN_A = 'a'.repeat(43);
const TOKEN_B = 'b'.repeat(43);
const TOKEN_C = 'c'.repeat(43);

test('bind 登记不透明令牌，resolve 返回只读身份', () => {
  const identities = new IdentityRegistry();
  const identity = identities.bind({
    token: TOKEN_A,
    instanceId: 'inst.alpha',
    pluginId: 'com.example.alpha',
    runtimeId: 'legacy-toolbox',
  });

  assert.deepEqual(identity, {
    instanceId: 'inst.alpha',
    pluginId: 'com.example.alpha',
    runtimeId: 'legacy-toolbox',
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(identities.resolve(TOKEN_A), identity);
  assert.equal(identities.resolve('unknown-token'), null);
  assert.equal(identities.resolve(123), null);
  assert.equal(identities.size(), 1);
});

test('同一令牌不能绑定到其他实例，重复绑定同一实例幂等', () => {
  const identities = new IdentityRegistry();
  const first = identities.bind({ token: TOKEN_A, instanceId: 'inst.alpha' });
  const again = identities.bind({ token: TOKEN_A, instanceId: 'inst.alpha' });
  assert.equal(again, first);

  assert.throws(
    () => identities.bind({ token: TOKEN_A, instanceId: 'inst.beta' }),
    (err) => err.code === 'IDENTITY_TOKEN_CONFLICT' && err.status === 409,
  );
  assert.equal(identities.size(), 1);
});

test('unbind 幂等，撤销实例会清掉全部令牌', () => {
  const identities = new IdentityRegistry();
  identities.bind({ token: TOKEN_A, instanceId: 'inst.alpha' });
  identities.bind({ token: TOKEN_B, instanceId: 'inst.alpha' });
  identities.bind({ token: TOKEN_C, instanceId: 'inst.beta' });

  assert.equal(identities.unbind(TOKEN_A), true);
  assert.equal(identities.unbind(TOKEN_A), false);
  assert.equal(identities.resolve(TOKEN_A), null);

  assert.equal(identities.revokeInstance('inst.alpha'), 1);
  assert.equal(identities.resolve(TOKEN_B), null);
  assert.equal(identities.revokeInstance('inst.alpha'), 0);
  assert.equal(identities.resolve(TOKEN_C).instanceId, 'inst.beta');
});

test('list 按实例去重排序，且不泄露令牌', () => {
  const identities = new IdentityRegistry();
  identities.bind({ token: TOKEN_A, instanceId: 'inst.beta' });
  identities.bind({ token: TOKEN_B, instanceId: 'inst.alpha' });
  identities.bind({ token: TOKEN_C, instanceId: 'inst.alpha' });

  const list = identities.list();
  assert.deepEqual(list.map((item) => item.instanceId), ['inst.alpha', 'inst.beta']);
  assert.equal(Object.isFrozen(list), true);
  const raw = JSON.stringify(list);
  assert.equal(raw.includes(TOKEN_A), false);
  assert.equal(raw.includes(TOKEN_B), false);
  assert.equal(raw.includes(TOKEN_C), false);
});

test('非法令牌与身份被拒绝', () => {
  const identities = new IdentityRegistry();
  assert.throws(() => identities.bind({ token: 'short', instanceId: 'inst.a' }), (err) => err.code === 'IDENTITY_INVALID');
  assert.throws(() => identities.bind({ token: TOKEN_A, instanceId: 'bad id' }), (err) => err.code === 'IDENTITY_INVALID');
  assert.throws(
    () => identities.bind({ token: TOKEN_A, instanceId: 'inst.a', pluginId: 'bad id' }),
    (err) => err.code === 'IDENTITY_INVALID',
  );
  assert.throws(
    () => identities.bind({ token: TOKEN_A, instanceId: 'inst.a', runtimeId: 'bad id' }),
    (err) => err.code === 'IDENTITY_INVALID',
  );
});

test('dispose 清空令牌', () => {
  const identities = new IdentityRegistry();
  identities.bind({ token: TOKEN_A, instanceId: 'inst.alpha' });
  identities.bind({ token: TOKEN_B, instanceId: 'inst.beta' });
  assert.equal(identities.dispose(), 2);
  assert.equal(identities.resolve(TOKEN_A), null);
  assert.equal(identities.size(), 0);
});
