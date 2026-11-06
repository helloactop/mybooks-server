export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** 新面板只使用自己的登录弹窗；不再跳转旧登录页。 */
export async function apiGet(url: string, signal?: AbortSignal, options: { publicAccess?: boolean; redirectOnUnauthorized?: boolean } = {}): Promise<{ data: unknown; total: number | null }> {
  return apiRequest(url, { signal }, options);
}

export async function apiRequest(url: string, init: RequestInit = {}, options: { publicAccess?: boolean; redirectOnUnauthorized?: boolean } = {}): Promise<{ data: unknown; total: number | null }> {
  const signal = init.signal;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (!options.publicAccess) { try { const token = localStorage.getItem('mybooks.adminToken'); if (token) headers.Authorization = `Bearer ${token}`; } catch { /* 存储可能被禁用。 */ } }
  const combined = new Headers(headers);
  new Headers(init.headers).forEach((value, key) => combined.set(key, value));
  const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', headers: combined, signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const data: unknown = await response.json().catch(() => null);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!response.ok) {
    const body = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    if (response.status === 401 && !options.publicAccess && options.redirectOnUnauthorized !== false) {
      try { localStorage.removeItem('mybooks.adminToken'); } catch { /* 无需本地存储也能登录。 */ }
      if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('mybooks:login-required', { cancelable: true }));
    }
    throw new ApiError(typeof body.error === 'string' ? body.error : '请求失败，请稍后重试', response.status,
      typeof body.code === 'string' ? body.code : undefined);
  }
  const count = response.headers.get('X-Total-Count');
  const total = count !== null && /^\d+$/.test(count) && Number.isSafeInteger(Number(count)) ? Number(count) : null;
  return { data, total };
}

export function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录已失效，请重新登录';
    if (error.status === 429) return '请求过于频繁，请稍后重试';
    return error.message;
  }
  return '无法连接图书服务器，请检查网络后重试';
}
