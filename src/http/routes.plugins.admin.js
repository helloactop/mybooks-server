/* ============================================================
 * Plugin Center 管理 API（只读）
 *
 * 路由只做参数校验与错误映射，数据聚合在 core/plugins/center.js。
 * 挂载在 server.js 的 /api requireSession 之后，沿用单管理员会话。
 * 安装/更新/回滚/启停/卸载仍只走 /api/toolbox/*。
 * ============================================================ */

const express = require('express');

const { center, CenterError } = require('../core/plugins/center');
const grantsAdmin = require('../core/toolbox/grants-admin');
const { config: configService } = require('../core/toolbox/plugin-config');
const { TOOL_ID_RE } = require('../core/toolbox/manifest');

const router = express.Router();

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

function fail(res, err) {
  // 4xx 且带明确错误码的业务错误可以直接回传；其余一律按内部错误脱敏。
  const known = err instanceof CenterError
    || (err && typeof err.code === 'string' && Number.isSafeInteger(err.status)
      && err.status >= 400 && err.status < 500);
  if (!known) console.error('[plugins-admin]', err && (err.stack || err));
  const status = known ? err.status : 500;
  const code = known ? err.code : 'INTERNAL_ERROR';
  const message = known ? err.message : '插件管理请求失败';
  const body = { error: { code, message }, code, message };
  if (known && err.details !== undefined) body.details = err.details;
  return res.status(status).json(body);
}

function bodyOf(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CenterError('INVALID_BODY', '请求体必须是 JSON 对象', 400);
  }
  return body;
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
      since: String(req.query.since || '').trim(),
      limit: limitParam(req.query.limit, 50, 200),
      offset: offsetParam(req.query.offset),
    }));
  } catch (err) {
    fail(res, err);
  }
});

// 权限写入：只改 grants.json 中当前插件那一段，原子替换 + 版本冲突检测。
router.put('/api/plugins/:id/permissions', async (req, res) => {
  const id = String(req.params.id || '').trim();
  try {
    noStore(res);
    const body = bodyOf(req);
    const result = await grantsAdmin.updatePermissions(id, {
      permissions: body.permissions,
      ifVersion: body.if_version,
    });
    res.json({ ...result, permissions: await center.permissions(id) });
  } catch (err) {
    await grantsAdmin.recordFailure(id, 'permission.update', err && err.code);
    fail(res, err);
  }
});

// 配置写入：Node 校验 Schema 后交给 Runtime 合并落盘，敏感字段由 Runtime 加密保存。
router.put('/api/plugins/:id/config', async (req, res) => {
  const id = String(req.params.id || '').trim();
  try {
    noStore(res);
    const body = bodyOf(req);
    res.json(await configService.save(id, {
      values: body.values,
      clearSensitive: body.clear_sensitive,
      ifVersion: body.if_version,
    }));
  } catch (err) {
    await configService.recordFailure(id, 'config.update', err && err.code);
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
