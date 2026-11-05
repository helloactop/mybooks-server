const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createAuthStore } = require('../src/db/auth');
const { createAuthMiddleware, sameOrigin } = require('../src/http/middleware.auth');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-accounts-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
test('管理员密码只落哈希，初始化不能覆盖既有账号', async () => {
  const file = path.join(root, 'account.json');
  const store = createAuthStore(file);
  assert.equal(store.initialized(), false);
  await assert.rejects(store.initialize('admin', 'short'));
  await store.initialize('admin', 'long-test-password');
  assert.equal(await store.verifyPassword('admin', 'long-test-password'), true);
  assert.equal(await store.verifyPassword('other', 'long-test-password'), false);
  assert.equal(await store.verifyPassword('admin', 'incorrect'), false);
  assert.equal(fs.readFileSync(file, 'utf8').includes('long-test-password'), false);
  await assert.rejects(store.initialize('other', 'another-password'), /已初始化/);
});
test('每台设备独立授权，重启后保留，撤销不影响另一设备', () => {
  const file = path.join(root, 'sessions.json');
  const store = createAuthStore(file);
  const a = store.issueSession('phone');
  const b = store.issueSession('browser');
  assert.notEqual(a.token, b.token);
  assert.equal(fs.readFileSync(file, 'utf8').includes(a.token), false);
  const reopened = createAuthStore(file);
  assert.equal(reopened.authenticate(a.token).label, 'phone');
  reopened.revoke(a.id);
  assert.equal(reopened.authenticate(a.token), null);
  assert.ok(reopened.authenticate(b.token));
  assert.equal(JSON.stringify(reopened.listSessions()).includes('tokenHash'), false);
});
test('同一浏览器 device_key 重复登录替换旧会话', () => {
  const file = path.join(root, 'same-device.json');
  const store = createAuthStore(file);
  const first = store.issueSession('网页浏览器', 'browser-key-1');
  const second = store.issueSession('网页浏览器', 'browser-key-1');
  const other = store.issueSession('网页浏览器', 'browser-key-2');
  assert.equal(store.authenticate(first.token), null, '旧会话被替换');
  assert.ok(store.authenticate(second.token));
  assert.ok(store.authenticate(other.token));
  const sessions = store.listSessions();
  assert.equal(sessions.length, 2);
  assert.equal(JSON.stringify(sessions).includes('deviceKeyHash'), false, '不暴露设备指纹');
});

test('设备授权经过多年和重启仍有效，主动撤销后立即失效', (t) => {
  const file = path.join(root, 'permanent.json');
  const store = createAuthStore(file);
  const session = store.issueSession('phone', 'android:permanent');
  assert.equal(session.expires_at, null);
  assert.equal(store.listSessions()[0].expiresAt, null);
  t.mock.method(Date, 'now', () => Date.UTC(2080, 0, 1));
  const reopened = createAuthStore(file);
  assert.ok(reopened.authenticate(session.token));
  assert.equal(reopened.listSessions().length, 1);
  reopened.issueSession('other', 'other-key');
  assert.ok(reopened.authenticate(session.token), '签发其他设备授权不能清理长期会话');
  reopened.revoke(session.id);
  assert.equal(createAuthStore(file).authenticate(session.token), null);
});

test('升级旧授权只迁移未到期会话，过期会话不会恢复', (t) => {
  const file = path.join(root, 'expiration-migration.json');
  const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
  fs.writeFileSync(file, JSON.stringify({ version: 1, admin: null, sessions: [
    { id: 'active', label: 'active', tokenHash: hash('active-token'), deviceKeyHash: hash('stable-key'), expiresAt: Date.now() + 60000 },
    { id: 'expired', label: 'expired', tokenHash: hash('expired-token'), expiresAt: Date.now() - 1 },
  ] }));
  const store = createAuthStore(file);
  assert.ok(store.authenticate('active-token'));
  assert.equal(store.authenticate('expired-token'), null);
  const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(migrated.sessions[0].expiresAt, null);
  assert.equal(migrated.sessions[0].deviceKeyHash, hash('stable-key'));
  t.mock.method(Date, 'now', () => Date.UTC(2080, 0, 1));
  const reopened = createAuthStore(file);
  assert.ok(reopened.authenticate('active-token'));
  assert.equal(reopened.authenticate('expired-token'), null);
});

test('旧令牌先签发设备会话后，仍能初始化账号并保留设备', async () => {
  const store = createAuthStore(path.join(root, 'legacy.json'));
  const session = store.issueSession('old device');
  await store.initialize('admin', 'long-test-password');
  assert.ok(store.authenticate(session.token));
});

test('旧会话绑定稳定标识时仅替换已确认的设备，同名设备保持独立', () => {
  const store = createAuthStore(path.join(root, 'device-migration.json'));
  const legacy = store.issueSession('同型号手机');
  const other = store.issueSession('同型号手机', 'android:other');
  const migrated = store.issueSession('同型号手机', 'android:current', legacy.id);
  assert.equal(store.authenticate(legacy.token), null);
  assert.ok(store.authenticate(other.token));
  assert.ok(store.authenticate(migrated.token));
  const reopened = createAuthStore(path.join(root, 'device-migration.json'));
  const relogin = reopened.issueSession('同型号手机', 'android:current');
  assert.equal(reopened.authenticate(migrated.token), null);
  assert.ok(reopened.authenticate(relogin.token));
  assert.equal(reopened.listSessions().length, 2);
});
test('损坏的授权文件不能变成可接管的未初始化状态', () => {
  const file = path.join(root, 'broken.json');
  fs.writeFileSync(file, '{}');
  assert.throws(() => createAuthStore(file).initialized());
});
test('cookie 写操作拒绝跨站来源，原生无 Origin 可用', () => {
  assert.equal(sameOrigin({ get: (key) => ({ Origin: 'https://evil.test', host: 'books.test' })[key] }), false);
  assert.equal(sameOrigin({ get: (key) => ({ Origin: 'https://books.test', host: 'books.test' })[key] }), true);
  assert.equal(sameOrigin({}), true);
});
test('书库 API 默认要求会话，匿名请求不会因旧公开开关被放行', () => {
  const middleware = createAuthMiddleware({ store: { initialized: () => false, authenticate: () => null }, legacyToken: () => '' });
  const res = { set() {}, status(code) { this.code = code; return this; }, json() {} };
  middleware.requireLibraryAccess({ method: 'GET', headers: {} }, res, () => assert.fail('不能放行'));
  assert.equal(res.code, 503);
});
