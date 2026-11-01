# Mybooks UI Design System

> 版本：0.1（第一阶段：源码审计 + 规范建立）
> 基线：`main` @ `690bb18582ba9c6245619751d48a8d8abf5b2427`（2026-11-01）
> 状态：**文档基线**。本阶段只新增设计文档、组件清单和审计报告；未修改任何前端、后端、测试或构建文件。

## 1. 这套文档解决什么问题

Mybooks 已经有一套稳定的视觉语言：冷白画布、白色内容面、近黑文字、Action Blue、发丝线、Apple 式导航、Tomo/Finder 式书架，以及自研 Liquid Glass。问题不在于“没有风格”，而在于：

- 参数散落在 `style.css`、`shelf-workbench.css`、`liquid-glass.css`、`login.css` 和多个页面脚本里；
- 有些组件已经统一，有些组件在不同页面各写了一套；
- 一些“看起来像错误”的差异其实是已经验证过的页面特例；
- 另一些差异是真正的缺陷或重复，例如未定义变量、两套蓝色焦点、两套红色错误、封面比例/阴影漂移。

本目录先把**事实**和**规则**分开记录，再给出第二阶段可以执行的统一顺序。

## 2. 文档地图

| 文档 | 内容 |
|---|---|
| [01-principles.md](01-principles.md) | 设计原则、视觉定位、不可变约束 |
| [02-tokens.md](02-tokens.md) | 全局 Design Tokens、页面局部 token、运行时变量、治理规则 |
| [03-typography.md](03-typography.md) | 字体栈、字阶、字重、行高、字距、截断 |
| [04-color.md](04-color.md) | 颜色语义、状态色、对比度、主题色 |
| [05-spacing-radius.md](05-spacing-radius.md) | 间距系统、圆角系统、封面圆角 |
| [06-surfaces-liquid-glass.md](06-surfaces-liquid-glass.md) | 表面层级、材质、Liquid Glass 使用边界与降级 |
| [07-icons.md](07-icons.md) | 图标尺寸、描边、字形、无障碍 |
| [08-motion.md](08-motion.md) | 动效 token、时长、节奏、减弱动态 |
| [09-responsive.md](09-responsive.md) | 断点、布局、安全区、触屏适配 |
| [10-components.md](10-components.md) | 组件目录、状态矩阵、交互与移动端要求 |
| [11-pages.md](11-pages.md) | 每个页面的设计契约 |
| [12-acceptance.md](12-acceptance.md) | UI 视觉与交互验收标准 |
| [13-ui-lab.md](13-ui-lab.md) | UI Lab 扩展方案 |
| [14-audit-report.md](14-audit-report.md) | 审计报告、问题分级、统一/特例判断 |
| [15-component-inventory.md](15-component-inventory.md) | 现有组件全量清单 |
| [16-phase2-plan.md](16-phase2-plan.md) | 第二阶段优先级、批次、风险 |

## 3. 证据优先级

发生冲突时，按以下顺序判断：

1. 用户在当前任务中的明确要求；
2. 基线提交上的实际代码与已验证的页面行为；
3. 本目录文档；
4. `docs/LIQUID-GLASS.md`、`docs/LIQUID-GLASS-UNIFICATION.md`、`docs/liquid-glass-visual-pass3/README.md`、`docs/book-detail-ui-refactor/README.md` 等历史报告；
5. Lumi_Books 的 `devdocs/lumi-ui-motion-design-system.md`（只参考文档结构与治理方法，不复制其 Android 视觉、红色强调色或 Android 尺寸）。

本目录中的规范分三类，正文里会明确标注：

- **【已实现】**：基线代码中存在，能指到具体文件与行；
- **【规范值】**：文档定义的统一目标，尚未写成 CSS token 或改到页面；
- **【例外】**：有意保留的页面特例，不能当作 bug 顺手“修平”。

## 4. 基线事实

| 项 | 数值/事实 | 证据 |
|---|---|---|
| 基线提交 | `690bb18582ba9c6245619751d48a8d8abf5b2427` | `git rev-parse HEAD` |
| 全局样式 | `style.css` 5,173 行 | `public/css/style.css` |
| 书架样式 | `shelf-workbench.css` 1,464 行 | `public/css/shelf-workbench.css` |
| 玻璃材质 | `liquid-glass.css` 503 行 + `liquid-glass.js` 725 行 | `public/css/liquid-glass.css`、`public/js/liquid-glass.js` |
| 登录页样式 | `login.css` 309 行 | `public/css/login.css` |
| 页面 | 首页、书架、榜单、统计、分类管理、心得、账号、Glass Lab | `public/*.html` |
| 响应式 | 主要断点 560 / 820 / 1180；首页画廊另有 734 / 1068 / 1441 | 见 `09-responsive.md` |
| UI 测试 | `test/ui-unification.test.js` 20 条断言 | `test/ui-unification.test.js` |
| 全量测试 | 以本轮最终运行结果为准 | 见 `14-audit-report.md` 第 6 节 |

## 5. 不可变约束

以下内容在第二阶段也不得擅自改变：

- `/shelf` 的 Finder 式三栏结构、沉浸式无顶栏/页脚、左上 My books 菜单；
- 书架的纯封面展示、三档密度（140 / 180 / 210px 封面宽）、固定封面宽度而非拉伸列；
- 资料库侧栏、Inspector、底部搜索胶囊、书籍详情组件的位置与交互路径；
- 全局导航顺序、Apple 式桌面下拉/移动全屏菜单、搜索浮层行为；
- 冷白画布 `#f5f5f7`、白色内容面、Action Blue 唯一强调色；
- Liquid Glass 的 full / frost / solid 三档与诚实降级；
- 侧栏滚动位置、侧栏展开状态、搜索焦点、编辑草稿、异步结果顺序保护；
- 书架手机横屏 932 使用资料库抽屉，不占用书封列宽；
- 现有页面上的图书显示顺序、筛选 AND 语义、分页契约。

## 6. 第一阶段边界

本阶段只做：

- 源码审计；
- Token / 组件 / 页面契约 / 验收标准 / UI Lab 方案文档；
- 组件清单与问题分级。

本阶段不做：

- 不重构前端框架；
- 不批量拆分或重排 CSS；
- 不重新设计任何业务页面；
- 不修改后端 API、数据库、同步协议；
- 不修改测试断言；
- 不新增 UI Lab 页面（只给扩展方案）；
- 不删除“看起来没用”的旧样式，先登记为清理候选。

## 7. 后续修改流程

任何第二阶段的视觉/交互改动必须：

1. 先说明属于布局、材质、状态还是动效，避免同时重做四个维度；
2. 先查找现有组件和 token，不在页面里复制相似按钮/菜单/输入框；
3. 记录受影响的页面与断点；
4. 提供修改前后的同视口、同内容、同字体截图；
5. 运行 `test/ui-unification.test.js` 与全量测试，禁止通过放宽断言掩盖回归；
6. 若改了 `public/` 资源，按既有规则同步 `?v=`、`public/sw.js` 的 `SHELL_ASSETS` 和 `CACHE_VERSION`；
7. 经用户确认后再合入。

## 8. 与 Lumi 参考规范的关系

本目录参考了 Lumi_Books `codex/public-base-edition` 的 `devdocs/lumi-ui-motion-design-system.md`（2026-10-27 v2.1）的文档结构与治理方法，但**没有复制它的 Android 视觉或尺寸**。

采用的治理思想：

| Lumi 规范 | Mybooks 对应 |
|---|---|
| 文档优先级（用户 > 规范 > 代码 > 历史文档） | 本 README 第 3 节 |
| 能力检测与诚实回退 | `06-surfaces-liquid-glass.md` 第 3 节 |
| 令牌分类（字阶/间距/圆角/颜色） | `02`–`05` |
| 表面语义（Content / Control / Overlay） | `06` 第 1、5 节 |
| 最多三层可见玻璃 | `06` 第 6 节（大面板不做折射、内容层实体、遮罩不叠加） |
| 动效时间词汇与减弱动态 | `08` |
| 发布验收清单 | `12` |
| Agent 修改流程 | 本 README 第 7 节 |

不迁移的内容：

- Android API 31+/RenderEffect/HDR/电子墨水等平台能力；
- Lumi 的红色强调色、三主题（Lumi/Material 3/Liquid Glass）与 Compose 组件尺寸（dp/sp）；
- TalkBack/RTL 等 Android 专属语义（Mybooks 当前只有浅色 Web、无 RTL）；
- 任何 Android 动效弹簧参数。Mybooks 的 Web 动效以 CSS 时长/缓动为准，见 `08-motion.md`。
