/* ============================================================
 * API 与鉴权原语(全站公共)
 *
 * 只负责:管理员令牌读取、请求头、fetch 统一错误处理、分页总数头。
 * 页面专属逻辑留在 page-*.js;UI 组件留在 common.js。
 * 加载顺序:icon.js → chrome.js → api.js → common.js → page-*.js
 * ============================================================ */

/* 网页使用 HttpOnly 设备会话;只兼容读取已有的本地管理员令牌。
 * 凭据失效时进入账号页,不再通过弹窗保存新的管理员令牌。 */
const TOKEN_KEY = 'mybooks.adminToken';

function adminToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

function authHeaders() {
  const t = adminToken();
  return t ? { Authorization: 'Bearer ' + t } : {};
}

function forgetToken() { localStorage.removeItem(TOKEN_KEY); }

async function apiFetch(url, options = {}) {
  const { publicAccess = false, headers: extraHeaders, ...fetchOptions } = options;
  const res = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(publicAccess ? {} : authHeaders()),
      ...(extraHeaders || {}),
    },
  });

  // 管理 API 401:清理旧令牌并进入登录页。公开 API 不触发跳转，
  // 否则匿名首页只因一次公开请求失败就会被带离页面。
  if (res.status === 401) {
    const data401 = await res.json().catch(() => ({}));
    if (!publicAccess) {
      forgetToken();
      location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search));
      throw new Error('请先登录图书服务器');
    }
    const error = new Error(data401.error || '公开内容暂不可用');
    error.code = data401.code;
    error.status = 401;
    throw error;
  }

  // 429:触发限速(双层模式连续输错令牌),提示等待而非笼统"请求失败"
  if (res.status === 429) {
    const data429 = await res.json().catch(() => ({}));
    const error = new Error(data429.error || '尝试次数过多,请稍后再试');
    error.code = data429.code;
    error.status = 429;
    throw error;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 保留服务端 code/status:Inspector 的 CONFLICT 自动重载、上传/导入的
    // 分支都依赖它,只留 message 会让这些恢复路径永远走不到。
    const error = new Error(data.error || '请求失败');
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  return { data, res };
}

async function api(url, options = {}) {
  return (await apiFetch(url, options)).data;
}

// 公开页面专用：不加 Bearer、不因 401 自动跳登录。
async function apiPublic(url, options = {}) {
  return (await apiFetch(url, { ...options, publicAccess: true })).data;
}

// 需要响应头的调用(列表分页的总数 X-Total-Count)。
// total 为 null 表示服务端没给这个头,调用方据此回退到"本页是否满页"判断。
async function apiPage(url, options = {}) {
  const { data, res } = await apiFetch(url, options);
  const raw = res.headers.get('X-Total-Count');
  return { data, total: raw === null ? null : Number(raw) };
}
