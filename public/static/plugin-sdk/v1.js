/**
 * MyBooks Plugin SDK（前端 v1）
 *
 * 薄封装 window.MyBooksToolBridge，不替换 Bridge v1：
 *   · 不读取主站 Cookie，不访问宿主 DOM；
 *   · 所有请求仍走父页面 manifest 路由白名单；
 *   · 任务监听使用可停止的串行 setTimeout，不产生并发轮询。
 *
 * 用法：
 *   await MyBooksUI.ready();
 *   const data = await MyBooksUI.call('search', { query: { q: '三体' } });
 *   const watcher = MyBooksUI.jobs.watch(jobId, { route: 'job' });
 *   watcher.stop();
 */
(function (window) {
  'use strict';

  var VERSION = '1.0.0';
  var ROUTE_RE = /^[A-Za-z0-9_.\-]+$/;
  var TERMINAL = { completed: true, failed: true, cancelled: true };
  var watchers = [];

  function makeError(code, message, status) {
    var err = new Error(message || code);
    err.code = code || 'HOST_ERROR';
    err.status = status || 0;
    return err;
  }

  function bridge() {
    return window.MyBooksToolBridge || null;
  }

  function waitForBridge(timeoutMs) {
    return new Promise(function (resolve) {
      var found = bridge();
      if (found) return resolve(found);
      var deadline = Date.now() + Math.max(200, Number(timeoutMs) || 5000);
      var timer = window.setInterval(function () {
        var item = bridge();
        if (item) {
          window.clearInterval(timer);
          resolve(item);
        } else if (Date.now() >= deadline) {
          window.clearInterval(timer);
          resolve(null);
        }
      }, 50);
    });
  }

  function buildPath(route, query) {
    var name = String(route || '');
    if (!name || name.length > 200 || name.indexOf('://') !== -1 || name.charAt(0) === '/' || name.indexOf('..') !== -1) {
      throw makeError('ROUTE_INVALID', '插件路由不合法');
    }
    if (!ROUTE_RE.test(name)) throw makeError('ROUTE_INVALID', '插件路由包含非法字符');
    var parts = [];
    var source = query && typeof query === 'object' ? query : {};
    Object.keys(source).forEach(function (key) {
      var value = source[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return parts.length ? name + '?' + parts.join('&') : name;
  }

  function normalizeError(err) {
    if (err && err.code) return err;
    return makeError('HOST_ERROR', (err && err.message) || '宿主调用失败');
  }

  function call(route, options) {
    var opts = options || {};
    var host = bridge();
    if (!host) return Promise.reject(makeError('BRIDGE_MISSING', 'MyBooksToolBridge 未加载'));
    var path;
    try {
      path = buildPath(route, opts.query);
    } catch (err) {
      return Promise.reject(normalizeError(err));
    }
    var body = opts.body;
    if (body !== undefined && body !== null && typeof body !== 'string'
      && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
      try {
        body = JSON.stringify(body);
      } catch (err) {
        return Promise.reject(makeError('BODY_INVALID', '请求体无法序列化'));
      }
    }
    return host.fetch(path, { method: opts.method || (body ? 'POST' : 'GET'), body: body })
      .catch(function (err) { throw normalizeError(err); });
  }

  function watch(jobId, options) {
    var opts = options || {};
    var route = opts.route || 'job';
    var interval = Math.max(500, Number(opts.intervalMs) || 1500);
    var timeout = Math.max(1000, Number(opts.timeoutMs) || 300000);
    var onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : function () {};
    var onDone = typeof opts.onDone === 'function' ? opts.onDone : function () {};
    var onError = typeof opts.onError === 'function' ? opts.onError : function () {};
    var start = Date.now();
    var timer = null;
    var stopped = false;

    var watcher = {
      stop: function () {
        if (stopped) return;
        stopped = true;
        if (timer) window.clearTimeout(timer);
        timer = null;
        watchers = watchers.filter(function (item) { return item !== watcher; });
      },
    };
    watchers.push(watcher);

    function tick() {
      if (stopped) return;
      if (Date.now() - start > timeout) {
        watcher.stop();
        onError(makeError('WATCH_TIMEOUT', '任务进度监听超时'));
        return;
      }
      call(route, { query: { job_id: jobId } }).then(function (data) {
        if (stopped) return;
        var status = data && data.status ? String(data.status) : '';
        try { onUpdate(data); } catch (err) { /* 插件回调异常不终止监听 */ }
        if (TERMINAL[status]) {
          watcher.stop();
          try { onDone(data); } catch (err) { /* 同上 */ }
          return;
        }
        timer = window.setTimeout(tick, interval);
      }).catch(function (err) {
        if (stopped) return;
        watcher.stop();
        onError(normalizeError(err));
      });
    }

    timer = window.setTimeout(tick, 0);
    return watcher;
  }

  function configGet(options) {
    return call((options && options.route) || 'config', { method: 'GET' });
  }

  function configSave(values, options) {
    return call((options && options.route) || 'config', {
      method: 'POST',
      body: values || {},
    });
  }

  window.addEventListener('pagehide', function () {
    watchers.slice().forEach(function (item) { item.stop(); });
  });

  var MyBooksUI = {
    version: VERSION,
    ready: function (timeoutMs) {
      return waitForBridge(timeoutMs).then(function (host) {
        if (!host) throw makeError('BRIDGE_MISSING', 'MyBooksToolBridge 未加载');
        return { protocol: 1, sdk: VERSION, bridge: 'v1', toolId: host.toolId || '' };
      });
    },
    call: call,
    notify: function (message, level) {
      var host = bridge();
      if (host && typeof host.notify === 'function') host.notify(message, level);
    },
    onThemeChange: function (fn) {
      var host = bridge();
      return host && typeof host.onThemeChange === 'function' ? host.onThemeChange(fn) : function () {};
    },
    onLocaleChange: function (fn) {
      var host = bridge();
      return host && typeof host.onLocaleChange === 'function' ? host.onLocaleChange(fn) : function () {};
    },
    jobs: {
      get: function (jobId, options) {
        return call((options && options.route) || 'job', { query: { job_id: jobId } });
      },
      watch: watch,
    },
    config: {
      get: configGet,
      save: configSave,
    },
  };

  window.MyBooksUI = MyBooksUI;
})(window);
