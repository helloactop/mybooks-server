/* ============================================================
 * Legacy Toolbox 只读适配器
 *
 * 把 toolbox_tools 记录转换成统一插件描述符，供只读管理 API 使用。
 * 这里不注册 Provider、不代理调用、不写回 Manifest：
 * 旧插件的安装、启停、更新和调用仍走原 /api/toolbox/* 与 proxyTool。
 * ============================================================ */

const toolboxRepo = require('../../../db/toolbox');
const { TOOL_ID_RE } = require('../../toolbox/manifest');
const { isReviewed } = require('../../toolbox/allowlist');

class LegacyAdapterError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'LegacyAdapterError';
    this.code = code;
    this.status = status;
  }
}

function compatibilitySummary(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const codes = (list) => (Array.isArray(list)
    ? list.map((item) => (item && typeof item.code === 'string' ? item.code : '')).filter(Boolean).slice(0, 20)
    : []);
  return Object.freeze({
    supported: !!raw.supported,
    reasons: Object.freeze(codes(raw.reasons)),
    warnings: Object.freeze(codes(raw.warnings)),
  });
}

// loaded 是宿主按 pending_restart / last_error 推断，不是 Worker 心跳；
// 真正的加载报告仍由 reloadAndSync 写回数据库。
function statusOf(tool) {
  if (!tool.enabled) return 'disabled';
  if (tool.last_error) return 'error';
  if (tool.pending_restart) return 'pending_restart';
  return 'active';
}

function reviewedOf(tool) {
  const compat = tool.compatibility;
  if (compat && typeof compat.reviewed === 'boolean') return compat.reviewed;
  return isReviewed(tool.tool_id, tool.revision);
}

function toDescriptor(tool) {
  const status = statusOf(tool);
  return Object.freeze({
    instanceId: `legacy.${tool.tool_id}`,
    pluginId: tool.tool_id,
    providerId: tool.tool_id,
    source: 'legacy-toolbox',
    name: tool.name || tool.tool_id,
    revision: tool.revision,
    runtime: tool.runtime || 'python',
    toolType: tool.tool_type || 'tool',
    enabled: !!tool.enabled,
    status,
    loaded: status === 'active',
    capabilities: Object.freeze(['legacy.toolbox@1']),
    reviewed: reviewedOf(tool),
    pendingRestart: !!tool.pending_restart,
    lastError: String(tool.last_error || '').slice(0, 500),
    compatibility: compatibilitySummary(tool.compatibility),
    installedAt: tool.installed_at || '',
    updatedAt: tool.updated_at || '',
  });
}

class LegacyToolboxAdapter {
  constructor({ db } = {}) {
    if (!db) throw new LegacyAdapterError('LEGACY_ADAPTER_INVALID', '必须注入数据库连接');
    this._db = db;
  }

  list() {
    return toolboxRepo.listTools(this._db).map(toDescriptor);
  }

  get(toolId) {
    if (typeof toolId !== 'string' || !TOOL_ID_RE.test(toolId)) {
      throw new LegacyAdapterError('LEGACY_TOOL_ID_INVALID', 'tool_id 不合法');
    }
    const tool = toolboxRepo.getTool(this._db, toolId);
    return tool ? toDescriptor(tool) : null;
  }
}

module.exports = { LegacyToolboxAdapter, LegacyAdapterError };
