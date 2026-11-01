# 13 · UI Lab 扩展方案

本阶段只给方案，不新增页面。目标是把 `glass-lab.html` 从“玻璃材质验证页”扩展成“组件状态检查页”，同时保持它不依赖真实书库、不泄露私有数据。

## 1. 现状

`public/glass-lab.html` 已经具备：

- 强制档位 `?glass=full|frost|solid`；
- 高对比场景、移动色块、5 张假书封；
- 工具栏/悬浮控件/菜单仿真；
- 档位、折射面、滤镜、环境、降级策略读数；
- 1/5/10/20 个玻璃组件的压力测试与 FPS；
- `noindex,nofollow`，不进入导航，不注册 Service Worker。

它不覆盖：

- 真实组件状态（按钮 default/hover/pressed/disabled/focus）；
- 表单、下拉、弹窗、Toast、空/加载/错误；
- 书架卡片/列表/侧栏/Inspector；
- 响应式宽度切换；
- 键盘焦点/触控目标/对比度检查；
- 真实页面的内容长度与空状态。

证据：`public/glass-lab.html:154-248`；`liquid-glass.js:644-659`。

## 2. 推荐形态

**新增 `public/ui-lab.html`，不把组件测试塞进 `glass-lab.html`。**

理由：

- `glass-lab` 是材质/性能验证页，场景应保持高对比、可移动、可压测；
- 组件状态页需要大量静态 fixture 和不同宽度容器，混在一起会让玻璃场景失真；
- 两者可以互相链接：UI Lab 的“玻璃表面”章节跳到 Glass Lab 的对应档位；
- 两者都保持 `noindex`、不进入导航、不注册 SW、不读真实数据。

如果用户希望只保留一个页面，也可以在 `glass-lab` 增加 tab；但默认方案是独立页，避免把材质验证页变成组件大全。

## 3. 页面结构（提案）

```text
/ui-lab.html
├── Header: 版本、基线 SHA、当前档位、宽度选择、减弱动态开关
├── 01 Foundations
│   ├── Color swatches（含对比度读数）
│   ├── Type scale（标题/正文/辅助/数字）
│   ├── Spacing scale（可视化方块）
│   └── Radius scale（卡片/输入/菜单/胶囊）
├── 02 Controls
│   ├── Buttons: default / primary / ghost / danger / sm / disabled / loading
│   ├── Icon buttons: 22/30/32/44 / aria-pressed / expanded
│   ├── Segmented: 2/3/4 项 / selected / disabled
│   ├── Select: closed / open / selected / disabled / long options
│   ├── Field: text / textarea / number / date / error / disabled / required
│   ├── Chips / badges / status
│   └── Focus gallery: Tab 一遍所有控件
├── 03 Feedback
│   ├── Toast default / error / action
│   ├── Empty / filtered empty / error / skeleton
│   ├── Modal desktop + mobile sheet
│   └── Inline error / form error / retry
├── 04 Navigation
│   ├── Topbar fragment
│   ├── Brand menu
│   ├── Search overlay shell（仅 UI，不请求）
│   └── Mobile menu fragment
├── 05 Shelf
│   ├── Sidebar (全部/状态/藏书集/系列/作者/标签)
│   ├── Toolbar (brand/sort/view/layout)
│   ├── Card grid (短/长标题/无封面/选中)
│   ├── List/table (8 列/手机隐藏列)
│   ├── Inspector (单本/多选/加载/错误)
│   └── Bulk bar
├── 06 BookDetails
│   ├── Read-only
│   ├── Editable
│   ├── Long summary (折叠)
│   ├── Empty tags / many tags
│   ├── Files / no files
│   └── Loading / error
├── 07 Material
│   ├── Surface hierarchy
│   ├── Glass tier comparison
│   └── Link to /glass-lab.html
├── 08 Responsive
│   ├── Width switcher: 390 / 768 / 932×430 / 1024 / 1440
│   └── Iframe or container query previews
└── 09 A11y
    ├── Focus outline overlay
    ├── 44px hit-area overlay
    └── Contrast readout
```

## 4. Fixture 数据

- 全部使用静态对象：`{ title: '演示书名 …', author: '演示作者', status: 'reading', tags: [...] }`；
- 书名/作者明确标注“演示数据”；
- 不调用 `/api/*`、不读 `localStorage` 的真实书库数据、不读 cookie/token；
- 不包含真实封面 URL；使用本地 SVG/渐变占位；
- 不包含真实笔记、账号、设备信息；
- 不写数据库、不上传文件、不触发同步；
- 唯一允许的持久化是玻璃档位（与生产一致），且可在页面重置。

## 5. URL 参数

提案：

| 参数 | 值 | 作用 |
|---|---|---|
| `?section=` | `foundations` / `controls` / `feedback` / `navigation` / `shelf` / `details` / `material` / `responsive` / `a11y` | 直接定位章节 |
| `?width=` | `390` / `768` / `932` / `1024` / `1440` | 预览容器宽度 |
| `?glass=` | `full` / `frost` / `solid` | 复用现有 Glass Lab 开关 |
| `?motion=` | `on` / `reduce` | 预览减弱动态（仅 lab 容器，不改系统设置） |
| `?state=` | `default` / `hover` / `pressed` / `selected` / `disabled` / `loading` / `error` / `focus` | 高亮/固定某个状态 |
| `?screenshot=1` | `1` | 禁用动画、隐藏控制条，便于截图 |

参数只影响展示，不写回生产页面。

## 6. 状态展示要求

每个组件 fixture 必须：

- 同时展示至少 default/hover/pressed/focus；
- 对可用状态展示 selected/disabled/loading/error；
- 对触屏组件展示 44px 命中区；
- 对浮层展示打开/关闭；
- 对表单展示空/有值/错误；
- 对长内容展示截断/换行；
- 对玻璃组件分别展示 full/frost/solid；
- 对动效提供“播放/暂停/慢放 0.25×/减少动态”；
- 对键盘提供“Tab 顺序”高亮。

## 7. 实现约束

1. **复用生产 CSS/JS**：不复制组件样式，不另建一套“lab 按钮”；
2. lab 自身只写布局/说明/控制条样式，组件样式全部来自 `style.css`、`shelf-workbench.css`、`liquid-glass.css`、`login.css`；
3. 不修改生产 token 来适配 lab；
4. 不引用真实 API、不初始化数据库、不读认证；
5. 不注册 Service Worker、不进入 manifest/导航；
6. `noindex,nofollow`；
7. 页面加载不阻塞生产页面；独立文件，按需访问；
8. 若使用 iframe 做宽度预览，iframe 内仍是同一套页面/组件，不做第二套实现；
9. 所有假数据必须明确标记，不能伪装成真实书库；
10. 不把 lab 作为“设计系统完成”的替代——真实页面仍要按 `12-acceptance.md` 验收。

## 8. UI Lab 验收

- 每个登记组件都有 fixture；
- 每个组件的适用状态都可见；
- 390/768/932/1024/1440 宽度无溢出；
- full/frost/solid 三档可切换；
- 减少动态/透明度可模拟；
- 焦点可见、触控目标可叠加显示；
- 对比度读数与 `04-color.md` 一致；
- 页面不发起任何 API 请求；
- 页面源码中无真实书名/作者/账号/设备信息；
- 页面不出现在导航、sitemap、Service Worker shell 中。

## 9. 与 Glass Lab 的分工

| 页面 | 职责 | 不做什么 |
|---|---|---|
| `glass-lab.html` | 折射/磨砂/纯色真实性、性能、滤镜复用、场景压力 | 不展示完整业务组件 |
| `ui-lab.html`（提案） | 组件状态、响应式、无障碍、内容长度 | 不做真实玻璃性能结论 |
| 真实页面 | 最终验收 | 不用 lab 替代真实数据/真实交互 |

## 10. 第二阶段落地顺序

1. 先建 `ui-lab.html` 的 Foundations + Controls + Feedback；
2. 加 Shelf/BookDetails fixture；
3. 加响应式与无障碍叠加层；
4. 把每个新组件/修复都补一个 fixture；
5. 最后把 lab 纳入截图验收（但截图仍不提交仓库）。
