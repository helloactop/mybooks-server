/* ============================================================
 * 工具箱数据访问层：安装记录与任务记录
 *
 * 只做 SQL 与 JSON 编解码，不碰文件系统、不感知 HTTP。
 * tool_id 是唯一键；install_path 是相对 TOOLBOX_DIR 的路径。
 * ============================================================ */

const TOOL_COLUMNS = `tool_id, name, revision, runtime, enabled, install_path,
  sha256, source, compatibility, manifest, previous_path, previous_revision,
  installed_at, updated_at, tool_type, pending_restart, last_error`;
const TASK_COLUMNS = `id, tool_id, operation, status, stage, progress, created_at,
  finished_at, error, message, result_book_id, runtime_task_id, details`;
const ARTIFACT_COLUMNS = `id, artifact_id, tool_id, task_id, format, mime, size, sha256,
  title, rel_path, status, created_at, updated_at, deleted_at`;

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function decodeTool(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: !!row.enabled,
    pending_restart: !!row.pending_restart,
    compatibility: parseJson(row.compatibility, {}),
    manifest: parseJson(row.manifest, {}),
  };
}

function decodeTask(row) {
  if (!row) return null;
  return { ...row, details: parseJson(row.details, {}) };
}

function listTools(db) {
  return db.prepare(`SELECT ${TOOL_COLUMNS} FROM toolbox_tools ORDER BY installed_at DESC`).all().map(decodeTool);
}

function getTool(db, toolId) {
  return decodeTool(db.prepare(`SELECT ${TOOL_COLUMNS} FROM toolbox_tools WHERE tool_id = ?`).get(toolId));
}

function insertTool(db, record) {
  const ts = record.installed_at || new Date().toISOString();
  db.prepare(`
    INSERT INTO toolbox_tools (tool_id, name, revision, runtime, enabled, install_path,
      sha256, source, compatibility, manifest, previous_path, previous_revision,
      installed_at, updated_at, tool_type, pending_restart, last_error)
    VALUES (@tool_id, @name, @revision, @runtime, @enabled, @install_path,
      @sha256, @source, @compatibility, @manifest, @previous_path, @previous_revision,
      @installed_at, @updated_at, @tool_type, @pending_restart, @last_error)
  `).run({
    tool_id: record.tool_id,
    name: record.name || '',
    revision: record.revision,
    runtime: record.runtime || 'python',
    enabled: record.enabled === false ? 0 : 1,
    install_path: record.install_path,
    sha256: record.sha256 || '',
    source: record.source || 'store',
    compatibility: JSON.stringify(record.compatibility || {}),
    manifest: JSON.stringify(record.manifest || {}),
    previous_path: record.previous_path || '',
    previous_revision: record.previous_revision || '',
    installed_at: ts,
    updated_at: record.updated_at || ts,
    tool_type: record.tool_type || 'tool',
    pending_restart: record.pending_restart === false ? 0 : 1,
    last_error: record.last_error || '',
  });
  return getTool(db, record.tool_id);
}

// patch 只接受安装记录里允许更新的字段，避免调用方顺手写进任意列
function updateTool(db, toolId, patch = {}) {
  const allowed = ['name', 'revision', 'runtime', 'enabled', 'install_path', 'sha256', 'source',
    'compatibility', 'manifest', 'previous_path', 'previous_revision', 'tool_type',
    'pending_restart', 'last_error'];
  const sets = [];
  const params = { tool_id: toolId, updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'enabled' || key === 'pending_restart') value = value ? 1 : 0;
    if (key === 'compatibility' || key === 'manifest') value = JSON.stringify(value || {});
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return getTool(db, toolId);
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE toolbox_tools SET ${sets.join(', ')} WHERE tool_id = @tool_id`).run(params);
  return getTool(db, toolId);
}

function setEnabled(db, toolId, enabled) {
  return updateTool(db, toolId, { enabled: !!enabled });
}

function removeTool(db, toolId) {
  return db.prepare('DELETE FROM toolbox_tools WHERE tool_id = ?').run(toolId).changes;
}

function createTask(db, { toolId, operation = 'download', runtimeTaskId = null, details = {}, stage = 'prepare' }) {
  const ts = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO toolbox_tasks (tool_id, operation, status, stage, progress, created_at,
      runtime_task_id, details)
    VALUES (?, ?, 'running', ?, 0, ?, ?, ?)
  `).run(toolId, operation, stage, ts, runtimeTaskId, JSON.stringify(details || {}));
  return getTask(db, Number(result.lastInsertRowid));
}

function getTask(db, id) {
  return decodeTask(db.prepare(`SELECT ${TASK_COLUMNS} FROM toolbox_tasks WHERE id = ?`).get(id));
}

function listTasks(db, { status = '', limit = 30 } = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 30, 100));
  if (status) {
    return db.prepare(`SELECT ${TASK_COLUMNS} FROM toolbox_tasks WHERE status = ? ORDER BY id DESC LIMIT ?`)
      .all(status, max).map(decodeTask);
  }
  return db.prepare(`SELECT ${TASK_COLUMNS} FROM toolbox_tasks ORDER BY id DESC LIMIT ?`)
    .all(max).map(decodeTask);
}

function updateTask(db, id, patch = {}) {
  const allowed = ['status', 'stage', 'progress', 'error', 'message', 'result_book_id', 'runtime_task_id', 'details'];
  const sets = [];
  const params = { id };
  for (const key of allowed) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'progress') value = Math.max(0, Math.min(100, Number(value) || 0));
    if (key === 'details') value = JSON.stringify(value || {});
    if (key === 'result_book_id') value = value == null ? null : Number(value);
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return getTask(db, id);
  const finished = ['completed', 'failed', 'cancelled'].includes(patch.status);
  if (finished) {
    sets.push('finished_at = @finished_at');
    params.finished_at = new Date().toISOString();
  }
  db.prepare(`UPDATE toolbox_tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getTask(db, id);
}

function finishTask(db, id, { status, error = '', message = '', resultBookId = null } = {}) {
  return updateTask(db, id, {
    status,
    stage: 'done',
    progress: 100,
    error,
    message,
    result_book_id: resultBookId,
  });
}

/**
 * 中断任务恢复。
 *
 * 默认（不带选项）把所有 running 任务标记失败，用于“运行时完全离线”的崩溃场景。
 * 宿主重启但 Worker 仍在运行时，调用方应传入 excludeToolIds（Worker 已加载的插件）
 * 与 staleBefore（长时间无进展的任务），避免把仍在执行的任务误判为失败。
 */
function recoverRunningTasks(db, reason = '服务重启，任务已中断', {
  excludeToolIds = [], staleBefore = '', createdBefore = '',
} = {}) {
  const ts = new Date().toISOString();
  const clauses = ["status = 'running'"];
  const params = { ts, reason };
  // 只回收“本次启动之前”创建的任务，避免误伤启动后刚创建的新任务。
  if (createdBefore) {
    clauses.push('created_at < @created_before');
    params.created_before = createdBefore;
  }
  const ids = (excludeToolIds || []).map(String).filter(Boolean);
  if (ids.length) {
    const placeholders = ids.map((id, index) => {
      const key = `tool${index}`;
      params[key] = id;
      return `@${key}`;
    }).join(', ');
    if (staleBefore) {
      clauses.push(`(tool_id NOT IN (${placeholders}) OR created_at < @stale_before)`);
      params.stale_before = staleBefore;
    } else {
      clauses.push(`tool_id NOT IN (${placeholders})`);
    }
  } else if (staleBefore) {
    clauses.push('created_at < @stale_before');
    params.stale_before = staleBefore;
  }
  return db.prepare(`
    UPDATE toolbox_tasks SET status = 'failed', stage = 'done', progress = 100,
      finished_at = @ts, error = @reason
    WHERE ${clauses.join(' AND ')}
  `).run(params).changes;
}

// -- Artifact 登记 ---------------------------------------------------------
// 只做 SQL；路径校验、大小与摘要由 core/toolbox/artifacts.js 负责。

function insertArtifact(db, record) {
  const ts = record.created_at || new Date().toISOString();
  db.prepare(`
    INSERT INTO toolbox_artifacts (artifact_id, tool_id, task_id, format, mime,
      size, sha256, title, rel_path, status, created_at, updated_at)
    VALUES (@artifact_id, @tool_id, @task_id, @format, @mime,
      @size, @sha256, @title, @rel_path, 'active', @created_at, @updated_at)
  `).run({
    artifact_id: record.artifact_id,
    tool_id: record.tool_id,
    task_id: record.task_id == null ? null : Number(record.task_id),
    format: record.format || '',
    mime: record.mime || 'application/octet-stream',
    size: Number(record.size) || 0,
    sha256: record.sha256 || '',
    title: record.title || '',
    rel_path: record.rel_path,
    created_at: ts,
    updated_at: ts,
  });
  return getArtifactByPublicId(db, record.artifact_id);
}

function getArtifactByPublicId(db, artifactId, { includeDeleted = false } = {}) {
  const row = db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM toolbox_artifacts WHERE artifact_id = ?`)
    .get(String(artifactId || ''));
  if (!row) return null;
  if (!includeDeleted && row.status !== 'active') return null;
  return row;
}

function listArtifactsForTask(db, taskId) {
  return db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM toolbox_artifacts
    WHERE task_id = ? AND status = 'active' ORDER BY id ASC`).all(Number(taskId));
}

function softDeleteArtifact(db, artifactId, toolId) {
  const ts = new Date().toISOString();
  return db.prepare(`UPDATE toolbox_artifacts SET status = 'deleted', deleted_at = ?, updated_at = ?
    WHERE artifact_id = ? AND tool_id = ? AND status = 'active'`)
    .run(ts, ts, String(artifactId || ''), String(toolId || '')).changes;
}

function deleteArtifactsForTool(db, toolId) {
  return db.prepare('DELETE FROM toolbox_artifacts WHERE tool_id = ?').run(String(toolId || '')).changes;
}

module.exports = {
  listTools, getTool, insertTool, updateTool, setEnabled, removeTool,
  createTask, getTask, listTasks, updateTask, finishTask, recoverRunningTasks,
  insertArtifact, getArtifactByPublicId, listArtifactsForTask,
  softDeleteArtifact, deleteArtifactsForTool,
};
