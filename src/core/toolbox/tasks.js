/* ============================================================
 * Toolbox 任务取消（宿主侧统一实现）
 *
 * HTTP 路由与 Runtime Manager 都走这里，避免两套取消语义：
 *   · 任务必须存在且仍为 running；
 *   · 工具必须已安装且启用；
 *   · 插件 manifest 必须声明 cancel 路由，否则显式 409；
 *   · 取消只是“请求插件取消”，最终状态由插件回写。
 * ============================================================ */

const { db } = require('../../db/index');
const toolboxRepo = require('../../db/toolbox');
const { findRoute } = require('./manifest');
const { ToolboxError } = require('./security');
const { proxyTool } = require('./runtime');

async function cancelTask(taskId, { toolId = '', userId = '' } = {}) {
  const id = Number(taskId);
  const task = Number.isSafeInteger(id) && id > 0 ? toolboxRepo.getTask(db, id) : null;
  // toolId 用于运行时按实例取消：不允许拿 A 插件实例取消 B 插件的任务。
  if (!task || (toolId && task.tool_id !== toolId)) {
    throw new ToolboxError('TASK_NOT_FOUND', '任务不存在', 404);
  }
  if (task.status !== 'running') {
    throw new ToolboxError('TASK_NOT_RUNNING', '任务已结束', 409);
  }
  const tool = toolboxRepo.getTool(db, task.tool_id);
  if (!tool) throw new ToolboxError('NOT_INSTALLED', '工具尚未安装', 404);
  if (!tool.enabled) throw new ToolboxError('TOOL_DISABLED', '工具未启用', 409);
  if (!findRoute(tool.manifest, 'cancel')) {
    throw new ToolboxError('CANCEL_UNSUPPORTED', '该工具没有提供取消接口', 409);
  }
  const result = await proxyTool(task.tool_id, 'cancel', {
    method: 'POST', body: {}, timeoutMs: 10_000, userId,
  });
  if (!result.ok) {
    const msg = result.json && (result.json.msg || result.json.error);
    throw new ToolboxError('CANCEL_FAILED', msg || '取消请求失败', 502);
  }
  toolboxRepo.updateTask(db, id, { message: '已请求取消' });
  return { task, plugin: result.json };
}

module.exports = { cancelTask };
