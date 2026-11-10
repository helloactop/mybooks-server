# Phase 4C 插件管理中心：任务分解

> 基线：`6fab21b4`；4C.1 只产出设计文档，不改业务代码。
> 依赖顺序：4C.2 → 4C.3 → 4C.4 → 4C.5；4C.3 可与 4C.4 部分并行，但详情页骨架必须先落地。

## 4C.1 设计与审查（本阶段）

- [x] 核对 Git 基线（`6fab21b4`，与远端一致）
- [x] 审查 `src/core/plugins/`、`src/core/toolbox/`、`src/http/`
- [x] 审查 `public/` 的 Toolbox 页面、JS、CSS 与导航
- [x] 输出 `spec.md`、`tasks.md`、`UI-SPEC.md`、`API-SPEC.md`
- [x] 4C.2 开发指令已下达

验收：四份文档可直接指导 4C.2–4C.5；不修改业务代码、不新增依赖、不改 allowlist。

---

## 4C.2 后端管理 API

### 目标

在不复制安装/权限/任务逻辑的前提下，提供 Overview、已安装聚合、详情、版本、任务筛选与安全快照。

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `src/core/toolbox/store.js` | 新增 `peekIndex()`：只读 60 分钟缓存，不触发网络 |
| `src/db/toolbox.js` | `listTasks` 支持 `toolId`、`offset`；新增 `countTasks` |
| `src/core/plugins/center.js` | 新增：overview、installed、detail、versions、security 聚合（只读） |
| `src/http/routes.plugins.admin.js` | 新增路由：`overview`、`store/*`、`installed`、`:id`、`:id/versions`、`tasks`、`tasks/:id`、`security`；扩展 `/api/plugins/runtime` |
| `src/http/routes.plugins.js` | 仅在需要时把 `runtime` 处理移到 admin 路由；保持原响应字段 |
| `src/http/routes.toolbox.js` | 任务列表增加 `tool_id`/`offset` 参数；生命周期写操作接审计 |
| `src/core/toolbox/audit.js` | 新增：JSONL 追加、1MB 轮转、脱敏、读取 |
| `server.js` | `MANAGEMENT_PAGES` 加入 `/plugins`；在 `routesPlugins` 之后挂 `routesPluginsAdmin` |
| `test/plugins-admin-api.test.js` | 新增集成测试（真实 express + 临时 SQLite） |

### 依赖

- 4C.1 文档（本文件/API-SPEC）。
- 无新 npm 依赖。

### 测试

1. `GET /api/plugins/overview`：计数、runtime 离线降级、store 无缓存时 `updates_available=null`。
2. `GET /api/plugins/installed`：状态映射（enabled/disabled/pending_restart/last_error）。
3. `GET /api/plugins/:id`：404/非法 ID/正常 DTO 不含 `raw`、路径、令牌。
4. `GET /api/plugins/:id/versions`：仅有 current/latest/rollback，不虚构历史。
5. `GET /api/plugins/tasks?tool_id=&status=&limit=&offset=`：过滤与 `total`。
6. `GET /api/plugins/tasks/:id`：Artifact 列表不含 `rel_path`。
7. `GET /api/plugins/security`：字段与 Runtime health 一致；共享 Worker + 未审查 → `risk=high`。
8. 未登录 401；非法 ID 400；不存在的工具 404。
9. 审计：安装/启停/卸载/重启写入 `audit.jsonl`，不含令牌/配置值。

### 验收

- 新接口全部只读（除审计写入），不改变旧接口行为。
- `npm test` 全绿；新增测试至少覆盖以上 9 项。
- 响应时间：Overview 在 Runtime 离线（3s 超时）下仍可返回其余字段。

### 实施结果（4C.2，2026-11-10）

- [x] `src/core/toolbox/store.js`：新增 `peekIndex()`（只读缓存，不触发网络）
- [x] `src/db/toolbox.js`：`listTasks` 支持 `toolId/offset/maxLimit`；新增 `countTasks`、`taskCounts`（GROUP BY）
- [x] `src/core/plugins/center.js`：overview / store / installed / detail / permissions / config / versions / tasks / logs / security / runtimeAndSecurity
- [x] `src/http/routes.plugins.admin.js`：固定段先于 `:id`；统一 `{ error: { code, message } }` 错误
- [x] `src/http/routes.plugins.js`：`/api/plugins/runtime` 追加 `toolbox`/`security`，保留旧字段
- [x] `src/core/toolbox/audit.js`：JSONL 追加、串行写、8KB 行上限、1MB 轮转 ×3、脱敏、分页
- [x] `src/http/routes.toolbox.js`：install/update/rollback/enable/disable/uninstall/runtime.restart 接入审计（未新增写入口）
- [x] `toolbox-runtime/runtime.py`：新增只读 `GET /internal/tool/:id/config`（共享 Worker 与 supervisor 均注册）
- [x] `server.js`：`routesPluginsAdmin` 挂在 `routesPlugins` 之后
- [x] 测试：`test/plugins-center.test.js`、`test/plugins-audit.test.js`、`test/plugins-admin-api.test.js`；Runtime `test_runtime.py` 新增 2 项

与规划的差异：

1. 配置读取所需的 Runtime 桥在 4C.2 提前实现为 **GET only**；`PUT` 与配置合并仍留 4C.4。
2. 未修改 `/api/toolbox/tasks` 的参数；任务筛选只在新的 `/api/plugins/tasks` 提供，避免改变旧接口语义。
3. 未新增 `MANAGEMENT_PAGES`/页面路由；前端属 4C.3。
4. `docs/plugins/phase4/spec.md` 不存在，本轮更新 `4C/spec.md` 与 `API-SPEC.md` 的实施状态。

实测：`npm test` 825/825；Runtime `python -m unittest discover -s tests` 75 项 OK（10 skipped）。

---

## 4C.3 插件中心前端

### 目标

落地 `/plugins` 与 `/plugins/:id` 的信息架构、导航与主流程；权限/配置/日志先留占位 tab。

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `public/plugins.html` | 新页面：hero + tabs + 五个 panel |
| `public/plugin-detail.html` | 新页面：详情头部 + 五个 tab |
| `public/js/plugin-center.js` | 共享：请求、格式化、徽章、卡片、确认弹窗、空/错状态 |
| `public/js/page-plugins.js` | Overview/Store/Installed/Tasks/Settings 渲染与动作委托 |
| `public/js/page-plugin-detail.js` | 详情：概览/版本先行；权限/配置/日志占位 |
| `public/css/plugins.css` | `.pc-*` 布局与响应式；复用 `.tb-*`/`.btn*` |
| `public/js/chrome.js` | `NAV_ITEMS` 增加“插件” |
| `src/http/routes.toolbox.ui.js` | 新增 `/plugins`、`/plugins/:id` 页面路由（ID 校验） |
| `server.js` | 管理页面守卫覆盖 `/plugins`、`/plugins/*` |
| `test/plugins-ui-routes.test.js` | 页面 200 / 非法 ID 重定向 / 未登录 302 |

### 依赖

- 4C.2 的 overview/installed/store/detail/versions/security。

### 测试

1. 未登录访问 `/plugins` → 302 `/login?next=...`；登录后 200。
2. 非法 `/plugins/BAD_ID` → 重定向 `/plugins`。
3. 商店：搜索/排序/刷新；未审查禁用；不渲染分类/评分/下载量。
4. 已安装：启用/停用/更新/回滚/卸载调用既有 `/api/toolbox/*`，状态刷新。
5. Overview 指标与 `toolbox_tools`/`toolbox_tasks` 一致。
6. 详情概览/版本字段与 API 一致；无虚构更新说明。
7. 窄屏 390px、平板 820px、桌面 1440px 无横向滚动；tab 可键盘操作。
8. 旧 `/toolbox` 与新页面数据一致（同一工具状态）。

### 验收

- 主流程可用：商店 → 安装 → 重启 → 已安装 → 打开 → 任务。
- 不引入新框架/图标库；只使用 `style.css`/`toolbox.css` token 与 Lucide sprite。
- 所有按钮无“假动作”；未实现 tab 显示明确占位，不展示假数据。

### 实施结果（4C.3，2026-11-10）

新增：

- `public/plugins.html`、`public/plugin-detail.html`：中心五个 tab 与详情五个 tab，均带加载/空/错误/离线态。
- `public/js/plugin-center.js`：共享转义、URL 白名单、状态映射、安装门禁、确认弹窗、请求封装；浏览器挂 `window.MyBooksPlugins`，Node 下导出同名对象供单测。
- `public/js/page-plugins.js`：总览（指标/Runtime/安全/最近错误）、商店（250ms 防抖搜索、三种排序、刷新）、已安装（5 种筛选与生命周期操作）、任务（工具/状态筛选、分页、详情弹窗、可见性感知轮询）、设置（只读部署信息 + 复制建议）。
- `public/js/page-plugin-detail.js`：概览/权限/配置/版本/日志；未安装插件回落到商店详情。
- `public/css/plugins.css`：只补 `.pc-*` 布局与两点响应式（1080/820/640），视觉 token 复用既有体系。
- `test/plugins-ui-routes.test.js`（9 项）、`test/plugins-center-ui.test.js`（12 项）。

修改：

- `src/http/routes.toolbox.ui.js`：`GET /plugins`、`GET /plugins/:id`（非法 ID 回列表）。
- `server.js`：`/plugins`、`/plugins.html`、`/plugin-detail.html` 纳入管理页面登录守卫。
- `public/js/chrome.js`：导航新增“插件”，`plugin-detail` 映射到 `plugins` 高亮；插件页不渲染“添加书籍”。
- `public/js/overlay.js`：`#addBtn` 绑定加空值保护。

数据来源：全部来自 4C.2 只读 API；写操作只调用既有 `/api/toolbox/*`，未新增写入口。

浏览器验收：真实登录后完成总览、四个 tab 切换、`/plugins/zlibrary` 未安装回落、顶栏搜索/移动端菜单；控制台无报错。390px 视口未能调整（工具限制），该断点仅做 CSS 静态核对，标记为未验证。

测试：`npm test` 846/846；Python SDK 35/35；Runtime 75 OK（10 skipped）。

已知未完成：权限与配置保存（4C.4）、完整 Schema 表单、日志 stdout（接口不提供）、旧 `/toolbox` 顶栏同款按钮问题未修。

---

## 4C.4 权限、配置、日志与审计

### 目标

补齐详情页三个能力：权限授权、Schema 配置、真实日志/审计。

### 4C.4.1 权限

| 文件 | 改动 |
| --- | --- |
| `src/core/toolbox/grants-admin.js` | 新增：读取差异、校验、原子写入、`if_version`、审计 |
| `src/http/routes.plugins.admin.js` | `GET/PUT /api/plugins/:id/permissions` |
| `public/js/page-plugin-detail.js` | 权限 tab：勾选、scope、风险确认、保存 |
| `test/plugins-admin-api.test.js` | 权限用例 |

规则：只授予 Manifest 声明权限；资源型必须带 scope；`******` 不适用；
`policy_state=absent` 保存后进入 strict；`broken` 禁止写；写入失败不改文件。

测试：合法授权生效（内部接口从 403 → 200）、撤销生效、未声明权限 400、
非法 scope 400、并发 `if_version` 409、文件损坏时 fail-closed 不变。

### 4C.4.2 配置

| 文件 | 改动 |
| --- | --- |
| `toolbox-runtime/runtime.py` | 新增 `/internal/tool/{id}/config` GET/POST（runtime-secret、JSON、1MB 上限） |
| `toolbox-runtime/webserver/toolbox/storage.py` | 复用 `get_config/set_config`；不新增存储 |
| `src/core/toolbox/plugin-config.js` | 新增：Node 侧读取/合并/掩码/校验/写审计 |
| `src/http/routes.plugins.admin.js` | `GET/PUT /api/plugins/:id/config` |
| `public/js/plugin-config-form.js` | 新增：Schema → 原生表单，错误映射，掩码 |
| `test/plugins-config-api.test.js` | 新增：掩码、校验、合并、离线降级 |

规则：敏感字段只返回 `******`；保存 `******` 视为保持原值；未知字段保留；
Runtime 离线 503；无 Schema 404；不执行插件代码。

测试：真实 runtime 容器/进程内读写 `config.json` 加密落盘；非法枚举/必填/类型 400；
敏感值不泄露；`accounts` 等未声明字段不被覆盖。

### 4C.4.3 日志与审计

| 文件 | 改动 |
| --- | --- |
| `src/core/toolbox/audit.js` | 读取/过滤/脱敏/轮转完善 |
| `src/http/routes.plugins.admin.js` | `GET /api/plugins/:id/logs` |
| `src/http/routes.toolbox.js` | 生命周期写操作审计（若 4C.2 未全接） |
| `public/js/page-plugin-detail.js` | 日志 tab：错误/任务/审计切换 |
| `test/plugins-audit.test.js` | 新增：脱敏、轮转、分页、越权 |

测试：令牌/Cookie/绝对路径不出现在响应；`limit>200` 被夹紧；轮转最多 3 份；
任务消息超长截断；Runtime 日志提示文案存在。

### 验收

- 权限/配置/日志三个 tab 全部由真实 API 驱动，无本地伪造。
- 权限保存立即影响内部接口；配置保存后插件读取到新值且密文落盘。
- 所有管理写操作可在审计中追溯（actor=admin、action、tool_id、result）。

### 实施结果（4C.4，2026-11-10）

新增：

- `src/core/toolbox/grants-admin.js`：权限目录（含风险等级）、请求归一化、Manifest 声明校验、
  scope 校验、差异计算、串行队列、原子写入、`if_version`、last-good 刷新、审计。
- `src/core/toolbox/plugin-config.js`：配置读写桥（掩码、字段级合并、必填完整性与版本检查），
  支持依赖注入假 Runtime 以做单测。
- `public/js/plugin-config-form.js`：Schema → 字段模型、类型/范围/枚举校验、提交内容计算。
- 测试：`test/plugins-permissions-admin.test.js`（11）、`test/plugins-config-admin.test.js`（10）、
  `test/plugins-audit-integration.test.js`（6）、`test/plugins-detail-ui.test.js`（10）、
  `test/plugins-admin-write-api.test.js`（1 个集成用例含 6 个子断言组）。

修改：

- `src/core/toolbox/plugin-grants.js`：新增 `POLICY_VERSION`、`invalidateCache()`、`readPolicyDocument()`。
- `src/core/toolbox/config-schema.js`：`validateConfig(..., { partial })`，规则不变，仅跳过 required。
- `src/core/toolbox/audit.js`：`list()` 支持 `since` 时间过滤。
- `src/core/plugins/center.js`：权限视图追加 `catalog`/`write_supported`/`can_modify`；
  配置视图改由 `plugin-config` 提供（仍复用注入的 Runtime 依赖）；审计日志追加 `actor`/`result` 与 `since`。
- `src/http/routes.plugins.admin.js`：新增两个 PUT；`fail()` 支持带 `details` 的 4xx 业务错误。
- `toolbox-runtime/runtime.py`：`InternalConfigHandler` 增加 PUT（进程内锁 + 版本校验 + 字段合并）；
  GET 返回 `version`。
- `toolbox-runtime/webserver/toolbox/storage.py`：新增 `config_version()`（键排序 JSON 的 SHA-256）。
- `public/plugin-detail.html`、`public/js/page-plugin-detail.js`、`public/css/plugins.css`：
  权限开关/scope/保存条、Schema 表单、清除敏感字段、日志时间范围与操作人展示。

与规划的差异：

1. 请求体使用 `permissions: [{name, scope}]` 而非 `grants: ["name:scope"]`，避免前端自行拼接与解析。
2. 错误码统一为 `PERMISSION_NOT_DECLARED` / `POLICY_VERSION_CONFLICT` / `POLICY_BROKEN` /
   `POLICY_NOT_WRITABLE` / `CONFIG_VALIDATION_FAILED` / `CONFIG_VERSION_CONFLICT`，
   与 4C.1 草案不同，API-SPEC 已按实际实现更新。
3. 配置写入采用 Runtime 侧 PUT（字段级合并）而不是 POST 整份覆盖；Node 不做 AES-GCM。
4. `last-good` 状态明确禁止写入（避免把不可信快照当成可覆盖的基线），需人工修复文件。

实测：`npm test` 890/890；Python SDK 35/35；Runtime 79 项 OK（10 skipped）；
Docker 镜像内 Runtime 79 项 OK（1 skipped），并真实调用容器 `PUT/GET /internal/tool/:id/config` 验证哈希一致；
浏览器真实登录完成权限授予与配置保存、审计查看。

未完成：配置历史/diff 视图；运行时 stdout 采集；`network.*` 等未强制权限仍只做展示。

### 4C.4-R 安全修复（2026-11-10）

详情见 [remediation.md](remediation.md)。摘要：

- P1-1：权限写入增加 Manifest scope 语义校验（`scopeCovers`），拒绝 `book:1 → *`、
  `artifact:1 → artifact:*`、跨资源类型与历史越权保留；权限视图新增 `out_of_range`。
- P1-2：Runtime 配置桥按启动时绑定的插件身份拒绝跨插件 GET/PUT（`CROSS_PLUGIN_DENIED`），
  Supervisor/宿主路径不受影响。
- P2-1：配置损坏/密钥不可读显式失败，不再降级为空对象；密钥创建改为独占创建。
- P2-2：配置文件不存在时 GET/PUT 版本统一为空串，首次保存不再 409。
- P2-3：权限/配置写入响应携带 `audit.ok`，审计失败显式提示且不回滚业务写入。
- P2-4：`array`/`object` 字段只读展示，永不提交为字符串。

新增测试：`plugins-scope-boundary`（9）、`plugins-config-first-save`（8）、
`plugins-audit-failure`（5）、`plugins-detail-ui`（+2）、`test_config_identity.py`（7）、
`test_storage_recovery.py`（9）。

实测：Node 914/914；Python SDK 35/35；Runtime 95（10 skipped）；Docker 95（1 skipped）。

---

## 4C.5 集成与验收

### 内容

1. 真实插件：
   - `md_to_epub 1.1.0`：安装、详情、权限、配置、转换、任务、卸载。
   - `zlibrary 0.1.1`：仅验证未审查展示、不可自动安装、共享 Worker 风险横幅；
     **不加入 allowlist**。
2. 浏览器验收：桌面 1440、平板 820、手机 390；深色/浅色；键盘 tab。
3. 安全负向：
   - 未登录/跨站写/非法 ID/越权授予未声明权限/超大分页/日志注入字符。
   - `allow_unreviewed=true` 时必须显示高风险横幅（不提供关闭按钮）。
4. 回归：
   - `npm test`、Python SDK、Runtime 全量通过。
   - 旧 `/toolbox` 与 `/api/toolbox/*` 行为不变。
   - Bridge v1 / 插件 iframe / 下载 / 入库不受影响。
5. 文档：更新 `docs/plugins/STATUS.md`、`phase4/ROADMAP.md` 的 4C 状态；
   新增 `docs/plugins/phase4/4C/verification.md`（验收报告格式同 4B）。

### 验收标准

1. Plugin Center 的 Overview/Store/Installed/Tasks/Settings 全部可用。
2. 详情页 5 个 tab 全部真实数据；未实现能力明确标注。
3. 安装/更新/回滚/启停/卸载没有第二套实现，全部委托既有 installer。
4. 权限差异可授权/撤销并立即生效；新增权限默认不勾选。
5. 配置不回显敏感字段；Schema 校验错误可定位到字段。
6. 安全面板与 Runtime 实际返回值一致；共享 Worker 风险可见。
7. zlibrary 0.1.1 仍为未审查且不可自动安装。
8. 旧页面/旧 API/Bridge v1 无回归。
9. 文档与实际一致，所有示例可执行或明确标为未来设计。

### 回滚方案

- 后端新增路由为附加；移除 `server.js` 中 `routesPluginsAdmin` 挂载即可恢复。
- 前端新增页面独立；移除导航项即回到 `/toolbox`。
- 不修改旧表结构；审计文件可删除，不影响插件运行。
- 权限写入有 `grants.last-good.json`；异常时可手工还原上一份。

## 5. 风险检查表（开发时必须逐项确认）

- [ ] 没有新增第二套安装器/权限库/任务库/运行时。
- [ ] 没有复制 `/api/toolbox/*` 的业务逻辑。
- [ ] 没有把未实现能力标为完成。
- [ ] 没有修改 allowlist 让 zlibrary 0.1.1 通过。
- [ ] 没有新增 React/Vue/CSS 框架/图标库。
- [ ] 没有展示绝对路径、令牌、配置明文、堆栈。
- [ ] 没有把 GET 用作状态变更。
- [ ] 新动态路由没有遮蔽 `runtime/store/installed/tasks/security` 等静态路由。
