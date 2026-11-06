const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

test('React 登录：复用设备标识，失败留在弹窗，不保存密码和会话令牌', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (body?.password === 'incorrect') { res.writeHead(401); return res.end(JSON.stringify({ error: '账号或密码错误' })); }
    res.end(JSON.stringify({ token: 'fixture-session-token' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const realFetch = global.fetch;
  const saved = new Map([['mybooks.deviceKey', 'existing-device-identity'], ['mybooks.adminToken', 'legacy-fixture']]);
  global.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  global.document = { cookie: '' };
  global.location = { protocol: 'http:' };
  global.window = { crypto: global.crypto };
  global.fetch = (url, options) => realFetch(base + url, options);
  t.after(async () => { global.fetch = realFetch; delete global.window; delete global.document; delete global.location; delete global.localStorage; await new Promise((resolve) => server.close(resolve)); });
  const { signIn, deviceKey } = await import('../web-react/src/features/auth/auth-service.ts');
  await assert.rejects(signIn({ username: 'fixture-user', password: 'incorrect' }), /账号或密码错误/);
  await signIn({ username: 'fixture-user', password: 'fixture-password-for-test' });
  assert.equal(deviceKey(), 'existing-device-identity');
  assert.equal(requests[0].body.device_key, requests[1].body.device_key);
  assert.equal(requests[1].body.device_name, '网页浏览器');
  assert.equal(saved.has('mybooks.adminToken'), false);
  assert.deepEqual([...saved.keys()], ['mybooks.deviceKey']);
  assert.match(document.cookie, /^mybooks_device_key=existing-device-identity;/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(signIn({ username: 'fixture-user', password: 'fixture-password-for-test' }, controller.signal), { name: 'AbortError' });
});
