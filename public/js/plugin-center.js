/* ============================================================
 * Plugin Center 共享 UI 模块（原生 JS / IIFE）
 *
 * 只做：安全转义、格式化、状态映射、请求封装、确认弹窗。
 * 不包含任何写入逻辑：安装/更新/启停/回滚/卸载仍调用 /api/toolbox/*。
 * 浏览器挂 window.MyBooksPlugins；Node 下导出同名对象供单元测试。
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof window !== 'undefined') window.MyBooksPlugins = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TOOL_ID_RE = /^[A-Za-z0-9_]{1,64}$/;

  /* ---------------- 纯函数：安全与格式化 ---------------- */

  // 所有来自 API / Manifest 的文本都必须经过这里；不允许直接拼进 innerHTML。
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  // 只接受 http(s) 与站内绝对路径；javascript:/data:/协议相对地址一律丢弃。
  function safeUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
    } catch { return ''; }
  }

  function isToolId(value) {
    return TOOL_ID_RE.test(String(value || ''));
  }

  function pluginPath(id) {
    return '/plugins/' + encodeURIComponent(String(id || ''));
  }

  function pluginIconUrl(id) {
    return '/get/tool/' + encodeURIComponent(String(id || '')) + '/icon';
  }

  function fmtTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }

  function fmtBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function shortSha(value) {
    const text = String(value || '');
    return text ? text.slice(0, 12) : '—';
  }

  /* ---------------- 纯函数：状态映射 ---------------- */

  // 已安装列表（/api/plugins/installed）：status 完全由后端字段决定。
  function installedStatus(tool) {
    if (!tool) return { label: '未知', cls: 'is-muted' };
    if (tool.pending_restart) return { label: '待重启', cls: 'is-warn' };
    if (!tool.enabled) return { label: '已停用', cls: 'is-muted' };
    if (tool.runtime_status === 'runtime_offline') return { label: '运行时离线', cls: 'is-warn' };
    if (tool.runtime_status === 'not_loaded') return { label: '加载失败', cls: 'is-error' };
    if (tool.runtime_status === 'loaded') return { label: '已启用', cls: 'is-ok' };
    return { label: '已启用', cls: 'is-ok' };
  }

  // 详情页：只有 enabled/pending_restart/runtime.loaded 三个事实，不推测更多。
  function detailStatus(installed, runtime) {
    if (!installed) return { label: '未安装', cls: 'is-muted' };
    if (installed.pending_restart) return { label: '待重启', cls: 'is-warn' };
    if (!installed.enabled) return { label: '已停用', cls: 'is-muted' };
    if (!runtime || !runtime.online) return { label: '运行时离线', cls: 'is-warn' };
    if (!runtime.loaded) return { label: '未加载', cls: 'is-error' };
    return { label: '已启用', cls: 'is-ok' };
  }

  function taskStatusMeta(status) {
    const table = {
      running: ['运行中', 'is-running'],
      completed: ['已完成', 'is-ok'],
      failed: ['失败', 'is-error'],
      cancelled: ['已取消', 'is-muted'],
    };
    return table[status] || [String(status || '未知'), 'is-muted'];
  }

  function riskMeta(level) {
    if (level === 'high') return { label: '高风险', cls: 'is-error' };
    if (level === 'medium') return { label: '中风险', cls: 'is-warn' };
    return { label: '低风险', cls: 'is-ok' };
  }

  // 只描述当前部署实际启用的隔离方式，不把 isolated=true 说成“完全隔离”。
  function runtimeModeLabel(mode, uidEnabled) {
    if (mode === 'shared') return uidEnabled ? '共享 Worker（UID 隔离不可用）' : '共享 Worker';
    if (mode === 'process') return uidEnabled ? '独立进程 + 独立 UID' : '独立进程';
    if (mode === 'uid') return '独立进程 + 独立 UID';
    return '未知';
  }

  function trustMeta(trust) {
    if (trust === 'reviewed') return { label: '已审查', cls: 'is-ok' };
    if (trust === 'local') return { label: '本地开发', cls: 'is-warn' };
    return { label: '未审查', cls: 'is-warn' };
  }

  function policyMeta(state) {
    if (state === 'ok') {
      return { label: '已配置（严格）', cls: 'is-ok', note: '权限按 grants.json 裁剪。' };
    }
    if (state === 'last-good') {
      return {
        label: '最近有效快照',
        cls: 'is-warn',
        note: 'grants.json 当前不可读，宿主使用最近一次有效快照；不会自动扩权。',
      };
    }
    if (state === 'broken') {
      return {
        label: '策略损坏（全部拒绝）',
        cls: 'is-error',
        note: 'grants.json 损坏且没有可信快照，所有插件权限按拒绝处理。',
      };
    }
    return {
      label: '未配置（Legacy 兼容）',
      cls: 'is-warn',
      note: '该插件还没有 grants.json：Legacy 兼容模式下声明权限不会被裁剪。',
    };
  }

  function logTypeMeta(type) {
    if (type === 'tasks') return { label: '任务消息', empty: '该插件还没有任务消息。' };
    if (type === 'audit') return { label: '管理审计', empty: '还没有针对该插件的管理操作。' };
    return { label: '错误', empty: '没有记录到插件错误。' };
  }

  /* ---------------- 纯函数：动作门禁 ---------------- */

  function compatibilityReason(entry) {
    const reasons = (entry && entry.compatibility && entry.compatibility.reasons) || [];
    const parts = reasons.map((item) => (item && item.message) || '').filter(Boolean);
    return parts.length ? parts.join('；') : '当前环境不满足安装条件';
  }

  // 商店卡片/详情页的安装按钮状态。未审查时永远禁用，不提供绕过入口。
  function storeAction(entry) {
    const installed = entry && entry.installed;
    const supported = !!(entry && entry.compatibility && entry.compatibility.supported);
    const reviewed = !!(entry && entry.reviewed);
    const latest = entry && entry.latest_revision ? String(entry.latest_revision) : '';
    if (installed) {
      if (installed.update_available && supported) {
        return { action: 'update', label: `更新到 ${latest}`, disabled: false, primary: true, reason: '' };
      }
      return { action: 'installed', label: '已安装', disabled: true, primary: false, reason: '' };
    }
    if (!reviewed) {
      return {
        action: 'blocked',
        label: '待审查',
        disabled: true,
        primary: false,
        reason: '该版本尚未列入已审查 allowlist，管理中心不提供强制安装。',
      };
    }
    if (!supported) {
      return { action: 'blocked', label: '暂不支持', disabled: true, primary: false, reason: compatibilityReason(entry) };
    }
    return { action: 'install', label: '安装', disabled: false, primary: true, reason: '' };
  }

  /* ---------------- 纯函数：总览指标 ---------------- */

  // updates_available 为 null 表示商店状态未知，不能显示成 0。
  function overviewMetrics(data) {
    const counts = (data && data.counts) || {};
    const tasks = (data && data.tasks) || {};
    const updates = counts.updates_available;
    const unknown = updates === null || updates === undefined;
    return [
      {
        key: 'installed',
        label: '已安装插件',
        value: Number(counts.installed) || 0,
        hint: `启用 ${Number(counts.enabled) || 0} · 停用 ${Number(counts.disabled) || 0}`,
        tab: 'installed',
        filter: 'all',
      },
      {
        key: 'updates',
        label: '可更新插件',
        value: unknown ? '商店状态未知' : Number(updates) || 0,
        unknown,
        hint: unknown ? '商店索引尚未加载' : '来自商店缓存，不触发外网请求',
        tab: 'installed',
        filter: 'update',
      },
      {
        key: 'running',
        label: '运行中任务',
        value: Number(tasks.running) || 0,
        hint: `累计 ${Number(tasks.total) || 0} 条任务`,
        tab: 'tasks',
        filter: '',
      },
      {
        key: 'attention',
        label: '需要处理',
        value: (Number(counts.failed) || 0) + (Number(counts.pending_restart) || 0),
        hint: `失败 ${Number(counts.failed) || 0} · 待重启 ${Number(counts.pending_restart) || 0}`,
        tab: 'installed',
        filter: 'error',
      },
    ];
  }

  /* ---------------- 纯函数：查询串 ---------------- */

  function buildQuery(params) {
    const search = new URLSearchParams();
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value === undefined || value === null || value === '') return;
      search.set(key, String(value));
    });
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  /* ---------------- DOM：仅浏览器 ---------------- */

  function hasDom() {
    return typeof document !== 'undefined';
  }

  // 与管理端一致的鉴权：HttpOnly 设备会话 Cookie + 兼容旧本地管理员令牌。
  // 直接解析响应体，是为了保留新管理 API 的 { error: { code, message } } 结构。
  async function request(url, options) {
    const headers = { 'Content-Type': 'application/json' };
    if (typeof authHeaders === 'function') Object.assign(headers, authHeaders());
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options || {}),
      headers: { ...headers, ...((options && options.headers) || {}) },
    });
    if (res.status === 401) {
      if (typeof forgetToken === 'function') forgetToken();
      location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search));
      throw new Error('请先登录图书服务器');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data && data.error;
      const message = typeof detail === 'string'
        ? detail
        : (detail && detail.message) || (data && data.message) || '请求失败';
      const error = new Error(message);
      error.code = (detail && detail.code) || (data && data.code);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function toast(message, isError) {
    if (!hasDom()) return;
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.toggle('error', !!isError);
    el.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add('hidden'), isError ? 5200 : 2800);
  }

  function errorText(err) {
    if (!err) return '请求失败';
    const code = err.code ? `（${err.code}）` : '';
    return `${err.message || '请求失败'}${code}`;
  }

  function iconHtml(name, size) {
    return typeof icon === 'function' ? icon(name, size || 16, 1.8) : '';
  }

  function initialLetter(name, id) {
    return escapeHtml(String(name || id || '?').trim().slice(0, 1).toUpperCase() || '?');
  }

  // 图标失败时退回首字母；不使用插件自报的远程地址。
  function iconTile(id, name, extraClass) {
    const cls = 'tb-icon' + (extraClass ? ' ' + extraClass : '');
    const src = isToolId(id) ? pluginIconUrl(id) : '';
    return `<span class="tb-icon-wrap">`
      + (src ? `<img class="${cls}" src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-pc-icon>`
        + `<span class="${cls} tb-icon-letter" aria-hidden="true" hidden>${initialLetter(name, id)}</span>` : '')
      + (!src ? `<span class="${cls} tb-icon-letter" aria-hidden="true">${initialLetter(name, id)}</span>` : '')
      + '</span>';
  }

  // 图标 404 时切换成首字母，避免破图；事件委托只绑定一次。
  function bindIconFallback() {
    if (!hasDom() || bindIconFallback._done) return;
    bindIconFallback._done = true;
    document.addEventListener('error', (event) => {
      const img = event.target;
      if (!img || !img.matches || !img.matches('img[data-pc-icon]')) return;
      img.hidden = true;
      const letter = img.nextElementSibling;
      if (letter) letter.hidden = false;
    }, true);
  }

  /* 确认弹窗：复用 .modal 样式与 modal.js 的焦点陷阱 / Escape。
   * 返回 Promise<{ ok, checked }>；checkboxLabel 存在时渲染“同时删除数据”类选项。 */
  let confirmState = null;

  function ensureConfirmModal() {
    let modal = document.getElementById('pcConfirm');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'pcConfirm';
    modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal-box pc-modal-box">
        <div class="modal-head">
          <h2 data-pc-confirm-title>确认操作</h2>
          <button type="button" class="icon-btn" data-pc-confirm-cancel aria-label="关闭">${iconHtml('x', 16)}</button>
        </div>
        <div class="pc-confirm-body" data-pc-confirm-body></div>
        <div class="form-foot">
          <span class="form-error" data-pc-confirm-error></span>
          <div class="form-foot-btns">
            <button type="button" class="btn btn-ghost" data-pc-confirm-cancel>取消</button>
            <button type="button" class="btn btn-primary" data-pc-confirm-ok>确认</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    function settle(ok) {
      if (!confirmState) return;
      const { resolve, checkbox } = confirmState;
      confirmState = null;
      const checked = !!(checkbox && checkbox.checked);
      if (typeof closeModals === 'function') closeModals();
      else {
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
      }
      resolve({ ok, checked });
    }

    modal.addEventListener('click', (event) => {
      if (event.target === modal) { settle(false); return; }
      if (event.target.closest('[data-pc-confirm-cancel]')) { settle(false); return; }
      if (event.target.closest('[data-pc-confirm-ok]')) settle(true);
    });
    document.addEventListener('modals-closed', () => { settle(false); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && confirmState && !modal.classList.contains('hidden')) settle(false);
    });
    return modal;
  }

  function confirmAction(options) {
    const opts = options || {};
    if (!hasDom()) return Promise.resolve({ ok: false, checked: false });
    const modal = ensureConfirmModal();
    modal.querySelector('[data-pc-confirm-title]').textContent = opts.title || '确认操作';
    modal.querySelector('[data-pc-confirm-body]').innerHTML = `
      ${opts.message ? `<p class="pc-confirm-text">${escapeHtml(opts.message)}</p>` : ''}
      ${opts.detailsHtml ? `<div class="pc-confirm-details">${opts.detailsHtml}</div>` : ''}
      ${opts.checkboxLabel ? `<label class="check-row pc-confirm-check"><input type="checkbox" data-pc-confirm-check> ${escapeHtml(opts.checkboxLabel)}</label>` : ''}`;
    const okButton = modal.querySelector('[data-pc-confirm-ok]');
    okButton.textContent = opts.confirmLabel || '确认';
    okButton.className = 'btn ' + (opts.danger ? 'btn-danger-tint' : 'btn-primary');
    okButton.disabled = !!opts.confirmDisabled;
    modal.querySelector('[data-pc-confirm-error]').textContent = '';
    const checkbox = modal.querySelector('[data-pc-confirm-check]');
    if (checkbox && opts.onCheckboxChange) {
      checkbox.addEventListener('change', () => opts.onCheckboxChange(checkbox.checked));
    } else if (checkbox) {
      // 默认：勾选“删除数据”属于高风险动作，按钮改成危险样式。
      checkbox.addEventListener('change', () => {
        okButton.className = 'btn ' + (checkbox.checked ? 'btn-danger-tint' : 'btn-primary');
        if (opts.checkboxConfirmLabel) okButton.textContent = checkbox.checked ? opts.checkboxConfirmLabel : (opts.confirmLabel || '确认');
      });
    }
    if (typeof openModal === 'function') openModal('#pcConfirm');
    else {
      modal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }
    setTimeout(() => okButton.focus({ preventScroll: true }), 0);
    return new Promise((resolve) => { confirmState = { resolve, checkbox }; });
  }

  return {
    TOOL_ID_RE,
    escapeHtml,
    safeUrl,
    isToolId,
    pluginPath,
    pluginIconUrl,
    fmtTime,
    fmtBytes,
    shortSha,
    installedStatus,
    detailStatus,
    taskStatusMeta,
    riskMeta,
    runtimeModeLabel,
    trustMeta,
    policyMeta,
    logTypeMeta,
    storeAction,
    compatibilityReason,
    overviewMetrics,
    buildQuery,
    request,
    toast,
    errorText,
    iconHtml,
    iconTile,
    bindIconFallback,
    confirmAction,
  };
});
