/* ============================================================
 * Phase 4C.3：插件中心共享 UI 模块单元测试
 *
 * 只测纯函数（转义、URL 白名单、状态映射、安装门禁、指标）。
 * DOM 行为由浏览器验收覆盖，这里不做静态 HTML 断言冒充交互测试。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const P = require('../public/js/plugin-center.js');

test('escapeHtml 阻断 Manifest / 日志中的 XSS 载荷', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const output = P.escapeHtml(payload);
  assert.equal(output, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.doesNotMatch(output, /<img/);

  const script = P.escapeHtml("<script>alert('x')</script>");
  assert.doesNotMatch(script, /<script>/);
  assert.match(script, /&lt;script&gt;/);

  assert.equal(P.escapeHtml(null), '');
  assert.equal(P.escapeHtml(undefined), '');
  assert.equal(P.escapeHtml(0), '0');
});

test('safeUrl 只放行 http(s) 与站内路径', () => {
  assert.equal(P.safeUrl('/plugins/x'), '/plugins/x');
  assert.equal(P.safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(P.safeUrl('http://example.com/a'), 'http://example.com/a');
  assert.equal(P.safeUrl('javascript:alert(1)'), '');
  assert.equal(P.safeUrl('data:text/html,<script>'), '');
  assert.equal(P.safeUrl('//evil.example/x'), '');
  assert.equal(P.safeUrl(''), '');
  assert.equal(P.safeUrl(null), '');
});

test('storeAction：未审查/不兼容永不提供安装，已安装只显示更新', () => {
  const unreviewed = {
    tool_id: 'zlibrary',
    latest_revision: '0.1.1',
    reviewed: false,
    compatibility: { supported: true, reasons: [] },
  };
  const blocked = P.storeAction(unreviewed);
  assert.equal(blocked.action, 'blocked');
  assert.equal(blocked.label, '待审查');
  assert.equal(blocked.disabled, true);
  assert.match(blocked.reason, /allowlist/);

  const incompatible = {
    tool_id: 'x',
    latest_revision: '1.0.0',
    reviewed: true,
    compatibility: { supported: false, reasons: [{ code: 'PYTHON_MISSING', message: '缺少 Python' }] },
  };
  const hard = P.storeAction(incompatible);
  assert.equal(hard.disabled, true);
  assert.equal(hard.label, '暂不支持');
  assert.match(hard.reason, /缺少 Python/);

  const installable = {
    tool_id: 'md_to_epub',
    latest_revision: '1.1.0',
    reviewed: true,
    compatibility: { supported: true, reasons: [] },
  };
  const install = P.storeAction(installable);
  assert.equal(install.action, 'install');
  assert.equal(install.disabled, false);
  assert.equal(install.label, '安装');

  const outdated = {
    ...installable,
    installed: { revision: '1.0.0', update_available: true, enabled: true },
  };
  const update = P.storeAction(outdated);
  assert.equal(update.action, 'update');
  assert.equal(update.label, '更新到 1.1.0');
  assert.equal(update.disabled, false);

  const current = {
    ...installable,
    installed: { revision: '1.1.0', update_available: false, enabled: true },
  };
  const upToDate = P.storeAction(current);
  assert.equal(upToDate.action, 'installed');
  assert.equal(upToDate.disabled, true);
});

test('overviewMetrics：商店无缓存时不得显示为 0 次更新', () => {
  const metrics = P.overviewMetrics({
    counts: { installed: 3, enabled: 2, disabled: 1, updates_available: null, failed: 1, pending_restart: 2 },
    tasks: { running: 4, total: 9 },
  });
  const byKey = Object.fromEntries(metrics.map((item) => [item.key, item]));
  assert.equal(byKey.installed.value, 3);
  assert.equal(byKey.updates.value, '商店状态未知');
  assert.equal(byKey.updates.unknown, true);
  assert.equal(byKey.running.value, 4);
  assert.equal(byKey.attention.value, 3);

  const known = P.overviewMetrics({ counts: { installed: 0, updates_available: 0 }, tasks: {} });
  const updates = known.find((item) => item.key === 'updates');
  assert.equal(updates.value, 0);
  assert.equal(updates.unknown, false);
});

test('installedStatus：只依据后端字段，不推测加载成功', () => {
  assert.deepEqual(P.installedStatus(null), { label: '未知', cls: 'is-muted' });
  assert.equal(P.installedStatus({ enabled: true, pending_restart: true }).label, '待重启');
  assert.equal(P.installedStatus({ enabled: false, pending_restart: false }).label, '已停用');
  assert.equal(P.installedStatus({ enabled: true, runtime_status: 'runtime_offline' }).label, '运行时离线');
  assert.equal(P.installedStatus({ enabled: true, runtime_status: 'not_loaded' }).label, '加载失败');
  assert.equal(P.installedStatus({ enabled: true, runtime_status: 'loaded' }).label, '已启用');
});

test('detailStatus：未安装与运行时离线分开表达', () => {
  assert.equal(P.detailStatus(null, null).label, '未安装');
  assert.equal(P.detailStatus({ enabled: true, pending_restart: true }, { online: true, loaded: true }).label, '待重启');
  assert.equal(P.detailStatus({ enabled: false }, { online: true, loaded: false }).label, '已停用');
  assert.equal(P.detailStatus({ enabled: true }, { online: false, loaded: false }).label, '运行时离线');
  assert.equal(P.detailStatus({ enabled: true }, { online: true, loaded: false }).label, '未加载');
});

test('policyMeta：absent / broken 必须给出明确风险', () => {
  assert.equal(P.policyMeta('ok').cls, 'is-ok');
  const absent = P.policyMeta('absent');
  assert.equal(absent.cls, 'is-warn');
  assert.match(absent.note, /Legacy/);
  const broken = P.policyMeta('broken');
  assert.equal(broken.cls, 'is-error');
  assert.match(broken.note, /拒绝/);
  assert.match(P.policyMeta('last-good').note, /快照/);
});

test('runtimeModeLabel：不把 isolated 说成完全隔离', () => {
  assert.equal(P.runtimeModeLabel('shared', false), '共享 Worker');
  assert.match(P.runtimeModeLabel('shared', true), /UID 隔离不可用/);
  assert.equal(P.runtimeModeLabel('process', false), '独立进程');
  assert.equal(P.runtimeModeLabel('process', true), '独立进程 + 独立 UID');
  assert.equal(P.runtimeModeLabel('unknown-mode', false), '未知');
});

test('taskStatusMeta / riskMeta 兜底未知值', () => {
  assert.deepEqual(P.taskStatusMeta('running'), ['运行中', 'is-running']);
  assert.deepEqual(P.taskStatusMeta('failed'), ['失败', 'is-error']);
  assert.equal(P.taskStatusMeta('weird')[0], 'weird');
  assert.equal(P.riskMeta('high').cls, 'is-error');
  assert.equal(P.riskMeta('medium').cls, 'is-warn');
  assert.equal(P.riskMeta(undefined).label, '低风险');
});

test('buildQuery 跳过空值并编码参数', () => {
  assert.equal(P.buildQuery({}), '');
  assert.equal(P.buildQuery({ status: '', offset: 0, type: 'errors' }), '?offset=0&type=errors');
  assert.equal(P.buildQuery({ tool_id: 'a b' }), '?tool_id=a+b');
});

test('pluginPath / pluginIconUrl / isToolId 校验 ID', () => {
  assert.equal(P.pluginPath('md_to_epub'), '/plugins/md_to_epub');
  assert.equal(P.pluginPath('a/b'), '/plugins/a%2Fb');
  assert.equal(P.pluginIconUrl('md_to_epub'), '/get/tool/md_to_epub/icon');
  assert.equal(P.isToolId('md_to_epub'), true);
  assert.equal(P.isToolId('../etc'), false);
  assert.equal(P.isToolId('a b'), false);
  assert.equal(P.isToolId(''), false);
});

test('格式化函数对缺失值安全', () => {
  assert.equal(P.fmtTime(''), '—');
  assert.equal(P.fmtTime('not-a-date'), 'not-a-date');
  assert.equal(P.shortSha(''), '—');
  assert.equal(P.shortSha('a'.repeat(64)).length, 12);
  assert.equal(P.fmtBytes(0), '0 B');
  assert.equal(P.fmtBytes(2048), '2.0 KB');
});
