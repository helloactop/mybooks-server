# 15 · 现有组件全量清单

状态图例：

- **已统一**：已有共享 token/primitive，跨页面复用；
- **部分统一**：有共享基础，但页面仍有变体/漂移；
- **重复**：同类组件多套实现；
- **特例**：有意保留的页面专属；
- **债务**：状态/无障碍/触控不完整；
- **未使用**：基线中未找到引用，清理候选。

优先级：P0 = 先修的正确性/可访问性问题；P1 = 跨页面统一；P2 = 视觉收敛；P3 = 清理/低风险。

说明：`.saved-chip`、`.log-chip`、`.status-inline`、`.has-notes`、`.isbn-result-chip` 等叶子元素继承所属组件的状态与焦点策略，不单独定义 Loading/Error；其颜色/尺寸在 `04-color.md`、`05-spacing-radius.md` 登记。容器级组件的完整状态矩阵见 `10-components.md`。

## 1. 全局与导航

| ID | 组件 | 源码 | 使用页面 | 状态 | 判断 | 优先级 |
|---|---|---|---|---|---|---|
| G01 | Topbar / 主导航 | `chrome.js:246-285`；`style.css:131-687` | 除 shelf/login/lab 外全部 | 部分统一 | 保留 Apple parity 几何；修焦点/语义 | P1 |
| G02 | 桌面导航 flyout | `chrome.js:626-944`；`style.css:689-993` | 桌面主页面 | 特例 | 保留；只修焦点/关闭 | P2 |
| G03 | 移动全屏菜单 | `overlay.js:68-300`；`style.css:339-687` | 移动主页面 | 特例 | 保留；补焦点陷阱 | P1 |
| G04 | 移动二级面板/名单 | `overlay.js:21-117`；`style.css:440-629` | 移动主页面 | 特例 | 保留 | P2 |
| G05 | 全局搜索浮层 | `chrome.js:293-319`；`overlay.js:306-545`；`style.css:995-1396` | 主页面 | 部分统一 | 视觉统一；补焦点陷阱 | P1 |
| G06 | 搜索结果行/保存搜索 | `overlay.js:283-300`；`style.css:1219-1297` | 主页面 | 部分统一 | 与列表行统一状态 | P2 |
| G07 | 页脚 | `chrome.js:604-612`；`style.css:3357-3407` | 除 shelf/login/lab 外 | 已统一 | 保留 | P3 |
| G08 | Toast | `common.js:25-50`；`style.css:3313-3355` | 全部主页面 | 债务 | 补 `role=status`/`aria-live`；统一错误色 | P0/P1 |
| G09 | Modal shell | `modal.js:1-76`；`style.css:2347-2397,4510-4612` | 全部主页面 | 部分统一 | 补退出/语义/`aria-labelledby` | P1 |
| G10 | 全局详情抽屉 | `chrome.js:554-557`；`common.js:138-213`；`style.css:2997-3084` | 主页面 | 已统一 | 与 BookDetails 共用；补焦点陷阱 | P1 |
| G11 | 自定义下拉 `.sel` | `select.js:14-167`；`style.css:1645-1801` | shelf/tags/shelf actions | 部分统一 | 推广到剩余原生 select；补 label 关联 | P1 |
| G12 | Button `.btn` | `style.css:1466-1571,4821` | 全部 | 部分统一 | 统一尺寸/加载/触屏 | P1 |
| G13 | IconButton `.icon-btn` | `style.css:1573-1616`；`chrome.js:258-269` | 全部 | 重复 | 与 `.wb-circle`/`.cat-op` 统一尺寸与状态 | P1 |
| G14 | Segmented `.seg` | `style.css:1404-1458,2461-2468`；`shelf-workbench.css:642-661,815-843` | shelf/详情/表单 | 部分统一 | 统一选中语义/键盘 | P1 |
| G15 | Tag chip | `style.css:1618-1627,2270-2293,2825-2855` | stats/详情/首页 | 部分统一 | 统一尺寸/状态 | P2 |
| G16 | Form field | `style.css:2399-2460`；`login.css:101-128` | 主页面/login | 重复 | 共享状态，保留尺寸变体 | P1 |
| G17 | Checkbox/radio row | `style.css:4992-4997,4870-4880`；`shelf-workbench.css:662-691` | tags/shelf/bulk | 重复 | 统一行高/焦点 | P2 |
| G18 | Collapsible section | `common.js:76-136`；`style.css:2190-2227` | stats/tags | 已统一 | 补 `aria-controls`/region | P2 |
| G19 | Skeleton | `shelf-workbench.css:385-416,419-422,980-990` | shelf/详情 | 部分统一 | 统一 shimmer；统计/榜单补骨架 | P2 |
| G20 | Empty state | `style.css:2058-2080,4725,4811,2345,3232`；`shelf-workbench.css:1150-1171` | 全部 | 重复 | 统一结构，保留文案插槽 | P2 |
| G21 | Error state | `shelf-workbench.css:1150-1171,991-1001`；`style.css:2606,3233,3342,5047` | 全部 | 重复 | 统一 error 语义/重试 | P1 |
| G22 | Page title / hero | `style.css:1636-1643,3496-3530,4653-4738,2083-2146,3110-3119`；`login.css:64-82` | 各页 | 重复 | 保留页面特例；只统一字阶 token | P3 |
| G23 | BookCover | `cover.js:1-63`；多处 CSS | 全部 | 部分统一 | 定义 library/display 两个变体 | P2 |
| G24 | BookDetails | `book-details.js:306-818`；`style.css:2614-3108` | shelf/其他页 | 已统一 | 补状态语义/焦点陷阱 | P1 |
| G25 | 高级搜索语法弹窗 | `chrome.js:520-552`；`style.css:4950-4982` | 搜索 | 特例 | 用 Modal shell | P3 |
| G26 | ISBN 批量弹窗 | `chrome.js:559-593`；`style.css:4984-5021` | 添加书籍 | 特例 | 与表单组件统一 | P2 |
| G27 | 扫码浮层 | `scanner.js`；`style.css:5023-5057` | 添加书籍 | 特例 | 统一 Modal/错误/焦点 | P2 |
| G28 | 豆瓣候选 | `style.css:2545-2590` | 编辑书籍 | 特例 | 统一列表行状态 | P3 |
| G29 | 电子书文件行 | `style.css:2492-2543` | 编辑书籍 | 特例 | 保留 | P3 |
| G30 | 标识符行 | `style.css:4915-4936` | 编辑书籍 | 特例 | 保留；修 `--line` | P0 |
| G31 | 阅读记录行 | `style.css:3409-3469` | 编辑书籍 | 特例 | 保留 | P3 |

## 2. 书架工作台

| ID | 组件 | 源码 | 状态 | 判断 | 优先级 |
|---|---|---|---|---|---|
| S01 | 书架外壳/面板 | `shelf-workbench.css:46-107` | 特例 | 保留三栏/抽屉/圆角 | — |
| S02 | 侧栏头部 | `sidebar.js:411-415`；`shelf-workbench.css:114-172` | 特例 | 保留 | — |
| S03 | Sidebar row | `sidebar.js:359-390`；`shelf-workbench.css:216-282` | 部分统一 | 补 aria-current/触屏 | P1 |
| S04 | Sidebar section/折叠 | `sidebar.js:301-322`；`shelf-workbench.css:174-214` | 部分统一 | 补 aria-controls；保留层级 | P2 |
| S05 | Facet filter/list/more | `sidebar.js:301-357,617-647`；`shelf-workbench.css:284-325` | 已统一 | 保留焦点/滚动保护 | P2 |
| S06 | 侧栏内联表单 | `sidebar.js:364-388`；`shelf-workbench.css:327-355` | 特例 | 保留 | P3 |
| S07 | Toolbar / brand | `shelf.html:34-47`；`shelf-workbench.css:588-843` | 特例 | 保留；补语义 | P2 |
| S08 | Brand menu | `shelf.html:40-47`；`shelf-workbench.css:746-773` | 特例 | 保留；导航入口必须可点 | P1 |
| S09 | Layout menu | `shelf.html:75-117`；`shelf-workbench.css:619-691` | 特例 | 保留；统一 seg 语义 | P2 |
| S10 | View segmented | `shelf.html:60-67`；`shelf-workbench.css:815-843` | 部分统一 | 保留几何；补 aria-pressed | P2 |
| S11 | Sort select | `shelf.html:50-58`；`shelf-workbench.css:800-812` | 已统一 | 复用 `.sel` | P3 |
| S12 | Circle button | `shelf.html:68-73,159,167`；`shelf-workbench.css:775-798` | 部分统一 | 与 `.icon-btn` 统一状态 | P1 |
| S13 | Search pill | `shelf.html:162-166`；`shelf-workbench.css:870-902` | 特例 | 保留 | P2 |
| S14 | Search close | `shelf.html:238-240`；`shelf-workbench.css:904-922` | 特例 | 保留 | P2 |
| S15 | Shelf card/grid | `grid.js:15-20`；`shelf-workbench.css:357-586` | 特例 | 保留；补 aria 语义 | P2 |
| S16 | Card overlay/check | `shelf-workbench.css:519-586` | 特例 | 保留 | P3 |
| S17 | List/table | `grid.js:37-93`；`shelf-workbench.css:1038-1148` | 特例 | 保留；补表头/焦点 | P2 |
| S18 | 手机列表 | `grid.js:37-60`；`shelf-workbench.css:1041-1105` | 特例 | 保留 | P2 |
| S19 | Inspector | `inspector.js:25-180`；`shelf-workbench.css:924-1037` | 已统一（复用 BookDetails） | 补焦点/状态 | P1 |
| S20 | 多选面板 | `inspector.js:75-160`；`shelf-workbench.css:967-1036` | 特例 | 保留 | P2 |
| S21 | Bulk bar | `shelf.html:172-178`；`actions.js:10-20`；`style.css:1849-1869` | 部分统一 | 保留；补状态文案 | P2 |
| S22 | Marquee | `main.js:845-910`；`shelf-workbench.css:701-718` | 特例 | 仅鼠标桌面；保留 | P3 |
| S23 | Shelf skeleton/empty/error | `shelf.html:124-150`；`shelf-workbench.css:385-416,1150-1171` | 部分统一 | 统一状态模型 | P2 |
| S24 | Scope label | `shelf.html:122`；`main.js:47-66`；`shelf-workbench.css:602-617` | 特例 | 保留 | P3 |
| S25 | Scrim | `shelf.html:155-156`；`shelf-workbench.css:118-172,1298-1316` | 特例 | 保留 | P3 |
| S26 | Collection drop target | `shelf-workbench.css:694-699` | 特例 | 保留 | P3 |
| S27 | Glass mode segment/note | `shelf.html:94-103`；`liquid-glass.css:366-370` | 特例 | 保留 | P3 |

## 3. 页面专属

| ID | 组件 | 源码 | 页面 | 状态 | 判断 | 优先级 |
|---|---|---|---|---|---|---|
| P01 | Home hero | `page-home.js:325-333`；`style.css:3496-3530` | 首页 | 特例 | 保留 | P3 |
| P02 | Home feature 黑横幅 | `page-home.js:271-285`；`style.css:3532-3547` | 首页 | 特例 | 保留 | P3 |
| P03 | Home product tile | `page-home.js:294-335`；`style.css:3549-3644` | 首页 | 特例 | 保留 | P3 |
| P04 | Home gallery | `page-home.js:337-357`；`style.css:3737-4487` | 首页 | 特例 | 保留 1:1 | P3 |
| P05 | Dotnav | `endless-gallery.js`；`style.css:4090-4377` | 首页 | 特例 | 保留几何/pause | P3 |
| P06 | Rank hero | `page-rank.js:45-51`；`style.css:4652-4665` | 榜单 | 特例 | 保留 | P3 |
| P07 | Rank row | `page-rank.js:9-21`；`style.css:4675-4725` | 榜单 | 特例 | 保留 | P3 |
| P08 | Stats hero | `page-stats.js:9-17`；`style.css:2082-2146` | 统计 | 特例 | 保留 | P3 |
| P09 | Stats panel/collapse | `stats.html:21-38`；`style.css:2154-2227` | 统计 | 部分统一 | 复用 Collapsible | P2 |
| P10 | Year chart | `page-stats.js:30-44`；`style.css:2229-2268` | 统计 | 特例 | 保留；补文本替代 | P3 |
| P11 | Tag cloud | `page-stats.js:47-56`；`style.css:2270-2293` | 统计 | 部分统一 | 复用 Tag chip | P3 |
| P12 | Stat rank row | `page-stats.js:59-72`；`style.css:2295-2343` | 统计 | 特例 | 保留 | P3 |
| P13 | Category column/row | `page-tags.js:24-46`；`style.css:4744-4811` | 分类 | 特例 | 保留双列/折叠 | P2 |
| P14 | Category op button | `page-tags.js:44-46,285-287,564-565`；`style.css:4788-4809` | 分类 | 债务 | 统一 `.icon-btn` 尺寸/触屏 | P1 |
| P15 | Duplicate group/book | `page-tags.js:482-489`；`style.css:4860-4887` | 分类 | 特例 | 保留 | P3 |
| P16 | Trash row | `page-tags.js:544-565`；`style.css:4893-4904` | 分类 | 特例 | 保留 | P3 |
| P17 | Import controls | `tags.html:92-117`；`style.css:4835-4846` | 分类 | 债务 | 接入 `.sel`；修 `--line` | P1/P0 |
| P18 | Field modal | `tags.html:121-171` | 分类 | 债务 | 补 aria-labelledby | P1 |
| P19 | Merge modal | `tags.html:174-199` | 分类 | 债务 | 补 aria-labelledby；接入 `.sel` | P1 |
| P20 | Notes head/cover | `notes.html:20-31`；`style.css:3109-3200` | 心得 | 特例 | 保留 | P3 |
| P21 | Notes editor | `page-notes.js:116-125`；`style.css:3121-3145` | 心得 | 债务 | 补 label/aria | P1 |
| P22 | Markdown body | `style.css:3248-3298` | 心得 | 特例 | 保留 | P3 |
| P23 | Login card/form | `login.html`；`login.css` | 账号 | 特例 | 保留；统一表单状态 | P2 |
| P24 | Device row | `login.js:39-85`；`login.css:236-288` | 账号 | 特例 | 保留 | P3 |
| P25 | Glass Lab fixtures | `glass-lab.html` | 开发 | 特例 | 保留；不作为生产组件 | — |
| P26 | Book form | `chrome.js:330-550`；`style.css:5064-5173` | 添加/编辑 | 部分统一 | 复用 Form/Field/Select | P1 |
| P27 | Scanner overlay | `scanner.js`；`style.css:5023-5057` | 添加 | 特例 | 统一 Modal/错误 | P2 |

## 4. 未使用 / 清理候选

| ID | 组件 | 源码 | 证据 | 判断 |
|---|---|---|---|---|
| L01 | `.book-grid` / `.book-card` / `.card-cover` 旧书架 | `style.css:1803-2057` | `public/*.html`、`public/js` 未引用 `book-grid`/`book-card` | 清理候选；先确认无服务端/旧缓存依赖 |
| L02 | `.empty` 旧空状态 | `style.css:2058-2080` | 当前页面使用 `.wb-empty`/`.rank-empty`/`.cat-empty-row` 等 | 清理候选 |
| L03 | `.status-badge` / `.status-inline` | `style.css:1968-2056` | `.status-inline` 仍用于首页/心得；`.status-badge` 未见引用 | 部分保留 |
| L04 | `--radius-xs` / `--star` / `--shadow-card-hover` / `--nav-h` | `style.css:23,31,39,46` | 无引用 | 清理候选 |
| L05 | `--wb-panel-raised` / `--wb-card-min` | `shelf-workbench.css:12,31-41` | 无引用 | 清理候选 |
| L06 | `--liquid-radius` / `--liquid-edge-strong` | `liquid-glass.css:27,32` | 无引用 | 清理候选 |
| L07 | `--home-surface` / `--home-text` / `--home-sub` | `style.css:3476-3478` | 无引用 | 清理候选 |
| L08 | `.notes-retry` 等 `--glass-*` 旧引用 | `style.css:3230-3246,3301-3307,3441-3452` | 仍在使用 | 迁移到 control token |
| L09 | 旧详情 `detailModal` | 已移除 | `test/ui-unification.test.js:247-266` | 完成 |

## 5. 清单统计

- 全局/导航 31 项；
- 书架 27 项；
- 页面专属 27 项；
- 未使用/清理候选 9 项；
- 合计 94 个登记项（含页面容器/变体）。

其中：

- **P0**：`G08`、`G30`/`P17` 的未定义变量修复；
- **P1**：焦点/语义/触屏/表单/下拉/弹窗/Toast/侧栏行/图标按钮；
- **P2**：视觉收敛、骨架/空状态/封面变体/统计面板；
- **P3**：页面特例与低风险清理。
