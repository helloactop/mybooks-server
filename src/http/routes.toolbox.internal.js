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
const { pluginGrantsFor, policyState } = require('../core/toolbox/plugin-grants');
const { resolveAccess, requireAccess, pluginAuthOnlyEnabled } = require('../core/toolbox/access-policy');
const { importToolFile, getBookMetadata } = require('../core/toolbox/import');
const library = require('../core/toolbox/library');
const artifacts = require('../core/toolbox/artifacts');
const { cancelTask } = require('../core/toolbox/tasks');
const { getPluginDescriptor } = require('../core/toolbox/descriptor');
const { validateConfig } = require('../core/toolbox/config-schema');
const { metadata } = require('./plugin-services');

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
  try {
    // 策略整体损坏且无快照时，连无身份的 Legacy 路径也必须拒绝（fail-closed 前置）。
    const state = policyState();
    if (state === 'broken') {
      throw new ToolboxError('POLICY_BROKEN', '权限策略损坏，内部敏感操作已拒绝', 403);
    }

    // 身份头一旦出现就必须有效：错误令牌不会退回共享密钥或匿名 Legacy。
    const identity = readRequestIdentity(req);
    if (!identity) {
      if (pluginAuthOnlyEnabled()) {
        throw new ToolboxError('PLUGIN_IDENTITY_REQUIRED', '隔离模式必须携带有效的插件身份令牌', 403);
      }
      const provided = req.get('x-toolbox-internal-secret') || '';
      if (!timingSafeEqualString(provided, internalSecret())) {
        throw new ToolboxError('INTERNAL_FORBIDDEN', '禁止访问', 403);
      }
    }
    // 有效身份可省略共享密钥；但身份只解决“是谁”，权限与资源范围仍由下面判定。
    req.pluginIdentity = identity;
    const policy = identity ? pluginGrantsFor(identity.toolId) : null;
    // 身份请求统一检查安装/启用状态：停用的插件不能通过内部接口继续读改书库。
    // 未安装的插件（未来新 Runtime）交给 grants 判定，不在这里拦。
    const tool = identity ? toolboxRepo.getTool(db, identity.toolId) : null;
    if (tool && !tool.enabled) {
      throw new ToolboxError('TOOL_DISABLED', '插件未启用', 403);
    }
    req.pluginAccess = resolveAccess({
      identity,
      policy,
      toolInstalled: !!tool,
      policyState: state,
    });
    // 隔离部署不允许“已安装但未配置 grants”的插件沿用 legacy-verified 宽松路径。
    if (identity && pluginAuthOnlyEnabled() && !req.pluginAccess.strict) {
      throw new ToolboxError(
        'PLUGIN_GRANTS_REQUIRED',
        '隔离模式下插件必须在 grants.json 中显式配置授权',
        403,
      );
    }
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

// -- Phase 4B：统一能力接口 -------------------------------------------------

function parseDetails(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function taskDto(task) {
  return {
    job_id: task.id,
    tool_id: task.tool_id,
    operation: task.operation,
    status: task.status,
    stage: task.stage || '',
    progress: Number(task.progress) || 0,
    created_at: task.created_at,
    finished_at: task.finished_at || null,
    error: task.error || '',
    message: task.message || '',
    result_book_id: task.result_book_id == null ? null : Number(task.result_book_id),
    runtime_task_id: task.runtime_task_id == null ? null : Number(task.runtime_task_id),
    details: parseDetails(task.details),
  };
}

function requireInstalledTool(toolId) {
  const tool = toolboxRepo.getTool(db, toolId);
  if (!tool) throw new ToolboxError('TOOL_NOT_INSTALLED', '工具尚未安装', 404);
  if (!tool.enabled) throw new ToolboxError('TOOL_DISABLED', '工具未启用', 403);
  return tool;
}

// books.create@1：只写元数据，不创建文件/阅读记录，避免绕过导入流程。
router.post('/internal/toolbox/books', (req, res) => {
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    requireInstalledTool(toolId);
    requirePermission(req, 'books.write', 'library:all');
    const book = library.createBook(db, body);
    res.status(201).json({ ok: true, book });
  } catch (err) {
    fail(res, err);
  }
});

// books.update@1：按批准决策只要求 books.write；现有 metadata 接口保持 metadata.write。
router.patch('/internal/toolbox/books/:id', (req, res) => {
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    requireInstalledTool(toolId);
    requirePermission(req, 'books.write', `book:${req.params.id}`);
    const book = library.updateBook(db, req.params.id, body);
    res.json({ ok: true, book });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/books/:id/reading', (req, res) => {
  try {
    const toolId = toolIdForRequest(req, req.query.tool_id);
    requireInstalledTool(toolId);
    requirePermission(req, 'books.read', `book:${req.params.id}`);
    res.json({ ok: true, reading: library.readingStatus(db, req.params.id) });
  } catch (err) {
    fail(res, err);
  }
});

// files.publish@1：资源标识固定为 artifact:create，授权范围写作 files.write:artifact:*。
router.post('/internal/toolbox/artifacts', async (req, res) => {
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    requireInstalledTool(toolId);
    requirePermission(req, 'files.write', 'artifact:create');
    const artifact = await artifacts.publishArtifact({
      toolId,
      taskId: body.task_id,
      path: body.path,
      format: body.format,
      title: body.title,
      sha256: body.sha256,
      maxBytes: body.max_bytes,
      handleDb: db,
    });
    res.status(201).json({ ok: true, artifact });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/artifacts/:id', (req, res) => {
  try {
    const toolId = toolIdForRequest(req, req.query.tool_id);
    requireInstalledTool(toolId);
    requirePermission(req, 'files.read', `artifact:${req.params.id}`);
    res.json({ ok: true, artifact: artifacts.getArtifact({ toolId, artifactId: req.params.id, handleDb: db }) });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/internal/toolbox/artifacts/:id', (req, res) => {
  try {
    const toolId = toolIdForRequest(req, req.query.tool_id);
    requireInstalledTool(toolId);
    requirePermission(req, 'files.write', `artifact:${req.params.id}`);
    artifacts.getArtifact({ toolId, artifactId: req.params.id, handleDb: db });
    const removed = toolboxRepo.softDeleteArtifact(db, req.params.id, toolId);
    if (!removed) throw new ToolboxError('ARTIFACT_NOT_FOUND', '产物不存在', 404);
    res.json({ ok: true, artifact_id: req.params.id, deleted: true });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/tasks/:id', (req, res) => {
  try {
    const task = taskForRequest(req, req.params.id);
    requirePermission(req, 'jobs.create');
    res.json({ ok: true, task: taskDto(task) });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/internal/toolbox/tasks/:id/result', (req, res) => {
  try {
    const task = taskForRequest(req, req.params.id);
    requirePermission(req, 'jobs.create');
    if (task.status === 'running') {
      throw new ToolboxError('TASK_NOT_FINISHED', '任务尚未结束', 409);
    }
    let book = null;
    if (task.result_book_id) {
      try { book = getBookMetadata(task.result_book_id, db); } catch { book = null; }
    }
    res.json({
      ok: true,
      result: {
        ...taskDto(task),
        book,
        artifacts: artifacts.listTaskArtifacts({ toolId: task.tool_id, taskId: task.id, handleDb: db }),
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/internal/toolbox/tasks/:id/cancel', async (req, res) => {
  try {
    const task = taskForRequest(req, req.params.id);
    requirePermission(req, 'jobs.create');
    const result = await cancelTask(task.id, { toolId: task.tool_id });
    res.json({ ok: true, ...result });
  } catch (err) {
    fail(res, err);
  }
});

// config.validate@1：只看 Schema，不回显任何配置值。
router.post('/internal/toolbox/config/validate', (req, res) => {
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    requireInstalledTool(toolId);
    const descriptor = getPluginDescriptor(toolId, { db });
    const schema = descriptor && descriptor.configuration && descriptor.configuration.schema;
    if (!schema) throw new ToolboxError('CONFIG_SCHEMA_MISSING', '插件未声明配置 Schema', 404);
    const result = validateConfig(schema, body.values !== undefined ? body.values : body.config);
    res.json({ ok: result.ok, errors: result.errors });
  } catch (err) {
    fail(res, err);
  }
});

// metadata.search@1：复用现有 CapabilityRouter + 豆瓣/Open Library Provider。
router.post('/internal/toolbox/metadata/search', async (req, res) => {
  let timer = null;
  try {
    const body = req.body || {};
    const toolId = toolIdForRequest(req, body.tool_id);
    requireInstalledTool(toolId);
    requirePermission(req, 'metadata.read', 'library:all');
    const isbn = String(body.isbn || '').trim();
    const query = String(body.query || '').trim();
    if (!isbn && !query) throw new ToolboxError('METADATA_QUERY_REQUIRED', '缺少查询条件');
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 20000);
    const result = await metadata.service.search(
      isbn ? { isbn } : { query },
      { signal: controller.signal },
    );
    const fields = ['source', 'sourceId', 'title', 'subtitle', 'authors', 'translators',
      'publisher', 'pubYear', 'language', 'isbn10', 'isbn13', 'cover', 'description',
      'tags', 'rating', 'series', 'seriesIndex', 'sourceUrl'];
    const limit = Math.max(1, Math.min(Number(body.limit) || 20, 20));
    const candidates = (result && result.candidates ? result.candidates : []).slice(0, limit).map((item) => {
      const out = {};
      for (const key of fields) if (item[key] !== undefined) out[key] = item[key];
      return out;
    });
    res.json({ ok: true, candidates });
  } catch (err) {
    if (err && err.name === 'AbortError') return fail(res, new ToolboxError('METADATA_TIMEOUT', '元数据查询超时', 504));
    return fail(res, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
});

module.exports = router;
