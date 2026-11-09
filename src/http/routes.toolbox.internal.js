/* ============================================================
 * Python Runtime 专用内部接口
 *
 * 只允许共享卷内的 runtime 通过独立密钥访问；不经过用户会话，
 * 也不向插件暴露管理员 Cookie/Bearer。Nginx 应额外拒绝 /internal/。
 * ============================================================ */

const express = require('express');

const { db } = require('../db/index');
const toolboxRepo = require('../db/toolbox');
const { TOOL_ID_RE } = require('../core/toolbox/manifest');
const { ToolboxError, timingSafeEqualString } = require('../core/toolbox/security');
const { internalSecret } = require('../core/toolbox/runtime');
const { verifyIdentity } = require('../core/toolbox/identities');
const { pluginGrantsFor } = require('../core/toolbox/plugin-grants');
const { resolveAccess, requireAccess } = require('../core/toolbox/access-policy');
const { importToolFile, getBookMetadata } = require('../core/toolbox/import');
const library = require('../core/toolbox/library');

const router = express.Router();

function readRequestIdentity(req) {
  const toolId = String(req.get('x-mybooks-plugin-id') || '').trim();
  const token = String(req.get('x-mybooks-plugin-token') || '').trim();
  if (!toolId && !token) return null; // 旧 Worker：保持兼容
  if (!toolId || !token || !verifyIdentity(toolId, token)) {
    throw new ToolboxError('PLUGIN_IDENTITY_INVALID', '插件身份无效', 403);
  }
  return Object.freeze({ toolId });
}

function requireInternal(req, res, next) {
  const provided = req.get('x-toolbox-internal-secret') || '';
  if (!timingSafeEqualString(provided, internalSecret())) {
    return res.status(403).json({ error: '禁止访问', code: 'INTERNAL_FORBIDDEN' });
  }
  try {
    req.pluginIdentity = readRequestIdentity(req);
    const policy = req.pluginIdentity ? pluginGrantsFor(req.pluginIdentity.toolId) : null;
    // 只有“带身份但未配置策略”时才需要查安装表判断是否可信旧插件；
    // 已配置策略/无身份路径都不必多打一次数据库。
    const toolInstalled = req.pluginIdentity && policy && !policy.configured
      ? !!toolboxRepo.getTool(db, req.pluginIdentity.toolId)
      : false;
    req.pluginAccess = resolveAccess({ identity: req.pluginIdentity, policy, toolInstalled });
  } catch (err) {
    return fail(res, err);
  }
  return next();
}

// Legacy 兼容模式保留旧行为；Strict 模式（已配置策略/新运行时/策略损坏）
// 一律按权限 + 资源范围校验，缺失时 403。
function requirePermission(req, permission, resource) {
  requireAccess(req.pluginAccess, req.pluginIdentity && req.pluginIdentity.toolId, permission, resource);
}

router.use('/internal/toolbox', requireInternal, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function fail(res, err) {
  const status = err instanceof ToolboxError
    ? err.status
    : (Number.isSafeInteger(err && err.status) ? err.status : 500);
  if (status >= 500) console.error('[toolbox:internal]', err && (err.stack || err));
  res.status(status).json({ error: (err && err.message) || '内部操作失败', code: (err && err.code) || 'INTERNAL_ERROR' });
}

function safeToolId(raw) {
  const value = String(raw || '');
  if (!TOOL_ID_RE.test(value)) throw new ToolboxError('TOOL_ID_INVALID', '工具 ID 不合法');
  return value;
}

function toolIdForRequest(req, rawToolId) {
  const bodyId = rawToolId ? safeToolId(rawToolId) : '';
  const identity = req.pluginIdentity;
  if (identity) {
    if (bodyId && bodyId !== identity.toolId) {
      throw new ToolboxError('PLUGIN_IDENTITY_MISMATCH', '插件身份与 tool_id 不一致', 403);
    }
    return identity.toolId;
  }
  if (!bodyId) throw new ToolboxError('TOOL_ID_REQUIRED', '缺少 tool_id');
  return bodyId;
}

function taskForTool(taskId, toolId) {
  const id = Number(taskId);
  if (!Number.isSafeInteger(id) || id < 1) throw new ToolboxError('TASK_INVALID', '任务 ID 不合法');
  const task = toolboxRepo.getTask(db, id);
  if (!task) throw new ToolboxError('TASK_NOT_FOUND', '任务不存在', 404);
  if (toolId && task.tool_id !== toolId) throw new ToolboxError('TASK_TOOL_MISMATCH', '任务不属于该工具', 403);
  return task;
}

function taskForRequest(req, taskId) {
  const task = taskForTool(taskId);
  if (req.pluginIdentity && task.tool_id !== req.pluginIdentity.toolId) {
    throw new ToolboxError('TASK_TOOL_MISMATCH', '任务不属于该插件', 403);
  }
  return task;
}

router.post('/internal/toolbox/import', async (req, res) => {
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    const tool = toolboxRepo.getTool(db, toolId);
    if (!tool) throw new ToolboxError('TOOL_NOT_INSTALLED', '工具尚未安装', 404);
    if (!tool.enabled) throw new ToolboxError('TOOL_DISABLED', '工具未启用', 403);
    requirePermission(req, 'books.write', 'library:all');
    if (body.task_id) {
      const task = taskForRequest(req, body.task_id);
      if (task.tool_id !== toolId) throw new ToolboxError('TASK_TOOL_MISMATCH', '任务不属于该工具', 403);
    }
    const result = await importToolFile({
      toolId,
      filePath: body.file_path,
      title: body.title,
      authors: body.authors,
      handleDb: db,
    });
    if (body.task_id && result.book_id) {
      try {
        toolboxRepo.updateTask(db, Number(body.task_id), {
          result_book_id: result.book_id,
          stage: 'imported',
          message: result.message || '',
        });
      } catch { /* 任务更新失败不影响入库结果 */ }
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/books/:id/metadata', (req, res) => {
  try {
    requirePermission(req, 'books.read', `book:${req.params.id}`);
    res.json({ ok: true, metadata: getBookMetadata(req.params.id, db) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/books/:id/metadata', (req, res) => {
  try {
    requirePermission(req, 'metadata.write', `book:${req.params.id}`);
    const body = req.body || {};
    const metadata = library.updateMetadata(db, req.params.id, body);
    res.json({ ok: true, metadata });
  } catch (err) {
    fail(res, err);
  }
});

function parseIds(raw) {
  if (Array.isArray(raw)) return raw.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  return String(raw || '').split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
}

router.get('/internal/toolbox/library/ids', (req, res) => {
  try {
    requirePermission(req, 'books.read', 'library:all');
    res.json({ ok: true, ids: library.listIds(db, { q: req.query.q || '', limit: req.query.limit }) });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/library/books', (req, res) => {
  try {
    const ids = parseIds(req.query.ids || '');
    if (ids.length) {
      for (const id of ids) requirePermission(req, 'books.read', `book:${id}`);
    } else {
      requirePermission(req, 'books.read', 'library:all');
    }
    const books = ids.length
      ? library.getBooks(db, ids)
      : library.searchBooks(db, req.query.q || '', req.query.limit || 50);
    res.json({ ok: true, books });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/library/fields', (req, res) => {
  try {
    const field = String(req.query.field || '');
    if (!field) throw new ToolboxError('FIELD_REQUIRED', '缺少 field 参数');
    requirePermission(req, 'books.read', 'library:all');
    const values = library.getFields(db, field, parseIds(req.query.ids || ''));
    res.json({ ok: true, values });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/library/cover/:id', (req, res) => {
  try {
    requirePermission(req, 'files.read', `book:${req.params.id}`);
    res.json({ ok: true, ...library.coverData(db, req.params.id) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/library/export', async (req, res) => {
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    const tool = toolboxRepo.getTool(db, toolId);
    if (!tool) throw new ToolboxError('TOOL_NOT_INSTALLED', '工具尚未安装', 404);
    if (!tool.enabled) throw new ToolboxError('TOOL_DISABLED', '工具未启用', 403);
    requirePermission(req, 'files.read', `book:${body.book_id}`);
    const file = await library.exportFile(db, toolId, body.book_id, body.format);
    res.json({ ok: true, file });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/library/books/:id/metadata', (req, res) => {
  try {
    requirePermission(req, 'metadata.write', `book:${req.params.id}`);
    res.json({ ok: true, metadata: library.updateMetadata(db, req.params.id, req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/library/books/:id/delete', (req, res) => {
  try {
    requirePermission(req, 'books.delete', `book:${req.params.id}`);
    res.json({ ok: true, ...library.deleteBook(db, req.params.id) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/library/books/:id/merge-formats', async (req, res) => {
  try {
    const target = (req.body || {}).target_id;
    requirePermission(req, 'books.write', `book:${req.params.id}`);
    requirePermission(req, 'books.write', `book:${target}`);
    res.json({ ok: true, ...(await library.mergeFormats(db, req.params.id, target)) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/library/items', (req, res) => {
  try {
    requirePermission(req, 'books.write', 'library:all');
    const body = req.body || {};
    res.json({ ok: true, item: library.createItem(body.book_id, body.user_id) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/tasks', (req, res) => {
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    const tool = toolboxRepo.getTool(db, toolId);
    if (!tool) throw new ToolboxError('TOOL_NOT_INSTALLED', '工具尚未安装', 404);
    if (!tool.enabled) throw new ToolboxError('TOOL_DISABLED', '工具未启用', 403);
    requirePermission(req, 'jobs.create');
    const task = toolboxRepo.createTask(db, {
      toolId,
      operation: String(body.operation || 'download').slice(0, 40),
      runtimeTaskId: Number.isSafeInteger(Number(body.runtime_task_id)) ? Number(body.runtime_task_id) : null,
      details: body.details && typeof body.details === 'object' ? body.details : {},
    });
    res.status(201).json({ ok: true, task_id: task.id, task });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/internal/toolbox/tasks/:id', (req, res) => {
  try {
    const task = taskForRequest(req, req.params.id);
    const body = req.body || {};
    const patch = {};
    for (const key of ['stage', 'progress', 'error', 'message', 'details']) {
      if (key in body) patch[key] = body[key];
    }
    if (body.result_book_id != null) patch.result_book_id = body.result_book_id;
    const status = String(body.status || '');
    if (status) {
      if (!['completed', 'failed', 'cancelled'].includes(status)) {
        throw new ToolboxError('TASK_STATUS_INVALID', '任务状态不合法');
      }
      toolboxRepo.finishTask(db, task.id, {
        status,
        error: String(body.error || ''),
        message: String(body.message || ''),
        resultBookId: body.result_book_id != null ? Number(body.result_book_id) : task.result_book_id,
      });
    }
    if (Object.keys(patch).length) toolboxRepo.updateTask(db, task.id, patch);
    res.json({ ok: true, task: toolboxRepo.getTask(db, task.id) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/tasks/:id/message', (req, res) => {
  try {
    const task = taskForRequest(req, req.params.id);
    const message = String((req.body && req.body.message) || '').slice(0, 1000);
    res.json({ ok: true, task: toolboxRepo.updateTask(db, task.id, { message }) });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
