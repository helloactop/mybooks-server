# 16 · 第二阶段建议

## 1. 目标

在不改变页面结构、图书顺序、交互路径、书架密度、断点和 Liquid Glass 降级的前提下：

1. 把已经统一的材质/尺寸收敛到可复用 token；
2. 补齐键盘、触屏、焦点、状态语义；
3. 让同类组件只保留一套实现；
4. 把页面特例登记清楚，不再被“统一”误伤；
5. 建立 UI Lab 与截图验收，防止回归。

## 2. 不做

- 不重构前端框架；
- 不批量拆分 CSS 文件（只允许在现有文件内做小步提取）；
- 不重新设计业务页面；
- 不改变导航顺序、书架三栏/密度/断点、首页画廊、统计/榜单/笔记的页面识别度；
- 不修改后端 API、数据库、同步协议；
- 不删除旧样式，除非完成引用核对并获确认；
- 不通过修改/放宽测试断言来“通过”。

## 3. 批次

### B0 · 正确性修复（P0，先做）

| 项 | 改动 | 视觉影响 | 验收 |
|---|---|---|---|
| `--line` 未定义 | 在根 token 定义 `--line: rgba(0,0,0,.12)` 或改为 `--hairline` | 笔记编辑器/CSV 下拉恢复 1px 边框 | 截图前后对比两处控件 |
| `--ink-1` 未定义 | 改为 `--ink` | 豆瓣候选文字恢复预期深色 | 编辑弹窗豆瓣候选截图 |
| `theme-color` | 书架改 `#f5f5f7`；其余主页面统一 `#f5f5f7`；登录补 | 移动浏览器栏颜色 | 390 宽浏览器截图 |
| 登录 viewport | 补 `viewport-fit=cover` | 刘海屏安全区 | 390/932 截图 |
| 过期注释 | `style.css:4642-4644` 三个瓦片、`chrome.js:792` 120ms vs 420ms、`overlay.js:143` 0.422+0.12 vs 600ms | 无 | 代码审查 |
| 测试基线 | 更新 `test/ui-unification.test.js` 的资源版本断言（只跟随真实改动） | 无 | 全量测试 |

B0 的 `--line`/`--ink-1` 会改变视觉（恢复原本应有的边框/颜色），必须先截图确认再改。

### B1 · 基础 token（不改变视觉）

1. 在现有 CSS 内增加 spacing/type/radius/z-index 的**别名层**，先只替换重复字面量，不改变值：
   - `--space-*` 按 `05-spacing-radius.md` 第 2 节；
   - `--text-*` 按 `03-typography.md`；
   - `--radius-*` 按 `05-spacing-radius.md` 第 4 节；
   - `--z-*` 统一层叠：topbar 50、curtain 44/48/49、search 60、modal 100、toast 200、bulk 120、scan 120、shelf chrome 30、sidebar 41、inspector 40/41。
2. `--wb-card-min` 删除或改为 `--wb-card-width` 的别名；`--radius` 命名整理为 `--radius-card`。
3. `--serif` 只加注释/别名，不改字体栈。
4. 清理确认无引用的 token（`--star`、`--radius-xs`、`--shadow-card-hover`、`--nav-h`、`--selected-marker`、`--wb-panel-raised`、`--liquid-radius`、`--liquid-edge-strong`、`--home-surface/text/sub`）。

验收：`test/ui-unification.test.js` 不改视觉断言；所有页面截图 0 像素差异（允许 1px 抗锯齿）。

### B2 · 状态与无障碍（P1，跨页面）

| 项 | 目标 | 风险 |
|---|---|---|
| Focus ring | 统一 `#0066cc` 或 `#0071e3`（需用户确认），所有控件 2px/offset 2 | 视觉变化；键盘用户可感知 |
| Danger/Error | 拆成 `--danger`（操作）与 `--error`（反馈），统一 `#e30000` 或 `#c0392b` | 视觉变化；需截图 |
| Modal | 所有 `role=dialog` 有可访问名称；Tab 陷阱；背景 `inert`；关闭后归还焦点 | 行为变化，需键盘测试 |
| Toast | `role=status` / `aria-live=polite`；错误用 `role=alert`；不重复播报 | 无视觉变化 |
| Select | trigger 继承字段 label；`aria-activedescendant`/`option id`；原生 select 与 trigger 关联 | 屏幕阅读器行为 |
| Notes editor | 加 `<label>`/`aria-label` | 无视觉变化 |
| Segmented | `role=group` + `aria-pressed` 或升级为 tabs；方向键（如升级） | 语义变化 |
| Touch targets | `.btn-sm`、`.cat-op`、`.row-act` 在粗指针下 ≥44 | 触屏布局变化 |
| Contrast | `--ink-3` / `#929399` 是否加深，需用户确认 | 全局视觉变化，高风险 |

### B3 · 组件统一（P1/P2）

按优先级：

1. **Modal/Sheet/Inspector 外壳**：关闭动画、焦点陷阱、`aria-labelledby`、背景 inert、z-index。
2. **Button + IconButton**：尺寸、加载态、禁用态、触屏命中、图标描边。
3. **Select**：推广到 `#importDup`、`#importAutomerge`、`#cfDatatype`、`#cfMultiple`、`#bulkStatus` 等剩余原生 select。
4. **FormField**：`style.css` 与 `login.css` 共享状态；保留 17/16px、44px 的尺寸差异。
5. **Toast/反馈**：live region；错误/成功/撤销统一。
6. **Empty/Error/Skeleton**：统一状态模型与布局，保留页面文案/CTA 插槽。
7. **BookCover**：`library` 2:3 8px / `display` 5:7 非对称两个变体；统一 alt/占位/失败状态；阴影值先登记，不统一。
8. **Sidebar row/facet**：`aria-current`、`aria-controls`、触屏 44、焦点/滚动保护不变。
9. **Page header/hero**：只统一字阶 token，不统一布局。

### B4 · 视觉收敛（P2/P3，必须用户确认）

- 字号/字重：合并 12.5/13.5/15.5 等半步值；
- 圆角：18/20/24 按角色归位；
- 封面阴影：统一 `--cover-shadow` 家族；
- 三级文字对比度；
- 首页/榜单/统计/笔记/登录 hero 的字阶；
- 图标：Unicode → SVG，1.5 描边（2026-11-07 已落地为 Lucide sprite，见 [07-icons.md](07-icons.md)）；
- 旧 `.book-grid`/`.empty` 清理。

这一批每一项都可能改变视觉，必须单独截图、单独确认，不能打包“顺手改”。

### B5 · UI Lab 与验收自动化

1. 新增 `public/ui-lab.html`（见 `13-ui-lab.md`）；
2. 建立截图脚本：390/768/820/932×430/1024/1180/1440；
3. 静态 fixture 像素对比；数据页面区域遮罩；
4. 键盘/焦点/触控目标/对比度的自动检查；
5. 把 UI Lab 与真实页面验收分开：lab 证明组件状态，真实页面证明业务正确。

## 4. 优先组件与理由

| 顺序 | 组件 | 理由 | 依赖 | 风险 |
|---:|---|---|---|---|
| 1 | Modal/Sheet/Inspector 外壳 | 焦点/语义/关闭行为是最大可访问性风险；所有页面共用 | B1 z-index、B2 focus | 行为变化；需键盘/屏幕阅读器检查 |
| 2 | Focus/State token | 跨所有控件；当前两套蓝色、选中语义不完整 | 用户确认颜色 | 全局视觉变化 |
| 3 | Button / IconButton | 使用频率最高；尺寸/加载/触屏不一致 | B1 spacing/radius | 布局变化 |
| 4 | Select | 已有完整 primitive，只差推广和 label；改造成本低、收益高 | B2 label | 页面下拉行为 |
| 5 | Toast/反馈 | 只有一套实现，但屏幕阅读器不播报；影响所有异步操作 | B2 | 低 |
| 6 | Empty/Error/Skeleton | 6 套空状态、3 套骨架；影响状态一致性 | B1/B2 | 中 |
| 7 | Shelf Sidebar/row/facet | 高频、保护行为多；不能碰滚动/焦点/草稿 | B2 aria | 高（回归风险） |
| 8 | BookCover | 跨页面识别度；比例/阴影/圆角漂移 | 无 | 中（视觉变化） |
| 9 | Page header/hero | 7 套 hero；但强行统一会破坏页面识别度 | B1 type | 高 |
| 10 | Stats/Rank/Notes 视觉 | 页面特例多；优先级低于通用组件 | B1/B4 | 中 |

## 5. 风险登记

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| 统一 token 改变视觉 | 高 | 中 | 先做别名层，0 像素 diff；视觉值改动单独批次 |
| 书架回归（滚动/焦点/草稿） | 中 | 高 | 不动 `sidebar.js`/`book-details.js` 的保护逻辑；只改 CSS/语义；补测试 |
| 玻璃层数/性能回归 | 中 | 高 | 任何玻璃改动先在 Glass Lab 验证；保持折射上限 |
| Safari/Firefox 无法实测 | 高 | 中 | 明确只支持 frost；不声称 full；记录未验证 |
| 截图对比不稳定 | 中 | 中 | 固定字体/DPR/内容/档位；禁用动画；动态区域遮罩 |
| 测试耦合字符串 | 高 | 中 | 只更新真实变化对应的断言；新增行为测试；禁止删除 |
| 用户对视觉变化不接受 | 中 | 高 | B4 每项单独确认；保留回退方案 |
| 旧样式删除引发隐藏依赖 | 中 | 中 | 先 grep 全仓 + 构建/运行验证；分批删除 |
| 多页面组件复制再出现 | 中 | 中 | 组件清单 + UI Lab + review checklist |

## 6. 完成定义（DoD）

- [ ] 所有 P0 正确性问题修复并有截图；
- [ ] 所有核心组件状态在 UI Lab 可见；
- [ ] 弹窗/Toast/Select/Notes 的可访问性缺口关闭；
- [ ] 书架保护行为有测试（滚动/侧栏/焦点/草稿/异步顺序）；
- [ ] 390/768/820/932×430/1180/1440 无布局回归；
- [ ] full/frost/solid 三档与减少动态/透明度通过；
- [ ] 全量测试通过，`check:public` 通过；
- [ ] `?v=`、`SHELL_ASSETS`、`CACHE_VERSION` 同步；
- [ ] 修改前后截图与报告可追溯；
- [ ] 未验证事项明确列出。

## 7. 建议的前 10 个任务

1. 修 `--line` / `--ink-1`（带截图）；
2. 统一 `theme-color` + 登录 viewport；
3. 引入 spacing/radius/z-index 别名层（0 像素 diff）；
4. 修 Modal 的 `aria-labelledby` + 焦点陷阱 + 背景 inert；
5. 给 Toast 加 live region；
6. 给 Select trigger 关联字段 label；
7. 给 Notes editor 加 label；
8. 给 Segmented 补选中语义；
9. 统一 `.btn-sm`/`.cat-op` 的触屏 44px；
10. 新建 UI Lab 的 Foundations/Controls/Feedback 三节。

## 8. 结论

第二阶段应该是“**先正确、再语义、再组件、最后视觉**”，而不是“先换一套更好看的 UI”。当前设计语言的视觉方向已经成立，真正需要的是把参数、状态、可访问性和验收方式固定下来，让后续改动有章可循。
