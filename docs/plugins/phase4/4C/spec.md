# Phase 4C.1 插件管理中心：架构与实施规格

> 状态：设计完成，未修改业务代码
> 基线：`codex/plugin-platform` @ `6fab21b4`（Phase 4B-R 已提交并推送）
> 范围：只覆盖 4C.1（源码审查、架构、接口、UI 规格）；4C.2–4C.5 见 [tasks.md](tasks.md)

## 1. 现状：真实架构（按源码核对）

### 1.1 进程与数据

```text
浏览器（管理端）
  │  设备会话 Cookie / Bearer（单一管理员）
  ▼
Node / Express（server.js）
  ├─ /api/public、/api/toolbox/tool/:id/*        ← 公开 / 插件 iframe
  ├─ /internal/toolbox/*                         ← Python Runtime → Node（共享密钥或插件令牌）
  ├─ /api/*（requireSession）                    ← 管理端读写
  │    ├─ routes.toolbox.js                      商店/安装/启停/任务/代理
  │    ├─ routes.plugins.js                      只读描述符视图
  │    ├─ routes.toolbox.ui.js                   页面与插件前端资源
  │    └─ static public/
  └─ SQLite（node:sqlite）toolbox_tools / toolbox_tasks / toolbox_artifacts
       共享卷 TOOLBOX_DIR: plugins/ data/ state/ downloads/
  ▼
Python Runtime（Tornado）
  ├─ 共享 Worker（默认）或 Supervisor 每插件子进程（TOOLBOX_ISOLATE_PLUGINS=1）
  ├─ webserver.toolbox.*：NodeClient / storage / CoreAPI / SDK
  └─ data/<tool_id>/config.json（AES-256-GCM）
```

### 1.2 插件核心（`src/core/plugins/`）

| 模块 | 职责 | 4C 是否复用 |
| --- | --- | --- |
| `kernel.js` | 组合 Registry/EventBus/GrantStore/Lifecycle | 复用（不重写） |
| `registry.js` | 实例注册、稳定排序、停用即失效 | 复用 |
| `context.js` | 冻结上下文、身份绑定、逆序释放 | 复用 |
| `lifecycle.js` | 并发启动去重、失败回滚 | 复用 |
| `capability-router.js` | 权限 → Provider → 超时 → 输出校验 | 复用 |
| `runtime-manager.js` | 运行时适配器健康/启停/调用 | 复用 |
| `permissions.js` | GrantStore、权限目录、scope 校验 | 复用（权限 UI 的白名单来源） |
| `adapters/legacy-toolbox.js` | 旧 Toolbox → `/api/plugins` 只读视图 | 复用 |
| `adapters/legacy-runtime.js` | RuntimeManager → Python 运行时 | 复用 |

**关键事实**：Kernel 的 GrantStore 服务内置 Provider（如元数据搜索）；旧 Toolbox 插件的权限来自
`TOOLBOX_DIR/state/grants.json`（`src/core/toolbox/plugin-grants.js`）。这是两套作用域不同的授权，
管理中心不得把它们混成一个“全局权限表”，也不得新建第三套权限库。

### 1.3 Toolbox 核心（`src/core/toolbox/`）

| 模块 | 能力 | 4C 用法 |
| --- | --- | --- |
| `store.js` | 商店索引、SHA 校验下载、安装可用性标注 | 商店/Overview 数据源（只读） |
| `installer.js` | 安装/更新/回滚/卸载/启停、`pending_restart` | 写操作唯一入口（委托） |
| `descriptor.js` | Manifest v1/Legacy 统一描述符、信任级别 | 详情/权限/配置的元数据源 |
| `plugin-grants.js` | `grants.json` 解析、last-good、fail-closed | 权限读取；4C 新增受控写入 |
| `access-policy.js` | legacy-verified / strict / broken | 安全面板展示策略状态 |
| `artifacts.js` | Artifact 归属、路径、SHA、软删除 | 任务结果展示 |
| `config-schema.js` | Schema 校验、敏感字段掩码 | 配置表单校验/掩码 |
| `library.js` | 书籍只读/白名单更新 | 任务结果关联书籍 |
| `tasks.js` | 取消任务、状态下发 | 任务页 |
| `runtime.js` | Node ↔ Python、health、路径自检 | Runtime/安全面板 |
| `manifest.js` / `manifest-v1.js` | Legacy/v1 解析与兼容评估 | 详情/版本/权限声明 |
| `allowlist.js` | reviewed allowlist + SHA | 审核状态；**4C 不修改 allowlist** |

### 1.4 HTTP 现状

- 所有 `/api` 在 `server.js` 中统一经过 `requireSession`（设备会话或管理员 Bearer）。
- `requireAdmin` 只是“写操作也走 `requireSession`”的兼容别名，**不是角色体系**；当前只有单一管理员。
- Cookie 会话写操作有 `Origin`/`Sec-Fetch-Site` 校验；没有独立 CSRF token。
- 管理页面 `/toolbox`、`/toolbox/*` 在静态资源之前被登录守卫拦截（302 到 `/login`）。
- 固定路由先于动态路由：`/api/plugins/runtime`、`/api/plugins/descriptors` 必须写在 `/api/plugins/:id` 之前。
- 插件 iframe 资源走 `/get/tool/:id/*`，CSP `sandbox`，不含 `allow-same-origin`；父页面只转发 manifest 声明的路由。

已存在接口（4C 直接复用，不复制）：

| 接口 | 作用 |
| --- | --- |
| `GET /api/plugins`、`/api/plugins/descriptors`、`/api/plugins/:id/descriptor` | 只读描述符 |
| `GET /api/plugins/runtime` | Kernel RuntimeManager 健康 |
| `GET /api/toolbox/store/index`、`POST /api/toolbox/store/refresh` | 商店 |
| `GET /api/toolbox/installed`、`GET /api/toolbox/list` | 已安装 |
| `POST /api/toolbox/install`、`:id/install`、`:id/update`、`:id/rollback`、`:id/enable`、`:id/disable`、`DELETE :id` | 安装生命周期 |
| `POST /api/toolbox/runtime/restart`、`GET /api/toolbox/runtime` | 运行时 |
| `GET /api/toolbox/tasks`、`/tasks/:id`、`POST /tasks/:id/cancel` | 任务 |
| `GET /api/toolbox/tools/:id/icon`、`ALL /api/toolbox/tool/:id/*` | 图标与插件接口代理 |

缺失（4C 需新增）：Overview、已安装聚合、详情聚合、权限读写、配置读写、版本视图、日志/审计、
任务筛选与结果详情、安全状态汇总。

### 1.5 前端现状

- `public/toolbox.html` + `page-toolbox.js`：商店 / 已安装 / 任务三个 tab，原生 JS、innerHTML 渲染、`fetch` 直连。
- `public/toolbox-tool.html` + `page-toolbox-tool.js`：插件 iframe 外壳（nonce、消息校验、下载、主题/语言）。
- `public/css/toolbox.css`：复用 `style.css` 的 token（`--ink*`、`--hairline*`、`--accent`、`--radius*`、`.btn*`、`.tb-*`）。
- 全局外壳 `chrome.js` 注入顶栏/导航/弹窗/Toast；图标来自 `public/vendor/lucide-sprite.svg` 的 `icon(name,size,stroke,cls)`。
- 无 React/Vue、无构建步骤、无第二套图标库。
- 导航没有“插件”入口；`toolbox.html` 的 `data-page="toolbox"` 也不在 `NAV_ITEMS` 中。

## 2. 目标架构

```text
Plugin Center（新页面 /plugins、/plugins/:id）
  │  纯浏览器，原生 JS + 现有 CSS token
  ▼
/api/plugins/*（新增，全部 requireSession）
  ├─ center.js          只读聚合（Overview/详情/安全快照）
  ├─ 权限：grants-admin.js（唯一写入 grants.json）
  ├─ 配置：runtime 内部接口 + config-schema 校验/掩码
  ├─ 版本：installer 当前/上一版本 + store 最新版本
  └─ 日志：任务/错误/audit.jsonl（不伪造 stdout）
  │
  ├── 复用 store.js / installer.js / descriptor.js / tasks.js / artifacts.js
  ├── 复用 plugin-grants.js 的解析与 fail-closed 语义
  └── 复用 runtime.js / RuntimeManager
  ▼
既有 SQLite / 共享卷 / Python Runtime（不改结构）
```

原则：

1. **不建第二套安装器、权限库、任务库、运行时**。
2. 写操作只做参数校验 + 委托 + 审计，不复制业务逻辑。
3. 新页面是数据的另一个视图；旧 `/toolbox` 保留到 4C.5 验收后再决定是否重定向。
4. 所有安全状态以 Runtime / Node 实际返回为准，前端不做本地开关。

### 2.1 新增模块

```text
src/http/routes.plugins.admin.js     新增读 API + 权限/配置写 API
src/core/plugins/center.js           Overview / 详情 / 安全快照聚合（只读）
src/core/toolbox/grants-admin.js     grants.json 受控读写（校验/原子写/审计）
src/core/toolbox/audit.js            state/audit.jsonl 追加、轮转、脱敏读取
src/core/toolbox/plugin-config.js    Runtime 配置桥（Node 侧）
toolbox-runtime/... 内部配置接口      GET/POST /internal/tool/{id}/config（runtime-secret）
public/plugins.html                  管理中心
public/plugin-detail.html            插件详情
public/js/page-plugins.js            列表/Overview/Store/Installed/Tasks/Settings
public/js/page-plugin-detail.js      详情 5 个 tab
public/js/plugin-center.js           共享格式化/卡片/请求封装
public/js/plugin-config-form.js      Schema 表单（4C.4）
public/css/plugins.css               只补布局，视觉复用 toolbox.css/style.css
test/plugins-admin-api.test.js       新 API 集成测试
test/plugins-audit.test.js           审计与脱敏
```

### 2.2 数据流

**Overview**：`center.js` 读取 `toolbox_tools` 计数 + `toolbox_tasks` running 数 + `store.peekIndex()`（只读缓存，不触发外网）
+ `runtimeHealth()`（短超时，失败降级）+ `policyState()`；不访问插件代码。

**详情**：`descriptorFromRecord()` 提供 manifest/权限/配置 Schema；`toolbox_tools` 提供安装态；
`runtimeHealth()` 提供在线/加载；`store.peekIndex()` 提供最新版本（可空）。

**权限**：读 `grants.json` + descriptor 声明 → 差异；写时校验权限名/scope、只允许声明过的权限，
原子替换 `grants.json`（保留 `grants.last-good.json` 语义），写审计，失败不改文件。

**配置**：Node 校验 Schema → `POST /internal/tool/{id}/config` → Python `storage.get_config/set_config`；
Node 对 `x-sensitive` 字段输出 `******`；保存时 `******` 视为“保持原值”；不存在的字段保留（合并而非覆盖）。

**任务/日志**：任务直接读 `toolbox_tasks` + `artifacts`；错误来自 `last_error`/失败任务；
管理审计写 `state/audit.jsonl`；Runtime stdout 不在本阶段提供（明确标注“需容器日志”）。

## 3. 权限与认证边界

| 边界 | 认证 | 4C 规则 |
| --- | --- | --- |
| 管理页面 `/plugins`、`/plugins/:id` | 设备会话（未登录 302） | 加入 `MANAGEMENT_PAGES` |
| 管理 API `/api/plugins/*` | `requireSession` | 只读 + 受控写；全部 no-store |
| 旧写接口 `/api/toolbox/*` | `requireSession` | 保持唯一写入实现；4C 只加审计 |
| 插件 iframe `/get/tool/:id/*` | 公开静态 + sandbox | 不改 CSP |
| 插件 → Node `/internal/toolbox/*` | 共享密钥或插件令牌 | 不向管理端暴露 |
| Runtime 配置桥 `/internal/tool/:id/config` | `X-Mybooks-Runtime-Secret` | 仅 Node 调用；不执行插件代码 |

认证事实：当前没有角色/多用户；UI 不显示“用户/角色/协作者”，只显示“管理员会话”。
写操作无需新 CSRF token，但必须：仅 POST/PUT/DELETE、同源、`SameSite=Lax`、禁止 GET 变更。

## 4. 安全约束

1. 不展示宿主绝对路径、internal-secret、插件令牌、配置明文、原始堆栈。
2. 敏感配置只返回 `******`；保存掩码值不得覆盖原值。
3. 权限写入只接受 `permissions.js` 目录内的权限名 + 合法 scope；未声明权限默认拒绝授权。
4. `grants.json` 写入必须原子（tmp + rename）、保留 last-good，并写审计；损坏时维持 fail-closed。
5. 未审查插件：只展示、不提供绕过安装；`MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=true` 只作为风险提示展示。
6. 共享 Worker：必须显示 `isolation_mode`、`uid_isolation`、跨插件文件访问风险；
   未审查插件 + 共享 Worker 时给出高风险横幅。
7. **Z-Library 0.1.1 不进入 reviewed allowlist**；UI 显示“未审查/不可自动安装”，
   不提供“强制安装”按钮；其重定向与 DNS 问题由上游单独修复。
8. 版本页只展示真实存在的“当前版本 + 一个回滚目标 + 商店最新版本”；没有 changelog 就不渲染更新说明。
9. 商店不编造评分、下载量、分类；索引没有的字段一律不显示。
10. 审计日志脱敏（令牌、Cookie、Authorization、配置值），1MB 轮转，最多保留 3 份。

## 5. 兼容策略

- 旧 `/toolbox` 页面、`/api/toolbox/*`、Bridge v1、BaseTool/BaseHandler、Legacy Manifest 全部保留。
- 新 API 只加不改；现有 `/api/plugins`、`/api/plugins/runtime` 的字段保持，新增字段只做加法。
- 新页面与旧页面共享同一数据源；旧页面不删除，直到 4C.5 验收通过并由维护者决定是否 301。
- 不引入新框架、新 CSS 体系、新图标库；新图标必须进 `scripts/lucide-icons.json` 并通过 `npm run check:icons`。
- 不实施 4D UI Slot、Bridge v2、Plugin/route 装饰器。

## 6. 关键设计决策

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| D1 | 新增 `/plugins`，保留 `/toolbox` | 可回滚；旧工具 iframe 深链不变 |
| D2 | 读走 `/api/plugins/*`，写委托 `/api/toolbox/*` | 不复制安装器，避免双份业务逻辑 |
| D3 | 权限写入只改 `grants.json` | 现有唯一事实来源；不建权限数据库 |
| D4 | 配置经 Runtime 内部接口 | 配置由 Python AES-GCM 加密；Node 不复制密钥逻辑 |
| D5 | 日志只展示真实来源 | 不伪造 stdout；Runtime 日志明确提示查看容器日志 |
| D6 | 只允许授予 Manifest 声明过的权限 | 防止管理中心扩大插件能力 |
| D7 | 分类/更新说明不做占位 | 商店索引暂无这些字段，不能编造 |
| D8 | zlibrary 0.1.1 维持未审查 | 4B-R 安全结论；上架前需上游修复 |

## 7. 架构风险与缓解

| 编号 | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | 新旧两套 UI 状态不一致 | 中 | 同一数据源、写操作委托、旧页面保留仅作回退 |
| R2 | 配置桥扩大 Runtime 攻击面 | 中 | 仅 runtime-secret、仅 JSON、大小上限、无插件代码执行、只读写 config |
| R3 | 权限文件并发写/损坏 | 高 | 原子写、last-good、写入前校验、`if_version` 冲突检测、审计 |
| R4 | 审计日志包含敏感值 | 中 | 字段白名单 + 脱敏 + 轮转 |
| R5 | “运行日志”能力被高估 | 低 | 文案明确只提供错误/任务/审计，stdout 指向容器日志 |
| R6 | 商店外网失败拖慢 Overview | 中 | `peekIndex()` 只读缓存；失败显示不可用，不阻塞 |
| R7 | 单一管理员被误认为角色体系 | 中 | 文档与 UI 明确“管理员会话”，不提供角色管理 |
| R8 | 新增动态路由遮蔽静态路由 | 中 | 静态路由先注册；`:id` 用 `TOOL_ID_RE` 校验 |
| R9 | 未审查插件绕过安装门禁 | 高 | UI 不提供强制安装；安装仍由 installer + allowlist 拒绝 |
| R10 | 配置合并覆盖插件私有数据（如 accounts） | 中 | 服务端先读全量、仅合并 Schema 字段，未知字段保留 |
| R11 | Runtime 离线导致详情/配置页空白 | 低 | 明确降级态：只读元数据可用，配置显示“运行时离线” |
| R12 | 旧导航无插件入口 | 低 | 4C.3 在 `NAV_ITEMS` 增加“插件”，不影响旧页面 |

## 8. 实施顺序

1. **4C.2 后端管理 API**：聚合服务、路由、任务筛选、审计基础设施。
2. **4C.3 插件中心前端**：新页面/导航/Overview/Store/Installed/Tasks/详情骨架。
3. **4C.4 权限、配置、日志**：grants 写入、Runtime 配置桥、Schema 表单、审计/日志视图。
4. **4C.5 集成与验收**：真实插件、响应式、安全负向、回归与文档。

详细任务、文件、测试与验收见 [tasks.md](tasks.md)；
页面与组件见 [UI-SPEC.md](UI-SPEC.md)；接口见 [API-SPEC.md](API-SPEC.md)。

## 9. 实施状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 4C.1 架构审查与规格 | ✅ 完成 | 四份设计文档；未改业务代码 |
| 4C.2 后端只读管理 API | ✅ 完成 | `center.js`、`routes.plugins.admin.js`、`audit.js`、`peekIndex`、任务筛选、Runtime 安全视图；只读配置桥 GET |
| 4C.3 前端 | ○ 未开始 | `/plugins`、`/plugins/:id`、导航、页面路由 |
| 4C.4 权限/配置写入 | ○ 未开始 | `PUT permissions`、`PUT config`、`grants-admin.js`、Schema 表单 |
| 4C.5 集成验收 | ○ 未开始 | 真实插件、响应式、安全负向、回归 |

4C.2 的实际数据来源、路径与兼容说明见 [API-SPEC.md](API-SPEC.md#14-phase-4c2-实施状态2026-11-10)；
文件与测试结果见 [tasks.md](tasks.md#实施结果4c22026-11-10)。
