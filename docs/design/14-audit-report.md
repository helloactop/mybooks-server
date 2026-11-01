# 14 · 审计报告与第一阶段结论

> 基线：`main` @ `690bb18582ba9c6245619751d48a8d8abf5b2427`（2026-11-01）
> 范围：设计文档、组件清单、审计；未修改任何运行时文件。
> 证据：`public/css/*.css`、`public/js/chrome.js`、`overlay.js`、`book-details.js`、`common.js`、`modal.js`、`select.js`、`liquid-glass.js`、`shelf/*.js`、`public/*.html`、`public/glass-lab.html`、`test/ui-unification.test.js`。

## 1. 当前设计系统已经实现了什么

### 1.1 已成立的视觉语言

- **冷白画布 + 白色内容面 + 近黑文字 + 发丝线**：`--canvas #f5f5f7`、`--surface #ffffff`、`--ink #1d1d1f`、`--hairline*`（`style.css:5-30`）。
- **单一 Action Blue**：`#0066cc` 作为链接、主操作文字、选中勾、在读状态（`style.css:18-20`）。
- **中性选中态**：选中滑块使用 `--selected-bg/--selected-edge/--selected-shadow`，不再使用黑/蓝实底（`style.css:63-66,1445-1451,1795-1801`）。
- **克制的 chrome**：顶栏无描边/无阴影，导航项无药丸选中；玻璃只负责背景关系（`style.css:131-229`）。
- **书籍优先**：书架纯封面、首页大封面、详情展示优先；内容层不加玻璃。

### 1.2 已统一的材质/控件

- **控件材质 token**：按钮、图标按钮、分段、下拉触发器共用 `--control-*`（`style.css:48-67`）。
- **按钮家族**：`.btn`、`.btn-primary`、`.btn-ghost`、`.btn-danger-tint`、`.btn-sm` 已有统一基础（`style.css:1466-1571,4821`）。
- **自定义下拉**：`.sel` primitive 完成键盘、视口校正、单选同步（`select.js:14-167`）。
- **弹窗原语**：`openModal/closeModals`、滚动锁、背景点击、Tab 陷阱、焦点归还（`modal.js:20-76`）。
- **Toast**：单实例、错误态、撤销操作（`common.js:25-50`）。
- **统一书籍详情**：Inspector、其他页面抽屉、公开只读共用 `BookDetails`；旧的 `detailModal` 已移除（`book-details.js:306-818`；`test/ui-unification.test.js:247-266`）。

### 1.3 已实现的页面结构

- **书架工作台**：沉浸式三栏 232/1fr/332、8px 外边距、三档密度 140/180/210、纯封面、Finder 侧栏、Inspector、底部搜索胶囊、批量条、框选、键盘导航。
- **Apple 式导航**：桌面 flyout、移动全屏菜单/二级面板、搜索浮层、首页画廊/dotnav，均有明确几何与时长。
- **页面特例**：首页全出血展示、榜单瓦片、统计深色 hero、分类管理双列、心得 Markdown、登录独立卡片。

### 1.4 Liquid Glass

- **三档**：full（Chromium 真实折射）/ frost（WebKit/Firefox 磨砂）/ solid（无 backdrop/低性能/减少透明度）。
- **真实折射**：SVG `feDisplacementMap` + `backdrop-filter`，不克隆 DOM、不复制背景；滤镜按几何复用，限制 14/10 个折射面。
- **材质边界**：大面板近实体（10px blur、96–98.5% 白），内容层实体，菜单/搜索展开不透明，遮罩不叠加 blur。
- **降级诚实**：Safari/Firefox 不伪造折射；`prefers-reduced-motion/transparency` 有回退。
- **验证页**：`glass-lab.html` 可强制档位、读数、压力测试。

### 1.5 工程保护

- `test/ui-unification.test.js` 20 条断言覆盖 token、玻璃参数、书架布局、Finder 层级、搜索关闭、详情统一、资源版本等。
- 书架保护行为已实现：滚动位置、侧栏展开、分组折叠、搜索焦点/选中范围、内联草稿、异步序列号。
- 资源版本有 `?v=` + `sw.js` shell 清单 + `CACHE_VERSION` 的既有机制。

### 1.5.1 UI 测试覆盖审查

已有 UI/行为测试：

| 测试 | 覆盖 | 不覆盖 |
|---|---|---|
| `test/ui-unification.test.js`（20 条） | 冷白 token、玻璃参数、选中态、大面板近实体、书架三栏/密度/Finder 层级、搜索关闭、详情统一、资源版本 | 像素、真实浏览器、焦点陷阱、对比度、触屏命中、空/加载/错误视觉 |
| `test/glass-engine.test.js`（3 条） | full/frost/solid 分流、几何共享、滤镜池引用计数 | 真实 Chromium 折射像素、Safari/Firefox 实机 |
| `test/shelf-loading-experience.test.js`（10 条） | 首屏侧栏、骨架延迟、列表/分类解耦、详情预览、缓存 TTL/revision、A/B 迟到响应 | DOM 视觉、滚动位置、焦点恢复 |
| `test/sidebar-scroll-state.test.js`（6 条） | 整栏重绘的滚动/焦点恢复、展开后焦点落点、局部更新 | 真实滚动惯性、触屏手势 |

**缺口：**

- 没有视觉回归（截图/像素 diff）；
- 没有自动化的 `aria-*`/焦点陷阱/可访问名称检查；
- 没有对比度/触控目标自动检查；
- 没有 reduced-motion/reduced-transparency 的浏览器级检查；
- 没有桌面/平板/手机/横屏的多视口截图矩阵；
- 没有空/加载/错误状态的视觉断言；
- 没有 Safari/Firefox 实机或 WebKit 引擎测试。

**补充方案（第二阶段）：**

1. 保留现有行为测试，不删除/不放宽；
2. 新增 UI Lab fixture（`13-ui-lab.md`），为每个组件提供静态状态；
3. 用 Playwright 或现有 CDP 脚本建立 390/768/820/932×430/1024/1180/1440 截图基线；
4. 静态 fixture 做像素 diff；数据页面只对比结构区域并遮罩动态内容；
5. 增加 DOM 断言：焦点陷阱、`aria-labelledby`、`aria-pressed`、`aria-live`、触控目标尺寸；
6. 增加对比度检查：对 token 组合计算，不依赖截图；
7. 增加 reduced-motion/reduced-transparency 的媒体模拟检查；
8. 任何视觉变更必须带 before/after 截图；测试断言只能跟随真实行为更新，不能为了通过而放宽。

## 2. 具体不一致与重复

严重度：**高** = 会产生错误/不可访问/明显视觉缺陷；**中** = 维护/一致性风险；**低** = 清理/命名/注释。

### 2.1 正确性缺陷

| # | 问题 | 严重度 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| A1 | `--line` 未定义 | 高 | `style.css:3128`（`.notes-editor`）、`4841`（`.import-opt select`） | 整条 `border` 声明失效，控件没有边框 | B0 定义 `--line` 或改 `--hairline`；截图确认 |
| A2 | `--ink-1` 未定义 | 中 | `style.css:2580`（`.douban-candidate`） | `color` 回退为继承色，与预期 `--ink` 不一致 | B0 改为 `--ink` |
| A3 | `theme-color` 不一致 | 中 | 书架 `#f6f5f2`（`shelf.html:6`）；榜单/统计/分类/心得 `#ffffff`；登录缺失 | 移动浏览器栏与冷白画布跳色，书架仍是旧暖白 | B0 统一 `#f5f5f7` |
| A4 | 登录页 viewport 缺 `viewport-fit=cover` | 低 | `login.html:4` | 刘海屏安全区不完整 | B0 补齐 |
| A5 | 两套焦点蓝 | 中 | 全局 `#0071e3`（`style.css:129`）；控件 `var(--accent)` `#0066cc`（`style.css:1461-1464`）；书架 `.wb-card` `#0071e3`（`shelf-workbench.css:491`） | 同一键盘焦点在不同组件颜色不同 | B2 统一并截图确认 |
| A6 | 两套红色语义 | 中 | `--danger #c0392b`（`style.css:21`）vs 错误 `#e30000`（`style.css:2606,3342,3233,5047`） | “危险操作”和“错误反馈”混用，后续容易再引第三种红 | B2 拆 `--danger`/`--error` |
| A7 | 三级文字对比度不足 | **高（无障碍）** | `#86868b` on white 3.62:1、on canvas 3.33:1；`#929399` on white 3.06:1、on sidebar 2.88:1 | 12px 日期/提示/计数不满足 AA 4.5:1 | B2/B4 加深或限制使用；需用户确认视觉变化 |
| A8 | Toast 没有 live region | 高（无障碍） | `chrome.js:602` 只有 `#toast`；`common.js:25-50` 无 role/aria-live | 屏幕阅读器不播报保存/删除/错误 | B2 补 `role=status`/`aria-live` |
| A9 | 浮层焦点陷阱缺失 | 高（无障碍） | `modal.js:53-68` 只有弹窗陷阱；移动菜单/搜索/Inspector 无；Select 是 Tab 即关闭而非陷阱 | 键盘用户可 Tab 到背景，焦点丢失 | B2 为菜单/搜索/Inspector 补陷阱或 inert |
| A10 | 弹窗可访问名称缺失 | 中（无障碍） | `tags.html:121,174` 的 `#fieldModal/#mergeModal` 只有 `role/aria-modal` | 屏幕阅读器只读“dialog” | B2 补 `aria-labelledby` |
| A11 | 笔记编辑器无 label | 中（无障碍） | `page-notes.js:119` | 输入框没有可访问名称 | B2 补 label/aria-label |
| A12 | 选中状态只有类名 | 中（无障碍） | `.seg button.active`（`style.css:1445-1451`）；`.bd-status`（`book-details.js:235-237`）；书架视图 `.active` | 屏幕阅读器不知道选中项 | B2 补 `aria-pressed`/`aria-selected` |
| A13 | 自定义下拉 label 未转移 | 中（无障碍） | `select.js:17-18` 把原生 select `aria-hidden`；trigger 没有 `aria-labelledby` | 字段名与触发器脱节 | B2 关联 label |
| A14 | 触屏命中区不完整 | 中 | `.btn-sm` 34px（`style.css:4821`）；`.cat-op` 30px（`style.css:4794-4802`）；`.wb-row-act` 22px（touch 44，`shelf-workbench.css:1344-1356`） | 手指误触/难以点中 | B2 粗指针 ≥44 |
| A15 | 加载态只有禁用/文案 | 中 | 登录按钮 disabled（`login.js:144,162`）；表单保存按钮无 spinner | 用户不知道“正在处理”还是“不可用” | B2/B3 统一加载态 |

### 2.2 重复实现

| # | 问题 | 严重度 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| B1 | 7 套页面 hero/标题 | 中 | `.home-hero`（`style.css:3496`）、`.rank-hero`（`4653`）、`.stats-hero`（`2083`）、`.page-title`（`1636`）、`.notes-page-head`（`3110`）、`.account-head`（`login.css:64`）、`.lab-head`（`glass-lab.html:14`） | 字阶/间距/结构各自为政 | 保留布局特例，只统一字阶/间距 token |
| B2 | 6 套空状态 | 中 | `.empty`（`style.css:2059`，未使用）、`.wb-empty`（`shelf-workbench.css:1151`）、`.rank-empty`（`style.css:4725`）、`.cat-empty-row`（`4811`）、`.chart-empty`（`2345`）、`.notes-state`（`3232`）、`.bd-empty`（`2988`）、`.wb-facet-empty`（`shelf-workbench.css:319`） | 文案/间距/图标不一致 | 统一状态模型，保留内容插槽 |
| B3 | 4 套列表行 | 中 | `.rank-row`（`style.css:4676`）、`.cat-row`（`4765`）、`.stat-rank-row`（`2299`）、`.device-row`（`login.css:236`） | hover/间距/焦点不一致 | 按场景统一状态，不统一页面结构 |
| B4 | 5 套图标按钮 + Unicode/emoji 图标 | 中 | `.icon-btn`（`style.css:1573`）、`.wb-circle`（`shelf-workbench.css:775`）、`.cat-op`（`style.css:4794`）、`.wb-row-act`（`shelf-workbench.css:268`）、`.bd-copy`（`style.css:2770`）；回收站还用 `↺`/`🗑`（`page-tags.js:564-565`） | 尺寸 22/30/32/44，状态不同；emoji 跨平台字形不一致 | 统一尺寸/状态/触屏；Unicode/emoji 换 SVG |
| B5 | 分段控件有共享类但仍分叉 | 低 | `.seg` 基础（`style.css:1404-1458`）与表单覆盖（`2461-2468`）；书架 `.wb-layout-seg`/`.wb-view`（`shelf-workbench.css:642-661,815-843`） | 维护两套尺寸/状态 | 保留尺寸差异，统一语义 |
| B6 | `.tag-chip` 两处定义 | 低 | `style.css:1618-1627` 与 `2270-2293` | 依赖层叠顺序 | 合并为一条基础 + 变体 |
| B7 | `.seg button` 两处定义 | 低 | `style.css:1418-1437` 与 `2462-2468` | 表单覆盖依赖源序 | 合并/注明覆盖原因 |
| B8 | 状态标签表重复 | 低 | `base.js:10` `STATUS_LABEL` vs `book-details.js:12` `STATUS` | 新增状态要改两处 | 提取共享常量 |
| B9 | HTML 转义函数重复 | 低 | `base.js:12-16` `esc`；`chrome.js:205-207` `navEscape`（不含 `'`） | 转义字符集不一致 | 统一使用 `esc` |
| B10 | Escape 分层逻辑分散 | 中 | `modal.js:43`、`overlay.js:547,652`、`book-details.js:730`、`select.js:135`、`shelf/main.js:535`、`shelf/sidebar.js:669` | 新增浮层容易漏掉层级 | 统一浮层栈 |
| B11 | 自定义 select 只接入部分页面 | 中 | `select.js` 存在；`page-tags.js:236` 只有 `#mergeTarget` 接入；`#importDup/#importAutomerge/#cfDatatype/#cfMultiple` 仍是原生 | 同类控件外观/键盘不同 | B3 推广 |
| B12 | Toast 与登录错误反馈两套 | 低 | `common.js:25-50` vs `login.js:80-172` 写 `#accountStatus` | 登录无 toast，属页面特例；但错误样式不统一 | 保留登录特例，统一错误语义 |

### 2.3 token/样式债务

| # | 问题 | 严重度 | 证据 | 影响 |
|---|---|---|---|---|
| C1 | 没有 spacing token | 中 | 全站大量 2/4/6/8/10/12/14/16/18/20/22/24/28/32/36/40/44/48/52/64/80/112 字面量 | 无法统一调整密度 |
| C2 | 圆角 18/20/24 混用 | 中 | `--radius` 18、`--radius-lg` 20、`--radius-xl` 24；`style.css:31-37` | 同一层级的卡片/弹窗圆角不一致 |
| C3 | 字号半步值过多 | 中 | 12/12.5/13/13.5/14/14.5/15/15.5/16/17…（`03-typography.md`） | 字阶难维护 |
| C4 | `--serif` 名不副实 | 中 | `style.css:44-45` 两者都是 system sans | 误导后续选择字体 |
| C5 | 封面比例/阴影漂移 | 中 | 书架 2:3（`shelf-workbench.css:455-464`）vs 展示 5:7（`style.css:1871-1875,3646-3650`）；封面阴影至少 5 种值 | 同一“书封”在不同页面观感不一致 |
| C6 | 旧 `.book-grid/.book-card/.empty` 未使用 | 低 | `style.css:1803-2080`；全仓未找到引用 | 死代码增加审计成本 |
| C7 | 未使用 token | 低 | `--star`、`--radius-xs`、`--shadow-card-hover`、`--nav-h`、`--selected-marker`、`--wb-panel-raised`、`--wb-card-min`、`--liquid-radius`、`--liquid-edge-strong`、`--home-surface/text/sub` | 维护噪音 |
| C8 | `--wb-card-min` 与 `--wb-card-width` 双来源 | 低 | `shelf-workbench.css:31-44` | 密度配置可能改错一个 |
| C9 | `--glass-*` 兼容别名仍有引用 | 低 | `style.css:3230-3246,3301-3307,3441-3452` | 两套材质来源 |
| C10 | z-index 未 token 化 | 中 | 44/45/46/48/49/50/60/61/70/100/120/200 分散（`style.css`、`shelf-workbench.css`） | 新增浮层容易压错层 |
| C11 | 断点分散 | 低 | 全局 560/820；书架 1180/370/560/1024；首页 734/1068/1069/1441；榜单 834/640/480；Lab 720 | 新页面容易加错断点 |
| C12 | 注释/代码漂移 | 低 | `style.css:4642-4644` 仍写“三个瓦片”；`chrome.js:792` 写 120ms 实际 420ms；`overlay.js:143` 写 0.422+0.12 实际 600ms | 误导维护 |
| C13 | 运行时变量未文档化 | 中 | `--mm-i`、`--nav-*`、`--i`、`--lg-filter`、`--tile-*`、`--card-*`、`--sk-dotnav-count` | 容易被误判为未定义；本文件已登记 |

### 2.4 状态覆盖缺口

| # | 问题 | 严重度 | 证据 |
|---|---|---|---|
| D1 | 首页无骨架/空/错误 | 中 | `page-home.js` 只渲染成功数据；无 loading/empty/error 分支 |
| D2 | 榜单无骨架/错误 | 中 | `page-rank.js` 无 loading/error，只有 `.rank-empty` |
| D3 | 统计无骨架/错误 | 中 | `page-stats.js` 只有 `.chart-empty` |
| D4 | 统计图缺少文本替代 | 中（无障碍） | `page-stats.js:39` 仅 `title` 提示 |
| D5 | 书架 Inspector 无焦点陷阱 | 中（无障碍） | `inspector.js` 只控制 hidden/class |
| D6 | 移动菜单/搜索无焦点陷阱 | 高（无障碍） | `overlay.js` 无 Tab 循环 |
| D7 | Toast/错误无 live region | 高（无障碍） | 见 A8 |
| D8 | reduced motion 只由 CSS 处理，JS 计时器仍运行 | 低/中 | `chrome.js`/`overlay.js`/`shelf/*` 无 `matchMedia` 判断；只有 `liquid-glass.js`、`endless-gallery.js` 有 |

### 2.5 做得好的地方（不要回退）

- 书架保护行为：滚动、侧栏、折叠、搜索焦点/选中范围、草稿、异步序列号；
- 书封/表格/正文保持实体，没有为了玻璃而模糊；
- 大面板近实体、小控件真实折射的边界清楚；
- 选中态中性、蓝色只给焦点/链接/主操作；
- 详情组件统一，旧 `detailModal` 已移除；
- UI 测试对“材质/布局/版本”的关键不变量有断言；
- 资源版本 + SW shell 清单机制完整。

## 3. 应统一 vs 应保留

### 3.1 应统一

| 组件/项 | 统一内容 | 不改变 |
|---|---|---|
| Button / IconButton | 尺寸、加载/禁用/焦点、触屏 44、图标描边 | 现有材质/颜色/圆角 |
| Segmented | 选中语义、键盘方向键（如升级）、禁用 | 书架/表单尺寸差异 |
| Select | 推广到所有下拉、label 关联、键盘 | 现有菜单几何 |
| FormField | 状态/错误/必填/焦点 | 页面字号/高度差异 |
| Modal/Sheet | `aria-labelledby`、焦点陷阱、背景 inert、关闭行为 | 现有开合动画/断点 |
| Toast | live region、错误/成功/撤销语义 | 现有位置/时长 |
| Empty/Error/Skeleton | 结构、间距、重试、role | 页面文案/CTA |
| BookCover | `library`/`display` 变体命名、alt、占位、失败 | 2:3/5:7 两种比例 |
| Sidebar row/facet | `aria-current`、`aria-controls`、触屏 44 | Finder 四级字阶、滚动/焦点保护 |
| Focus/Danger/Error token | 单一焦点蓝、危险/错误拆分 | 现有页面结构 |
| z-index | 统一层级 token | 现有玻璃/浮层几何 |

### 3.2 应保留特例

| 特例 | 原因 |
|---|---|
| 首页 hero/黑横幅/产品卡/画廊/dotnav | Apple 展示页识别度；已验证 1:1 |
| 书架沉浸式三栏/密度/Finder 侧栏/底部搜索胶囊 | Tomo/Finder 工作台核心；用户明确要求 |
| 书架手机横屏 932 抽屉 | 不占书封列宽，已验证 |
| 榜单 980 内宽/瓦片节奏 | 页面识别度 |
| 统计深色 hero/水印/图表色 | 页面识别度 |
| 分类管理双列/折叠/行操作 | 管理密度 |
| 心得 Markdown/等宽编辑器 | 阅读/写作需求 |
| 登录独立卡片/无 chrome | 账号页独立入口 |
| Glass Lab 内联样式/假数据 | 开发验证页 |
| 2:3 与 5:7 两种封面比例 | 书架 vs 展示的不同语义 |

## 4. 设计规范文件目录

```text
docs/design/
├── README.md                     # 索引、基线、证据优先级、边界
├── 01-principles.md              # 设计原则、视觉定位、不可变约束
├── 02-tokens.md                  # 全局/局部/运行时 token、治理
├── 03-typography.md              # 字体栈、字阶、字重、截断
├── 04-color.md                   # 颜色语义、状态、对比度、theme-color
├── 05-spacing-radius.md          # 间距、圆角、封面圆角
├── 06-surfaces-liquid-glass.md   # 表面层级、玻璃参数、边界、降级
├── 07-icons.md                   # 图标尺寸、描边、字形、无障碍
├── 08-motion.md                  # 时长、缓动、交互配方、减弱动态
├── 09-responsive.md              # 断点、布局、安全区、触屏
├── 10-components.md              # 组件状态矩阵、交互/移动端/无障碍
├── 11-pages.md                   # 每个页面的设计契约
├── 12-acceptance.md              # 视觉/交互/无障碍验收
├── 13-ui-lab.md                  # UI Lab 扩展方案
├── 14-audit-report.md            # 本报告
├── 15-component-inventory.md     # 组件全量清单
└── 16-phase2-plan.md             # 第二阶段批次、优先级、风险
```

## 5. 第二阶段优先规范组件及理由

| 顺序 | 组件/项 | 理由 |
|---:|---|---|
| 1 | Modal/Sheet/Inspector 外壳 | 焦点/语义/关闭行为是最大可访问性风险，所有页面共用 |
| 2 | Focus/State token | 两套焦点蓝、选中语义不完整；影响所有控件 |
| 3 | Button/IconButton | 使用频率最高；尺寸/加载/触屏不一致 |
| 4 | Select | 已有完整 primitive，只差推广和 label，投入小收益大 |
| 5 | Toast/反馈 | 只有一套实现但没有 live region，影响所有异步操作 |
| 6 | Empty/Error/Skeleton | 6 套空状态、3 套骨架；状态一致性差 |
| 7 | Shelf Sidebar/row/facet | 高频、保护行为多；必须只改语义/样式，不碰滚动/焦点/草稿 |
| 8 | BookCover | 跨页面识别度；比例/阴影/圆角漂移 |
| 9 | Page header/hero | 7 套 hero；但强行统一风险高，排在后面 |
| 10 | Stats/Rank/Notes 视觉 | 页面特例多，优先度低于通用组件 |

详细批次见 `16-phase2-plan.md`。

## 6. 验证结果、未验证事项与风险

### 6.1 已验证

| 项 | 结果 |
|---|---|
| 基线提交 | `690bb18582ba9c6245619751d48a8d8abf5b2427` |
| 工作区 | 本阶段只新增 `docs/design/` 文档；运行时文件未改 |
| 全量测试 | **587 tests / 587 pass / 0 fail**（`node scripts/test.js`，两次运行约 27–31s） |
| `check:public` | **通过**：224 个文本文件检查，46 个二进制/大文件跳过 |
| UI 专项 | `test/ui-unification.test.js` 20 条全部通过 |
| 静态审计 | 15,000+ 行 CSS/JS/HTML 阅读；token 使用/未定义变量机械扫描；对比度计算；图标尺寸/描边计数 |
| 文档一致性 | 所有参数均指到源码行；未使用“现代化/高级感”等抽象描述 |

### 6.2 未验证

- **真实浏览器视觉回归**：本阶段没有改 UI，因此没有生成新的 before/after 截图；现有截图只来自历史报告。
- **Safari/iOS/Firefox 实机**：本机不可用；玻璃在那些内核只应显示 frost，未做新验证。
- **物理手机/软键盘**：未测刘海、软键盘顶起、触摸手势冲突。
- **屏幕阅读器**：未用 VoiceOver/TalkBack/NVDA 实测；A8–A13 是静态代码判断。
- **视觉对比自动化**：基线没有 Playwright/像素对比；本报告只提出方案。
- **信息架构/文案**：未做用户测试；页面顺序与文案按现有代码记录。
- **旧样式删除**：`.book-grid/.empty` 等只做了静态引用检索，未做运行时全路径确认；本阶段不删。

### 6.3 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 视觉改动被误认为“统一” | 字号/圆角/颜色/封面阴影任何变化都会改变现有观感 | B4 每项单独确认、截图、可回退 |
| 书架回归 | 滚动/焦点/草稿/异步顺序非常敏感 | 不改 JS 保护逻辑；改后跑专项测试与真机检查 |
| 玻璃性能/层数回归 | 新增折射面或大面板玻璃会拖慢/破坏可读性 | 先在 Glass Lab 验证；保持 14/10 上限与大面板近实体 |
| 对比度修复引发大面积视觉变化 | `--ink-3`/`#929399` 涉及大量小字 | 先限制新用法；加深需用户确认 |
| 测试耦合字符串 | `ui-unification` 断言依赖源码文本 | 只更新真实变化；新增行为测试；禁止放宽 |
| 无 Safari/Firefox 实测 | 可能只在 Chromium 正常 | 明确 frost 路径；不声称 full；记录未验证 |
| 资源版本遗漏 | 改 CSS/JS 后缓存不更新 | 按既有 `?v=` + `SHELL_ASSETS` + `CACHE_VERSION` 流程 |
| 页面特例被“统一”误伤 | 首页/书架/榜单/统计/笔记的识别度来自特例 | 以本报告第 3.2 节为白名单；改前确认 |

## 7. 第一阶段结论

Mybooks 已经有一套**可识别、可运行、可降级**的设计语言，不需要重新设计一套 UI。当前真正的问题是：

1. 参数没有集中登记，导致同一语义出现多个值；
2. 状态/无障碍语义不完整，尤其是弹窗、Toast、Select、选中态；
3. 同类组件在页面内重复，尤其是 hero、空状态、列表行、图标按钮；
4. 少数真实缺陷（`--line`、`--ink-1`、`theme-color`、对比度）被淹没在大量合理特例中。

因此第二阶段应按 **正确性 → 语义/无障碍 → 组件统一 → 视觉收敛** 的顺序推进，并以截图、键盘/触屏检查、全量测试和 `check:public` 作为门槛。任何以“更现代/更高级”为理由、但没有参数和证据的改动，都不应进入。
