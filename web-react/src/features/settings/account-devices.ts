import { authRequest } from '../auth/auth-service';

export interface AuthorizedDevice { id: string; label: string; createdAt: string; }
export interface AccountDevices { currentId: string; devices: AuthorizedDevice[]; }

export async function loadAccountDevices(signal?: AbortSignal): Promise<AccountDevices> {
  const [me, devices] = await Promise.all([authRequest('me', { signal }), authRequest('devices', { signal })]);
  if (!me || typeof me !== 'object' || !('authenticated' in me) || me.authenticated !== true ||
      !('device' in me) || !me.device || typeof me.device !== 'object' || !('id' in me.device) || typeof me.device.id !== 'string' ||
      !Array.isArray(devices) || devices.some((device) => !device || typeof device.id !== 'string' || !device.id ||
        typeof device.label !== 'string' || typeof device.createdAt !== 'string' || !Number.isFinite(Date.parse(device.createdAt)))) {
    throw new Error('无法读取设备信息，请重试');
  }
  const currentId = me.device.id;
  return { currentId, devices: devices.map(({ id, label, createdAt }) => ({ id, label, createdAt }))
    .sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId) || Date.parse(b.createdAt) - Date.parse(a.createdAt)) };
}

export async function revokeDevice(id: string, currentId: string, signal?: AbortSignal): Promise<void> {
  if (!id || !currentId || id === currentId) throw new Error('请使用退出登录结束当前设备的会话');
  await authRequest('devices/' + encodeURIComponent(id), { method: 'DELETE', signal });
}

export function isSessionExpired(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 401;
}

export async function signOut(signal?: AbortSignal): Promise<void> {
  try { await authRequest('logout', { method: 'POST', signal }); }
  catch (error) { if (!isSessionExpired(error)) throw error; }
  try { localStorage.removeItem('mybooks.adminToken'); } catch { /* 保留设备标识，存储不可用不影响退出。 */ }
}
