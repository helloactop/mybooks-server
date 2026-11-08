/* ============================================================
 * 工具商店客户端（mybooks.top/toolbox/fulllist.json）
 *
 * 只负责取索引、校验条目、下载并校验 SHA-256。
 * 是否可安装由 allowlist + 兼容性 + ZIP 格式共同决定。
 * ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { TOOLBOX_DIR } = require('../paths');
const { ToolboxError, fetchToFile, sha256File } = require('./security');
const { TOOL_ID_RE, compareSemver, assessCompatibility } = require('./manifest');
const { getReview, shaMatches, allowUnreviewed } = require('./allowlist');

const STORE_URL = process.env.MYBOOKS_TOOLBOX_STORE_URL
  || 'https://mybooks.top/toolbox/fulllist.json';
const STORE_HOSTS = (process.env.MYBOOKS_TOOLBOX_STORE_HOSTS || 'mybooks.top')
  .split(',').map((host) => host.trim()).filter(Boolean);
const INDEX_TTL_MS = 60 * 60 * 1000;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

let indexCache = { tools: [], fetchedAt: 0, error: '' };
let indexPromise = null;

function text(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const toolId = text(raw.tool_id, 64);
  if (!TOOL_ID_RE.test(toolId)) return null;
  const revision = text(raw.latest_revision, 32);
  const downloadUrl = text(raw.download_url, 1000);
  const sha256 = text(raw.sha256, 64).toLowerCase();
  if (!revision || !/^\d+\.\d+\.\d+$/.test(revision)) return null;
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;

  let url = null;
  try {
    url = new URL(downloadUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !STORE_HOSTS.includes(url.hostname.toLowerCase())) return null;

  const extension = path.extname(url.pathname).toLowerCase();
  const declaredKind = extension === '.7z' ? '7z' : extension === '.zip' ? 'zip' : 'unknown';
  const review = getReview(toolId, revision);
  const reviewed = !!review && shaMatches(review, sha256);
  const compatibility = assessCompatibility({
    core_api_version: text(raw.core_api_version, 16) || '0.0.0',
  }, { reviewed, runtime: 'python', allowUnreviewed: allowUnreviewed() });
  if (declaredKind === 'unknown') {
    compatibility.supported = false;
    compatibility.reasons.push({ code: 'ARCHIVE_UNKNOWN', message: '未知安装包格式' });
  }

  return {
    tool_id: toolId,
    name: text(raw.name, 120) || toolId,
    description: text(raw.description, 2000),
    author: text(raw.author, 120),
    publish_date: text(raw.publish_date, 40),
    latest_revision: revision,
    core_api_version: text(raw.core_api_version, 16),
    repo_url: text(raw.repo_url, 500),
    icon_url: (() => {
      try {
        const icon = new URL(text(raw.icon_url, 1000));
        return icon.protocol === 'https:' && STORE_HOSTS.includes(icon.hostname.toLowerCase())
          ? icon.toString() : '';
      } catch { return ''; }
    })(),
    download_url: downloadUrl,
    sha256,
    archive_kind: declaredKind,
    reviewed,
    review: review ? { reviewed_at: review.reviewed_at, notes: review.notes, limitations: review.limitations } : null,
    compatibility,
  };
}

async function fetchIndex() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(STORE_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'MyBooks-Client': 'MyBooks-Toolbox/1' },
    });
    if (!response.ok) throw new ToolboxError('STORE_HTTP', `商店返回 HTTP ${response.status}`, 502);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_INDEX_BYTES) throw new ToolboxError('STORE_TOO_LARGE', '商店索引过大', 502);
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_INDEX_BYTES) {
      throw new ToolboxError('STORE_TOO_LARGE', '商店索引过大', 502);
    }
    const parsed = JSON.parse(raw);
    const list = parsed && Array.isArray(parsed.tools) ? parsed.tools : [];
    const tools = list.map(normalizeEntry).filter(Boolean);
    return { tools, error: '' };
  } catch (err) {
    if (err instanceof ToolboxError) throw err;
    if (err && err.name === 'AbortError') throw new ToolboxError('STORE_TIMEOUT', '获取工具商店超时', 504);
    throw new ToolboxError('STORE_INVALID', '工具商店索引不是合法 JSON', 502);
  } finally {
    clearTimeout(timer);
  }
}

async function getIndex({ force = false } = {}) {
  const now = Date.now();
  if (!force && indexCache.tools.length && now - indexCache.fetchedAt < INDEX_TTL_MS) {
    return { ...indexCache, cached: true };
  }
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      const result = await fetchIndex();
      indexCache = { ...result, fetchedAt: Date.now() };
      return { ...indexCache, cached: false };
    } catch (err) {
      indexCache = { ...indexCache, error: err.message || '商店不可用', fetchedAt: Date.now() };
      return { ...indexCache, cached: false, failed: true };
    } finally {
      indexPromise = null;
    }
  })();
  return indexPromise;
}

function annotate(tools, installedTools = []) {
  const installed = new Map(installedTools.map((tool) => [tool.tool_id, tool]));
  return tools.map((entry) => {
    const current = installed.get(entry.tool_id) || null;
    const updateAvailable = !!current && compareSemver(entry.latest_revision, current.revision) > 0;
    return {
      ...entry,
      installed: current ? {
        revision: current.revision,
        enabled: current.enabled,
        installed_at: current.installed_at,
        update_available: updateAvailable,
      } : null,
      installable: entry.compatibility.supported && (!current || updateAvailable),
      blocked_reasons: entry.compatibility.reasons,
    };
  });
}

async function findEntry(toolId, revision = '') {
  const index = await getIndex();
  const entry = index.tools.find((item) => item.tool_id === toolId);
  if (!entry) throw new ToolboxError('STORE_NOT_FOUND', '商店中没有这个工具', 404);
  if (revision && entry.latest_revision !== revision) {
    throw new ToolboxError('STORE_REVISION_MISMATCH', '商店版本已变化，请刷新后重试', 409);
  }
  if (!entry.compatibility.supported) {
    const reason = entry.compatibility.reasons[0];
    throw new ToolboxError(reason.code, reason.message, 409);
  }
  return entry;
}

async function downloadArchive(entry) {
  const downloads = path.join(TOOLBOX_DIR, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const suffix = entry.archive_kind === '7z' ? '.7z' : '.zip';
  const target = path.join(downloads, `${entry.tool_id}-${entry.latest_revision}-${crypto.randomBytes(4).toString('hex')}${suffix}`);
  try {
    const result = await fetchToFile(entry.download_url, target, {
      allowedHosts: STORE_HOSTS,
      maxBytes: MAX_ARCHIVE_BYTES,
      timeoutMs: 90_000,
      allowPrivateHosts: process.env.MYBOOKS_TOOLBOX_ALLOW_PRIVATE_STORE === 'true',
    });
    if (result.sha256.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new ToolboxError('STORE_SHA_MISMATCH', '安装包 SHA-256 校验失败，已拒绝安装', 409);
    }
    const actual = await sha256File(target);
    if (actual.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new ToolboxError('STORE_SHA_MISMATCH', '安装包 SHA-256 校验失败，已拒绝安装', 409);
    }
    return { path: target, sha256: actual, size: result.size };
  } catch (err) {
    try { fs.unlinkSync(target); } catch { /* 未创建或已删除 */ }
    throw err;
  }
}

function clearCache() {
  indexCache = { tools: [], fetchedAt: 0, error: '' };
}

module.exports = {
  STORE_URL,
  STORE_HOSTS,
  getIndex,
  annotate,
  findEntry,
  downloadArchive,
  clearCache,
};
