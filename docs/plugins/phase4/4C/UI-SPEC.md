# Phase 4C 插件管理中心：UI 规格

> 技术基线：原生 JS（IIFE）+ 现有 `style.css` / `toolbox.css` token + Lucide sprite。
> 不引入 React/Vue、第二套 CSS 设计系统、第二套图标库。
> 页面入口：`/plugins`、`/plugins/:id`；旧 `/toolbox` 保留。
>
> **实施状态（4C.3 + 4C.4，2026-11-10）**：本文档描述的页面与交互已实现，代码见
> `public/plugins.html`、`public/plugin-detail.html`、`public/js/page-plugins.js`、
> `public/js/page-plugin-detail.js`、`public/js/plugin-center.js`、`public/js/plugin-config-form.js`、
> `public/css/plugins.css`。权限与配置已从只读升级为可保存；与实际实现的差异见 §14。

## 1. 导航与入口

### 1.1 全局导航

在 `public/js/chrome.js` 的 `NAV_ITEMS` 增加：

```js
{ id: 'plugins', label: '插件', href: '/plugins' }
```

- 位置：`书架` 之后、`榜单` 之前（与“内容 → 扩展”认知一致）。
- 当前页高亮：`<body data-page="plugins">` / `data-page="plugin-detail"`。
- 旧 `/toolbox` 不加高亮，避免两个入口同时 active。
- 移动端：自动进入现有全屏菜单，无需新菜单结构。

### 1.2 页面与文件

| 路径 | HTML | JS | 说明 |
| --- | --- | --- | --- |
| `/plugins` | `public/plugins.html` | `page-plugins.js` + `plugin-center.js` | 总览/商店/已安装/任务/设置 |
| `/plugins/:id` | `public/plugin-detail.html` | `page-plugin-detail.js` + `plugin-center.js`（+ 4C.4 `plugin-config-form.js`） | 详情五个 tab |
| `/toolbox/tool/:id` | 现有 | 现有 | 插件 iframe 不变 |

新增样式 `public/css/plugins.css`：只补布局（`.pc-*`），颜色/圆角/按钮全部复用 `style.css` 与 `toolbox.css`。

## 2. 页面框架

```text
<header class="topbar">                 ← chrome.js 注入（现有）
<main class="tb-page pc-page">
  <section class="pc-hero">             ← 复用 .tb-hero 排版
    eyebrow: PLUGIN CENTER
    h1: 插件中心
    lede: 安装、授权、运行与排障都在这里；插件代码仍在独立运行时执行。
    right: Runtime 状态胶囊 + “重启运行时”
  </section>
  <nav class="tb-tabs" role="tablist">
    总览 | 商店 | 已安装 | 任务 | 设置
  </nav>
  <section role="tabpanel">…</section>
</main>
```

- 复用 `.tb-page` 的 1120px 内容宽；详情页同样 1120px。
- 顶部 Runtime 胶囊沿用 `.tb-runtime` / `.tb-runtime-dot`，离线为琥珀色。
- 禁用“重启运行时”按钮时给 `title` 说明原因（未登录/请求中）。

## 3. 总览（Overview）

### 3.1 指标卡

4 列（≥1024px）/ 2 列（≥640px）/ 1 列：

| 卡片 | 数据 | 交互 |
| --- | --- | --- |
| 已安装 | `counts.installed`，副标题“启用 X · 停用 Y” | 点击切到已安装 |
| 可更新 | `counts.updates_available`（`null` 显示“商店不可用”） | 点击切到已安装并筛选可更新 |
| 运行中任务 | `tasks.running` | 点击切到任务 |
| 需要处理 | `failed + pending_restart` 数量 | 点击切到已安装并筛选异常 |

### 3.2 状态区

两栏（≥900px）：

- **Runtime**：在线/离线、`isolation_mode`（shared/process/uid）、插件身份认证（开/关）、
  toolbox 路径是否一致；不一致时红条 `TOOLBOX_PATH_MISMATCH`。
- **安全提示**：
  - 共享 Worker + 未审查插件 → 红色横幅“高风险：未审查插件与其它插件同进程”。
  - `allow_unreviewed=true` → 红色横幅“已允许未审查插件，仅用于开发环境”。
  - `policy_state=broken` → 红色横幅“权限策略损坏，内部接口已默认拒绝”。
  - 已审查/未审查计数 + 未审查插件列表（只显示名称与链接）。

### 3.3 最近错误

列表最多 5 条：`插件名 · 时间 · code · message`，点击进入该插件“日志”tab。
无错误时显示空状态“最近没有插件错误”。

## 4. 商店（Store）

### 4.1 工具栏

- 搜索框：占位“搜索插件名称、作者或描述”；输入 250ms 防抖，`q` 传给 API。
- 排序：`名称`（默认）/ `最近更新`（商店 `publish_date`）/ `已安装优先`。
- 刷新按钮：`refresh=1`，请求中禁用并显示“刷新中…”。
- **不显示分类筛选**：当前商店索引没有分类字段，4C 不造占位分类。
- 商店不可用：显示 `.tb-note.is-error` + 重试按钮，仍展示上次缓存。

### 4.2 卡片

复用 `.tb-card` 布局，字段严格来自接口：

```text
[图标/首字母]  名称                      [已审查|未审查]
               作者 · 版本
描述（最多 3 行）
CoreAPI x.y · 仓库链接                 [安装|更新|已安装|暂不支持]
```

- 审核徽章：`reviewed=true` 绿色“已审查”；否则琥珀“未审查”。
- 兼容性：`compatibility.supported=false` 时按钮禁用，`title` 显示原因。
- 未审查：按钮文案“待审查”，禁用；**不提供“强制安装”**。
- 安装确认弹窗：名称、版本、审查状态、限制列表（`review.limitations`）、
  “我理解插件代码将在运行时中执行”。
- 安装成功：Toast + 若 `pending_restart` 显示“待重启”提示，引导“重启运行时”。

### 4.3 插件详情入口

- 点击卡片标题/图标进入 `/plugins/:id`。
- 商店条目未安装时，详情页展示“安装”按钮，调用既有 `POST /api/toolbox/install`。

## 5. 已安装（Installed）

### 5.1 筛选

分段控件：`全部 / 已启用 / 已停用 / 可更新 / 异常`。
“可更新”来自商店缓存；“异常”= `last_error` 非空或 `runtime_status=not_loaded` 或 `pending_restart`。

### 5.2 行卡片

复用 `.tb-row`：

```text
[图标] 名称  [已启用|已停用|待重启|加载失败|不兼容]   v版本 · 来源 · 类型
       安装于 … · 可回滚
       last_error（红字，最多 2 行）
       [打开] [重启生效] [停用/启用] [更新] [回滚] [卸载] [详情]
```

- “打开”仅在 `enabled && !pending_restart && runtime_status != not_loaded` 时可用。
- 卸载确认：默认保留私有数据；勾选“同时删除插件配置与工作目录”才传 `purge_data=1`。
- 所有动作按钮调用既有 `/api/toolbox/*`，成功后重新拉取 `/api/plugins/installed` 与总览。
- 状态与 `toolbox_tools` 一致，不在前端推导 `enabled`。

## 6. 任务（Tasks）

### 6.1 筛选与列表

- 状态分段：`全部 / 运行中 / 已完成 / 失败 / 已取消`；插件下拉来自已安装列表。
- 列表行：插件名 + 操作 + `#id`、状态徽章、进度条、阶段、开始/完成时间、
  结果书籍链接、错误信息（折叠 2 行）、`取消`（仅 running）。
- 每 4 秒轮询仅当页面可见且存在 running 任务（沿用现有策略）。
- 点击行打开任务详情抽屉：任务字段 + Artifact 列表（格式/大小/SHA 前 12 位/标题）+ 关联书籍。
  不显示宿主路径。

### 6.2 空状态

“还没有任务记录。安装插件并运行一次后，这里会显示下载、转换与入库进度。”

## 7. 设置（Settings）

三个只读区块，**没有任何本地开关**：

| 区块 | 内容 |
| --- | --- |
| Runtime | 在线状态、`isolation_mode`、`isolated`、`plugin_auth_only`、`uid_isolation`、缺失 capabilities、路径一致性 |
| 安全 | `policy_state`、已审查/未审查数量、`allow_unreviewed`、共享 Worker 风险、最近审计条数 |
| 商店来源 | `store_url`、最近抓取时间、缓存状态；“刷新商店”按钮 |

- 每项显示“服务端实际值”，旁边 `title` 给出环境变量名与生效方式。
- 提供“复制部署建议”按钮，复制一段说明文本（不修改环境）。
- 未审查插件存在时，在设置页顶部固定风险横幅。

## 8. 插件详情页

### 8.1 头部

```text
[返回 插件中心]
[图标] 名称  v版本  [已启用|已停用|待重启|加载失败]
       作者 · 来源(store/dev) · 插件 ID · Runtime python
       描述
       [打开插件] [启用/停用] [更新] [回滚] [卸载]
```

- 未安装（从商店进入）：只显示 `[安装]` 与审查信息。
- “插件 ID”可点击复制；不展示安装绝对路径与 SHA 全量（版本页显示 SHA 前 12 位）。

### 8.2 Tab：概览

- 基本信息表：Manifest 版本、CoreAPI 版本、兼容性、信任级别（reviewed/local/unreviewed）、
  审核状态、安装时间、更新时间、任务计数。
- 兼容性原因/警告逐条列出；`supported=false` 时红色说明。
- 运行限制（`compatibility.limitations`）列表。

### 8.3 Tab：权限

```text
策略状态：ok / absent / last-good / broken   [说明]
[ ] books.read      library:all   资源型   已声明 · 未授予
[x] jobs.create                   —        已声明 · 已授予
[ ] network.public                —        未强制（仅展示）
                                        [取消] [保存授权]
```

- 默认状态来自 `granted`；**新声明权限默认不勾选**。
- 勾选/取消后不立即生效，必须点“保存授权”；保存前显示变更数量。
- 资源型权限显示 scope 输入框（默认 `library:all` / `artifact:*` / `book:*`；支持通配符）。
- 未审查/高风险权限（`network.*`、`books.delete`、`files.write`）标红并提供二次确认弹窗。
- `policy_state=absent`：顶部黄色警告“当前为 Legacy 兼容模式，声明权限不会被裁剪；保存后进入严格模式”。
- `policy_state=broken`：红色只读态，禁止保存，提示先修复 `grants.json`。
- 保存失败：保留编辑状态，显示错误码与可操作建议。
- 不允许把未在 Manifest 声明的权限加入列表；UI 不提供“添加权限”自由输入。

### 8.4 Tab：配置

按 `config.schema` 渲染原生表单，支持：

| schema | 控件 |
| --- | --- |
| `string` | 文本框；`x-sensitive` → `type=password`，占位 `******` |
| `string + enum` | `<select>` |
| `integer` / `number` | `input[type=number]`，带 min/max/step |
| `boolean` | 开关/checkbox |
| `array`（`items` 为 string） | 逗号分隔输入或可增删行（4C.4 先做逗号分隔） |
| `object` / 复杂数组 | 只读 JSON 文本域，提示“请使用插件界面配置” |

- 字段标题优先 `title`，否则字段名；`description` 作为 hint。
- 必填标记 `*`；错误信息显示在字段下方，来自 400 响应的 `errors[].field/code`。
- 敏感字段：加载时显示 `******`；用户不修改则保存时原样提交 `******`；修改后按明文提交。
- 保存成功 Toast“配置已保存”；失败保留草稿。
- `has_custom_ui=true`：顶部提示“该插件提供自己的配置界面”，按钮“打开插件界面”（`/toolbox/tool/:id`）。
- `runtime_online=false`：表单只读，显示“插件运行时离线，无法读取/保存配置”。
- 无 Schema：整页空状态“该插件未声明配置项”，保留“打开插件界面”。

### 8.5 Tab：版本

```text
当前版本   1.1.0   store   安装于 …
可回滚到   1.0.0   [回滚]
商店最新   1.1.0   已审查   [更新到 1.1.0] / 已是最新
审查备注   reviewed_at / notes / limitations
SHA-256    af0914bb…（前 12 位，可复制全量）
```

- 只显示后端真实返回的当前/回滚/最新；没有历史列表就不渲染时间线。
- 无更新说明字段 → 不显示“更新日志”，避免编造。

### 8.6 Tab：日志

分段：`错误 / 任务消息 / 管理审计`。

- 表格列：时间、级别、来源、代码、消息；消息超长折叠。
- 顶部提示：“Runtime stdout 不在此接口；容器日志请查看 toolbox-runtime”。
- 支持 `limit` 分页（上一页/下一页），不做无限滚动。
- 空状态分类型文案：
  - 错误：“没有记录到插件错误。”
  - 任务：“该插件还没有任务消息。”
  - 审计：“还没有针对该插件的管理操作。”

## 9. 状态、错误与加载

| 场景 | 表现 |
| --- | --- |
| 首屏加载 | 骨架卡（不显示假数据），`aria-busy=true` |
| 接口失败 | `.tb-note.is-error` + 错误码 + 重试按钮；不清空已加载数据 |
| 401 | 跳 `/login?next=...`（复用 `api.js` 行为） |
| 403 | Toast + 说明“仅管理员会话可执行” |
| 409 | 提示冲突并重新拉取当前状态（权限/版本/任务） |
| 503 Runtime | 相关区块降级，不阻塞 Store/Installed |
| 空商店 | “商店暂时没有可用插件。” |
| 空已安装 | “还没有安装插件。去商店看看。” |

- 所有破坏性操作使用确认弹窗（复用 `modal.js`），按钮顺序：取消在左、主操作在右。
- 成功/失败统一 Toast；错误 Toast 停留 5 秒，可手动关闭。

## 10. JS / CSS 模块划分

```text
public/js/plugin-center.js       共享：api 封装、格式化、状态徽章、卡片片段、确认弹窗
public/js/page-plugins.js        总览/商店/已安装/任务/设置；hash 路由（#store 等）
public/js/page-plugin-detail.js  详情五个 tab；读取 :id，hash 切换 tab
public/js/plugin-config-form.js  4C.4：Schema → 原生表单、校验错误映射、掩码处理
public/css/plugins.css           .pc-* 布局；不覆盖 .tb-* 视觉
```

- 全部 IIFE，避免全局污染；共享函数挂 `window.MyBooksPlugins`。
- 请求复用 `public/js/api.js` 的 `api()`（自动 Bearer/401 跳转）；若独立加载，则在 `plugin-center.js` 内实现同语义封装。
- 状态：每个页面一个 `state` 对象；tab 切换用 `location.hash`，刷新后保持。
- 不做前端缓存层；每次动作后重新拉取受影响资源。

## 11. 响应式

| 断点 | 布局 |
| --- | --- |
| ≥1024px | 指标 4 列；商店 3 列卡片；详情两栏（内容 + 侧栏说明） |
| 820–1023px | 指标 2 列；商店 2 列；详情单栏 |
| <820px | 指标 1 列；商店 1 列；tab 横向滚动；行操作换行右对齐 |
| <520px | 详情头部图标 40px；隐藏次要元信息（安装时间等）到“更多”折叠 |

- 触摸目标 ≥44×44px；按钮不因换行改变顺序。
- 详情 tab 在窄屏可横向滚动，但不出现整页横向滚动。

## 12. 可访问性与文案

- tab 使用 `role="tablist"/"tab"/"tabpanel"` + `aria-selected` + 键盘左右切换。
- 进度条 `role="progressbar"` + `aria-valuenow`（沿用现有任务卡）。
- 危险操作按钮不使用纯颜色表达状态，必须带文字。
- `prefers-reduced-motion` 下关闭卡片入场/骨架动画（现有 CSS 已处理全局动效，新增动画需遵守）。
- 文案原则：不承诺未实现能力；安全状态用“当前部署”而不是“已隔离”等绝对表述。

## 13. 明确不做

- 不新增分类页（商店索引无分类）。
- 不显示评分/下载量/审核评分。
- 不提供“强制安装未审查插件”按钮。
- 不提供角色/多用户/协作者管理。
- 不提供 Runtime 环境变量在线开关。
- 不实现 Bridge v2、UI Slot、Plugin/route 装饰器。
- 不重写 `toolbox-tool.html` / `page-toolbox-tool.js`（4D 范围）。

## 14. 实施状态与差异（4C.4）

已实现（与本文档的差异按实际行为为准）：

| 区域 | 实际行为 |
| --- | --- |
| 权限开关 | `role="switch"` 按钮 + `aria-checked`；未勾选默认关闭；只展示 Manifest 声明的权限 |
| 风险说明 | 每项权限显示“低/中/高风险”徽章与中文语义（`grants-admin` 的 `catalog`），高风险的 `network.private`、`books.delete` 需二次确认才保存 |
| scope | 资源型权限提供输入框，默认取 Manifest 声明或 `library:all`；非资源型禁用并归一化为 `*` |
| 撤销确认 | 保存时若会撤销已授予权限，先弹确认框列出被撤销项（撤销立即生效） |
| 策略状态 | `absent` 提示“首次保存建立严格策略”；`broken` / `last-good` 全部控件禁用、保存按钮禁用 |
| 未声明授权 | 已授予但 Manifest 未声明的权限单列警告，保存后会被撤销 |
| 配置控件 | `string` / `enum`（select）/ `integer` / `number` / `boolean`（checkbox）；不支持的类型不在本轮渲染 |
| 敏感字段 | 不回填原值，输入框为空并提示“已配置，留空保持原值”；勾选“清除”才会删除；掩码值永不提交 |
| 保存状态 | 未修改 / 有未保存修改 / 正在保存 / 保存成功 / 校验失败 / 版本冲突，均以服务端结果为准 |
| 冲突处理 | 409 时提示“已被其他操作修改”，自动重新加载服务端状态，不保留本地草稿 |
| 日志 | 类型（错误/任务消息/管理审计）+ 时间范围（全部/24 小时/7 天）+ 分页；审计行显示操作人与结果 |
| 运行时离线 | 配置区只读并提示 `RUNTIME_UNAVAILABLE`，不提供保存 |

未实现：配置历史/diff 视图、数组/对象类型的可视化编辑（提示改用插件界面）、Runtime stdout 采集。
