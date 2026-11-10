/* ============================================================
 * Phase 4B-R：P2 修复的单元级回归
 *
 *   · 本地安装的已审查包必须显示 reviewed（P2-4）
 *   · 任务恢复要区分 Worker 是否仍加载插件（P2-6）
 *   · Node 与 Runtime 的 toolbox 路径自检（P2-5）
 *   · 卸载后触发 Worker 重载（P2-3）
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-4br-unit-'));
process.env.MYBOOKS_STORAGE_DIR = suiteRoot;
process.env.MYBOOKS_TOOLBOX_DIR = path.join(suiteRoot, 'toolbox');
process.env.MYBOOKS_SEED_DEMO = 'false';
process.env.MYBOOKS_TOOLBOX_RUNTIME_URL = 'http://127.0.0.1:1';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const { TOOLBOX_DIR } = require('../src/core/paths');
const { descriptorFromRecord, trustOf } = require('../src/core/toolbox/descriptor');
const { runtimePathStatus } = require('../src/core/toolbox/runtime');
const installer = require('../src/core/toolbox/installer');

// allowlist 中真实存在的已审查记录
const REVIEWED_SHA = '9b5dde1dc3c523605d36eb80a3b1a7dd4be3133ecb056f9a858dd538b5907483';

function manifestFor(toolId, revision) {
  return {
    manifest_version: 1,
    tool_id: toolId,
    name: `Fixture ${toolId}`,
    version: revision,
    description: 'fixture plugin',
    author: 'QA',
    core_api_version: '1.3.0',
    repo_url: 'https://example.invalid/fixture',
    runtime: { type: 'python', entry: 'tool.FixtureTool' },
    entry_backend: 'tool.FixtureTool',
    entry_frontend: 'index.html',
  };
}

test('P2-4：本地安装但 SHA 命中 allowlist → trust=reviewed', () => {
  const raw = manifestFor('md_to_epub', '1.1.0');
  const tool = {
    tool_id: 'md_to_epub',
    name: 'Fixture',
    revision: '1.1.0',
    runtime: 'python',
    sha256: REVIEWED_SHA,
    source: 'dev',
    compatibility: {},
    manifest: { raw },
  };
  assert.equal(trustOf({ toolId: 'md_to_epub', revision: '1.1.0', sha256: REVIEWED_SHA, source: 'dev', raw }), 'reviewed');
  const descriptor = descriptorFromRecord(tool);
  assert.equal(descriptor.trust, 'reviewed');
  assert.equal(descriptor.compatibility.reviewed, true);
  assert.equal(descriptor.compatibility.supported, true);
});

test('P2-4：本地安装且 SHA 不匹配 → 仍是 local/未审查', () => {
  const raw = manifestFor('md_to_epub', '1.1.0');
  const tool = {
    tool_id: 'md_to_epub',
    name: 'Fixture',
    revision: '1.1.0',
    runtime: 'python',
    sha256: 'f'.repeat(64),
    source: 'dev',
    compatibility: {},
    manifest: { raw },
  };
  const descriptor = descriptorFromRecord(tool);
  assert.equal(descriptor.trust, 'local');
  assert.equal(descriptor.compatibility.reviewed, false);
});

test('P2-6：Worker 已加载插件的任务保留，未加载插件才标记失败', () => {
  const loadedTask = toolboxRepo.createTask(db, { toolId: 'fixture_loaded', operation: 'download' });
  const otherTask = toolboxRepo.createTask(db, { toolId: 'fixture_other', operation: 'download' });
  const future = new Date(Date.now() + 60_000).toISOString();
  const changed = toolboxRepo.recoverRunningTasks(db, 'recovered', {
    excludeToolIds: ['fixture_loaded'],
    createdBefore: future,
  });
  assert.equal(changed, 1);
  assert.equal(toolboxRepo.getTask(db, loadedTask.id).status, 'running');
  assert.equal(toolboxRepo.getTask(db, otherTask.id).status, 'failed');
  // 默认（运行时离线）仍可回收剩余任务。
  assert.equal(toolboxRepo.recoverRunningTasks(db), 1);
  assert.equal(toolboxRepo.getTask(db, loadedTask.id).status, 'failed');
});

test('P2-6：启动后新建的任务不会被启动恢复误伤', () => {
  const bootAt = new Date(Date.now() - 60_000).toISOString();
  const task = toolboxRepo.createTask(db, { toolId: 'fixture_boot', operation: 'download' });
  const changed = toolboxRepo.recoverRunningTasks(db, 'recovered', { createdBefore: bootAt });
  assert.equal(changed, 0);
  assert.equal(toolboxRepo.getTask(db, task.id).status, 'running');
  toolboxRepo.finishTask(db, task.id, { status: 'cancelled' });
});

test('P2-5：toolbox 路径一致/不一致都能被识别', () => {
  const same = runtimePathStatus({ toolbox_dir: TOOLBOX_DIR });
  assert.equal(same.checked, true);
  assert.equal(same.mismatch, false);
  const other = runtimePathStatus({ toolbox_dir: '/definitely/not/the/same/toolbox' });
  assert.equal(other.checked, true);
  assert.equal(other.mismatch, true);
  const missing = runtimePathStatus({});
  assert.equal(missing.checked, false);
  assert.equal(missing.mismatch, false);
});

test('P2-3：卸载返回重载状态，记录与目录同时消失', () => {
  toolboxRepo.insertTool(db, {
    tool_id: 'fixture_uninstall',
    name: 'Fixture',
    revision: '1.0.0',
    install_path: 'plugins/fixture_uninstall',
    sha256: 'a'.repeat(64),
    manifest: manifestFor('fixture_uninstall', '1.0.0'),
    pending_restart: false,
  });
  const result = installer.uninstall('fixture_uninstall', { handleDb: db });
  assert.equal(result.ok, true);
  assert.equal(result.runtime.reloading, true);
  assert.equal(toolboxRepo.getTool(db, 'fixture_uninstall'), null);
});
