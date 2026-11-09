/* ============================================================
 * 旧插件权限策略（state/grants.json）
 *
 * 格式：
 *   { "version": 1, "tools": { "zlibrary": ["books.read:library:*", "jobs.create"] } }
 *
 * 未出现在 tools 里的插件保持旧行为（兼容）；一旦为某工具配置数组，
 * 该工具立即进入严格模式：未列出的权限/scope 一律拒绝。
 * 文件缺失或损坏时不启用任何裁剪，避免升级即断插件。
 * ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const { TOOLBOX_DIR } = require('../paths');
const { PLUGIN_ID_RE } = require('../plugins/registry');
const { GrantStore } = require('../plugins/permissions');

let cache = { mtimeMs: -1, configured: new Set(), store: new GrantStore() };

function policyPath() {
  return path.join(TOOLBOX_DIR, 'state', 'grants.json');
}

function parseEntry(entry) {
  const text = String(entry || '').trim();
  if (!text) return null;
  const index = text.indexOf(':');
  if (index === -1) return { permission: text, scope: '*' };
  return { permission: text.slice(0, index), scope: text.slice(index + 1) || '*' };
}

function loadGrants() {
  let stat;
  try {
    stat = fs.statSync(policyPath());
  } catch {
    cache = { mtimeMs: -1, configured: new Set(), store: new GrantStore() };
    return cache;
  }
  if (stat.mtimeMs === cache.mtimeMs) return cache;

  const store = new GrantStore();
  const configured = new Set();
  let document = null;
  try {
    document = JSON.parse(fs.readFileSync(policyPath(), 'utf8'));
  } catch (err) {
    console.warn('[plugin-grants] grants.json 解析失败，暂不启用权限裁剪:', err.message);
  }

  const tools = document && document.tools && typeof document.tools === 'object' ? document.tools : {};
  for (const [toolId, entries] of Object.entries(tools)) {
    if (!PLUGIN_ID_RE.test(toolId) || !Array.isArray(entries)) continue;
    configured.add(toolId);
    for (const entry of entries) {
      const parsed = parseEntry(entry);
      if (!parsed) continue;
      try {
        store.grant(toolId, parsed.permission, parsed.scope);
      } catch (err) {
        console.warn(`[plugin-grants] 忽略非法授权 ${toolId}: ${entry} (${err.code || err.message})`);
      }
    }
  }

  cache = { mtimeMs: stat.mtimeMs, configured, store };
  return cache;
}

function pluginGrantsFor(toolId) {
  const { configured, store } = loadGrants();
  if (!configured.has(toolId)) return Object.freeze({ configured: false, store: null });
  return Object.freeze({ configured: true, store });
}

module.exports = { policyPath, loadGrants, pluginGrantsFor };
