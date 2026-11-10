/* ============================================================
 * 插件中心 /plugins
 *
 * 数据全部来自 /api/plugins/*（只读聚合），写操作全部委托
 * 既有 /api/toolbox/*（安装器唯一实现），本文件不复制业务逻辑。
 * ============================================================ */
(function () {
  'use strict';

  const P = window.MyBooksPlugins;
  const TABS = ['overview', 'store', 'installed', 'tasks', 'settings'];
  const TASK_LIMIT = 20;
  const TASK_POLL_MS = 4000;
  const SOURCE_LABEL = { store: '商店安装', local: '本地安装', builtin: '内置', unknown: '未知来源' };

  const state = {
    tab: 'overview',
    overview: null,
    store: null,
    installed: null,
    tasks: null,
    security: null,
    storeQuery: '',
    storeSort: 'name',
    installedFilter: 'all',
    taskStatus: '',
    taskPlugin: '',
    taskOffset: 0,
    taskTimer: 0,
    searchTimer: 0,
    busy: new Set(),
    logsSeen: 0,
  };

  const $id = (id) => document.getElementById(id);

  function note(el, message, kind) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-warn', kind === 'warn');
  }

  function kvRows(rows) {
    return rows.map((row) => `
      <div class="pc-kv-row">
        <dt>${P.escapeHtml(row.label)}</dt>
        <dd${row.cls ? ` class="${row.cls}"` : ''}>${row.html != null ? row.html : P.escapeHtml(row.value)}</dd>
      </div>`).join('');
  }

  function badge(text, cls) {
    return `<span class="pc-badge${cls ? ' ' + cls : ''}">${P.escapeHtml(text)}</span>`;
  }

  function sourceLabel(source) {
    return SOURCE_LABEL[source] || source || '未知来源';
  }

  function setBusy(key, busy) {
    if (busy) state.busy.add(key); else state.busy.delete(key);
    document.querySelectorAll(`[data-busy-key="${key}"]`).forEach((el) => { el.disabled = busy; });
  }

  /* ---------------- Tab ---------------- */

  function setTab(tab, { filter } = {}) {
    state.tab = TABS.includes(tab) ? tab : 'overview';
    const target = state.tab;
    document.querySelectorAll('.pc-tabs [data-tab]').forEach((btn) => {
      const on = btn.dataset.tab === target;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    TABS.forEach((name) => {
      const panel = $id('pcPanel' + name.charAt(0).toUpperCase() + name.slice(1));
      if (panel) panel.classList.toggle('hidden', name !== target);
    });
    if (filter) setInstalledFilter(filter, { reload: false });
    if (history.replaceState) history.replaceState(null, '', '#' + target);
    loadTab(target);
    syncTaskPolling();
  }

  function loadTab(tab) {
    if (tab === 'overview') return loadOverview();
    if (tab === 'store') return loadStore();
    if (tab === 'installed') return loadInstalled();
    if (tab === 'tasks') return loadTasks();
    if (tab === 'settings') return loadSettings();
    return Promise.resolve();
  }

  /* ---------------- 总览 ---------------- */

  async function loadOverview({ silent = false } = {}) {
    const panel = $id('pcPanelOverview');
    if (!silent) panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request('/api/plugins/overview');
      state.overview = data;
      renderOverview(data);
      note($id('pcOverviewNote'), '', '');
    } catch (err) {
      note($id('pcOverviewNote'), '总览加载失败：' + P.errorText(err), 'error');
    } finally {
      panel.setAttribute('aria-busy', 'false');
    }
  }

  function renderOverview(data) {
    const metrics = P.overviewMetrics(data);
    $id('pcMetrics').innerHTML = metrics.map((m) => `
      <button type="button" class="pc-metric${m.unknown ? ' is-unknown' : ''}" data-tab="${m.tab}" data-filter="${m.filter || ''}">
        <span class="pc-metric-label">${P.escapeHtml(m.label)}</span>
        <span class="pc-metric-value">${P.escapeHtml(m.value)}</span>
        <span class="pc-metric-hint">${P.escapeHtml(m.hint)}</span>
      </button>`).join('');

    renderHero(data.runtime, data.security);
    $id('pcInstalledCount').textContent = String(data.counts.installed || '');
    $id('pcTaskCount').textContent = String(data.tasks.running || '');

    const runtime = data.runtime || {};
    const uid = data.security && data.security.uid_isolation;
    $id('pcRuntimeBody').innerHTML = kvRows([
      { label: '状态', html: runtime.online ? badge('在线', 'is-ok') : badge('离线', 'is-error') },
      { label: '隔离模式', value: P.runtimeModeLabel(runtime.isolation_mode, uid) },
      { label: '独立 UID', html: uid ? badge('已启用', 'is-ok') : badge('未启用', 'is-warn') },
      {
        label: '插件身份认证',
        value: runtime.plugin_auth_only === true ? '仅接受插件令牌'
          : runtime.plugin_auth_only === false ? '仍接受共享内部凭据（Legacy 兼容）' : '未知',
      },
      { label: 'HTTP 状态', value: runtime.status ? String(runtime.status) : '—' },
      { label: '说明', value: runtime.error || '插件运行在 Python 运行时中；共享 Worker 内进程不是安全边界。' },
    ]);

    // overview.security 只含聚合字段：风险等级、审查计数、共享 Worker 风险、允许未审查开关。
    const security = data.security || {};
    const unreviewedIds = Array.isArray(security.unreviewed) ? security.unreviewed : [];
    const risk = P.riskMeta(security.risk);
    const sharedRisk = P.riskMeta(security.shared_worker_risk);
    $id('pcSecurityBody').innerHTML = kvRows([
      { label: '风险等级', html: badge(risk.label, risk.cls) },
      { label: '已审查插件', value: String(Number(security.reviewed) || 0) },
      { label: '未审查插件', value: unreviewedIds.length ? unreviewedIds.join('、') : '无' },
      { label: '共享 Worker 风险', html: badge(sharedRisk.label, sharedRisk.cls) },
      { label: '允许未审查插件', html: security.allow_unreviewed ? badge('是', 'is-error') : badge('否', 'is-ok') },
      { label: '完整部署信息', html: '<button type="button" class="pc-link" data-tab="settings">查看设置页</button>' },
    ]);

    const errors = Array.isArray(data.recent_errors) ? data.recent_errors : [];
    $id('pcRecentErrors').innerHTML = errors.length
      ? errors.map((item) => `
        <a class="pc-list-row" href="${P.pluginPath(item.tool_id)}#logs">
          <span class="pc-list-main">
            <span class="pc-list-title">${P.escapeHtml(item.tool_id)}</span>
            <span class="pc-list-text">${P.escapeHtml(item.message)}</span>
          </span>
          <span class="pc-list-meta">${P.escapeHtml(item.source === 'task' ? '任务' : '插件')} · ${P.escapeHtml(P.fmtTime(item.at))}</span>
        </a>`).join('')
      : '<p class="tb-muted">最近没有记录到错误。</p>';

    const store = data.store || {};
    note($id('pcOverviewNote'),
      store.available ? '' : `商店索引不可用${store.error ? '：' + store.error : ''}；可更新数量未知，其他指标不受影响。`,
      'warn');
  }

  function renderHero(runtime, security) {
    const el = $id('pcRuntime');
    if (!el) return;
    const online = !!(runtime && runtime.online);
    el.classList.toggle('is-online', online);
    el.classList.toggle('is-offline', !online);
    const uid = security && security.uid_isolation;
    $id('pcRuntimeText').textContent = online
      ? `插件运行时在线 · ${P.runtimeModeLabel(runtime.isolation_mode, uid)}`
      : '插件运行时离线';
  }

  /* ---------------- 商店 ---------------- */

  async function loadStore({ refresh = false } = {}) {
    const panel = $id('pcPanelStore');
    panel.setAttribute('aria-busy', 'true');
    $id('pcStoreMeta').textContent = refresh ? '正在刷新商店索引…' : '正在获取工具商店…';
    try {
      const query = { q: state.storeQuery, sort: state.storeSort };
      if (refresh) query.refresh = '1';
      const data = await P.request('/api/plugins/store/index' + P.buildQuery(query));
      state.store = data;
      renderStore(data);
      note($id('pcStoreNote'), data.error ? '商店索引刷新失败：' + data.error + '（展示的是最近一次缓存）' : '', 'warn');
    } catch (err) {
      note($id('pcStoreNote'), '商店加载失败：' + P.errorText(err), 'error');
      if (!state.store) {
        $id('pcStoreList').innerHTML = '';
        $id('pcStoreEmpty').classList.add('hidden');
      }
    } finally {
      panel.setAttribute('aria-busy', 'false');
      $id('pcStoreMeta').textContent = state.store
        ? `${state.store.tools.length} 个插件 · ${state.store.fetched_at ? '商店更新于 ' + P.fmtTime(state.store.fetched_at) : '尚未成功获取商店索引'}`
        : '商店不可用';
    }
  }

  function renderStore(data) {
    const tools = Array.isArray(data.tools) ? data.tools : [];
    $id('pcStoreList').innerHTML = tools.map(storeCard).join('');
    $id('pcStoreEmpty').classList.toggle('hidden', tools.length > 0);
  }

  function storeCard(entry) {
    const action = P.storeAction(entry);
    const reviewed = entry.reviewed;
    const supported = !!(entry.compatibility && entry.compatibility.supported);
    const installed = entry.installed;
    return `
      <article class="pc-store-card" aria-labelledby="pcStoreName-${P.escapeHtml(entry.tool_id)}">
        <div class="pc-store-top">
          ${P.iconTile(entry.tool_id, entry.name, 'pc-store-icon')}
          <div class="pc-store-id">
            <h3 id="pcStoreName-${P.escapeHtml(entry.tool_id)}">${P.escapeHtml(entry.name || entry.tool_id)}</h3>
            <p class="tb-muted">${P.escapeHtml(entry.author || '未署名')} · v${P.escapeHtml(entry.latest_revision)}</p>
          </div>
        </div>
        <p class="pc-store-desc">${P.escapeHtml(entry.description || '作者没有提供简介。')}</p>
        <div class="pc-badges">
          ${reviewed ? badge('已审查', 'is-ok') : badge('待审查', 'is-warn')}
          ${supported ? badge('兼容', 'is-ok') : badge('不兼容', 'is-error')}
          ${installed ? badge('已安装 v' + installed.revision, 'is-muted') : ''}
        </div>
        <div class="pc-store-foot">
          <a class="btn btn-ghost btn-sm" href="${P.pluginPath(entry.tool_id)}">详情</a>
          <button type="button" class="btn btn-sm ${action.primary ? 'btn-primary' : 'btn-ghost'}"
            data-store-action="${P.escapeHtml(action.action)}"
            data-store-tool="${P.escapeHtml(entry.tool_id)}"
            data-busy-key="store:${P.escapeHtml(entry.tool_id)}"
            ${action.disabled ? 'disabled' : ''}
            ${action.reason ? `title="${P.escapeHtml(action.reason)}"` : ''}>${P.escapeHtml(action.label)}</button>
        </div>
        ${action.reason ? `<p class="pc-store-block">${P.escapeHtml(action.reason)}</p>` : ''}
      </article>`;
  }

  /* ---------------- 已安装 ---------------- */

  async function loadInstalled() {
    const panel = $id('pcPanelInstalled');
    panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request('/api/plugins/installed');
      state.installed = data;
      renderInstalled();
      note($id('pcInstalledNote'), data.runtime && !data.runtime.online
        ? '插件运行时离线：状态来自数据库记录，加载状态可能不准确。' : '', 'warn');
      renderTaskPluginOptions(data.tools);
    } catch (err) {
      note($id('pcInstalledNote'), '已安装列表加载失败：' + P.errorText(err), 'error');
    } finally {
      panel.setAttribute('aria-busy', 'false');
    }
  }

  function setInstalledFilter(filter, { reload = true } = {}) {
    state.installedFilter = filter || 'all';
    document.querySelectorAll('.pc-chip[data-filter]').forEach((chip) => {
      const on = chip.dataset.filter === state.installedFilter;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
    if (reload) renderInstalled();
  }

  function filteredInstalled() {
    const tools = (state.installed && state.installed.tools) || [];
    const filter = state.installedFilter;
    if (filter === 'enabled') return tools.filter((t) => t.enabled && !t.pending_restart);
    if (filter === 'disabled') return tools.filter((t) => !t.enabled);
    if (filter === 'update') return tools.filter((t) => t.update_available);
    if (filter === 'error') return tools.filter((t) => t.pending_restart || t.last_error || t.runtime_status === 'not_loaded');
    return tools;
  }

  function renderInstalled() {
    const tools = filteredInstalled();
    const all = (state.installed && state.installed.tools) || [];
    $id('pcInstalledCount').textContent = all.length ? String(all.length) : '';
    $id('pcInstalledList').innerHTML = tools.map(installedRow).join('');
    $id('pcInstalledEmpty').classList.toggle('hidden', tools.length > 0);
    $id('pcInstalledEmpty').textContent = all.length
      ? '当前筛选条件下没有插件。'
      : '还没有安装插件。可以在商店里安装第一个。';
  }

  function installedRow(tool) {
    const status = P.installedStatus(tool);
    const id = tool.tool_id;
    const busy = state.busy.has(id);
    const updateText = tool.update_available
      ? `可更新到 v${tool.latest_revision}`
      : tool.latest_revision === null || tool.latest_revision === undefined
        ? '商店状态未知'
        : '已是最新版本';
    const rollbackText = tool.rollback_available ? '可回滚到上一版本' : '没有可回滚版本';
    return `
      <div class="tb-row pc-installed-row">
        <div class="tb-row-main">
          ${P.iconTile(id, tool.name, 'pc-row-icon')}
          <div class="tb-row-text">
            <div class="tb-row-title">
              <a href="${P.pluginPath(id)}">${P.escapeHtml(tool.name || id)}</a>
              <span class="pc-badge ${status.cls}">${P.escapeHtml(status.label)}</span>
              <span class="pc-badge is-muted">v${P.escapeHtml(tool.revision)}</span>
              ${tool.pending_restart ? badge('待重启', 'is-warn') : ''}
            </div>
            <p class="tb-row-desc">${P.escapeHtml(sourceLabel(tool.source))} · ${P.escapeHtml(updateText)} · ${P.escapeHtml(rollbackText)}</p>
            ${tool.last_error ? `<p class="tb-row-error">${P.escapeHtml(tool.last_error)}</p>` : ''}
          </div>
        </div>
        <div class="tb-row-actions pc-row-actions">
          ${tool.enabled && tool.has_frontend ? `<a class="btn btn-ghost btn-sm" href="/toolbox/tool/${encodeURIComponent(id)}">打开</a>` : ''}
          <a class="btn btn-ghost btn-sm" href="${P.pluginPath(id)}">详情</a>
          <button type="button" class="btn btn-ghost btn-sm" data-installed-action="${tool.enabled ? 'disable' : 'enable'}"
            data-tool="${P.escapeHtml(id)}" data-busy-key="${P.escapeHtml(id)}" ${busy ? 'disabled' : ''}>${tool.enabled ? '停用' : '启用'}</button>
          ${tool.update_available ? `<button type="button" class="btn btn-ghost btn-sm" data-installed-action="update"
            data-tool="${P.escapeHtml(id)}" data-busy-key="${P.escapeHtml(id)}" ${busy ? 'disabled' : ''}>更新</button>` : ''}
          ${tool.rollback_available ? `<button type="button" class="btn btn-ghost btn-sm" data-installed-action="rollback"
            data-tool="${P.escapeHtml(id)}" data-busy-key="${P.escapeHtml(id)}" ${busy ? 'disabled' : ''}>回滚</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-installed-action="uninstall"
            data-tool="${P.escapeHtml(id)}" data-busy-key="${P.escapeHtml(id)}" ${busy ? 'disabled' : ''}>卸载</button>
        </div>
      </div>`;
  }

  /* ---------------- 任务 ---------------- */

  function renderTaskPluginOptions(tools) {
    const select = $id('pcTaskPlugin');
    const current = state.taskPlugin;
    const options = ['<option value="">全部插件</option>'].concat(
      (tools || []).map((tool) => `<option value="${P.escapeHtml(tool.tool_id)}">${P.escapeHtml(tool.name || tool.tool_id)}</option>`),
    ).join('');
    select.innerHTML = options;
    select.value = Array.isArray(tools) && tools.some((tool) => tool.tool_id === current) ? current : '';
    state.taskPlugin = select.value;
  }

  async function loadTasks({ silent = false } = {}) {
    const panel = $id('pcPanelTasks');
    if (!silent) panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request('/api/plugins/tasks' + P.buildQuery({
        tool_id: state.taskPlugin,
        status: state.taskStatus,
        limit: TASK_LIMIT,
        offset: state.taskOffset,
      }));
      state.tasks = data;
      renderTasks(data);
      note($id('pcTaskNote'), '', '');
    } catch (err) {
      if (!silent) note($id('pcTaskNote'), '任务加载失败：' + P.errorText(err), 'error');
    } finally {
      if (!silent) panel.setAttribute('aria-busy', 'false');
      syncTaskPolling();
    }
  }

  function renderTasks(data) {
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    $id('pcTaskList').innerHTML = tasks.map(taskRow).join('');
    $id('pcTaskEmpty').classList.toggle('hidden', tasks.length > 0);

    const running = tasks.filter((task) => task.status === 'running').length;
    $id('pcTaskCount').textContent = running ? String(running) : '';

    const total = Number(data.total) || 0;
    const from = total ? Number(data.offset) + 1 : 0;
    const to = Number(data.offset) + tasks.length;
    $id('pcTaskPageInfo').textContent = total ? `${from}–${to} / ${total}` : '—';
    $id('pcTaskPrev').disabled = Number(data.offset) <= 0;
    $id('pcTaskNext').disabled = to >= total;
  }

  function taskRow(task) {
    const [label, cls] = P.taskStatusMeta(task.status);
    const progress = Number(task.progress);
    const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;
    return `
      <div class="tb-row pc-task-row">
        <div class="tb-row-main">
          <div class="tb-row-text">
            <div class="tb-row-title">
              <button type="button" class="pc-link" data-task-id="${P.escapeHtml(task.id)}">#${P.escapeHtml(task.id)} ${P.escapeHtml(task.operation || '任务')}</button>
              <span class="pc-badge ${cls}">${P.escapeHtml(label)}</span>
              <span class="pc-badge is-muted">${P.escapeHtml(task.tool_id)}</span>
            </div>
            <p class="tb-row-desc">${P.escapeHtml(task.stage || '—')} · 开始 ${P.escapeHtml(P.fmtTime(task.created_at))}${task.finished_at ? ' · 结束 ' + P.escapeHtml(P.fmtTime(task.finished_at)) : ''}</p>
            ${pct === null ? '' : `
              <div class="pc-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="任务进度">
                <span style="width:${pct}%"></span>
              </div>`}
            ${task.error ? `<p class="tb-row-error">${P.escapeHtml(task.error)}</p>` : ''}
          </div>
        </div>
        <div class="tb-row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-task-id="${P.escapeHtml(task.id)}">详情</button>
          ${task.status === 'running' ? `<button type="button" class="btn btn-ghost btn-sm" data-task-cancel="${P.escapeHtml(task.id)}" data-busy-key="task:${P.escapeHtml(task.id)}">取消</button>` : ''}
        </div>
      </div>`;
  }

  function syncTaskPolling() {
    const tasks = (state.tasks && state.tasks.tasks) || [];
    const running = tasks.some((task) => task.status === 'running');
    const should = state.tab === 'tasks' && document.visibilityState === 'visible' && running;
    if (should && !state.taskTimer) {
      state.taskTimer = setInterval(() => {
        if (state.tab !== 'tasks' || document.visibilityState !== 'visible') { syncTaskPolling(); return; }
        loadTasks({ silent: true });
      }, TASK_POLL_MS);
    } else if (!should && state.taskTimer) {
      clearInterval(state.taskTimer);
      state.taskTimer = 0;
    }
  }

  async function openTask(id) {
    const body = $id('pcTaskModalBody');
    body.innerHTML = '<p class="tb-muted">正在读取任务详情…</p>';
    if (typeof openModal === 'function') openModal('#pcTaskModal');
    try {
      const data = await P.request('/api/plugins/tasks/' + encodeURIComponent(id));
      body.innerHTML = renderTaskDetail(data);
    } catch (err) {
      body.innerHTML = `<div class="tb-note is-error">任务详情加载失败：${P.escapeHtml(P.errorText(err))}</div>`;
    }
  }

  function renderTaskDetail(data) {
    const task = data.task || {};
    const [label, cls] = P.taskStatusMeta(task.status);
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    return `
      <dl class="pc-kv">
        ${kvRows([
          { label: '任务', value: `#${task.id} ${task.operation || ''}` },
          { label: '插件', value: (data.plugin && (data.plugin.name || data.plugin.tool_id)) || task.tool_id || '—' },
          { label: '状态', html: badge(label, cls) },
          { label: '阶段', value: task.stage || '—' },
          { label: '进度', value: task.progress == null ? '—' : `${task.progress}%` },
          { label: '开始 / 结束', value: `${P.fmtTime(task.created_at)} / ${P.fmtTime(task.finished_at)}` },
          { label: '关联书籍', html: data.book ? `<a href="/shelf?q=${encodeURIComponent(data.book.title || '')}">${P.escapeHtml(data.book.title)}</a>` : '—' },
          { label: '消息', value: task.message || '—' },
          { label: '错误', value: task.error || '—', cls: task.error ? 'pc-text-error' : '' },
        ])}
      </dl>
      <h3 class="pc-subhead">产物（Artifact）</h3>
      ${artifacts.length ? `
        <ul class="pc-artifact-list">
          ${artifacts.map((item) => `
            <li>
              <span class="pc-artifact-title">${P.escapeHtml(item.title || item.format || '产物')}</span>
              <span class="tb-muted">${P.escapeHtml(item.format || '')} · ${P.escapeHtml(P.fmtBytes(item.size))} · ${P.escapeHtml(P.shortSha(item.sha256))}</span>
            </li>`).join('')}
        </ul>` : '<p class="tb-muted">该任务没有产物记录。</p>'}`;
  }

  /* ---------------- 设置 ---------------- */

  async function loadSettings() {
    const panel = $id('pcPanelSettings');
    panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request('/api/plugins/security');
      state.security = data;
      renderSettings(data);
    } catch (err) {
      note($id('pcSettingsNote'), '部署信息加载失败：' + P.errorText(err), 'error');
    } finally {
      panel.setAttribute('aria-busy', 'false');
    }
  }

  function renderSettings(data) {
    const runtime = data.runtime || {};
    const policy = data.policy || {};
    const env = data.env || {};
    const plugins = data.plugins || {};
    const risk = P.riskMeta(data.risk);
    const policyInfo = P.policyMeta(policy.state);
    $id('pcSettingsBody').innerHTML = kvRows([
      { label: '风险等级', html: badge(risk.label, risk.cls) },
      { label: 'Runtime 模式', value: P.runtimeModeLabel(runtime.isolation_mode, runtime.uid && runtime.uid.enabled) },
      { label: 'Runtime 在线', html: runtime.online ? badge('在线', 'is-ok') : badge('离线', 'is-error') },
      {
        label: '身份认证',
        value: runtime.plugin_auth_only === true ? '仅接受插件令牌'
          : runtime.plugin_auth_only === false ? '接受共享内部凭据（Legacy 兼容）' : '未知',
      },
      { label: 'Node 侧认证策略', value: runtime.node_plugin_auth_only ? 'MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=1' : '未强制' },
      {
        label: 'UID 隔离',
        html: runtime.uid && runtime.uid.enabled ? badge('已启用', 'is-ok') : badge('未启用', 'is-warn'),
      },
      {
        label: 'UID 缺少能力',
        value: runtime.uid && runtime.uid.missing_capabilities && runtime.uid.missing_capabilities.length
          ? runtime.uid.missing_capabilities.join('、') : '无',
      },
      { label: '权限策略', html: badge(policyInfo.label, policyInfo.cls) },
      { label: '严格策略插件', value: String((policy.strict_tools || []).length) },
      { label: '未配置策略插件', value: (policy.unconfigured_tools || []).join('、') || '无' },
      { label: '已审查 / 未审查', value: `${Number(plugins.reviewed) || 0} / ${Number(plugins.unreviewed) || 0}` },
      { label: '允许未审查插件', html: env.allow_unreviewed ? badge('是', 'is-error') : badge('否', 'is-ok') },
      { label: 'Legacy 兼容模式', html: env.legacy_compat ? badge('开启', 'is-warn') : badge('关闭', 'is-ok') },
      {
        label: 'Node / Runtime 路径',
        html: runtime.path && runtime.path.mismatch ? badge('不一致', 'is-error')
          : runtime.path && runtime.path.checked ? badge('一致', 'is-ok') : badge('未核对', 'is-warn'),
      },
      { label: '未审查插件', value: (plugins.unreviewed && plugins.unreviewed.length ? plugins.unreviewed.join('、') : '无') },
    ]);
  }

  function deploymentAdvice() {
    const data = state.security || {};
    const runtime = data.runtime || {};
    const lines = [
      'MyBooks 插件部署建议（只读，未自动修改）：',
      `1. 隔离：设置 TOOLBOX_ISOLATE_PLUGINS=1，使插件运行在独立子进程；当前模式 ${P.runtimeModeLabel(runtime.isolation_mode, runtime.uid && runtime.uid.enabled)}。`,
      `2. 独立 UID：设置 TOOLBOX_CHILD_UID_BASE 让每个插件使用独立 UID；当前 ${runtime.uid && runtime.uid.enabled ? '已启用' : '未启用'}。`,
      '3. 内部认证：设置 MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=1，拒绝共享内部凭据。',
      '4. 未审查插件：保持 MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED 关闭，安装仍需经过 allowlist。',
      '5. 修改后重启 toolbox-runtime 与 Node 服务，再到本页核对路径一致性与加载状态。',
    ];
    return lines.join('\n');
  }

  async function copyAdvice() {
    const text = deploymentAdvice();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      P.toast('部署建议已复制');
    } catch {
      P.toast('复制失败，请手动选择文本', true);
    }
  }

  /* ---------------- 写操作（全部委托 /api/toolbox/*） ---------------- */

  async function refreshAfterWrite() {
    await Promise.all([loadOverview({ silent: true }), loadInstalled()]);
    if (state.tab === 'store' && state.store) await loadStore();
  }

  async function installFromStore(toolId) {
    const entry = ((state.store && state.store.tools) || []).find((item) => item.tool_id === toolId);
    if (!entry) return;
    const action = P.storeAction(entry);
    if (action.disabled) return;
    const target = action.action === 'update' ? `更新 ${entry.name} 到 v${entry.latest_revision}` : `安装 ${entry.name} v${entry.latest_revision}`;
    const answer = await P.confirmAction({
      title: action.action === 'update' ? '更新插件' : '安装插件',
      message: `${target}？安装包会先校验 SHA-256；未审查插件不会因为这次操作被放行。`,
      detailsHtml: `<p class="tb-muted">来源：${P.escapeHtml(entry.author || '未署名')} · 版本 v${P.escapeHtml(entry.latest_revision)}</p>`,
      confirmLabel: action.label,
    });
    if (!answer.ok) return;
    setBusy('store:' + toolId, true);
    try {
      const result = action.action === 'update'
        ? await P.request(`/api/toolbox/${encodeURIComponent(toolId)}/update`, { method: 'POST' })
        : await P.request('/api/toolbox/install', { method: 'POST', body: JSON.stringify({ tool_id: toolId }) });
      P.toast(`${entry.name} 已提交安装${result && result.revision ? ' v' + result.revision : ''}，正在刷新状态`);
    } catch (err) {
      if (err.status === 409) {
        P.toast('商店版本已变化或存在冲突，已刷新数据', true);
      } else {
        P.toast('操作失败：' + P.errorText(err), true);
      }
    } finally {
      setBusy('store:' + toolId, false);
    }
    await refreshAfterWrite();
  }

  async function installedAction(action, toolId) {
    const tool = ((state.installed && state.installed.tools) || []).find((item) => item.tool_id === toolId);
    if (!tool) return;
    const name = tool.name || toolId;
    const map = {
      enable: { title: '启用插件', message: `启用 ${name}？启用后插件接口立即可用。`, label: '启用', url: `/api/toolbox/${encodeURIComponent(toolId)}/enable` },
      disable: { title: '停用插件', message: `停用 ${name}？停用会立即阻断该插件的所有接口。`, label: '停用', url: `/api/toolbox/${encodeURIComponent(toolId)}/disable`, danger: true },
      update: { title: '更新插件', message: `把 ${name} 更新到商店最新版本？`, label: '更新', url: `/api/toolbox/${encodeURIComponent(toolId)}/update` },
      rollback: { title: '回滚插件', message: `把 ${name} 回滚到上一版本？回滚会替换当前安装文件。`, label: '回滚', url: `/api/toolbox/${encodeURIComponent(toolId)}/rollback`, danger: true },
    };
    const preset = map[action];
    if (!preset) return;
    const answer = await P.confirmAction({
      title: preset.title,
      message: preset.message,
      confirmLabel: preset.label,
      danger: !!preset.danger,
    });
    if (!answer.ok) return;
    setBusy(toolId, true);
    try {
      await P.request(preset.url, { method: 'POST' });
      P.toast(`${name}：${preset.label}请求已提交，正在重新读取状态`);
    } catch (err) {
      P.toast('操作失败：' + P.errorText(err), true);
      if (err.status === 409) P.toast('状态已变化，正在刷新数据', true);
    } finally {
      setBusy(toolId, false);
    }
    await refreshAfterWrite();
  }

  async function uninstall(toolId) {
    const tool = ((state.installed && state.installed.tools) || []).find((item) => item.tool_id === toolId);
    const name = (tool && tool.name) || toolId;
    const answer = await P.confirmAction({
      title: '卸载插件',
      message: `卸载 ${name}？默认保留插件私有数据，之后重新安装仍可继续使用。`,
      checkboxLabel: '同时删除插件配置与数据（不可恢复）',
      confirmLabel: '卸载',
      danger: true,
    });
    if (!answer.ok) return;
    setBusy(toolId, true);
    try {
      const suffix = answer.checked ? '?purge_data=1' : '';
      await P.request(`/api/toolbox/${encodeURIComponent(toolId)}${suffix}`, { method: 'DELETE' });
      P.toast(answer.checked ? `${name} 已卸载并删除数据` : `${name} 已卸载，插件数据已保留`);
    } catch (err) {
      P.toast('卸载失败：' + P.errorText(err), true);
    } finally {
      setBusy(toolId, false);
    }
    await refreshAfterWrite();
  }

  async function cancelTask(taskId) {
    const answer = await P.confirmAction({
      title: '取消任务',
      message: `取消任务 #${taskId}？插件可能已经写入部分结果。`,
      confirmLabel: '取消任务',
      danger: true,
    });
    if (!answer.ok) return;
    setBusy('task:' + taskId, true);
    try {
      await P.request(`/api/toolbox/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
      P.toast('取消请求已提交');
    } catch (err) {
      P.toast('取消失败：' + P.errorText(err), true);
    } finally {
      setBusy('task:' + taskId, false);
    }
    await loadTasks({ silent: true });
  }

  async function restartRuntime() {
    const answer = await P.confirmAction({
      title: '重启插件运行时',
      message: '重启期间所有插件接口会短暂不可用，正在运行的任务可能中断。',
      confirmLabel: '重启',
      danger: true,
    });
    if (!answer.ok) return;
    $id('pcRestartRuntime').disabled = true;
    try {
      await P.request('/api/toolbox/runtime/restart', { method: 'POST' });
      P.toast('运行时重启请求已提交，正在重新检测');
    } catch (err) {
      P.toast('重启失败：' + P.errorText(err), true);
    } finally {
      $id('pcRestartRuntime').disabled = false;
    }
    await loadOverview({ silent: true });
    if (state.tab === 'installed') await loadInstalled();
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    document.querySelectorAll('.pc-tabs [data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    $id('pcMetrics').addEventListener('click', (event) => {
      const card = event.target.closest('[data-tab]');
      if (!card) return;
      setTab(card.dataset.tab, { filter: card.dataset.filter || undefined });
    });
    $id('pcSecurityBody').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-tab]');
      if (btn) setTab(btn.dataset.tab);
    });

    $id('pcStoreSearch').addEventListener('input', (event) => {
      state.storeQuery = event.target.value.trim();
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => loadStore(), 250);
    });
    $id('pcStoreSort').addEventListener('change', (event) => {
      state.storeSort = event.target.value;
      loadStore();
    });
    $id('pcStoreRefresh').addEventListener('click', () => loadStore({ refresh: true }));
    $id('pcStoreList').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-store-action]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.storeAction === 'install' || btn.dataset.storeAction === 'update') {
        installFromStore(btn.dataset.storeTool);
      }
    });

    document.querySelectorAll('.pc-chip[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => setInstalledFilter(chip.dataset.filter));
    });
    $id('pcInstalledRefresh').addEventListener('click', () => loadInstalled());
    $id('pcInstalledList').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-installed-action]');
      if (!btn || btn.disabled) return;
      const toolId = btn.dataset.tool;
      const action = btn.dataset.installedAction;
      if (action === 'uninstall') uninstall(toolId);
      else installedAction(action, toolId);
    });

    $id('pcTaskPlugin').addEventListener('change', (event) => {
      state.taskPlugin = event.target.value;
      state.taskOffset = 0;
      loadTasks();
    });
    $id('pcTaskStatus').addEventListener('change', (event) => {
      state.taskStatus = event.target.value;
      state.taskOffset = 0;
      loadTasks();
    });
    $id('pcTaskRefresh').addEventListener('click', () => loadTasks());
    $id('pcTaskPrev').addEventListener('click', () => {
      state.taskOffset = Math.max(0, state.taskOffset - TASK_LIMIT);
      loadTasks();
    });
    $id('pcTaskNext').addEventListener('click', () => {
      state.taskOffset += TASK_LIMIT;
      loadTasks();
    });
    $id('pcTaskList').addEventListener('click', (event) => {
      const cancel = event.target.closest('[data-task-cancel]');
      if (cancel) { cancelTask(cancel.dataset.taskCancel); return; }
      const detail = event.target.closest('[data-task-id]');
      if (detail) openTask(detail.dataset.taskId);
    });

    $id('pcCopyAdvice').addEventListener('click', copyAdvice);
    $id('pcRestartRuntime').addEventListener('click', restartRuntime);
    document.addEventListener('visibilitychange', syncTaskPolling);

    // Tab 键盘操作：← → Home End
    document.querySelector('.pc-tabs').addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      const buttons = [...document.querySelectorAll('.pc-tabs [data-tab]')];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      buttons[next].focus();
      setTab(buttons[next].dataset.tab);
    });
  }

  function init() {
    P.bindIconFallback();
    bind();
    const hash = (location.hash || '').replace('#', '');
    const tab = TABS.includes(hash) ? hash : 'overview';
    // 先渲染一次壳，再按 hash 切 tab（避免未加载 tab 的空白）
    setTab(tab);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
