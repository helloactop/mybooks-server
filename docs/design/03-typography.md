# 03 · Typography

## 1. 字体栈

| 用途 | 栈 | 源码 |
|---|---|---|
| UI / 正文 | `system-ui, -apple-system, "SF Pro Text", "SF Pro SC", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `public/css/style.css:45` |
| 旧标题（变量名 `--serif`） | `system-ui, -apple-system, "SF Pro Display", "SF Pro SC", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `public/css/style.css:44` |
| 首页展示 | `--ent-display` / `--ent-text`，与上面基本同栈 | `public/css/style.css:3782-3783` |
| 笔记编辑器 | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `public/css/style.css:3132` |
| 代码/标识符 | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`；旧代码块用 `Consolas, "Courier New", monospace` | `public/css/style.css:3282,4851,4972` |
| 登录输入 | 继承 `--sans` | `public/css/login.css:110-120` |

**关键事实：`--serif` 不是衬线字体。** 它只是“Display 优先”的系统无衬线栈。旧组件（统计、榜单、笔记标题、弹窗头部、旧书卡标题、`.empty`）引用 `--serif`，新组件（BookDetails、书架、按钮、表单、登录）引用 `--sans`。两者视觉上都是系统无衬线，但命名会误导后续维护。第二阶段只做命名/别名整理，不改变视觉。

## 2. 字阶

### 2.1 展示与页面标题

| 角色 | 大小 | 字重 | 行高 | 字距 | 源码 |
|---|---:|---:|---:|---|---|
| 首页 hero H1 | `clamp(44px, 6vw, 80px)` | 600 | 1.0714 | -0.005em | `style.css:3507-3515` |
| 首页 hero 副标题 | `clamp(17px, 2.2vw, 24px)` | 400 | 默认 | 0.01em | `style.css:3517-3524` |
| 页面标题 `.page-title` | `clamp(34px, 5vw, 46px)` | 600 | 1.1 | -0.02em | `style.css:1636-1643` |
| 榜单 hero 标题 | 48px；≤640 34px；≤480 28px | 600 | 1.1 | -0.5px | `style.css:4660-4664,4731-4737` |
| 榜单眉标 | 14px | 600 | 默认 | -0.224px，uppercase | `style.css:4654-4659` |
| 统计 hero H2 | 22px | 700 | 默认 | 0.06em | `style.css:2107-2113` |
| 统计大数字 | 38px；≤559.98 32px | 700 | 1.15 | 0.02em | `style.css:2135-2145,4493-4494` |
| 首页大卡标题 | `clamp(30px, 4.4vw, 62px)` | 700 | 1.06 | -0.015em | `style.css:3914-3922` |
| 首页产品卡标题 | `clamp(26px, 2.6vw, 36px)` | 600 | 1.1 | -0.005em | `style.css:3600-3608` |
| 首页封面标题 | `clamp(30px, 3.4vw, 46px)` | 600 | 1.0714 | -0.005em | `style.css:3662-3670` |
| 心得书名 | `clamp(24px, 4vw, 34px)` | 700 | 1.25 | 0.04em | `style.css:3180-3187` |
| 登录页 H1 | 32px；≤560 28px | 650 | 1.15 | -0.03em | `login.css:75-82,300-301` |
| Glass Lab H1 | `clamp(28px, 4vw, 42px)` | 默认 | 默认 | -0.03em | `glass-lab.html:15` |

### 2.2 分区与弹层标题

| 角色 | 大小 | 字重 | 行高/字距 | 源码 |
|---|---:|---:|---|---|
| 弹窗标题 | 24px；竖屏 19px；横屏 18px | 700 | 0.05em | `style.css:2391-2397,4552-4553,4589-4590` |
| 书籍详情标题 | 21px；≤819 20px；≤390 19px | 650 | 1.25 / -0.02em | `style.css:2675-2682,3070,3106` |
| 详情分区标题 | 13px | 650 | 0 | `style.css:2814-2821` |
| 详情作者 | 13.5px | 400 | 1.4 | `style.css:2684-2691` |
| 统计面板 H3 | 18px | 700 | 0.06em | `style.css:2163-2172` |
| 榜单榜名 | 28px | 600 | 1.19 / -0.374px | `style.css:4668-4672` |
| 榜单副标题 | 14px | 400 | -0.224px | `style.css:4673` |
| 笔记正文 H1/H2/H3 | 23 / 20 / 17.5px | 700 | 1.4 / 0.04em | `style.css:3250-3262` |
| 分类管理列标题 | 19px | 600 | -0.2px | `style.css:4761` |
| 登录设备区 H2 | 16px | 600 | 默认 | `login.css:224` |

### 2.3 正文、UI 与辅助文字

| 角色 | 大小 | 字重 | 行高/字距 | 源码 |
|---|---:|---:|---|---|
| 全站正文 | 17px | 400 | 1.47 | `style.css:85-93` |
| 表单输入 | 17px（触屏详情输入 16px） | 400 | 默认 | `style.css:2418-2432,3090-3092` |
| 书籍详情正文 | 14px | 400 | 1.7 | `style.css:2936-2938` |
| 笔记 Markdown | 15px | 400 | 1.6 | `style.css:3248` |
| 笔记编辑器 | 15px | 400 | 1.7 / mono | `style.css:3121-3133` |
| 按钮 | 14px | 600 | 0.02em | `style.css:1467-1496` |
| 小按钮 `.btn-sm` | 13px | 600 | 默认 | `style.css:4821` |
| 分段控件 | 13.5px | 500（选中 600） | 默认 | `style.css:1418-1451` |
| 自定义下拉触发器/选项 | 13.5px | 400（选中 500） | 默认 | `style.css:1671-1691,1766-1784` |
| 表单标签 | 12.5px | 600 | 0.1em | `style.css:2407-2412` |
| 字段提示 | 12px | 400 | 1.5 | `style.css:2416` |
| 书架分组标题 | 12.75px | 650 | 0 | `shelf-workbench.css:178-194` |
| 书架行 | 14px | 450（选中 600） | 1.2 | `shelf-workbench.css:216-233` |
| 书架“全部图书” | 15px | 650 | 默认 | `shelf-workbench.css:245-252` |
| 书架计数 | 12px | 400 | tabular-nums | `shelf-workbench.css:235-242` |
| 书架筛选输入 | 13.5px | 400 | 默认 | `shelf-workbench.css:294-306` |
| 书架卡片标题 | 13.5px | 600 | 1.3 | `shelf-workbench.css:500-509` |
| 书架卡片作者 | 12px | 400 | 1.3 | `shelf-workbench.css:510-517` |
| 书架列表标题 | 13.5px | 600 | 1.3 | `shelf-workbench.css:1079-1087` |
| 书架列表作者 | 11.5px | 400 | 1.3 | `shelf-workbench.css:1088-1095` |
| 书架表格 | 12px；表头 10px/600/0.05em uppercase | — | — | `shelf-workbench.css:1106-1148` |
| 书架移动状态 | 10px | 400 | 默认 | `shelf-workbench.css:1097-1104` |
| 搜索输入（桌面/手机） | 24px / 28px，600 | — | 0.009em / 0.007em | `style.css:1132-1149,1353-1359` |
| 搜索保存行（桌面/手机） | 12px / 17px，600 | — | -0.01em / -0.022em | `style.css:1369-1374,1224-1240` |
| 登录眉标 | 10.5px | 600 | 0.12em uppercase | `login.css:66-73` |
| 登录设备元信息 | 12px | 400 | 1.4 | `login.css:272` |

## 3. 可用的字重

基线实际使用：`400`、`450`、`500`、`600`、`650`、`700`。

- `400`：正文、说明、未选中项；
- `450`：书架行（Finder 层级）；
- `500`：分段未选中、下拉选中；
- `600`：按钮、标题、选中行；
- `650`：书架分组/卡片标题、详情标题、新 UI 的主要强调；
- `700`：旧标题、统计数字、榜单数字。

规则：新组件默认使用 `400 / 600 / 650` 三档；`450` 仅保留给书架行；`700` 仅用于旧展示标题、数字与 Markdown 标题。不要在同一组件里混用 `600` 和 `650` 表达同一层级。

## 4. 字距与大小写

- 大标题使用负字距：`-0.005em` 到 `-0.03em`；
- 小号 UI 文本使用 `0` 到 `0.02em`；
- 小号全大写标签使用 `0.05em`–`0.14em`；
- 中文不使用 `text-transform: uppercase`；
- 全大写只用于英文眉标、表头、封面状态徽章、首页 `fam-chip` 等装饰性短标签；
- 旧组件中的 `letter-spacing: 0.06em` / `0.08em` 属于既有视觉，不强制清理；新组件不要继续扩大字距。

## 5. 截断与多行

| 场景 | 规则 | 源码 |
|---|---|---|
| 书架卡片标题 | 2 行截断 | `shelf-workbench.css:500-509` |
| 书架卡片作者 | 单行省略 | `shelf-workbench.css:510-517` |
| 书架列表标题/作者 | 单行省略 | `shelf-workbench.css:1079-1095` |
| 表格标题列 | 单行省略，最大 280px（手机 160px） | `shelf-workbench.css:1146,1325` |
| 首页大卡简介 | 3 行截断 | `style.css:3933-3946` |
| 首页小卡简介 | 3 行；≤734 2 行 | `style.css:4049-4060,4480` |
| 首页封面简介 | 2 行截断 | `style.css:3689-3701` |
| 统计排行名称 | 单行省略 | `style.css:2322-2332` |
| 详情简介 | 4 行折叠；手机 3 行；超过 140 字符才提供展开 | `book-details.js:11,147-157`；`style.css:2939-2944,3079` |
| 长作者名/系列名 | `overflow-wrap: anywhere`，不撑破面板 | `style.css:2684-2691,2715` |

规则：

- 不用固定高度裁切可换行的中文标题；
- 使用 `-webkit-line-clamp` 时必须同时设置 `display: -webkit-box`、`-webkit-box-orient: vertical`、`overflow: hidden`；
- 截断后必须有 `title` 或详情入口，不能永久隐藏完整信息；
- 输入框不使用省略号，长文本通过水平滚动或换行处理。

## 6. 数字与表格

- 计数、文件大小、表格数字使用 `font-variant-numeric: tabular-nums`（`style.css:2516,2933,4696`；`shelf-workbench.css:240,1147`）；
- 统计大数字、榜单排名可使用展示字重，但仍保持 tabular；
- 日期格式沿用页面现有写法（`YYYY-MM-DD` 或中文“至/进行中”），不在设计系统层强制统一；
- 表格数值列右对齐（`.wb-t-num`，`shelf-workbench.css:1147`）。

## 7. 响应式字号

| 场景 | 桌面 | 手机/窄屏 | 源码 |
|---|---|---|---|
| 页面标题 | `clamp(34,5vw,46)` | 同一 clamp 自然缩小 | `style.css:1636-1643` |
| 榜单 hero | 48px | 34 / 28px | `style.css:4731-4737` |
| 统计大数字 | 38px | 32px | `style.css:4493-4494` |
| 弹窗标题 | 24px | 竖屏 19 / 横屏 18 | `style.css:4552-4553,4589-4590` |
| 详情标题 | 21px | 20 / 19px | `style.css:3070,3106` |
| 登录 H1 | 32px | 28px | `login.css:300-301` |
| 搜索输入 | 24px | 28px | `style.css:1132-1149,1353-1359` |
| 搜索保存行 | 12px | 17px | `style.css:1224-1240,1369-1374` |
| 首页 hero | `clamp(44,6vw,80)` | 自然缩小 | `style.css:3507-3515` |

输入框在移动端保持 16–17px，避免 iOS 聚焦时自动放大：表单是 17px（`style.css:2418-2432`），详情快捷输入在触屏上提到 16px（`style.css:3090-3092`），登录输入 16px（`login.css:119`）。

## 8. 无障碍与字体债务

- 12px 以下的文字只用于非关键徽章、封面作者、表格表头；正文和操作说明不低于 12px；
- 三级文字 `--ink-3` 在白色上对比度 3.62:1、在冷白画布上 3.33:1，不满足 WCAG AA 普通文本 4.5:1（详见 `04-color.md`）。当前大量 12px 日期/提示使用该色，属于已登记债务；不要继续扩大使用范围；
- 书架三级文字 `#929399` 在白色上 3.06:1、侧栏底上 2.88:1，同样不满足 AA；
- 不通过“再缩小字号/再调浅颜色”处理信息层级；
- 字号放大时优先让容器变高或换行，不能裁掉操作名称；
- 中文标题不使用 `letter-spacing` 来“撑开”版面，避免字间断裂。

## 9. 字体规范摘要

- **正文**：17px / 1.47 / 400；
- **UI 控件**：13.5–14px / 500–600；
- **辅助**：12–12.5px / 400；
- **分区标题**：13px / 650；
- **页面标题**：34–46px / 600；
- **展示标题**：44–80px / 600；
- **数字**：tabular-nums；
- **字体族**：全部为系统无衬线；`--serif` 只是历史命名；
- **不新增字体文件、不引入 Web Font、不使用衬线字体。**
