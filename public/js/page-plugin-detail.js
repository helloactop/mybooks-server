/* ============================================================
 * 插件详情 /plugins/:id
 *
 * 只读聚合来自 /api/plugins/:id*；生命周期写操作继续调用 /api/toolbox/*。
 * 未安装的插件从商店详情读取，避免把“还没装”误报成“页面不存在”。
 * ============================================================ */
(function () {
  'use strict';

  const P = window.MyBooksPlugins;
  const TABS = ['overview', 'permissions', 'config', 'versions', 'logs'];
  const LOG_LIMIT = 20;
  const SOURCE_LABEL = { store: '商店安装', local: '本地安装', builtin: '内置', unknown: '未知来源' };

  const state = {
    id: '',
    detail: null,
    storeEntry: null,
    notInstalled: false,
    tab: 'overview',
    permissions: null,
    permDraft: null,
    permSaving: false,
    config: null,
    configFields: [],
    configState: {},
    configSaving: false,
    versions: null,
    logs: null,
    logType: 'errors',
    logOffset: 0,
    logSince: '',
    loaded: {},
    busy: false,
  };

  const F = window.MyBooksConfigForm;

  const $id = (id) => document.getElementById(id);

  function badge(text, cls) {
    return `<span class="pc-badge${cls ? ' ' + cls : ''}">${P.escapeHtml(text)}</span>`;
  }

  function kvRows(rows) {
    return rows.map((row) => `
      <div class="pc-kv-row">
        <dt>${P.escapeHtml(row.label)}</dt>
        <dd${row.cls ? ` class="${row.cls}"` : ''}>${row.html != null ? row.html : P.escapeHtml(row.value == null ? '—' : row.value)}</dd>
      </div>`).join('');
  }

  function note(el, message, kind) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-warn', kind === 'warn');
  }

  function sourceLabel(source) {
    return SOURCE_LABEL[source] || source || '未知来源';
  }

  /* ---------------- 入口与加载 ---------------- */

  function pluginIdFromPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    const raw = parts.length > 1 ? decodeURIComponent(parts[1]) : '';
    return P.isToolId(raw) ? raw : '';
  }

  async function init() {
    P.bindIconFallback();
    bind();
    state.id = pluginIdFromPath();
    if (!state.id) { location.replace('/plugins'); return; }
    await loadPlugin();
  }

  async function loadPlugin() {
    $id('pdHead').setAttribute('aria-busy', 'true');
    note($id('pdPageError'), '', '');
    try {
      state.detail = await P.request('/api/plugins/' + encodeURIComponent(state.id));
      state.notInstalled = false;
      state.storeEntry = null;
    } catch (err) {
      if (err.status === 404) {
        try {
          const data = await P.request('/api/plugins/store/' + encodeURIComponent(state.id));
          state.storeEntry = data.tool;
          state.notInstalled = true;
          state.detail = null;
        } catch (storeErr) {
          renderNotFound(storeErr);
          return;
        }
      } else {
        renderFatal(err);
        return;
      }
    }
    renderHead();
    const hash = (location.hash || '').replace('#', '');
    setTab(TABS.includes(hash) ? hash : 'overview');
  }

  function renderNotFound(err) {
    $id('pdHead').setAttribute('aria-busy', 'false');
    $id('pdName').textContent = '插件不存在';
    $id('pdSub').textContent = '本机没有安装该插件，商店中也没有这个 ID。';
    $id('pdBadges').innerHTML = '';
    $id('pdActions').innerHTML = '';
    $id('pdTabs').hidden = true;
    TABS.forEach((name) => {
      const panel = $id('pdPanel' + name.charAt(0).toUpperCase() + name.slice(1));
      if (panel) panel.classList.add('hidden');
    });
    const message = err && err.code === 'STORE_NOT_FOUND'
      ? `插件 ID「${state.id}」既未安装，也不在商店索引中。`
      : '插件不在商店索引中，可能商店索引暂不可用。';
    note($id('pdPageError'), message, 'error');
  }

  function renderFatal(err) {
    $id('pdHead').setAttribute('aria-busy', 'false');
    $id('pdName').textContent = '加载失败';
    $id('pdSub').textContent = '无法读取插件信息。';
    note($id('pdPageError'), '插件信息加载失败：' + P.errorText(err), 'error');
  }

  function descriptor() {
    return (state.detail && state.detail.plugin) || null;
  }

  function pluginView() {
    if (state.detail) {
      const d = descriptor();
      return {
        id: d.id,
        name: (d.identity && d.identity.name) || d.id,
        author: (d.identity && d.identity.author && d.identity.author.name) || '',
        description: (d.metadata && d.metadata.description) || '',
        version: (d.version || state.detail.installed.revision || ''),
        trust: d.trust,
        manifestVersion: d.manifest_version,
        source: d.source,
      };
    }
    const entry = state.storeEntry || {};
    return {
      id: entry.tool_id || state.id,
      name: entry.name || state.id,
      author: entry.author || '',
      description: entry.description || '',
      version: entry.latest_revision || '',
      trust: entry.reviewed ? 'reviewed' : 'unreviewed',
      manifestVersion: null,
      source: '',
    };
  }

  /* ---------------- 头部 ---------------- */

  function renderHead() {
    const view = pluginView();
    document.title = `${view.name} · 插件中心 · My books`;
    $id('pdHead').setAttribute('aria-busy', 'false');
    $id('pdIcon').innerHTML = P.iconTile(view.id, view.name, 'pc-detail-icon-img');
    $id('pdName').textContent = view.name;
    $id('pdSub').textContent = [
      view.author || '未署名',
      view.version ? 'v' + view.version : '',
      view.description || '',
    ].filter(Boolean).join(' · ');

    const trust = P.trustMeta(view.trust);
    const status = state.notInstalled
      ? { label: '未安装', cls: 'is-muted' }
      : P.detailStatus(state.detail.installed, state.detail.runtime);
    const badges = [badge(status.label, status.cls), badge(trust.label, trust.cls)];
    if (view.manifestVersion !== null && view.manifestVersion !== undefined) {
      badges.push(badge(view.manifestVersion === 0 ? 'Legacy Manifest' : `Manifest v${view.manifestVersion}`, 'is-muted'));
    }
    if (!state.notInstalled && state.detail.latest && state.detail.latest.reviewed) {
      badges.push(badge('商店版本已审查', 'is-ok'));
    }
    $id('pdBadges').innerHTML = badges.join('');
    renderActions();
  }

  function renderActions() {
    const actions = [];
    const view = pluginView();
    if (state.notInstalled) {
      const entry = state.storeEntry || {};
      const action = P.storeAction(entry);
      actions.push(`<a class="btn btn-ghost btn-sm" href="/plugins">返回列表</a>`);
      actions.push(`<button type="button" class="btn ${action.primary ? 'btn-primary' : 'btn-ghost'} btn-sm"
        data-detail-action="${action.action === 'install' ? 'install' : 'blocked'}"
        ${action.disabled ? 'disabled' : ''}
        ${action.reason ? `title="${P.escapeHtml(action.reason)}"` : ''}>${P.escapeHtml(action.action === 'install' ? '安装' : action.label)}</button>`);
      if (action.reason) actions.push(`<span class="pc-action-hint">${P.escapeHtml(action.reason)}</span>`);
      $id('pdActions').innerHTML = actions.join('');
      return;
    }

    const installed = state.detail.installed || {};
    const runtime = state.detail.runtime || {};
    const d = descriptor();
    const hasFrontend = !!(d && (d.frontend.entry || ((d.ui.pages || []).length)));
    if (installed.enabled && hasFrontend) {
      actions.push(`<a class="btn btn-ghost btn-sm" href="/toolbox/tool/${encodeURIComponent(view.id)}">打开</a>`);
    }
    actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-detail-action="${installed.enabled ? 'disable' : 'enable'}">${installed.enabled ? '停用' : '启用'}</button>`);
    if (state.detail.latest && state.detail.latest.revision
      && state.detail.latest.revision !== installed.revision
      && state.detail.latest.compatibility && state.detail.latest.compatibility.supported) {
      actions.push('<button type="button" class="btn btn-ghost btn-sm" data-detail-action="update">更新</button>');
    }
    if (state.detail.rollback && state.detail.rollback.available) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-detail-action="rollback">回滚到 v${P.escapeHtml(state.detail.rollback.revision || '')}</button>`);
    }
    actions.push('<button type="button" class="btn btn-ghost btn-sm" data-detail-action="uninstall">卸载</button>');
    if (runtime.online && !runtime.loaded && installed.enabled) {
      actions.push('<span class="pc-action-hint">已启用但运行时尚未加载该插件</span>');
    }
    $id('pdActions').innerHTML = actions.join('');
  }

  /* ---------------- Tab ---------------- */

  function setTab(tab) {
    state.tab = TABS.includes(tab) ? tab : 'overview';
    document.querySelectorAll('#pdTabs [data-tab]').forEach((btn) => {
      const on = btn.dataset.tab === state.tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    TABS.forEach((name) => {
      const panel = $id('pdPanel' + name.charAt(0).toUpperCase() + name.slice(1));
      if (panel) panel.classList.toggle('hidden', name !== state.tab);
    });
    if (history.replaceState) history.replaceState(null, '', '#' + state.tab);
    loadTab(state.tab);
  }

  function loadTab(tab) {
    if (tab === 'overview') return renderOverview();
    if (state.notInstalled) return renderNotInstalledTab(tab);
    if (tab === 'permissions') return loadPermissions();
    if (tab === 'config') return loadConfig();
    if (tab === 'versions') return loadVersions();
    if (tab === 'logs') return loadLogs();
    return Promise.resolve();
  }

  function renderNotInstalledTab(tab) {
    const text = '插件尚未安装，安装后才能查看该分区。';
    if (tab === 'permissions') {
      $id('pdPermSummary').innerHTML = '';
      $id('pdPermList').innerHTML = `<p class="tb-muted">${text}</p>`;
      $id('pdPermSave').disabled = true;
      $id('pdPermReset').disabled = true;
      $id('pdPermStatus').textContent = '插件未安装';
      note($id('pdPermNote'), text, 'warn');
    } else if (tab === 'config') {
      $id('pdConfigBody').innerHTML = `<p class="tb-muted">${text}</p>`;
      setConfigBar('disabled', '插件未安装');
      note($id('pdConfigNote'), text, 'warn');
    } else if (tab === 'versions') {
      $id('pdVersionBody').innerHTML = kvRows([
        { label: '商店最新版本', value: (state.storeEntry && state.storeEntry.latest_revision) || '—' },
        { label: '安装状态', html: badge('未安装', 'is-muted') },
      ]);
      $id('pdVersionHistory').innerHTML = '';
      note($id('pdVersionNote'), text, 'warn');
    } else if (tab === 'logs') {
      $id('pdLogList').innerHTML = '';
      $id('pdLogEmpty').classList.remove('hidden');
      $id('pdLogEmpty').textContent = text;
      note($id('pdLogNote'), text, 'warn');
    }
    return Promise.resolve();
  }

  /* ---------------- 概览 ---------------- */

  function renderOverview() {
    const panel = $id('pdPanelOverview');
    const d = descriptor();
    if (!d) {
      $id('pdOverviewBody').innerHTML = kvRows([
        { label: '安装状态', html: badge('未安装', 'is-muted') },
        { label: '商店版本', value: (state.storeEntry && state.storeEntry.latest_revision) || '—' },
        { label: '作者', value: (state.storeEntry && state.storeEntry.author) || '未署名' },
        { label: '审查状态', html: state.storeEntry && state.storeEntry.reviewed ? badge('已审查', 'is-ok') : badge('待审查', 'is-warn') },
      ]);
      $id('pdOverviewExtra').hidden = !(state.storeEntry && state.storeEntry.description);
      $id('pdDescription').textContent = (state.storeEntry && state.storeEntry.description) || '';
      panel.setAttribute('aria-busy', 'false');
      return Promise.resolve();
    }

    const installed = state.detail.installed || {};
    const runtime = state.detail.runtime || {};
    const compat = d.compatibility || {};
    const counts = state.detail.task_counts || {};
    const reasons = (compat.reasons || []).map((item) => item.message).filter(Boolean);
    const warnings = compat.warnings || [];
    $id('pdOverviewBody').innerHTML = kvRows([
      { label: '插件 ID', value: d.id },
      { label: '版本', value: installed.revision || d.version || '—' },
      { label: 'Manifest 版本', value: d.manifest_version === 0 ? 'Legacy（0）' : String(d.manifest_version) },
      { label: 'Core API', value: `${compat.core_api_version || '—'}（宿主 ${compat.host_core_api_version || '—'}）` },
      { label: '兼容性', html: compat.supported ? badge('兼容', 'is-ok') : badge('不兼容', 'is-error') },
      { label: '信任状态', html: (() => { const t = P.trustMeta(d.trust); return badge(t.label, t.cls); })() },
      { label: '安装来源', value: sourceLabel(installed.source || d.source) },
      { label: '安装时间', value: P.fmtTime(installed.installed_at) },
      { label: 'SHA-256', value: P.shortSha(installed.sha256) },
      { label: 'Runtime', html: runtime.online ? badge('在线', 'is-ok') : badge('离线', 'is-error') },
      { label: '加载状态', html: runtime.loaded ? badge('已加载', 'is-ok') : badge('未加载', 'is-warn') },
      { label: '隔离模式', value: P.runtimeModeLabel(runtime.isolation_mode, null) },
      { label: '前端入口', value: d.frontend.entry || ((d.ui.pages || []).length ? `${(d.ui.pages || []).length} 个页面` : '无') },
      { label: '任务计数', value: `运行 ${Number(counts.running) || 0} · 完成 ${Number(counts.completed) || 0} · 失败 ${Number(counts.failed) || 0}` },
      { label: '持久化数据', value: d.resources && d.resources.data ? '声明了 data 目录' : '未声明' },
      { label: '兼容性原因', value: reasons.length ? reasons.join('；') : '无' },
      { label: '兼容性提示', value: warnings.length ? warnings.join('；') : '无' },
      { label: '最近错误', value: installed.last_error || '无', cls: installed.last_error ? 'pc-text-error' : '' },
    ]);
    $id('pdOverviewExtra').hidden = !d.metadata.description;
    $id('pdDescription').textContent = d.metadata.description || '';
    panel.setAttribute('aria-busy', 'false');
    return Promise.resolve();
  }

  /* ---------------- 权限（可授予 / 撤销 / 改 scope） ---------------- */

  const RISK_META = {
    high: { label: '高风险', cls: 'is-error' },
    medium: { label: '中风险', cls: 'is-warn' },
    low: { label: '低风险', cls: 'is-muted' },
  };

  async function loadPermissions() {
    const panel = $id('pdPanelPermissions');
    panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request(`/api/plugins/${encodeURIComponent(state.id)}/permissions`);
      state.permissions = data;
      resetPermDraft(data);
      renderPermissions(data);
      note($id('pdPermNote'), '', '');
    } catch (err) {
      note($id('pdPermNote'), '权限信息加载失败：' + P.errorText(err), 'error');
    } finally {
      panel.setAttribute('aria-busy', 'false');
    }
  }

  function catalogIndex(data) {
    const map = new Map();
    for (const item of data.catalog || []) map.set(item.name, item);
    return map;
  }

  function resetPermDraft(data) {
    const granted = new Map();
    for (const item of data.effective || []) {
      if (!granted.has(item.permission)) granted.set(item.permission, []);
      granted.get(item.permission).push(item.scope);
    }
    const draft = new Map();
    for (const permission of data.requested || []) {
      const scopes = granted.get(permission.name);
      const fallback = permission.scope
        || (permission.resource_scoped ? 'library:all' : '*');
      draft.set(permission.name, {
        enabled: !!scopes,
        scope: scopes && scopes.length ? scopes[0] : fallback,
        grantedScopes: scopes || [],
      });
    }
    state.permDraft = { draft, baseline: permSignature(), dirty: false };
  }

  function permSignature() {
    const draft = state.permDraft && state.permDraft.draft;
    if (!draft) return '';
    return JSON.stringify([...draft.entries()].map(([name, row]) => [name, row.enabled, row.scope])
      .sort((a, b) => a[0].localeCompare(b[0])));
  }

  function updatePermBar() {
    if (!state.permDraft) return;
    const dirty = permSignature() !== state.permDraft.baseline;
    state.permDraft.dirty = dirty;
    const editable = !!(state.permissions && state.permissions.can_modify);
    $id('pdPermSave').disabled = !dirty || !editable || state.permSaving;
    $id('pdPermReset').disabled = !dirty || state.permSaving;
    const status = $id('pdPermStatus');
    if (state.permSaving) status.textContent = '正在保存…';
    else if (!editable) status.textContent = '当前策略禁止写入，只能查看';
    else if (dirty) status.textContent = '有未保存的权限修改';
    else status.textContent = '未修改';
  }

  function renderPermissions(data) {
    const policy = P.policyMeta(data.policy_state);
    const editable = !!data.can_modify;
    $id('pdPermSummary').innerHTML = kvRows([
      { label: '策略状态', html: badge(policy.label, policy.cls) },
      { label: '严格裁剪', html: data.strict ? badge('是', 'is-ok') : badge('否', 'is-warn') },
      { label: '已配置', html: data.configured ? badge('是', 'is-ok') : badge('否', 'is-warn') },
      { label: '策略版本', value: data.version ? P.shortSha(data.version.replace(/^sha256:/, '')) : '尚未建立策略文件' },
      { label: '声明 / 已授予', value: `${(data.requested || []).length} / ${(data.effective || []).length}` },
      { label: '写入能力', html: editable ? badge('可修改', 'is-ok') : badge('只读（策略异常）', 'is-error') },
    ]);

    const catalog = catalogIndex(data);
    const declaredNames = new Set((data.requested || []).map((item) => item.name));
    const draft = state.permDraft ? state.permDraft.draft : new Map();
    const requested = data.requested || [];

    const rows = requested.map((permission) => {
      const row = draft.get(permission.name) || { enabled: false, scope: permission.scope || '' };
      const meta = catalog.get(permission.name) || { label: permission.name, risk: 'medium', resource_scoped: permission.resource_scoped };
      const risk = RISK_META[meta.risk] || RISK_META.medium;
      const scopeDisabled = !editable || !row.enabled || !meta.resource_scoped;
      return `
        <div class="pc-perm-row${row.enabled ? ' is-granted' : ''}" data-perm="${P.escapeHtml(permission.name)}">
          <div class="pc-perm-main">
            <button type="button" class="pc-switch" role="switch"
              data-perm-toggle="${P.escapeHtml(permission.name)}"
              aria-checked="${row.enabled ? 'true' : 'false'}"
              aria-label="授予 ${P.escapeHtml(permission.name)}"
              ${editable ? '' : 'disabled'}><span class="pc-switch-dot"></span></button>
            <div class="pc-perm-text">
              <span class="pc-perm-title">
                ${P.escapeHtml(meta.label)}
                <code>${P.escapeHtml(permission.name)}</code>
                <span class="pc-badge ${risk.cls}">${risk.label}</span>
                ${permission.enforced === false ? badge('宿主未强制', 'is-warn') : ''}
              </span>
              <span class="pc-perm-desc">${P.escapeHtml(permission.reason || 'Manifest 未说明申请理由')}</span>
            </div>
          </div>
          <div class="pc-perm-scope">
            <input class="tb-input pc-scope-input" type="text"
              data-perm-scope="${P.escapeHtml(permission.name)}"
              value="${P.escapeHtml(row.scope || '')}"
              placeholder="${meta.resource_scoped ? '资源范围，如 library:all / artifact:*' : '该权限不需要资源范围'}"
              aria-label="${P.escapeHtml(permission.name)} 的资源范围"
              ${scopeDisabled ? 'disabled' : ''}>
          </div>
        </div>`;
    }).join('');

    const extra = (data.effective || [])
      .filter((item) => !declaredNames.has(item.permission))
      .map((item) => (item.scope === '*' ? item.permission : `${item.permission}:${item.scope}`));
    const extraHtml = extra.length
      ? `<div class="tb-note is-warn">已授予但 Manifest 未声明的权限：${P.escapeHtml(extra.join('、'))}。保存后这些授权会被撤销。</div>`
      : '';

    $id('pdPermList').innerHTML = (rows || '<p class="tb-muted">该插件没有声明任何权限。</p>') + extraHtml;

    const unenforced = data.unenforced || [];
    const warnings = (data.warnings || []).slice();
    if (unenforced.length) warnings.push('以下权限只有声明、宿主没有强制点：' + unenforced.join('、'));
    if (policy.note) warnings.unshift(policy.note);
    if (data.policy_state === 'absent') {
      warnings.push('首次保存将建立 strict 权限策略：实际可用权限只以本次勾选为准，不会自动授予全部声明权限。');
    }
    note($id('pdPermNote'), warnings.join('；'), data.policy_state === 'broken' ? 'error' : 'warn');
    if (!warnings.length) note($id('pdPermNote'), '', '');
    updatePermBar();
  }

  async function savePermissions() {
    if (!state.permDraft || !state.permissions) return;
    const catalog = catalogIndex(state.permissions);
    const permissions = [];
    for (const [name, row] of state.permDraft.draft) {
      if (!row.enabled) continue;
      const meta = catalog.get(name);
      const scope = meta && meta.resource_scoped ? String(row.scope || '').trim() : '*';
      permissions.push({ name, scope });
    }
    // 撤销权限立即生效，属于高风险操作，必须二次确认。
    const grantedNames = new Set((state.permissions.effective || []).map((item) => item.permission));
    const nextNames = new Set(permissions.map((item) => item.name));
    const revoked = [...grantedNames].filter((name) => !nextNames.has(name));
    if (revoked.length) {
      const answer = await P.confirmAction({
        title: '撤销权限',
        message: `撤销 ${revoked.length} 项权限后，插件对应接口会立即被拒绝，直到重新授予。`,
        detailsHtml: `<p>${P.escapeHtml(revoked.join('、'))}</p>`,
        confirmLabel: '确认撤销',
        danger: true,
      });
      if (!answer.ok) return;
    }
    state.permSaving = true;
    updatePermBar();
    try {
      const result = await P.request(`/api/plugins/${encodeURIComponent(state.id)}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ if_version: state.permissions.version || '', permissions }),
      });
      state.permissions = result.permissions || state.permissions;
      resetPermDraft(state.permissions);
      renderPermissions(state.permissions);
      P.toast('权限已保存，撤销即时生效');
    } catch (err) {
      if (err.status === 409) {
        P.toast('权限策略已被其他操作修改，已重新加载，请重试', true);
        await loadPermissions();
      } else {
        P.toast('权限保存失败：' + P.errorText(err), true);
      }
    } finally {
      state.permSaving = false;
      updatePermBar();
    }
  }

  /* ---------------- 配置（Schema 表单） ---------------- */

  async function loadConfig() {
    const panel = $id('pdPanelConfig');
    panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request(`/api/plugins/${encodeURIComponent(state.id)}/config`);
      state.config = data;
      state.configFields = F.buildFields(data.schema, data.values, data.sensitive);
      state.configState = {};
      for (const field of state.configFields) {
        state.configState[field.key] = { value: field.value, clear: false, error: '' };
      }
      renderConfig(data);
    } catch (err) {
      if (err.code === 'CONFIG_SCHEMA_MISSING') {
        $id('pdConfigBody').innerHTML = '<p class="tb-muted">该插件没有声明式配置 Schema，配置由插件自己的界面管理。</p>';
        note($id('pdConfigNote'), '没有可展示的配置字段。', 'warn');
        setConfigBar('disabled', '没有可编辑的配置');
      } else if (err.status === 503 || err.code === 'RUNTIME_UNAVAILABLE' || err.code === 'RUNTIME_TIMEOUT') {
        $id('pdConfigBody').innerHTML = '<p class="tb-muted">插件运行时离线，暂时无法读取或保存配置。</p>';
        note($id('pdConfigNote'), '运行时离线（RUNTIME_UNAVAILABLE）：配置读写已禁用，不会退回 Node 直接读取加密文件。', 'warn');
        setConfigBar('disabled', '运行时离线');
      } else {
        $id('pdConfigBody').innerHTML = '';
        note($id('pdConfigNote'), '配置加载失败：' + P.errorText(err), 'error');
        setConfigBar('disabled', '配置不可用');
      }
    } finally {
      panel.setAttribute('aria-busy', 'false');
    }
  }

  function setConfigBar(mode, text) {
    const status = $id('pdConfigStatus');
    if (status) status.textContent = text;
    const save = $id('pdConfigSave');
    const reset = $id('pdConfigReset');
    if (save) save.disabled = mode !== 'dirty' && mode !== 'ready';
    if (reset) reset.disabled = mode !== 'dirty';
  }

  function configDirty() {
    const result = F.collectChanges(state.configFields, state.configState);
    return result.changed > 0;
  }

  function updateConfigBar() {
    if (!state.config) return;
    const save = $id('pdConfigSave');
    const reset = $id('pdConfigReset');
    if (state.configSaving) {
      $id('pdConfigStatus').textContent = '正在保存…';
      save.disabled = true;
      reset.disabled = true;
      return;
    }
    const dirty = configDirty();
    save.disabled = !dirty;
    reset.disabled = !dirty;
    $id('pdConfigStatus').textContent = dirty ? '有未保存的配置修改' : '未修改';
  }

  function renderConfig(data) {
    const fields = state.configFields;
    const rows = fields.map((field) => {
      const row = state.configState[field.key];
      const common = `data-config-key="${P.escapeHtml(field.key)}" aria-label="${P.escapeHtml(field.label)}"`;
      let control = '';
      if (field.type === 'boolean') {
        control = `<label class="pc-config-boolean"><input type="checkbox" data-config-key="${P.escapeHtml(field.key)}"
          ${row.value === true ? 'checked' : ''}> <span>${row.value === true ? '已启用' : '已停用'}</span></label>`;
      } else if (field.enumValues.length) {
        control = `<select class="tb-select pc-config-input" ${common}>
          ${field.enumValues.map((item) => `<option value="${P.escapeHtml(item)}" ${String(item) === String(row.value) ? 'selected' : ''}>${P.escapeHtml(item)}</option>`).join('')}
        </select>`;
      } else if (field.sensitive) {
        control = `<input class="tb-input pc-config-input" type="password" autocomplete="new-password"
          ${common} value="" placeholder="${field.configured ? '已配置，留空保持原值' : '尚未配置'}">`;
      } else if (field.type === 'integer' || field.type === 'number') {
        control = `<input class="tb-input pc-config-input" type="number" step="${field.type === 'integer' ? '1' : 'any'}"
          ${common} value="${P.escapeHtml(row.value)}">`;
      } else {
        control = `<input class="tb-input pc-config-input" type="text" ${common} value="${P.escapeHtml(row.value)}">`;
      }
      return `
        <div class="pc-config-row${field.sensitive ? ' is-sensitive' : ''}" data-config-row="${P.escapeHtml(field.key)}">
          <div class="pc-config-label">
            <span class="pc-config-name">${P.escapeHtml(field.label)}
              ${field.required ? '<span class="pc-required" aria-hidden="true">*</span>' : ''}
            </span>
            <span class="pc-config-key">${P.escapeHtml(field.key)} · ${P.escapeHtml(F.labelForType(field.type))}${field.required ? ' · 必填' : ''}</span>
            ${field.description ? `<span class="pc-config-desc">${P.escapeHtml(field.description)}</span>` : ''}
          </div>
          <div class="pc-config-value">
            ${control}
            ${field.sensitive
              ? `${field.configured ? badge('已配置', 'is-ok') : badge('未配置', 'is-warn')}
                 <label class="pc-clear"><input type="checkbox" data-config-clear="${P.escapeHtml(field.key)}">
                 <span>清除</span></label>`
              : ''}
            <span class="pc-field-error" data-config-error="${P.escapeHtml(field.key)}" role="alert"></span>
          </div>
        </div>`;
    }).join('');

    $id('pdConfigBody').innerHTML = `
      <dl class="pc-kv">
        ${kvRows([
          { label: '配置模式', value: '声明式 Schema' },
          { label: '运行时', html: data.runtime_online ? badge('在线', 'is-ok') : badge('离线', 'is-error') },
          { label: '已配置', html: data.configured ? badge('是', 'is-ok') : badge('否', 'is-warn') },
          { label: '配置版本', value: data.version ? P.shortSha(String(data.version).replace(/^sha256:/, '')) : '未建立' },
        ])}
      </dl>
      ${rows ? `<div class="pc-config-list">${rows}</div>` : '<p class="tb-muted">Schema 没有声明任何字段。</p>'}
      ${data.has_custom_ui ? `<p class="tb-muted">该插件还提供自己的配置界面：<a href="/toolbox/tool/${encodeURIComponent(state.id)}">打开插件界面</a></p>` : ''}`;

    note($id('pdConfigNote'),
      Object.keys(data.sensitive || {}).some((key) => data.sensitive[key])
        ? '敏感字段不回显原值：留空保持原值，勾选“清除”才会删除。'
        : '配置由 Python 运行时加密保存，保存后立即生效。',
      'warn');
    updateConfigBar();
  }

  function syncConfigStateFromDom() {
    for (const field of state.configFields) {
      const row = state.configState[field.key];
      if (field.type === 'boolean') {
        const input = document.querySelector(`input[type="checkbox"][data-config-key="${field.key}"]`);
        if (input) row.value = input.checked;
      } else {
        const input = document.querySelector(`[data-config-key="${field.key}"]:not([type="checkbox"])`);
        if (input) row.value = input.value;
      }
      const clearBox = document.querySelector(`[data-config-clear="${field.key}"]`);
      if (clearBox) row.clear = clearBox.checked;
    }
  }

  function validateConfigLocally() {
    const result = F.collectChanges(state.configFields, state.configState);
    const byKey = new Map(result.errors.map((item) => [item.key, item.message]));
    for (const field of state.configFields) {
      const el = document.querySelector(`[data-config-error="${field.key}"]`);
      if (el) el.textContent = byKey.get(field.key) || '';
    }
    return result;
  }

  async function saveConfig() {
    if (!state.config || state.configSaving) return;
    syncConfigStateFromDom();
    const collected = validateConfigLocally();
    if (collected.errors.length) {
      P.toast('请先修正表单中的错误', true);
      return;
    }
    if (!collected.changed) return;
    state.configSaving = true;
    updateConfigBar();
    try {
      const result = await P.request(`/api/plugins/${encodeURIComponent(state.id)}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          if_version: state.config.version || '',
          values: collected.values,
          clear_sensitive: collected.clear,
        }),
      });
      state.config = result;
      state.configFields = F.buildFields(result.schema, result.values, result.sensitive);
      state.configState = {};
      for (const field of state.configFields) {
        state.configState[field.key] = { value: field.value, clear: false, error: '' };
      }
      renderConfig(result);
      P.toast(result.changed && result.changed.fields.length
        ? `已保存 ${result.changed.fields.length} 个字段`
        : '配置未发生变化');
    } catch (err) {
      if (err.status === 409 || err.code === 'CONFIG_VERSION_CONFLICT') {
        P.toast('配置已被其他操作修改，已重新加载，请重试', true);
        await loadConfig();
      } else if (err.details && Array.isArray(err.details.errors)) {
        for (const item of err.details.errors) {
          const el = document.querySelector(`[data-config-error="${item.field}"]`);
          if (el) el.textContent = item.message || '校验失败';
        }
        P.toast('配置校验失败：' + (err.message || '请检查字段'), true);
      } else {
        P.toast('配置保存失败：' + P.errorText(err), true);
      }
    } finally {
      state.configSaving = false;
      updateConfigBar();
    }
  }

  /* ---------------- 版本 ---------------- */

  async function loadVersions() {
    const panel = $id('pdPanelVersions');
    panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request(`/api/plugins/${encodeURIComponent(state.id)}/versions`);
      state.versions = data;
      renderVersions(data);
    } catch (err) {
      note($id('pdVersionNote'), '版本信息加载失败：' + P.errorText(err), 'error');
    } finally {
      panel.setAttribute('aria-busy', 'false');
    }
  }

  function renderVersions(data) {
    const current = data.current || {};
    const latest = data.latest;
    const rollback = data.rollback || {};
    $id('pdVersionBody').innerHTML = kvRows([
      { label: '当前版本', value: current.revision || '—' },
      { label: '安装来源', value: sourceLabel(current.source) },
      { label: '安装时间', value: P.fmtTime(current.installed_at) },
      { label: 'SHA-256', value: P.shortSha(current.sha256) },
      { label: '商店最新版本', value: latest && latest.revision ? latest.revision : '商店状态未知' },
      { label: '可更新', html: data.update_available ? badge('是', 'is-ok') : badge('否', 'is-muted') },
      { label: '最新版本审查', html: latest && latest.reviewed ? badge('已审查', 'is-ok') : badge('待审查', 'is-warn') },
      { label: '回滚目标', value: rollback.available ? rollback.revision || '上一版本' : '没有可回滚版本' },
      { label: '审核信息', value: data.review ? `${data.review.sha256 ? P.shortSha(data.review.sha256) : ''} ${data.review.reviewed_at ? P.fmtTime(data.review.reviewed_at) : ''}`.trim() || '—' : '无' },
    ]);
    $id('pdVersionHistory').innerHTML = '';
    note($id('pdVersionNote'),
      latest ? '' : '商店索引不可用，无法判断是否有新版本。',
      'warn');
  }

  /* ---------------- 日志 ---------------- */

  async function loadLogs() {
    const panel = $id('pdPanelLogs');
    panel.setAttribute('aria-busy', 'true');
    try {
      const data = await P.request(`/api/plugins/${encodeURIComponent(state.id)}/logs` + P.buildQuery({
        type: state.logType, since: sinceValue(), limit: LOG_LIMIT, offset: state.logOffset,
      }));
      state.logs = data;
      renderLogs(data);
    } catch (err) {
      note($id('pdLogNote'), '日志加载失败：' + P.errorText(err), 'error');
    } finally {
      panel.setAttribute('aria-busy', 'false');
    }
  }

  // 只把相对范围换算成 ISO 时间，避免前端伪造服务端时间。
  function sinceValue() {
    if (!state.logSince) return '';
    const hours = state.logSince === '7d' ? 24 * 7 : 24;
    return new Date(Date.now() - hours * 3600 * 1000).toISOString();
  }

  function renderLogs(data) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const meta = P.logTypeMeta(state.logType);
    $id('pdLogList').innerHTML = entries.map((entry) => `
      <div class="pc-log-row">
        <span class="pc-log-time">${P.escapeHtml(P.fmtTime(entry.at))}</span>
        <span class="pc-log-level ${entry.level === 'error' ? 'is-error' : ''}">${P.escapeHtml(entry.level || 'info')}</span>
        <span class="pc-log-code">${P.escapeHtml(entry.code || '')}</span>
        <span class="pc-log-text">${P.escapeHtml(entry.message || '')}
          ${entry.actor ? `<span class="pc-log-meta">操作人 ${P.escapeHtml(entry.actor)} · 结果 ${P.escapeHtml(entry.result || '')}</span>` : ''}
        </span>
      </div>`).join('');
    $id('pdLogEmpty').classList.toggle('hidden', entries.length > 0);
    $id('pdLogEmpty').textContent = meta.empty;

    const total = Number(data.total) || 0;
    const from = total ? Number(data.offset) + 1 : 0;
    const to = Number(data.offset) + entries.length;
    $id('pdLogPageInfo').textContent = total ? `${from}–${to} / ${total}` : '—';
    $id('pdLogPrev').disabled = Number(data.offset) <= 0;
    $id('pdLogNext').disabled = to >= total;
    note($id('pdLogNote'),
      data.available === false ? (data.note || '该日志源暂不可用。') : (data.note || ''),
      data.available === false ? 'warn' : '');
  }

  /* ---------------- 写操作（委托 /api/toolbox/*） ---------------- */

  async function detailAction(action) {
    const view = pluginView();
    const name = view.name || state.id;
    const presets = {
      install: { title: '安装插件', message: `安装 ${name}？安装包会先校验 SHA-256。`, label: '安装' },
      enable: { title: '启用插件', message: `启用 ${name}？`, label: '启用' },
      disable: { title: '停用插件', message: `停用 ${name}？停用会立即阻断该插件的接口。`, label: '停用', danger: true },
      update: { title: '更新插件', message: `把 ${name} 更新到商店最新版本？`, label: '更新' },
      rollback: { title: '回滚插件', message: `把 ${name} 回滚到上一版本？`, label: '回滚', danger: true },
    };

    if (action === 'uninstall') {
      const answer = await P.confirmAction({
        title: '卸载插件',
        message: `卸载 ${name}？默认保留插件私有数据。`,
        checkboxLabel: '同时删除插件配置与数据（不可恢复）',
        confirmLabel: '卸载',
        danger: true,
      });
      if (!answer.ok) return;
      await runWrite(`/api/toolbox/${encodeURIComponent(state.id)}${answer.checked ? '?purge_data=1' : ''}`, 'DELETE', '卸载');
      return;
    }

    const preset = presets[action];
    if (!preset) return;
    const answer = await P.confirmAction({
      title: preset.title,
      message: preset.message,
      confirmLabel: preset.label,
      danger: !!preset.danger,
    });
    if (!answer.ok) return;
    if (action === 'install') {
      await runWrite('/api/toolbox/install', 'POST', '安装', { tool_id: state.id });
      return;
    }
    const urls = {
      enable: `/api/toolbox/${encodeURIComponent(state.id)}/enable`,
      disable: `/api/toolbox/${encodeURIComponent(state.id)}/disable`,
      update: `/api/toolbox/${encodeURIComponent(state.id)}/update`,
      rollback: `/api/toolbox/${encodeURIComponent(state.id)}/rollback`,
    };
    await runWrite(urls[action], 'POST', preset.label);
  }

  async function runWrite(url, method, label, body) {
    if (state.busy) return;
    state.busy = true;
    document.querySelectorAll('[data-detail-action]').forEach((btn) => { btn.disabled = true; });
    try {
      await P.request(url, { method, body: body ? JSON.stringify(body) : undefined });
      P.toast(`${label}请求已提交，正在重新读取插件状态`);
    } catch (err) {
      P.toast(`${label}失败：` + P.errorText(err), true);
      if (err.status === 401) return;
    } finally {
      state.busy = false;
      document.querySelectorAll('[data-detail-action]').forEach((btn) => { btn.disabled = false; });
    }
    state.loaded = {};
    await loadPlugin();
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    $id('pdTabs').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-tab]');
      if (btn) setTab(btn.dataset.tab);
    });
    $id('pdTabs').addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      const buttons = [...document.querySelectorAll('#pdTabs [data-tab]')];
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

    $id('pdActions').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-detail-action]');
      if (!btn || btn.disabled) return;
      detailAction(btn.dataset.detailAction);
    });

    document.querySelectorAll('.pc-chip[data-log-type]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.logType = chip.dataset.logType;
        state.logOffset = 0;
        document.querySelectorAll('.pc-chip[data-log-type]').forEach((item) => {
          const on = item === chip;
          item.classList.toggle('is-active', on);
          item.setAttribute('aria-pressed', String(on));
        });
        loadLogs();
      });
    });
    $id('pdLogRefresh').addEventListener('click', () => loadLogs());
    $id('pdLogSince').addEventListener('change', (event) => {
      state.logSince = event.target.value;
      state.logOffset = 0;
      loadLogs();
    });
    $id('pdLogPrev').addEventListener('click', () => {
      state.logOffset = Math.max(0, state.logOffset - LOG_LIMIT);
      loadLogs();
    });
    $id('pdLogNext').addEventListener('click', () => {
      state.logOffset += LOG_LIMIT;
      loadLogs();
    });

    // 权限：切换授权 / 修改 scope 只更新本地待提交状态，点保存才写服务端。
    $id('pdPermList').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-perm-toggle]');
      if (!toggle || toggle.disabled || !state.permDraft) return;
      const name = toggle.dataset.permToggle;
      const row = state.permDraft.draft.get(name);
      if (!row) return;
      row.enabled = !row.enabled;
      renderPermissions(state.permissions);
    });
    $id('pdPermList').addEventListener('input', (event) => {
      const input = event.target.closest('[data-perm-scope]');
      if (!input || !state.permDraft) return;
      const row = state.permDraft.draft.get(input.dataset.permScope);
      if (!row) return;
      row.scope = input.value;
      updatePermBar();
    });
    $id('pdPermSave').addEventListener('click', savePermissions);
    $id('pdPermReset').addEventListener('click', () => {
      if (!state.permissions) return;
      resetPermDraft(state.permissions);
      renderPermissions(state.permissions);
      P.toast('已放弃未保存的权限修改');
    });

    // 配置：输入即同步到本地状态，保存前做一次完整校验。
    const configEvents = ['input', 'change'];
    for (const type of configEvents) {
      $id('pdConfigBody').addEventListener(type, () => {
        if (!state.config || state.configSaving) return;
        syncConfigStateFromDom();
        updateConfigBar();
      });
    }
    $id('pdConfigSave').addEventListener('click', saveConfig);
    $id('pdConfigReset').addEventListener('click', () => {
      if (!state.config) return;
      state.configFields = F.buildFields(state.config.schema, state.config.values, state.config.sensitive);
      state.configState = {};
      for (const field of state.configFields) {
        state.configState[field.key] = { value: field.value, clear: false, error: '' };
      }
      renderConfig(state.config);
      P.toast('已放弃未保存的配置修改');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
