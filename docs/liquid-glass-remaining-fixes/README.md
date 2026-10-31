# My Books · 遗留问题与权限/UI 修正报告

- 日期：2026-11-01
- 分支：`fix/remaining-ui-auth-interactions`
- 基线：`8b0ec0dd3a7d79730bf61e4f0435cba803d83e83`（第三轮视觉修复）
- 范围：`server.js`、`src/http/**`、`public/**`、`test/**`、`docs/**`
- 未改数据库 schema、同步协议或真实书库数据；未部署

## 1. 实际修复问题清单

| 优先级 | 问题 | 修复 |
| --- | --- | --- |
| P0 | 手机搜索关闭 × 在 `pointerdown` 阶段提前关闭搜索，退场后同一次触摸落到“添加书籍” | 指针阶段排除搜索控件；捕获阶段拦截同一次手势的 click；`search-closing` 期间锁住 `#wbAdd`；关闭钮 `preventDefault/stopPropagation` |
| P0 | 管理页面在静态路由阶段无需登录即可访问；`MYBOOKS_PUBLIC_READ` 会放开整个书库读接口 | 管理页登录守卫；公开只读 API 白名单；`/api` 全部要求会话；电子书/心得/同步/导出/设备保持私有；公开详情使用共享 BookDetails 只读模式 |
| P1 | 添加/编辑 Sheet 底部出现独立白色长条；横屏 sticky footer 影响其他弹窗 | footer 透明继承近实体面板材质；移除全局 sticky footer 覆盖；最后输入项可滚到 footer 上方 |
| P1 | 分类搜索必须先点“显示更多”；异步结果可能覆盖新输入；输入时重建输入框 | 搜索框随分组常驻；`expanded` 只控制可见数量；独立 `uiSeq/searching`；异步回调不再依赖 expanded；输入节流期间不重绘 input |
| P1 | 书架导航栏字号过小、字距过大 | 标题 14px、行 14px、计数 12px、筛选 14px；触控行/标题 44px；箭头与操作图标不裁切 |
| P1 | 首页 dotnav 使用 56px 黑色底托、黑色圆点和黑色进度条 | 34px 高（总高 36px）轻磨砂灰白胶囊；中性半透明点；32px 灰色进度轨道；播放钮同材质；保留自动播放/变暗/变距逻辑 |
| P2 | 登录页只有 9 行 CSS，和设备/账号管理页面不一致 | 冷白轻磨砂账号卡片、品牌/状态、登录、设备列表、管理入口、退出；当前设备无撤销；其他设备确认后撤销 |
| 新增 | 手机竖屏资料库头部是独立不透明白色矩形 | 头部移出滚动区，成为 `.wb-side` 的固定 flex 子项；头部透明、关闭钮 44px；滚动时头部保持；仅保留抽屉一层 Frosted 材质 |
| 新增 | 三档密度在部分宽度下都变三列，封面被 `1fr` 拉宽 | 固定目标宽度：紧凑 140px/14px、标准 180px/20px、宽松 210px/24px；Inspector 悬浮时让出右侧空间；密度切换保留选中/滚动/详情 |
| 用户复核 | 账号管理页 logo 出现两次 | 品牌保留站点 logo，当前账号头像改为中性人物图标 |
| 用户复核 | 书架“全部图书 · 31 本”浮在页面上方 | 移入 `.wb-content` 内容流，主标题/次计数；随内容滚动，不覆盖书卡 |
| 用户复核 | 详情标签添加框过长、分类新增输入过小 | 标签输入 76px（触屏 82px）、分类输入 36px 高；修复 `.bd-pop` 按钮选择器挤压输入 |

## 2. 修改文件

**后端 / 权限**

- `server.js`：公开路由、管理页登录守卫、`/api` 会话守卫、私有电子书、公开封面
- `src/http/middleware.auth.js`：移除 `MYBOOKS_PUBLIC_READ` 旁路；`requireLibraryAccess` 兼容为私有
- `src/http/routes.auth.js`：状态返回 `public_pages`，`public_read` 固定 false
- `src/http/routes.feeds.js`：feed 改为公开字段白名单
- `src/http/public-book.js`（新）：公开书籍字段白名单
- `src/http/routes.public.js`（新）：公开首页/榜单/统计/详情/作者标签 API

**前端**

- `public/css/style.css`、`liquid-glass.css`、`shelf-workbench.css`、`login.css`
- `public/js/api.js`：公开请求不因 401 跳登录
- `public/js/common.js`：公开页只读详情、公开统计、跳过管理 bootstrap
- `public/js/book-details.js`：`readOnly` 模式、公开 loader、隐藏私人区块
- `public/js/overlay.js`：搜索关闭指针/捕获保护、公开页隐藏保存搜索
- `public/js/login.js`：`next` 安全回跳、设备列表、当前设备/撤销/退出
- `public/js/chrome.js`：公开页导航名单走公开 API
- `public/js/page-home.js`、`page-rank.js`：公开 API
- `public/js/shelf/main.js`、`sidebar.js`、`store.js`：搜索关闭、密度、facet 状态
- `public/index.html`、`shelf.html`、`rank.html`、`stats.html`、`tags.html`、`notes.html`、`login.html`、`glass-lab.html`：版本同步；登录页结构与 logo
- `public/sw.js`：`CACHE_VERSION = 'v178'`，新增 login 资源

**测试 / 文档**

- 新增 `test/public-access-http.test.js`
- 更新 `test/ui-unification.test.js`、`feeds.test.js`、`sync-v3-http.test.js`、`auth-store.test.js`
- `docs/API.md`：公开只读接口与管理权限说明
- `docs/liquid-glass-remaining-fixes/**`：本报告与前后截图

## 3. 关键实现

### 3.1 搜索关闭穿透

`overlay.js` 的外部指针判定明确排除：

```js
#searchFlyout, #searchBtn, #menuBtn, #wbSearchClose, #shelfSearchBtn, .modal
```

外部 `pointerdown` 关闭搜索后设置一次性 `suppressSearchDismissClick`，捕获阶段的 click 吞掉同一手势，避免命中退场后露出的书卡或添加钮。`search-closing` 450ms 期间 CSS 让 `#wbAdd` 不可命中；退场结束后恢复。`#wbSearchClose` 的 click 处理执行 `preventDefault()`、`stopPropagation()`，并在 pointerdown 仅停止冒泡，不取消 click。

### 3.2 公开展示 / 管理权限分离

- 公开页面：`/`、`/rank`、`/stats`（以及 `.html` 等价地址）。
- 管理页：`/shelf`、`/tags`、`/notes`、`/notes/:id` 及 `.html`；未登录 302 到 `/login?next=原始路径`。
- 公开 API：`/api/public/home/feed`、`/rank/feed`、`/stats`、`/books/:id`、`/authors`、`/tags`；旧 `/api/home/feed` `/api/rank/feed` 保留公开兼容。
- 私有：`/api/books*`、分类写、收藏集、保存搜索、同步、导出、设备、心得、电子书文件与所有写操作。
- 公开详情白名单不含 `uuid`、`revision`、`files`、`notes`、`custom`、`collections`、`identifier_list`。
- 首页详情通过 `BookDetails` 的 `readOnly` 模式渲染：静态阅读状态，无编辑/删除/分类/文件/标签编辑。
- `api.js` 新增 `apiPublic()`：公开请求 401 不跳登录；管理请求仍跳登录。
- 登录成功回到 `next`；已有 cookie 访问 `/login?next=...` 自动返回管理页；`next` 仅接受同源相对路径。
- Android Bearer 会话与 `/api/v1` 同步路径保持；`MYBOOKS_PUBLIC_READ` 不再放开书库 API。

### 3.3 编辑 Sheet 底栏

`#bookModal .form-foot` 改为 `background: transparent`，由近实体 `.modal-box` 统一提供材质；手机端去掉 `var(--surface)`，横屏移除全局 `.modal-box .form-foot` sticky 覆盖。标题固定、`.book-form-body` 独立滚动、footer 固定；实测 932：body 底部 364、footer 顶部 364，滚到底最后输入项完整可见。

### 3.4 分类搜索

`facetSection` 现在：
- 分组体展开时，作者/标签/系列都有 `.wb-facet-filter`；不需要“显示更多”。
- `facetUI.expanded` 只决定显示数量与“显示更多/收起”。
- 输入时只更新 list/note/more，不重建 input，光标不丢。
- 每次查询递增 `facetUI.uiSeq[key]`，异步返回同时校验序号和当前 query；旧结果不会覆盖新输入。
- 分组收起再展开时保留 `query/results`；全局书架搜索 q 不受影响。

### 3.5 侧栏头部与三档密度

- `.wb-side-head` 移出 `.wb-side-scroll`，作为 `.wb-side` 固定 flex 子项；`.wb-side-scroll { flex:1; min-height:0; overflow-y:auto }`。
- 头部背景透明、无独立 backdrop-filter；标题 14px/500，关闭钮 44×44；滚动 280px 后头部 top 仍为 9。
- 密度变量：紧凑 `140/14`、标准 `180/20`、宽松 `210/24`；桌面 `repeat(auto-fill, var(--wb-card-width))`，不再 `1fr` 拉伸。
- 820–1180 且 Inspector 打开时，grid 右 padding 让出 332px + 24px，避免把被覆盖封面算作可见列。
- 手机竖屏保留紧凑三列/标准两列；密度变化后 `ensureFill()` 继续取书，选中、Inspector 与滚动位置保持。
- 书架“全部图书 · N 本”从绝对浮层移入 `.wb-content` 顶部内容流：标签为主标题、数量为次文本；滚动时随内容离开，不再盖在卡片上。
- 详情“+ 标签”输入缩短到 76px（触屏 82px/34px 高）；分类新建输入从 28px 提高到 36px 高、字号 13px；`.bd-pop` 的菜单按钮选择器收窄为直接子按钮，避免“加入”按钮挤占输入宽度。

### 3.6 dotnav / 登录

- dotnav：外层 34px（含边框 36px）；8px 中性点；32px 轨道；灰白轻磨砂；播放/暂停同材质。外层高度和轨道宽度变化均已检查，`dotnav-timed-animation` / `dotnav-timed-dot-expand` 的 32px 关键帧未改，进度不跳位。
- 登录页品牌只使用一处站点 `logo-mark.png`；当前账号头像改为中性人物图标，避免 logo 重复。表单输入为实体白底，设备列表当前设备无撤销，其他设备确认后撤销；进入书库管理与退出入口清晰。

## 4. 新发现的相似问题与处理

- 搜索关闭问题的同源缺陷：`#shelfSearchBtn` 也在搜索浮层外部，原逻辑会在 pointerdown 先关搜索、click 又重开；已纳入同一排除列表并验证。
- `select.js` 的全局 pointerdown 会关闭下拉，但点击目标是外部控件时本来就意图操作该控件；未发现“关闭控件自身后再命中底层”的可复现问题，未改写。
- `chrome.js` 导航、`modal.js` 焦点陷阱、`shelf/main.js` Escape/长按、`inspector.js` 详情关闭已逐项检查；未再发现需要大改的同类 bug。现有 Escape 优先级与焦点恢复保持。
- 发现并修复了密度切换不重新触发 `ensureFill` 的问题；现在切换后立即补充加载新列。
- 发现登录自动化连续失败会触发 10 分钟限速；测试后重启一次性演示服务清除内存限速，生产逻辑未改。

## 5. 前后截图

目录：`docs/liquid-glass-remaining-fixes/`。改动前来自 `8b0ec0d` 的独立 worktree；改动后来自最终源码的一次性演示库。

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 390 资料库头部 | [before/sidebar-390.png](before/sidebar-390.png) | [after/sidebar-390.png](after/sidebar-390.png) |
| 390 资料库滚动后 | — | [after/sidebar-390-scrolled.png](after/sidebar-390-scrolled.png) |
| 768 资料库 | — | [after/sidebar-768.png](after/sidebar-768.png) |
| 登录页 1440 | [before/login-1440.png](before/login-1440.png) | [after/login-1440.png](after/login-1440.png) |
| 登录页 390 | [before/login-390.png](before/login-390.png) | [after/login-390.png](after/login-390.png) |
| 已登录设备页 | — | [after/login-devices-1440.png](after/login-devices-1440.png) / [390](after/login-devices-390.png) |
| dotnav 1440 | [before/dotnav-1440.png](before/dotnav-1440.png) | [after/dotnav-1440.png](after/dotnav-1440.png) |
| dotnav 390 | [before/dotnav-390.png](before/dotnav-390.png) | [after/dotnav-390.png](after/dotnav-390.png) |
| 编辑 Sheet 1440 | [before/add-1440.png](before/add-1440.png) | [after/add-1440.png](after/add-1440.png) |
| 编辑 Sheet 390 | [before/add-390.png](before/add-390.png) | [after/add-390.png](after/add-390.png) |
| 编辑 Sheet 932 | [before/add-932.png](before/add-932.png) | [after/add-932.png](after/add-932.png) |
| 详情标签/分类输入 | [before/detail-tags.png](before/detail-tags.png) | [after/detail-tags.png](after/detail-tags.png) |
| 1280 紧凑/标准/宽松 | [前](before/density-1280-compact.png) / [前](before/density-1280-standard.png) / [前](before/density-1280-large.png) | [后](after/density-1280-compact.png) / [后](after/density-1280-standard.png) / [后](after/density-1280-large.png) |
| 1440 紧凑/标准/宽松 | [前](before/density-1440-compact.png) / [前](before/density-1440-standard.png) / [前](before/density-1440-large.png) | [后](after/density-1440-compact.png) / [后](after/density-1440-standard.png) / [后](after/density-1440-large.png) |
| 1920 紧凑/标准/宽松 | [前](before/density-1920-compact.png) / [前](before/density-1920-standard.png) / [前](before/density-1920-large.png) | [后](after/density-1920-compact.png) / [后](after/density-1920-standard.png) / [后](after/density-1920-large.png) |
| 390 三档 | — | [紧凑](after/density-390-compact.png) / [标准](after/density-390-standard.png) / [宽松](after/density-390-large.png) |
| 1024 Inspector 悬浮 | — | [after/overlay-1024.png](after/overlay-1024.png) |
| 932 横屏 | — | [after/landscape-932.png](after/landscape-932.png) |
| 1920 侧栏开关 | — | [after/shelf-1920-sidebar-toggle.png](after/shelf-1920-sidebar-toggle.png) |
| 公开首页/榜单/统计 | — | [home](after/public-home.png) / [rank](after/public-rank.png) / [stats](after/public-stats.png) |
| 公开只读详情 | — | [after/public-detail.png](after/public-detail.png) |

## 6. 测试结果

### 6.1 Node 自动化

```text
npm test                 569 tests / 569 pass / 0 fail (26.5s)
npm run check:public     pass — 204 text files checked, 98 binary/large skipped
```

新增/更新测试：

- `public-access-http.test.js`：匿名公开页、管理页 302、公开详情字段白名单、私有文件/同步、登录后管理页。
- `ui-unification.test.js`：17 个 UI/引擎断言，覆盖搜索关闭、权限分离、底栏材质、facet 状态、侧栏结构、三档密度、dotnav、登录设备页。
- `feeds.test.js`：公开 feed 不含 UUID/文件/心得/自定义字段/修订。
- `sync-v3-http.test.js`：文件与阅读同步始终 401，不再受 `MYBOOKS_PUBLIC_READ` 影响。

### 6.2 权限测试（真实 HTTP / 浏览器）

| 检查 | 结果 |
| --- | --- |
| 匿名 `/` `/rank` `/stats` | 200，页面未跳转 |
| 匿名 `/shelf` `/tags` `/shelf.html` `/notes/1` `/notes.html` | 302 到 `/login?next=原路径` |
| 匿名 `/api/public/*` | 200 |
| 匿名 `/api/books` `/api/authors` `/api/tags` `/api/stats` `/api/sync/books` `/books-files` | 401 |
| 登录后 `/shelf`、`/api/books`、`/api/stats`、`/api/sync/books`、电子书文件 | 200 |
| 已登录访问 `/login?next=/shelf` | 自动到 `/shelf` |
| 登录表单成功（无 next） | 设备面板显示，无需重复输入密码 |
| 当前设备撤销按钮 | 不存在 |
| 其他设备撤销 | 确认后数量 3→2，当前设备保留 |
| 退出当前设备 | 回到登录表单 |
| 匿名首页详情 | URL 保持 `/`，只读详情无编辑/删除/分类/文件/状态按钮 |

### 6.3 UI / 触控实测

| 检查 | 结果 |
| --- | --- |
| 搜索关闭（390/932） | 指针按下仍打开、tap × 关闭、快速双关、长按关闭、立即重开均正常；关闭手势不会打开 bookModal；450ms 后添加按钮恢复可点 |
| 390 侧栏 | 头部 54px、滚动区外、背景透明、滚动 280px 后 top 仍 9；close 44×44；无横向溢出 |
| 768 侧栏 | 头部 54px、透明；滚动区 flex；无横向溢出 |
| 390 三档 | 紧凑 3 列/114px；标准 2 列/175px；宽松 2 列/175px；无横向溢出 |
| 1280 三档（侧栏+Inspector） | 前：紧凑=标准 3×200；后：紧凑 4×142、标准 3×183、宽松 2×213 |
| 1440 三档 | 前：紧凑=标准 4×184；后：5×142、4×183、3×213 |
| 1920 三档 | 前：7×164、6×194、5×237；后：8×142、6×183、5×213 |
| Inspector 悬浮 | 1024：标准 2 列，最右 653 < Inspector 左 684；932：标准 1 列，最右 454 < 592，无覆盖 |
| 1920 侧栏开关 | 打开 8 列（main 1664）→收起 9 列（main 1896），无溢出 |
| 密度稳定性 | 切换紧凑后滚动 180 保持，选中 1 本、Inspector 保持；列表 17 行正常 |
| facet 搜索 | 未点显示更多即有输入框；东野→加西亚竞态最终正确；输入焦点保持；收起再展开仍为“加西亚”；全局 `q` 为空；density 保存为 compact |
| 编辑 Sheet | 932 body/footer 分界 364/364，滚到底最后输入项完整；390/1440 无横向溢出；footer 与面板连续无白条 |
| dotnav | 外高 36px；items 背景 rgba(255,255,255,.48)，Solid .92；自动播放/暂停切换正常；reduced-motion 初始为暂停、无自动播 |
| 登录/设备 | 表单登录、设备列表、当前设备无撤销、其他撤销确认、退出均通过 |

## 7. 未验证的真实设备/浏览器

- 未在真实 Safari / Firefox / iOS / Android 实机验证；本机 Windows 使用 Chrome 156 headless。
- 强制 `?glass=frost` 与 `?glass=solid` 验证了降级材质；真实 WebKit/Firefox 的滚动、字体与合成器表现未实测。
- 未验证真实移动 GPU、软键盘顶起、iOS 旋转/安全区；软键盘可达性仅通过布局与滚动结构验证。
- 932×430 的 `820px` 宽断点仍按桌面布局：侧栏是列而非抽屉，因此资料库头部在该尺寸隐藏；头部修复在 390/768 抽屉已验证。若要求 932 也使用抽屉，需要另行调整断点。
- 登录设备撤销的 `confirm()` 在 headless 中被 stub；确认文案与状态流已验证，浏览器原生对话框样式不纳入视觉对比。
- 公开页使用一次性演示库；生产环境需在真实部署上再走一次登录/设备/同步 smoke test。

## 8. 已知限制与回滚

**限制**

- `MYBOOKS_PUBLIC_READ` 不再作为整库公开读的旁路；旧的公开部署若依赖它，需要重新登录管理页并使用白名单公开页。
- 仅持有旧 `localStorage` 管理员令牌、没有设备 Cookie 的浏览器会被管理页守卫带到登录页；可在登录页使用“已有管理员令牌”换取 Cookie。
- 公开 API 不缓存（no-store），不引入 CDN 缓存；管理页 HTML no-cache。
- 932 横屏沿用现有宽度断点，侧栏是列而非抽屉（见上）。

**回滚**

无数据库迁移、无真实书库写入。代码回滚：

```bash
git revert <本次提交>
# 或从基线恢复：
git restore server.js public src test docs/API.md
git clean -fd docs/liquid-glass-remaining-fixes src/http/public-book.js src/http/routes.public.js test/public-access-http.test.js
```

回滚后把 `public/sw.js` 的 `CACHE_VERSION` 再递增一次（当前 `v178`），并重启 Node 进程以清除内存中的会话限速状态。不要覆盖真实 `data/` 或 `auth.json`；不要强制推送。

## 9. 版本与提交

- 资源版本：style v118、liquid v5、shelf v41、login.css v5、login.js v3、book-details v3、common v44、api v2、overlay v2、chrome v39、store/sidebar v36/37、main v40、SW `v178`。
- 提交记录：见本分支最新提交（`fix/remaining-ui-auth-interactions`）；未提交到 `main`、未部署。
