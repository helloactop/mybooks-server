'use strict';

const statusEl = document.getElementById('accountStatus');
const form = document.getElementById('loginForm');
const panel = document.getElementById('accountPanel');
const deviceList = document.getElementById('deviceList');
const deviceCount = document.getElementById('deviceCount');
const accountName = document.getElementById('accountName');
const accountDevice = document.getElementById('accountDevice');
let currentId = '';

// 只接受同源相对路径，拒绝 //host、绝对 URL 和回到登录页自身。
function nextDestination() {
  const raw = new URLSearchParams(location.search).get('next');
  if (!raw) return '';
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin || url.pathname === '/login') return '';
    return url.pathname + url.search + url.hash;
  } catch {
    return '';
  }
}

async function request(path, options = {}) {
  const res = await fetch('/api/auth/' + path, {
    ...options, headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function dateText(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleDateString('zh-CN');
}

function deviceRow(device, isCurrent) {
  const li = document.createElement('li');
  li.className = 'device-row' + (isCurrent ? ' is-current' : '');

  const icon = document.createElement('span');
  icon.className = 'device-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▣';

  const copy = document.createElement('span');
  copy.className = 'device-copy';
  const name = document.createElement('strong');
  name.textContent = device.label || '未命名设备';
  const meta = document.createElement('span');
  meta.className = 'device-meta';
  meta.textContent = isCurrent
    ? `当前设备 · 登录于 ${dateText(device.createdAt)}`
    : `登录于 ${dateText(device.createdAt)}`;
  copy.append(name, meta);

  li.append(icon, copy);

  if (isCurrent) {
    const badge = document.createElement('span');
    badge.className = 'device-current';
    badge.textContent = '当前设备';
    li.append(badge);
    return li;
  }

  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.className = 'btn btn-danger-tint device-revoke';
  revoke.textContent = '撤销';
  revoke.addEventListener('click', async () => {
    if (!confirm(`撤销设备「${device.label || '未命名设备'}」的访问权限？`)) return;
    try {
      await request('devices/' + encodeURIComponent(device.id), { method: 'DELETE' });
      await refresh();
    } catch (error) {
      statusEl.textContent = error.message;
    }
  });
  li.append(revoke);
  return li;
}

async function refresh() {
  try {
    const status = await request('status');
    if (!status.initialized) {
      statusEl.textContent = '服务器尚未初始化。请在服务器终端运行 npm run setup，设置管理员账号。';
      form.hidden = true;
      panel.hidden = true;
      return;
    }
    let me;
    try { me = await request('me'); } catch {
      statusEl.textContent = '使用服务器管理员账号登录。';
      form.hidden = false;
      panel.hidden = true;
      return;
    }
    currentId = me.device.id;
    const next = nextDestination();
    if (next) { location.replace(next); return; }

    form.hidden = true;
    panel.hidden = false;
    statusEl.textContent = '已登录，可管理书库与已授权设备。';
    accountName.textContent = 'My books 管理员';
    accountDevice.textContent = `当前设备 · ${me.device.label || '网页浏览器'}`;

    const devices = await request('devices');
    deviceCount.textContent = `${devices.length} 台设备`;
    const ordered = devices.slice().sort((a, b) => {
      if (a.id === currentId) return -1;
      if (b.id === currentId) return 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    deviceList.replaceChildren(...ordered.map((device) => deviceRow(device, device.id === currentId)));
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

let cachedDeviceKey = '';
function deviceKey() {
  if (cachedDeviceKey) return cachedDeviceKey;
  const storageKey = 'mybooks.deviceKey';
  const cookieName = 'mybooks_device_key';
  let key = '';
  try { key = localStorage.getItem(storageKey) || ''; } catch { /* Cookie 兜底 */ }
  if (!key) {
    try {
      key = decodeURIComponent(document.cookie.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '');
    } catch { /* 存储均不可用时保留页面内标识 */ }
  }
  if (!key) key = window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  cachedDeviceKey = key;
  try { localStorage.setItem(storageKey, key); } catch { /* Cookie 兜底 */ }
  try {
    // 仅保存随机设备标识，不含登录凭据；退出后保留，供下次登录识别。
    document.cookie = `${cookieName}=${encodeURIComponent(key)}; Path=/; Max-Age=31536000; SameSite=Lax`
      + (location.protocol === 'https:' ? '; Secure' : '');
  } catch { /* 页面内缓存仍可用 */ }
  return cachedDeviceKey;
}

function clearLegacyToken() {
  try { localStorage.removeItem('mybooks.adminToken'); } catch { /* 不影响 Cookie 会话 */ }
}

async function login(useToken) {
  const buttons = form.querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });
  statusEl.textContent = '正在登录…';
  try {
    const fields = new FormData(form);
    const credentials = useToken ? { token: fields.get('token') }
      : { username: fields.get('username'), password: fields.get('password') };
    await request('login', {
      method: 'POST',
      body: JSON.stringify({ ...credentials, device_name: '网页浏览器', device_key: deviceKey() }),
    });
    clearLegacyToken();
    form.reset();
    const next = nextDestination();
    if (next) location.assign(next);
    else await refresh();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); login(false); });
document.getElementById('tokenLogin').addEventListener('click', () => login(true));
document.getElementById('logout').addEventListener('click', async () => {
  try {
    await request('logout', { method: 'POST' });
    clearLegacyToken();
    statusEl.textContent = '已退出当前设备。';
    await refresh();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

refresh();
