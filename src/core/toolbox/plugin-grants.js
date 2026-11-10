/* ============================================================
 * 旧插件权限策略（state/grants.json）
 *
 * 格式：
 *   { "version": 1, "tools": { "zlibrary": ["books.read:library:*", "jobs.create"] } }
 *
 * 策略状态含义（security 关键）：
 *   · absent   策略文件不存在 —— 明确标记为 Legacy 兼容模式，保留旧行为；
 *   · ok       解析成功 —— 按配置严格裁剪；同时把可信快照写入
 *              state/grants.last-good.json，供文件损坏后恢复；
 *   · last-good 策略文件损坏/不可读，但存在最近一次有效快照 —— 继续用快照，
 *              绝不因此放宽权限；
 *   · broken   策略文件存在但损坏，且没有可信快照 —— 全局拒绝（fail-closed），
 *              不再退回“未配置”的宽松状态。
 *
 * 只要某个工具曾被配置过（出现在有效策略或快照里），它就是严格模式：
 * 未列出的权限/scope 一律拒绝。进程重启后同样按磁盘状态重建，不依赖内存缓存。
 * ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { TOOLBOX_DIR } = require('../paths');
const { PLUGIN_ID_RE } = require('../plugins/registry');
const { GrantStore } = require('../plugins/permissions');

const POLICY_VERSION = 1;
const MAX_ENTRIES = 200;

let cache = {
  mtimeMs: -1,
  size: -1,
  state: 'absent',
  configured: new Set(),
  store: new GrantStore(),
};
let lastGoodHash = '';

function policyPath() {
  return path.join(TOOLBOX_DIR, 'state', 'grants.json');
}

function lastGoodPath() {
  return path.join(TOOLBOX_DIR, 'state', 'grants.last-good.json');
}

function emptyPolicy(state) {
  return { mtimeMs: -1, size: -1, state, configured: new Set(), store: new GrantStore() };
}

function parseEntry(entry) {
  const text = String(entry || '').trim();
  if (!text) return null;
  const index = text.indexOf(':');
  if (index === -1) return { permission: text, scope: '*' };
  return { permission: text.slice(0, index), scope: text.slice(index + 1) || '*' };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// 只接受已知结构；非法字段不会让整份策略降级，但会跳过该条目。
function buildPolicy(document) {
  if (!isPlainObject(document) || document.version !== POLICY_VERSION) return null;
  if (!isPlainObject(document.tools)) return null;

  const store = new GrantStore();
  const configured = new Set();
  const entries = Object.entries(document.tools);
  if (entries.length > MAX_ENTRIES) return null;

  for (const [toolId, grants] of entries) {
    if (!PLUGIN_ID_RE.test(toolId)) continue;
    // 只要出现合法插件 ID，就视为“该插件已被配置”，必须进入严格模式。
    // 授权值类型错误（例如写成字符串而不是数组）不能让插件退回宽松兼容。
    configured.add(toolId);
    if (!Array.isArray(grants)) {
      console.warn(`[plugin-grants] ${toolId} 的授权必须是数组，已按拒绝全部权限处理`);
      continue;
    }
    for (const entry of grants.slice(0, MAX_ENTRIES)) {
      const parsed = parseEntry(entry);
      if (!parsed) continue;
      try {
        store.grant(toolId, parsed.permission, parsed.scope);
      } catch (err) {
        console.warn(`[plugin-grants] 忽略非法授权 ${toolId}: ${entry} (${err.code || err.message})`);
      }
    }
  }
  return { configured, store };
}

function writeLastGood(document) {
  const payload = JSON.stringify({ version: POLICY_VERSION, tools: document.tools });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  if (hash === lastGoodHash) return;
  try {
    const target = lastGoodPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, payload + '\n', { mode: 0o600 });
    fs.renameSync(tmp, target);
    try { fs.chmodSync(target, 0o600); } catch { /* Windows */ }
    lastGoodHash = hash;
  } catch (err) {
    console.warn('[plugin-grants] 无法写入权限快照:', err.message);
  }
}

function readLastGood() {
  try {
    const document = JSON.parse(fs.readFileSync(lastGoodPath(), 'utf8'));
    const built = buildPolicy(document);
    if (built) return built;
  } catch { /* 快照也不可用 */ }
  return null;
}

function loadGrants() {
  const target = policyPath();
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    // 文件确实不存在：新安装或管理员主动移除。
    // 但如果曾经写入过可信快照，说明历史上有严格策略，不能悄悄回到宽松模式。
    if (err && err.code === 'ENOENT') {
      const snapshot = readLastGood();
      if (snapshot) {
        console.error('[plugin-grants] grants.json 缺失，但存在历史策略快照，继续按快照执行');
        cache = { mtimeMs: -1, size: -1, state: 'last-good', ...snapshot };
        return cache;
      }
      cache = emptyPolicy('absent');
      return cache;
    }
    // 存在但无法 stat（权限/IO 问题）：按损坏处理，绝不当作“未配置”。
    console.error('[plugin-grants] grants.json 无法读取，按损坏策略处理:', err && err.message);
    const snapshot = readLastGood();
    cache = snapshot
      ? { mtimeMs: -1, size: -1, state: 'last-good', ...snapshot }
      : { mtimeMs: -1, size: -1, state: 'broken', configured: new Set(), store: new GrantStore() };
    return cache;
  }
  if (stat.mtimeMs === cache.mtimeMs && stat.size === cache.size) return cache;

  let document = null;
  let unreadable = '';
  try {
    document = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (err) {
    unreadable = err.message;
  }

  const built = unreadable ? null : buildPolicy(document);
  if (built) {
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, state: 'ok', ...built };
    writeLastGood(document);
    return cache;
  }

  console.error(`[plugin-grants] grants.json 无效，不回退到宽松权限：${unreadable || '结构不合法'}`);
  const snapshot = readLastGood();
  if (snapshot) {
    console.error('[plugin-grants] 使用最近一次有效权限快照 grants.last-good.json');
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, state: 'last-good', ...snapshot };
    return cache;
  }

  // 没有任何可信策略可用：全局 fail-closed（configured=true + 空 store → 所有敏感操作 403）。
  cache = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    state: 'broken',
    configured: new Set(),
    store: new GrantStore(),
  };
  return cache;
}

function pluginGrantsFor(toolId) {
  const policy = loadGrants();
  if (policy.state === 'absent') {
    return Object.freeze({ state: 'absent', configured: false, store: null });
  }
  if (policy.state === 'broken') {
    // 没有可信策略：任何工具都按严格模式拒绝。
    return Object.freeze({ state: 'broken', configured: true, store: policy.store });
  }
  if (!policy.configured.has(toolId)) {
    return Object.freeze({ state: policy.state, configured: false, store: null });
  }
  return Object.freeze({ state: policy.state, configured: true, store: policy.store });
}

// 仅供测试/诊断：不暴露可变 store。
function policyState() {
  return loadGrants().state;
}

// 管理端原子写入后立即失效缓存，保证下一次内部调用读到新策略。
function invalidateCache() {
  cache = { mtimeMs: -1, size: -1, state: cache.state, configured: new Set(), store: new GrantStore() };
}

// 管理端写入前读取原始文档；结构不合法或不可读时返回 null。
function readPolicyDocument() {
  try {
    return JSON.parse(fs.readFileSync(policyPath(), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  POLICY_VERSION,
  policyPath,
  lastGoodPath,
  loadGrants,
  pluginGrantsFor,
  policyState,
  invalidateCache,
  readPolicyDocument,
};
