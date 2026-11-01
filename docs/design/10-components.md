# 10 · Components 目录与状态

## 1. 组件规则

1. **先找现有组件，再动手。** 同一类操作（按钮、下拉、弹窗、空状态）不得在页面内复制实现。
2. **状态必须完整。** 新增/修改组件至少覆盖 Default、Hover、Pressed、Selected、Disabled、Loading、Error、Focus 中适用的状态；不适用时在文档里写“不适用”，不能默默缺失。
3. **状态不能只靠颜色。** 选中/展开/禁用同时提供结构或语义（`aria-pressed`、`aria-expanded`、`disabled`、文案）。
4. **动效只改变 opacity / transform / background / box-shadow**，不触发布局。
5. **触屏命中区 44×44px**；桌面紧凑图标按钮也必须能通过内边距或真实尺寸达到 44px 命中。
6. **组件样式只引用 token 或页面局部 token**，不新增同义硬编码。
7. **页面特例必须登记**（见 `01-principles.md` 第 3 节），不得以“统一”为名改掉已验证的结构。

## 2. 状态定义

| 状态 | 判定 | 视觉要求 |
|---|---|---|
| Default | 无交互 | 中性玻璃/实色，文字对比可读 |
| Hover | 指针悬停 | 提亮/加深背景或描边，不位移整片控件 |
| Pressed | 按下 | 轻微缩放或更深底，松手恢复 |
| Selected | 当前值/选中项 | 中性亮玻璃滑块 + 深色文字；不用黑/蓝实底 |
| Disabled | 不可操作 | 降透明、禁止指针/键盘；保留可读形状 |
| Loading | 请求中 | 骨架/文案/禁用按钮；不能显示旧数据为“已更新” |
| Error | 失败 | 红色文字 + 明确重试/下一步；不能只变色 |
| Focus | 键盘焦点 | 2px Action Blue/焦点蓝描边，偏移 2px；鼠标点按不显示 |

## 3. 核心组件状态矩阵（C01–C13）

| ID | 组件 | Default | Hover | Pressed | Selected | Disabled | Loading | Error | Focus |
|---|---|---|---|---|---|---|---|---|---|
| C01 | Button `.btn` | 中性玻璃 + 深色文字 | 提亮 + 描边/阴影加深 | `scale(.97)` + pressed 底 | 不适用（非切换控件） | `opacity:.45`，`pointer-events:none` | 未实现专用态；通常禁用按钮/换文案 | 不适用（用 `.form-error`） | 2px accent，offset 2 |
| C02 | IconButton `.icon-btn` / `.wb-circle` | 圆形中性玻璃 | 提亮 | `scale(.94)` | `aria-pressed/expanded` 亮玻璃 | `opacity:.45` | 未实现 | 不适用 | 2px accent |
| C03 | Segmented `.seg` | 透明按钮，轨道 `--control-track` | 轻玻璃底 | `scale(.97)` | `.active` 亮玻璃 + 600 | `opacity:.45` | 未实现 | 不适用 | 2px accent |
| C04 | Select `.sel` | 胶囊触发器 | 提亮 | pressed 底 | 选项 `.on` + 蓝勾 | 触发器 `.45` | 未实现 | 未实现 | 2px accent |
| C05 | FormField | 白底 12px 圆角 | 边框加深 | 不适用 | 不适用 | 原生 disabled | 未实现 | 文案 `.form-error`/`.bd-inline-error`，**未接 `aria-invalid`** | 边框 accent + 3px ring |
| C06 | Chip/Badge/Status | 胶囊/文本 | 链接/标签可提亮 | 不适用 | 不适用（筛选由行 `.is-active` 承担） | 不适用 | 不适用 | 状态用文字 + 色 | 全局焦点 |
| C07 | BookCover | 封面图/渐变占位 | 旧卡片抬升；书架 -2px | 不适用 | 书架 `scale(1.014)` + 阴影 + 勾选 | 不适用 | 无（骨架在卡片外） | `img error` → 渐变占位 | 由卡片承担 |
| C08 | Modal `.modal` | 遮罩 + 卡片 | 不适用 | 不适用 | 不适用 | 不适用 | 内容自行处理 | 内容自行处理 | Tab 陷阱 + 归还焦点 |
| C09 | BookDetails | 展示优先 | 行内编辑入口提亮 | 按钮缩放 | 状态分段 `.active` | 只读模式隐藏编辑 | 预览骨架 `role=status` | 错误 + 重试 `role=alert` | 行内输入/按钮焦点保护 |
| C10 | Toast `.toast` | 近黑胶囊 | 操作按钮提亮 | 操作按钮按下 | 不适用 | 不适用 | 不适用 | `.error` 红底白字 | 操作按钮全局焦点 |
| C11 | EmptyState | 居中图标/文案/CTA | CTA 按钮 | CTA 按钮 | 不适用 | 不适用 | 用 Skeleton | 用独立 ErrorState | CTA 焦点 |
| C12 | Skeleton | 灰阶 shimmer | 不适用 | 不适用 | 不适用 | 不适用 | 仅 Loading | 不适用 | 不适用 |
| C13 | ErrorState | 红色/深色文案 + 重试 | 重试按钮 | 重试按钮 | 不适用 | 不适用 | 不适用 | 仅 Error | 重试按钮焦点 |

## 4. 核心组件交互与适配（C01–C13）

| ID | 动效 | 键盘 | 触屏 | 移动端 | 无障碍 |
|---|---|---|---|---|---|
| C01 | 颜色 200ms；缩放 120ms | 原生 `button`/`a`；Enter/Space | 最小 38px（`.btn-sm` 34px，低于 44，债务） | 表单底栏右对齐；登录 CTA 全宽 | 主操作/次操作/危险操作靠文字区分；无 spinner；`disabled` 用原生属性 |
| C02 | 颜色 200ms；`scale(.94)` | 原生按钮；Enter/Space | 顶栏 48、书架 44；`.cat-op` 仍 30（债务） | 顶栏图标 48×48；书架圆钮 44 | 必须 `aria-label`；展开用 `aria-expanded`；选中用 `aria-pressed` |
| C03 | 颜色 180ms；缩放 120ms | 仅 Tab/Enter；**无方向键** | 书架 view 44；layout 36；表单 36 | 视图切换在 ≤370 隐藏排序，不隐藏视图 | `role=group`；选中仅 `.active`，**未提供 aria-pressed/tab 语义** |
| C04 | 菜单淡入 180ms；箭头 240ms；选项 150ms | ↑↓ Home End Enter Space Esc Tab；打开时只允许一个 | 书架排序 44；菜单最大 320px 高 | 视口校正 12px；菜单可横向平移 | trigger `aria-haspopup/expanded`；menu `listbox`；option `option/aria-selected`；原生 select 被 `aria-hidden`，字段 label 未转移（债务） |
| C05 | 边框/背景 200ms | 原生输入；Tab 顺序 | 44px 高、17px 字；详情触屏 16px | 表单单列；ISBN 行改两列 | `<label for>`；必填有 `required`；错误未 `aria-invalid`/`aria-describedby` |
| C06 | 背景/颜色 200ms | 链接/按钮原生 | 标签 min-height 32；行内标签 24–28 | 标签换行，不横向滚动 | 状态颜色必须有文字；装饰徽章不抢焦点 |
| C07 | hover 400–450ms；书架 240ms | 由卡片/链接承担 | 书架卡片长按；列表点击 | 2:3 书架封面 / 5:7 展示封面 | `img alt="书名 封面"`（`cover.js:41`）；占位封面用文字；封面本身不是焦点 |
| C08 | 遮罩 300ms + pop 380ms；关闭立即隐藏 | Esc、Tab 循环、焦点归还 | 背景点击关闭；滚动锁定 | 竖屏 84svh；横屏 92svh；书籍表单全屏 | `role=dialog aria-modal`；部分弹窗缺 `aria-labelledby`；背景未 `inert` |
| C09 | 摘要/箭头 200ms；Inspector 320ms；其他页详情抽屉随 Modal 380ms；拖拽阈值 80px | Enter 提交、Esc 取消/关闭；Tab 顺序 | 触屏拖拽关闭；输入 16px；动作 46px | 移动 sticky 头、简介 3 行 | 关闭/标签删除有 aria-label；内联错误 `role=alert`；Inspector 无焦点陷阱 |
| C10 | 入场 350ms；停留 2200/6000ms | 操作按钮可 Tab/Enter | 底部安全区偏移 | 书架/多选时上移 | **无 `role=status`/`aria-live`**，屏幕阅读器不播报 |
| C11 | 无 | CTA 原生 | CTA 可点 | padding 随页面 | 书架空状态无 `role=status`；错误状态有 `role=alert` |
| C12 | shimmer 1.5s；减弱动态关闭 | 不适用 | 不适用 | 书架 12 卡骨架；详情 4 行 | 书架骨架 `aria-hidden`；详情骨架 `role=status aria-label` |
| C13 | 无 | 重试按钮 | 重试按钮 | 同页面 | `role=alert`（书架/详情）；表单错误仅为文本 |

## 5. 书架组件状态矩阵（C14–C21）

| ID | 组件 | Default | Hover | Pressed | Selected | Disabled | Loading | Error | Focus |
|---|---|---|---|---|---|---|---|---|---|
| C14 | Sidebar row `.wb-row` | 透明，14/450 | `--wb-hover` | 不适用 | `.is-active` `#e9e9ec` + 600 | 不适用 | 侧栏骨架 | `.wb-side-status` + 重试 | 全局 2px |
| C15 | Sidebar section/facet | 标题 + 行 + 更多 | 标题/行提亮 | 不适用 | 当前 facet 值 `.is-active` | 不适用 | 搜索中/加载中 | `.wb-facet-note` / 状态条 | 全局 2px |
| C16 | Shelf toolbar | 中性玻璃圆钮/胶囊 | 提亮 | `scale(.94)` | `aria-pressed/expanded` / `.active` | 无 | 无 | 无 | 2px accent |
| C17 | Shelf card `.wb-card` | 纯封面 | -2px + 阴影 | 不适用 | `scale(1.014)` + overlay + check | 不适用 | 骨架 | 封面失败占位 | 2px outline |
| C18 | Shelf list/table | 行 | `--wb-hover` | 不适用 | `.is-selected` | 不适用 | 无 | 无 | 行内 2px 上下线 / 2px outline |
| C19 | Inspector | 空/多选/单本 | 动作按钮 | 按钮缩放 | 单选/多选 | 只读时不出现 | 预览骨架 | 错误 + 重试 | 书架/详情焦点策略 |
| C20 | Bulk bar | 隐藏 | 按钮 | 按钮 | 选中数量 | 无选中时按钮 disabled | 无 | 无 | 按钮焦点 |
| C21 | Shelf search pill/close | 胶囊 / 圆钮 | 提亮 | pressed | `has-query` | 无 | 无 | 无 | 2px accent |

## 6. 书架组件交互与适配（C14–C21）

| ID | 动效 | 键盘 | 触屏 | 移动端 | 无障碍 |
|---|---|---|---|---|---|
| C14 | 背景 150ms | Enter/Space；行内重命名表单 | 44px 行高；操作按钮 44 | 抽屉 280px；行操作常显 | 行是 button；操作按钮有 aria-label；选中用 `.is-active`，未提供 `aria-current` |
| C15 | 折叠箭头 200ms；列表滚动 0ms | Enter 展开/收起；筛选输入 | 44px 筛选/更多 | 抽屉内滚动；展开高度 42dvh | `aria-expanded`；无 `aria-controls`；焦点/滚动恢复由 JS 保护 |
| C16 | 颜色 180ms；缩放 120/140ms | Enter/Space；菜单 Escape | 44px 圆钮/排序 | 隐藏视图切换；顶部右移 | 图标按钮 aria-label；菜单 `aria-expanded`；玻璃档位用 `role=group` |
| C17 | 240ms；hover 仅 `hover:hover` | roving tabindex；方向键/Home/End/Shift/Ctrl；Enter/Space | 长按 500ms；无 hover 位移 | 标准 2 列/紧凑 3 列 | `role=listbox` + `role=option` + `aria-selected`；卡片 aria-label 含书名/作者；触摸无拖拽 |
| C18 | 背景 150ms；排序 | 表头可 Tab/Enter/Space；行 roving | 行 78px；无拖拽 | 手机隐藏第 3/4/6/7 列；改用移动列表 | 表头 `aria-sort`；行 `aria-selected`；表格 `aria-label` |
| C19 | 320ms 位移；详情 200ms | Esc 关闭；详情内 Enter/Esc | 底部 Sheet 拖拽；动作 46px | ≤819 底部 Sheet；≤1180 浮层 | `aria-pressed` 开关；详情关闭按钮 aria-label；无焦点陷阱 |
| C20 | 无；位置避开 toast | 按钮 Tab | 触屏可点 | 底部 58–66px 偏移 | `role=region aria-label=批量操作`；数量文本 |
| C21 | 颜色 180ms | Enter/Space；Esc 关闭搜索 | 44px | 手机宽度 190–220px；隐藏 kbd | 搜索按钮 aria-label 随查询变化；关闭按钮独立 aria-label |

## 7. 页面级组件状态矩阵（C22–C28）

| ID | 组件 | 主要状态 | 关键源码 |
|---|---|---|---|
| C22 | Login/Account | 未初始化 / 未登录 / 已登录；请求中按钮 disabled；错误写入 `#accountStatus`；当前设备标记；撤销需确认 | `public/login.html`；`public/css/login.css:84-309`；`public/js/login.js:90-172` |
| C23 | Stats hero/panels/charts | 有数据 / 空（`.chart-empty`）；面板折叠/展开；柱状图 hover 提亮；无 loading 骨架 | `public/css/style.css:2082-2345`；`public/js/page-stats.js` |
| C24 | Rank hero/list | 有数据 / 空（`.rank-empty`）；行 hover/pressed/focus；无 loading 骨架 | `public/css/style.css:4641-4738`；`public/js/page-rank.js` |
| C25 | Category rows/modals | 行 hover/focus-within；操作按钮 hover；弹窗打开/关闭；保存中 disabled；错误 `#fieldError/#mergeError`；合并目标搜索 250ms | `public/css/style.css:4740-4948`；`public/js/page-tags.js` |
| C26 | Notes page | loading / empty / error + retry / display / edit；保存 409 冲突确认；保存 toast；正文 Markdown | `public/css/style.css:3109-3298`；`public/js/page-notes.js` |
| C27 | Book form special blocks | ISBN 批量（输入/结果/错误/手动录入）；豆瓣候选（加载/候选/失败）；电子书文件（有/无/删除）；扫码（相机/手动/错误）；标识符行 | `public/css/style.css:2492-2590,4915-5057`；`public/js/scanner.js` |
| C28 | Glass Lab | tier auto/full/frost/solid；场景位移/旋转；菜单；压力 1/5/10/20；FPS；只读统计 | `public/glass-lab.html`；`public/js/liquid-glass.js` |

### 7.1 页面级组件交互与适配（C22–C28）

| ID | 动效 | 键盘 | 触屏 | 移动端 | 无障碍 |
|---|---|---|---|---|---|
| C22 Login/Account | 无页面动效；按钮沿用 200ms/120ms | 原生表单 Tab/Enter；设备撤销可 Tab | 撤销按钮 ≤560 全宽 44px | 单列卡片；身份块换行 | `#accountStatus role=status aria-live=polite`；表单有 label；请求中 disabled |
| C23 Stats | 柱/条 500ms；面板折叠 220ms | 折叠按钮 Enter/Space；标题行可点 | 标题行/按钮可点 | hero 2/3/5 列；面板 1/2 列 | 折叠有 `aria-expanded`；图表缺文本替代（债务） |
| C24 Rank | 行 active `scale(.98)` 150ms；无独立 hover 底色 | 行 Enter/Space 打开详情 | 行可点 | ≤640 padding 48/20；≤480 标题 28px | 行有 aria-label；空榜有文案 |
| C25 Tags | hover 150ms；折叠 220ms | 行操作按钮 Tab/Enter；弹窗焦点陷阱 | `.cat-op` 30px（债务） | 双列→单列；删除元信息隐藏 | 行操作 aria-label；弹窗名称缺失（债务） |
| C26 Notes | 无页面动效；保存 toast | 返回/编辑/保存/取消原生按钮；编辑器 Tab | 按钮可点；文本域可缩放 | ≤559.98 内边距/封面缩小 | 状态文案；编辑器缺 label（债务） |
| C27 Book form special | 弹窗 380ms；扫码无额外动画 | 输入/下拉/按钮；扫码 Esc 关闭 | 44px 输入；手机 ISBN 两列 | 表单全屏；豆瓣候选 40dvh 滚动；扫码相机 | 输入有 label；扫码状态 `role` 有限；错误文案可见 |
| C28 Glass Lab | 档位切换即时；场景位移 80ms；压力测试 2s | 菜单按钮 Tab/Enter/Esc | 拖动手柄 pointer 事件 | ≤720 压缩布局 | 模式提示 `role=status`；假控件需 aria-label；仅开发页 |

## 8. 重点组件契约

### 8.1 C01 Button

- **用途**：表单保存/取消、详情动作、标签管理、首页 CTA、登录。
- **变体**：`.btn` 默认、`.btn-primary`（中性玻璃 + 蓝字/蓝细边）、`.btn-ghost`（更浅底）、`.btn-danger-tint`（浅红底/红字）、`.btn-sm`（13px/34px）。
- **尺寸**：默认 `min-height:38px`、`padding:9px 18px`、14px/600；小按钮 34px/13px；表单底栏 15px/10px 22px；首页 CTA 16px/46px。
- **状态**：见矩阵。注意 `.btn:disabled` 使用 `pointer-events:none`，鼠标不会触发 hover；键盘也不会聚焦。
- **动效**：颜色 200ms；缩放 120ms。
- **键盘/触屏**：原生 button/a；Enter/Space；触屏主操作建议 ≥44px（当前默认 38px 是债务，`.bd-actions .btn` 在触屏 46px）。
- **移动端**：登录 CTA 全宽；表单底栏右对齐；首页 CTA 可换行。
- **无障碍**：主/次/危险靠文字而非仅颜色；加载中必须禁用并保持可读文案；不要用 `<div>` 模拟按钮。
- **源码**：`style.css:1466-1571,4821`；`login.css:130-134`；`style.css:3529-3530`。

### 8.2 C03 Segmented

- **用途**：阅读状态、书架视图/密度/玻璃档位、统计周期（历史/未来）、表单状态。
- **尺寸**：轨道 `padding:3px` + `gap:2px`；表单按钮 36px；书架 view 28px（触屏 44）；layout 27px（触屏 36）。
- **状态**：`.active` 使用 `--selected-bg` + `--selected-edge` + `--selected-shadow`；未选中透明；hover 轻玻璃底；pressed scale .97。
- **键盘**：目前只有 Tab + Enter/Space；没有方向键/roving tabindex。第二阶段若升级为 tabs，必须补 `role=tablist/tab`、`aria-selected` 和方向键。
- **移动端**：书架视图切换 ≤819 隐藏；排序 ≤370 隐藏；密度/玻璃仍在视图设置菜单内。
- **无障碍**：`role=group` 有 `aria-label`；选中状态目前只有类名，屏幕阅读器无法得知；这是 P1 债务。
- **源码**：`style.css:1404-1458,2461-2468`；`shelf-workbench.css:642-661,815-843`；`shelf.html:60-67,78-101`。

### 8.3 C04 Select

- **用途**：排序、批量状态、合并目标、CSV 导入选项、自定义字段类型/多值。
- **结构**：原生 `<select>` 保留为数据源，视觉隐藏；`.sel-trigger` 是胶囊按钮；`.sel-menu` 是 `role=listbox`，选项是 `role=option` 的按钮。
- **状态**：触发器 default/hover/pressed/expanded；菜单打开时触发器用 `--selected-bg`；选项 hover/active 轻玻璃底，`.on` 亮玻璃 + 蓝勾。
- **动效**：菜单只淡入 180ms，不做 transform（JS 用 transform 做视口校正，`style.css:1748-1754`）；箭头旋转 240ms；选项背景 150ms。
- **键盘**：↑↓、Home/End、Enter/Space、Esc、Tab 全部实现；打开时关闭其他下拉。
- **触屏**：菜单会被平移回视口内，左右留 12px；书架排序触屏 44px。
- **移动端**：菜单 max-width `min(280px,80vw)`、max-height 320px；不显示滚动条但可滚动。
- **无障碍**：trigger 有 `aria-haspopup/expanded`；原生 select 被 `aria-hidden` 且 `tabindex=-1`，字段 `<label for>` 仍指向隐藏 select，trigger 没有继承 `aria-labelledby`，是 P1 债务。
- **源码**：`style.css:1645-1801`；`select.js:14-167`；`shelf-workbench.css:800-812`；`liquid-glass.css:280-283`。

### 8.4 C07 BookCover

- **用途**：所有书籍封面。不是普通卡片，是“产品图”。
- **两种正式比例**：
  - `library`：书架 2:3，8px 四角，固定宽 140/180/210；
  - `display`：首页/榜单/心得/详情 5:7，左 3–5px、右 8–16px 的非对称书脊圆角。
- **状态**：默认；旧卡片 hover 上移/缩放；书架 hover -2px、selected `scale(1.014)` + 阴影 + overlay/check；图片失败自动替换为渐变占位（`cover.js:56-63`）。
- **阴影**：`--cover-shadow` 只覆盖展示型封面；书架使用更轻的 `0 1px 2px` 与 hover `0 10px 24px`。这是已登记漂移，不在本阶段统一。
- **无障碍**：`img alt="书名 封面"`；占位封面显示书名/作者；封面本身不进入 Tab 序，焦点由卡片/链接承担。
- **源码**：`cover.js:1-63`；`style.css:1871-1916,3582-3596,3646-3658,3948-3956,4018-4029,4700-4706`；`shelf-workbench.css:455-484`。

### 8.5 C08 Modal Shell

- **用途**：添加/编辑书籍、批量编辑、设置、字段/合并、ISBN 批量、语法帮助、详情抽屉。
- **结构**：`.modal`（遮罩）> `.modal-box` > `.modal-head` + 内容 + `.form-foot`。
- **状态**：打开时 `body.modal-open` 锁滚动；背景点击关闭；`[data-close]` 关闭；Tab 循环；关闭归还焦点。
- **动效**：遮罩 300ms、卡片 380ms；关闭没有退出动画（`modal.js:32-41`）。
- **键盘**：Esc 关闭（若 `.sel-menu` 打开则先让下拉处理）；Tab 在模态内循环；首焦点延迟 0ms。
- **触屏/移动**：桌面居中、竖屏 84svh、横屏 92svh 抽屉、书籍表单 ≤819 全屏。
- **无障碍**：`role=dialog aria-modal=true`；`#bookDetailModal` 有 `aria-label`；`#fieldModal/#mergeModal` 缺 `aria-labelledby`；背景未 `inert`。P1 债务。
- **源码**：`style.css:2347-2397,4510-4612,5064-5165`；`modal.js:1-76`；`chrome.js:554-593`；`tags.html:121-199`。

### 8.6 C09 BookDetails / Inspector / Sheet

- **用途**：书架 Inspector、其他页面详情抽屉、公开只读详情。
- **结构**：`.bd-scroll` > `.bd-head`（grabber + close）> `.bd-hero`（96px 封面 + 标题/作者）> 状态 > 书籍信息 > 简介 > 阅读记录 > 标签 > 分类 > 电子书 > 更多信息 > 动作。
- **尺寸**：封面 96px（≤390 84px）；标题 21px（移动 20/19）；行 36px（移动 38）；详情抽屉桌面 460px、手机 `max-height:min(88dvh,780px)`；Inspector 332px。
- **状态**：
  - 加载：预览骨架（`role=status`），只展示封面/标题/作者；
  - 错误：`role=alert` + 重试；
  - 只读：不渲染编辑动作，状态静态展示；
  - 内联编辑：评分/系列点击进入，Enter 提交、Esc 取消、失焦提交；保存中 `busy`，失焦提交被抑制；
  - 草稿/焦点：每次重渲染前捕获草稿，渲染后恢复焦点与滚动；
  - 简介：超过 140 字符才折叠；真实溢出检查后自动展开。
- **动效**：摘要/箭头 200ms；Inspector 320ms；其他页面详情抽屉随 Modal pop 380ms；拖拽阈值 80px；内联提交延迟 0ms。
- **键盘/触屏**：Enter/Esc；标签输入 Enter 添加；触屏可拖拽关闭；动作按钮 46px。
- **移动端**：sticky 头部白 82–84% + blur 12px；简介 3 行；动作主次分层，删除单独一行。
- **无障碍**：关闭/标签删除有 aria-label；内联错误 role=alert；状态分段只有 `.active`，没有 `aria-pressed`；Inspector 没有焦点陷阱。
- **源码**：`book-details.js:9-12,147-284,306-818`；`style.css:2614-3108`；`shelf-workbench.css:924-1037`；`inspector.js:25-67`。

### 8.7 C14 Shelf Sidebar

- **用途**：书架资料库：全部、状态、藏书集、虚拟书库、系列、作者、标签。
- **尺寸**：桌面 232px；移动抽屉 280px；行 36px（触屏 44）；分组标题 12.75/650；计数 12/400。
- **状态**：展开/收起分组；当前筛选行 `.is-active`；hover 行提亮；服务端 facet 搜索（250ms debounce）；“显示更多/收起”；内联新建/重命名；加载骨架；错误状态 + 重试。
- **保护**：滚动位置、展开状态、搜索焦点、选中范围、内联表单草稿在重渲染时恢复（`sidebar.js:93-162,326-357`）。
- **键盘/触屏**：Enter/Space；Esc 关闭内联表单；触屏操作按钮常显并 44px。
- **无障碍**：分组 `aria-expanded`；行是 button；操作有 aria-label；没有 `aria-controls`/`aria-current`。
- **源码**：`sidebar.js:17-19,301-430,617-647`；`shelf-workbench.css:112-355,1344-1364`。

### 8.8 C17 Shelf Card / Grid

- **用途**：书架主视图。
- **尺寸**：封面固定宽 140/180/210；2:3；8px 圆角；间距 14/20/24；桌面自动填充，手机标准 2 列/紧凑 3 列。
- **状态**：默认；hover -2px + 阴影（仅 `hover:hover`）；selected `scale(1.014)` + overlay + 勾选；focus 2px outline；长按进入多选（非鼠标）；桌面可拖到分类。
- **键盘**：每个列表一个 roving tabindex；方向键空间导航；Home/End；Shift 范围；Ctrl/⌘ 只移动焦点；Enter 打开 Inspector/批量编辑；Space 切换选择。
- **触屏**：长按 500ms，移动 >12px 取消；无 hover 位移；无拖拽。
- **移动端**：滚动容器 `overscroll-behavior:contain`；底部为浮动工具条留 100–112px。
- **无障碍**：`role=listbox` + `option` + `aria-selected`；卡片 `aria-label` 含书名/作者；封面 alt 由 cover.js 提供；框选只在鼠标桌面启用。
- **源码**：`shelf.html:121-151`；`grid.js:15-20`；`main.js:661-738,760-910`；`shelf-workbench.css:357-586,1232-1341`。

## 9. 统一 / 保留判断

| 组件 | 判断 | 原因 |
|---|---|---|
| Button / IconButton | **统一** | 视觉材质已收敛到 control token，但尺寸/加载态/触屏命中仍需统一 |
| Segmented | **统一** | 5 处实现共享 `.seg`，但缺选中语义与键盘方向键 |
| Select | **统一并推广** | 已有完整 primitive，但只有 3/7 个页面下拉接入 |
| FormField | **统一** | 输入样式分三套（`.field`、`login.css`、`.bd-*`），应在保留尺寸差异的前提下共享状态 |
| Modal / Sheet | **统一外壳** | 关闭动画、焦点陷阱、`aria-labelledby`、背景 inert 应统一 |
| Toast | **统一并补无障碍** | 只有一套实现，但没有 live region |
| Empty / Error / Skeleton | **统一状态模型，保留内容插槽** | 6 种空状态可以共用结构，但文案/CTA 按页面定制 |
| BookCover | **统一变体命名，不统一数值** | 书架 2:3 与展示 5:7 都是有效变体；统一的是命名、alt、占位、状态 |
| Page Header / Hero | **保留特例** | 首页/榜单/统计/分类/笔记/登录的 hero 语义不同，强行统一会改变已验证布局 |
| Topbar / MobileMenu | **保留 Apple parity 几何** | 只允许修无障碍/焦点，不改高度、级联、展开态 |
| Home Gallery / Dotnav | **保留特例** | 已验证的 1:1 几何与时长，不改 |
| Shelf Layout / Density | **保留特例** | 沉浸式三栏、三档密度、1180/932 语义不能动 |
| Stats dark hero / Rank tiles | **保留特例** | 页面识别度来自深色瓦片/瓦片节奏 |
| Notes markdown / editor | **保留特例** | 阅读排版与等宽编辑器是内容需求 |
| Login card | **保留特例** | 独立页，无全站 chrome；只统一表单状态与按钮 |
| Glass Lab | **保留开发页特例** | 允许内联样式与假数据，不进入生产组件库 |
