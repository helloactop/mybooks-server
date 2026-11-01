/* 书架加载体验回归：首屏侧栏、骨架、列表/分类解耦、详情预览与缓存。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const shelfHtml = read('public/shelf.html');
const shelfCss = read('public/css/shelf-workbench.css');
const main = read('public/js/shelf/main.js');
const store = read('public/js/shelf/store.js');
const inspector = read('public/js/shelf/inspector.js');
const details = read('public/js/book-details.js');

function fullBook(id, revision = 1) {
  return {
    id,
    revision,
    uuid: `uuid-${id}`,
    title: `书 ${id}`,
    author: `作者 ${id}`,
    cover: '',
    files: [],
    identifier_list: [],
  };
}

// 在最小浏览器壳里加载 store.js，直接验证缓存与请求序号行为。
function loadStore({ apiImpl = async () => ({}) } = {}) {
  const documentEvents = [];
  const windowEvents = [];
  let now = Date.now();
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return now; }
  }
  const context = {
    console,
    URLSearchParams,
    Date: FakeDate,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '' },
    document: { addEventListener: (type, fn) => documentEvents.push([type, fn]) },
    setTimeout,
    clearTimeout,
    api: apiImpl,
    apiPage: async () => ({ data: [], total: 0 }),
  };
  vm.createContext(context);
  context.window = context;
  context.window.addEventListener = (type, fn) => windowEvents.push([type, fn]);
  vm.runInContext(store, context);
  return {
    S: context.ShelfUI,
    documentEvents,
    windowEvents,
    advance(ms) { now += ms; },
  };
}

test('首屏侧栏先按关闭态渲染，脚本恢复偏好后才放开过渡', () => {
  assert.match(shelfHtml, /<main class="wb sidebar-collapsed sidebar-booting"/);
  assert.match(shelfCss, /main\.wb\.sidebar-booting \.wb-side/);
  assert.match(main, /setSidebarOpen\(!compactSidebar\(\) && desktopSidebarOpen\(\), \{ persist: false \}\)/);
  assert.match(main, /requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame\(\(\) => \$\('#shelfWorkbench'\)\?\.classList\.remove\('sidebar-booting'\)\);/);
});

test('书籍列表与分类数据解耦，加载/空/错误状态互不冒充', () => {
  assert.doesNotMatch(main, /Promise\.all\(\[S\.loadPage\(\), S\.loadFacets\(\)\]\)/);
  assert.match(main, /loadFacetsInBackground\(\);\s*armSkeleton\(\);\s*try \{\s*const page = await S\.loadPage\(\)/);
  assert.match(main, /pageStatus === 'ready' && s\.books\.length === 0/);
  assert.match(main, /const failed = s\.pageStatus === 'error';/);
  assert.match(store, /s\.pageStatus = 'error';/);
  assert.match(store, /s\.facetsStatus = 'error';/);
  assert.match(shelfHtml, /id="shelfError"/);
  assert.match(shelfHtml, /id="shelfRetry"/);
  assert.match(main, /\$\('#shelfRetry'\)\.addEventListener\('click', retryShelf\)/);
  assert.match(main, /state\(\)\.facetsStatus = state\(\)\.facetsLoaded \? 'refreshing' : 'loading';/);
});

test('首屏骨架只在慢请求时出现，参数/结果一到立即替换', () => {
  assert.match(shelfHtml, /id="shelfSkeleton"/);
  assert.match(main, /const SKELETON_DELAY_MS = 180;/);
  assert.match(main, /state\(\)\.pageStatus !== 'loading' \|\| state\(\)\.books\.length/);
  assert.match(main, /function hideSkeleton\(\)[\s\S]*?classList\.add\('hidden'\)/);
  assert.match(main, /const page = await S\.loadPage\(\);[\s\S]*?hideSkeleton\(\);/);
  assert.doesNotMatch(main, /await new Promise\(\(resolve\) => setTimeout\(resolve, SKELETON/i);
});

test('详情先用列表行做只读预览，完整字段仍等详情 API', () => {
  const previewBlock = details.slice(details.indexOf('function previewHtml'), details.indexOf('function contentHtml'));
  assert.match(previewBlock, /coverHtml\(book\)/);
  assert.match(previewBlock, /book\.title/);
  assert.match(previewBlock, /book\.author/);
  assert.doesNotMatch(previewBlock, /data-bd-(edit|status|delete|collection|copy)/);
  assert.match(inspector, /details\.setPreview\(row, \{ error:/);
  assert.match(inspector, /const cached = S\.detailCache\.get\(id, row\)/);
  assert.match(details, /state\.book = null;\s*state\.previewBook = book;/);
  assert.match(details, /function setPreview/);
  assert.match(inspector, /async function editBook\(book\)[\s\S]*?S\.loadDetail\(book\.id, \{ hint: book \}\)/);
});

test('完整详情缓存只收完整对象，按 revision/焦点/变更事件失效', () => {
  assert.match(store, /const DETAIL_CACHE_TTL_MS = 2 \* 60 \* 1000;/);
  assert.match(store, /function isFullDetail\(book\)[\s\S]*?Array\.isArray\(book\.files\)[\s\S]*?Array\.isArray\(book\.identifier_list\)/);
  assert.match(store, /revalidate\(rows\)[\s\S]*?detailCache\.delete/);
  assert.match(store, /document\.addEventListener\('books-changed', \(\) => S\.detailCache\.clear\(\)\)/);
  assert.match(store, /window\.addEventListener\('focus', \(\) => S\.detailCache\.clear\(\)\)/);
  assert.match(store, /S\.detailCache\.invalidate\(id\);[\s\S]*?expected_revision/);
  assert.match(inspector, /S\.detailCache\.invalidate\(id\);/);
});

test('缓存拒绝列表行、revision 变化与 TTL 过期', () => {
  const { S, advance } = loadStore();
  assert.equal(S.detailCache.set({ id: 1, title: '列表行' }), false);
  assert.equal(S.detailCache.get(1), null);
  assert.equal(S.detailCache.set(fullBook(1, 3)), true);
  assert.equal(S.detailCache.get(1).id, 1);
  assert.equal(S.detailCache.get(1, { id: 1, revision: 3 }).id, 1);
  assert.equal(S.detailCache.get(1, { id: 1, revision: 4 }), null);

  S.detailCache.set(fullBook(2, 1));
  S.detailCache.revalidate([{ id: 2, revision: 2 }]);
  assert.equal(S.detailCache.get(2), null);

  S.detailCache.set(fullBook(3, 1));
  advance(2 * 60 * 1000 + 1);
  assert.equal(S.detailCache.get(3), null);
});

test('updateBook 不会缓存列表行；编辑失败也会先失效旧详情', async () => {
  const { S } = loadStore({ apiImpl: async () => { throw new Error('offline'); } });
  S.updateBook({ id: 1, revision: 1, title: '列表行' });
  assert.equal(S.detailCache.get(1), null);

  S.detailCache.set(fullBook(2, 1));
  S.state.inspectorBook = fullBook(2, 1);
  await assert.rejects(() => S.patchBook(2, { rating: 9 }), /offline/);
  assert.equal(S.detailCache.get(2), null);
});

test('books-changed 与窗口回焦会清空详情缓存', () => {
  const { S, documentEvents, windowEvents } = loadStore();
  S.detailCache.set(fullBook(1, 1));
  documentEvents.find(([type]) => type === 'books-changed')[1]();
  assert.equal(S.detailCache.get(1), null);

  S.detailCache.set(fullBook(1, 1));
  windowEvents.find(([type]) => type === 'focus')[1]();
  assert.equal(S.detailCache.get(1), null);
});

test('A/B 快速切换时，A 的迟到响应不能覆盖 B', async () => {
  const pending = new Map();
  const { S } = loadStore({
    apiImpl: (url) => new Promise((resolve) => {
      pending.set(url.split('/').pop(), resolve);
    }),
  });
  const a = S.loadDetail(1);
  const b = S.loadDetail(2);
  pending.get('2')(fullBook(2, 2));
  await b;
  assert.equal(S.state.inspectorBook.id, 2);
  assert.equal(S.detailCache.get(2).id, 2);

  pending.get('1')(fullBook(1, 1));
  await a;
  assert.equal(S.state.inspectorBook.id, 2);
  assert.equal(S.detailCache.get(1), null, '迟到的 A 不能写进缓存');
});

test('命中的缓存也会推进序号，先发出的 B 不能覆盖后选的 A', async () => {
  const pending = new Map();
  const { S } = loadStore({
    apiImpl: (url) => new Promise((resolve) => {
      pending.set(url.split('/').pop(), resolve);
    }),
  });
  S.detailCache.set(fullBook(1, 1));
  const b = S.loadDetail(2);
  const a = await S.loadDetail(1);
  assert.equal(a.id, 1);
  assert.equal(S.state.inspectorBook.id, 1);

  pending.get('2')(fullBook(2, 2));
  await b;
  assert.equal(S.state.inspectorBook.id, 1);
  assert.equal(S.detailCache.get(2), null);
});
