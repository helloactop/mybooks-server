/* ============================================================
 * grants.json 受控写入（Plugin Center 权限管理）
 *
 * 只改 TOOLBOX_DIR/state/grants.json 中当前插件的那一段授权，
 * 其余插件条目原样保留；写入采用“临时文件 + rename”原子替换，
 * 并在成功后刷新 last-good 快照与内存缓存。
 *
 * 安全边界：
 *   · 只能授予 Manifest 已声明的权限；
 *   · 资源型权限必须给出合法 scope；
 *   · 策略损坏 / 仅有不可信快照时禁止写入；
 *   · if_version 不匹配返回 409，绝不静默覆盖并发修改；
 *   · 不会触碰 Kernel 的 GrantStore。
 * ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { ToolboxError } = require('./security');
const { TOOL_ID_RE } = require('./manifest');
const grants = require('./plugin-grants');
const descriptorApi = require('./descriptor');
const audit = require('./audit');
const dbSingleton = require('../../db/index');
const toolboxRepo = require('../../db/toolbox');
const {
  PERMISSION_SET, RESOURCE_SCOPED, SCOPE_ALL, assertScope,
} = require('../plugins/permissions');

const MAX_PERMISSIONS = 64;

// 仅供管理界面展示：权限语义与风险等级，不参与授权判定。
const PERMISSION_META = Object.freeze({
  'books.read': { label: '读取书库', risk: 'low' },
  'books.write': { label: '修改书籍', risk: 'medium' },
  'books.delete': { label: '删除书籍', risk: 'high' },
  'metadata.read': { label: '读取元数据', risk: 'low' },
  'metadata.write': { label: '写入元数据', risk: 'medium' },
  'files.read': { label: '读取文件', risk: 'medium' },
  'files.write': { label: '写入文件', risk: 'medium' },
  'network.public': { label: '访问公网', risk: 'medium' },
  'network.private': { label: '访问内网地址', risk: 'high' },
  'jobs.create': { label: '创建后台任务', risk: 'low' },
  'settings.read': { label: '读取设置', risk: 'low' },
  'ui.contribute': { label: '注入界面片段', risk: 'low' },
});

function catalog() {
  return [...PERMISSION_SET].sort().map((name) => ({
    name,
    label: (PERMISSION_META[name] && PERMISSION_META[name].label) || name,
    risk: (PERMISSION_META[name] && PERMISSION_META[name].risk) || 'medium',
    resource_scoped: RESOURCE_SCOPED.has(name),
  }));
}

let writeQueue = Promise.resolve();

function serialized(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

function policyVersion() {
  try {
    const bytes = fs.readFileSync(grants.policyPath());
    return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  } catch {
    return '';
  }
}

function toolIdOf(raw) {
  const id = String(raw || '').trim();
  if (!TOOL_ID_RE.test(id)) throw new ToolboxError('INVALID_PLUGIN_ID', '插件 ID 不合法', 400);
  return id;
}

function descriptorOf(db, id) {
  const descriptor = descriptorApi.getPluginDescriptor(id, { db });
  if (!descriptor) throw new ToolboxError('PLUGIN_NOT_FOUND', '插件未安装', 404);
  return descriptorApi.toPublicDescriptor(descriptor);
}

function entryName(name, scope) {
  return scope === SCOPE_ALL ? name : `${name}:${scope}`;
}

function currentEntries(policy, id) {
  const map = new Map();
  if (!policy.store) return map;
  for (const item of policy.store.list(id)) {
    map.set(item.permission, new Set(item.scopes));
  }
  return map;
}

// 校验并归一化请求的权限列表；返回 [{name, scope}]。
function normalizeRequested(permissions, declared, id) {
  if (!Array.isArray(permissions)) {
    throw new ToolboxError('PERMISSIONS_REQUIRED', 'permissions 必须是数组', 400);
  }
  if (permissions.length > MAX_PERMISSIONS) {
    throw new ToolboxError('PERMISSIONS_TOO_MANY', '一次提交的权限过多', 400);
  }
  const declaredNames = new Set((declared || []).map((item) => item.name));
  const seen = new Map();
  for (const raw of permissions) {
    const name = String((raw && raw.name) || '').trim();
    if (!PERMISSION_SET.has(name)) {
      throw new ToolboxError('PERMISSION_INVALID', `未知权限：${name || '(空)'}`, 400);
    }
    if (!declaredNames.has(name)) {
      // 禁止借管理中心扩大插件能力。
      throw new ToolboxError('PERMISSION_NOT_DECLARED', `权限 ${name} 未在 Manifest 中声明`, 400);
    }
    let scope = raw && raw.scope !== undefined ? String(raw.scope).trim() : '';
    if (RESOURCE_SCOPED.has(name)) {
      if (!scope) {
        throw new ToolboxError('PERMISSION_SCOPE_REQUIRED', `权限 ${name} 需要明确资源范围`, 400);
      }
    } else {
      scope = SCOPE_ALL;
    }
    try {
      assertScope(scope);
    } catch (err) {
      throw new ToolboxError('PERMISSION_SCOPE_INVALID', `权限 ${name} 的资源范围不合法`, 400);
    }
    // 同一权限多个 scope 时合并为一条，保持文件可读。
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name).add(scope);
  }
  const result = [];
  for (const [name, scopes] of seen) {
    for (const scope of scopes) result.push({ name, scope });
  }
  return result;
}

function diffEntries(prev, next) {
  const granted = [];
  const revoked = [];
  const scopeUpdated = [];
  for (const [name, scopes] of next) {
    const before = prev.get(name);
    if (!before) {
      for (const scope of scopes) granted.push(entryName(name, scope));
      continue;
    }
    for (const scope of scopes) {
      if (!before.has(scope)) scopeUpdated.push(entryName(name, scope));
    }
    for (const scope of before) {
      if (!scopes.has(scope)) scopeUpdated.push(entryName(name, scope));
    }
  }
  for (const [name, scopes] of prev) {
    if (next.has(name)) continue;
    for (const scope of scopes) revoked.push(entryName(name, scope));
  }
  return { granted, revoked, scopeUpdated };
}

function atomicWrite(document) {
  const target = grants.policyPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const payload = `${JSON.stringify(document, null, 2)}\n`;
  try {
    fs.writeFileSync(tmp, payload, { mode: 0o600 });
    fs.renameSync(tmp, target);
    try { fs.chmodSync(target, 0o600); } catch { /* Windows */ }
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* 已替换或不存在 */ }
    throw new ToolboxError('POLICY_WRITE_FAILED', '权限策略写入失败', 500);
  }
}

/**
 * 覆盖某个插件的完整授权集合。
 * @param {string} rawId
 * @param {{permissions?: Array, ifVersion?: string}} input
 */
async function updatePermissions(rawId, input = {}) {
  const id = toolIdOf(rawId);
  const db = dbSingleton.db;
  const tool = toolboxRepo.getTool(db, id);
  if (!tool) throw new ToolboxError('PLUGIN_NOT_FOUND', '插件未安装', 404);
  const descriptor = descriptorOf(db, id);

  const policy = grants.loadGrants();
  if (policy.state === 'broken') {
    throw new ToolboxError('POLICY_BROKEN', '权限策略已损坏，禁止写入；请先修复 grants.json', 409);
  }
  if (policy.state === 'last-good') {
    throw new ToolboxError(
      'POLICY_NOT_WRITABLE',
      'grants.json 当前不可读，正在使用历史快照；请先修复策略文件再修改权限',
      409,
    );
  }

  const requested = normalizeRequested(input.permissions, descriptor.permissions, id);
  const ifVersion = input.ifVersion === undefined || input.ifVersion === null
    ? '' : String(input.ifVersion);

  return serialized(() => {
    const currentVersion = policyVersion();
    if (ifVersion !== currentVersion) {
      const error = new ToolboxError('POLICY_VERSION_CONFLICT', '权限策略已被其他操作修改，请刷新后重试', 409);
      error.details = { current_version: currentVersion };
      throw error;
    }

    const before = currentEntries(grants.pluginGrantsFor(id), id);
    const next = new Map();
    for (const item of requested) {
      if (!next.has(item.name)) next.set(item.name, new Set());
      next.get(item.name).add(item.scope);
    }

    const raw = grants.readPolicyDocument();
    const tools = raw && raw.tools && typeof raw.tools === 'object' && !Array.isArray(raw.tools)
      ? raw.tools
      : {};
    const document = {
      version: grants.POLICY_VERSION,
      tools: {
        ...tools,
        // 空数组表示“已配置但全部拒绝”，不能因为清空而退回 Legacy 宽松模式。
        [id]: [...next.entries()].flatMap(([name, scopes]) => [...scopes].map((scope) => entryName(name, scope))),
      },
    };

    atomicWrite(document);
    grants.invalidateCache();
    const reloaded = grants.loadGrants();
    if (reloaded.state !== 'ok') {
      // 写出的文件无法解析属于严重异常：保留原文件已被替换的事实，返回明确错误。
      throw new ToolboxError('POLICY_WRITE_FAILED', '权限策略写入后校验失败，请检查 grants.json', 500);
    }

    const diff = diffEntries(before, next);
    const changedFields = [...diff.granted, ...diff.revoked, ...diff.scopeUpdated];
    const version = policyVersion();
    return {
      ok: true,
      version,
      policy_state: reloaded.state,
      changed: {
        granted: diff.granted,
        revoked: diff.revoked,
        scope_updated: diff.scopeUpdated,
        total: changedFields.length,
      },
    };
  }).then(async (result) => {
    // 审计放到写入成功之后；失败也在上层捕获后记录。
    if (result.changed.granted.length) {
      await audit.record({
        action: 'permission.grant', tool_id: id, result: 'success',
        detail: { changed_fields: result.changed.granted.slice(0, 20) },
      });
    }
    if (result.changed.revoked.length) {
      await audit.record({
        action: 'permission.revoke', tool_id: id, result: 'success',
        detail: { changed_fields: result.changed.revoked.slice(0, 20) },
      });
    }
    if (result.changed.scope_updated.length) {
      await audit.record({
        action: 'permission.scope.update', tool_id: id, result: 'success',
        detail: { changed_fields: result.changed.scope_updated.slice(0, 20) },
      });
    }
    return result;
  });
}

async function recordFailure(id, action, code) {
  if (!TOOL_ID_RE.test(String(id || ''))) return;
  await audit.record({ action, tool_id: id, result: 'error', error_code: code || 'UNKNOWN' });
}

module.exports = {
  catalog,
  policyVersion,
  updatePermissions,
  recordFailure,
  normalizeRequested,
  PERMISSION_META,
  MAX_PERMISSIONS,
};
