export interface LoginCredentials { username: string; password: string; }
let cachedDeviceKey = '';

/** 与旧页面共用随机设备标识，登录重试不会重复授权新设备。 */
export function deviceKey(): string {
  if (cachedDeviceKey) return cachedDeviceKey;
  let key = '';
  try { key = localStorage.getItem('mybooks.deviceKey') || ''; } catch { /* Cookie 兜底。 */ }
  if (!key) {
    try { key = decodeURIComponent(document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('mybooks_device_key='))?.slice(19) || ''); } catch { /* 页面内缓存兜底。 */ }
  }
  if (!key) key = window.crypto?.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  cachedDeviceKey = key;
  try { localStorage.setItem('mybooks.deviceKey', key); } catch { /* 不依赖本地存储。 */ }
  try { document.cookie = `mybooks_device_key=${encodeURIComponent(key)}; Path=/; Max-Age=31536000; SameSite=Lax` + (location.protocol === 'https:' ? '; Secure' : ''); } catch { /* 保留页面内标识。 */ }
  return key;
}

/** 认证失败留在弹窗，不触发管理 API 的登录跳转。 */
export async function authRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch('/api/auth/' + path, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '无法连接服务器，请稍后重试';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

export async function signIn(credentials: LoginCredentials, signal?: AbortSignal): Promise<void> {
  await authRequest('login', { method: 'POST', signal, body: JSON.stringify({ ...credentials, device_name: '网页浏览器', device_key: deviceKey() }) });
  try { localStorage.removeItem('mybooks.adminToken'); } catch { /* 使用已有 HttpOnly 会话 Cookie。 */ }
}
