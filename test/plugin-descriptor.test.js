/* ============================================================
 * Phase 4A：Manifest v1 与统一 Plugin Descriptor
 *
 * 覆盖：v1 解析、Legacy 兼容、Descriptor 契约、未知字段、
 *       权限声明、路径穿越、依赖、UI 入口、环境开关、安装门禁。
 * ============================================================ */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-descriptor-test-'));
process.env.MYBOOKS_STORAGE_DIR = suiteRoot;
process.env.MYBOOKS_TOOLBOX_DIR = path.join(suiteRoot, 'toolbox');
process.env.MYBOOKS_SEED_DEMO = 'false';
process.env.MYBOOKS_TOOLBOX_RUNTIME_URL = 'http://127.0.0.1:1';
// 测试插件不在 allowlist 中；显式 opt-in 与生产安装路径保持一致。
process.env.MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED = 'true';

const { openDb } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');
const installer = require('../src/core/toolbox/installer');
const {
  normalizeManifest,
  parseManifestV1,
  validateManifest,
  assessDependencies,
  detectDependencyCycles,
  detectManifestVersion,
} = require('../src/core/toolbox/manifest-v1');
const {
  createPluginDescriptor,
  createDescriptor,
  descriptorFromRecord,
  getPluginDescriptor,
  getInstalledPluginDescriptors,
  toPublicDescriptor,
} = require('../src/core/toolbox/descriptor');
const { GrantStore, PERMISSION_SET } = require('../src/core/plugins/permissions');
const { TOOLBOX_DIR } = require('../src/core/paths');

const LEGACY_ZLIBRARY = {
  tool_id: 'zlibrary',
  name: 'Z-Library',
  description: '从 Z-Library 搜索并下载电子书',
  revision: '0.1.0',
  author: '黏菌',
  core_api_version: '1.3.0',
  entry_backend: 'tool.ZlibraryTool',
  entry_frontend: 'index.html',
  repo_url: 'https://github.com/shyshineinn/zlibrary-tool',
  locales: ['zh', 'en'],
  default_locale: 'zh',
  api_routes: [{ path: '/config', handler: 'tool.ConfigHandler' }],
};

const V1_MD_TO_EPUB = {
  manifest_version: 1,
  tool_id: 'md_to_epub',
  name: 'Markdown to EPUB',
  version: '1.2.0',
  description: '把 Markdown 转换成 EPUB 并导入书库',
  publisher: { name: 'Mybooks Labs' },
  runtime: { type: 'python', entry: 'tool.MarkdownTool', limits: { memory_mb: 384 } },
  frontend: { entry: 'index.html', bridge: 2, theme: 'auto' },
  permissions: [
    { name: 'books.write', scope: 'library:all', reason: '转换完成后写入书库' },
    { name: 'files.read', scope: 'plugin:md_to_epub:work', reason: '读取上传的草稿' },
  ],
  config: {
    schema: {
      type: 'object',
      properties: {
        font_size: { type: 'integer', default: 14, minimum: 8, maximum: 32 },
        api_token: { type: 'string', 'x-sensitive': true },
      },
    },
  },
  ui: { protocol: 2, pages: [{ id: 'main', title: '转换', entry: 'index.html' }] },
  dependencies: { plugins: [{ tool_id: 'zlibrary', version: '^0.1.0', optional: true }] },
  resources: { memory_mb: 384, timeout_seconds: 300, max_artifact_mb: 80, max_concurrent_jobs: 1 },
  lifecycle: { on_install: 'tool.hooks.on_install' },
  events: ['book.created'],
  provides: [{ capability: 'library.export', version: '1', entry: 'tool.Exporter' }],
  compatibility: { platforms: ['web'], host: '>=1.0.0 <2.0.0' },
  core_api_version: '1.3.0',
  author: { name: 'Mybooks Labs', url: 'https://example.com' },
  repo_url: 'https://github.com/shyshineinn/md-to-epub',
  icon: 'assets/icon.png',
  license: 'MIT',
  categories: ['conversion'],
  tags: ['markdown', 'epub'],
  'x-vendor': { release: 'stable' },
};

const V1_MINIMAL = {
  manifest_version: 1,
  tool_id: 'minimal',
  name: 'Minimal',
  version: '1.0.0',
  description: '最小 v1 插件',
  author: 'tester',
  core_api_version: '1.3.0',
  repo_url: 'https://example.com/minimal',
  runtime: { entry: 'tool.MinimalTool' },
  entry_frontend: 'index.html',
};

let dbHandle;

before(() => {
  fs.mkdirSync(path.join(suiteRoot, 'toolbox'), { recursive: true });
  dbHandle = openDb(path.join(suiteRoot, 'data'));
});

after(() => {
  try { dbHandle.close(); } catch { /* ignore */ }
  try { fs.rmSync(suiteRoot, { recursive: true, force: true }); } catch { /* Windows 句柄可能仍占用 */ }
});

function withMode(mode, fn) {
  const previous = process.env.MYBOOKS_PLUGIN_MANIFEST_V1;
  if (mode === null) delete process.env.MYBOOKS_PLUGIN_MANIFEST_V1;
  else process.env.MYBOOKS_PLUGIN_MANIFEST_V1 = mode;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.MYBOOKS_PLUGIN_MANIFEST_V1;
    else process.env.MYBOOKS_PLUGIN_MANIFEST_V1 = previous;
  }
}

function codes(list) {
  return list.map((item) => item.code);
}

// ---------------- 解析与 Descriptor ----------------

test('Manifest v1：完整声明解析为统一 Descriptor', () => {
  const descriptor = createPluginDescriptor(V1_MD_TO_EPUB, { source: 'store' });

  assert.equal(descriptor.id, 'md_to_epub');
  assert.equal(descriptor.manifest_version, 1);
  assert.equal(descriptor.legacy, false);
  assert.equal(descriptor.identity.name, 'Markdown to EPUB');
  assert.equal(descriptor.identity.author.name, 'Mybooks Labs');
  assert.equal(descriptor.identity.publisher.name, 'Mybooks Labs');
  assert.equal(descriptor.identity.license, 'MIT');
  assert.equal(descriptor.runtime.type, 'python');
  assert.deepEqual(descriptor.runtime.entry, { module: 'tool', className: 'MarkdownTool' });
  assert.equal(descriptor.frontend.entry, 'frontend/index.html');
  assert.equal(descriptor.frontend.bridge, 2);
  assert.equal(descriptor.ui.pages[0].entry, 'frontend/index.html');
  assert.equal(descriptor.permissions.length, 2);
  assert.equal(descriptor.permissions[1].resource_scoped, true);
  assert.equal(descriptor.permissions[1].scope, 'plugin:md_to_epub:work');
  assert.equal(descriptor.configuration.schema.properties.font_size.default, 14);
  assert.deepEqual(descriptor.configuration.sensitive_fields, ['api_token']);
  assert.equal(descriptor.capabilities[0].capability, 'library.export');
  assert.equal(descriptor.dependencies.plugins[0].tool_id, 'zlibrary');
  assert.equal(descriptor.resources.timeout_seconds, 300);
  assert.equal(descriptor.lifecycle.on_install, 'tool.hooks.on_install');
  assert.equal(descriptor.events[0].name, 'book.created');
  assert.equal(descriptor.compatibility.supported, true);
  assert.equal(descriptor.trust, 'unreviewed'); // 仅声明 publisher 不构成可信
  assert.equal(descriptor.source, 'store');

  // 只读：外层与嵌套对象都被冻结
  assert.ok(Object.isFrozen(descriptor));
  assert.ok(Object.isFrozen(descriptor.permissions));
  assert.ok(Object.isFrozen(descriptor.permissions[0]));
  assert.throws(() => Object.defineProperty(descriptor, 'id', { value: 'x' }), TypeError);
});

test('Legacy 与 v1 生成同一 Descriptor 契约（公共字段一致）', () => {
  const legacy = createPluginDescriptor(LEGACY_ZLIBRARY, { source: 'store' });
  const v1 = createPluginDescriptor({
    manifest_version: 1,
    tool_id: 'zlibrary',
    name: 'Z-Library',
    version: '0.1.0',
    description: '从 Z-Library 搜索并下载电子书',
    author: '黏菌',
    core_api_version: '1.3.0',
    repo_url: 'https://github.com/shyshineinn/zlibrary-tool',
    runtime: { entry: 'tool.ZlibraryTool' },
    routes: [{ path: '/config', handler: 'tool.ConfigHandler' }],
    frontend: { entry: 'index.html', bridge: 1 },
    locales: ['zh', 'en'],
    default_locale: 'zh',
  }, { source: 'store' });

  assert.equal(legacy.legacy, true);
  assert.equal(v1.legacy, false);
  for (const key of ['id', 'version']) assert.equal(legacy[key], v1[key]);
  assert.equal(legacy.identity.name, v1.identity.name);
  assert.equal(legacy.identity.repo_url, v1.identity.repo_url);
  assert.deepEqual(legacy.runtime.entry, v1.runtime.entry);
  assert.equal(legacy.runtime.type, v1.runtime.type);
  assert.equal(legacy.frontend.entry, v1.frontend.entry);
  assert.equal(legacy.frontend.bridge, v1.frontend.bridge);
  assert.deepEqual(legacy.routes.map((r) => r.path), v1.routes.map((r) => r.path));
  assert.deepEqual(legacy.ui.pages.map((p) => p.entry), v1.ui.pages.map((p) => p.entry));
  assert.deepEqual(legacy.metadata.locales, v1.metadata.locales);
  assert.deepEqual(legacy.permissions, []);
  assert.deepEqual(v1.permissions, []);
  assert.equal(legacy.compatibility.supported, true);
  assert.equal(v1.compatibility.supported, true);
});

test('Legacy：旧字段完整保留，运行时与安装器无需改动', () => {
  const { manifest } = normalizeManifest(LEGACY_ZLIBRARY, {});
  assert.equal(manifest.manifest_version, 0);
  assert.deepEqual(manifest.entry_backend, { module: 'tool', className: 'ZlibraryTool' });
  assert.equal(manifest.entry_frontend, 'index.html');
  assert.equal(manifest.api_routes[0].path, 'config');
  assert.deepEqual(manifest.api_routes[0].handler, { module: 'tool', className: 'ConfigHandler' });
  assert.equal(manifest.author, '黏菌');
});

test('缺少必填字段与类型错误被拒绝', () => {
  const cases = [
    [{ ...V1_MINIMAL, name: undefined }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, description: undefined }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, version: undefined }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, core_api_version: undefined }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, repo_url: undefined }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, runtime: undefined }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, name: 123 }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, permissions: 'books.write' }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, repo_url: 'http://example.com/x' }, 'MANIFEST_INVALID'],
    [{ ...V1_MINIMAL, version: 'v1' }, 'MANIFEST_INVALID'],
  ];
  for (const [raw, code] of cases) {
    assert.throws(() => normalizeManifest(raw, {}), (err) => err.code === code,
      `期望 ${code}，实际 ${raw && JSON.stringify(raw).slice(0, 80)}`);
  }
  // 运行时类型由兼容性评估标记为不支持，而不是解析层静默接受。
  const unsupported = createPluginDescriptor({
    ...V1_MINIMAL, runtime: { type: 'javascript', entry: 'tool.X' },
  });
  assert.equal(unsupported.compatibility.supported, false);
  assert.ok(codes(unsupported.compatibility.reasons).includes('RUNTIME_UNSUPPORTED'));
});

test('不支持的 manifest_version 明确拒绝', () => {
  assert.deepEqual(detectManifestVersion({ manifest_version: 2 }), {
    version: 2, supported: false, reason: '不支持的 manifest_version：2（本宿主支持 1）',
  });
  assert.throws(
    () => normalizeManifest({ ...V1_MINIMAL, manifest_version: 2 }, {}),
    (err) => err.code === 'MANIFEST_VERSION_UNSUPPORTED',
  );
  assert.throws(
    () => normalizeManifest({ ...V1_MINIMAL, manifest_version: '1' }, {}),
    (err) => err.code === 'MANIFEST_VERSION_UNSUPPORTED',
  );
});

// ---------------- 权限 ----------------

test('权限：未知权限与未实现权限不被接受，资源型权限必须带 scope', () => {
  assert.throws(
    () => normalizeManifest({ ...V1_MINIMAL, permissions: [{ name: 'root', reason: 'x' }] }, {}),
    (err) => err.code === 'MANIFEST_PERMISSION_UNKNOWN',
  );
  // 统一权限目录中尚无 jobs.read / events.subscribe 的运行时执行点，因此不得声明。
  for (const name of ['jobs.read', 'events.subscribe']) {
    assert.equal(PERMISSION_SET.has(name), false);
    assert.throws(
      () => normalizeManifest({ ...V1_MINIMAL, permissions: [{ name, reason: 'x' }] }, {}),
      (err) => err.code === 'MANIFEST_PERMISSION_UNKNOWN',
    );
  }
  assert.throws(
    () => normalizeManifest({ ...V1_MINIMAL, permissions: [{ name: 'files.read', reason: 'x' }] }, {}),
    (err) => err.code === 'MANIFEST_PERMISSION_SCOPE_REQUIRED',
  );
  const { manifest } = normalizeManifest({
    ...V1_MINIMAL,
    permissions: [
      { name: 'books.read', scope: 'library:all', reason: '列书' },
      { name: 'settings.read', reason: '读插件设置' },
    ],
  }, {});
  assert.deepEqual(manifest.permissions, [
    { name: 'books.read', scope: 'library:all', reason: '列书' },
    { name: 'settings.read', scope: '', reason: '读插件设置' },
  ]);
});

test('权限声明不会自动产生授权', () => {
  const store = new GrantStore();
  const descriptor = createPluginDescriptor(V1_MD_TO_EPUB, { source: 'store' });
  assert.equal(descriptor.permissions.length, 2);
  assert.deepEqual(store.list('md_to_epub'), []);
});

// ---------------- 未知字段 / 扩展字段 ----------------

test('未知字段：默认忽略并告警，strict 拒绝，x-* 始终允许', () => {
  const raw = { ...V1_MINIMAL, future_field: { a: 1 } };
  const auto = normalizeManifest(raw, {});
  assert.equal(auto.manifest.manifest_version, 1);
  assert.ok(codes(auto.warnings).includes('MANIFEST_UNKNOWN_FIELD'));

  assert.throws(
    () => normalizeManifest(raw, { strict: true }),
    (err) => err.code === 'MANIFEST_UNKNOWN_FIELD',
  );

  const extended = normalizeManifest({ ...V1_MINIMAL, 'x-future': 1 }, { strict: true });
  assert.equal(extended.manifest.raw['x-future'], 1);
  assert.deepEqual(codes(extended.warnings), []);
});

test('UI Slot：4A 未实现的 Slot 忽略并告警', () => {
  const { manifest, warnings } = normalizeManifest({
    ...V1_MINIMAL,
    ui: {
      protocol: 2,
      pages: [
        { id: 'main', title: '主界面', entry: 'index.html' },
        { id: 'sidebar', title: '侧栏', entry: 'sidebar.html', slot: 'shelf.sidebar' },
      ],
    },
  }, {});
  assert.deepEqual(manifest.ui.pages.map((page) => page.id), ['main']);
  assert.ok(codes(warnings).includes('MANIFEST_UI_SLOT_UNKNOWN'));
});

// ---------------- 路径安全 ----------------

test('路径穿越与不安全外部引用被拒绝', () => {
  const bad = [
    { ...V1_MINIMAL, icon: '../../etc/passwd.png' },
    { ...V1_MINIMAL, icon: 'C:/icon.png' },
    { ...V1_MINIMAL, icon: 'https://evil.example/icon.png' },
    { ...V1_MINIMAL, frontend: { entry: '../admin.html' } },
    { ...V1_MINIMAL, ui: { pages: [{ id: 'main', entry: 'a/../../b.html' }] } },
    { ...V1_MINIMAL, routes: [{ path: '/../admin', handler: 'tool.X' }] },
    { ...V1_MINIMAL, lifecycle: { on_install: '../../eval.run' } },
  ];
  for (const raw of bad) {
    assert.throws(
      () => normalizeManifest(raw, {}),
      (err) => err.code === 'MANIFEST_INVALID',
      `应拒绝：${JSON.stringify(raw).slice(0, 100)}`,
    );
  }
  assert.throws(
    () => normalizeManifest({ ...V1_MINIMAL, frontend: { entry: 'index.js' } }, {}),
    (err) => err.code === 'MANIFEST_INVALID',
  );
});

// ---------------- 依赖 ----------------

test('依赖：required 缺失拒绝，optional 缺失只告警，自依赖被拒绝', () => {
  const withDep = (dep) => normalizeManifest({
    ...V1_MINIMAL,
    dependencies: { plugins: [dep] },
  }, {}).manifest;

  const required = withDep({ tool_id: 'zlibrary', version: '^0.1.0' });
  assert.deepEqual(assessDependencies(required, []).reasons.map((i) => i.code), ['MANIFEST_DEPENDENCY_MISSING']);
  assert.deepEqual(assessDependencies(required, ['zlibrary']).reasons, []);

  const optional = withDep({ tool_id: 'zlibrary', optional: true });
  assert.deepEqual(assessDependencies(optional, []).reasons, []);
  assert.deepEqual(assessDependencies(optional, []).warnings.map((i) => i.code), ['MANIFEST_DEPENDENCY_MISSING']);

  assert.throws(
    () => normalizeManifest({
      ...V1_MINIMAL,
      dependencies: { plugins: [{ tool_id: 'minimal' }] },
    }, {}),
    (err) => err.code === 'MANIFEST_DEPENDENCY_CYCLE',
  );
});

test('依赖环检测：跨 manifest 成环', () => {
  const make = (id, deps) => ({ tool_id: id, dependencies: { plugins: deps.map((tool_id) => ({ tool_id })) } });
  assert.deepEqual(detectDependencyCycles([make('a', ['b']), make('b', ['a'])]), ['a', 'b']);
  assert.deepEqual(detectDependencyCycles([make('a', ['b']), make('b', [])]), []);
});

// ---------------- 环境开关 ----------------

test('MYBOOKS_PLUGIN_MANIFEST_V1=auto 同时接受 Legacy 与 v1', () => {
  withMode(null, () => {
    assert.equal(normalizeManifest(LEGACY_ZLIBRARY, { enforceMode: true }).manifest.manifest_version, 0);
    assert.equal(normalizeManifest(V1_MINIMAL, { enforceMode: true }).manifest.manifest_version, 1);
  });
  withMode('auto', () => {
    assert.equal(normalizeManifest(LEGACY_ZLIBRARY, { enforceMode: true }).manifest.manifest_version, 0);
    assert.equal(normalizeManifest(V1_MINIMAL, { enforceMode: true }).manifest.manifest_version, 1);
  });
});

test('off：安装拒绝 v1（不静默降级），已安装 v1 仍可只读识别', () => {
  withMode('off', () => {
    assert.throws(
      () => normalizeManifest(V1_MINIMAL, { enforceMode: true }),
      (err) => err.code === 'MANIFEST_VERSION_UNSUPPORTED' && /不会静默降级/.test(err.message),
    );
    // 只读路径（enforceMode=false）不受开关影响，但会明确标注开关已关闭。
    const read = normalizeManifest(V1_MINIMAL, { enforceMode: false });
    assert.equal(read.manifest.manifest_version, 1);
    assert.ok(codes(read.warnings).includes('MANIFEST_V1_DISABLED'));
    assert.equal(normalizeManifest(LEGACY_ZLIBRARY, { enforceMode: true }).manifest.manifest_version, 0);
  });
});

test('strict：只接受 manifest_version=1', () => {
  withMode('strict', () => {
    assert.equal(normalizeManifest(V1_MINIMAL, { enforceMode: true }).manifest.manifest_version, 1);
    assert.throws(
      () => normalizeManifest(LEGACY_ZLIBRARY, { enforceMode: true }),
      (err) => err.code === 'MANIFEST_VERSION_UNSUPPORTED',
    );
  });
});

test('validateManifest 不抛异常，返回结构化结果', () => {
  const ok = validateManifest(V1_MINIMAL, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.errors.length, 0);
  const bad = validateManifest({ ...V1_MINIMAL, name: undefined }, {});
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, 'MANIFEST_INVALID');
});

// ---------------- 安装门禁（真实文件系统） ----------------

function writePackage(dir, manifest, { backend = 'tool.py', frontend = 'index.html' } = {}) {
  fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (backend) fs.writeFileSync(path.join(dir, 'backend', ...backend.split('/')), '# fixture\n');
  if (frontend) fs.writeFileSync(path.join(dir, 'frontend', ...frontend.split('/')), '<!doctype html>');
  return dir;
}

function stagingDir(name) {
  return path.join(TOOLBOX_DIR, 'plugins', `.staging-descriptor-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
}

test('安装：v1 插件落盘后生成统一 Descriptor', async () => {
  const staging = writePackage(stagingDir('v1'), V1_MD_TO_EPUB);
  const { manifest } = normalizeManifest(V1_MD_TO_EPUB, { enforceMode: true });
  installer.installPrepared({
    staging, manifest, archiveSha: 'a'.repeat(64), source: 'test', handleDb: dbHandle, reload: false,
  });

  const tool = toolboxRepo.getTool(dbHandle, 'md_to_epub');
  assert.ok(tool);
  assert.equal(tool.manifest.manifest_version, 1);
  // 旧字段仍然写入数据库，运行时与 UI 读取路径不变。
  assert.deepEqual(tool.manifest.entry_backend, { module: 'tool', className: 'MarkdownTool' });
  assert.equal(tool.manifest.entry_frontend, 'index.html');

  const descriptor = getPluginDescriptor('md_to_epub', { db: dbHandle });
  assert.ok(descriptor);
  assert.equal(descriptor.installed, true);
  assert.equal(descriptor.legacy, false);
  assert.equal(descriptor.frontend.entry, 'frontend/index.html');
  assert.equal(descriptor.trust, 'local'); // source=test → local
  assert.ok(Object.isFrozen(descriptor));
});

test('安装：Legacy 插件继续可用，Descriptor 标记 legacy', async () => {
  const staging = writePackage(stagingDir('legacy'), LEGACY_ZLIBRARY);
  const { manifest } = normalizeManifest(LEGACY_ZLIBRARY, { enforceMode: true });
  installer.installPrepared({
    staging, manifest, archiveSha: 'b'.repeat(64), source: 'test', handleDb: dbHandle, reload: false,
  });
  const descriptor = getPluginDescriptor('zlibrary', { db: dbHandle });
  assert.ok(descriptor);
  assert.equal(descriptor.legacy, true);
  assert.equal(descriptor.manifest_version, 0);
  assert.deepEqual(descriptor.runtime.entry, { module: 'tool', className: 'ZlibraryTool' });
  assert.equal(descriptor.compatibility.supported, true);
});

test('安装：UI 入口不存在时拒绝', () => {
  const raw = { ...V1_MINIMAL, tool_id: 'missing_ui' };
  const staging = writePackage(stagingDir('no-ui'), raw, { frontend: null });
  assert.throws(
    () => installer.ensurePluginManifest(staging, 'missing_ui'),
    (err) => err.code === 'MANIFEST_INVALID' && /entry_frontend/.test(err.message),
  );
  fs.rmSync(staging, { recursive: true, force: true });
});

test('安装：后端模块不存在时拒绝', () => {
  const raw = { ...V1_MINIMAL, tool_id: 'missing_backend' };
  const staging = writePackage(stagingDir('no-backend'), raw, { backend: 'other.py' });
  assert.throws(
    () => installer.ensurePluginManifest(staging, 'missing_backend'),
    (err) => err.code === 'MANIFEST_INVALID' && /entry_backend/.test(err.message),
  );
  fs.rmSync(staging, { recursive: true, force: true });
});

test('安装：恶意或错误 Manifest 被拒绝，且不改动安装目录', async () => {
  const malicious = { ...V1_MINIMAL, tool_id: 'evil', frontend: { entry: '../../etc/passwd.html' } };
  const staging = writePackage(stagingDir('evil'), malicious);
  assert.throws(
    () => installer.ensurePluginManifest(staging, 'evil'),
    (err) => err.code === 'MANIFEST_INVALID',
  );
  assert.equal(fs.existsSync(path.join(TOOLBOX_DIR, 'plugins', 'evil')), false);
  fs.rmSync(staging, { recursive: true, force: true });
});

test('安装：required 依赖缺失被拒绝，且不落盘', async () => {
  const raw = {
    ...V1_MINIMAL,
    tool_id: 'needs_dep',
    dependencies: { plugins: [{ tool_id: 'not_installed', version: '^1.0.0' }] },
  };
  const staging = writePackage(stagingDir('dep'), raw);
  const { manifest } = normalizeManifest(raw, { enforceMode: true });
  assert.throws(
    () => installer.installPrepared({
      staging, manifest, archiveSha: 'c'.repeat(64), source: 'test', handleDb: dbHandle, reload: false,
    }),
    (err) => err.code === 'MANIFEST_DEPENDENCY_MISSING',
  );
  assert.equal(fs.existsSync(path.join(TOOLBOX_DIR, 'plugins', 'needs_dep')), false);
  fs.rmSync(staging, { recursive: true, force: true });
});

test('安装：off 开关下 v1 包被明确拒绝', () => {
  const raw = { ...V1_MINIMAL, tool_id: 'v1_off' };
  withMode('off', () => {
    const staging = writePackage(stagingDir('off'), raw);
    assert.throws(
      () => installer.ensurePluginManifest(staging, 'v1_off'),
      (err) => err.code === 'MANIFEST_VERSION_UNSUPPORTED',
    );
    fs.rmSync(staging, { recursive: true, force: true });
  });
});

test('升级：已安装 Legacy 插件可升级为 v1，旧配置与入口不变', async () => {
  const v1Upgrade = {
    ...LEGACY_ZLIBRARY,
    manifest_version: 1,
    revision: '0.2.0',
    runtime: { entry: 'tool.ZlibraryTool' },
    frontend: { entry: 'index.html' },
  };
  const staging = writePackage(stagingDir('upgrade'), v1Upgrade);
  const { manifest } = normalizeManifest(v1Upgrade, { enforceMode: true });
  installer.installPrepared({
    staging, manifest, archiveSha: 'd'.repeat(64), source: 'test', handleDb: dbHandle, reload: false,
  });

  const descriptor = getPluginDescriptor('zlibrary', { db: dbHandle });
  assert.equal(descriptor.version, '0.2.0');
  assert.equal(descriptor.legacy, false);
  assert.equal(descriptor.runtime.entry.className, 'ZlibraryTool');
  assert.equal(descriptor.frontend.entry, 'frontend/index.html');
  // 升级保留上一版本目录，供回滚路径读取
  assert.equal(fs.existsSync(path.join(TOOLBOX_DIR, 'plugins', '.previous', 'zlibrary')), true);
});

test('列出描述符：Legacy 与 v1 同时返回，公开 DTO 不含 raw', () => {
  const all = getInstalledPluginDescriptors({ db: dbHandle });
  assert.deepEqual(all.map((item) => item.id).sort(), ['md_to_epub', 'zlibrary']);
  for (const item of all) {
    const dto = toPublicDescriptor(item);
    assert.equal(dto.raw, undefined);
    assert.ok(dto.identity && dto.compatibility && dto.permissions);
    assert.ok(Object.isFrozen(dto));
  }
});

test('未审查插件在未 opt-in 时被标记为不支持', () => {
  const previous = process.env.MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED;
  delete process.env.MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED;
  try {
    const descriptor = createPluginDescriptor(V1_MD_TO_EPUB, { source: 'store' });
    assert.equal(descriptor.compatibility.supported, false);
    assert.ok(codes(descriptor.compatibility.reasons).includes('REVIEW_REQUIRED'));
  } finally {
    process.env.MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED = previous;
  }
});

test('描述符不会把 Manifest 自报的发布者升级为 official', () => {
  const descriptor = createPluginDescriptor({
    ...V1_MINIMAL,
    publisher: { name: 'Official Team', key_id: 'official-key' },
  }, { source: 'store' });
  assert.equal(descriptor.trust, 'community');
  assert.notEqual(descriptor.trust, 'official');
});

test('已安装 v1 记录在 off 开关下仍可被描述（只读）', () => {
  withMode('off', () => {
    const tool = toolboxRepo.getTool(dbHandle, 'md_to_epub');
    const descriptor = descriptorFromRecord(tool);
    assert.equal(descriptor.manifest_version, 1);
    assert.equal(descriptor.manifest_mode, 'off');
    assert.ok(codes(descriptor.compatibility.warnings).includes('MANIFEST_V1_DISABLED'));
  });
});

test('createDescriptor 保留原始 manifest 供诊断，且被深冻结', () => {
  const { manifest } = parseManifestV1(V1_MINIMAL, {});
  const descriptor = createDescriptor(manifest, { source: 'test' });
  assert.equal(descriptor.raw.tool_id, 'minimal');
  assert.ok(Object.isFrozen(descriptor.raw));
  assert.equal(descriptor.raw['x-vendor'], undefined);
});
