/* ============================================================
 * Plugin Center 管理 API（只读）
 *
 * 路由只做参数校验与错误映射，数据聚合在 core/plugins/center.js。
 * 挂载在 server.js 的 /api requireSession 之后，沿用单管理员会话。
 * 安装/更新/回滚/启停/卸载仍只走 /api/toolbox/*。
 * ============================================================ */

const express = require('express');

const { center, CenterError } = require('../core/plugins/center');
const { TOOL_ID_RE } = require('../core/toolbox/manifest');

const router = express.Router();

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

function fail(res, err) {
  const known = err instanceof CenterError;
  if (!known) console.error('[plugins-admin]', err && (err.stack || err));
  const status = known ? err.status : 500;
  const code = known ? err.code : 'INTERNAL_ERROR';
  const message = known ? err.message : '插件管理请求失败';
  return res.status(status).json({ error: { code, message }, code, message });
}

function pluginId(raw) {
  const id = String(raw || '').trim();
  if (!TOOL_ID_RE.test(id)) throw new CenterError('INVALID_PLUGIN_ID', '插件 ID 不合法', 400);
  return id;
}

function limitParam(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(Math.trunc(number), max));
}

function offsetParam(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Math.trunc(number), 100000);
}

router.get('/api/plugins/overview', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.overview());
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/installed', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.installed());
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/store/index', async (req, res) => {
  try {
    const sort = ['name', 'updated', 'installed'].includes(req.query.sort) ? req.query.sort : 'name';
    noStore(res);
    res.json(await center.storeIndex({
      q: req.query.q,
      sort,
      refresh: req.query.refresh === '1',
    }));
  } catch (err) {
    fail(res, err);
  }
});

// 保留固定段，避免 /api/plugins/store 被当成插件 ID。
router.get('/api/plugins/store', (req, res) => {
  noStore(res);
  res.status(404).json({
    error: { code: 'STORE_NOT_FOUND', message: '请使用 /api/plugins/store/index' },
    code: 'STORE_NOT_FOUND',
    message: '请使用 /api/plugins/store/index',
  });
});

router.get('/api/plugins/store/:id', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.storeDetail(pluginId(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/tasks', (req, res) => {
  try {
    const toolId = String(req.query.tool_id || req.query.plugin_id || '').trim();
    noStore(res);
    res.json(center.tasks({
      toolId,
      status: String(req.query.status || '').trim(),
      limit: limitParam(req.query.limit, 50, 100),
      offset: offsetParam(req.query.offset),
    }));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/tasks/:id', (req, res) => {
  try {
    noStore(res);
    res.json(center.taskDetail(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/security', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.security());
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/:id/permissions', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.permissions(pluginId(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/:id/config', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.config(pluginId(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/:id/versions', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.versions(pluginId(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/:id/logs', async (req, res) => {
  try {
    const type = String(req.query.type || 'errors').trim();
    noStore(res);
    res.json(await center.logs(pluginId(req.params.id), {
      type,
      limit: limitParam(req.query.limit, 50, 200),
      offset: offsetParam(req.query.offset),
    }));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/api/plugins/:id', async (req, res) => {
  try {
    noStore(res);
    res.json(await center.detail(pluginId(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
