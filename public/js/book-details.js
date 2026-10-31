/* ============================================================
 * 统一书籍详情组件
 *
 * Inspector（书架右栏 / 手机 Bottom Sheet）和其他页面的详情抽屉
 * 共用这一份内容、数据加载与快捷编辑逻辑。旧 detailModal 的详情 HTML
 * 已迁移到这里，不再维护第二套展示。
 * ============================================================ */

(function () {
  const TAG_PREVIEW = 8;
  const SUMMARY_COLLAPSE_AT = 140;
  const STATUS = [['wish', '想读'], ['reading', '在读'], ['done', '已读']];

  function parseJson(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function tagsOf(book) {
    const tags = parseJson(book && book.tags, []);
    return Array.isArray(tags) ? tags : [];
  }

  function logsOf(book) {
    const logs = parseJson(book && book.read_logs, []);
    return Array.isArray(logs) ? logs : [];
  }

  function fileRows(book) {
    const files = Array.isArray(book.files) ? book.files : [];
    if (!files.length) return '<p class="bd-muted">未上传电子书</p>';
    return `<div class="bd-files">${files.map((f) => `
      <a class="bd-file" href="${esc(f.download_url || `/books-files/${f.path}`)}" download>
        <span class="bd-file-format">.${esc(f.format)}</span>
        <span class="bd-file-size">${fileSizeText(f.size)}</span>
        <span class="bd-file-arrow" aria-hidden="true">↓</span>
      </a>`).join('')}</div>`;
  }

  function identifierRows(book) {
    const list = (book && book.identifier_list) || [];
    const rest = list.filter((x) => !['isbn', 'douban', 'douban_id'].includes(String(x.type).toLowerCase()));
    if (!rest.length) return '';
    return `<div class="bd-row"><span class="bd-k">标识符</span><span class="bd-v">${rest.map((x) => (x.url
      ? `<a class="bd-link" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label)} ↗</a>`
      : `${esc(x.label)}:${esc(x.value)}`)).join(' · ')}</span></div>`;
  }

  const statusLabel = (value) => (STATUS.find(([v]) => v === value) || ['', '未设置'])[1];
  const seriesText = (book) => book.series
    ? `${esc(book.series)}${book.series_index ? ' #' + esc(String(book.series_index)) : ''}`
    : '';
  const missing = () => '<span class="bd-missing">未设置</span>';

  function metaRow(label, value) {
    return `<div class="bd-row"><span class="bd-k">${esc(label)}</span><span class="bd-v">${value}</span></div>`;
  }

  function copyButton(value) {
    return `<button type="button" class="bd-copy" data-bd-copy="${esc(value)}" aria-label="复制 ISBN">复制</button>`;
  }

  function inlineError(state) {
    const error = state.inlineEdit && state.inlineEdit.error;
    return error ? `<span class="bd-inline-error" role="alert">${esc(error)}</span>` : '';
  }

  function ratingBlock(book, state, readOnly) {
    const rating = Number(book.rating) > 0 ? book.rating : '';
    if (readOnly) {
      return metaRow('评分', rating
        ? `${esc(String(rating))} <span class="bd-unit">/ 10</span>`
        : '<span class="bd-missing">未评分</span>');
    }
    if (state.inlineEdit && state.inlineEdit.field === 'rating') {
      return `<div class="bd-row bd-row-editing">
        <span class="bd-k">评分</span>
        <span class="bd-v bd-quick-editor" data-bd-inline-editor="rating">
          <input class="bd-quick-input bd-quick-rating" type="number" min="0" max="10" step="0.1"
            value="${esc(state.inlineEdit.draft || '')}" placeholder="0–10"
            data-bd-inline="rating" aria-label="评分（满分 10）">
          <span class="bd-unit">/ 10</span>
          ${inlineError(state)}
        </span>
      </div>`;
    }
    return metaRow('评分', `<button type="button" class="bd-static-value${rating ? '' : ' is-empty'}"
      data-bd-edit-rating aria-label="${rating ? '编辑评分' : '添加评分'}">${rating
      ? `${esc(String(rating))} <span class="bd-unit">/ 10</span>` : '添加评分'}</button>`);
  }

  function seriesBlock(book, state, readOnly) {
    const editing = state.inlineEdit && state.inlineEdit.field === 'series';
    if (readOnly) {
      return book.series ? metaRow('系列', seriesText(book)) : '';
    }
    if (editing) {
      return `<div class="bd-row bd-row-editing">
        <span class="bd-k">系列</span>
        <span class="bd-v bd-quick-editor bd-series-editor" data-bd-inline-editor="series">
          <input class="bd-quick-input" type="text" value="${esc(state.inlineEdit.name || '')}"
            placeholder="系列名" maxlength="200" data-bd-inline="series-name" aria-label="系列名">
          <input class="bd-quick-input bd-quick-index" type="text" value="${esc(state.inlineEdit.index || '')}"
            placeholder="序号" maxlength="20" data-bd-inline="series-index" aria-label="系列序号">
          ${inlineError(state)}
        </span>
      </div>`;
    }
    if (!book.series) return '';
    return metaRow('系列', `<button type="button" class="bd-static-value" data-bd-edit-series aria-label="编辑系列">${seriesText(book)}</button>`);
  }

  function primaryInfoHtml(book, state, readOnly) {
    const pub = [book.publisher, book.pub_year].filter(Boolean).join(' · ');
    let rows = ratingBlock(book, state, readOnly) + seriesBlock(book, state, readOnly);
    if (pub) rows += metaRow('出版', esc(pub));
    if (book.isbn) rows += metaRow('ISBN', `<span class="bd-copy-value"><span>${esc(book.isbn)}</span>${copyButton(book.isbn)}</span>`);
    if (book.douban_id) {
      rows += metaRow('豆瓣', `<a class="bd-link" href="https://book.douban.com/subject/${esc(book.douban_id)}/" target="_blank" rel="noopener noreferrer">查看豆瓣条目 ↗</a>`);
    }
    return rows;
  }

  function moreInfoHtml(book, state, readOnly, custom) {
    if (readOnly) return '';
    const pub = [book.publisher, book.pub_year].filter(Boolean).join(' · ');
    let rows = '';
    if (!pub) rows += metaRow('出版', missing());
    if (!book.isbn) rows += metaRow('ISBN', missing());
    if (!book.douban_id) rows += metaRow('豆瓣', missing());
    if (!book.series && !(state.inlineEdit && state.inlineEdit.field === 'series')) {
      rows += metaRow('系列', '<button type="button" class="bd-static-value is-empty" data-bd-edit-series>添加系列</button>');
    }
    rows += identifierRows(book) || metaRow('标识符', missing());
    const customEntries = Object.entries(custom);
    const customHtml = customEntries.length
      ? `<div class="bd-more-subtitle">自定义字段</div><div class="bd-meta">${customEntries.map(([key, value]) => metaRow(key, esc(value))).join('')}</div>`
      : '';
    return `<section class="bd-section">
      <button type="button" class="bd-more-toggle" data-bd-more aria-expanded="${state.moreExpanded}">
        <span>更多信息</span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      ${state.moreExpanded ? `<div class="bd-more-panel"><div class="bd-meta">${rows}</div>${customHtml}<p class="bd-more-note">空字段可在「编辑全部」中补充。</p></div>` : ''}
    </section>`;
  }

  function summaryHtml(book, state) {
    if (!book.summary) return '';
    const text = String(book.summary);
    const long = text.length > SUMMARY_COLLAPSE_AT;
    const collapsed = long && !state.summaryExpanded;
    return `<section class="bd-section">
      <h3 class="bd-section-title">简介</h3>
      <p class="bd-summary${collapsed ? ' is-collapsed' : ''}">${esc(text)}</p>
      ${long ? `<button type="button" class="bd-summary-toggle" data-bd-summary-toggle aria-expanded="${state.summaryExpanded}">${state.summaryExpanded ? '收起' : '展开全文'}</button>` : ''}
    </section>`;
  }

  function logsHtml(book) {
    const logs = logsOf(book);
    if (!logs.length) {
      if (!book.start_date && !book.finish_date) return '';
      const legacy = [book.start_date ? `开始于 ${book.start_date}` : '', book.finish_date ? `读完于 ${book.finish_date}` : ''].filter(Boolean).join(' · ');
      return `<section class="bd-section">
        <h3 class="bd-section-title">阅读记录</h3>
        <div class="bd-chips"><span class="log-chip">${esc(legacy)}</span></div>
      </section>`;
    }
    return `<section class="bd-section">
      <h3 class="bd-section-title">阅读记录</h3>
      <div class="bd-chips">${logs.map((l) => `<span class="log-chip">${esc(l.start || '开始未记')}${l.finish ? ' 至 ' + esc(l.finish) : ' · 进行中'}</span>`).join('')}</div>
    </section>`;
  }

  function headHtml() {
    return `<div class="bd-head">
      <span class="bd-grabber" data-bd-grabber aria-hidden="true"></span>
      <button type="button" class="icon-btn bd-close" data-bd-close aria-label="关闭详情">✕</button>
    </div>`;
  }

  function contentHtml(book, state) {
    const readOnly = !!state.readOnly;
    const tags = tagsOf(book);
    const visibleTags = state.tagsExpanded ? tags : tags.slice(0, TAG_PREVIEW);
    const custom = book.custom_display && typeof book.custom_display === 'object' ? book.custom_display : {};
    const memberships = Array.isArray(book.collections) ? book.collections : [];
    const available = (state.collections || []).filter((c) => !memberships.some((m) => String(m.id) === String(c.id)));
    const pop = state.collectionPop ? `<div class="bd-pop" role="dialog" aria-label="加入分类">
      ${state.collectionsLoading ? '<div class="bd-pop-empty">载入中…</div>' : (available.length
        ? available.map((c) => `<button type="button" data-bd-add-collection="${c.id}">${esc(c.name)}</button>`).join('')
        : '<div class="bd-pop-empty">已在该书的全部分类中</div>')}
      <form class="bd-inline-form" data-bd-new-collection>
        <input class="bd-inline-input" name="name" placeholder="新建分类并加入" maxlength="100" aria-label="新建分类并加入">
        <button class="btn btn-primary btn-sm" type="submit">加入</button>
      </form>
    </div>` : '';

    return `<div class="bd-scroll">
      ${headHtml()}
      <div class="bd-hero">
        <div class="bd-cover">${coverHtml(book)}</div>
        <div class="bd-intro">
          <h2 class="bd-title">${esc(book.title)}</h2>
          <p class="bd-author">${book.author ? esc(book.author) : '未设置作者'}</p>
        </div>
      </div>
      ${readOnly
        ? `<p class="bd-status-static">阅读状态 · <span>${esc(statusLabel(book.status))}</span></p>`
        : `<div class="seg seg--track bd-status" role="group" aria-label="阅读状态">
            ${STATUS.map(([value, label]) => `<button type="button" class="${book.status === value ? 'active' : ''}" data-bd-status="${value}">${label}</button>`).join('')}
          </div>`}

      <section class="bd-section bd-info-section">
        <h3 class="bd-section-title">书籍信息</h3>
        <div class="bd-meta">${primaryInfoHtml(book, state, readOnly)}</div>
      </section>

      ${summaryHtml(book, state)}
      ${logsHtml(book)}

      <section class="bd-section">
        <h3 class="bd-section-title">标签</h3>
        <div class="bd-chips">
          ${readOnly
            ? (tags.length ? tags.map((t) => `<span class="tag-chip bd-tag">${esc(t)}</span>`).join('') : '<span class="bd-missing">暂无标签</span>')
            : `${visibleTags.map((t) => `<span class="tag-chip bd-tag">${esc(t)}<button type="button" data-bd-remove-tag="${esc(t)}" aria-label="移除标签 ${esc(t)}">✕</button></span>`).join('')}
               ${tags.length > TAG_PREVIEW ? `<button type="button" class="bd-chip-more" data-bd-tags-more>${state.tagsExpanded ? '收起' : `显示更多 (${tags.length - TAG_PREVIEW})`}</button>` : ''}
               <input class="bd-chip-input" type="text" placeholder="+ 标签" data-bd-new-tag aria-label="添加标签">`}
        </div>
      </section>

      ${readOnly ? '' : `<section class="bd-section">
        <h3 class="bd-section-title">分类</h3>
        <div class="bd-collection">
          <div class="bd-chips">
            ${memberships.map((c) => `<span class="tag-chip bd-tag">${esc(c.name)}<button type="button" data-bd-remove-collection="${c.id}" aria-label="移出分类 ${esc(c.name)}">✕</button></span>`).join('')}
            <button type="button" class="bd-chip-add" data-bd-collection-add>+ 分类</button>
          </div>
          ${pop}
        </div>
      </section>

      <section class="bd-section">
        <h3 class="bd-section-title">电子书</h3>
        ${fileRows(book)}
      </section>

      ${moreInfoHtml(book, state, readOnly, custom)}

      <div class="bd-actions">
        <div class="bd-actions-main">
          <button type="button" class="btn btn-primary" data-bd-edit>编辑全部</button>
          <a class="btn btn-ghost" href="/notes/${book.id}">读书心得</a>
        </div>
        <button type="button" class="bd-delete" data-bd-delete>移到回收站</button>
      </div>`}
    </div>`;
  }

  async function defaultLoadBook(id) {
    return api('/api/books/' + id);
  }

  async function defaultPublicLoadBook(id) {
    return apiPublic('/api/public/books/' + id);
  }

  async function defaultPatchBook(book, patch) {
    let base = book;
    if (!base || !base.revision || !base.uuid) base = await defaultLoadBook(book.id);
    const body = { ...patch, expected_revision: base.revision, expected_uuid: base.uuid };
    return api('/api/books/' + book.id, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async function defaultCollections() {
    const list = await api('/api/collections').catch(() => []);
    return Array.isArray(list) ? list : [];
  }

  function create(host, options = {}) {
    if (!host) throw new Error('BookDetails requires a host element');
    const sheet = options.sheet || host.closest('.wb-inspector, .book-detail-sheet') || host;
    const state = {
      book: null,
      seq: 0,
      readOnly: !!options.readOnly,
      tagsExpanded: false,
      summaryExpanded: false,
      moreExpanded: false,
      inlineEdit: null,
      collectionPop: false,
      collections: null,
      collectionsLoading: false,
      busy: false,
    };
    let destroyed = false;
    let drag = null;

    const loadBook = options.loadBook || (state.readOnly ? defaultPublicLoadBook : defaultLoadBook);
    const patchBook = options.patchBook || defaultPatchBook;
    const loadCollections = options.loadCollections || defaultCollections;

    function toastSafe(message, isError = false) {
      if (typeof toast === 'function') toast(message, isError);
    }

    function fitSummary() {
      if (destroyed) return;
      const summary = host.querySelector('.bd-summary.is-collapsed');
      if (!summary || summary.clientHeight <= 0) return;
      if (summary.scrollHeight <= summary.clientHeight + 2) {
        summary.classList.remove('is-collapsed');
        summary.parentElement?.querySelector('[data-bd-summary-toggle]')?.remove();
      }
    }

    function captureInlineDrafts() {
      const inline = state.inlineEdit;
      if (!inline) return;
      const rating = host.querySelector('[data-bd-inline="rating"]');
      if (inline.field === 'rating' && rating) inline.draft = rating.value;
      if (inline.field === 'series') {
        const name = host.querySelector('[data-bd-inline="series-name"]');
        const index = host.querySelector('[data-bd-inline="series-index"]');
        if (name) inline.name = name.value;
        if (index) inline.index = index.value;
      }
    }

    function restoreInlineFocus() {
      const inline = state.inlineEdit;
      if (!inline) return;
      const selector = inline.field === 'rating'
        ? '[data-bd-inline="rating"]'
        : (inline.focus === 'index' ? '[data-bd-inline="series-index"]' : '[data-bd-inline="series-name"]');
      const input = host.querySelector(selector);
      if (!input) return;
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* ignore */ }
    }

    function render() {
      if (destroyed || !state.book) return;
      captureInlineDrafts();
      const previous = host.querySelector('.bd-scroll');
      const scrollTop = previous ? previous.scrollTop : 0;
      host.innerHTML = contentHtml(state.book, state);
      const next = host.querySelector('.bd-scroll');
      if (next && scrollTop) next.scrollTop = scrollTop;
      restoreInlineFocus();
      fitSummary();
      if (!host.getClientRects().length) requestAnimationFrame(fitSummary);
    }

    function setBook(book) {
      if (!book) { showMessage('选择一本书'); return; }
      if (!state.book || state.book.id !== book.id) {
        state.tagsExpanded = false;
        state.summaryExpanded = false;
        state.moreExpanded = false;
        state.inlineEdit = null;
        state.collectionPop = false;
        state.collections = null;
      }
      state.book = book;
      render();
    }

    function showMessage(message, { loading = false } = {}) {
      host.innerHTML = `<div class="bd-scroll">
        ${headHtml()}
        <div class="bd-empty"${loading ? ' aria-busy="true"' : ''}>${esc(message)}</div>
      </div>`;
    }

    async function reload() {
      if (!state.book) return null;
      const book = await loadBook(state.book.id);
      if (book) setBook(book);
      return book;
    }

    async function patch(patchData, message) {
      if (!state.book || state.busy) return;
      state.busy = true;
      try {
        const updated = await patchBook(state.book, patchData);
        if (updated) state.book = updated;
        render();
        await options.onChanged?.(state.book, patchData);
        if (message) toastSafe(message);
      } catch (err) {
        toastSafe(err.message, true);
        if (err.code === 'CONFLICT') {
          try { await reload(); } catch { /* ignore */ }
        }
      } finally {
        state.busy = false;
      }
    }

    function startInline(field) {
      if (state.readOnly || !state.book || state.inlineEdit) return;
      if (field === 'rating') {
        state.inlineEdit = {
          field: 'rating',
          draft: Number(state.book.rating) > 0 ? String(state.book.rating) : '',
          error: '',
          focus: 'rating',
        };
      } else if (field === 'series') {
        state.inlineEdit = {
          field: 'series',
          name: state.book.series || '',
          index: state.book.series_index ? String(state.book.series_index) : '',
          error: '',
          focus: 'name',
        };
      } else {
        return;
      }
      render();
    }

    function cancelInline() {
      if (!state.inlineEdit) return false;
      const field = state.inlineEdit.field;
      state.inlineEdit = null;
      render();
      const trigger = host.querySelector(field === 'rating' ? '[data-bd-edit-rating]' : '[data-bd-edit-series]');
      trigger?.focus({ preventScroll: true });
      return true;
    }

    async function commitInline() {
      const inline = state.inlineEdit;
      if (!inline || state.busy) return;
      captureInlineDrafts();
      let payload;
      let message;
      if (inline.field === 'rating') {
        const raw = String(inline.draft || '').trim();
        if (raw) {
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0 || value > 10) {
            inline.error = '评分请输入 0 到 10 之间的数字';
            render();
            setTimeout(restoreInlineFocus, 0);
            return;
          }
          payload = { rating: value };
        } else {
          payload = { rating: 0 };
        }
        message = payload.rating ? '评分已更新' : '评分已清除';
      } else {
        const name = String(inline.name || '').trim();
        const index = String(inline.index || '').trim();
        if (!name && index) {
          inline.error = '请先填写系列名';
          render();
          setTimeout(restoreInlineFocus, 0);
          return;
        }
        if (index && !/^\d+(\.\d+)?$/.test(index)) {
          inline.error = '系列序号应为数字';
          render();
          setTimeout(restoreInlineFocus, 0);
          return;
        }
        payload = { series: name, series_index: index };
        message = '系列已更新';
      }
      state.busy = true;
      try {
        const updated = await patchBook(state.book, payload);
        if (updated) state.book = updated;
        state.inlineEdit = null;
        render();
        toastSafe(message);
        await options.onChanged?.(state.book, payload);
      } catch (err) {
        if (err.code === 'CONFLICT') {
          try {
            const fresh = await loadBook(state.book.id);
            if (fresh) state.book = fresh;
          } catch { /* keep old book; user can retry */ }
        }
        inline.error = err.message || '保存失败，请重试';
        render();
        setTimeout(restoreInlineFocus, 0);
        toastSafe(inline.error, true);
      } finally {
        state.busy = false;
      }
    }

    async function copyText(value) {
      try {
        await navigator.clipboard.writeText(value);
        toastSafe('ISBN 已复制');
      } catch {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand && document.execCommand('copy');
        area.remove();
        toastSafe(ok ? 'ISBN 已复制' : '复制失败，请手动选择', !ok);
      }
    }

    async function ensureCollections() {
      if (state.collections) return;
      state.collectionsLoading = true;
      render();
      state.collections = await loadCollections() || [];
      state.collectionsLoading = false;
      render();
    }

    async function addCollection(id) {
      if (!state.book) return;
      try {
        await api('/api/collections/' + id + '/books', { method: 'POST', body: JSON.stringify({ ids: [state.book.id] }) });
        state.collectionPop = false;
        await reload();
        toastSafe('已加入分类');
        await options.onChanged?.(state.book, { collection: true });
      } catch (err) { toastSafe(err.message, true); }
    }

    async function removeCollection(id) {
      if (!state.book) return;
      try {
        await api('/api/collections/' + id + '/books', { method: 'DELETE', body: JSON.stringify({ ids: [state.book.id] }) });
        await reload();
        toastSafe('已移出分类');
        await options.onChanged?.(state.book, { collection: true });
      } catch (err) { toastSafe(err.message, true); }
    }

    async function createCollection(name) {
      if (!state.book) return;
      try {
        const created = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name }) });
        const id = created && created.item ? created.item.id : created && created.id;
        if (id) await api('/api/collections/' + id + '/books', { method: 'POST', body: JSON.stringify({ ids: [state.book.id] }) });
        state.collectionPop = false;
        await reload();
        toastSafe('分类已创建并加入');
        await options.onChanged?.(state.book, { collection: true });
      } catch (err) { toastSafe(err.message, true); }
    }

    function closePop() {
      if (!state.collectionPop) return false;
      state.collectionPop = false;
      render();
      return true;
    }

    function onClick(e) {
      if (!state.book) {
        if (e.target.closest('[data-bd-close]')) { e.preventDefault(); options.onClose?.(); }
        return;
      }
      if (e.target.closest('[data-bd-close]')) { e.preventDefault(); options.onClose?.(); return; }
      const copy = e.target.closest('[data-bd-copy]');
      if (copy) {
        e.preventDefault();
        copyText(copy.dataset.bdCopy || '');
        return;
      }
      if (state.readOnly) return;
      if (e.target.closest('[data-bd-edit-rating]')) { startInline('rating'); return; }
      if (e.target.closest('[data-bd-edit-series]')) { startInline('series'); return; }
      if (e.target.closest('[data-bd-more]')) { state.moreExpanded = !state.moreExpanded; render(); return; }
      const status = e.target.closest('[data-bd-status]');
      if (status) { patch({ status: status.dataset.bdStatus }, '状态已更新'); return; }
      if (e.target.closest('[data-bd-tags-more]')) { state.tagsExpanded = !state.tagsExpanded; render(); return; }
      if (e.target.closest('[data-bd-summary-toggle]')) { state.summaryExpanded = !state.summaryExpanded; render(); return; }
      const removeTag = e.target.closest('[data-bd-remove-tag]');
      if (removeTag) {
        const tags = tagsOf(state.book).filter((t) => t !== removeTag.dataset.bdRemoveTag);
        patch({ tags }, '标签已更新');
        return;
      }
      if (e.target.closest('[data-bd-collection-add]')) {
        state.collectionPop = !state.collectionPop;
        if (state.collectionPop) {
          state.collections = null;
          ensureCollections();
        } else {
          render();
        }
        return;
      }
      const addCollectionBtn = e.target.closest('[data-bd-add-collection]');
      if (addCollectionBtn) { addCollection(Number(addCollectionBtn.dataset.bdAddCollection)); return; }
      const removeCollectionBtn = e.target.closest('[data-bd-remove-collection]');
      if (removeCollectionBtn) { removeCollection(Number(removeCollectionBtn.dataset.bdRemoveCollection)); return; }
      if (e.target.closest('[data-bd-edit]')) { options.onEdit?.(state.book); return; }
      if (e.target.closest('[data-bd-delete]')) { options.onDelete?.(state.book); }
    }

    function onInput(e) {
      if (!state.inlineEdit || !e.target.closest('[data-bd-inline-editor]')) return;
      captureInlineDrafts();
      if (state.inlineEdit.error) {
        state.inlineEdit.error = '';
        const error = host.querySelector('.bd-inline-error');
        if (error) {
          error.textContent = '';
          error.hidden = true;
        }
      }
    }

    function onFocusIn(e) {
      if (!state.inlineEdit || state.inlineEdit.field !== 'series') return;
      if (e.target.matches('[data-bd-inline="series-index"]')) state.inlineEdit.focus = 'index';
      else if (e.target.matches('[data-bd-inline="series-name"]')) state.inlineEdit.focus = 'name';
    }

    function onFocusOut(e) {
      const inline = state.inlineEdit;
      if (!inline || !e.target.closest('[data-bd-inline-editor]')) return;
      const editor = e.target.closest('[data-bd-inline-editor]');
      if (e.relatedTarget && editor.contains(e.relatedTarget)) return;
      if (e.relatedTarget && e.relatedTarget.closest(
        '[data-bd-edit-rating], [data-bd-edit-series], [data-bd-more]'
      )) return;
      const field = inline.field;
      setTimeout(() => {
        if (state.inlineEdit && state.inlineEdit.field === field && !state.busy) commitInline();
      }, 0);
    }

    function onKeydown(e) {
      if (state.readOnly) return;
      if (state.inlineEdit && e.target.closest('[data-bd-inline-editor]')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitInline();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelInline();
          return;
        }
      }
      if (e.key === 'Enter' && e.target.matches('[data-bd-new-tag]')) {
        e.preventDefault();
        const value = e.target.value.trim();
        if (!value) return;
        const tags = [...new Set([...tagsOf(state.book), value])];
        e.target.value = '';
        patch({ tags }, '标签已添加');
      }
    }

    function onSubmit(e) {
      if (state.readOnly) return;
      const form = e.target.closest('[data-bd-new-collection]');
      if (!form) return;
      e.preventDefault();
      const name = String(new FormData(form).get('name') || '').trim();
      if (name) createCollection(name);
    }

    function onDocPointer(e) {
      if (!state.collectionPop) return;
      if (e.target.closest('.bd-pop') || e.target.closest('[data-bd-collection-add]')) return;
      closePop();
    }

    function onDocKey(e) {
      if (e.key !== 'Escape') return;
      const modalHost = host.closest('.modal');
      if (host.hidden || (modalHost && modalHost.classList.contains('hidden'))) return;
      const other = document.querySelector(
        '.modal:not(.hidden), .sel-menu:not([hidden]), #mobileMenu.open, #searchFlyout.open, .wb-brand-menu:not([hidden]), .wb-layout-menu:not([hidden])'
      );
      // 详情自身的 modal 容器不算“上层浮层”；上层弹窗/菜单先处理自己的 Escape。
      if (other && !other.contains(host)) return;
      if (state.collectionPop) {
        e.preventDefault();
        e.stopPropagation();
        closePop();
        return;
      }
      if (state.inlineEdit) {
        e.preventDefault();
        e.stopPropagation();
        cancelInline();
        return;
      }
      if (host.closest('.modal.hidden')) return;
      e.preventDefault();
      e.stopPropagation();
      options.onClose?.();
    }

    function startDrag(e) {
      if (!e.target.closest('[data-bd-grabber]')) return;
      if (e.pointerType === 'mouse') return;
      drag = { id: e.pointerId, y: e.clientY, dy: 0 };
      sheet.style.transition = 'none';
      try { e.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    function moveDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      sheet.style.transform = `translateY(${drag.dy}px)`;
      e.preventDefault();
    }

    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = drag.dy;
      drag = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 80) options.onClose?.();
    }

    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    host.addEventListener('keydown', onKeydown);
    host.addEventListener('submit', onSubmit);
    host.addEventListener('pointerdown', startDrag);
    host.addEventListener('pointermove', moveDrag);
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointercancel', endDrag);
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onDocKey, true);

    return {
      setBook,
      showMessage,
      reload,
      closePop,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        host.removeEventListener('click', onClick);
        host.removeEventListener('input', onInput);
        host.removeEventListener('focusin', onFocusIn);
        host.removeEventListener('focusout', onFocusOut);
        host.removeEventListener('keydown', onKeydown);
        host.removeEventListener('submit', onSubmit);
        host.removeEventListener('pointerdown', startDrag);
        host.removeEventListener('pointermove', moveDrag);
        host.removeEventListener('pointerup', endDrag);
        host.removeEventListener('pointercancel', endDrag);
        document.removeEventListener('pointerdown', onDocPointer, true);
        document.removeEventListener('keydown', onDocKey, true);
      },
      get book() { return state.book; },
    };
  }

  window.BookDetails = {
    create,
    defaultLoadBook,
    defaultPublicLoadBook,
    defaultPatchBook,
    defaultCollections,
    tagsOf,
  };
})();
