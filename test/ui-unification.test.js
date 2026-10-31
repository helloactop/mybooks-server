const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['public/index.html', 'public/shelf.html', 'public/rank.html', 'public/stats.html', 'public/tags.html', 'public/notes.html'];
const style = read('public/css/style.css');
const shelfCss = read('public/css/shelf-workbench.css');
const glassCss = read('public/css/liquid-glass.css');

function ruleBody(source, rawSelector) {
  const selector = rawSelector.replace(/\s*\{$/, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{`).exec(source);
  if (!match) return '';
  const start = match.index + match[0].length - 1;
  const close = source.indexOf('}', start);
  return close > start ? source.slice(start + 1, close) : '';
}

test('全站使用冷白 token，不再有暖米白/登录彩虹场景', () => {
  assert.match(style, /--canvas:\s*#f5f5f7/i);
  assert.match(style, /--surface:\s*#ffffff/i);
  assert.match(style, /--surface-2:\s*#f2f2f5/i);
  assert.match(shelfCss, /--wb-canvas:\s*var\(--canvas/);
  assert.doesNotMatch(style + shelfCss + glassCss, /#f6f5f2|#f7f6f3|247, 246, 243|247 246 243/i);
  assert.doesNotMatch(glassCss, /rgba\(10, 132, 255|rgba\(255, 159, 10|rgba\(191, 90, 242|rgba\(48, 209, 88|#f8f5ef|#f7f9fd/i);
  assert.doesNotMatch(glassCss, /body\.login-page::(before|after)/);
});

test('玻璃参数克制且仍保留真实折射引擎', () => {
  assert.match(glassCss, /--liquid-refraction:\s*12/);
  assert.match(glassCss, /--liquid-chroma:\s*0\.06/);
  assert.match(glassCss, /--liquid-saturation:\s*140%/);
  assert.match(glassCss, /--liquid-opacity:\s*0\.76/);
  assert.match(glassCss, /backdrop-filter:\s*var\(--lg-filter/);
  const engine = read('public/js/liquid-glass.js');
  assert.match(engine, /feDisplacementMap/);
  assert.match(engine, /resolveTier/);
});

test('第三轮材质：选中态中性、蓝色只留给键盘焦点，主按钮不再发光', () => {
  assert.match(style, /--selected-edge:\s*rgba\(0, 0, 0, 0\.1\)/);
  assert.match(style, /--control-shadow:\s*0 1px 2px rgba\(0, 0, 0, 0\.03\)/);
  const segActive = ruleBody(style, '.seg button.active');
  assert.match(segActive, /var\(--selected-bg\)/);
  assert.doesNotMatch(segActive, /0, 102, 204|inset 0 -2px/i);
  const primary = ruleBody(style, '.btn-primary {');
  assert.doesNotMatch(primary, /linear-gradient|0 4px 14px|0 6px 18px/i);
  assert.match(style, /:is\(\.seg button, \.btn, \.icon-btn, \.sel-trigger\):focus-visible/);
  assert.match(style, /\.sel-trigger:active/);
  assert.match(shelfCss, /\.wb-circle:active \{[^}]*control-bg-pressed/);
  assert.match(shelfCss, /main\.wb\.inspector-open \.wb-chrome #wbInspectorToggle/);
});

test('第三轮层级：大面板近实体、遮罩不再二次模糊、内部菜单不折射', () => {
  assert.match(glassCss, /:is\(\.wb-side, \.wb-inspector, \.modal-box\)/);
  assert.match(glassCss, /background-color: rgb\(255 255 255 \/ 0\.985\)/);
  assert.match(glassCss, /background-color: rgb\(247 248 250 \/ 0\.96\)/);
  assert.match(glassCss, /html\[data-glass-tier="full"\] \.modal,[\s\S]*?background: rgba\(20, 20, 24, 0\.38\);[\s\S]*?backdrop-filter: none;/);
  assert.doesNotMatch(ruleBody(glassCss, '.lg-surface {'), /inset 0 -1px 0/);
  const details = read('public/js/book-details.js');
  assert.doesNotMatch(details, /class="bd-pop" data-glass="refract"/);
});

test('书架：内容流标题、固定封面宽度与三栏明度层级', () => {
  const grid = ruleBody(shelfCss, '.wb-grid {');
  assert.match(grid, /repeat\(auto-fill, var\(--wb-card-width\)\)/);
  assert.match(grid, /gap: var\(--wb-grid-gap\)/);
  assert.match(grid, /padding: 0 clamp\(20px, 2vw, 36px\) 112px/);
  assert.doesNotMatch(grid, /minmax\(var\(--wb-card-min\), 1fr\)/);
  assert.doesNotMatch(grid, /justify-content: center/);
  const shelfHtml = read('public/shelf.html');
  assert.ok(shelfHtml.indexOf('id="wbScope"') > shelfHtml.indexOf('id="wbContent"'));
  const scope = ruleBody(shelfCss, '.wb-scope {');
  assert.match(scope, /padding: 68px/);
  assert.doesNotMatch(scope, /position: absolute/);
  assert.match(shelfCss, /\.wb-side \{ --wb-panel: #f7f8fa; background: #f7f8fa; \}/);
  assert.match(shelfCss, /\.wb-inspector \{ --wb-panel: #ffffff; background: #ffffff; \}/);
  assert.doesNotMatch(ruleBody(shelfCss, '.wb-card-cover {'), /backdrop-filter/);
});

test('三档密度使用固定封面宽度与独立间距，Inspector 悬浮时让出右列', () => {
  assert.match(shelfCss, /--wb-card-width: 180px;[\s\S]*?--wb-grid-gap: 20px;/);
  assert.match(shelfCss, /\[data-density="compact"\][\s\S]*?--wb-card-width: 140px;[\s\S]*?--wb-grid-gap: 14px;/);
  assert.match(shelfCss, /\[data-density="large"\][\s\S]*?--wb-card-width: 210px;[\s\S]*?--wb-grid-gap: 24px;/);
  assert.match(shelfCss, /main\.wb\.inspector-open \.wb-grid \{[\s\S]*?padding-right: calc\(332px \+ 24px\)/);
  assert.match(read('public/js/shelf/main.js'), /applyLayoutPreferences\(\);\s*\/\/ 密度变化[\s\S]*?ensureFill\(\)/);
  assert.match(read('public/js/shelf/store.js'), /'compact', 'standard', 'large'/);
});

test('侧栏头部在滚动区外，资料库只保留一层 Frosted 材质', () => {
  const sidebar = read('public/js/shelf/sidebar.js');
  assert.ok(sidebar.indexOf('<div class="wb-side-head">') < sidebar.indexOf('<div class="wb-side-scroll">'));
  assert.match(ruleBody(shelfCss, '.wb-side-scroll {'), /flex: 1;/);
  assert.match(ruleBody(shelfCss, '.wb-side-scroll {'), /min-height: 0;/);
  const mobileHead = /@media \(max-width: 819px\)[\s\S]*?\.wb-side-head \{([\s\S]*?)\n  \}/.exec(shelfCss);
  assert.ok(mobileHead, '缺少移动端侧栏头部规则');
  assert.doesNotMatch(mobileHead[1], /background:\s*(var\(--wb-panel\)|#|rgb)/);
  assert.doesNotMatch(glassCss, /\.wb-side-head[\s\S]{0,200}backdrop-filter/);
  assert.match(shelfCss, /\.wb-side-head \{[\s\S]*?font-size: 14px;/);
  assert.match(shelfCss, /\.wb-side-close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
});

test('分类搜索常驻，显示更多只管数量，旧异步结果不覆盖新输入', () => {
  const sidebar = read('public/js/shelf/sidebar.js');
  assert.match(sidebar, /const input = server[\s\S]*?wb-facet-filter/);
  assert.match(sidebar, /const expanded = !!facetUI\.expanded\[key\]/);
  assert.match(sidebar, /facetUI\.uiSeq\[key\]/);
  assert.match(sidebar, /facetUI\.searching\[key\]/);
  assert.doesNotMatch(sidebar, /!facetUI\.expanded\[key\] \|\| facetUI\.query/);
  assert.match(sidebar, /data-facet-more="\$\{key\}">显示更多/);
  assert.match(read('public/js/shelf/store.js'), /uiSeq: \{\}, searching: \{\}/);
});

test('搜索关闭在指针阶段排除搜索控件并锁住退场期间的添加按钮', () => {
  const overlay = read('public/js/overlay.js');
  assert.match(overlay, /#searchFlyout, #searchBtn, #menuBtn, #wbSearchClose, #shelfSearchBtn, \.modal/);
  assert.match(overlay, /suppressSearchDismissClick/);
  assert.match(shelfCss, /body\.search-closing #wbAdd \{ pointer-events: none; \}/);
  assert.match(read('public/js/shelf/main.js'), /searchCloseBtn\.addEventListener\('pointerdown', \(e\) => e\.stopPropagation\(\)\)/);
  assert.match(read('public/js/shelf/main.js'), /searchCloseBtn\.addEventListener\('click', \(e\) => \{[\s\S]*?preventDefault\(\);[\s\S]*?stopPropagation\(\);/);
});

test('编辑 Sheet 底栏继承面板材质，横屏不再全局 sticky 其他弹窗', () => {
  const foot = ruleBody(style, '#bookModal .form-foot {');
  assert.match(foot, /background: transparent;/);
  assert.doesNotMatch(shelfCss, /body\[data-page="shelf"\] \.modal-box \.form-foot/);
  assert.doesNotMatch(style, /#bookModal \.form-foot \{[\s\S]*?background: var\(--surface\)/);
});

test('公开阅读与管理 API 分离，公开详情使用只读 BookDetails', () => {
  const server = read('server.js');
  assert.match(server, /app\.use\(routesPublic\)/);
  assert.match(server, /MANAGEMENT_PAGES/);
  assert.match(server, /app\.use\('\/api', requireSession\)/);
  assert.match(read('src/http/routes.public.js'), /publicBook/);
  const common = read('public/js/common.js');
  assert.match(common, /PUBLIC_PAGES/);
  assert.match(common, /readOnly = true/);
  assert.match(common, /apiPublic\('\/api\/public\/books\//);
  assert.match(read('public/js/book-details.js'), /defaultPublicLoadBook/);
  assert.match(read('public/js/api.js'), /publicAccess/);
  assert.match(read('public/js/login.js'), /nextDestination/);
});

test('轮播分页器改为 32–36px 轻磨砂材质且保留进度轨道', () => {
  assert.match(style, /--sk-dotnav-scrim-height: 34px/);
  assert.match(style, /--sk-dotnav-background: rgba\(29, 29, 31, 0\.32\)/);
  assert.match(style, /--sk-dotnav-timed-track-background-color: rgba\(29, 29, 31, 0\.12\)/);
  assert.match(ruleBody(style, '.dotnav-items {'), /background-color: rgba\(255, 255, 255, 0\.5\)/);
  assert.match(style, /@keyframes dotnav-timed-animation \{[\s\S]*?100% \{ width: calc\(100% - var\(--sk-dotnav-margin-inline\) \* 2\); \}/);
  assert.match(glassCss, /media-gallery-dotnav \.dotnav-items[\s\S]*?rgba\(255, 255, 255, 0\.48\)/);
});

test('登录/设备页保留 ID、当前设备不显示撤销、其他设备确认后撤销', () => {
  const html = read('public/login.html');
  ['accountStatus', 'loginForm', 'accountPanel', 'deviceList', 'tokenLogin', 'logout'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  const login = read('public/js/login.js');
  assert.match(login, /isCurrent[\s\S]*?device-current[\s\S]*?return li;/);
  assert.match(login, /confirm\(`撤销设备/);
  assert.match(login, /nextDestination/);
  assert.match(read('public/css/login.css'), /font-size: 32px/);
  assert.match(read('public/css/login.css'), /min-height: 44px/);
  assert.equal((html.match(/logo-mark\.png/g) || []).length, 1, '账号页只保留一处站点 logo');
  assert.match(html, /class="account-avatar"[\s\S]*?<svg/);
});

test('第三轮详情：简介折叠、操作分层、手机表单纵向排列', () => {
  const details = read('public/js/book-details.js');
  ['data-bd-summary-toggle', "bd-summary${collapsed ? ' is-collapsed'", 'bd-actions-main', 'bd-delete'].forEach((needle) => {
    assert.ok(details.includes(needle), `book-details.js 缺少 ${needle}`);
  });
  assert.match(style, /\.bd-summary\.is-collapsed/);
  assert.match(style, /\.bd-delete/);
  assert.match(style, /#wbInspector \.bd-head \{[\s\S]*?position: sticky;/);
  assert.match(style, /#bookModal \.form-grid \{ grid-template-columns: 1fr; gap: 13px; \}/);
  assert.match(style, /#bookModal \.isbn-input-row \{[\s\S]*?grid-template-columns: 1fr 1fr;/);
  assert.match(style, /#bookModal \.isbn-input-row input\[type="text"\] \{ grid-column: 1 \/ -1;/);
  assert.match(ruleBody(style, '.bd-chip-input {'), /width: 76px/);
  assert.match(ruleBody(style, '.bd-inline-input {'), /height: 36px/);
  assert.match(ruleBody(shelfCss, '.wb-inline-input {'), /height: 34px/);
  assert.match(style, /\.bd-pop > button \{/);
  assert.doesNotMatch(style, /\.bd-pop button \{/);
});

test('按钮/分段控件共享 control token，不再用黑/蓝实底表示选中', () => {
  assert.match(style, /--control-bg:/);
  assert.match(style, /--selected-bg:/);
  assert.match(ruleBody(style, '.btn {'), /var\(--control-bg\)/);
  assert.match(ruleBody(style, '.icon-btn {'), /var\(--control-bg\)/);
  assert.match(ruleBody(style, '.sel-trigger {'), /var\(--control-bg\)/);
  const segActive = ruleBody(style, '.seg button.active');
  assert.match(segActive, /var\(--selected-bg\)/);
  assert.doesNotMatch(segActive, /background:\s*(var\(--accent\)|#0066cc|#1d1d1f|var\(--wb-ink\))/i);
  const primary = ruleBody(style, '.btn-primary {');
  assert.match(primary, /var\(--accent\)/);
  assert.doesNotMatch(primary, /background:\s*(#0066cc|#0077ed|#1d1d1f|var\(--night\))/i);
  assert.doesNotMatch(shelfCss, /\.wb-inspector-status/);
  assert.doesNotMatch(ruleBody(shelfCss, '.wb-layout-seg button.active'), /var\(--wb-ink\)|#1d1d1f|#fff/);
  assert.doesNotMatch(ruleBody(shelfCss, '.wb-view button.active'), /var\(--wb-ink\)|#1d1d1f|#fff/);
  assert.match(ruleBody(shelfCss, '.wb-action'), /var\(--control/);
});

test('详情只剩一套：BookDetails 供 Inspector 与其他页面共用，旧 detailModal 已移除', () => {
  assert.match(read('public/js/common.js'), /window\.BookDetails\.create/);
  assert.match(read('public/js/shelf/inspector.js'), /BookDetails\.create/);
  assert.doesNotMatch(read('public/js/chrome.js'), /id="detailModal"|detailBody|detail-box/);
  assert.match(read('public/js/chrome.js'), /id="bookDetailModal"/);
  assert.match(read('public/js/chrome.js'), /id="bookDetailHost"/);
  assert.doesNotMatch(read('public/js/common.js'), /detailBody|detail-body|seriesHtml|identifiersHtml/);
  const main = read('public/js/shelf/main.js');
  assert.doesNotMatch(main, /openDetail\(Number\(target\.dataset\.id\)\)/);
  assert.match(main, /S\.inspector\.editBook/);
  const details = read('public/js/book-details.js');
  ['data-bd-status', 'data-bd-rating', 'data-bd-collection-add', 'data-bd-edit', 'data-bd-delete', 'data-bd-grabber'].forEach((needle) => {
    assert.ok(details.includes(needle), `book-details.js 缺少 ${needle}`);
  });
  assert.match(details, /onClose/);
  assert.match(details, /onChanged/);
  pages.forEach((page) => {
    assert.match(read(page), /\/js\/book-details\.js\?v=3/, `${page} 缺少统一详情组件`);
  });
});

test('双击/选择/键盘路径与资源版本保持接线', () => {
  const shelf = read('public/shelf.html');
  assert.ok(shelf.indexOf('/js/book-details.js') < shelf.indexOf('/js/shelf/inspector.js'));
  const versions = {
    'css/style.css': '118',
    'css/liquid-glass.css': '5',
    'css/shelf-workbench.css': '41',
    'js/chrome.js': '39',
    'js/api.js': '2',
    'js/overlay.js': '2',
    'js/page-home.js': '4',
    'js/page-rank.js': '3',
    'js/common.js': '44',
    'js/modal.js': '2',
    'js/select.js': '3',
    'js/shelf/main.js': '40',
    'js/shelf/store.js': '36',
    'js/shelf/sidebar.js': '37',
    'js/shelf/inspector.js': '37',
    'js/book-details.js': '3',
  };
  pages.forEach((page) => {
    const html = read(page);
    Object.entries(versions).forEach(([asset, version]) => {
      const re = new RegExp(`/${asset.replace(/[/.]/g, '\\$&')}\\?v=([0-9]+)`);
      const match = html.match(re);
      if (match) assert.equal(match[1], version, `${page} ${asset} 版本不一致`);
    });
  });
  const sw = read('public/sw.js');
  assert.match(sw, /CACHE_VERSION = 'v178'/);
  Object.entries(versions).forEach(([asset, version]) => {
    assert.match(sw, new RegExp(`'/${asset.replace(/[/.]/g, '\\$&')}\\?v=${version}'`), `sw.js 缺少 ${asset}@${version}`);
  });
  assert.match(sw, /'\/js\/book-details\.js\?v=3'/);
});
