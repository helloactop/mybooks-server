/**
 * MyBooks Toolbox Bridge（Mybooks 宿主实现）
 *
 * 与 PoxenStudio 的 toolbox-bridge.js 保持可观察行为一致：
 *   bridge.toolId / bridge.theme / bridge.locale
 *   bridge.fetch(path, options) -> Promise<解析后的 JSON 或文本>
 *   bridge.notify(message, level)
 *   bridge.onThemeChange(fn) / bridge.onLocaleChange(fn)
 *
 * 与上游“同源 iframe 直接 fetch”的实现不同：这里的 iframe 是
 * sandbox="allow-scripts"（不透明源），拿不到主站 Cookie。所有 API
 * 调用经 postMessage 交给父页面，由父页面按 manifest 路由白名单转发。
 * 信任判断不依赖 origin=null：父页面同时校验 event.source、nonce 和 toolId。
 */
(function (window) {
  'use strict';

  function query(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ''; } catch { return ''; }
  }

  function toolFromPath() {
    // 与上游一致：/get/tool/{tool_id}/index.html（也兼容 entry_frontend 不是 index.html 的情况）
    var match = window.location.pathname.match(/^\/get\/tool\/([a-z0-9_]+)\//);
    return match ? match[1] : '';
  }

  var toolId = query('tool') || toolFromPath();
  var nonce = query('nonce');
  var state = {
    theme: query('theme') || 'light',
    locale: query('locale') || 'zh',
  };
  var pending = new Map();
  var seq = 0;
  var themeListeners = [];
  var localeListeners = [];
  var lastHeight = 0;

  function post(message) {
    try {
      window.parent.postMessage(Object.assign({
        source: 'mybooks-toolbox-bridge',
        nonce: nonce,
        toolId: toolId,
      }, message), '*');
    } catch { /* 父页面已关闭 */ }
  }

  function requestId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch { /* fall through */ }
    seq += 1;
    return 'req-' + Date.now() + '-' + seq;
  }

  function sendRequest(payload) {
    var id = requestId();
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        pending.delete(id);
        reject(new Error('MyBooksToolBridge: 请求超时'));
      }, 120000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      post(Object.assign({ type: 'fetch', id: id, path: String(payload.path || ''), method: payload.method }, payload));
    });
  }

  // upstream 的 bridge.fetch 是 fetch 透传，md_to_epub 会直接传 FormData。
  // postMessage 不能可靠克隆 FormData，所以拆成字符串/文件片段，由父页面重建。
  function serializeFormData(formData) {
    var pairs = [];
    formData.forEach(function (value, name) { pairs.push([name, value]); });
    return Promise.all(pairs.map(function (pair) {
      var name = pair[0];
      var value = pair[1];
      if (typeof value === 'string') return { name: name, value: value };
      return value.arrayBuffer().then(function (buffer) {
        return { name: name, fileName: value.name || 'blob', type: value.type || '', buffer: buffer };
      });
    }));
  }

  function bridgeFetch(path, options) {
    if (!toolId) return Promise.reject(new Error('MyBooksToolBridge: 无法解析 tool_id'));
    if (!nonce) return Promise.reject(new Error('MyBooksToolBridge: 缺少宿主会话 nonce'));
    var opts = options || {};
    var method = String(opts.method || 'GET').toUpperCase();
    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].indexOf(method) === -1) {
      return Promise.reject(new Error('MyBooksToolBridge: 不支持的 HTTP 方法'));
    }
    var contentType = '';
    var headers = opts.headers || {};
    Object.keys(headers).forEach(function (key) {
      if (String(key).toLowerCase() === 'content-type') contentType = String(headers[key]);
    });
    if (typeof FormData !== 'undefined' && opts.body instanceof FormData) {
      return serializeFormData(opts.body).then(function (parts) {
        return sendRequest({ path: path, method: method, bodyType: 'formdata', parts: parts });
      });
    }
    var body = null;
    if (opts.body !== undefined && opts.body !== null) {
      if (typeof opts.body !== 'string') return Promise.reject(new Error('MyBooksToolBridge: body 必须是字符串或 FormData'));
      body = opts.body;
    }
    return sendRequest({ path: path, method: method, contentType: contentType, body: body });
  }

  function notify(message, level) {
    post({ type: 'notify', message: String(message == null ? '' : message), level: level || 'info' });
  }

  function onThemeChange(fn) {
    if (typeof fn === 'function') themeListeners.push(fn);
    return function () { themeListeners = themeListeners.filter(function (item) { return item !== fn; }); };
  }

  function onLocaleChange(fn) {
    if (typeof fn === 'function') localeListeners.push(fn);
    return function () { localeListeners = localeListeners.filter(function (item) { return item !== fn; }); };
  }

  function onHostMessage(event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== 'mybooks-toolbox-host') return;
    if (nonce && data.nonce !== nonce) return;
    if (toolId && data.toolId && data.toolId !== toolId) return;

    if (data.type === 'fetch-result') {
      var item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      window.clearTimeout(item.timer);
      if (data.error) item.reject(new Error(data.error));
      else if (data.json !== undefined) item.resolve(data.json);
      else item.resolve(data.text === undefined ? null : data.text);
      return;
    }
    if (data.type === 'theme-change' && data.theme && data.theme !== state.theme) {
      var oldTheme = state.theme;
      state.theme = data.theme;
      themeListeners.forEach(function (fn) { try { fn(state.theme, oldTheme); } catch { /* 插件监听器 */ } });
    } else if (data.type === 'locale-change' && data.locale && data.locale !== state.locale) {
      var oldLocale = state.locale;
      state.locale = data.locale;
      localeListeners.forEach(function (fn) { try { fn(state.locale, oldLocale); } catch { /* 插件监听器 */ } });
    }
  }
  window.addEventListener('message', onHostMessage);

  function reportHeight() {
    var height = document.documentElement.scrollHeight;
    if (!height || height === lastHeight) return;
    lastHeight = height;
    post({ type: 'resize', height: height });
  }
  if (typeof window.ResizeObserver !== 'undefined') {
    new window.ResizeObserver(reportHeight).observe(document.documentElement);
  }
  window.addEventListener('load', reportHeight);
  window.addEventListener('resize', reportHeight);

  function sameOriginUrl(href) {
    try {
      var url = new URL(href, window.location.href);
      return url.origin === window.location.origin ? url : null;
    } catch { return null; }
  }

  function pluginApiUrl(href) {
    var url = sameOriginUrl(href);
    if (!url || !toolId) return null;
    var prefix = '/api/toolbox/tool/' + toolId + '/';
    return url.pathname.indexOf(prefix) === 0 ? url : null;
  }

  function requestDownload(url, filename) {
    post({
      type: 'download',
      url: url.pathname + url.search,
      filename: filename || '',
    });
  }

  // 插件页面在 sandbox 里不能导航到主站 API，也不能自己打开窗口。
  // 把“打开书籍”和“下载产物”转交给父页面，用父页面的会话完成。
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    var match = href.match(/^\/book\/(\d+)/) || href.match(/^\/shelf\?book=(\d+)/);
    if (match) {
      event.preventDefault();
      post({ type: 'open-book', bookId: Number(match[1]) });
      return;
    }
    var api = pluginApiUrl(href);
    if (api && (anchor.hasAttribute('download') || /\/(download|result)(\/|$)/.test(api.pathname) || api.search)) {
      event.preventDefault();
      requestDownload(api, anchor.getAttribute('download') || '');
    }
  }, true);

  // book_dedup 等工具用 window.open('/book/<id>', '_blank')；sandbox 不允许弹窗，
  // 在桥里改为让父页面导航，保持和 anchor 一致。
  var nativeOpen = window.open;
  window.open = function (url) {
    var value = String(url || '');
    var match = value.match(/^\/book\/(\d+)/) || value.match(/^\/shelf\?book=(\d+)/);
    if (match) {
      post({ type: 'open-book', bookId: Number(match[1]) });
      return null;
    }
    var api = pluginApiUrl(value);
    if (api && /\/(download|result)(\/|$)/.test(api.pathname)) {
      requestDownload(api, '');
      return null;
    }
    return nativeOpen.apply(window, arguments);
  };

  var bridge = {
    toolId: toolId,
    fetch: bridgeFetch,
    notify: notify,
    onThemeChange: onThemeChange,
    onLocaleChange: onLocaleChange,
  };
  Object.defineProperty(bridge, 'theme', { get: function () { return state.theme; }, enumerable: true });
  Object.defineProperty(bridge, 'locale', { get: function () { return state.locale; }, enumerable: true });
  window.MyBooksToolBridge = bridge;
  post({ type: 'ready' });
})(window);
