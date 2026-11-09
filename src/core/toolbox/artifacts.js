/* ============================================================
 * 插件产物（Artifact）发布与读取
 *
 * 约束：
 *   · 文件必须位于 <TOOLBOX_DIR>/data/<toolId>/ 内，拒绝符号链接/穿越/跨插件；
 *   · 只登记书名库支持的电子书格式，大小上限与入库一致（80MB）；
 *   · 数据库只存相对路径，任何响应都不返回宿主绝对路径；
 *   · 任务归属与插件归属在发布/读取时双重校验。
 * ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { db: defaultDb } = require('../../db/index');
const toolboxRepo = require('../../db/toolbox');
const { validateEbookFile } = require('../ebook');
const { fileDigest } = require('../file-digest');
const { TOOLBOX_DIR } = require('../paths');
const { ToolboxError, assertInside } = require('./security');

const ARTIFACT_MAX_BYTES = 80 * 1024 * 1024;
const ARTIFACT_ID_RE = /^art_[a-f0-9]{32}$/;
const REL_PATH_RE = /^[A-Za-z0-9._\-/]+$/;
const MIME_BY_FORMAT = {
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  MOBI: 'application/x-mobipocket-ebook',
  AZW3: 'application/vnd.amazon.ebook',
  TXT: 'text/plain',
};

function dataRoot() {
  return path.join(TOOLBOX_DIR, 'data');
}

function normalizeRelPath(value) {
  const rel = String(value || '');
  if (!rel || rel.length > 500 || rel.includes('\0') || rel.includes('\\')) {
    throw new ToolboxError('ARTIFACT_PATH_INVALID', '产物路径无效');
  }
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || /^[a-z][a-z0-9+.-]*:/i.test(rel)) {
    throw new ToolboxError('ARTIFACT_PATH_INVALID', '产物路径必须是插件目录内的相对路径');
  }
  if (!REL_PATH_RE.test(rel)) throw new ToolboxError('ARTIFACT_PATH_INVALID', '产物路径包含非法字符');
  const parts = rel.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new ToolboxError('ARTIFACT_PATH_INVALID', '产物路径不能包含空段或上级目录');
  }
  return rel;
}

async function resolveArtifactFile(toolId, rawPath) {
  const raw = String(rawPath || '');
  if (!raw) throw new ToolboxError('ARTIFACT_PATH_INVALID', '缺少产物路径');

  const root = dataRoot();
  fs.mkdirSync(root, { recursive: true });
  const realRoot = await fs.promises.realpath(root);
  const toolRoot = path.join(realRoot, toolId);
  fs.mkdirSync(toolRoot, { recursive: true, mode: 0o2750 });
  const realToolRoot = await fs.promises.realpath(toolRoot);

  let candidate;
  if (path.isAbsolute(raw)) {
    candidate = raw;
  } else {
    candidate = path.join(realToolRoot, normalizeRelPath(raw));
  }

  let lstat;
  try {
    lstat = await fs.promises.lstat(candidate);
  } catch {
    throw new ToolboxError('ARTIFACT_PATH_INVALID', '产物文件不存在');
  }
  if (lstat.isSymbolicLink()) throw new ToolboxError('ARTIFACT_PATH_INVALID', '产物不能是符号链接');
  const real = await fs.promises.realpath(candidate);
  assertInside(realToolRoot, real, 'ARTIFACT_PATH_INVALID');
  const stat = await fs.promises.stat(real);
  if (!stat.isFile()) throw new ToolboxError('ARTIFACT_PATH_INVALID', '产物不是普通文件');
  return { real, size: stat.size };
}

function artifactDto(row) {
  if (!row) return null;
  return {
    artifact_id: row.artifact_id,
    tool_id: row.tool_id,
    task_id: row.task_id == null ? null : Number(row.task_id),
    format: row.format,
    mime: row.mime,
    size: Number(row.size) || 0,
    sha256: row.sha256,
    title: row.title,
    status: row.status,
    created_at: row.created_at,
  };
}

async function publishArtifact({
  toolId,
  taskId = null,
  path: filePath,
  format = '',
  title = '',
  sha256 = '',
  maxBytes = ARTIFACT_MAX_BYTES,
  handleDb = defaultDb,
} = {}) {
  const owner = String(toolId || '');
  if (!owner) throw new ToolboxError('TOOL_ID_REQUIRED', '缺少 tool_id');

  let boundTaskId = null;
  if (taskId != null && taskId !== '') {
    const id = Number(taskId);
    if (!Number.isSafeInteger(id) || id < 1) throw new ToolboxError('TASK_INVALID', '任务 ID 不合法');
    const task = toolboxRepo.getTask(handleDb, id);
    if (!task) throw new ToolboxError('TASK_NOT_FOUND', '任务不存在', 404);
    if (task.tool_id !== owner) throw new ToolboxError('TASK_TOOL_MISMATCH', '任务不属于该插件', 403);
    boundTaskId = id;
  }

  const resolved = await resolveArtifactFile(owner, filePath);
  const limit = Math.max(1, Math.min(Number(maxBytes) || ARTIFACT_MAX_BYTES, ARTIFACT_MAX_BYTES));
  if (resolved.size > limit) {
    throw new ToolboxError('ARTIFACT_TOO_LARGE', `产物超过大小上限（${limit} 字节）`);
  }

  const check = validateEbookFile(path.basename(resolved.real), resolved.size);
  if (!check.ok) throw new ToolboxError('ARTIFACT_FORMAT', check.error || '产物格式不受支持');
  const detected = String(check.format || '').toUpperCase();
  const declared = String(format || '').trim().toUpperCase();
  if (declared && declared !== detected) {
    throw new ToolboxError('ARTIFACT_FORMAT', '声明的格式与文件扩展名不一致');
  }

  const digest = await fileDigest(resolved.real);
  const expected = String(sha256 || '').trim().toLowerCase();
  if (expected && expected !== digest.sha256) {
    throw new ToolboxError('ARTIFACT_SHA_MISMATCH', '产物 SHA-256 校验失败');
  }

  const realRoot = await fs.promises.realpath(dataRoot());
  const relPath = path.relative(realRoot, resolved.real).split(path.sep).join('/');
  const artifactId = `art_${crypto.randomBytes(16).toString('hex')}`;
  const row = toolboxRepo.insertArtifact(handleDb, {
    artifact_id: artifactId,
    tool_id: owner,
    task_id: boundTaskId,
    format: detected,
    mime: MIME_BY_FORMAT[detected] || 'application/octet-stream',
    size: digest.size == null ? resolved.size : digest.size,
    sha256: digest.sha256,
    title: String(title || '').trim().slice(0, 200),
    rel_path: relPath,
  });
  return artifactDto(row);
}

function getArtifact({ toolId, artifactId, handleDb = defaultDb } = {}) {
  const id = String(artifactId || '');
  if (!ARTIFACT_ID_RE.test(id)) throw new ToolboxError('ARTIFACT_NOT_FOUND', '产物不存在', 404);
  const row = toolboxRepo.getArtifactByPublicId(handleDb, id);
  if (!row) throw new ToolboxError('ARTIFACT_NOT_FOUND', '产物不存在', 404);
  if (String(row.tool_id) !== String(toolId || '')) {
    throw new ToolboxError('ARTIFACT_TOOL_MISMATCH', '产物不属于该插件', 403);
  }
  return artifactDto(row);
}

function listTaskArtifacts({ toolId, taskId, handleDb = defaultDb } = {}) {
  return toolboxRepo.listArtifactsForTask(handleDb, taskId)
    .filter((row) => String(row.tool_id) === String(toolId || ''))
    .map(artifactDto);
}

module.exports = {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_ID_RE,
  publishArtifact,
  getArtifact,
  listTaskArtifacts,
  artifactDto,
};
