/* 资料库侧栏：局部展开/收起与整栏重绘都必须保住滚动位置和焦点。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const sidebarSource = fs.readFileSync(path.join(rootDir, 'public/js/shelf/sidebar.js'), 'utf8');
const shelfCss = fs.readFileSync(path.join(rootDir, 'public/css/shelf-workbench.css'), 'utf8');

function camel(name) {
  return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

class FakeElement {
  constructor({ tag = 'DIV', attrs = {}, value = '' } = {}) {
    this.tagName = tag;
    this.attrs = { ...attrs };
    this.value = value;
    this.parent = null;
    this.children = [];
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.selectionStart = null;
    this.selectionEnd = null;
    this.selectionDirection = 'none';
    this.focused = false;
    this.focusOptions = null;
    this.dataset = {};
    for (const [key, value] of Object.entries(this.attrs)) {
      if (key.startsWith('data-')) this.dataset[camel(key.slice(5))] = value;
    }
  }

  get id() { return this.attrs.id || ''; }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
    if (name.startsWith('data-')) delete this.dataset[camel(name.slice(5))];
  }

  append(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  matches(selector) {
    if (selector === 'input, textarea') return this.tagName === 'INPUT' || this.tagName === 'TEXTAREA';
    if (selector === 'button') return this.tagName === 'BUTTON';
    const attr = /^\[([\w-]+)\]$/.exec(selector);
    return attr ? this.getAttribute(attr[1]) !== null : false;
  }

  closest(selector) {
    let node = this.parent;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  focus(options) {
    this.focused = true;
    this.focusOptions = options || null;
    this.ownerDocument.activeElement = this;
  }

  setSelectionRange(start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }

  addEventListener() {}
}

function selectorMatches(el, selector) {
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (selector === '.wb-side-scroll') return el.getAttribute('class') === 'wb-side-scroll';
  const attrs = [...selector.matchAll(/\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]/g)];
  if (!attrs.length) return false;
  return attrs.every(([, name, raw]) => {
    if (raw === undefined) return el.getAttribute(name) !== null;
    const value = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return el.getAttribute(name) === value;
  });
}

class FakeRoot extends FakeElement {
  descendants() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.descendants().find((el) => selectorMatches(el, selector)) || null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter((el) => selectorMatches(el, selector));
  }

  contains(el) {
    let node = el;
    while (node) {
      if (node === this) return true;
      node = node.parent;
    }
    return false;
  }
}

function buildSidebar({ outerScroll = 640, outerMax = 1600, listScroll = 120, listMax = 230, active = 'input', expanded = false } = {}) {
  const root = new FakeRoot({ attrs: { id: 'wbSidebar' } });
  const scroller = root.append(new FakeElement({ attrs: { class: 'wb-side-scroll' } }));
  scroller.clientHeight = 800;
  scroller.scrollHeight = outerMax + 800;
  scroller.scrollTop = outerScroll;

  const section = scroller.append(new FakeElement({ attrs: { 'data-facet-section': 'author' } }));
  const input = section.append(new FakeElement({
    tag: 'INPUT',
    attrs: { class: 'wb-facet-filter', 'data-facet': 'author' },
    value: '托',
  }));
  input.ownerDocument = { activeElement: null };
  input.selectionStart = 1;
  input.selectionEnd = 1;
  const list = section.append(new FakeElement({ attrs: { 'data-facet-list': 'author' } }));
  list.clientHeight = 270;
  list.scrollHeight = listMax + 270;
  list.scrollTop = listScroll;
  const button = section.append(new FakeElement({
    tag: 'BUTTON',
    attrs: { [expanded ? 'data-facet-close' : 'data-facet-more']: 'author' },
  }));
  root.append(new FakeElement({ attrs: { 'data-axis': 'all', 'data-value': '' } }));

  const document = { activeElement: null };
  for (const el of [input, button]) el.ownerDocument = document;
  if (active === 'input') document.activeElement = input;
  if (active === 'more') document.activeElement = button;
  return { root, scroller, list, input, button, document };
}

function loadSidebar(dom) {
  const facetUI = { expanded: {}, query: {}, results: {}, pinned: {}, uiSeq: {}, searching: {} };
  const shelfUI = {
    state: {
      facets: { total: 0, byStatus: {}, collections: [], virtualLibraries: [], series: [], authors: [], tags: [] },
      facetsLoaded: true,
      facetsStatus: 'ready',
      q: '', status: '', collection: '', tag: '', author: '', series: '', vl: '',
    },
    facetUI,
    collapsed: new Set(),
    saveCollapsed() {},
    hooks: {},
  };
  const context = {
    console,
    URLSearchParams,
    Date,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {} },
    document: dom.document,
    confirm: () => false,
    toast: () => {},
    esc: (value) => String(value),
    $: () => dom.root,
    $$: () => [],
    ShelfUI: shelfUI,
  };
  vm.createContext(context);
  context.window = context;
  vm.runInContext(sidebarSource, context);
  return { S: shelfUI, facetUI };
}

test('整栏重绘前保存、重绘后同步恢复外层与分组滚动', () => {
  const first = buildSidebar();
  const { S } = loadSidebar(first);
  const view = S.sidebar.captureViewState(first.root);
  assert.equal(view.scrollTop, 640);
  assert.equal(view.facetScrolls.author, 120);
  assert.equal(view.focus.selector, '[data-facet="author"]');

  // 模拟 root.innerHTML 重建：所有新元素 scrollTop 归零，旧焦点消失。
  const second = buildSidebar({ outerScroll: 0, listScroll: 0, active: null });
  const { S: S2 } = loadSidebar(second);
  S2.sidebar.restoreViewState(view, second.root);

  assert.equal(second.scroller.scrollTop, 640, '外层侧栏不能回到顶部');
  assert.equal(second.list.scrollTop, 120, '作者分组内部滚动不能丢');
  assert.equal(second.document.activeElement, second.input, '搜索框焦点应恢复');
  assert.equal(second.input.focusOptions.preventScroll, true, '恢复焦点不能触发滚动');
  assert.equal(second.input.selectionStart, 1);
  assert.equal(second.input.selectionEnd, 1);
});

test('内容变短时恢复值会夹到新的最大滚动范围', () => {
  const first = buildSidebar();
  const { S } = loadSidebar(first);
  const view = S.sidebar.captureViewState(first.root);

  const shorter = buildSidebar({
    outerScroll: 0, outerMax: 300, listScroll: 0, listMax: 40, active: null,
  });
  const { S: S2 } = loadSidebar(shorter);
  S2.sidebar.restoreViewState(view, shorter.root);

  assert.equal(shorter.scroller.scrollTop, 300);
  assert.equal(shorter.list.scrollTop, 40);
});

test('展开后按钮从“显示更多”变成“收起”时焦点仍然落回同一分组', () => {
  const first = buildSidebar({ active: 'more', expanded: false });
  const { S } = loadSidebar(first);
  const view = S.sidebar.captureViewState(first.root);
  assert.equal(view.focus.selector, '[data-facet-more="author"]');

  const expanded = buildSidebar({ active: null, expanded: true });
  const { S: S2 } = loadSidebar(expanded);
  S2.sidebar.restoreViewState(view, expanded.root);

  assert.equal(expanded.document.activeElement, expanded.button);
  assert.equal(expanded.button.focusOptions.preventScroll, true);
});

test('显示更多/收起走局部更新，整栏 render 只用于需要的地方', () => {
  assert.match(sidebarSource, /function render\(\) \{[\s\S]*?const view = captureSidebarViewState\(root\);[\s\S]*?root\.innerHTML =[\s\S]*?restoreSidebarViewState\(view, root\);/);
  assert.match(sidebarSource, /function updateFacetRows\(key[\s\S]*?const previousScroll = list\.scrollTop;[\s\S]*?list\.innerHTML =[\s\S]*?clampScrollTop\(previousScroll/);
  assert.match(sidebarSource, /const more = e\.target\.closest\('\[data-facet-more\]'\);[\s\S]*?facetUI\.expanded\[more\.dataset\.facetMore\] = true;[\s\S]*?updateFacetRows\(more\.dataset\.facetMore\);/);
  assert.doesNotMatch(sidebarSource, /facetUI\.expanded\[more\.dataset\.facetMore\] = true;\s*render\(\)/);
  assert.match(sidebarSource, /FACET_SECTION_KEYS\.has\(id\)[\s\S]*?renderFacetSection\(id\)/);
  assert.match(sidebarSource, /renderSection\('collections'\)/);
  assert.match(sidebarSource, /captureViewState: captureSidebarViewState/);
  assert.match(sidebarSource, /restoreViewState: restoreSidebarViewState/);
});

test('展开列表有更高的内部滚动上限，但不会无限推远其他分组', () => {
  assert.match(shelfCss, /\.wb-facet-list\[data-expanded="true"\] \{ max-height: min\(48vh, 420px\); \}/);
  assert.match(shelfCss, /@media \(max-width: 819px\) \{\s*\.wb-facet-list\[data-expanded="true"\] \{ max-height: min\(42dvh, 360px\); \}/);
  assert.match(shelfCss, /\.wb-side-scroll,\s*\.wb-facet-list \{ scroll-behavior: auto; \}/);
});
