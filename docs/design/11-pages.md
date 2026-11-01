# 11 · 页面设计契约

## 0. 全局外壳

`chrome.js` 在所有主页面注入：

- `header.topbar`：品牌、主导航、搜索/添加、汉堡；
- 桌面导航下拉、移动全屏菜单/二级面板；
- 全局搜索浮层、弹窗、Toast、页脚；
- 书籍详情抽屉 `#bookDetailModal`。

主导航顺序是**账号 → 首页 → 书架 → 榜单 → 统计 → 分类**（`chrome.js:33-40`）。这个顺序是现有实现，不得在“整理导航”时重排。

公共页脚包含站点标语、ICP 备案、公安备案（`chrome.js:604-612`）。`/shelf` 隐藏顶栏和页脚；`/login` 与 `/glass-lab.html` 不注入 chrome。

`body[data-page]` 决定导航高亮与公共数据接口：

```text
home / rank / stats = 公开页
shelf / tags = 管理页
notes = 独立心得页
glass-lab = 开发页
login = 独立账号页（无 data-page）
```

`PUBLIC_PAGES = new Set(['home','rank','stats'])`（`common.js:144`）。`/notes` 是**需要登录**的独立心得页（`server.js:62-67` 将 `/notes` 与 `/notes/` 列为管理页），不属于公开页；其阅读/编辑逻辑按页面单独处理。

## 1. 首页 `/`

| 项 | 契约 |
|---|---|
| `body` | `data-page="home"` |
| 主容器 | `main.page-home`，全出血，`max-width:none`，`padding:0 0 80px` |
| 内容 | `#homeContent` 由 `page-home.js` 渲染 |
| 顺序 | Hero → 最新上架黑横幅 → 两列产品卡 → “未完待续”画廊 |
| 数据 | `/api/public/home/feed?grid=4&ent=16` |
| 内容上限 | `ENT_LIMIT=16`、`ENT_PRIMARY_MAX=10`、`GRID_MAX=4`、`ENT_FAM_MIN=3`、`ENT_BIG_RATIO=0.6`（`page-home.js:153-157`） |
| 截断 | 书名/作者/简介 44/60/80/92 字符（`page-home.js:175-176,222,269,290`） |
| 画廊 | 两排（大卡 + 小卡）；5000ms 切换、1000ms 滑动；dot 上限 7（≤480px 为 5） |
| 主题色 | `#f5f5f7`（正确） |
| 响应式 | 画廊 734 / 1068 / 1441；≤819 产品卡单列 |
| 状态 | 没有骨架、空状态或错误页；Hero 始终渲染；数据为空时只显示可用的区块 |
| 设计例外 | Apple 式大标题、黑横幅、画廊几何、dotnav 节奏；不要统一成普通卡片列表 |

**保护：** 首页 hero 的 `clamp(44px,6vw,80px)`、产品卡 18px 圆角、黑横幅全宽、画廊 `1000ms/5000ms`、dotnav 8px 几何与暂停语义都不能改。

证据：`index.html`；`page-home.js`；`endless-gallery.js:13-21`；`style.css:3474-4487`。

## 2. 书架 `/shelf`

| 项 | 契约 |
|---|---|
| `body` | `data-page="shelf"` |
| 主容器 | `main#shelfWorkbench.wb`，`sidebar-collapsed sidebar-booting` 首帧，`data-density`，`data-cover-info` |
| 外壳 | 隐藏全局顶栏/页脚；左上 `.wb-brand` + `.wb-brand-menu`；底部 `.wb-chrome` |
| 布局 | 桌面三栏 232 / 1fr / 332；8px 外边距；24px 面板圆角 |
| 密度 | `compact` 140/14、`standard` 180/20、`large` 210/24 |
| 视图 | 封面网格 / 列表；列表有桌面表格和手机列表 |
| 左栏 | 全部、状态、藏书集、虚拟书库、系列、作者、标签；服务端 facet |
| 右栏 | Inspector（单本详情/多选面板） |
| 数据 | `PAGE_SIZE=60`；facet 初始 80、搜索 100、作者 5/系列 8/标签 8；搜索 debounce 250ms |
| 搜索 | 底部居中胶囊；打开全站搜索浮层；`⌘K`/`Ctrl+K`；关闭 X 在右上 |
| 选择 | 长按（非鼠标）/ Ctrl/⌘ 点击；框选（鼠标桌面）；批量条 |
| 状态 | 骨架延迟 180ms；空书架 vs 筛选无结果；错误 + 重试；详情预览骨架/错误 |
| 主题色 | 当前 `#f6f5f2`，规范值 `#f5f5f7`（债务） |
| 响应式 | 1180（Inspector 浮层）；819/820（抽屉）；560（手机密度）；370（隐藏排序）；932 横屏抽屉 |
| 设计例外 | 沉浸式、Finder 侧栏、纯封面、固定封面宽、三档密度、底部搜索胶囊、无顶栏 |

### 2.1 首屏与状态

- 首帧按 `sidebar-collapsed sidebar-booting` 渲染，脚本恢复桌面展开态时不推动网格（`shelf.html:14-30`；`shelf-workbench.css:64-69`）；
- 骨架 180ms 后才出现，且仅在 loading 且无数据时（`main.js:118-139`）；
- 空状态只在 `ready && books.length===0` 时出现；筛选无结果使用不同文案（`main.js:104-116`）；
- 错误状态隐藏网格，显示 `role=alert` + 重试（`main.js:141-155`；`shelf.html:145-150`）。

### 2.2 保护行为

- 滚动位置：`sessionStorage['shelf.scroll']`，URL 必须匹配，同步 + rAF + 80ms（`main.js:19-40`）；
- 侧栏展开：`localStorage['shelf.sidebar']`，只在桌面持久化（`main.js:68-87`）；
- 分组折叠：`localStorage['shelf.sidebar.collapsed']`（`store.js:136-146`）；
- 搜索焦点/滚动/选中范围：侧栏重渲染前捕获、渲染后恢复（`sidebar.js:93-162`）；
- 编辑草稿：详情重渲染前捕获内联草稿，渲染后恢复焦点与光标（`book-details.js:345-368`）；
- 异步顺序：`pageSeq`、`facetSeq`、`detailSeq`、`facetSearchSeq`、`viewSeq`、`uiSeq` 等序列号保护（`store.js`、`sidebar.js`、`inspector.js`、`main.js`）。

### 2.3 响应式

- ≥1181：Inspector 第三列；
- 820–1180：Inspector fixed 浮层，打开时网格右 padding 332+24；
- ≤819：单列；侧栏 280px 左侧抽屉；Inspector 底部 Sheet；
- 561–819：网格 `auto-fill` 固定宽；
- ≤560：标准 2 列、紧凑 3 列；gap 12/10；Inspector 78dvh；
- ≤370：隐藏排序；
- 横屏 ≤560 高且 ≤1024 宽：侧栏/Inspector 抽屉，不占书封列宽。

证据：`shelf.html`；`shelf-workbench.css:46-1464`；`shelf/*.js`；`test/ui-unification.test.js:68-163`。

## 3. 榜单 `/rank`

| 项 | 契约 |
|---|---|
| `body` | `data-page="rank"` |
| 主容器 | `main > #rankContent` |
| 结构 | 两个瓦片：`rank-hero` + 重读榜；`max-width:980px`；段距 80px |
| 数据 | `/api/public/rank/feed?size=8`；`RANK_SIZE=8` |
| 行 | 序号 40px、封面 44×62、标题 17/600、元信息 14、计数 20/600 |
| 状态 | 空榜 `.rank-empty`；无骨架/错误 UI |
| 响应式 | ≤834 padding 64/24；≤640 标题 34、padding 48/20；≤480 标题 28、序号 20 |
| 设计例外 | 980 内宽、发丝线行、零阴影、深色/白色瓦片节奏 |
| 主题色 | 当前 `#ffffff`，规范值 `#f5f5f7` |

**注意：**`style.css:4642-4644` 的注释仍描述“三个瓦片/年度之书/高分榜”，但 `page-rank.js` 当前只渲染 hero + 重读榜。以代码为准，注释是过期描述（见审计）。

证据：`rank.html`；`page-rank.js:6-60`；`style.css:4641-4738`。

## 4. 统计 `/stats`

| 项 | 契约 |
|---|---|
| `body` | `data-page="stats"` |
| 主容器 | `main`，`h1.page-title 统计` |
| 结构 | 深色 hero（4 个数字）→ 4 个可折叠面板（全部默认折叠） |
| 面板 | 每年读完、标签分布、作者、出版社 |
| 数据 | `/api/stats` 或 `/api/public/stats`；topTags 前 12；作者/出版社前 12 |
| 图表 | 年度柱状图（最小 6% 可见）、标签云、排行比例条；空状态 `.chart-empty` |
| 状态 | 有数据/空；无 loading 骨架、无错误 UI |
| 响应式 | hero 2→3→5 列；面板 1→2 列；`panel-wide` 跨两列 |
| 设计例外 | `#272729` 深色 hero、200px“书”水印、`#2997ff` 数字左边线 |
| 主题色 | 当前 `#ffffff`，规范值 `#f5f5f7` |

**保护：** 面板默认全部折叠；点击标题行展开/收起；标题内按钮不触发折叠；hash 深链会先展开目标面板（`common.js:76-136`）。统计面板的深色 hero 和图表色不统一成普通卡片。

证据：`stats.html`；`page-stats.js`；`style.css:2082-2345,4497-4509`。

## 5. 分类管理 `/tags`

| 项 | 契约 |
|---|---|
| `body` | `data-page="tags"` |
| 主容器 | `main`，`h1.page-title 分类管理` |
| 结构 | 标签/作者双列 → 自定义字段 → 重复书籍 → 回收站 → 导入/导出 |
| 默认 | 所有 `section.cat-col` 带 `is-collapsed`；hash 深链展开 |
| 行 | 名称 + 计数 + 操作（✎ / ⇄ / ✕）；hover/focus-within 显示，触屏常显 |
| 数据 | 每类 `PAGE_SIZE=100`；搜索 debounce 250ms；合并目标最多 50；CSV 10MB；回收站 14 天 |
| 弹窗 | 字段、合并；保存中禁用按钮；错误 `#fieldError/#mergeError` |
| 下拉 | 只有 `#mergeTarget` 接入自定义 `.sel`；其他仍是原生 select（债务） |
| 状态 | 加载更多、空行、保存中、错误；无整页骨架 |
| 响应式 | `.cats` 2→1 列（≤820）；`.cat-list` 62vh→不限高；删除元信息 ≤560 隐藏 |
| 无障碍 | `#fieldModal/#mergeModal` 缺 `aria-labelledby`；行操作有 aria-label；破坏性操作有确认 |
| 主题色 | 当前 `#ffffff`，规范值 `#f5f5f7` |

**保护：** 双列→单列、折叠、行操作 hover/触屏差异、CSV 两步导入、回收站保留期。

证据：`tags.html`；`page-tags.js:14-14,44-46,102,150-154,250-338,465-565,776`；`style.css:4740-4948`。

## 6. 读书心得 `/notes/:id`

| 项 | 契约 |
|---|---|
| `body` | `data-page="notes"` |
| 主容器 | `main`；`.notes-page-head` + `.notes-page-body` |
| 头部 | 返回按钮、编辑按钮（绝对定位右上）、封面、标题、作者/日期/状态 |
| 正文 | Markdown 渲染（marked + DOMPurify）；15px/1.6；标题/代码/引用/表格完整 |
| 编辑器 | 等宽 15px/1.7，最小高 360px，可垂直缩放 |
| 状态 | loading 文案、空状态、错误 + 重试、编辑、409 冲突确认、保存 toast |
| 响应式 | 正文 max 860；≤559.98 内边距 20/18/24；封面 52px |
| 无障碍 | `#notesEditor` 没有 label/aria-label（债务）；返回/编辑是原生按钮 |
| 主题色 | 当前 `#ffffff`，规范值 `#f5f5f7` |

**保护：** 返回按钮必须真正可点；编辑态与阅读态不改变头部结构；Markdown 正文不套玻璃。

证据：`notes.html`；`page-notes.js:48-125,172-187`；`style.css:3109-3298`。

## 7. 账号与设备 `/login`

| 项 | 契约 |
|---|---|
| 页面 | 独立页：`body.login-page`，无 `data-page`，无 chrome |
| 卡片 | `min(760px,100%)`，24px 圆角；≤560 padding 12 |
| 状态 | 未初始化 / 未登录（表单）/ 已登录（账号面板）；`#accountStatus role=status aria-live=polite` |
| 表单 | 用户名/密码；`<details>` 令牌登录；输入 16px、44px 高 |
| 账号面板 | 当前账号、设备、已登录绿点、进入书库、退出、设备列表 |
| 设备 | 当前设备只显示标记；其他设备显示撤销按钮，确认后撤销 |
| 请求中 | 按钮 disabled（`login.js:144,162`），无 spinner |
| 错误 | 写入 `#accountStatus`，不使用 toast |
| 响应式 | ≤560 按钮全宽、撤销 44px、身份块换行 |
| 主题色/viewport | 缺 `theme-color`；viewport 缺 `viewport-fit=cover`（债务） |
| 设计例外 | 独立冷白卡片、无全局导航；不要为了统一强行注入顶栏 |

证据：`login.html`；`login.css:1-309`；`login.js:90-172`。

## 8. Glass Lab `/glass-lab.html`

| 项 | 契约 |
|---|---|
| 页面 | 开发验证页；`data-page="glass-lab"`；`noindex,nofollow`；不注册 Service Worker；不进入导航 |
| 内容 | 模式切换（auto/full/frost/solid）、高对比场景、移动色块、书封、工具栏仿真、悬浮控件、菜单、统计读数、压力测试、FPS |
| 测试数据 | 40 条演示条目 + 5 张假书封；明确标注“演示条目，不是真实数据” |
| 档位 | 可用 `?glass=` 强制 `full` / `frost` / `solid`；按钮调用 `LiquidGlass.setMode` |
| 统计 | tier/mode、折射数量、滤镜数量、backdrop 支持、环境、降级策略 |
| 响应式 | 720 断点；移动工具栏压缩、隐藏假分段 |
| 边界 | 允许内联样式；不接 API、不读真实书库、不写 localStorage（除 glass mode）；不作为生产组件来源 |

证据：`glass-lab.html`；`liquid-glass.js:321-333,644-659`。

## 9. 页面间不变量

1. 主导航顺序：账号、首页、书架、榜单、统计、分类；
2. 书架页没有全局顶栏/页脚，站点导航只走左上 My books 菜单；
3. 书架页的“书架”菜单项不打开桌面悬停下拉（`NO_DESKTOP_FLYOUT = new Set(['shelf'])`，`chrome.js:42-46`）；
4. 所有页面的书籍详情共用 `BookDetails`；不再维护第二套详情 HTML；
5. 所有页面共享 `.modal`、`.toast`、`.sel`、`.btn`、`.tag-chip` 等基础组件；
6. 公开页（home/rank/stats）使用 `/api/public/*`；管理页使用 `/api/*`；
7. 页面不得自行定义与全站同名的导航/搜索/详情组件；
8. 页面专属样式必须挂在 `body[data-page="..."]`、`main.page-*` 或页面唯一类下，不能污染其它页面。
