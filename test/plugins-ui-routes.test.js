/* ============================================================
 * Phase 4C.3：插件中心页面路由与静态资源测试
 *
 * 只验证页面装配与登录保护；数据接口契约由 4C.2 测试覆盖。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4c3-ui-'));
const toolboxRoot = path.join(root, 'toolbox');
const TOKEN = 'test-admin-token';

function startServer() {
  let log = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      ADMIN_TOKEN: TOKEN,
      MYBOOKS_STORAGE_DIR: root,
      MYBOOKS_TOOLBOX_DIR: toolboxRoot,
      MYBOOKS_SEED_DEMO: 'false',
      MYBOOKS_TOOLBOX_STORE_URL: 'http://127.0.0.1:9/store.json',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (data) => { log += data; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务器启动超时：' + log)), 15000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('服务器退出：' + log)); });
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
    });
  });
  return { child, ready };
}

async function get(base, pathname, { auth = true, redirect = 'manual' } = {}) {
  const headers = auth ? { Authorization: 'Bearer ' + TOKEN } : {};
  const res = await fetch(base + pathname, { headers, redirect });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

test('插件中心页面路由、登录保护与旧页面兼容', async (t) => {
  const server = startServer();
  const base = await server.ready;
  t.after(async () => {
    server.child.kill();
    await new Promise((resolve) => {
      if (server.child.exitCode !== null) return resolve();
      server.child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* Windows 下句柄未释放时忽略，临时目录由系统回收 */ }
  });

  await t.test('未登录访问 /plugins 被重定向到登录页', async () => {
    const res = await get(base, '/plugins', { auth: false });
    assert.equal(res.status, 302);
    assert.match(res.location, /^\/login\?next=/);
  });

  await t.test('登录后 /plugins 返回插件中心页面', async () => {
    const res = await get(base, '/plugins');
    assert.equal(res.status, 200);
    assert.match(res.body, /data-page="plugins"/);
    assert.match(res.body, /\/js\/page-plugins\.js/);
    assert.match(res.body, /\/js\/plugin-center\.js/);
    assert.match(res.body, /\/js\/overlay\.js/);
    assert.match(res.body, /\/css\/plugins\.css/);
    assert.match(res.body, /id="pcPanelOverview"/);
  });

  await t.test('登录后 /plugins/:id 返回详情页并校验 ID', async () => {
    const ok = await get(base, '/plugins/md_to_epub');
    assert.equal(ok.status, 200);
    assert.match(ok.body, /data-page="plugin-detail"/);
    assert.match(ok.body, /\/js\/page-plugin-detail\.js/);
    assert.match(ok.body, /\/js\/overlay\.js/);

    const bad = await get(base, '/plugins/BAD-ID!');
    assert.equal(bad.status, 302);
    assert.equal(bad.location, '/plugins');
  });

  await t.test('路径穿越不会命中详情页', async () => {
    const attempts = ['/plugins/..%2f..%2fetc%2fpasswd', '/plugins/%2e%2e%2fserver.js', '/plugins/a%00b'];
    for (const pathname of attempts) {
      const res = await get(base, pathname);
      assert.notEqual(res.status, 200, pathname + ' 不应返回页面');
      assert.doesNotMatch(res.body, /data-page="plugin-detail"/, pathname);
    }
  });

  await t.test('静态页面文件同样受登录保护', async () => {
    for (const pathname of ['/plugins.html', '/plugin-detail.html']) {
      const res = await get(base, pathname, { auth: false });
      assert.equal(res.status, 302, pathname);
      assert.match(res.location, /^\/login\?next=/);
    }
  });

  await t.test('旧 Toolbox 页面仍然可用', async () => {
    const res = await get(base, '/toolbox');
    assert.equal(res.status, 200);
    assert.match(res.body, /data-page="toolbox"/);
    const tool = await get(base, '/toolbox/tool/md_to_epub');
    assert.equal(tool.status, 200);
    assert.match(tool.body, /data-page="toolbox-tool"/);
  });

  await t.test('插件中心样式可匿名获取且不使用第二套框架', async () => {
    const res = await get(base, '/css/plugins.css', { auth: false });
    assert.equal(res.status, 200);
    assert.match(res.body, /\.pc-metrics/);
    assert.doesNotMatch(res.body, /tailwind|bootstrap/i);
  });

  await t.test('4C.2 只读接口契约未变', async () => {
    const res = await get(base, '/api/plugins/installed');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.tools));
    assert.ok(data.runtime && typeof data.runtime.online === 'boolean');
  });
});
