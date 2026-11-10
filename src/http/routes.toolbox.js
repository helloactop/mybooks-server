/* ============================================================
 * 工具箱 API：商店、安装管理、任务、插件接口代理
 *
 * 所有 /api/toolbox 路由都挂在 server.js 的 requireSession 之后；
 * 插件接口只允许 manifest.api_routes 声明的精确路径，方法限 GET/POST。
 * ============================================================ */

const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const path = require('node:path');

const { db } = require('../db/index');
const toolboxRepo = require('../db/toolbox');
const { TOOLBOX_DIR } = require('../core/paths');
const { TOOL_ID_RE, findRoute } = require('../core/toolbox/manifest');
const { ToolboxError, assertInside } = require('../core/toolbox/security');
const store = require('../core/toolbox/store');
const installer = require('../core/toolbox/installer');
const { runtimeHealth, runtimePathStatus, proxyTool } = require('../core/toolbox/runtime');
const { cancelTask } = require('../core/toolbox/tasks');
const audit = require('../core/toolbox/audit');

const router = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(TOOLBOX_DIR, 'tmp');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function fail(res, err) {
  const status = err instanceof ToolboxError ? err.status : 500;
  if (!(err instanceof ToolboxError)) console.error('[toolbox]', err && (err.stack || err));
  const code = (err && err.code) || 'TOOLBOX_ERROR';
  const message = (err && err.message) || '工具箱操作失败';
  const pluginErr = code === 'TOOL_DISABLED' ? 'tool.disabled'
    : code === 'ROUTE_NOT_FOUND' ? 'route.not_found'
      : code === 'METHOD_NOT_ALLOWED' ? 'method.not_allowed'
        : code === 'RUNTIME_UNAVAILABLE' || code === 'RUNTIME_TIMEOUT' ? 'host.unavailable'
          : 'host.error';
  res.status(status).json({
    error: message,
    code,
    // 插件前端原生检查 rsp.err/rsp.msg；宿主管理端检查 error/code，两者同时保留。
    err: pluginErr,
    msg: message,
  });
}

function toolId(raw) {
  const value = String(raw || '').trim();
  if (!TOOL_ID_RE.test(value)) throw new ToolboxError('TOOL_ID_INVALID', '工具 ID 不合法');
  return value;
}

function installedOrThrow(id) {
  const tool = toolboxRepo.getTool(db, id);
  if (!tool) throw new ToolboxError('NOT_INSTALLED', '工具尚未安装', 404);
  return tool;
}

// 管理操作审计：成功/失败都记录，但审计写入失败不影响原操作。
async function audited(action, toolIdValue, run) {
  try {
    const result = await run();
    await audit.record({ action, tool_id: toolIdValue || '', result: 'success' });
    return result;
  } catch (err) {
    await audit.record({
      action,
      tool_id: toolIdValue || '',
      result: 'error',
      error_code: (err && err.code) || 'INTERNAL_ERROR',
    });
    throw err;
  }
}

router.get('/api/toolbox/store/index', async (req, res) => {
  try {
    const index = await store.getIndex({ force: req.query.refresh === '1' });
    const tools = store.annotate(index.tools, toolboxRepo.listTools(db));
    res.set('Cache-Control', 'no-store');
    res.json({
      store_url: store.STORE_URL,
      fetched_at: index.fetchedAt ? new Date(index.fetchedAt).toISOString() : null,
      cached: !!index.cached,
      error: index.error || '',
      tools,
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/api/toolbox/store/refresh', async (req, res) => {
  try {
    store.clearCache();
    const index = await store.getIndex({ force: true });
    const tools = store.annotate(index.tools, toolboxRepo.listTools(db));
    res.set('Cache-Control', 'no-store');
    res.json({
      store_url: store.STORE_URL,
      fetched_at: index.fetchedAt ? new Date(index.fetchedAt).toISOString() : null,
      cached: false,
      error: index.error || '',
      tools,
    });
  } catch (err) {
    fail(res, err);
  }
});

function toolDto(tool) {
  return {
    tool_id: tool.tool_id,
    id: tool.tool_id,
    name: tool.name,
    description: tool.manifest && tool.manifest.description,
    author: tool.manifest && tool.manifest.author,
    revision: tool.revision,
    installed_revision: tool.revision,
    runtime: tool.runtime,
    type: tool.tool_type || 'tool',
    tool_type: tool.tool_type || 'tool',
    enabled: tool.enabled,
    status: tool.enabled ? 'enabled' : 'disabled',
    install_path: tool.install_path,
    sha256: tool.sha256,
    source: tool.source,
    compatibility: tool.compatibility,
    manifest: tool.manifest,
    installed_at: tool.installed_at,
    install_time: tool.installed_at,
    updated_at: tool.updated_at,
    update_time: tool.updated_at,
    pending_restart: !!tool.pending_restart,
    last_error: tool.last_error || '',
    rollback_available: !!tool.previous_path && fs.existsSync(path.join(TOOLBOX_DIR, tool.previous_path)),
  };
}

router.get('/api/toolbox/installed', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ tools: toolboxRepo.listTools(db).map(toolDto) });
});

// 上游管理端路径：/api/toolbox/list
router.get('/api/toolbox/list', (req, res) => {
  const includeDisabled = req.query.include_disabled === '1';
  const tools = toolboxRepo.listTools(db)
    .filter((tool) => includeDisabled || tool.enabled)
    .map(toolDto);
  res.set('Cache-Control', 'no-store');
  res.json({ tools, store_enabled: true });
});

router.post('/api/toolbox/install', async (req, res) => {
  try {
    const id = toolId(req.body && req.body.tool_id);
    const result = await audited('plugin.install', id, () => installer.installFromStore(id, db));
    res.status(201).json(result);
  } catch (err) {
    fail(res, err);
  }
});

// 上游管理端路径：POST /api/toolbox/{tool_id}/install（商店安装/更新）
router.post('/api/toolbox/:id/install', async (req, res) => {
  try {
    const id = toolId(req.params.id);
    const existing = toolboxRepo.getTool(db, id);
    const action = existing ? 'plugin.update' : 'plugin.install';
    const result = await audited(action, id, () => (existing
      ? installer.updateFromStore(id, db)
      : installer.installFromStore(id, db)));
    res.status(existing ? 200 : 201).json(result);
  } catch (err) {
    fail(res, err);
  }
});

function devUpload(req, res) {
  try {
    if (!req.file) throw new ToolboxError('UPLOAD_MISSING', '没有收到安装包', 400);
    const archive = req.file.path;
    const expected = req.params.id ? toolId(req.params.id) : '';
    audited('plugin.install', expected, () => installer.installFromLocalArchive(archive, {
      expectedToolId: expected, source: 'dev', handleDb: db,
    })).then((result) => {
      try { fs.unlinkSync(archive); } catch { /* ignore */ }
      res.status(201).json(result);
    }).catch((err) => {
      try { fs.unlinkSync(archive); } catch { /* ignore */ }
      fail(res, err);
    });
  } catch (err) {
    fail(res, err);
  }
}

router.post('/api/toolbox/install/upload', upload.single('file'), devUpload);
router.post('/api/toolbox/:id/update/upload', upload.single('file'), devUpload);

router.post('/api/toolbox/:id/enable', async (req, res) => {
  try {
    const id = toolId(req.params.id);
    res.json(await audited('plugin.enable', id, () => installer.setEnabled(id, true, db)));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/api/toolbox/:id/disable', async (req, res) => {
  try {
    const id = toolId(req.params.id);
    res.json(await audited('plugin.disable', id, () => installer.setEnabled(id, false, db)));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/api/toolbox/:id/update', async (req, res) => {
  try {
    const id = toolId(req.params.id);
    res.json(await audited('plugin.update', id, () => installer.updateFromStore(id, db)));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/api/toolbox/:id/rollback', async (req, res) => {
  try {
    const id = toolId(req.params.id);
    res.json(await audited('plugin.rollback', id, () => installer.rollback(id, db)));
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/api/toolbox/:id', async (req, res) => {
  try {
    const id = toolId(req.params.id);
    res.json(await audited('plugin.uninstall', id, () => installer.uninstall(id, {
      purgeData: req.query.purge_data === '1',
      handleDb: db,
    })));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/toolbox/runtime', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const health = await runtimeHealth();
  if (health.online) {
    // 部署自检：Node 与 Runtime 的 toolbox 路径必须一致，否则入库会“文件不存在”。
    health.toolbox_path = runtimePathStatus(health.info);
    const installed = toolboxRepo.listTools(db);
    const unreviewed = installed.filter((tool) => !(tool.compatibility && tool.compatibility.reviewed));
    const sharedWorker = !(health.info && health.info.isolated);
    // 共享 Worker 不是安全边界：未审查插件与其它插件同进程，可读同卷文件。
    health.isolation = {
      shared_worker: sharedWorker,
      unreviewed_plugins: unreviewed.map((tool) => tool.tool_id),
      risk: sharedWorker && unreviewed.length ? 'high' : 'normal',
      note: sharedWorker && unreviewed.length
        ? '共享 Worker 内未审查插件与其它插件同进程；只应安装已审查插件，或启用 TOOLBOX_ISOLATE_PLUGINS'
        : '',
    };
  }
  res.json(health);
});

// 独立 Worker 重启：不重启 Node 主服务，重新执行 importlib load_all 并清 pending_restart。
router.post('/api/toolbox/runtime/restart', async (req, res) => {
  try {
    const result = await installer.reloadAndSync(db);
    await audit.record({
      action: 'runtime.restart',
      result: result.ok ? 'success' : 'error',
      error_code: result.ok ? '' : 'RUNTIME_UNAVAILABLE',
    });
    res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/toolbox/tasks', (req, res) => {
  const tasks = toolboxRepo.listTasks(db, { status: req.query.status, limit: req.query.limit });
  res.set('Cache-Control', 'no-store');
  res.json({ tasks });
});

router.get('/api/toolbox/tasks/:id', (req, res) => {
  const task = toolboxRepo.getTask(db, Number(req.params.id));
  if (!task) return res.status(404).json({ error: '任务不存在', code: 'NOT_FOUND' });
  res.set('Cache-Control', 'no-store');
  res.json({ task });
});

router.post('/api/toolbox/tasks/:id/cancel', async (req, res) => {
  try {
    const result = await cancelTask(req.params.id, {
      userId: req.authSession && req.authSession.id,
    });
    res.json({ ok: true, plugin: result.plugin });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/toolbox/tools/:id/icon', (req, res) => {
  try {
    const id = toolId(req.params.id);
    const tool = installedOrThrow(id);
    const base = assertInside(path.join(TOOLBOX_DIR, 'plugins'), path.join(TOOLBOX_DIR, tool.install_path), 'INSTALL_PATH_INVALID');
    const candidates = [
      ['icon.png', 'image/png'], ['icon.jpg', 'image/jpeg'], ['icon.jpeg', 'image/jpeg'], ['icon.webp', 'image/webp'],
    ];
    for (const [name, type] of candidates) {
      const file = path.join(base, name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        return res.sendFile(file);
      }
    }
    res.status(404).json({ error: '工具没有图标', code: 'NOT_FOUND' });
  } catch (err) {
    fail(res, err);
  }
});

function timeoutForRoute(route) {
  if (route === 'health' || route === 'search') return 120_000;
  if (route === 'convert' || route === 'translate') return 120_000;
  if (route === 'download' || route === 'result') return 60_000;
  return 45_000;
}

function readRawBody(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ToolboxError('UPLOAD_TOO_LARGE', '插件上传内容超过大小上限', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(new ToolboxError('UPLOAD_FAILED', `读取上传内容失败：${err.message}`, 400)));
  });
}

router.all('/api/toolbox/tool/:toolId/*', async (req, res) => {
  try {
    const id = toolId(req.params.toolId);
    const tool = installedOrThrow(id);
    if (!tool.enabled) throw new ToolboxError('TOOL_DISABLED', '工具未启用', 404);
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      throw new ToolboxError('METHOD_NOT_ALLOWED', '插件接口不支持该 HTTP 方法', 405);
    }
    const route = String(req.params[0] || '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!findRoute(tool.manifest, route)) {
      throw new ToolboxError('ROUTE_NOT_FOUND', '插件没有声明这个接口', 404);
    }
    const query = req.originalUrl.includes('?') ? req.originalUrl.split('?').slice(1).join('?') : '';
    const isMultipart = req.is('multipart/form-data');
    let body = null;
    let rawBody = null;
    let contentType = '';
    if (isMultipart) {
      rawBody = await readRawBody(req);
      contentType = req.get('content-type') || '';
    } else if (req.method !== 'GET' && req.body !== undefined) {
      // express.json 只解析 JSON；DELETE/PUT/PATCH 没有 body 时传空对象，
      // 与上游 Tornado handler 里 json.loads(b"{}") 的行为一致。
      body = req.body && typeof req.body === 'object' ? req.body : {};
    }
    const rawResponse = req.method === 'GET' && (route === 'download' || route === 'result');
    const result = await proxyTool(id, route, {
      method: req.method,
      body,
      rawBody,
      contentType,
      query,
      rawResponse,
      timeoutMs: timeoutForRoute(route),
      userId: req.authSession && req.authSession.id,
    });
    res.set('Cache-Control', 'no-store');
    if (rawResponse) {
      const type = result.responseHeaders.get('content-type') || 'application/octet-stream';
      res.status(result.status).type(type);
      const disposition = result.responseHeaders.get('content-disposition');
      if (disposition) res.set('Content-Disposition', disposition);
      return res.send(result.buffer);
    }
    if (result.json !== null && result.json !== undefined) {
      return res.status(result.status).json(result.json);
    }
    return res.status(result.status).type('text/plain').send(result.text || '');
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
