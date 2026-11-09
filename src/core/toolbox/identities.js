/* ============================================================
 * 插件身份令牌（Node ↔ Python 共享卷）
 *
 * state/identities.json 保存 tool_id → 随机令牌；Python runtime 读取后
 * 在内部请求里附带 X-Mybooks-Plugin-Id / X-Mybooks-Plugin-Token。
 * 令牌稳定性：文件存在时复用，Node 重启不会更换。
 *
 * 注意：共享 Python 进程仍不是强隔离，令牌先用于归属校验与协议过渡，
 * 不能宣称已经阻止恶意插件读取其他插件的内存/文件。
 * ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { TOOLBOX_DIR } = require('../paths');
const { TOOL_ID_RE } = require('./manifest');

const TOKEN_RE = /^[a-f0-9]{48}$/;
let cache = { mtimeMs: -1, tokens: {} };

function identitiesPath() {
  return path.join(TOOLBOX_DIR, 'state', 'identities.json');
}

function sanitizeTokens(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [toolId, token] of Object.entries(raw)) {
    if (TOOL_ID_RE.test(toolId) && TOKEN_RE.test(String(token))) out[toolId] = String(token);
  }
  return out;
}

function loadIdentityTokens() {
  try {
    const stat = fs.statSync(identitiesPath());
    if (stat.mtimeMs === cache.mtimeMs) return cache.tokens;
    const doc = JSON.parse(fs.readFileSync(identitiesPath(), 'utf8'));
    cache = { mtimeMs: stat.mtimeMs, tokens: sanitizeTokens(doc && doc.tokens) };
    return cache.tokens;
  } catch {
    cache = { mtimeMs: -1, tokens: {} };
    return cache.tokens;
  }
}

function writeIdentityTokens(tokens) {
  const target = identitiesPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const payload = {
    version: 1,
    generated_at: new Date().toISOString(),
    tokens,
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
  try { fs.chmodSync(target, 0o600); } catch { /* Windows */ }
  return tokens;
}

// 与 writeRuntimeState 同步调用：新工具发令牌，卸载工具的令牌消失。
function ensureIdentityTokens(tools) {
  const existing = loadIdentityTokens();
  const next = {};
  for (const tool of Array.isArray(tools) ? tools : []) {
    const toolId = String(tool && tool.tool_id || '');
    if (!TOOL_ID_RE.test(toolId)) continue;
    next[toolId] = TOKEN_RE.test(String(existing[toolId] || ''))
      ? existing[toolId]
      : crypto.randomBytes(24).toString('hex');
  }
  writeIdentityTokens(next);
  cache = { mtimeMs: fs.statSync(identitiesPath()).mtimeMs, tokens: next };
  return next;
}

function verifyIdentity(toolId, token) {
  if (typeof toolId !== 'string' || !TOOL_ID_RE.test(toolId)) return false;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
  const expected = loadIdentityTokens()[toolId];
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  identitiesPath,
  ensureIdentityTokens,
  loadIdentityTokens,
  verifyIdentity,
};
