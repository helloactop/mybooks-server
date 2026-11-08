/* ============================================================
 * 插件宿主页：受控 iframe + postMessage RPC
 *
 * 安全边界：
 *   · iframe sandbox 不含 allow-same-origin，插件拿不到主站 Cookie/DOM；
 *   · 父页面只接受来自当前 iframe、带本次 nonce、工具 ID 匹配的消息；
 *   · fetch 只转发 manifest.api_routes 声明的路径，方法限 GET/POST；
 *   · 响应通过 '*' 回发（不透明源无法指定 origin），但 nonce + source
 *     双重校验，且内容只包含插件自己请求的数据。
 * ============================================================ */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const toolId = (location.pathname.match(/^\/toolbox\/tool\/([a-z0-9_]+)\/?$/) || [])[1] || '';
  let nonce = randomId();
  let tool = null;
  let routes = new Set();
  let loadTimer = 0;

  function randomId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch { /* fall through */ }
    return 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function toast(message, isError = false) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function state(text, isError = false) {
    const el = $('#tbToolState');
    el.textContent = text;
    el.classList.toggle('is-error', isError);
    el.hidden = false;
  }

  function clearState() {
    $('#tbToolState').hidden = true;
  }

  function savedTheme() {
    try { return localStorage.getItem('toolbox.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  }

  function defaultLocale() {
    try {
      const saved = localStorage.getItem('toolbox.locale');
      if (['zh', 'zh-TW', 'en'].includes(saved)) return saved;
    } catch { /* ignore */ }
    const lang = String(navigator.language || 'zh');
    if (/^en/i.test(lang)) return 'en';
    if (/^zh-(tw|hk|mo)/i.test(lang)) return 'zh-TW';
    return 'zh';
  }

  function iframeSrc() {
    const params = new URLSearchParams({
      tool: toolId,
      nonce,
      theme: $('#tbTheme').value,
      locale: $('#tbLocale').value,
    });
    return `/get/tool/${encodeURIComponent(toolId)}/index.html?${params.toString()}`;
  }

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      location.assign('/login?next=' + encodeURIComponent(location.pathname));
      throw new Error('请先登录');
    }
    if (!res.ok) {
      const error = new Error(data.error || '请求失败');
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function setChrome() {
    const name = tool.name || tool.tool_id;
    document.title = `${name} · 工具箱 · My books`;
    $('#tbToolName').textContent = name;
    $('#tbToolMeta').textContent = `v${tool.revision} · ${tool.enabled ? '已启用' : '已停用'}`;
    const icon = $('#tbToolIcon');
    icon.src = `/api/toolbox/tools/${encodeURIComponent(tool.tool_id)}/icon`;
    icon.addEventListener('load', () => { icon.hidden = false; });
    icon.addEventListener('error', () => { icon.hidden = true; });
  }

  function loadIframe() {
    const frame = $('#tbFrame');
    frame.hidden = true;
    state('正在加载插件…');
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (frame.hidden) state('插件页面加载超时。请检查插件是否启用，或查看 toolbox-runtime 日志。', true);
    }, 10_000);
    frame.src = iframeSrc();
  }

  function onFrameLoad() {
    clearTimeout(loadTimer);
    $('#tbFrame').hidden = false;
    clearState();
  }

  function handleFetch(data) {
    const frame = $('#tbFrame');
    const reply = (payload) => {
      try {
        frame.contentWindow.postMessage(Object.assign({
          source: 'mybooks-toolbox-host',
          nonce,
          toolId,
          type: 'fetch-result',
          id: data.id,
        }, payload), '*');
      } catch { /* iframe 已卸载 */ }
    };

    const rawPath = String(data.path || '');
    if (!rawPath || rawPath.length > 500 || rawPath.includes('\0') || rawPath.includes('\\')) {
      return reply({ error: '插件请求路径不合法' });
    }
    const [routePart, ...queryParts] = rawPath.replace(/^\/+/, '').split('?');
    const route = routePart.replace(/\/+$/, '');
    if (!route || route.includes('..') || route.includes('://') || !routes.has(route)) {
      return reply({ error: '插件没有声明这个接口' });
    }
    const query = queryParts.join('?');
    if (query.length > 2000) return reply({ error: '插件请求参数过长' });
    const method = String(data.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return reply({ error: '不支持的 HTTP 方法' });
    }

    let body;
    const headers = {};
    if (data.bodyType === 'formdata') {
      if (method === 'GET' || !Array.isArray(data.parts) || data.parts.length > 400) {
        return reply({ error: '插件上传参数不合法' });
      }
      const formData = new FormData();
      for (const part of data.parts) {
        if (!part || typeof part.name !== 'string') return reply({ error: '插件上传参数不合法' });
        if (part.buffer) {
          const file = new File([part.buffer], String(part.fileName || 'file'), { type: String(part.type || '') });
          formData.append(part.name, file, String(part.fileName || 'file'));
        } else {
          formData.append(part.name, String(part.value == null ? '' : part.value));
        }
      }
      body = formData;
      // 不设 Content-Type，让浏览器生成 multipart boundary
    } else if (data.body != null) {
      if (typeof data.body !== 'string' || data.body.length > 8 * 1024 * 1024) {
        return reply({ error: '插件请求体不合法' });
      }
      body = data.body;
      if (data.contentType) {
        if (!/^application\/(json|octet-stream)\b/i.test(String(data.contentType))) {
          return reply({ error: '插件请求只支持 JSON/二进制字符串' });
        }
        headers['Content-Type'] = data.contentType;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const url = `/api/toolbox/tool/${encodeURIComponent(toolId)}/${route}${query ? '?' + query : ''}`;
    fetch(url, { method, headers, body, credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const text = await response.text();
        let json;
        try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
        if (response.status === 401) toast('登录已过期，请刷新页面重新登录', true);
        reply({ status: response.status, ok: response.ok, ...(json !== undefined ? { json } : { text }) });
      })
      .catch((err) => {
        reply({ error: err && err.name === 'AbortError' ? '插件接口超时' : '插件接口不可用' });
      })
      .finally(() => clearTimeout(timer));
  }

  function safeDownloadName(value) {
    return String(value || 'download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 160) || 'download';
  }

  function filenameFromDisposition(header) {
    const value = String(header || '');
    const star = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1]); } catch { return star[1]; } }
    const plain = value.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1] : '';
  }

  async function downloadFromPlugin(data) {
    let url;
    try { url = new URL(String(data.url || ''), location.origin); } catch { return; }
    const prefix = `/api/toolbox/tool/${toolId}/`;
    if (url.origin !== location.origin || !url.pathname.startsWith(prefix)) {
      toast('下载地址不在当前工具白名单内', true);
      return;
    }
    const route = url.pathname.slice(prefix.length).split('/')[0];
    if (!routes.has(route)) { toast('插件没有声明这个下载接口', true); return; }
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) { toast('下载失败，请重试', true); return; }
    const blob = await response.blob();
    let filename = data.filename || filenameFromDisposition(response.headers.get('content-disposition'));
    if (!filename && url.searchParams.get('name')) filename = url.searchParams.get('name');
    filename = safeDownloadName(filename || 'download');
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
  }

  function onMessage(event) {
    const frame = $('#tbFrame');
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== 'mybooks-toolbox-bridge') return;
    if (data.nonce !== nonce) return;
    if (data.toolId && data.toolId !== toolId) return;
    if (data.type === 'fetch') handleFetch(data);
    else if (data.type === 'notify') toast(String(data.message || ''), data.level === 'error' || data.level === 'danger');
    else if (data.type === 'download') downloadFromPlugin(data).catch(() => toast('下载失败，请重试', true));
    else if (data.type === 'open-book') {
      const id = Number(data.bookId);
      if (Number.isSafeInteger(id) && id > 0) location.assign(`/shelf?book=${id}`);
    } else if (data.type === 'ready') {
      clearTimeout(loadTimer);
      $('#tbFrame').hidden = false;
      clearState();
    }
  }

  async function boot() {
    if (!toolId) {
      state('工具 ID 不合法', true);
      return;
    }
    $('#tbTheme').value = savedTheme();
    $('#tbLocale').value = defaultLocale();
    try {
      const data = await api('/api/toolbox/installed');
      tool = (data.tools || []).find((item) => item.tool_id === toolId);
    } catch (err) {
      state(err.message, true);
      return;
    }
    if (!tool) { state('这个工具还没有安装。', true); return; }
    routes = new Set(((tool.manifest && tool.manifest.api_routes) || []).map((route) => route.path));
    setChrome();
    if (!tool.enabled) {
      state('该工具已停用。请回到工具箱启用后再打开。', true);
      return;
    }
    window.addEventListener('message', onMessage);
    $('#tbFrame').addEventListener('load', onFrameLoad);
    $('#tbMore').addEventListener('click', (event) => {
      event.stopPropagation();
      setMore($('#tbMoreMenu').hidden);
    });
    document.addEventListener('click', (event) => {
      if (!$('#tbMoreMenu').hidden && !event.target.closest('.tb-more-wrap')) setMore(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMore(false);
    });
    $('#tbReload').addEventListener('click', () => {
      setMore(false);
      nonce = randomId();
      loadIframe();
    });
    $('#tbTheme').addEventListener('change', () => {
      try { localStorage.setItem('toolbox.theme', $('#tbTheme').value); } catch { /* ignore */ }
      postToFrame({ type: 'theme-change', theme: $('#tbTheme').value });
    });
    $('#tbLocale').addEventListener('change', () => {
      try { localStorage.setItem('toolbox.locale', $('#tbLocale').value); } catch { /* ignore */ }
      postToFrame({ type: 'locale-change', locale: $('#tbLocale').value });
    });
    loadIframe();
  }

  function setMore(open) {
    const menu = $('#tbMoreMenu');
    const button = $('#tbMore');
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  function postToFrame(payload) {
    const frame = $('#tbFrame');
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(Object.assign({
        source: 'mybooks-toolbox-host', nonce, toolId,
      }, payload), '*');
    } catch { /* ignore */ }
  }

  boot();
})();
