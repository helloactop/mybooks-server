const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerHooks } = require('node:module');
const { once } = require('node:events');
const express = require('express');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-react-devices-'));
process.env.MYBOOKS_STORAGE_DIR = root;
const { authStore } = require('../src/http/middleware.auth');
const routesAuth = require('../src/http/routes.auth');
// 浏览器构建允许省略扩展名，Node 的原生 TypeScript 测试补齐这一项模块路径。
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === '../auth/auth-service' ? specifier + '.ts' : specifier, context);
} });
after(() => { hooks.deregister(); fs.rmSync(root, { recursive: true, force: true }); });

test('React 设备管理：识别同名设备、保护当前设备、撤销与退出真实会话，失败不伪装成功', async (t) => {
  const app = express();
  app.use(express.json());
  let failWrites = false;
  app.use('/api/auth', (req, res, next) => {
    if (failWrites && ['DELETE', 'POST'].includes(req.method)) return res.status(503).json({ error: '服务器暂不可用' });
    next();
  });
  app.use(routesAuth);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  await authStore.initialize('fixture-admin', 'device-settings-test-password');
  const browser = authStore.issueSession('同名设备', 'settings-browser');
  const phone = authStore.issueSession('同名设备', 'settings-phone');
  const another = authStore.issueSession('另一台设备', 'settings-another');
  const saved = new Map([['mybooks.deviceKey', 'settings-browser'], ['mybooks.adminToken', 'old-fixture']]);
  const realFetch = global.fetch;
  const originalStorage = global.localStorage;
  let requests = 0;
  global.localStorage = { removeItem: (key) => saved.delete(key) };
  global.fetch = (url, options = {}) => {
    requests++;
    const headers = new Headers(options.headers);
    headers.set('Cookie', 'mybooks_session=' + browser.token);
    return realFetch(base + url, { ...options, headers });
  };
  t.after(async () => {
    global.fetch = realFetch;
    if (originalStorage === undefined) delete global.localStorage; else global.localStorage = originalStorage;
    await new Promise((resolve) => server.close(resolve));
  });
  const { loadAccountDevices, revokeDevice, signOut, isSessionExpired } = await import('../web-react/src/features/settings/account-devices.ts');
  const account = await loadAccountDevices();
  assert.equal(account.currentId, browser.id);
  assert.equal(account.devices[0].id, browser.id, '当前设备置顶');
  assert.equal(account.devices.filter((device) => device.label === '同名设备').length, 2, '同名设备不合并');
  assert.deepEqual(Object.keys(account.devices[0]).sort(), ['createdAt', 'id', 'label']);
  const before = requests;
  await assert.rejects(revokeDevice(browser.id, account.currentId), /退出登录/);
  assert.equal(requests, before, '保护当前设备时不发送撤销请求');

  failWrites = true;
  await assert.rejects(revokeDevice(phone.id, account.currentId), /服务器暂不可用/);
  await assert.rejects(signOut(), /服务器暂不可用/);
  assert.ok(authStore.authenticate(phone.token));
  assert.ok(authStore.authenticate(browser.token));
  assert.equal(saved.has('mybooks.adminToken'), true, '退出失败保留本地状态');

  failWrites = false;
  await revokeDevice(phone.id, account.currentId);
  assert.equal(authStore.authenticate(phone.token), null);
  assert.ok(authStore.authenticate(browser.token));
  assert.ok(authStore.authenticate(another.token));
  assert.equal((await loadAccountDevices()).devices.some((device) => device.id === phone.id), false);
  await signOut();
  assert.equal(authStore.authenticate(browser.token), null, '退出撤销当前会话');
  assert.ok(authStore.authenticate(another.token), '退出不影响其他设备');
  assert.equal(saved.has('mybooks.adminToken'), false);
  assert.equal(saved.get('mybooks.deviceKey'), 'settings-browser', '退出保留稳定设备标识');
  await assert.rejects(loadAccountDevices(), (error) => isSessionExpired(error));
  await signOut(); // 当前会话已被撤销时，退出仍可完成。
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadAccountDevices(controller.signal), { name: 'AbortError' });
});
