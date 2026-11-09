/* ============================================================
 * 内部接口访问模式：Legacy Compatibility / Strict Plugin
 *
 * 背景：旧 Toolbox Worker 与 Node 共享 internal-secret，且历史协议不带
 * 插件身份头。为了不破坏已安装插件，共享密钥路径必须保留，但只能在
 * 明确声明的 Legacy 兼容模式下使用；新 Runtime 的身份请求按 Strict 处理。
 *
 * 判定规则：
 *   · 无插件身份 + Legacy 兼容开启        → legacy-compat（旧 Worker）
 *   · 身份令牌有效 + 已配置 grants.json   → strict（按 scope 严格裁剪）
 *   · 身份令牌有效 + 工具是已安装旧插件    → legacy-verified（兼容但已归属）
 *   · 身份令牌有效 + 未知/未安装工具       → strict 且默认拒绝
 *   · grants.json 损坏/不可读              → strict 且默认拒绝（fail-closed）
 *   · MYBOOKS_TOOLBOX_LEGACY_COMPAT=false → legacy 路径整体关闭
 *
 * 这仍然不是跨插件强隔离：共享 Python 进程内的恶意插件可以读到其他
 * 插件的身份令牌。真正的隔离需要独立进程/容器，不能靠本文件宣称完成。
 * ============================================================ */

const { ToolboxError } = require('./security');
const { GrantStore } = require('../plugins/permissions');

const ENV_LEGACY_COMPAT = 'MYBOOKS_TOOLBOX_LEGACY_COMPAT';
const DENY_ALL = new GrantStore();

function legacyCompatEnabled() {
  const raw = process.env[ENV_LEGACY_COMPAT];
  if (raw === undefined || raw === '') return true; // 默认保留旧插件
  return raw === 'true' || raw === '1';
}

function modeNotice() {
  return legacyCompatEnabled()
    ? 'Legacy 兼容模式已启用：未带插件身份的内部调用仍可用共享密钥访问（不是强隔离）'
    : 'Legacy 兼容模式已关闭：内部敏感调用必须携带有效插件身份令牌';
}

function resolveAccess({ identity, policy, toolInstalled }) {
  if (!identity) {
    if (!legacyCompatEnabled()) {
      throw new ToolboxError('LEGACY_MODE_DISABLED', '内部调用必须携带插件身份令牌', 403);
    }
    return Object.freeze({ mode: 'legacy-compat', strict: false, configured: false, store: null });
  }

  const state = policy && policy.state ? policy.state : 'absent';
  if (state === 'broken') {
    return Object.freeze({ mode: 'strict', strict: true, configured: true, store: DENY_ALL, reason: 'policy-broken' });
  }
  if (policy && policy.configured) {
    return Object.freeze({ mode: 'strict', strict: true, configured: true, store: policy.store, reason: 'grants-config' });
  }
  if (toolInstalled && legacyCompatEnabled()) {
    return Object.freeze({ mode: 'legacy-verified', strict: false, configured: false, store: null, reason: 'legacy-tool' });
  }
  // 未知/新插件没有策略：默认拒绝，不提供无身份兼容回退。
  return Object.freeze({ mode: 'strict', strict: true, configured: true, store: DENY_ALL, reason: 'no-grants' });
}

// strict 模式下按权限 + 资源范围校验；legacy 模式保留旧行为（但已明确标记）。
function requireAccess(access, toolId, permission, resource) {
  if (!access || !access.strict) return;
  if (!access.configured) {
    throw new ToolboxError('PERMISSION_DENIED', `插件 ${toolId || 'unknown'} 缺少权限：${permission}`, 403);
  }
  if (!toolId) throw new ToolboxError('PLUGIN_IDENTITY_REQUIRED', '严格模式必须提供插件身份', 403);
  access.store.require(toolId, permission, resource);
}

module.exports = {
  ENV_LEGACY_COMPAT,
  legacyCompatEnabled,
  modeNotice,
  resolveAccess,
  requireAccess,
};
