# 06 · Surface 与 Liquid Glass

## 1. 表面层级

| 层 | 材质 | 典型元素 | 规则 |
|---|---|---|---|
| L0 画布 | 冷白实色 `#f5f5f7` | body、书架、分类、统计 | 不模糊、不折射 |
| L1 内容面 | 白色实色 `#ffffff` | 卡片、面板、表格、正文 | 不模糊、不折射 |
| L2 次表面 | `#f2f2f5` / `#e8e8ed` | 封面占位、次级块 | 实色 |
| L3 近实体浮层 | 白色 96–98.5% + 10px blur | 侧栏、Inspector、弹窗 | 不做实时折射、不带 sheen/色散边 |
| L4 小玻璃 chrome | 白色 74–93% + 8–20px blur | 工具栏、按钮、菜单、触发器 | 允许实时折射（full 档） |
| L5 全屏覆盖 | 不透明 `#fafafc` | 移动菜单、搜索浮层展开、桌面导航下拉 | 优先可读性，不开透明度 |
| 遮罩 | 深色压暗，不叠加 blur | 弹窗、侧栏抽屉 | full/frost `.38`，solid `.48` |

## 2. Liquid Glass 参数

### 2.1 全局 token

| 参数 | 值 | 源码 |
|---|---:|---|
| tint | `255 255 255` | `liquid-glass.css:17` |
| opacity | `0.76` | `liquid-glass.css:18` |
| blur | `12px` | `liquid-glass.css:19` |
| saturation | `140%` | `liquid-glass.css:20` |
| refraction scale | `12` | `liquid-glass.css:21` |
| chroma | `0.06` | `liquid-glass.css:22` |
| rim light | `rgba(255,255,255,.4)` | `liquid-glass.css:23` |
| shadow | `0 8px 24px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.03)` | `liquid-glass.css:24` |
| duration | `200ms` | `liquid-glass.css:28` |
| chroma red/cyan | `rgba(255,80,120,.045)` / `rgba(70,210,255,.055)` | `liquid-glass.css:29-30` |

### 2.2 引擎几何

| 参数 | 值 | 源码 |
|---|---:|---|
| 折射面数量上限（桌面） | 14 | `liquid-glass.js:35` |
| 折射面数量上限（≤560px） | 10 | `liquid-glass.js:36,342,378-381` |
| 尺寸分桶 | 4px | `liquid-glass.js:122-124` |
| 圆角分桶 | 2px | `liquid-glass.js:135` |
| 边缘深度 | `min(w,h) * ratio`，ratio 0.16；`lg-bar` 0.14；限制 5–20px | `liquid-glass.js:128,394` |
| 折射 scale 上限 | CSS `--liquid-refraction: 12` 作为 `options.scale` 传入；实际 `scale = clamp(depth * 1.35, 5, maxScale)`，未设置 token 时默认上限 18，硬上限 32 | `liquid-glass.js:129-130,389-394` |
| 色散 | 默认 0.45；CSS token 为 0.06；三通道 ±12% | `liquid-glass.js:131,239-241` |
| 位移贴图外扩 | 10% | `liquid-glass.js:152-154` |
| 贴图上限 | 640×640 | `liquid-glass.js:155-158` |
| DPR | 限制 1–2 | `liquid-glass.js:155,348` |
| 滤镜复用键 | 几何 + DPR | `liquid-glass.js:142-145` |
| 重新平衡调度 | `setTimeout(..., 24)`，刻意不用 rAF | `liquid-glass.js:452-457` |

> 注意：CSS `--liquid-refraction: 12` 作为 `options.scale`（scale 上限）传入引擎；实际 scale 仍由 `depth * 1.35` 计算并被该上限钳制。未设置 token 时上限默认为 18，硬上限 32。它不是“12px 折射半径”，不要混用。

## 3. 档位检测与降级

| 条件 | 结果 | 源码 |
|---|---|---|
| 浏览器不支持 `backdrop-filter` | solid | `liquid-glass.js:89` |
| 用户模式 = solid | solid | `liquid-glass.js:90` |
| `prefers-reduced-transparency: reduce` | solid | `liquid-glass.js:91` |
| 用户模式 = frost | frost | `liquid-glass.js:92` |
| 用户模式 = full，但内核是 WebKit/Firefox 或 `url()` 不支持 | frost | `liquid-glass.js:93-96` |
| auto + `saveData` | frost | `liquid-glass.js:97` |
| auto + `deviceMemory ≤ 2` 或 `cores ≤ 2` | frost | `liquid-glass.js:98-99` |
| auto + 可折射 | full | `liquid-glass.js:100` |
| 用户模式 = auto 且不可折射 | frost | `liquid-glass.js:100` |

- 手动档位保存在 `localStorage['mybooks.glass.mode']`（`liquid-glass.js:32,321-333`）；
- `?glass=full|frost|solid` 优先于本地设置（`liquid-glass.js:321-325`）；
- 页面可用 `body[data-glass-auto="off"]` 禁用自动启动（`liquid-glass.js:709`）；
- `prefers-reduced-transparency` 与 `prefers-reduced-motion` 变化会重新评估环境（`liquid-glass.js:616-617`）；
- `solid` 档把 `--liquid-opacity` 覆盖为 0.97（`liquid-glass.css:40-42`），所有 `.lg-surface` 关闭 blur、去除 sheen。

## 4. 各表面参数

### 4.1 顶栏

| 项 | 值 |
|---|---|
| 常态 | 白色 78% + blur 20px + saturate 140%；refraction 8；chroma 0.06 |
| 阴影 | 内侧上高光 + 内侧下暗线 |
| 桌面展开搜索/导航 | 不透明 `#fafafc`，关闭 blur/sheen |
| 手机菜单/搜索展开 | 顶栏透明，品牌与图标淡出 |
| 证据 | `liquid-glass.css:119-168`；`style.css:131-141,659-687,1316-1330` |

### 4.2 大面板

| 面板 | 底色 | 模糊 | 饱和 | 特殊 |
|---|---|---|---|---|
| 侧栏 `.wb-side` | `rgb(247 248 250 / .96)` | 10px | 120% | 无 sheen/色散 |
| Inspector `.wb-inspector` | `rgb(255 255 255 / .96)` | 10px | 120% | 无 sheen/色散 |
| 弹窗 `.modal-box` | `rgb(255 255 255 / .985)` | 10px | 120% | 无 sheen/色散 |
| 证据 | `liquid-glass.css:170-201` | | | |

### 4.3 小菜单与浮层

| 表面 | 底色 | 模糊 | 说明 |
|---|---|---|---|
| `.wb-brand-menu` / `.wb-layout-menu` / `.sel-menu` / `.nav-flyout` | 白色 93% | 16px | 底更实，避免书封穿过文字 |
| 上述菜单且 `lg-refract` | 白色 92% | 12px | chroma 0.05 |
| 搜索浮层 | 白色 96% | 20px / 170% | 整屏优先可读性 |
| 登录账号卡 | 白色 82% | 18px / 140% | 独立页材质 |
| 书架浮层控件 | 白色 74% | 8px | brand / circle / search / view / sort |
| dotnav | 白色 48% | 12px / 135% | 低成本的磨砂 + 边缘，不做折射 |
| 证据 | `liquid-glass.css:203-221,272-344,385-418,420-446` | | |

### 4.4 遮罩

| 档位 | 弹窗遮罩 |
|---|---|
| full / frost | `rgba(20,20,24,.38)`，`backdrop-filter: none` |
| solid | `rgba(0,0,0,.48)`，`backdrop-filter: none` |
| 证据 | `liquid-glass.css:242-254` |

遮罩只压暗，不再叠加第二层 blur。原因是弹窗自身已有 blur，双层会形成雾化。

## 5. 表面所有权矩阵

| 表面 | 材质 | 是否允许折射 | 不应出现 |
|---|---|---|---|
| 顶栏 | 小玻璃 bar | 是（仅常态） | 大阴影、描边、常驻折射 |
| 桌面导航下拉 | 不透明 `#fafafc` | 否 | 透明/折射 |
| 移动全屏菜单 | 不透明 `#fafafc` | 否 | 透明、背景穿透 |
| 搜索浮层 | 近实体白 96% | 否 | 内容穿透、双重 blur |
| 弹窗 `modal-box` | 近实体白 98.5% | 否 | sheen、色散边、玻璃层叠 |
| 侧栏 | 近实体 `#f7f8fa` 96% | 否 | 折射、彩色边 |
| Inspector | 近实体白 96% | 否 | 折射、彩色边 |
| 书架工具栏/菜单 | 小玻璃 | 是 | 大面积折射、嵌套玻璃 |
| 书封 | 实体图 | 否 | backdrop-filter、玻璃覆盖 |
| 表格 | 实色白 + 表头轻磨砂 | 否 | 整表 blur |
| 详情 sticky 头 | 白 82–84% + 12px blur | 否 | 折射、色散 |
| dotnav | 轻磨砂 | 否 | 折射、扩大几何 |
| 登录卡 | 白 82% + 18px blur | 否 | 彩色背景 |
| 内容正文 | 无材质 | 否 | 任何透明/模糊 |

## 6. 使用边界（硬规则）

1. **真实折射只给小型 chrome 和菜单。**大面板、侧栏、Inspector、弹窗、搜索、登录卡一律不做实时折射。
2. **内容层永远实体。**书封、书名、作者、表格、卡片、图表、阅读正文不得加 blur/refraction。
3. **一个视觉结果只采样一次。**不允许嵌套折射、重复 `backdrop-filter`、隐藏 DOM 克隆或第二层遮罩 blur。
4. **大面板不带 sheen/色散边。**只有小玻璃控件使用 `--liquid-sheen` 与红/青边缘。
5. **展开态优先可读。**移动菜单、搜索浮层、桌面导航下拉展开时不透明；不要为了玻璃感让正文穿过。
6. **遮罩不模糊。**只压暗，避免与面板自身 blur 叠加。
7. **不做“为玻璃而玻璃”的渐变。**背景必须来自真实内容或已有页面场景；Glass Lab 的彩色场景只用于验证。
8. **降级必须诚实。**Safari/Firefox 只显示 frost，不伪造折射；无 backdrop 时 solid。
9. **减少动态/透明度必须生效。**`prefers-reduced-motion` 关闭玻璃过渡；`prefers-reduced-transparency` 回退近实色。
10. **新增玻璃表面必须先在 Glass Lab 验证。**验证项：边缘弯折、中心清晰、色散克制、滚动跟随、数量上限、solid/frost 可读性。

## 7. 已知的刻意例外

| 例外 | 原因 | 证据 |
|---|---|---|
| 顶栏关闭态从白 80% 改为 Liquid Glass | 用户明确要求；几何/时不变 | `docs/LIQUID-GLASS-UNIFICATION.md` |
| 展开态保持不透明 `#fafafc` | 可读性与 Apple parity | `style.css:705-710,1319`；`liquid-glass.css:145-168` |
| 移动全屏菜单不透明 | 可读性/性能 | `style.css:364-378` |
| dotnav 只加磨砂+边缘 | 几何/pause 语义已验证，不动 | `liquid-glass.css:385-418`；`docs/project-apple-gallery-parity` 记录 |
| 弹窗遮罩不 blur | 避免双重雾化 | `liquid-glass.css:242-248` |
| 书架完全隐藏顶栏/页脚 | 沉浸式工作台 | `shelf-workbench.css:27-28` |

## 8. Glass QA 清单

- [ ] Chrome/Edge 下 full：小控件边缘真实弯折，中心清晰，滚动跟手；
- [ ] Safari/Firefox 下 frost：有 blur/saturate/边缘高光，但没有背景形变；
- [ ] solid：无 blur、无折射、文字可读；
- [ ] 侧栏/Inspector/弹窗在 full 下仍是近实体，不是透明玻璃；
- [ ] 书封/表格/正文没有 backdrop-filter；
- [ ] 弹窗遮罩不叠加第二层 blur；
- [ ] 搜索/菜单展开时不透明，内容可读；
- [ ] 390 宽下折射面不超过 10 个；
- [ ] 减少动态时玻璃过渡关闭；
- [ ] 减少透明度时回退近实色；
- [ ] Glass Lab 的统计显示 `surfaces/refracting/filters` 与预期一致；
- [ ] 新增表面没有超过 14 个折射面（560px 以下 10 个）。
