# 07 · Icons

## 1. 现状

图标系统已经统一到 **Lucide**（ISC）。

- 图标源：`lucide-static@1.70.0`，只通过本地生成物进入页面，不加载远端 CDN。
- 生成物：`public/vendor/lucide-sprite.svg`，仅包含 `scripts/lucide-icons.json` 登记的图标。
- 生成脚本：`scripts/build-icons.mjs`；校验命令 `npm run check:icons`。
- 运行时：`public/js/icon.js` 提供 `icon(name, size, stroke, cls)`，输出
  `<svg class="icon"><use href="/vendor/lucide-sprite.svg?v=1#name"></use></svg>`。
- 颜色：图标统一继承 `currentColor`；描边宽度由调用处按尺寸传入，避免整站被迫使用 2px 粗线。
- 静态 HTML：直接写同样的 `<svg class="icon">…<use …></use></svg>` 标记，不引入运行时扫描。

以下图形**保留自定义实现**，不纳入 Lucide：

| 图形 | 原因 | 位置 |
|---|---|---|
| 顶栏汉堡 → ✕ 变形 | Apple 同款 SMIL 路径动画，Lucide 没有等价动效 | `public/js/chrome.js` |
| 首页画廊播放 / 暂停 | 实心 Apple 产品位图形，尺寸基于 56 viewBox | `public/js/page-home.js` |
| 下拉三角 / 品牌小箭头 | 9×5、10×6、8×5 的扁平几何，换成方形 Lucide 箭头会改变视觉重量 | `public/js/select.js`、`public/js/common.js`、`public/js/chrome.js`、`public/js/book-details.js`、`public/js/shelf/sidebar.js` |
| 评分星形 | 数据标记，不是操作图标 | `public/js/base.js` |
| 品牌位图 | `logo-mark.png`、`logo.png`、公安备案图标 | `public/*.html` |
| Glass Lab 假图标 | 材质实验页的占位字形，不进入生产 UI | `public/glass-lab.html` |

旧的图标来源记录（内联 SVG / Unicode / 品牌位图）已由本次迁移取代；下面保留新的尺寸、使用和验收规则。

## 2. 尺寸与描边

Lucide 的坐标是 24 viewBox；页面渲染大小时，**视觉描边 = 传入的 stroke-width × 渲染尺寸 ÷ 24**。
因此不能把 24px 图标的 `stroke-width` 直接套到 16px 图标上。

| 角色 | 渲染尺寸 | `stroke-width` | 视觉描边 | 典型用途 |
|---|---:|---:|---:|---|
| 紧凑 | 12 | 2.8 | ≈1.4 | 标签胶囊移除、选中勾 |
| 行内 | 14 | 2.4 | ≈1.4 | 分类行操作、保存搜索操作、电子书删除 |
| 默认 UI | 16 | 2 | ≈1.33 | 关闭、分类操作、详情操作 |
| 顶栏 | 18 | 2.4 | ≈1.8 | 搜索、添加书籍 |
| 登录头像 | 20 | 1.5 | ≈1.25 | 账号身份图标 |
| 大图标 | 24 | 1.6 | ≈1.6 | 搜索输入框放大镜 |
| 空状态 | 32 | 1.5 | ≈2.0 | 书库空状态、错误状态 |

书架工具栏的 15px 图标（网格/列表/视图设置/添加）是既有尺寸，保留为**已登记例外**；新组件不再新增 15px。

## 3. 使用方式

动态模板：

```js
${icon('search', 18, 2.4)}
${icon('x', 16, 2)}
${icon('check', 12, 3)}
```

静态 HTML：

```html
<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">
  <use href="/vendor/lucide-sprite.svg?v=1#x"></use>
</svg>
```

规则：

1. 只使用 `icon()` 或上面的静态标记，不在业务文件里手写图标 path；
2. `stroke` 按第 2 节的角色传入，不靠 CSS 统一改写；
3. 图标是装饰，统一 `aria-hidden="true"`；可访问名称由图标按钮的 `aria-label` 承担；
4. 颜色只用 `currentColor`，不写十六进制、不写 `fill`（Lucide 内部需要实心的细节保留在源文件中）；
5. 图标按钮自己负责命中区与 hover/pressed/focus-visible/disabled 状态，图标本身不承担点击；
6. 文字按钮内图标与文字的间距由 `.btn` 的 `gap: 6px` 或对应组件的 flex gap 控制，不加 `margin`。

## 4. Unicode 与 emoji

以下高频字形已迁移到 Lucide：

| 旧字形 | Lucide | 典型位置 |
|---|---|---|
| `✕` | `x` | 弹窗关闭、分类删除、搜索清空、标签移除 |
| `✎` | `pencil` | 分类重命名、保存搜索重命名 |
| `⇄` | `arrow-left-right` | 分类合并 |
| `＋` | `plus` / `square-plus` | 新建字段、添加标识符、顶栏添加书籍 |
| `↺` | `rotate-ccw` | 回收站恢复、字段恢复 |
| `🗑` | `trash-2` | 彻底删除 |
| `↓` | `download` | 电子书下载 |
| `◫` | `book-open` | 书库空状态 |
| `✓` | `check` | 选择勾选、多选勾选 |
| `↗` | `arrow-up-right` | 外链标识 |

仍然保留的文本符号：

- `★`：评分星形，属于数据展示；
- `…`：省略号文案，不是图标；
- Glass Lab 的 `⌕`、`⌄`、`☰`、`▦`、`☷`：只在材质实验页，不进入生产；
- 注释中的 `✕`、`↓`：仅说明动效/键盘行为。

**新组件不得新增 Unicode 图标或 emoji。** 需要图标时先查 `scripts/lucide-icons.json`，没有就按第 7 节添加。

## 5. 无障碍

- 纯装饰图标必须 `aria-hidden="true"`；
- 图标按钮必须有 `aria-label`，必要时加 `title`；
- 破坏性图标按钮（删除/移出/撤销）必须有可读的 `aria-label`，不能只有 `title`；
- 图标按钮的命中区不小于 44×44px（触屏）；桌面紧凑图标可以视觉 30–32px，但要有足够的内边距或真实 44px 命中区；
- 不依赖颜色区分图标状态；选中/展开同时用 `aria-pressed` / `aria-expanded`；
- 图标不能替代错误文案；错误要同时有文字。

## 6. 常见图标与调用

| 图标 | 调用 | 位置 |
|---|---|---|
| 搜索（顶栏） | `icon('search', 18, 2.4)` | `public/js/chrome.js` |
| 搜索（输入框） | `icon('search', 24, 1.6, 'search-field-icon')` | `public/js/chrome.js` |
| 搜索（书架胶囊） | `icon('search', 14, 2.4)` | `public/shelf.html` |
| 添加书籍（顶栏） | `icon('square-plus', 18, 2.4)` | `public/js/chrome.js` |
| 添加 | `icon('plus', 15, 2.2)`、`icon('plus', 14, 2.4)` | `public/shelf.html`、`public/tags.html`、`public/js/chrome.js` |
| 关闭 | `icon('x', 16, 2)` | 弹窗、详情、侧栏、扫码 |
| 胶囊移除 | `icon('x', 12, 2.8)` | `public/js/book-details.js`、`public/js/common.js` |
| 清空搜索 | `icon('circle-x', 16, 2)` | `public/js/chrome.js` |
| 高级搜索语法 | `icon('circle-help', 20, 1.7)` | `public/js/chrome.js` |
| 重命名 / 编辑 | `icon('pencil', 16, 2)`、`icon('pencil', 14, 2.4)` | 分类管理、保存搜索、书架资料库 |
| 合并 | `icon('arrow-left-right', 16, 2)` | 分类管理 |
| 恢复 | `icon('rotate-ccw', 16, 2)` | 回收站、字段恢复 |
| 彻底删除 | `icon('trash-2', 16, 2)` | 回收站、字段删除 |
| 下载 | `icon('download', 14, 2.2)` | 书籍详情电子书 |
| 外链 | `icon('arrow-up-right', 12, 2)` | 书籍详情 |
| 勾选 | `icon('check', 12, 3)` | 书架选中、下拉选中 |
| 网格 / 列表 | `icon('layout-grid', 16, 2)`、`icon('list', 16, 2)` | 书架视图切换 |
| 视图设置 | `icon('sliders-horizontal', 15, 2)` | 书架工具栏 |
| 侧栏 / 详情开关 | `icon('panel-left', 16, 1.8)`、`icon('panel-right', 16, 1.8)` | 书架 |
| 账号头像 | `icon('user-round', 20, 1.5)` | 登录页（静态标记） |
| 空状态 / 错误 | `book-open`、`circle-alert` 32/1.5 | 书架空状态、错误状态 |

## 7. 新增或更新图标

1. 在 `scripts/lucide-icons.json` 增加图标名（必须是 `lucide-static@1.70.0` 中存在的名字）；
2. 运行 `npm run icons`，提交 `public/vendor/lucide-sprite.svg` 与清单；
3. 在业务代码使用 `icon(...)` 或静态 `<use>`；
4. 运行 `npm run check:icons`；CI 会检查 sprite 是否漂移、代码引用的图标是否都在清单中；
5. sprite 内容变更时，把 `public/js/icon.js` 的 `ICON_SPRITE` 和静态标记里的 `?v=1` 一起递增，并同步 `public/sw.js` 的 `SHELL_ASSETS` 与 `CACHE_VERSION`；
6. 新增图标必须同时提供 `aria-hidden` 与按钮 `aria-label`；纯图标不能成为操作的唯一可访问名称。

## 8. 验收

- `npm run check:icons` 通过；
- 通用图标不再出现内联 path，Unicode/emoji 不再新增；
- 16px 图标的视觉描边约 1.3px，18px 顶栏约 1.8px；同一工具栏不混用 1.2 与 1.8；
- hover、pressed、focus-visible、disabled 状态在图标按钮上可见；
- 减弱动态下图标不参与位移/闪烁；
- 多视口截图检查图标居中、裁切与颜色继承。
