/* ============================================================
 * 工具箱外层 UI：商店 / 已安装 / 任务
 * 只负责宿主管理界面；工具内部界面由插件自己的 iframe 提供。
 * ============================================================ */

(function () {
  'use strict';

  const state = {
    tab: 'store',
    store: null,
    installed: [],
    tasks: [],
    runtime: null,
    busy: new Set(),
    taskTimer: 0,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || '请求失败');
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function toast(message, isError = false) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? url.toString() : '';
    } catch { return ''; }
  }

  function fmtTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }

  function versionBadge(entry) {
    if (entry.installed && entry.installed.update_available) return `可更新 → ${entry.latest_revision}`;
    if (entry.installed) return `已安装 v${entry.installed.revision}`;
    if (!entry.reviewed) return '待审查';
    if (!entry.compatibility || !entry.compatibility.supported) return '暂不支持';
    return `v${entry.latest_revision}`;
  }

  function blockedText(entry) {
    const reasons = (entry.blocked_reasons || []).filter((reason) => reason.code !== 'REVIEW_REQUIRED');
    if (!entry.reviewed) return '该版本尚未列入已审查 allowlist，第一版不自动安装。';
    return reasons.map((reason) => reason.message).join('；');
  }

  function iconHtml(tool, src, className) {
    const initial = escapeHtml((tool.name || tool.tool_id || '?').slice(0, 1).toUpperCase());
    const raw = String(src || '');
    const url = raw.startsWith('/') && !raw.startsWith('//') ? raw : safeUrl(raw);
    if (!url) return `<span class="${className} tb-icon-letter" aria-hidden="true">${initial}</span>`;
    return `<img class="${className}" src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="${className} tb-icon-letter" aria-hidden="true" hidden>${initial}</span>`;
  }

  function actionButton(action, id, label, { primary = false, disabled = false, title = '' } = {}) {
    return `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="${escapeHtml(action)}" data-id="${escapeHtml(id)}"${disabled ? ' disabled' : ''}${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</button>`;
  }

  function storeCard(entry) {
    const installed = entry.installed;
    const supported = entry.compatibility && entry.compatibility.supported;
    const busy = state.busy.has(`store:${entry.tool_id}`);
    let actions = '';
    if (installed) {
      actions += `<a class="btn btn-ghost btn-sm" href="/toolbox/tool/${encodeURIComponent(entry.tool_id)}">${installed.enabled ? '打开' : '已停用'}</a>`;
      if (installed.update_available && supported) {
        actions += actionButton('update', entry.tool_id, busy ? '更新中…' : `更新到 ${entry.latest_revision}`, { primary: true, disabled: busy });
      } else {
        actions += actionButton('installed', entry.tool_id, '已安装', { disabled: true });
      }
    } else if (supported) {
      actions += actionButton('install', entry.tool_id, busy ? '安装中…' : '安装', { primary: true, disabled: busy });
    } else {
      actions += actionButton('blocked', entry.tool_id, '暂不支持', { disabled: true, title: blockedText(entry) });
    }
    const repo = safeUrl(entry.repo_url);
    const warnings = (entry.compatibility && entry.compatibility.warnings) || [];
    const note = !supported
      ? `<p class="tb-blocked">${escapeHtml(blockedText(entry))}</p>`
      : (!entry.reviewed && warnings.length
        ? `<p class="tb-blocked">${escapeHtml(warnings.map((item) => item.message).join('；'))}</p>` : '');
    return `<article class="tb-card" data-tool="${escapeHtml(entry.tool_id)}">
      <div class="tb-card-head">
        <div class="tb-icon-wrap">${iconHtml(entry, entry.icon_url, 'tb-icon')}</div>
        <div class="tb-card-title">
          <h3>${escapeHtml(entry.name)}</h3>
          <p class="tb-muted">${escapeHtml(entry.author || '未知作者')} · ${escapeHtml(versionBadge(entry))}</p>
        </div>
        <span class="tb-badge ${entry.reviewed ? 'is-ok' : 'is-warn'}">${entry.reviewed ? '已审查' : '未审查'}</span>
      </div>
      <p class="tb-desc">${escapeHtml(entry.description || '没有描述')}</p>
      <div class="tb-card-foot">
        <span class="tb-muted">CoreAPI ${escapeHtml(entry.core_api_version || '?')}</span>
        ${repo ? `<a class="tb-link" href="${escapeHtml(repo)}" target="_blank" rel="noopener noreferrer">仓库</a>` : ''}
        <span class="tb-spacer"></span>
        <div class="tb-actions">${actions}</div>
      </div>
      ${note}
    </article>`;
  }

  function installedCard(tool) {
    const busy = state.busy.has(`installed:${tool.tool_id}`);
    const update = state.store && state.store.tools.find((entry) => entry.tool_id === tool.tool_id);
    const canUpdate = !!(update && update.installed && update.installed.update_available && update.compatibility.supported);
    const limitations = (tool.compatibility && tool.compatibility.limitations) || [];
    const canOpen = tool.enabled && !tool.pending_restart;
    const status = tool.pending_restart ? '待重启' : (tool.enabled ? '已启用' : '已停用');
    const statusClass = tool.pending_restart ? 'is-warn' : (tool.enabled ? 'is-ok' : 'is-muted');
    return `<article class="tb-row" data-tool="${escapeHtml(tool.tool_id)}">
      <div class="tb-icon-wrap">${iconHtml({ name: tool.name, tool_id: tool.tool_id }, `/api/toolbox/tools/${encodeURIComponent(tool.tool_id)}/icon`, 'tb-icon tb-icon-sm')}</div>
      <div class="tb-row-main">
        <div class="tb-row-title">
          <h3>${escapeHtml(tool.name || tool.tool_id)}</h3>
          <span class="tb-badge ${statusClass}">${escapeHtml(status)}</span>
          <span class="tb-muted">v${escapeHtml(tool.revision)} · ${escapeHtml(tool.source)} · ${escapeHtml(tool.tool_type || 'tool')}</span>
        </div>
        <p class="tb-muted">安装于 ${escapeHtml(fmtTime(tool.installed_at))}${tool.rollback_available ? ' · 可回滚' : ''}</p>
        ${tool.last_error ? `<p class="tb-blocked">${escapeHtml(tool.last_error)}</p>` : ''}
        ${limitations.length ? `<details class="tb-details"><summary>运行限制</summary><ul>${limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}
      </div>
      <div class="tb-actions tb-row-actions">
        <a class="btn btn-ghost btn-sm${canOpen ? '' : ' is-disabled'}" href="/toolbox/tool/${encodeURIComponent(tool.tool_id)}"${canOpen ? '' : ` aria-disabled="true" tabindex="-1" title="${tool.pending_restart ? '请先重启插件运行时' : '工具已停用'}"`}>打开</a>
        ${tool.pending_restart ? actionButton('restart', '', '重启生效', { primary: true, disabled: busy }) : ''}
        ${actionButton(tool.enabled ? 'disable' : 'enable', tool.tool_id, busy ? '处理中…' : (tool.enabled ? '停用' : '启用'), { disabled: busy })}
        ${canUpdate ? actionButton('update', tool.tool_id, busy ? '更新中…' : `更新到 ${update.latest_revision}`, { primary: true, disabled: busy }) : ''}
        ${tool.rollback_available ? actionButton('rollback', tool.tool_id, '回滚', { disabled: busy }) : ''}
        ${actionButton('uninstall', tool.tool_id, '卸载', { disabled: busy })}
      </div>
    </article>`;
  }

  function taskStatus(status) {
    return {
      running: ['运行中', 'is-running'], completed: ['已完成', 'is-ok'],
      failed: ['失败', 'is-error'], cancelled: ['已取消', 'is-muted'],
    }[status] || [status, 'is-muted'];
  }

  function taskCard(task) {
    const [label, cls] = taskStatus(task.status);
    const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
    const bookLink = task.result_book_id
      ? `<a class="tb-link" href="/shelf?book=${encodeURIComponent(task.result_book_id)}">查看入库书籍 #${escapeHtml(task.result_book_id)}</a>` : '';
    const detail = task.error || task.message || '';
    return `<article class="tb-task">
      <div class="tb-task-head">
        <div>
          <strong>${escapeHtml(task.tool_id)}</strong>
          <span class="tb-muted">${escapeHtml(task.operation || 'download')} · #${escapeHtml(task.id)}</span>
        </div>
        <span class="tb-badge ${cls}">${escapeHtml(label)}</span>
      </div>
      <div class="tb-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <span style="width:${progress}%"></span>
      </div>
      <div class="tb-task-foot">
        <span class="tb-muted">${escapeHtml(task.stage || '')} · ${progress}% · ${escapeHtml(fmtTime(task.created_at))}</span>
        <span class="tb-spacer"></span>
        ${bookLink}
        ${task.status === 'running' ? actionButton('cancel-task', String(task.id), '取消') : ''}
      </div>
      ${detail ? `<p class="tb-task-detail">${escapeHtml(detail)}</p>` : ''}
    </article>`;
  }

  function renderStore() {
    const list = $('#tbStoreList');
    const empty = $('#tbStoreEmpty');
    const note = $('#tbStoreNote');
    const meta = $('#tbStoreMeta');
    if (!state.store) {
      meta.textContent = '正在获取工具商店…';
      return;
    }
    meta.textContent = state.store.fetched_at
      ? `商店索引 ${fmtTime(state.store.fetched_at)}${state.store.cached ? '（缓存）' : ''}`
      : '商店索引不可用';
    if (state.store.error) {
      note.hidden = false;
      note.className = 'tb-note is-error';
      note.textContent = `商店加载失败：${state.store.error}`;
    } else {
      note.hidden = true;
    }
    const tools = state.store.tools || [];
    list.innerHTML = tools.map(storeCard).join('');
    list.setAttribute('aria-busy', 'false');
    empty.classList.toggle('hidden', tools.length > 0);
  }

  function renderInstalled() {
    const list = $('#tbInstalledList');
    const empty = $('#tbInstalledEmpty');
    $('#tbInstalledCount').textContent = state.installed.length ? String(state.installed.length) : '';
    list.innerHTML = state.installed.map(installedCard).join('');
    empty.classList.toggle('hidden', state.installed.length > 0);
  }

  function renderTasks() {
    const list = $('#tbTaskList');
    const empty = $('#tbTaskEmpty');
    const running = state.tasks.filter((task) => task.status === 'running').length;
    $('#tbTaskCount').textContent = running ? String(running) : '';
    list.innerHTML = state.tasks.map(taskCard).join('');
    empty.classList.toggle('hidden', state.tasks.length > 0);
  }

  function renderRuntime() {
    const el = $('#tbRuntime');
    const text = $('#tbRuntimeText');
    if (!state.runtime) return;
    el.classList.toggle('is-offline', !state.runtime.online);
    text.textContent = state.runtime.online
      ? 'Python 运行时在线'
      : `Python 运行时离线${state.runtime.error ? `：${state.runtime.error}` : ''}`;
    el.title = state.runtime.online ? 'toolbox-runtime 可用' : '请启动 toolbox-runtime 容器或本地 Python 运行时';
  }

  async function loadStore(force = false) {
    $('#tbStoreList').setAttribute('aria-busy', 'true');
    try {
      state.store = force
        ? await api('/api/toolbox/store/refresh', { method: 'POST', body: '{}' })
        : await api('/api/toolbox/store/index');
    } catch (err) {
      state.store = { tools: [], error: err.message };
    }
    renderStore();
    renderInstalled();
  }

  async function loadInstalled() {
    try {
      const data = await api('/api/toolbox/installed');
      state.installed = data.tools || [];
    } catch (err) {
      state.installed = [];
      toast(err.message, true);
    }
    renderInstalled();
  }

  async function loadTasks() {
    try {
      const data = await api('/api/toolbox/tasks?limit=50');
      state.tasks = data.tasks || [];
      renderTasks();
    } catch (err) {
      if (state.tab === 'tasks') toast(err.message, true);
    }
  }

  async function loadRuntime() {
    try { state.runtime = await api('/api/toolbox/runtime'); } catch (err) {
      state.runtime = { online: false, error: err.message };
    }
    renderRuntime();
  }

  async function restartRuntime() {
    toast('正在重启插件运行时…');
    try {
      const result = await api('/api/toolbox/runtime/restart', { method: 'POST', body: '{}' });
      if (!result.ok) {
        toast(`运行时重启失败：${result.error || '未知错误'}`, true);
      } else {
        const failed = (result.reports || []).filter((report) => !report.loaded);
        toast(failed.length ? `运行时已重启，${failed.length} 个工具加载失败` : '插件运行时已重启', failed.length > 0);
      }
      await refreshAll();
    } catch (err) {
      toast(`运行时重启失败：${err.message}`, true);
    }
  }

  async function refreshAll() {
    await Promise.all([loadStore(), loadInstalled(), loadRuntime()]);
    if (state.tab === 'tasks') await loadTasks();
  }

  function setTab(tab) {
    state.tab = ['store', 'installed', 'tasks'].includes(tab) ? tab : 'store';
    $$('.tb-tabs button').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
    });
    $('#tbPanelStore').classList.toggle('hidden', state.tab !== 'store');
    $('#tbPanelInstalled').classList.toggle('hidden', state.tab !== 'installed');
    $('#tbPanelTasks').classList.toggle('hidden', state.tab !== 'tasks');
    if (state.tab === 'tasks') loadTasks();
    if (history.replaceState) history.replaceState(null, '', `#${state.tab}`);
  }

  async function withBusy(key, task) {
    state.busy.add(key);
    renderStore();
    renderInstalled();
    try { return await task(); } finally {
      state.busy.delete(key);
      renderStore();
      renderInstalled();
    }
  }

  async function install(toolId) {
    const entry = state.store && state.store.tools.find((item) => item.tool_id === toolId);
    if (!entry) return;
    const warning = (entry.review && entry.review.limitations) ? `\n\n已知限制：\n- ${entry.review.limitations.join('\n- ')}` : '';
    if (!window.confirm(`安装「${entry.name}」v${entry.latest_revision}？\n该版本已列入 allowlist，但工具代码仍以独立运行时权限执行。${warning}`)) return;
    await withBusy(`store:${toolId}`, async () => {
      try {
        await api('/api/toolbox/install', { method: 'POST', body: JSON.stringify({ tool_id: toolId }) });
        toast(`已安装「${entry.name}」，请重启插件运行时生效`);
        await refreshAll();
      } catch (err) {
        toast(`${err.message}${err.code ? `（${err.code}）` : ''}`, true);
      }
    });
  }

  async function update(toolId) {
    if (!window.confirm('更新会保留一个可回滚的旧版本。继续？')) return;
    await withBusy(`store:${toolId}`, async () => {
      try {
        await api(`/api/toolbox/${encodeURIComponent(toolId)}/update`, { method: 'POST', body: '{}' });
        toast('已更新，请重启插件运行时生效');
        await refreshAll();
      } catch (err) {
        toast(`${err.message}${err.code ? `（${err.code}）` : ''}`, true);
      }
    });
  }

  async function setEnabled(toolId, enabled) {
    await withBusy(`installed:${toolId}`, async () => {
      try {
        await api(`/api/toolbox/${encodeURIComponent(toolId)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST', body: '{}' });
        toast(enabled ? '已启用' : '已停用');
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    });
  }

  async function uninstall(toolId) {
    const tool = state.installed.find((item) => item.tool_id === toolId);
    const name = tool ? tool.name : toolId;
    if (!window.confirm(`卸载「${name}」？\n插件私有数据默认保留；如需彻底删除，请卸载后再手动清理运行卷。`)) return;
    await withBusy(`installed:${toolId}`, async () => {
      try {
        await api(`/api/toolbox/${encodeURIComponent(toolId)}`, { method: 'DELETE' });
        toast('已卸载');
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    });
  }

  async function rollback(toolId) {
    if (!window.confirm('回滚到上一个保留版本？')) return;
    await withBusy(`installed:${toolId}`, async () => {
      try {
        await api(`/api/toolbox/${encodeURIComponent(toolId)}/rollback`, { method: 'POST', body: '{}' });
        toast('已回滚');
        await refreshAll();
      } catch (err) { toast(err.message, true); }
    });
  }

  async function cancelTask(taskId) {
    try {
      await api(`/api/toolbox/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: '{}' });
      toast('已请求取消，等待插件确认');
      await loadTasks();
    } catch (err) { toast(err.message, true); }
  }

  document.addEventListener('click', (event) => {
    const tab = event.target.closest('.tb-tabs button');
    if (tab) { setTab(tab.dataset.tab); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === 'install') install(id);
    else if (action === 'update') update(id);
    else if (action === 'enable') setEnabled(id, true);
    else if (action === 'disable') setEnabled(id, false);
    else if (action === 'uninstall') uninstall(id);
    else if (action === 'rollback') rollback(id);
    else if (action === 'restart') restartRuntime();
    else if (action === 'cancel-task') cancelTask(id);
  });

  $('#tbRefreshStore').addEventListener('click', async () => {
    toast('正在刷新商店…');
    await loadStore(true);
    await loadInstalled();
  });
  $('#tbRefreshTasks').addEventListener('click', () => loadTasks());
  $('#tbRestartRuntime').addEventListener('click', restartRuntime);
  window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

  state.taskTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && (state.tab === 'tasks' || state.tasks.some((task) => task.status === 'running'))) {
      loadTasks();
    }
  }, 4000);

  setTab(location.hash.slice(1) || 'store');
  refreshAll();
})();
