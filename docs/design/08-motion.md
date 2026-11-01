# 08 · Motion

## 1. 动效原则

- 高频操作立即响应；管理界面的强制动画原则上不超过 300ms；
- 进入和退出尽量沿同一路径；浮层从触发源附近出现；
- 不做布局位移式入场；动画只改变透明度、transform、背景色、阴影；
- 不引入每帧 JavaScript 动画、弹簧物理、视差或无限装饰动画；
- 减弱动态时保留状态可辨识性，只去掉位移、缩放、级联和模糊变化；
- 首页画廊是展示型内容，允许 1000ms 滑动与 5000ms 轮播，属于明确例外。

## 2. 缓动 token

| Token | 值 | 用途 | 源码 |
|---|---|---|---|
| `--ease` | `cubic-bezier(.25,.1,.25,1)` | 常规过渡 | `style.css:42` |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 入场、位移、缩放 | `style.css:43` |
| Apple parity 曲线 | `cubic-bezier(.4,0,.6,1)` | 顶栏、菜单、搜索的固定节奏 | `style.css:140,219,359,1019` |
| 弹窗 pop | `var(--ease-out)`，380ms | 弹窗入场 | `style.css:2371-2379` |
| 书架位移 | `cubic-bezier(.22,1,.36,1)`，320ms | 三栏/抽屉 | `shelf-workbench.css:58,85,1208,1250` |

Apple parity 曲线不是“新 token”，而是已验证的页面特例。不要把它扩散到所有按钮。

## 3. 时长词汇

| 场景 | 时长/规格 | 源码 |
|---|---:|---|
| 按压反馈 | 120ms（transform） | `style.css:1431-1436,1490-1495`；`shelf-workbench.css:787-791` |
| 常规 hover | 150–200ms | `style.css:1489-1495,1591-1595,1783` |
| 顶部导航背景 | 279ms | `style.css:140` |
| 桌面导航面板高度 | 254ms | `style.css:762` |
| 导航切换高度 | 120ms | `style.css:765-767` |
| 导航内容入场 | 320ms；分组 +80ms；每项 +20ms | `style.css:829-855` |
| 导航内容退场 | 120–240ms，倒序 | `style.css:862-874`；`chrome.js:190` |
| 导航 hover intent | 100ms | `chrome.js:812-822` |
| 移动菜单高度 | 422ms；入场延迟 80ms，退场 120ms | `style.css:358-378` |
| 移动菜单条目 | 240ms + 200ms + 每项 20ms | `style.css:408-430` |
| 移动子菜单淡入 | 300ms | `style.css:457-471` |
| 搜索面板（手机） | 422ms | `style.css:1051-1059` |
| 搜索面板（桌面） | 240ms | `style.css:1321-1337` |
| 搜索输入 | 240ms，延迟 200ms | `style.css:1087,1094-1100` |
| 搜索标题/保存行 | 320ms，延迟 200/220ms + 20ms/项 | `style.css:1102-1117` |
| 搜索关闭锁 | 450ms；输入 blur 160ms | `overlay.js:355,374-376` |
| 弹窗遮罩淡入 | 300ms | `style.css:2356` |
| 弹窗卡片 pop | 380ms | `style.css:2371-2379` |
| 弹窗关闭 | 立即隐藏（无退出动画） | `modal.js:32-41` |
| Toast 入场 | 350ms | `style.css:3334-3340` |
| Toast 停留 | 2200ms；带操作 6000ms | `common.js:49` |
| 书架三栏列宽 | 320ms | `shelf-workbench.css:58` |
| 书架侧栏/Inspector | 320ms；透明度 280ms | `shelf-workbench.css:85,1208,1250` |
| 书架手机抽屉 | 320ms | `shelf-workbench.css:1250,1295` |
| 书架蒙层 | 280ms / 240ms | `shelf-workbench.css:133,1309` |
| 书架骨架延迟 | 180ms | `shelf/main.js:118,131-139` |
| 骨架 shimmer | 1.5s 循环 | `shelf-workbench.css:403-410` |
| 详情 Sheet 拖拽关闭 | 位移 > 80px；拖拽期间 transition:none | `book-details.js:757-779` |
| 详情内联编辑防抖 | `setTimeout(...,0)` | `book-details.js:685-687` |
| 书架滚动恢复 | 同步 + rAF + 80ms | `shelf/main.js:31-39` |
| 长按进入多选 | 500ms；移动 >12px 取消 | `shelf/main.js:760-776` |
| 框选激活 | 5px；边缘 34px；每帧最多 18px | `shelf/main.js:845-864,889` |
| 封面 hover | 400–450ms | `style.css:1878,3591,3653` |
| 图表增长 | 500ms | `style.css:2262,2319` |
| 首页轮播 | 5000ms/张；滑动 1000ms；dot 进度 4160ms | `endless-gallery.js:13-16`；`style.css:3766` |
| 首页 dot hover | 120ms | `style.css:3775` |
| 首页 dot 淡入淡出 | 480ms，40ms 级联 | `style.css:3776-3780` |
| Glass 材质过渡 | 200ms | `liquid-glass.css:28,51-56` |

## 4. 交互配方

### 4.1 按钮

- Default → Hover：背景/描边/阴影 180–200ms，颜色 200ms；
- Hover → Pressed：`transform: scale(.97)`，120ms；图标按钮 `.94`，书架圆钮 `.94`；
- Released：回到 hover（若仍悬停）或 default；
- Disabled：不播放过渡，直接降透明；
- Focus：立即出现 2px 描边，不延迟。

### 4.2 菜单/浮层

- 小菜单只做透明度，不做 transform（`.sel-menu` 的关键约束：transform 被 JS 用于视口校正，见 `style.css:1748-1754`）；
- 桌面导航面板做高度 + 透明度；内容分组错峰；
- 移动全屏菜单做高度增长 + 条目级联；关闭时条目不再淡出，由面板收起带出；
- 所有浮层必须支持 Escape；关闭后焦点回到触发源（菜单/详情/弹窗；搜索浮层目前没有焦点陷阱，见 `14-audit-report.md`）。

### 4.3 弹窗/Sheet

- 桌面弹窗：遮罩淡入 300ms + 卡片 pop 380ms；
- 关闭立即隐藏（`modal.js:32-41`），没有退出动画；如果第二阶段补退出动画，必须先解决“关闭时焦点归还”和“遮罩不叠加”的问题；
- 其他页面的详情抽屉：布局为手机底部 Sheet，但打开沿用 Modal 的 pop 380ms，不做独立底部滑入；拖拽关闭阈值 80px，仅非鼠标指针；
- 书架 Inspector：桌面从右侧推入，手机从底部推入；`transform` 320ms。

### 4.4 搜索

- 手机：面板从 48px 长到满屏，422ms；输入 28px；
- 桌面：面板从 44px 下方展开，240ms；
- 输入延迟 200ms 入场；保存行每项 +20ms；
- 关闭后 `search-closing` 锁 450ms，防止触摸穿透到“添加书籍”；
- 桌面自动聚焦延迟 30ms，仅在 `min-width:820px` 且非粗指针。

### 4.5 书架

- 侧栏/Inspector 使用 320ms 位移；透明度 280ms；
- 首屏 `sidebar-booting` 关闭过渡，避免恢复偏好时推动网格；
- 骨架延迟 180ms，快请求不闪骨架；
- 密度切换后重新 `ensureFill()`，不播放布局动画；
- 长按 500ms 进入多选；框选 5px 激活、34px 边缘自动滚动；
- 拖拽到分类时 `body.dragging-books`，只改变光标和行底色。

### 4.6 首页画廊

- 每 5000ms 切换；滑动 1000ms；
- dotnav 当前点展开为 32px 进度条，进度 4160ms；
- hover 120ms；淡入/淡出 480ms + 40ms 级联；
- 暂停/播放语义不变；不要为了“统一”改成短动画。

## 5. 减弱动态

基线有两层处理：

1. `style.css:4630-4635` 全局把 `animation-duration` / `transition-duration` 压到 `0.01ms !important`；
2. 局部显式关闭：
   - 玻璃：`liquid-glass.css:461-470`；
   - 搜索/导航：`style.css:980-992,1383-1395`；
   - 书架：`shelf-workbench.css:1456-1464`；
   - 骨架：`shelf-workbench.css:411-416`；
   - 画廊：`style.css:4485-4487`；
   - 表单 chevron：`style.css:5171-5173`；
   - Glass Lab：`glass-lab.html:148-151`。

规则：

- 减弱动态时保留状态变化（选中、展开、错误、加载），只去掉位移/缩放/级联/模糊变化；
- 不能把“减弱动态”当作移除玻璃或让状态不可辨识的理由；
- **JS 计时器目前不感知 reduced motion**：级联延迟、Toast 停留、自动聚焦、骨架延迟仍按原时间执行；这不影响可访问性，但第二阶段应至少在 UI Lab 中模拟并检查；
- 新增动画必须同时写 reduced-motion 分支。

## 6. 动效验收

- 所有 hover/pressed 在 120–200ms 内完成；
- 高频管理操作没有超过 300ms 的强制等待；
- 菜单/浮层关闭后焦点回到触发源（或明确的下一步）；
- 动画只作用于 opacity/transform/background/box-shadow，不触发布局抖动；
- 弹窗/侧栏/详情打开时不改变页面滚动位置；
- 减弱动态下无位移动画、无级联、无闪烁；
- 首页画廊时长、dotnav 几何、暂停语义保持不变；
- 没有新增无限循环动画（骨架和 dotnav 进度除外）。
