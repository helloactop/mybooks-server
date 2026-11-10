/* ============================================================
 * 插件安装/更新/回滚/卸载
 *
 * 文件系统与 SQLite 分开看：
 *   · 安装包先在 plugins/.staging-* 解压校验，再原子 rename 到目标目录；
 *   · 更新时先把旧目录移到 plugins/.previous/<id>，DB 写失败会回滚目录；
 *   · 任何失败都不会把“半成品目录”留在安装位。
 * ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const { db: defaultDb } = require('../../db/index');
const toolboxRepo = require('../../db/toolbox');
const { TOOLBOX_DIR } = require('../paths');
const { ToolboxError, assertInside, sha256File } = require('./security');
const { assessCompatibility } = require('./manifest');
const {
  normalizeManifest, assessDependencies,
} = require('./manifest-v1');
const { getReview, shaMatches, allowUnreviewed } = require('./allowlist');
const { extractArchive } = require('./zip');
const store = require('./store');
const { ensureToolboxDirs, writeRuntimeState, reloadRuntime, runtimeSecret, internalSecret } = require('./runtime');

const PLUGINS_DIR = path.join(TOOLBOX_DIR, 'plugins');
const PREVIOUS_DIR = path.join(PLUGINS_DIR, '.previous');
const STAGING_PREFIX = '.staging-';

function pluginDir(toolId) {
  return assertInside(PLUGINS_DIR, path.join(PLUGINS_DIR, toolId), 'INSTALL_PATH_INVALID');
}

function previousDir(toolId) {
  return assertInside(PREVIOUS_DIR, path.join(PREVIOUS_DIR, toolId), 'INSTALL_PATH_INVALID');
}

function relativeInstallPath(toolId) {
  return path.posix.join('plugins', toolId);
}

function ensurePackageFile(pluginDirPath, relativePath, message) {
  const target = assertInside(
    pluginDirPath,
    path.join(pluginDirPath, ...relativePath.split('/')),
    'MANIFEST_INVALID',
  );
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new ToolboxError('MANIFEST_INVALID', message);
  }
}

function ensurePluginManifest(pluginDirPath, expectedToolId = '', { enforceMode = true } = {}) {
  const manifestPath = path.join(pluginDirPath, 'manifest.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new ToolboxError('MANIFEST_INVALID', `插件包缺少可读的 manifest.json：${err.message}`);
  }
  // 安装路径按 MYBOOKS_PLUGIN_MANIFEST_V1 判定：off 时不接受 v1，也不会静默降级。
  const { manifest } = normalizeManifest(raw, { enforceMode });
  if (expectedToolId && manifest.tool_id !== expectedToolId) {
    throw new ToolboxError('MANIFEST_MISMATCH', `manifest.tool_id(${manifest.tool_id}) 与目标(${expectedToolId}) 不一致`);
  }
  const backendFile = path.join(pluginDirPath, 'backend', ...manifest.entry_backend.module.split('.')) + '.py';
  if (!fs.existsSync(backendFile) || !fs.statSync(backendFile).isFile()) {
    throw new ToolboxError('MANIFEST_INVALID', 'entry_backend 指向的后端模块不存在');
  }
  if (manifest.entry_frontend) {
    ensurePackageFile(
      pluginDirPath,
      `frontend/${manifest.entry_frontend}`,
      'entry_frontend 指向的前端入口不存在',
    );
  }
  // v1 可能声明多个页面入口，逐一确认存在；缺失即拒绝安装。
  const pages = (manifest.ui && manifest.ui.pages) || [];
  for (const page of pages) {
    if (!page.entry) continue;
    ensurePackageFile(pluginDirPath, page.entry, `ui.pages[${page.id}] 指向前端入口不存在`);
  }
  return manifest;
}

// required 依赖缺失即拒绝安装；optional 只提示。不自动安装依赖。
function assertDependencies(manifest, installedIds) {
  const result = assessDependencies(manifest, installedIds);
  if (result.reasons.length) {
    throw new ToolboxError(result.reasons[0].code, result.reasons[0].message, 409);
  }
  return result.warnings;
}

function compatibilityOf(manifest, archiveSha, { installedIds = null } = {}) {
  const review = getReview(manifest.tool_id, manifest.revision);
  const reviewed = !!review && shaMatches(review, archiveSha);
  const runtime = (manifest.runtime && manifest.runtime.type) || 'python';
  const assessed = assessCompatibility(manifest, {
    reviewed, runtime, allowUnreviewed: allowUnreviewed(),
  });
  const deps = assessDependencies(manifest, installedIds);
  if (deps.reasons.length) {
    assessed.supported = false;
    assessed.reasons.push(...deps.reasons);
  }
  assessed.warnings.push(...deps.warnings);
  for (const item of manifest.warnings || []) assessed.warnings.push(item);
  return assessed;
}

function cleanupStaging() {
  ensureToolboxDirs();
  for (const name of fs.readdirSync(PLUGINS_DIR)) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    const full = path.join(PLUGINS_DIR, name);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory() && Date.now() - stat.mtimeMs > 3600 * 1000) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

async function prepareStaging(archivePath, expectedToolId = '') {
  ensureToolboxDirs();
  fs.mkdirSync(PREVIOUS_DIR, { recursive: true });
  const staging = path.join(PLUGINS_DIR, `${STAGING_PREFIX}${expectedToolId || 'plugin'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await extractArchive(archivePath, staging);
    const manifest = ensurePluginManifest(staging, expectedToolId);
    return { staging, manifest };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

function installPrepared({ staging, manifest, archiveSha, source = 'store', handleDb = defaultDb }) {
  const toolId = manifest.tool_id;
  const installedIds = toolboxRepo.listTools(handleDb)
    .map((tool) => tool.tool_id)
    .filter((id) => id !== toolId);
  // 依赖门禁在改动文件系统之前执行，失败时安装位保持原状。
  assertDependencies(manifest, installedIds);
  const existing = toolboxRepo.getTool(handleDb, toolId);
  const target = pluginDir(toolId);
  if (fs.existsSync(target)) {
    if (!existing) {
      throw new ToolboxError('INSTALL_STATE_CONFLICT', `安装目录 plugins/${toolId} 已存在但数据库没有记录，请先人工确认`, 409);
    }
  }
  const previous = previousDir(toolId);
  let backupMoved = false;
  try {
    if (existing) {
      fs.rmSync(previous, { recursive: true, force: true });
      fs.mkdirSync(PREVIOUS_DIR, { recursive: true });
      if (fs.existsSync(target)) {
        fs.renameSync(target, previous);
        backupMoved = true;
      }
    }
    fs.renameSync(staging, target);
  } catch (err) {
    if (backupMoved && !fs.existsSync(target) && fs.existsSync(previous)) {
      try { fs.renameSync(previous, target); } catch { /* 保留原始错误 */ }
    }
    throw new ToolboxError('INSTALL_FAILED', `安装目录写入失败：${err.message}`, 500);
  }

  const compatibility = compatibilityOf(manifest, archiveSha, { installedIds });
  const now = new Date().toISOString();
  try {
    let record;
    if (existing) {
      record = toolboxRepo.updateTool(handleDb, toolId, {
        name: manifest.name,
        revision: manifest.revision,
        runtime: 'python',
        install_path: relativeInstallPath(toolId),
        sha256: archiveSha,
        source,
        compatibility,
        manifest,
        previous_path: backupMoved ? path.posix.join('plugins', '.previous', toolId) : '',
        previous_revision: backupMoved ? existing.revision : '',
        pending_restart: true,
        last_error: '',
      });
    } else {
      record = toolboxRepo.insertTool(handleDb, {
        tool_id: toolId,
        name: manifest.name,
        revision: manifest.revision,
        runtime: 'python',
        enabled: true,
        install_path: relativeInstallPath(toolId),
        sha256: archiveSha,
        source,
        compatibility,
        manifest,
        previous_path: '',
        previous_revision: '',
        installed_at: now,
        tool_type: 'tool',
        pending_restart: true,
        last_error: '',
      });
    }
    const state = writeRuntimeState(toolboxRepo.listTools(handleDb));
    // 上游生命周期：安装只落盘，不在安装请求里执行第三方 Python 代码。
    // 需要用户点击“重启插件运行时”后，Worker 的 load_all 才会加载。
    return { tool: record, state, runtime: { pending: true }, previous: backupMoved ? previous : null };
  } catch (err) {
    // DB/状态写失败：撤掉新目录，恢复旧版本
    try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
    if (backupMoved && fs.existsSync(previous)) {
      try { fs.renameSync(previous, target); } catch { /* ignore */ }
    }
    throw new ToolboxError('INSTALL_DB_FAILED', `安装记录写入失败：${err.message}`, 500);
  }
}

async function installFromStore(toolId, handleDb = defaultDb) {
  const existing = toolboxRepo.getTool(handleDb, toolId);
  if (existing) throw new ToolboxError('ALREADY_INSTALLED', '工具已安装，请使用更新', 409);
  const entry = await store.findEntry(toolId);
  const archive = await store.downloadArchive(entry);
  try {
    const prepared = await prepareStaging(archive.path, toolId);
    if (prepared.manifest.revision !== entry.latest_revision) {
      throw new ToolboxError('MANIFEST_MISMATCH', 'manifest 版本与商店索引不一致', 409);
    }
    return installPrepared({
      ...prepared,
      archiveSha: archive.sha256,
      source: 'store',
      handleDb,
    });
  } finally {
    try { fs.unlinkSync(archive.path); } catch { /* ignore */ }
  }
}

async function updateFromStore(toolId, handleDb = defaultDb) {
  const existing = toolboxRepo.getTool(handleDb, toolId);
  if (!existing) throw new ToolboxError('NOT_INSTALLED', '工具尚未安装', 404);
  const entry = await store.findEntry(toolId);
  const { compareSemver } = require('./manifest');
  if (compareSemver(entry.latest_revision, existing.revision) <= 0) {
    throw new ToolboxError('NO_UPDATE', '商店没有更新版本', 409);
  }
  const archive = await store.downloadArchive(entry);
  try {
    const prepared = await prepareStaging(archive.path, toolId);
    if (prepared.manifest.revision !== entry.latest_revision) {
      throw new ToolboxError('MANIFEST_MISMATCH', 'manifest 版本与商店索引不一致', 409);
    }
    return installPrepared({
      ...prepared,
      archiveSha: archive.sha256,
      source: 'store',
      handleDb,
    });
  } finally {
    try { fs.unlinkSync(archive.path); } catch { /* ignore */ }
  }
}

// 仅供本地开发/自动化测试：直接安装一个本地 ZIP（仍走完整校验）
async function installFromLocalArchive(archivePath, { expectedToolId = '', source = 'dev', handleDb = defaultDb } = {}) {
  const sha256 = await sha256File(archivePath);
  const prepared = await prepareStaging(archivePath, expectedToolId);
  const review = getReview(prepared.manifest.tool_id, prepared.manifest.revision);
  if ((!review || !shaMatches(review, sha256)) && !allowUnreviewed()) {
    throw new ToolboxError('REVIEW_REQUIRED', '本地安装包不在已审查 allowlist 中；如确认可信，设置 MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=true', 403);
  }
  return installPrepared({ ...prepared, archiveSha: sha256, source, handleDb });
}

function setEnabled(toolId, enabled, handleDb = defaultDb) {
  const existing = toolboxRepo.getTool(handleDb, toolId);
  if (!existing) throw new ToolboxError('NOT_INSTALLED', '工具尚未安装', 404);
  const record = toolboxRepo.setEnabled(handleDb, toolId, enabled);
  toolboxRepo.updateTool(handleDb, toolId, { pending_restart: true, last_error: '' });
  writeRuntimeState(toolboxRepo.listTools(handleDb));
  return { tool: toolboxRepo.getTool(handleDb, toolId), runtime: { pending: true } };
}

function uninstall(toolId, { purgeData = false, handleDb = defaultDb } = {}) {
  const existing = toolboxRepo.getTool(handleDb, toolId);
  if (!existing) throw new ToolboxError('NOT_INSTALLED', '工具尚未安装', 404);
  const target = pluginDir(toolId);
  const trash = path.join(PLUGINS_DIR, `.trash-${toolId}-${Date.now()}`);
  if (fs.existsSync(target)) {
    try {
      fs.renameSync(target, trash);
    } catch (err) {
      throw new ToolboxError('UNINSTALL_FAILED', `无法移动插件目录：${err.message}`, 500);
    }
  }
  try {
    toolboxRepo.removeTool(handleDb, toolId);
    // 插件卸载后产物登记立即失效；数据目录是否保留由 purgeData 决定。
    toolboxRepo.deleteArtifactsForTool(handleDb, toolId);
    fs.rmSync(trash, { recursive: true, force: true });
    fs.rmSync(previousDir(toolId), { recursive: true, force: true });
    if (purgeData) fs.rmSync(assertInside(path.join(TOOLBOX_DIR, 'data'), path.join(TOOLBOX_DIR, 'data', toolId), 'PATH_ESCAPE'), { recursive: true, force: true });
  } catch (err) {
    // 目录已移走但 DB 失败：尽量移回，保持“记录与目录一致”
    if (fs.existsSync(trash) && !fs.existsSync(target)) {
      try { fs.renameSync(trash, target); } catch { /* ignore */ }
    }
    throw new ToolboxError('UNINSTALL_FAILED', `卸载记录失败：${err.message}`, 500);
  }
  writeRuntimeState(toolboxRepo.listTools(handleDb));
  // 卸载必须真正从 Worker 卸载：Node 侧记录已删除，这里再触发一次重载，
  // 停掉仍在内存里的模块与后台任务。重载失败不回滚卸载（记录已不可用），
  // 下一次“重启生效”或服务启动还会再次尝试。
  reloadRuntime({ timeoutMs: 15_000 }).catch(() => { /* 运行时离线时保持已卸载状态 */ });
  return { ok: true, tool: existing, runtime: { pending: false, reloading: true } };
}

function rollback(toolId, handleDb = defaultDb) {
  const existing = toolboxRepo.getTool(handleDb, toolId);
  if (!existing) throw new ToolboxError('NOT_INSTALLED', '工具尚未安装', 404);
  if (!existing.previous_path) throw new ToolboxError('NO_ROLLBACK', '没有可回滚的旧版本', 409);
  const previous = assertInside(PLUGINS_DIR, path.join(TOOLBOX_DIR, existing.previous_path), 'INSTALL_PATH_INVALID');
  if (!fs.existsSync(previous)) throw new ToolboxError('NO_ROLLBACK', '旧版本目录已不存在', 409);
  const target = pluginDir(toolId);
  const currentBackup = path.join(PLUGINS_DIR, `.rollback-${toolId}-${Date.now()}`);
  try {
    if (fs.existsSync(target)) fs.renameSync(target, currentBackup);
    fs.renameSync(previous, target);
  } catch (err) {
    if (!fs.existsSync(target) && fs.existsSync(currentBackup)) {
      try { fs.renameSync(currentBackup, target); } catch { /* ignore */ }
    }
    throw new ToolboxError('ROLLBACK_FAILED', `回滚失败：${err.message}`, 500);
  }
  try {
    const manifest = ensurePluginManifest(target, toolId, { enforceMode: false });
    // 回滚后，“当前版本”成为下一次可回滚的旧版本（在 .rollback-* 目录里）
    const record = toolboxRepo.updateTool(handleDb, toolId, {
      name: manifest.name,
      revision: manifest.revision,
      manifest,
      compatibility: compatibilityOf(manifest, existing.sha256),
      previous_path: path.posix.join('plugins', path.basename(currentBackup)),
      previous_revision: existing.revision,
      pending_restart: true,
      last_error: '',
    });
    writeRuntimeState(toolboxRepo.listTools(handleDb));
    return { tool: record, runtime: { pending: true } };
  } catch (err) {
    // 回滚后的目录已就位，但 DB 未更新：再次交换回去，保持原状
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (fs.existsSync(currentBackup)) fs.renameSync(currentBackup, target);
    } catch { /* ignore */ }
    throw new ToolboxError('ROLLBACK_FAILED', `回滚记录失败：${err.message}`, 500);
  }
}

function syncInstalledState(handleDb = defaultDb) {
  ensureToolboxDirs();
  // 共享卷密钥必须在 Python runtime 需要之前就存在。
  runtimeSecret();
  internalSecret();
  cleanupStaging();
  const tools = toolboxRepo.listTools(handleDb);
  writeRuntimeState(tools);
  return tools;
}

// Worker 重启后，按 Python 实际加载报告更新 pending_restart/last_error。
// 这是上游“重启生效”模型在独立 Worker 上的对应实现：Node 主服务不重启。
async function reloadAndSync(handleDb = defaultDb) {
  const result = await reloadRuntime({ timeoutMs: 20_000 });
  const tools = toolboxRepo.listTools(handleDb);
  if (!result.ok) {
    for (const tool of tools) {
      if (!tool.enabled) continue;
      toolboxRepo.updateTool(handleDb, tool.tool_id, {
        pending_restart: true,
        last_error: result.error || '插件运行时不可用',
      });
    }
    return { ...result, tools: toolboxRepo.listTools(handleDb) };
  }
  const reports = Array.isArray(result.plugins) ? result.plugins : [];
  const byId = new Map(reports.map((report) => [report.tool_id, report]));
  for (const tool of tools) {
    if (!tool.enabled) {
      toolboxRepo.updateTool(handleDb, tool.tool_id, { pending_restart: false, last_error: '' });
      continue;
    }
    const report = byId.get(tool.tool_id);
    if (report && report.loaded && String(report.revision) === String(tool.revision)) {
      toolboxRepo.updateTool(handleDb, tool.tool_id, { pending_restart: false, last_error: '' });
    } else {
      toolboxRepo.updateTool(handleDb, tool.tool_id, {
        pending_restart: true,
        last_error: (report && report.error) || 'Worker 未加载该工具',
      });
    }
  }
  return { ...result, reports, tools: toolboxRepo.listTools(handleDb) };
}

module.exports = {
  PLUGINS_DIR,
  pluginDir,
  prepareStaging,
  ensurePluginManifest,
  installPrepared,
  installFromStore,
  updateFromStore,
  installFromLocalArchive,
  setEnabled,
  uninstall,
  rollback,
  syncInstalledState,
  reloadAndSync,
  compatibilityOf,
};
