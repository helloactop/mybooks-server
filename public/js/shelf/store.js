/* ============================================================
 * 书架工作区:状态、URL 与 API
 * 不直接操作 DOM;render 模块读取 ShelfUI.store.state。
 * ============================================================ */

(function () {
  const S = window.ShelfUI = window.ShelfUI || {};
  const PAGE_SIZE = 60;
  const FACET_INITIAL = 80;
  const FACET_SEARCH_LIMIT = 100;
  const FACET_ENDPOINTS = { author: '/api/authors', tag: '/api/tags', series: '/api/series' };
  const FACET_LISTS = { author: 'authors', tag: 'tags', series: 'series' };
  const SORTS = ['updated', 'created', 'title', 'author', 'series', 'finish', 'relevance'];

  S.PAGE_SIZE = PAGE_SIZE;
  S.state = {
    q: '',
    status: '',
    collection: '',
    tag: '',
    author: '',
    series: '',
    vl: '',
    sort: 'updated',
    sortExplicit: false,
    view: 'grid',
    density: 'standard',
    showInfo: false,
    columns: ['series', 'rating', 'format'],
    books: [],
    total: null,
    start: 0,
    loading: false,
    hasMore: true,
    selection: new Set(),
    anchorId: null,
    focusId: null,
    selectMode: false,
    inspectorOpen: false,
    inspectorId: null,
    inspectorBook: null,
    inspectorLoading: false,
    pageStatus: 'idle',
    pageError: '',
    facetsStatus: 'idle',
    facetsError: '',
    facetsLoaded: false,
    facets: {
      total: 0,
      byStatus: { wish: 0, reading: 0, done: 0 },
      collections: [],
      virtualLibraries: [],
      series: [],
      authors: [],
      tags: [],
    },
  };
  S.ui = { pageSeq: 0, facetSeq: 0, detailSeq: 0, facetSearchSeq: { author: 0, tag: 0 } };
  S.facetUI = { expanded: {}, query: {}, results: {}, pinned: {}, uiSeq: {}, searching: {} };

  // 完整详情缓存：列表行只含基础列，绝不能当作可编辑对象写回。
  // 缓存只接收带 files / identifier_list 的完整响应，并用列表行的 revision
  // 做一致性校验——列表刷新后若同步改过书，旧详情自动失效。
  const DETAIL_CACHE_TTL_MS = 2 * 60 * 1000;
  const detailCache = new Map();

  function isFullDetail(book) {
    return !!(book && book.id != null && Array.isArray(book.files) && Array.isArray(book.identifier_list));
  }

  S.detailCache = {
    get(id, hint = null) {
      const entry = detailCache.get(String(id));
      if (!entry) return null;
      if (Date.now() - entry.savedAt > DETAIL_CACHE_TTL_MS) {
        detailCache.delete(String(id));
        return null;
      }
      const cachedRevision = entry.book && entry.book.revision;
      const hintRevision = hint && hint.revision;
      if (cachedRevision != null && hintRevision != null
          && String(cachedRevision) !== String(hintRevision)) {
        detailCache.delete(String(id));
        return null;
      }
      return entry.book;
    },
    set(book) {
      if (!isFullDetail(book)) return false;
      detailCache.set(String(book.id), { book, savedAt: Date.now() });
      return true;
    },
    // 列表刷新时逐本比对 revision；同步/其它标签页改过的书不必等 TTL。
    revalidate(rows) {
      for (const row of rows || []) {
        const entry = detailCache.get(String(row.id));
        if (!entry) continue;
        const cachedRevision = entry.book && entry.book.revision;
        if (cachedRevision != null && row.revision != null
            && String(cachedRevision) !== String(row.revision)) {
          detailCache.delete(String(row.id));
        }
      }
    },
    invalidate(id) { detailCache.delete(String(id)); },
    clear() { detailCache.clear(); },
  };

  // 编辑、删除、上传文件都会广播 books-changed；外部同步没有前端事件，
  // 因此在窗口重新获得焦点时清空，下次打开详情重新取权威数据。
  document.addEventListener('books-changed', () => S.detailCache.clear());
  window.addEventListener('focus', () => S.detailCache.clear());

  const LAYOUT_KEY = 'shelf.layout';
  S.parseLayout = function () {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
      if (saved && ['compact', 'standard', 'large'].includes(saved.density)) S.state.density = saved.density;
      if (saved && saved.showInfo === true) S.state.showInfo = true;
      if (saved && Array.isArray(saved.columns)) {
        const allowed = ['series', 'rating', 'format', 'publisher', 'pubYear', 'isbn', 'tags', 'readCount'];
        S.state.columns = saved.columns.filter((key) => allowed.includes(key));
      }
    } catch { /* ignore */ }
  };
  S.saveLayout = function () {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        density: S.state.density,
        showInfo: S.state.showInfo,
        columns: S.state.columns,
      }));
    } catch { /* ignore */ }
  };

  const COLLAPSE_KEY = 'shelf.sidebar.collapsed';
  function readCollapsed() {
    try {
      const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch { return new Set(); }
  }
  S.collapsed = readCollapsed();
  S.saveCollapsed = function () {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...S.collapsed])); } catch { /* ignore */ }
  };

  S.parseUrl = function () {
    const p = new URLSearchParams(location.search);
    const s = S.state;
    s.q = p.get('q') || '';
    s.status = ['wish', 'reading', 'done'].includes(p.get('status')) ? p.get('status') : '';
    s.collection = /^\d+$/.test(p.get('collection') || '') ? p.get('collection') : '';
    s.tag = p.get('tag') || '';
    s.author = p.get('author') || '';
    s.series = p.get('series') || '';
    s.vl = p.get('vl') || '';
    const sort = p.get('sort');
    if (sort && SORTS.includes(sort)) {
      s.sort = sort;
      s.sortExplicit = true;
    } else {
      s.sort = s.q ? 'relevance' : 'updated';
      s.sortExplicit = false;
    }
    if (!s.q && s.sort === 'relevance') {
      s.sort = 'updated';
      s.sortExplicit = false;
    }
    s.view = p.get('view') === 'list' ? 'list' : 'grid';
    if (s.q) {
      const input = document.getElementById('searchInput');
      if (input) input.value = s.q;
    }
  };

  S.params = function () {
    const s = S.state;
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.status) p.set('status', s.status);
    if (s.collection) p.set('collection', s.collection);
    if (s.tag) p.set('tag', s.tag);
    if (s.author) p.set('author', s.author);
    if (s.series) p.set('series', s.series);
    if (s.vl) p.set('vl', s.vl);
    if (s.sort && !(s.sort === 'updated' && !s.q)) p.set('sort', s.sort);
    return p;
  };

  S.syncUrl = function () {
    const p = S.params();
    if (S.state.view === 'list') p.set('view', 'list');
    const qs = p.toString();
    history.replaceState(null, '', qs ? '/shelf?' + qs : '/shelf');
  };

  S.resetPage = function () {
    const s = S.state;
    s.books = [];
    s.start = 0;
    s.total = null;
    s.hasMore = true;
    // 清空数据后立刻进入加载态：调用方随后就会发请求，
    // 中间这一帧不能再把“空书架”当成最终状态画出来。
    s.pageStatus = 'loading';
    s.pageError = '';
  };

  S.errorMessage = function (err, fallback = '请求失败') {
    const message = String((err && err.message) || '').trim();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline || /failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
      return '网络连接失败，请检查网络后重试。';
    }
    return message || fallback;
  };

  S.loadPage = async function ({ append = false } = {}) {
    const s = S.state;
    if (append && (s.loading || !s.hasMore)) return null;
    const seq = ++S.ui.pageSeq;
    s.loading = true;
    if (!append) {
      s.pageStatus = 'loading';
      s.pageError = '';
    }
    const p = S.params();
    p.set('size', String(PAGE_SIZE));
    p.set('start', String(s.start));
    try {
      const { data, total } = await apiPage('/api/books?' + p.toString());
      if (seq !== S.ui.pageSeq) return null;
      const rows = Array.isArray(data) ? data : [];
      S.detailCache.revalidate(rows);
      s.books = append ? s.books.concat(rows) : rows;
      s.total = total;
      s.start = s.books.length;
      s.hasMore = total === null ? rows.length === PAGE_SIZE : s.books.length < total;
      if (!append) s.pageStatus = 'ready';
      return { rows, total, append };
    } catch (err) {
      if (seq === S.ui.pageSeq && !append) {
        s.pageStatus = 'error';
        s.pageError = S.errorMessage(err, '书架加载失败');
      }
      throw err;
    } finally {
      if (seq === S.ui.pageSeq) s.loading = false;
    }
  };

  const vlQuery = () => (S.state.vl ? '?vl=' + encodeURIComponent(S.state.vl) : '');

  async function pinActiveFacet(key, seq) {
    const value = String(S.state[key] || '');
    if (!value) { delete S.facetUI.pinned[key]; return; }
    const list = S.state.facets[FACET_LISTS[key]] || [];
    if (list.some((item) => String(item.name) === value)) return;
    const endpoint = FACET_ENDPOINTS[key];
    if (!endpoint) return;
    const params = new URLSearchParams({ q: value, limit: '20' });
    if (S.state.vl) params.set('vl', S.state.vl);
    const page = await apiPage(endpoint + '?' + params).catch(() => null);
    if (seq !== S.ui.facetSeq) return;
    const match = page && Array.isArray(page.data)
      ? page.data.find((item) => String(item.name).toLowerCase() === value.toLowerCase())
      : null;
    S.facetUI.pinned[key] = { name: value, count: match ? match.count : null };
  }

  S.searchFacet = async function (key, q) {
    const endpoint = FACET_ENDPOINTS[key];
    if (!endpoint) return null;
    const text = String(q || '').trim();
    const seq = (S.ui.facetSearchSeq[key] || 0) + 1;
    S.ui.facetSearchSeq[key] = seq;
    if (!text) { S.facetUI.results[key] = null; return null; }
    const params = new URLSearchParams({ q: text, limit: String(FACET_SEARCH_LIMIT) });
    if (S.state.vl) params.set('vl', S.state.vl);
    let page;
    try {
      page = await apiPage(endpoint + '?' + params);
    } catch {
      return null;
    }
    if (seq !== S.ui.facetSearchSeq[key]) return null;
    const items = Array.isArray(page.data) ? page.data : [];
    const result = { q: text, items, total: page.total === null ? items.length : page.total };
    S.facetUI.results[key] = result;
    return result;
  };

  async function refreshFacetSearches() {
    const tasks = [];
    for (const key of ['author', 'tag', 'series']) {
      const q = String(S.facetUI.query[key] || '').trim();
      if (!q) { S.facetUI.results[key] = null; continue; }
      tasks.push(S.searchFacet(key, q));
    }
    if (tasks.length) await Promise.all(tasks);
  }

  S.loadFacets = async function () {
    const seq = ++S.ui.facetSeq;
    const s = S.state;
    s.facetsStatus = s.facetsLoaded ? 'refreshing' : 'loading';
    s.facetsError = '';
    const query = vlQuery();
    const params = new URLSearchParams();
    if (S.state.vl) params.set('vl', S.state.vl);
    params.set('limit', String(FACET_INITIAL));
    const facetQuery = '?' + params.toString();
    const fallback = (value) => api(value).catch(() => null);
    const fallbackPage = (value) => apiPage(value).catch(() => null);
    const results = await Promise.all([
      fallback('/api/stats' + query),
      fallback('/api/collections' + query),
      fallback('/api/virtual-libraries'),
      fallbackPage('/api/series' + facetQuery),
      fallbackPage('/api/authors' + facetQuery),
      fallbackPage('/api/tags' + facetQuery),
    ]);
    if (seq !== S.ui.facetSeq) return;
    const [stats, collections, virtualLibraries, seriesPage, authorsPage, tagsPage] = results;
    // 六个请求全部失败 = 这一块真的坏了；部分失败仍用已有数据渐进渲染，
    // 不把整个侧栏打成错误页（书籍列表本来就已经独立显示了）。
    if (results.every((item) => item == null)) {
      s.facetsStatus = 'error';
      s.facetsError = '分类与统计加载失败';
      return;
    }
    const series = seriesPage && Array.isArray(seriesPage.data) ? seriesPage.data : [];
    const authors = authorsPage && Array.isArray(authorsPage.data) ? authorsPage.data : [];
    const tags = tagsPage && Array.isArray(tagsPage.data) ? tagsPage.data : [];
    s.facets = {
      total: Number(stats && stats.total) || 0,
      byStatus: (stats && stats.byStatus) || { wish: 0, reading: 0, done: 0 },
      collections: Array.isArray(collections) ? collections : [],
      virtualLibraries: Array.isArray(virtualLibraries) ? virtualLibraries : [],
      series,
      authors,
      tags,
      seriesTotal: seriesPage && seriesPage.total !== null ? seriesPage.total : series.length,
      authorTotal: authorsPage && authorsPage.total !== null ? authorsPage.total : authors.length,
      tagTotal: tagsPage && tagsPage.total !== null ? tagsPage.total : tags.length,
    };
    s.facetsLoaded = true;
    s.facetsStatus = 'ready';
    await Promise.all([
      pinActiveFacet('author', seq),
      pinActiveFacet('tag', seq),
      pinActiveFacet('series', seq),
    ]);
    if (seq !== S.ui.facetSeq) return;
    await refreshFacetSearches();
  };

  S.loadDetail = async function (id, { hint = null, force = false } = {}) {
    const s = S.state;
    if (!force) {
      const cached = S.detailCache.get(id, hint);
      if (cached) {
        // 命中缓存也要推进详情序号：早先那本未完成的请求不能再覆盖当前状态。
        ++S.ui.detailSeq;
        s.inspectorBook = cached;
        s.inspectorLoading = false;
        return cached;
      }
    }
    const seq = ++S.ui.detailSeq;
    try {
      const book = await api('/api/books/' + id);
      // 旧请求的响应既不能覆盖状态，也不能写进缓存（用户已切到另一本）。
      if (seq === S.ui.detailSeq) {
        S.detailCache.set(book);
        s.inspectorBook = book;
      }
      return book;
    } finally {
      if (seq === S.ui.detailSeq) s.inspectorLoading = false;
    }
  };

  // 客户端能可靠判断的筛选轴(status/tag/author/series/collection)。
  // q 与虚拟书库可能依赖 FTS/查询语法,由调用方走后端重查。
  S.matchesFilters = function (book) {
    if (!book) return false;
    const s = S.state;
    if (s.status && book.status !== s.status) return false;
    if (s.tag) {
      let tags = [];
      try { tags = JSON.parse(book.tags || '[]'); } catch { tags = []; }
      if (!Array.isArray(tags) || !tags.includes(s.tag)) return false;
    }
    if (s.author && !String(book.author || '').includes(s.author)) return false;
    if (s.series && String(book.series || '').toLowerCase() !== String(s.series).toLowerCase()) return false;
    if (s.collection) {
      const memberships = Array.isArray(book.collections) ? book.collections : [];
      if (!memberships.some((c) => String(c.id) === String(s.collection))) return false;
    }
    return true;
  };

  S.updateBook = function (book) {
    const s = S.state;
    if (!book) return book;
    if (s.inspectorBook && s.inspectorBook.id === book.id) s.inspectorBook = book;
    const row = s.books.find((b) => b.id === book.id);
    if (row) Object.assign(row, book);
    S.detailCache.set(book);
    return book;
  };

  S.patchBook = async function (id, patch) {
    const s = S.state;
    let base = s.inspectorBook && s.inspectorBook.id === id ? s.inspectorBook : s.books.find((b) => b.id === id);
    if (!base || !base.revision || !base.uuid) base = await S.loadDetail(id);
    // 先失效再写：PATCH 失败时下一次打开也必须重新取权威详情。
    S.detailCache.invalidate(id);
    const body = { ...patch, expected_revision: base.revision, expected_uuid: base.uuid };
    const updated = await api('/api/books/' + id, { method: 'PATCH', body: JSON.stringify(body) });
    S.updateBook(updated);
    return updated;
  };

  S.collections = {
    create: (name) => api('/api/collections', { method: 'POST', body: JSON.stringify({ name }) }),
    rename: (id, name) => api('/api/collections/' + id, { method: 'PUT', body: JSON.stringify({ name }) }),
    remove: (id) => api('/api/collections/' + id, { method: 'DELETE' }),
    add: (id, ids) => api('/api/collections/' + id + '/books', { method: 'POST', body: JSON.stringify({ ids }) }),
    removeBooks: (id, ids) => api('/api/collections/' + id + '/books', { method: 'DELETE', body: JSON.stringify({ ids }) }),
  };
})();
