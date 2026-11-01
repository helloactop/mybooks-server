# 01 · 设计原则与视觉定位

## 1. 视觉定位

Mybooks 不是内容营销站，也不是通用后台。它同时承担两种任务：

1. **展示**：首页、榜单、统计、心得阅读页，用大标题、书封和留白让书成为主角；
2. **管理**：书架、分类管理、账号与设备，用稳定的栅格、列表、侧栏和详情面板处理高密度信息。

因此它的视觉定位是：

> **冷白、克制的 Apple 式展示语言 + Tomo/Apple Books 式的封面工作台 + Finder 式的层级侧栏。**
> 玻璃只服务导航和浮层，不进入书封、文字、表格和正文。

这不是抽象口号，基线中对应的是：

- 冷白画布 `--canvas: #f5f5f7`、白色内容面 `--surface: #ffffff`、近黑文字 `--ink: #1d1d1f`（`public/css/style.css:5-30`）；
- 正文 17px、系统 SF/PingFang 字体栈（`public/css/style.css:44-45,85-93`）；
- 1px 发丝线分层，卡片默认无阴影（`public/css/style.css:15-17,38-41`）；
- 书架三栏 232px / 自适应 / 332px、8px 外边距、24px 面板圆角（`public/css/shelf-workbench.css:46-69`；`--radius-xl: 24px`，见 `02-tokens.md`）；
- 书架密度 140 / 180 / 210px 封面宽（`public/css/shelf-workbench.css:30-44`）；
- Liquid Glass 只在工具栏、菜单、侧栏、Inspector、弹窗等表面出现（`public/css/liquid-glass.css:170-318`）。

## 2. 八条原则

### 2.1 内容优先，玻璃后退

- 书封、书名、作者、表格、统计图表、阅读正文始终使用实体表面或透明背景；
- 玻璃只出现在需要与背景保持空间关系的 chrome / overlay 上；
- 大面板（侧栏、Inspector、弹窗）接近实体，只有约 10px 模糊，不带 sheen/色散边；
- 这是 2026-10-31 第三轮视觉修正的明确方向：内容成为视觉中心，玻璃退后。

证据：`public/css/liquid-glass.css:170-248`；`docs/liquid-glass-visual-pass3/README.md`。

### 2.2 单一强调色，选中态中性

- Action Blue `#0066cc` 是唯一交互强调色（链接、主按钮文字、选中勾、状态“在读”）；
- 选中态是中性亮玻璃滑块 + 深色文字，不使用黑/蓝实底；
- 蓝色只用于键盘焦点 `:focus-visible`、链接和主操作文字；
- 禁止为了“让玻璃更明显”新增彩色渐变背景或彩色选中环。

证据：`public/css/style.css:18-20,63-66,1460-1466,1794-1801`；`test/ui-unification.test.js:44-56`。

### 2.3 结构稳定，材质局部变化

- 导航、页面顺序、书架三栏、Inspector 位置、搜索路径不因材质或动效改动而变化；
- 页面首屏不为“更炫的入场”改变布局；侧栏首帧预留宽度，避免 CLS（`public/css/shelf-workbench.css:64-69`）；
- 材质和动效的差异应收敛到 token 与公共组件，而不是复制业务页面。

### 2.4 诚实的材质降级

- **full**：Chromium 中使用 SVG `feDisplacementMap` 的真实折射；
- **frost**：只做 blur + saturate + 边缘高光，明确没有背景形变；
- **solid**：无 backdrop、低性能、减少透明度时使用近实色；
- 不得用克隆背景、假折射或“看起来像玻璃”的透明层冒充 full。

证据：`public/js/liquid-glass.js:49-101`；`public/css/liquid-glass.css:40-117`。

### 2.5 安静的 chrome，精确的层级

- 顶栏常态是半透明白 + saturate(180%) blur(20px)，无描边、无阴影（`public/css/style.css:131-141`）；
- 导航项没有“选中药丸”，只有颜色变化（`public/css/style.css:196-229`）；
- 书架侧栏用字号/字重/颜色/行高建立 Finder 四级层级，而不是给每一级加卡片（`public/css/shelf-workbench.css:174-254`）；
- 发丝线优先于阴影；全站卡片阴影为 `none`，封面是唯一允许明显投影的“产品图”元素。

### 2.6 高频操作要快，慢动作只给展示

- 按压反馈 120ms、hover 150–200ms、弹窗/侧栏 240–320ms；
- 首页画廊是展示型内容，允许 1000ms 滑动与 5000ms 轮播（`public/js/endless-gallery.js:13-16`）；
- 高频管理操作不使用超过 300ms 的强制等待；不引入弹簧物理或每帧 JavaScript 动画。

### 2.7 键盘、触屏、鼠标是同一套语义

- 所有图标按钮有 `aria-label`；仅图标不能承担破坏性操作的唯一说明；
- 键盘焦点必须可见；鼠标/触屏点按不留下默认蓝框（`public/css/style.css:111-129`）；
- 触屏上主要命中区按 44×44px 处理（`public/css/shelf-workbench.css:1344-1364`；`public/css/style.css:3086-3101`）；
- 浮层必须有 Escape 路径；模态框必须能 Tab 循环并归还焦点（`public/js/modal.js:20-69`）。

### 2.8 高密度但不拥挤

- 书架使用固定封面宽度 + 可配置间距，而不是拉伸卡片；
- 文字行高、区块间距、分组间距以“可扫读”为先；
- 不用大面积装饰留白挤压管理信息，也不把每个设置项都做成悬浮卡片。

## 3. 允许的页面特例

以下差异是已确认的页面特例，不是不一致：

| 特例 | 范围 | 证据 |
|---|---|---|
| 沉浸式书架 | `/shelf` 隐藏全局顶栏/页脚，使用左上 My books 菜单 | `public/css/shelf-workbench.css:27-28`；`public/shelf.html:30-47` |
| 三档密度 | 书架 140 / 180 / 210px，固定封面宽 | `public/css/shelf-workbench.css:30-44` |
| Finder 侧栏 | 书架侧栏使用局部 `#62646c/#35363b/#929399` 层级，不套全站 `--ink-*` | `public/css/shelf-workbench.css:174-254`；`test/ui-unification.test.js:94-121` |
| 手机横屏抽屉 | 932×430 等横屏使用资料库/Inspector 抽屉，不占书封列宽 | `public/css/shelf-workbench.css:1366-1445` |
| 首页 Apple 画廊 | 734 / 1068 / 1441 断点、dotnav 8px 几何、5000ms 轮播 | `public/css/style.css:3737-4487` |
| 首页 CTA 尺寸 | 只在首页放大按钮，材质/状态沿用全站 `.btn` | `public/css/style.css:3529-3530` |
| 登录页独立卡片 | 无全局顶栏/页脚，独立 760px 卡片与 560 断点 | `public/login.html`；`public/css/login.css` |
| 心得 Markdown 正文 | 使用 15px/1.6 的阅读排版与等宽编辑器 | `public/css/style.css:3121-3133,3248-3298` |
| 统计深色 hero | `#272729` 瓦片 + 200px“书”水印 | `public/css/style.css:2082-2146` |
| 榜单瓦片节奏 | 980px 内宽、80px 段距、发丝线行 | `public/css/style.css:4641-4738` |
| Glass Lab 内部样式 | 开发验证页，允许页面内联样式与假数据 | `public/glass-lab.html:12-152` |

## 4. 明确禁止的做法

- 把书封、表格、正文包进 `backdrop-filter`；
- 给侧栏、Inspector、弹窗增加实时折射或更大的色散；
- 用彩色渐变、彩色阴影、蓝色实底选中来“增强设计感”；
- 在页面内复制一套按钮/下拉/弹窗；
- 改变已确认的导航顺序、书架布局、图书显示顺序或筛选语义；
- 为了让测试通过而修改断言或删除测试；
- 引入新的断点、圆角、字号、颜色，却不记录来源和适用范围；
- 用“现代化”“简洁”“高级感”“苹果风格”作为改动理由而不给参数和证据。

## 5. 设计决策的最小证据包

任何 UI 改动在评审时必须带：

1. 改动前后的页面/组件截图（同视口、同数据、同字体）；
2. 受影响的 token 与源码位置；
3. 桌面、平板、手机、横屏的最低检查结果；
4. 键盘、触屏、减弱动态的检查结果；
5. 玻璃档位与降级结果（若涉及材质）；
6. 全量测试与 `test/ui-unification.test.js` 结果。
