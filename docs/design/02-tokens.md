# 02 · Global Design Tokens

本文件登记基线中实际存在的 token，并区分“已实现”“未使用”“仅兼容”“页面局部”“运行时写入”。所有数值以源码为准；没有写进 `:root` 的“规范值”会明确标注为 **【规范值·未落地】**。

## 1. Token 层级

| 层级 | 位置 | 作用 |
|---|---|---|
| 根原语 + 语义色 | `public/css/style.css:5-46` | 全站画布、表面、文字、Action Blue、状态色、圆角、阴影、字体、缓动 |
| 控件材质 token | `public/css/style.css:48-67` | 按钮 / 分段 / 下拉 / 图标按钮共享的中性玻璃材质 |
| 旧玻璃兼容别名 | `public/css/style.css:69-79` | 仍被旧组件引用的 `--glass-*`，值指向控件 token |
| Liquid Glass token | `public/css/liquid-glass.css:16-38` | 玻璃光学参数、边缘、阴影、时长 |
| 书架局部 token | `public/css/shelf-workbench.css:9-44` | 书架画布、面板、Finder 文字层级、密度 |
| 首页局部 token | `public/css/style.css:3474-3486,3741-3783` | 首页展示色、画廊尺寸、dotnav |
| 运行时变量 | JS / 内联样式 | 级联延迟、索引、滤镜 URL、图表百分比等 |

## 2. 根颜色 token

| Token | 值 | 语义 / 范围 | 源码 |
|---|---|---|---|
| `--paper` | `#f5f5f7` | 全站冷白画布（body 背景） | `style.css:6` |
| `--paper-2` | `#e8e8ed` | 次级表面、封面占位、分类计数底 | `style.css:7` |
| `--card` | `#ffffff` | 卡片、面板、弹窗内容面 | `style.css:8` |
| `--surface` | `#ffffff` | 输入框、内容表面 | `style.css:9` |
| `--surface-2` | `#f2f2f5` | 次级表面、封面占位、头像底 | `style.css:10` |
| `--canvas` | `#f5f5f7` | 页面画布别名；书架/分类等页面覆盖 body 背景 | `style.css:11,95-100` |
| `--ink` | `#1d1d1f` | 主文字、近黑表面 | `style.css:12` |
| `--ink-2` | `#6e6e73` | 次要文字、说明 | `style.css:13` |
| `--ink-3` | `#86868b` | 三级文字、日期、提示 | `style.css:14` |
| `--hairline` | `rgba(0,0,0,.12)` | 标准 1px 分隔线/描边 | `style.css:15` |
| `--hairline-soft` | `rgba(0,0,0,.08)` | 轻分隔线（面板、表单） | `style.css:16` |
| `--hairline-strong` | `rgba(0,0,0,.16)` | 强描边（虚线添加、表头） | `style.css:17` |
| `--accent` | `#0066cc` | Action Blue，唯一交互强调色 | `style.css:18` |
| `--accent-deep` | `#0066cc` | 当前与 accent 同值，供 hover 文本引用 | `style.css:19` |
| `--accent-soft` | `rgba(0,102,204,.12)` | 焦点光环、排行条、选中背景 | `style.css:20` |
| `--danger` | `#c0392b` | 破坏性操作（删除、移入回收站） | `style.css:21` |
| `--danger-soft` | `rgba(192,57,43,.08)` | 破坏性操作 hover 底 | `style.css:22` |
| `--star` | `#1d1d1f` | **占位，无样式引用**（评分系统已下线） | `style.css:23` |
| `--night` | `#1d1d1f` | 深色表面/深色文字 | `style.css:24` |
| `--night-2` | `#272729` | 统计 hero、深色瓦片 | `style.css:25` |
| `--night-text` | `#f5f5f7` | 深色表面主文字 | `style.css:26` |
| `--night-sub` | `#86868b` | 深色表面次文字 | `style.css:27` |
| `--wish` | `#6e6e73` | 状态“未读” | `style.css:28` |
| `--reading` | `#0066cc` | 状态“在读” | `style.css:29` |
| `--done` | `#1d1d1f` | 状态“已读” | `style.css:30` |

补充：错误文案还使用了 `#e30000`（`.form-error`、`.toast.error`、`.notes-error`、`.scan-status-err`），它**不是** `--danger`。这是基线中的语义分裂，见 `04-color.md` 与 `14-audit-report.md`。

## 3. 圆角 token

| Token | 值 | 预期用途 | 实际使用 |
|---|---:|---|---|
| `--radius-xs` | 6px | 小内嵌元素 | **未使用** |
| `--radius-sm` | 10px | 小控件/内嵌行 | `.wb-action`、`.cat-op`、`.modal` 家族局部 |
| `--radius-md` | 14px | 菜单、浮层 | `.sel-menu`、`.bd-pop` |
| `--radius-lg` | 20px | 大卡片、统计 hero、桌面弹窗 | `.panel`、`.stats-hero`、`.modal-box` |
| `--radius-xl` | 24px | Sheet、Dialog、大容器 | 书架面板、详情抽屉、登录卡片、弹窗 |
| `--radius-pill` | 999px | 胶囊控件 | `.btn`、`.tag-chip`、`.sel-trigger`、分段轨道 |
| `--radius` | 18px | 通用卡片 | `.cat-col`、`.detail-notes`、笔记编辑框 |

**注意：** 书架三栏面板当前使用 `var(--radius-xl, 24px)`，即 **24px**，不是历史报告里的 22px。`--radius` 与 `--radius-lg` 语义重叠，是第二阶段命名整理对象。

## 4. 阴影 token

| Token | 值 | 用途 | 源码 |
|---|---|---|---|
| `--shadow-card` | `none` | 全站卡片默认无阴影 | `style.css:38` |
| `--shadow-card-hover` | `none` | 卡片 hover 仍无阴影；**未使用** | `style.css:39` |
| `--shadow-pop` | `0 24px 70px rgba(0,0,0,.2)` | 弹窗浮层 | `style.css:40` |
| `--cover-shadow` | `3px 5px 30px rgba(0,0,0,.22)` | 书封“产品图”投影 | `style.css:41` |

**现状提醒：** `--cover-shadow` 只覆盖首页、榜单、心得等旧封面；书架 `.wb-card-cover` 使用 `0 1px 2px` / hover `0 10px 24px`，列表封面使用 `0 4px 10px`，详情封面使用 `0 3px 10px`，多选叠封使用 `0 5px 14px`。这是封面阴影漂移，登记在 `14-audit-report.md`，本阶段不改。

## 5. 字体与缓动 token

| Token | 值 | 说明 | 源码 |
|---|---|---|---|
| `--sans` | `system-ui, -apple-system, "SF Pro Text", "SF Pro SC", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | UI/正文默认 | `style.css:45` |
| `--serif` | `system-ui, -apple-system, "SF Pro Display", "SF Pro SC", ...` | **名字叫 serif，实际仍是 system sans**；旧组件标题使用 | `style.css:44` |
| `--ease` | `cubic-bezier(.25,.1,.25,1)` | 常规过渡 | `style.css:42` |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 入场/位移 | `style.css:43` |
| `--nav-h` | `56px` | 历史导航高度；**未使用**（顶栏实际 44/48px） | `style.css:46` |

首页另有 `--ent-display` / `--ent-text`（`style.css:3782-3783`），与 `--sans` 基本同栈，仅排序不同。

## 6. 控件材质 token

| Token | 值 | 用途 | 源码 |
|---|---|---|---|
| `--control-bg` | `rgba(255,255,255,.66)` | 按钮/分段/下拉/图标按钮常态 | `style.css:51` |
| `--control-bg-hover` | `rgba(255,255,255,.82)` | hover | `style.css:52` |
| `--control-bg-pressed` | `rgba(255,255,255,.9)` | pressed | `style.css:53` |
| `--control-ink` | `var(--ink)` | 控件主文字 | `style.css:54` |
| `--control-ink-muted` | `var(--ink-2)` | 控件次文字 | `style.css:55` |
| `--control-edge` | `rgba(0,0,0,.07)` | 控件描边 | `style.css:56` |
| `--control-edge-hover` | `rgba(0,0,0,.12)` | hover 描边 | `style.css:57` |
| `--control-highlight` | `inset 0 1px 0 rgba(255,255,255,.6)` | 顶部高光 | `style.css:58` |
| `--control-shadow` | `0 1px 2px rgba(0,0,0,.03), 0 3px 10px rgba(0,0,0,.035)` | 常态投影 | `style.css:59` |
| `--control-shadow-hover` | `0 1px 3px rgba(0,0,0,.04), 0 6px 16px rgba(0,0,0,.05)` | hover 投影 | `style.css:60` |
| `--control-blur` | `10px` | 控件背景模糊 | `style.css:61` |
| `--control-track` | `rgba(0,0,0,.035)` | 分段轨道 | `style.css:62` |
| `--selected-bg` | `rgba(255,255,255,.9)` | 选中滑块/展开态 | `style.css:63` |
| `--selected-edge` | `rgba(0,0,0,.1)` | 选中描边 | `style.css:64` |
| `--selected-marker` | `var(--ink-2)` | **未使用** | `style.css:65` |
| `--selected-shadow` | `inset 0 1px 0 rgba(255,255,255,.82), 0 1px 2px rgba(0,0,0,.04)` | 选中滑块投影 | `style.css:66` |
| `--control-sheen` | `linear-gradient(145deg, ...)` | 控件表面薄光 | `style.css:67` |

兼容别名（`--glass-fill`、`--glass-fill-hover`、`--glass-edge`、`--glass-edge-hover`、`--glass-spec`、`--glass-lift`、`--glass-lift-hover`、`--glass-spec-hover`、`--glass-text`、`--glass-sheen`）定义在 `style.css:69-79`。仍被 `.notes-retry`、`.has-notes`、`.log-del` 等旧组件引用。**不得再新增 `--glass-*` 引用**，新组件使用 `--control-*`。

## 7. Liquid Glass token

| Token | 值 | 说明 | 源码 |
|---|---|---|---|
| `--liquid-tint` | `255 255 255` | RGB 通道 | `liquid-glass.css:17` |
| `--liquid-opacity` | `0.76` | 通用玻璃底色不透明度 | `liquid-glass.css:18` |
| `--liquid-blur` | `12px` | 通用模糊 | `liquid-glass.css:19` |
| `--liquid-saturation` | `140%` | 饱和度 | `liquid-glass.css:20` |
| `--liquid-refraction` | `12` | 传给引擎的折射 scale 默认值 | `liquid-glass.css:21` |
| `--liquid-chroma` | `0.06` | 传给引擎的色散强度 | `liquid-glass.css:22` |
| `--liquid-rim-light` | `rgba(255,255,255,.4)` | 边缘亮边 | `liquid-glass.css:23` |
| `--liquid-shadow` | `0 8px 24px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.03)` | 玻璃投影 | `liquid-glass.css:24` |
| `--liquid-shadow-soft` | `0 5px 16px rgba(0,0,0,.05)` | 轻投影 | `liquid-glass.css:25` |
| `--liquid-shadow-hover` | `0 8px 22px rgba(0,0,0,.07)` | hover 投影 | `liquid-glass.css:26` |
| `--liquid-radius` | `18px` | **未使用** | `liquid-glass.css:27` |
| `--liquid-duration` | `200ms` | 材质过渡 | `liquid-glass.css:28` |
| `--liquid-chroma-red` | `rgba(255,80,120,.045)` | 左侧色散 | `liquid-glass.css:29` |
| `--liquid-chroma-cyan` | `rgba(70,210,255,.055)` | 右侧色散 | `liquid-glass.css:30` |
| `--liquid-edge` | `rgba(0,0,0,.07)` | 边缘 | `liquid-glass.css:31` |
| `--liquid-edge-strong` | `rgba(0,0,0,.12)` | **未使用** | `liquid-glass.css:32` |
| `--liquid-sheen` | `linear-gradient(150deg, ...)` | 玻璃表面薄光 | `liquid-glass.css:33-37` |

`solid` 档把 `--liquid-opacity` 覆盖为 `0.97`（`liquid-glass.css:40-42`）。各组件还会在局部覆盖 `--lg-opacity`、`--lg-blur`、`--liquid-refraction`、`--liquid-chroma`，例如顶栏 0.78/20px（`liquid-glass.css:120-134`），书架浮层控件 0.74/8px（`liquid-glass.css:287-313`），小菜单 0.92/12px（`liquid-glass.css:333-344`）。

## 8. 书架局部 token

| Token | 值 | 说明 | 源码 |
|---|---|---|---|
| `--wb-canvas` | `var(--canvas, #f5f5f7)` | 书架画布 | `shelf-workbench.css:10` |
| `--wb-panel` | `var(--surface-2, #f2f2f5)` | 面板基础，随后被具体面板覆盖 | `shelf-workbench.css:11` |
| `--wb-panel-raised` | `rgba(255,255,255,.76)` | **未使用** | `shelf-workbench.css:12` |
| `--wb-ink` | `var(--ink, #1d1d1f)` | 主文字 | `shelf-workbench.css:13` |
| `--wb-muted` | `var(--ink-2, #6e6e73)` | 次文字 | `shelf-workbench.css:14` |
| `--wb-tertiary` | `var(--ink-3, #86868b)` | 三级文字 | `shelf-workbench.css:15` |
| `--wb-hairline` | `var(--hairline, rgba(0,0,0,.12))` | 描边 | `shelf-workbench.css:16` |
| `--wb-hairline-strong` | `var(--hairline-strong, rgba(0,0,0,.16))` | 强描边 | `shelf-workbench.css:17` |
| `--wb-hover` | `rgba(0,0,0,.045)` | 行/列表 hover | `shelf-workbench.css:18` |
| `--wb-selected` | `rgba(0,0,0,.08)` | 列表选中 | `shelf-workbench.css:19` |
| `--wb-card-radius` | `8px` | 书架封面圆角 | `shelf-workbench.css:20` |
| `--wb-card-min` | `180px` / 140 / 210 | **未被网格使用**（网格用 `--wb-card-width`） | `shelf-workbench.css:31-44` |
| `--wb-card-width` | `180px` / 140 / 210 | 封面固定宽度 | `shelf-workbench.css:32-44` |
| `--wb-grid-gap` | `20px` / 14 / 24 | 网格间距 | `shelf-workbench.css:33-44` |

具体面板覆盖：侧栏 `#f7f8fa`、Inspector `#ffffff`（`shelf-workbench.css:87-88`）；Inspector 内部把 `--wb-muted` 提到 `#55555a`、`--wb-tertiary` 提到 `#6e6e73`（`shelf-workbench.css:934-937`）。

## 9. 首页局部 token

`main.page-home` 定义 `--home-bg`、`--home-surface`、`--home-text`、`--home-sub`、`--home-link`、`--home-dark`、`--home-dark-text`、`--home-dark-sub`（`style.css:3474-3482`）。其中 `--home-surface`、`--home-text`、`--home-sub` **未被使用**。

`.home-ent` 定义 Apple 画廊尺寸与 dotnav 参数（`style.css:3741-3783`）：

| Token | 值 |
|---|---|
| `--media-gallery-tile-gap` | `13px` |
| `--media-gallery-slide-duration` | `1000ms` |
| `--media-gallery-tile-width` | 默认 `688px`；≥1069 `min(930px, 100vw-120px)`；≥1441 `min(1250px, 100vw-180px)`；≤1068 `min(688px, 100vw-96px)`；≤734 `min(275px, 100vw-60px)` |
| `--fam-tile-width` | 默认 `188px`；≥1069 `417px`；≥1441 `470px` |
| `--sk-dotnav-size` | `8px` |
| `--sk-dotnav-scrim-height` | `34px` |
| `--sk-dotnav-timed-track-width` | `32px` |
| `--sk-dotnav-timed-duration` | `4160ms` |
| `--sk-dotnav-background` | `rgba(29,29,31,.32)` |
| `--sk-dotnav-background-current` | `rgba(29,29,31,.68)` |

这些是首页 Apple parity 的固定参数，不能为了“统一”改成通用圆角/时长。

## 10. 运行时写入的变量

这些 token 没有在 CSS 根部静态定义，而是由 JS 或内联样式写入。它们是合法的，不应被误判为“未定义变量”。

| 变量 | 写入者 | 用途 | 证据 |
|---|---|---|---|
| `--mm-i` | `chrome.js` | 移动菜单逐项级联索引 | `style.css:424-430`；`chrome.js:183` |
| `--nav-group-delay` | `chrome.js` | 桌面导航分组延迟 | `style.css:830-854`；`chrome.js:183` |
| `--nav-item-i` | `chrome.js` | 桌面导航项级联索引 | `style.css:853-854`；`chrome.js:183` |
| `--nav-exit-dur` | `chrome.js` | 关闭时每项退出时长 | `style.css:872`；`chrome.js:190` |
| `--i` | `overlay.js` | 搜索保存项级联索引 | `style.css:1115-1116`；`overlay.js:283` |
| `--lg-filter` | `liquid-glass.js` | 注入 `url(#...)` 折射滤镜 | `liquid-glass.css:74`；`liquid-glass.js:421` |
| `--sk-dotnav-count` | `endless-gallery.js` | dotnav 宽度按点数预留 | `style.css:4119` |
| `--tile-fg` / `--tile-sub` / `--tile-scrim` / `--tile-link` | `page-home.js` / `cover.js` | 首页卡片由封面取色决定的文字/薄纱/链接色 | `style.css:3571-3578,3615-3639,4638-4639` |
| `--card-scrim` / `--card-soft` | `page-home.js` | 小卡薄纱/次文字 | `style.css:3995,4054-4082` |
| `--wb-card-width` / `--wb-grid-gap` | `shelf/main.js` | 密度切换写入 | `shelf-workbench.css:32-44` |

## 11. 已确认的 token 债务

| 问题 | 证据 | 影响 | 处理阶段 |
|---|---|---|---|
| `--line` 未定义 | `style.css:3128`（`.notes-editor` 边框）、`style.css:4841`（`.import-opt select` 边框） | 整条 `border` 声明失效，控件可能无边框 | P0（修复前先截图确认） |
| `--ink-1` 未定义 | `style.css:2580`（`.douban-candidate` 文字） | 回退为继承色，与预期 `--ink` 不一致 | P0 |
| `--radius` 与 `--radius-lg`/`--radius-xl` 语义重叠 | `style.css:31-37` | 18/20/24 三个“大圆角”混用 | P1 |
| `--serif` 名为 serif，实为 system sans | `style.css:44-45` | 新旧标题字体族命名误导 | P1（只改名/别名，不改视觉） |
| `--star` 等无用 token | `style.css:23,31,39,46,65,70-79` | 读音/维护噪音 | P2 |
| `--wb-card-min` 未被使用 | `shelf-workbench.css:31-44` | 密度配置出现“第二来源” | P1 |
| `--liquid-radius` / `--liquid-edge-strong` 未使用 | `liquid-glass.css:27,32` | 清理候选 | P2 |
| 兼容 `--glass-*` 仍有引用 | `style.css:3230,3243-3246,3301-3307,3441-3452` | 两套材质来源 | P2 |
| `--home-surface` 等未使用 | `style.css:3476-3478` | 首页局部 token 冗余 | P3 |

## 12. 使用规则

1. 新组件只使用 `--control-*`、`--ink-*`、`--hairline-*`、`--radius-*`、`--accent`、`--danger`、`--surface*`、`--canvas`、`--ease*`，不再新增 `--glass-*` 引用。
2. 页面局部 token 必须挂在页面作用域（`body[data-page="shelf"]`、`main.page-home`、`.home-ent`）下，不得写进 `:root` 污染全站。
3. 不允许用同一个 token 名表示两种语义（例如 `--radius` 同时表示“通用卡片”和“大容器”）。
4. 不允许在页面内写死一个与全局 token 同义的颜色；确需页面专属（如书架 Finder 灰阶）时，必须放进页面局部 token 并在 `04-color.md` 登记。
5. 新增运行时变量必须在 JS 注释中说明写入者、读取者、生命周期，并登记到本文件第 10 节。
6. token 改名必须保留至少一个版本的兼容别名，并同步更新 `test/ui-unification.test.js` 中受影响的断言（只更新断言名称/目标，不降低约束）。
