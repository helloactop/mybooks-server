const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-toolbox-test-'));
process.env.MYBOOKS_STORAGE_DIR = suiteRoot;
process.env.MYBOOKS_TOOLBOX_DIR = path.join(suiteRoot, 'toolbox');
process.env.MYBOOKS_SEED_DEMO = 'false';
process.env.MYBOOKS_TOOLBOX_RUNTIME_URL = 'http://127.0.0.1:1';

const { openDb } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const { parseManifest, assessCompatibility, findRoute, compareSemver } = require('../src/core/toolbox/manifest');
const { ToolboxError, assertSafeHttpsUrl, safeRelativePath, timingSafeEqualString } = require('../src/core/toolbox/security');
const { extractZip, detectArchiveKind } = require('../src/core/toolbox/zip');
const installer = require('../src/core/toolbox/installer');
const { importToolFile, getBookMetadata } = require('../src/core/toolbox/import');
const library = require('../src/core/toolbox/library');
const { sha256File } = require('../src/core/toolbox/security');
const { FILES_DIR, TOOLBOX_DIR } = require('../src/core/paths');
const { db } = require('../src/db/index');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 最小 ZIP 写入器：支持 store/deflate 与 Unix mode，用于测试解压防线
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const source = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ''), 'utf8');
    const method = entry.method === 'deflate' ? 8 : 0;
    const data = method === 8 ? zlib.deflateRawSync(source) : source;
    const crc = crc32(source);
    const mode = entry.mode || (entry.name.endsWith('/') ? 0o040755 : 0o100644);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.encrypted ? 1 : 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.encrypted ? 1 : 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function writeFixtureZip(filePath, overrides = {}) {
  const manifest = overrides.manifest || {
    tool_id: 'fixture',
    name: 'Fixture Tool',
    description: 'Test fixture',
    revision: '1.0.0',
    author: 'QA',
    publish_date: '2026-11-08',
    core_api_version: '1.3.0',
    entry_backend: 'tool.PluginTool',
    entry_frontend: 'index.html',
    repo_url: 'https://example.invalid/fixture',
    locales: ['zh'],
    default_locale: 'zh',
    api_routes: [{ path: 'ping', handler: 'tool.PingHandler' }],
  };
  const entries = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    {
      name: 'backend/__init__.py',
      data: '',
    },
    {
      name: 'backend/tool.py',
      data: [
        'from webserver.toolbox.base_tool import BaseTool',
        'from webserver.handlers.base import BaseHandler, js, is_admin',
        'class PluginTool(BaseTool):',
        '    @staticmethod',
        '    def info():',
        "        return {'tool_id': 'fixture', 'name': 'Fixture Tool', 'revision': '1.0.0'}",
        'class PingHandler(BaseHandler):',
        '    @js',
        '    @is_admin',
        '    def get(self):',
        "        return {'err': 'ok', 'data': {'pong': True}}",
        '',
      ].join('\n'),
    },
    { name: 'frontend/index.html', data: '<!doctype html><title>fixture</title>' },
    { name: 'frontend/app.js', data: 'window.fixture = true;' },
  ];
  fs.writeFileSync(filePath, makeZip(entries));
  return { manifest, entries };
}

let dbHandle;
let fixtureZip;

before(() => {
  fs.mkdirSync(path.join(suiteRoot, 'toolbox'), { recursive: true });
  dbHandle = openDb(path.join(suiteRoot, 'data'));
  fixtureZip = path.join(suiteRoot, 'fixture.zip');
  writeFixtureZip(fixtureZip);
});

after(() => {
  try { dbHandle.close(); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(suiteRoot, { recursive: true, force: true }); } catch { /* Windows 句柄可能仍占用 */ }
});

test('manifest：真实字段解析、路由白名单与兼容性结论', () => {
  const manifest = {
    tool_id: 'zlibrary',
    name: 'Z-Library 入库',
    description: 'x',
    revision: '0.1.0',
    author: '黏菌',
    core_api_version: '1.3.0',
    entry_backend: 'tool.ZlibraryTool',
    entry_frontend: 'index.html',
    repo_url: 'https://github.com/shiningsprk-arch/tool_zlibrary',
    locales: ['zh', 'en'],
    default_locale: 'zh',
    api_routes: [
      { path: '/config', handler: 'tool.ConfigHandler' },
      { path: 'health', handler: 'tool.HealthHandler' },
    ],
  };
  const parsed = parseManifest(manifest);
  assert.equal(parsed.tool_id, 'zlibrary');
  assert.deepEqual(parsed.entry_backend, { module: 'tool', className: 'ZlibraryTool' });
  assert.equal(findRoute(parsed, 'config').path, 'config');
  assert.equal(findRoute(parsed, '../api/books'), null);
  assert.ok(assessCompatibility(parsed, { reviewed: true }).supported);
  assert.ok(!assessCompatibility(parsed, { reviewed: false }).supported);
  assert.equal(compareSemver('1.3.0', '1.2.9'), 1);
});

test('manifest：非法 tool_id / 路径穿越 / 过新 CoreAPI 被拒绝', () => {
  const base = {
    tool_id: '../bad', name: 'x', description: 'x', revision: '1.0.0', author: 'x',
    core_api_version: '1.3.0', entry_backend: 'tool.X', repo_url: 'https://x',
  };
  assert.throws(() => parseManifest(base), /tool_id/);
  assert.throws(() => parseManifest({ ...base, tool_id: 'ok', api_routes: [{ path: '../x', handler: 'tool.X' }] }), /api_routes/);
  assert.throws(() => parseManifest({ ...base, tool_id: 'ok', entry_backend: 'not-a-class' }), /entry_backend/);
  const parsed = parseManifest({ ...base, tool_id: 'ok', core_api_version: '1.4.0', entry_backend: 'tool.X' });
  assert.ok(!assessCompatibility(parsed, { reviewed: true }).supported);
});

test('安全原语：拒绝 http/私网/不可信域名与越界路径', () => {
  assert.throws(() => assertSafeHttpsUrl('http://mybooks.top/x.zip', { allowedHosts: ['mybooks.top'] }), /HTTPS/);
  assert.throws(() => assertSafeHttpsUrl('https://127.0.0.1/x.zip', { allowedHosts: ['127.0.0.1'] }), /内网/);
  assert.throws(() => assertSafeHttpsUrl('https://evil.example/x.zip', { allowedHosts: ['mybooks.top'] }), /可信/);
  assert.throws(() => safeRelativePath('../etc/passwd'), /路径/);
  assert.throws(() => safeRelativePath('/abs'), /绝对路径/);
  assert.equal(safeRelativePath('locales/zh.json'), 'locales/zh.json');
  assert.equal(timingSafeEqualString('abc', 'abc'), true);
  assert.equal(timingSafeEqualString('abc', 'abd'), false);
});

test('ZIP：正常解压、路径穿越、符号链接、压缩炸弹与 7z 拒绝', async () => {
  const out = path.join(suiteRoot, 'extract-ok');
  const result = await extractZip(fixtureZip, out);
  assert.ok(result.entries >= 5);
  assert.ok(fs.existsSync(path.join(out, 'manifest.json')));

  const traversal = path.join(suiteRoot, 'traversal.zip');
  fs.writeFileSync(traversal, makeZip([{ name: '../escape.txt', data: 'x' }]));
  await assert.rejects(extractZip(traversal, path.join(suiteRoot, 'extract-bad')), /路径/);

  const symlink = path.join(suiteRoot, 'symlink.zip');
  fs.writeFileSync(symlink, makeZip([{ name: 'link', data: '/etc/passwd', mode: 0o120777 }]));
  await assert.rejects(extractZip(symlink, path.join(suiteRoot, 'extract-link')), /符号链接/);

  const bomb = path.join(suiteRoot, 'bomb.zip');
  fs.writeFileSync(bomb, makeZip([{ name: 'zeros.bin', data: Buffer.alloc(4 * 1024 * 1024), method: 'deflate' }]));
  await assert.rejects(extractZip(bomb, path.join(suiteRoot, 'extract-bomb')), /压缩比/);

  const seven = path.join(suiteRoot, 'archive.7z');
  fs.writeFileSync(seven, Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(20)]));
  assert.equal(detectArchiveKind(seven), '7z');
  await assert.rejects(extractZip(seven, path.join(suiteRoot, 'extract-7z')), /7z|7-Zip|解压/);
});

test('安装：原子落盘、状态文件、启停、回滚记录与卸载', async () => {
  const prepared = await installer.prepareStaging(fixtureZip, 'fixture');
  assert.equal(prepared.manifest.tool_id, 'fixture');
  const archiveSha = await sha256File(fixtureZip);
  const installed = installer.installPrepared({
    ...prepared, archiveSha, source: 'test', handleDb: dbHandle, reload: false,
  });
  assert.equal(installed.tool.tool_id, 'fixture');
  assert.equal(toolboxRepo.getTool(dbHandle, 'fixture').revision, '1.0.0');
  assert.ok(fs.existsSync(path.join(TOOLBOX_DIR, 'plugins', 'fixture', 'frontend', 'index.html')));
  const state = JSON.parse(fs.readFileSync(path.join(TOOLBOX_DIR, 'state', 'installed.json'), 'utf8'));
  assert.equal(state.tools.find((tool) => tool.tool_id === 'fixture').enabled, true);

  installer.setEnabled('fixture', false, dbHandle);
  assert.equal(toolboxRepo.getTool(dbHandle, 'fixture').enabled, false);
  installer.setEnabled('fixture', true, dbHandle);

  const removed = installer.uninstall('fixture', { handleDb: dbHandle });
  assert.equal(removed.ok, true);
  assert.equal(toolboxRepo.getTool(dbHandle, 'fixture'), null);
  assert.equal(fs.existsSync(path.join(TOOLBOX_DIR, 'plugins', 'fixture')), false);
});

test('入库：新建、同文件去重、同书同格式冲突、标签与路径边界', async () => {
  // 重新安装 fixture 作为入库工具
  const prepared = await installer.prepareStaging(fixtureZip, 'fixture');
  installer.installPrepared({
    ...prepared, archiveSha: await sha256File(fixtureZip), source: 'test', handleDb: dbHandle, reload: false,
  });
  const work = path.join(TOOLBOX_DIR, 'data', 'fixture', 'job');
  fs.mkdirSync(work, { recursive: true });
  const first = path.join(work, 'Public Domain Test.epub');
  fs.writeFileSync(first, 'PK-test-epub-content');
  const imported = await importToolFile({
    toolId: 'fixture', filePath: first, title: 'Public Domain Test', authors: ['Test Author'], handleDb: dbHandle,
  });
  assert.ok(imported.book_id > 0);
  assert.equal(imported.format, 'EPUB');
  const meta = getBookMetadata(imported.book_id, dbHandle);
  assert.deepEqual(meta.authors, ['Test Author']);

  const duplicate = path.join(work, 'duplicate.epub');
  fs.writeFileSync(duplicate, 'PK-test-epub-content');
  const same = await importToolFile({
    toolId: 'fixture', filePath: duplicate, title: 'Another Title', authors: ['Other'], handleDb: dbHandle,
  });
  assert.equal(same.book_id, imported.book_id);
  assert.equal(same.dedup, 'sha256');

  const conflict = path.join(work, 'conflict.epub');
  fs.writeFileSync(conflict, 'PK-different-content');
  await assert.rejects(importToolFile({
    toolId: 'fixture', filePath: conflict, title: 'Public Domain Test', authors: ['Test Author'], handleDb: dbHandle,
  }), /已有/);

  const tagged = library.updateMetadata(dbHandle, imported.book_id, { tags: ['tool-test'] });
  assert.deepEqual(tagged.tags, ['tool-test']);

  const outside = path.join(suiteRoot, 'outside.epub');
  fs.writeFileSync(outside, 'PK-outside');
  await assert.rejects(importToolFile({
    toolId: 'fixture', filePath: outside, title: 'Outside', authors: [], handleDb: dbHandle,
  }), /路径/);

  const unsupported = path.join(work, 'book.fb2');
  fs.writeFileSync(unsupported, 'fb2');
  await assert.rejects(importToolFile({
    toolId: 'fixture', filePath: unsupported, title: 'FB2', authors: [], handleDb: dbHandle,
  }), /不支持/);

  assert.ok(fs.readdirSync(FILES_DIR).some((name) => name.endsWith('.epub')));
});

test('更新：保留旧版本并可回滚', async () => {
  const v1 = path.join(suiteRoot, 'fixture-update-v1.zip');
  const v2 = path.join(suiteRoot, 'fixture-update-v2.zip');
  writeFixtureZip(v1, {
    manifest: {
      tool_id: 'fixture_update', name: 'Fixture Update', description: 'x', revision: '1.0.0',
      author: 'QA', core_api_version: '1.3.0', entry_backend: 'tool.PluginTool',
      entry_frontend: 'index.html', repo_url: 'https://example.invalid',
      api_routes: [{ path: 'ping', handler: 'tool.PingHandler' }],
    },
  });
  writeFixtureZip(v2, {
    manifest: {
      tool_id: 'fixture_update', name: 'Fixture Update', description: 'x', revision: '1.1.0',
      author: 'QA', core_api_version: '1.3.0', entry_backend: 'tool.PluginTool',
      entry_frontend: 'index.html', repo_url: 'https://example.invalid',
      api_routes: [{ path: 'ping', handler: 'tool.PingHandler' }],
    },
  });
  const first = await installer.prepareStaging(v1, 'fixture_update');
  installer.installPrepared({
    ...first, archiveSha: await sha256File(v1), source: 'test', handleDb: dbHandle,
  });
  const second = await installer.prepareStaging(v2, 'fixture_update');
  const updated = installer.installPrepared({
    ...second, archiveSha: await sha256File(v2), source: 'test', handleDb: dbHandle,
  });
  assert.equal(updated.tool.revision, '1.1.0');
  assert.equal(updated.tool.pending_restart, true);
  assert.equal(updated.tool.previous_revision, '1.0.0');
  const rolled = installer.rollback('fixture_update', dbHandle);
  assert.equal(rolled.tool.revision, '1.0.0');
  assert.equal(rolled.tool.pending_restart, true);
  assert.ok(fs.existsSync(path.join(TOOLBOX_DIR, 'plugins', 'fixture_update', 'manifest.json')));
  installer.uninstall('fixture_update', { handleDb: dbHandle });
});

test('任务：创建/进度/完成/重启中断恢复', () => {
  const task = toolboxRepo.createTask(dbHandle, { toolId: 'fixture', operation: 'download' });
  assert.equal(task.status, 'running');
  const progress = toolboxRepo.updateTask(dbHandle, task.id, { progress: 42, stage: 'downloading' });
  assert.equal(progress.progress, 42);
  const done = toolboxRepo.finishTask(dbHandle, task.id, {
    status: 'completed', resultBookId: 7, message: 'ok',
  });
  assert.equal(done.status, 'completed');
  assert.equal(done.result_book_id, 7);
  const second = toolboxRepo.createTask(dbHandle, { toolId: 'fixture', operation: 'download' });
  assert.equal(toolboxRepo.recoverRunningTasks(dbHandle), 1);
  assert.equal(toolboxRepo.getTask(dbHandle, second.id).status, 'failed');
});

test('商店标注：已安装/可更新/未审查状态', () => {
  const { annotate } = require('../src/core/toolbox/store');
  const entry = {
    tool_id: 'fixture', latest_revision: '1.1.0', compatibility: { supported: true, reasons: [] },
    reviewed: true, blocked_reasons: [],
  };
  const result = annotate([entry], [{
    tool_id: 'fixture', revision: '1.0.0', enabled: true, installed_at: '2026-01-01',
  }]);
  assert.equal(result[0].installed.revision, '1.0.0');
  assert.equal(result[0].installed.update_available, true);
  assert.equal(result[0].installable, true);
});
