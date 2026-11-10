/* ============================================================
 * 插件管理审计（追加式 JSONL）
 *
 * 只记录“谁对哪个插件做了什么”，不记录配置值、Cookie、令牌与绝对路径。
 * 写入串行化，避免并发安装/启停把 JSON 行交错；超过 1MB 轮转，
 * 最多保留 3 份历史文件。
 * ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const { TOOLBOX_DIR, STORAGE_ROOT } = require('../paths');

const MAX_LINE_BYTES = 8 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const KEEP_FILES = 3;
const MAX_LIMIT = 200;
const ACTIONS = /^[a-z][a-z0-9_.]{0,63}$/;
const TOOL_ID = /^[a-z0-9_]{1,64}$/;
const RESULTS = new Set(['success', 'error', 'denied']);
const SENSITIVE_KEY = /token|secret|password|passwd|cookie|authorization|credential|api[_-]?key/i;

let writeQueue = Promise.resolve();

function auditDir() {
  return path.join(TOOLBOX_DIR, 'state');
}

function auditPath() {
  return path.join(auditDir(), 'audit.jsonl');
}

function rotatedPath(index) {
  return path.join(auditDir(), `audit.${index}.jsonl`);
}

function isoNow() {
  return new Date().toISOString();
}

function cleanText(value, max = 1000) {
  let text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text) return '';
  // 已知根目录与 Windows 盘符路径必须脱敏；URL 不受影响。
  text = text.split(TOOLBOX_DIR).join('[path]').split(STORAGE_ROOT).join('[path]');
  text = text.replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '[path]');
  return text.slice(0, max);
}

function cleanDetail(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const result = {};
  for (const key of Object.keys(detail).slice(0, 20)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = '[redacted]';
      continue;
    }
    const value = detail[key];
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      result[key] = value;
    } else if (typeof value === 'string') {
      result[key] = cleanText(value, 300);
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, 20).map((item) => cleanText(item, 120));
    }
  }
  return result;
}

function normalizeEvent(event = {}) {
  const action = String(event.action || '').trim();
  if (!ACTIONS.test(action)) throw new Error('审计动作不合法');
  const toolId = String(event.tool_id || '').trim();
  if (toolId && !TOOL_ID.test(toolId)) throw new Error('审计插件 ID 不合法');
  const result = String(event.result || 'success');
  if (!RESULTS.has(result)) throw new Error('审计结果不合法');
  return {
    ts: isoNow(),
    actor: 'admin',
    action,
    tool_id: toolId || null,
    result,
    error_code: event.error_code ? cleanText(event.error_code, 64) : null,
    detail: cleanDetail(event.detail),
  };
}

function encodeLine(payload) {
  let line = JSON.stringify(payload);
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    payload.detail = {};
    payload.error_code = payload.error_code ? payload.error_code.slice(0, 64) : null;
    line = JSON.stringify(payload);
  }
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    // 极端情况：动作/ID 本身超长已被校验挡住，这里只保留最小结构。
    line = JSON.stringify({ ...payload, detail: {}, error_code: null });
  }
  return line + '\n';
}

async function rotateIfNeeded(incomingBytes) {
  const target = auditPath();
  let size = 0;
  try {
    size = (await fs.promises.stat(target)).size;
  } catch {
    return;
  }
  if (size + incomingBytes <= MAX_FILE_BYTES) return;
  try { await fs.promises.unlink(rotatedPath(KEEP_FILES)); } catch { /* 不存在 */ }
  for (let index = KEEP_FILES - 1; index >= 1; index -= 1) {
    try {
      await fs.promises.rename(rotatedPath(index), rotatedPath(index + 1));
    } catch { /* 该份不存在 */ }
  }
  try { await fs.promises.rename(target, rotatedPath(1)); } catch { /* 竞争失败视为无需轮转 */ }
}

async function appendLine(line) {
  await fs.promises.mkdir(auditDir(), { recursive: true });
  const payload = Buffer.from(line, 'utf8');
  await rotateIfNeeded(payload.length);
  await fs.promises.appendFile(auditPath(), payload, { mode: 0o600 });
  try { await fs.promises.chmod(auditPath(), 0o600); } catch { /* Windows */ }
}

/**
 * 追加一条审计事件。写入失败只告警，不影响主操作。
 * @returns {Promise<boolean>}
 */
function record(event = {}) {
  let payload;
  let line;
  try {
    payload = normalizeEvent(event);
    line = encodeLine(payload);
  } catch (err) {
    console.warn('[plugin-audit] 忽略非法审计事件:', err.message);
    return Promise.resolve(false);
  }
  writeQueue = writeQueue.then(
    () => appendLine(line).then(() => true).catch((err) => {
      console.warn('[plugin-audit] 写入失败:', err.message);
      return false;
    }),
    () => appendLine(line).then(() => true).catch(() => false),
  );
  return writeQueue;
}

function parseLines(text, { toolId = '', before = '' } = {}) {
  const entries = [];
  let skipped = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!item || typeof item !== 'object' || typeof item.ts !== 'string') {
      skipped += 1;
      continue;
    }
    if (toolId && item.tool_id !== toolId) continue;
    if (before && item.ts >= before) continue;
    entries.push({
      at: item.ts,
      actor: 'admin',
      action: cleanText(item.action, 64),
      tool_id: TOOL_ID.test(String(item.tool_id || '')) ? item.tool_id : null,
      result: RESULTS.has(item.result) ? item.result : 'success',
      error_code: item.error_code ? cleanText(item.error_code, 64) : null,
      detail: cleanDetail(item.detail),
    });
  }
  // 文件按时间追加；返回时统一最新在前。
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { entries, skipped };
}

/**
 * 分页读取审计日志。只读当前文件；历史轮转文件保留给运维排查。
 */
async function list({ toolId = '', limit = 50, offset = 0, before = '' } = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 50, MAX_LIMIT));
  const skip = Math.max(0, Number(offset) || 0);
  let text = '';
  try {
    text = await fs.promises.readFile(auditPath(), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { entries: [], total: 0, limit: max, offset: skip, skipped: 0 };
    }
    throw new Error(`审计日志不可读：${err.message}`);
  }
  const parsed = parseLines(text, { toolId, before });
  return {
    entries: parsed.entries.slice(skip, skip + max),
    total: parsed.entries.length,
    limit: max,
    offset: skip,
    skipped: parsed.skipped,
  };
}

// 供诊断/测试：当前审计文件摘要（不返回内容）。
async function stat() {
  try {
    const info = await fs.promises.stat(auditPath());
    return { exists: true, size: info.size, path: auditPath() };
  } catch {
    return { exists: false, size: 0, path: auditPath() };
  }
}

module.exports = {
  auditDir, auditPath, rotatedPath, record, list, stat,
  MAX_LINE_BYTES, MAX_FILE_BYTES, KEEP_FILES,
};
