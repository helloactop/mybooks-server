/* ============================================================
 * 书架工作区:左侧资料库
 * 全部图书 / 阅读状态 / 我的分类 / 智能书架 / 系列 / 作者 / 标签
 * ============================================================ */

(function () {
  const S = window.ShelfUI = window.ShelfUI || {};
  const state = () => S.state;
  const facetUI = S.facetUI;
  const LIMIT = 8;
  const FACET_LIMITS = { author: 5, series: 8, tag: 8 };
  const FACET_KEYS = { series: 'series', author: 'authors', tag: 'tags' };
  const FACET_TITLES = { series: '系列', author: '作者', tag: '标签' };
  const FACET_SECTION_KEYS = new Set(Object.keys(FACET_TITLES));
  const SIDE_SECTION_KEYS = new Set(['status', 'collections', 'vl']);
  const SERVER_FACETS = new Set(['author', 'tag', 'series']);
  const SEARCH_DELAY = 250;

  const chevron = '<svg class="wb-chevron" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function row({ label, count, active, axis, value, extra = '', className = '' }) {
    return `<button type="button" class="wb-row${active ? ' is-active' : ''}${className ? ' ' + className : ''}" data-axis="${axis}" data-value="${esc(value)}" title="${esc(label)}">
      <span class="wb-row-name">${esc(label)}</span>
      <span class="wb-row-count">${count === null || count === undefined ? '—' : count}</span>
      ${extra}
    </button>`;
  }

  function sectionHead(id, title, extra = '') {
    const collapsed = S.collapsed.has(id);
    return `<div class="wb-section-head-row">
      <button type="button" class="wb-section-head" data-section="${id}" aria-expanded="${!collapsed}">
        ${chevron}<span>${title}</span>
      </button>${extra}
    </div>`;
  }

  function sectionBody(id, html) {
    return S.collapsed.has(id) ? '' : html;
  }

  /* ---------- 侧栏视图状态：局部更新和整栏重绘都要保住滚动/焦点 ---------- */
  function escapeAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function attrSelector(name, value) {
    return `[${name}="${escapeAttr(value)}"]`;
  }

  function cssEscape(value) {
    if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/([^\w-])/g, '\\$1');
  }

  function clampScrollTop(value, max) {
    const desired = Number(value);
    if (!Number.isFinite(desired) || desired <= 0) return 0;
    const limit = Math.max(0, Number(max) || 0);
    return Math.min(desired, limit);
  }

  function focusSelector(el) {
    if (!el || typeof el.matches !== 'function') return null;
    if (el.id) return '#' + cssEscape(el.id);
    const form = el.closest && el.closest('[data-collection-form]');
    if (form) {
      let selector = attrSelector('data-collection-form', form.dataset.collectionForm);
      if (form.dataset.id) selector += attrSelector('data-id', form.dataset.id);
      if (el.matches('input, textarea')) return selector + ' input';
      if (el.matches('button')) return selector + ' button[type="submit"]';
      return selector;
    }
    if (el.matches('[data-facet]')) return attrSelector('data-facet', el.dataset.facet);
    if (el.matches('[data-facet-more]')) return attrSelector('data-facet-more', el.dataset.facetMore);
    if (el.matches('[data-facet-close]')) return attrSelector('data-facet-close', el.dataset.facetClose);
    if (el.matches('[data-section]')) return attrSelector('data-section', el.dataset.section);
    if (el.matches('[data-facets-retry]')) return '[data-facets-retry]';
    if (el.matches('[data-sidebar-close]')) return '[data-sidebar-close]';
    if (el.matches('[data-collection-act]')) {
      let selector = attrSelector('data-collection-act', el.dataset.collectionAct);
      if (el.dataset.id) selector += attrSelector('data-id', el.dataset.id);
      return selector;
    }
    if (el.matches('[data-axis]')) {
      return attrSelector('data-axis', el.dataset.axis) + attrSelector('data-value', el.dataset.value);
    }
    return null;
  }

  function captureSidebarViewState(root = $('#wbSidebar')) {
    if (!root) return null;
    const scroller = root.querySelector('.wb-side-scroll');
    const facetScrolls = Object.create(null);
    root.querySelectorAll('[data-facet-list]').forEach((list) => {
      const key = list.getAttribute('data-facet-list');
      if (key != null) facetScrolls[key] = list.scrollTop;
    });
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    let focus = null;
    if (active && active !== root && root.contains && root.contains(active)) {
      const facetSection = active.closest?.('[data-facet-section]');
      const sideSection = active.closest?.('[data-side-section]');
      let start = null;
      let end = null;
      let direction = null;
      try {
        start = active.selectionStart;
        end = active.selectionEnd;
        direction = active.selectionDirection;
      } catch { /* 非文本控件没有 selection */ }
      focus = {
        selector: focusSelector(active),
        facet: facetSection ? facetSection.getAttribute('data-facet-section') : '',
        sideSection: sideSection ? sideSection.getAttribute('data-side-section') : '',
        start: typeof start === 'number' ? start : null,
        end: typeof end === 'number' ? end : null,
        direction: direction || 'none',
      };
    }
    return {
      scrollTop: scroller ? scroller.scrollTop : null,
      facetScrolls,
      focus,
    };
  }

  function restoreSidebarViewState(view, root = $('#wbSidebar')) {
    if (!view || !root) return;
    const scroller = root.querySelector('.wb-side-scroll');
    if (scroller && view.scrollTop !== null) {
      scroller.scrollTop = clampScrollTop(view.scrollTop, scroller.scrollHeight - scroller.clientHeight);
    }
    root.querySelectorAll('[data-facet-list]').forEach((list) => {
      const key = list.getAttribute('data-facet-list');
      if (key === null || view.facetScrolls[key] === undefined) return;
      list.scrollTop = clampScrollTop(view.facetScrolls[key], list.scrollHeight - list.clientHeight);
    });
    const focus = view.focus;
    if (!focus) return;
    let target = focus.selector ? root.querySelector(focus.selector) : null;
    if (!target && focus.facet) {
      target = root.querySelector(attrSelector('data-facet-close', focus.facet))
        || root.querySelector(attrSelector('data-facet-more', focus.facet))
        || root.querySelector(attrSelector('data-facet', focus.facet))
        || root.querySelector(attrSelector('data-section', focus.facet));
    }
    if (!target && focus.sideSection) {
      target = root.querySelector(attrSelector('data-section', focus.sideSection));
    }
    if (!target) target = root.querySelector('[data-axis="all"]');
    if (!target) return;
    try { target.focus({ preventScroll: true }); } catch { try { target.focus(); } catch { /* ignore */ } }
    if (typeof focus.start === 'number' && typeof target.setSelectionRange === 'function') {
      const length = String(target.value ?? '').length;
      const start = Math.max(0, Math.min(focus.start, length));
      const end = Math.max(start, Math.min(focus.end === null ? start : focus.end, length));
      try { target.setSelectionRange(start, end, focus.direction || 'none'); } catch { /* ignore */ }
    }
  }

  function clampAncestorScroll(root) {
    const scroller = root && root.querySelector('.wb-side-scroll');
    if (!scroller) return;
    scroller.scrollTop = clampScrollTop(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight);
  }

  function facetItems(key) {
    const f = state().facets || {};
    const raw = key === 'series' ? f.series : key === 'author' ? f.authors : key === 'tag' ? f.tags : [];
    const items = (Array.isArray(raw) ? raw : []).filter((item) => item && item.count > 0);
    return key === 'author' || key === 'series'
      ? items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
      : items;
  }

  function facetModel(key, items) {
    const expanded = !!facetUI.expanded[key];
    const limit = FACET_LIMITS[key] || LIMIT;
    const q = String(facetUI.query[key] || '').trim();
    const server = SERVER_FACETS.has(key);
    const result = q ? facetUI.results[key] : null;
    const active = result && result.q === q ? result : null;
    let base = items;
    if (q) {
      if (active) base = sortFacetItems(key, active.items);
      else base = sortFacetItems(key, items.filter((item) => matches(item, q)).slice(0, 100));
    }
    const shown = expanded ? withPinned(key, base) : collapsedItems(key, base, limit);
    const knownTotal = key === 'author' ? state().facets.authorTotal
      : key === 'tag' ? state().facets.tagTotal
        : key === 'series' ? state().facets.seriesTotal : null;
    const total = server
      ? (active ? active.total : (q ? base.length : (knownTotal ?? items.length)))
      : items.length;
    let note = '';
    if (facetUI.searching[key] && q) {
      note = '正在搜索…';
    } else if (active && active.total > active.items.length) {
      note = `仅显示前 ${active.items.length} 项，请输入更精确的关键词`;
    } else if (expanded && server && !q && total > items.length) {
      note = `仅显示前 ${items.length} 项，输入关键词可查找全部`;
    }
    return { expanded, limit, q, server, base, shown, total, note };
  }

  const displayCount = (value) => (state().facetsLoaded ? value : null);

  function statusSectionHtml() {
    const s = state();
    return `<section class="wb-section" data-side-section="status">
      ${sectionHead('status', '阅读状态')}
      ${sectionBody('status', `<div>
        ${row({ label: '想读', count: displayCount(s.facets.byStatus.wish), active: s.status === 'wish', axis: 'status', value: 'wish' })}
        ${row({ label: '在读', count: displayCount(s.facets.byStatus.reading), active: s.status === 'reading', axis: 'status', value: 'reading' })}
        ${row({ label: '已读', count: displayCount(s.facets.byStatus.done), active: s.status === 'done', axis: 'status', value: 'done' })}
      </div>`)}
    </section>`;
  }

  function collectionsSectionHtml() {
    return `<section class="wb-section" data-side-section="collections">
      ${sectionHead('collections', '我的分类', '<button type="button" class="wb-section-add" data-collection-act="create" title="新建分类" aria-label="新建分类">+</button>')}
      ${sectionBody('collections', collectionRows())}
    </section>`;
  }

  function vlSectionHtml() {
    const s = state();
    const vls = (s.facets.virtualLibraries || []).map((v) => ({ name: v.name, count: v.count }));
    if (!vls.length) return '';
    return `<section class="wb-section" data-side-section="vl">
      ${sectionHead('vl', '智能书架')}
      ${sectionBody('vl', vls.map((v) => row({
        label: v.name, count: v.count, active: s.vl === v.name, axis: 'vl', value: v.name,
      })).join(''))}
    </section>`;
  }

  function sideSectionHtml(id) {
    if (id === 'status') return statusSectionHtml();
    if (id === 'collections') return collectionsSectionHtml();
    if (id === 'vl') return vlSectionHtml();
    return '';
  }

  function facetRows(key, items, param) {
    const activeValue = state()[key];
    return items.map((item) => row({
      label: item.name,
      count: item.count,
      active: String(activeValue) === String(item.name),
      axis: key,
      value: item.name,
    })).join('');
  }

  function matches(item, q) {
    return String(item.name).toLowerCase().includes(q.toLowerCase());
  }

  function sortFacetItems(key, items) {
    if (key !== 'author' && key !== 'series') return items;
    return items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
  }

  function withPinned(key, items) {
    const active = String(state()[key] || '');
    if (!active || items.some((item) => String(item.name) === active)) return items;
    const pinned = facetUI.pinned[key];
    const count = pinned && String(pinned.name) === active ? pinned.count : null;
    return [{ name: active, count }, ...items];
  }

  function rememberPinned(key, value) {
    if (!SERVER_FACETS.has(key)) return;
    const name = String(value);
    const sources = [facetUI.results[key]?.items || [], state().facets[FACET_KEYS[key]] || []];
    let match = null;
    for (const list of sources) {
      match = list.find((item) => String(item.name) === name);
      if (match) break;
    }
    if (match) facetUI.pinned[key] = { name, count: match.count };
    else if (!facetUI.pinned[key] || facetUI.pinned[key].name !== name) {
      facetUI.pinned[key] = { name, count: null };
    }
  }

  function collapsedItems(key, items, limit) {
    const list = withPinned(key, items);
    const active = String(state()[key] || '');
    if (!active) return list.slice(0, limit);
    const index = list.findIndex((item) => String(item.name) === active);
    if (index < 0 || index < limit) return list.slice(0, limit);
    return [list[index], ...list.filter((_, i) => i !== index).slice(0, limit - 1)];
  }

  function facetRowsHtml(key, items) {
    return items.length
      ? facetRows(key, items, key)
      : '<div class="wb-facet-empty">没有匹配项</div>';
  }

  function facetSection(key, items) {
    const title = FACET_TITLES[key];
    const { expanded, limit, shown, total, note } = facetModel(key, items);
    const server = SERVER_FACETS.has(key);
    const rowsHtml = facetRowsHtml(key, shown);
    const input = server
      ? `<input class="wb-facet-filter" data-facet="${key}" value="${esc(facetUI.query[key] || '')}" maxlength="100" placeholder="筛选${title}" aria-label="筛选${title}">`
      : '';
    const moreHidden = !expanded && total <= limit;
    const moreAttr = expanded ? 'data-facet-close' : 'data-facet-more';
    const moreLabel = expanded ? '收起' : `显示更多 · ${total}`;
    return `<section class="wb-section" data-facet-section="${key}">
      ${sectionHead(key, title)}
      ${sectionBody(key, `<div class="wb-facet-body" data-facet-body="${key}">${input}<div class="wb-facet-list" data-facet-list="${key}" data-expanded="${expanded}">${rowsHtml}</div><div class="wb-facet-note" data-facet-note="${key}"${note ? '' : ' hidden'}>${esc(note)}</div><button type="button" class="wb-facet-more" ${moreAttr}="${key}" aria-expanded="${expanded}"${moreHidden ? ' hidden' : ''}>${moreLabel}</button></div>`)}
    </section>`;
  }

  // 只更新一个分组的行、说明和“显示更多/收起”按钮；不触碰顶部标题、
  // 其他分组或搜索框，因此输入焦点、光标和外层滚动都保持原样。
  function updateFacetRows(key, { resetScroll = false } = {}) {
    const root = $('#wbSidebar');
    if (!root) return;
    const section = root.querySelector(attrSelector('data-facet-section', key));
    if (!section) return;
    const items = facetItems(key);
    const model = facetModel(key, items);
    const list = section.querySelector(attrSelector('data-facet-list', key));
    if (list) {
      const previousScroll = list.scrollTop;
      list.innerHTML = facetRowsHtml(key, model.shown);
      list.setAttribute('data-expanded', String(model.expanded));
      if (!resetScroll && previousScroll > 0) {
        list.scrollTop = clampScrollTop(previousScroll, list.scrollHeight - list.clientHeight);
      }
    }
    const note = section.querySelector(attrSelector('data-facet-note', key));
    if (note) {
      note.hidden = !model.note;
      note.textContent = model.note;
    }
    const btn = section.querySelector('.wb-facet-more');
    if (btn) {
      btn.hidden = !model.expanded && model.total <= model.limit;
      btn.textContent = model.expanded ? '收起' : `显示更多 · ${model.total}`;
      btn.removeAttribute('data-facet-more');
      btn.removeAttribute('data-facet-close');
      btn.setAttribute(model.expanded ? 'data-facet-close' : 'data-facet-more', key);
      btn.setAttribute('aria-expanded', String(model.expanded));
    }
    if (!resetScroll) clampAncestorScroll(root);
  }

  function collectionRows() {
    const items = state().facets.collections;
    const editing = S.sidebarEdit || null;
    let html = items.map((c) => {
      if (editing && editing.mode === 'rename' && Number(editing.id) === c.id) {
        return `<form class="wb-inline-form" data-collection-form="rename" data-id="${c.id}">
          <input class="wb-inline-input" name="name" value="${esc(c.name)}" maxlength="100" aria-label="重命名藏书集">
          <button class="wb-inline-ok" type="submit">保存</button>
        </form>`;
      }
      return `<div class="wb-collection-row">
        <button type="button" class="wb-row${String(state().collection) === String(c.id) ? ' is-active' : ''}" data-axis="collection" data-value="${c.id}">
          <span class="wb-row-name">${esc(c.name)}</span>
          <span class="wb-row-count">${c.count}</span>
        </button>
        <span class="wb-row-actions">
          <button type="button" class="wb-row-act" data-collection-act="rename" data-id="${c.id}" title="重命名" aria-label="重命名 ${esc(c.name)}">✎</button>
          <button type="button" class="wb-row-act is-danger" data-collection-act="delete" data-id="${c.id}" title="删除" aria-label="删除 ${esc(c.name)}">✕</button>
        </span>
      </div>`;
    }).join('');
    if (!items.length && !(editing && editing.mode === 'create')) {
      html += '<div class="wb-facet-empty">还没有分类</div>';
    }
    if (editing && editing.mode === 'create') {
      html += `<form class="wb-inline-form" data-collection-form="create">
        <input class="wb-inline-input" name="name" placeholder="新分类名称" maxlength="100" aria-label="新分类名称">
        <button class="wb-inline-ok" type="submit">新建</button>
      </form>`;
    }
    return html;
  }

  function render() {
    const s = state();
    const root = $('#wbSidebar');
    if (!root) return;
    const view = captureSidebarViewState(root);
    const loaded = s.facetsLoaded;
    const loading = !loaded && (s.facetsStatus === 'loading' || s.facetsStatus === 'idle');
    const failed = s.facetsStatus === 'error';
    const allActive = !s.q && !s.status && !s.collection && !s.tag && !s.author && !s.series && !s.vl;
    const series = facetItems('series');
    const authors = facetItems('author');
    const tags = facetItems('tag');
    const statusNotice = failed
      ? `<div class="wb-side-status" role="status">
          ${esc(s.facetsError || '分类与统计加载失败')}
          <button type="button" data-facets-retry>重试</button>
        </div>`
      : '';

    root.innerHTML = `<div class="wb-side-head">
      <span>资料库</span>
      <button type="button" class="wb-side-close" data-sidebar-close aria-label="关闭资料库">✕</button>
    </div>
    <div class="wb-side-scroll">
      <section class="wb-section">
        ${row({ label: '全部图书', count: displayCount(s.facets.total), active: allActive, axis: 'all', value: '', className: 'wb-row-all' })}
      </section>

      ${!loaded && loading ? `<div class="wb-side-skeleton" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>` : ''}
      ${!loaded && failed ? statusNotice : ''}

      ${loaded ? `
      ${statusSectionHtml()}
      ${collectionsSectionHtml()}
      ${vlSectionHtml()}
      ${series.length ? facetSection('series', series) : ''}
      ${authors.length ? facetSection('author', authors) : ''}
      ${tags.length ? facetSection('tag', tags) : ''}
      ${failed ? statusNotice : ''}
      ` : ''}
    </div>`;
    restoreSidebarViewState(view, root);
  }

  function renderFacetSection(key) {
    const root = $('#wbSidebar');
    if (!root) return;
    const section = root.querySelector(attrSelector('data-facet-section', key));
    if (!section) return;
    const view = captureSidebarViewState(root);
    const items = facetItems(key);
    if (!items.length) section.remove();
    else section.outerHTML = facetSection(key, items);
    restoreSidebarViewState(view, root);
  }

  function renderSection(id) {
    const root = $('#wbSidebar');
    if (!root) return;
    const section = root.querySelector(attrSelector('data-side-section', id));
    const html = sideSectionHtml(id);
    if (!section) {
      if (html) render();
      return;
    }
    const view = captureSidebarViewState(root);
    if (!html) section.remove();
    else section.outerHTML = html;
    restoreSidebarViewState(view, root);
  }

  function toggleAxis(axis, value) {
    const s = state();
    if (axis === 'all') {
      Object.assign(s, {
        q: '', status: '', collection: '', tag: '', author: '', series: '', vl: '',
        sort: 'updated', sortExplicit: false,
      });
      const input = document.getElementById('searchInput');
      if (input) input.value = '';
      if (document.body.classList.contains('search-open') && typeof window.closeSearchOverlay === 'function') {
        window.closeSearchOverlay(false);
      }
      S.hooks.filterChanged({ refreshFacets: true, resetSearch: true });
      return;
    }
    if (!['status', 'collection', 'tag', 'author', 'series', 'vl'].includes(axis)) return;
    if (SERVER_FACETS.has(axis)) rememberPinned(axis, value);
    const current = String(s[axis] || '');
    s[axis] = current === String(value) ? '' : String(value);
    S.hooks.filterChanged({ refreshFacets: axis === 'vl' });
  }

  rootEvents();
  function rootEvents() {
    const root = $('#wbSidebar');
    if (!root) return;
    const searchTimers = {};
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-facets-retry]')) {
        state().facetsStatus = state().facetsLoaded ? 'refreshing' : 'loading';
        state().facetsError = '';
        render();
        await S.loadFacets();
        S.hooks.facetsChanged();
        return;
      }
      if (e.target.closest('[data-sidebar-close]')) {
        S.hooks.closeSidebar();
        return;
      }
      const section = e.target.closest('[data-section]');
      if (section) {
        const id = section.dataset.section;
        if (S.collapsed.has(id)) S.collapsed.delete(id);
        else S.collapsed.add(id);
        S.saveCollapsed();
        if (FACET_SECTION_KEYS.has(id)) renderFacetSection(id);
        else if (SIDE_SECTION_KEYS.has(id)) renderSection(id);
        else render();
        return;
      }
      const more = e.target.closest('[data-facet-more]');
      if (more) {
        facetUI.expanded[more.dataset.facetMore] = true;
        updateFacetRows(more.dataset.facetMore);
        return;
      }
      const closeFacet = e.target.closest('[data-facet-close]');
      if (closeFacet) {
        facetUI.expanded[closeFacet.dataset.facetClose] = false;
        updateFacetRows(closeFacet.dataset.facetClose);
        return;
      }
      const cAct = e.target.closest('[data-collection-act]');
      if (cAct) {
        e.stopPropagation();
        const act = cAct.dataset.collectionAct;
        if (act === 'create') {
          S.sidebarEdit = { mode: 'create' };
          renderSection('collections');
          const input = root.querySelector('form[data-collection-form="create"] input');
          if (input) input.focus({ preventScroll: true });
          return;
        }
        if (act === 'rename') {
          S.sidebarEdit = { mode: 'rename', id: Number(cAct.dataset.id) };
          renderSection('collections');
          const input = root.querySelector('form[data-collection-form="rename"] input');
          if (input) input.focus({ preventScroll: true });
          return;
        }
        if (act === 'delete') {
          const id = Number(cAct.dataset.id);
          const collection = state().facets.collections.find((c) => c.id === id);
          if (!collection) return;
          if (!confirm(`删除分类「${collection.name}」?书不会被删除。`)) return;
          try {
            await S.collections.remove(id);
            if (String(state().collection) === String(id)) state().collection = '';
            S.sidebarEdit = null;
            await S.loadFacets();
            S.hooks.facetsChanged();
            S.hooks.filterChanged({ reload: true });
            toast('分类已删除');
          } catch (err) { toast(err.message, true); }
          return;
        }
      }
      const axisBtn = e.target.closest('[data-axis]');
      if (axisBtn && !e.target.closest('[data-collection-act]')) {
        toggleAxis(axisBtn.dataset.axis, axisBtn.dataset.value);
      }
    });

    const hasBooksDrag = (e) => Array.from(e.dataTransfer.types || []).includes('application/x-mybooks-books');
    const draggedIds = (e) => {
      try {
        if (!hasBooksDrag(e)) return [];
        const ids = JSON.parse(e.dataTransfer.getData('application/x-mybooks-books') || '[]');
        return Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0) : [];
      } catch { return []; }
    };
    root.addEventListener('dragover', (e) => {
      const row = e.target.closest('[data-axis="collection"]');
      if (!row || !hasBooksDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      $$('#wbSidebar .is-drop-target').forEach((el) => { if (el !== row.closest('.wb-collection-row')) el.classList.remove('is-drop-target'); });
      row.closest('.wb-collection-row')?.classList.add('is-drop-target');
    });
    root.addEventListener('dragleave', (e) => {
      const row = e.target.closest('[data-axis="collection"]');
      if (!row) return;
      const wrap = row.closest('.wb-collection-row');
      if (wrap && !wrap.contains(e.relatedTarget)) wrap.classList.remove('is-drop-target');
    });
    root.addEventListener('drop', async (e) => {
      const row = e.target.closest('[data-axis="collection"]');
      if (!row) return;
      const ids = draggedIds(e);
      if (!ids.length) return;
      e.preventDefault();
      const wrap = row.closest('.wb-collection-row');
      wrap?.classList.remove('is-drop-target');
      document.body.classList.remove('dragging-books');
      const collectionId = Number(row.dataset.value);
      const collection = state().facets.collections.find((c) => c.id === collectionId);
      try {
        const res = await S.collections.add(collectionId, ids);
        await S.loadFacets();
        S.hooks.facetsChanged();
        toast(res.added
          ? `已把 ${res.added} 本加入「${collection ? collection.name : '分类'}」`
          : '这些书已在该分类中');
      } catch (err) { toast(err.message, true); }
    });

    root.addEventListener('input', (e) => {
      const input = e.target.closest('[data-facet]');
      if (!input) return;
      const key = input.dataset.facet;
      const q = input.value.trim();
      const seq = (facetUI.uiSeq[key] || 0) + 1;
      facetUI.uiSeq[key] = seq;
      facetUI.query[key] = input.value;
      facetUI.searching[key] = false;
      clearTimeout(searchTimers[key]);
      if (!SERVER_FACETS.has(key)) {
        updateFacetRows(key, { resetScroll: true });
        return;
      }
      if (!q) {
        facetUI.results[key] = null;
        updateFacetRows(key, { resetScroll: true });
        return;
      }
      // 先按本地已有数据过滤；搜索框和焦点完全不动。
      updateFacetRows(key, { resetScroll: true });
      facetUI.searching[key] = true;
      const note = root.querySelector(attrSelector('data-facet-note', key));
      if (note) { note.hidden = false; note.textContent = '正在搜索…'; }
      searchTimers[key] = setTimeout(async () => {
        const result = await S.searchFacet(key, q);
        // 旧请求即使回来得晚，也不能覆盖新输入；展开态在应用时重新读取。
        if (facetUI.uiSeq[key] !== seq || facetUI.query[key].trim() !== q) return;
        facetUI.searching[key] = false;
        if (!result) {
          const currentNote = root.querySelector(attrSelector('data-facet-note', key));
          if (currentNote) { currentNote.hidden = false; currentNote.textContent = '搜索暂不可用'; }
          return;
        }
        updateFacetRows(key, { resetScroll: true });
      }, SEARCH_DELAY);
    });

    root.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-collection-form]');
      if (!form) return;
      e.preventDefault();
      const name = String(new FormData(form).get('name') || '').trim();
      if (!name) return;
      const mode = form.dataset.collectionForm;
      try {
        if (mode === 'create') await S.collections.create(name);
        else await S.collections.rename(Number(form.dataset.id), name);
        S.sidebarEdit = null;
        await S.loadFacets();
        S.hooks.facetsChanged();
        toast(mode === 'create' ? '分类已创建' : '分类已重命名');
      } catch (err) {
        toast(err.message, true);
      }
    });

    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (S.sidebarEdit) {
        S.sidebarEdit = null;
        renderSection('collections');
      }
    });
  }

  S.sidebar = {
    render,
    toggleAxis,
    renderFacetSection,
    renderSection,
    updateFacetRows,
    captureViewState: captureSidebarViewState,
    restoreViewState: restoreSidebarViewState,
  };
})();
