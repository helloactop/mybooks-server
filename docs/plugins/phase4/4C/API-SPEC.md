# Phase 4C 插件管理中心：API 规格

> 基线：`6fab21b4`（4B-R 已完成）
> 所有 `/api/plugins/*` 均挂在 `server.js` 的 `app.use('/api', requireSession)` 之后。
> 响应统一 `Cache-Control: no-store`；错误统一 `{ error, code }`。
> 写操作只做参数校验 + 委托 + 审计，不复制安装器/权限库/任务库。

## 1. 接口总览

| 类别 | 接口 | 状态 |
| --- | --- | --- |
| 概览 | `GET /api/plugins/overview` | **4C.2 已实现** |
| 商店 | `GET /api/plugins/store/index` | **4C.2 已实现**（复用 `store.js`） |
| 商店 | `GET /api/plugins/store/:id` | **4C.2 已实现** |
| 已安装 | `GET /api/plugins/installed` | **4C.2 已实现**（聚合 descriptor + 安装态 + runtime） |
| 详情 | `GET /api/plugins/:id` | **4C.2 已实现** |
| 权限 | `GET /api/plugins/:id/permissions` | **4C.2 已实现** |
| 权限 | `PUT /api/plugins/:id/permissions` | **未实现（4C.4）** |
| 配置 | `GET /api/plugins/:id/config` | **4C.2 已实现**（Runtime 桥，只读） |
| 配置 | `PUT /api/plugins/:id/config` | **未实现（4C.4）** |
| 版本 | `GET /api/plugins/:id/versions` | **4C.2 已实现** |
| 日志 | `GET /api/plugins/:id/logs` | **4C.2 已实现** |
| 任务 | `GET /api/plugins/tasks` | **4C.2 已实现**（复用 `toolbox_tasks`） |
| 任务 | `GET /api/plugins/tasks/:id` | **4C.2 已实现** |
| 运行时 | `GET /api/plugins/runtime` | **4C.2 已扩展**（保留原字段，加 `toolbox`/`security`） |
| 安全 | `GET /api/plugins/security` | **4C.2 已实现** |
| 描述符 | `GET /api/plugins`、`/descriptors`、`/:id/descriptor` | 已存在，复用 |
| 商店 | `GET /api/toolbox/store/index`、`POST .../store/refresh` | 已存在，复用 |
| 已安装 | `GET /api/toolbox/installed` | 已存在，复用 |
| 安装 | `POST /api/toolbox/install`、`/api/toolbox/:id/install` | 已存在，**唯一写入** |
| 更新/回滚 | `POST /api/toolbox/:id/update`、`/:id/rollback` | 已存在，**唯一写入** |
| 启停 | `POST /api/toolbox/:id/enable`、`/:id/disable` | 已存在，**唯一写入** |
| 卸载 | `DELETE /api/toolbox/:id?purge_data=1` | 已存在，**唯一写入** |
| 重启 | `POST /api/toolbox/runtime/restart` | 已存在，复用 |
| 任务 | `GET /api/toolbox/tasks`、`/:id`、`POST /:id/cancel` | 已存在，复用/扩展筛选 |
| 图标 | `GET /api/toolbox/tools/:id/icon` | 已存在，复用 |
| 插件代理 | `ALL /api/toolbox/tool/:id/*` | 已存在，复用 |
| 安装上传 | `POST /api/toolbox/install/upload`、`/:id/update/upload` | 已存在；**4C UI 不暴露**（仅开发/运维） |

**暂不新增**：`POST /api/plugins/:id/install|update|rollback|enable|disable`、`DELETE /api/plugins/:id`。
理由：会形成第二套写入口与审计重复；前端直接调用上表既有 `/api/toolbox/*`。
若 4C.5 验收后确需统一命名，只做 308 重定向/薄别名，不复制逻辑。

## 2. 鉴权与通用约定

- 认证：设备会话 Cookie 或 `Authorization: Bearer <admin token>`；未登录 `401 AUTH_REQUIRED`。
- 写请求（PUT/POST/DELETE）在无 Bearer 时校验 `Origin` / `Sec-Fetch-Site`；拒绝跨站。
- 不存在角色体系：只有“管理员会话”，接口不接收 `role`/`user_id`。
- `:id` 必须匹配 `^[a-z0-9_]{1,64}$`；非法 → `400 TOOL_ID_INVALID`；未安装 → `404 TOOL_NOT_INSTALLED`。
- 路由注册顺序：`overview / store / installed / tasks / runtime / security` 等静态段先于 `/:id`。
- 所有响应不得包含：绝对路径、`internal-secret`、插件令牌、配置明文、堆栈。

通用错误：

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `TOOL_ID_INVALID` | ID 不合法 |
| 401 | `AUTH_REQUIRED` | 未登录 |
| 403 | `ORIGIN_REJECTED` | 跨站写请求 |
| 404 | `TOOL_NOT_INSTALLED` / `STORE_NOT_FOUND` / `TASK_NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 状态冲突（并发/版本） |
| 429 | `RATE_LIMITED` | 认证失败限速 |
| 503 | `RUNTIME_UNAVAILABLE` | Python 运行时离线 |

## 3. GET /api/plugins/overview

参数：无。只读缓存，不主动访问外网。

```json
{
  "generated_at": "2026-11-10T03:00:00.000Z",
  "counts": {
    "installed": 2, "enabled": 2, "disabled": 0,
    "pending_restart": 0, "failed": 0, "updates_available": 1
  },
  "tasks": { "running": 1, "completed": 12, "failed": 2, "cancelled": 0 },
  "runtime": {
    "online": true, "status": 200, "error": "",
    "isolation_mode": "shared", "isolated": false,
    "plugin_auth_only": false, "uid_isolation": false
  },
  "security": {
    "policy_state": "ok", "reviewed": 1, "unreviewed": ["zlibrary"],
    "allow_unreviewed": false, "shared_worker_risk": "high"
  },
  "store": { "available": true, "fetched_at": "...", "error": "", "entry_count": 3 },
  "recent_errors": [
    { "tool_id": "zlibrary", "code": "CONVERT_FAILED", "message": "…", "at": "..." }
  ]
}
```

- `updates_available` 依赖 `store.peekIndex()` 缓存；无缓存/商店不可用时为 `null`。
- `recent_errors` 合并：`toolbox_tools.last_error` + 最近失败任务（最多 5 条），消息截断 300 字符。

## 4. 商店

### GET /api/plugins/store/index?q=&sort=&refresh=1

| 参数 | 说明 |
| --- | --- |
| `q` | 模糊匹配 `tool_id` / `name` / `author` / `description`，≤100 字符 |
| `sort` | `name`（默认）/ `updated` / `installed` |
| `refresh=1` | 强制刷新；否则使用 60 分钟缓存 |

返回：

```json
{
  "store_url": "https://mybooks.top/toolbox/fulllist.json",
  "fetched_at": "...", "cached": false, "error": "",
  "tools": [{
    "tool_id": "md_to_epub", "name": "Markdown转EPUB", "description": "…",
    "author": "黏菌", "publish_date": "2026-09-15",
    "latest_revision": "1.1.0", "core_api_version": "1.3.0",
    "repo_url": "https://…", "icon_url": "https://mybooks.top/…",
    "reviewed": true,
    "review": { "reviewed_at": "2026-11-09", "notes": "…", "limitations": ["…"] },
    "compatibility": { "supported": true, "reasons": [], "warnings": [] },
    "installed": { "revision": "1.1.0", "enabled": true, "update_available": false, "installed_at": "…" },
    "installable": false, "blocked_reasons": []
  }]
}
```

- 不返回评分、下载量、分类、changelog（索引没有这些字段）。
- 商店不可用时 `tools` 可为空、`error` 非空，HTTP 仍 200（与现有商店一致）。

### GET /api/plugins/store/:id

```json
{ "tool": { ...同上条目... }, "latest_only": true }
```

未收录 → `404 STORE_NOT_FOUND`。

## 5. 已安装与详情

### GET /api/plugins/installed

```json
{
  "runtime": { "online": true, "plugins": ["md_to_epub"] },
  "tools": [{
    "tool_id": "md_to_epub", "name": "Markdown转EPUB",
    "revision": "1.1.0", "source": "store", "enabled": true,
    "pending_restart": false, "last_error": "",
    "installed_at": "…", "updated_at": "…",
    "manifest_version": 1,
    "trust": "reviewed",
    "compatibility": { "supported": true, "reviewed": true, "reasons": [], "warnings": [] },
    "runtime_status": "loaded",
    "update_available": false, "latest_revision": "1.1.0",
    "rollback_available": false,
    "has_frontend": true
  }]
}
```

`runtime_status`：`loaded` / `not_loaded` / `runtime_offline` / `disabled`。
`latest_revision` 来自商店缓存，缺失时 `null`。

### GET /api/plugins/:id

```json
{
  "plugin": { "...": "toPublicDescriptor() 结构，含 identity/runtime/permissions/configuration/ui/compatibility/trust/source" },
  "installed": {
    "revision": "1.1.0", "enabled": true, "pending_restart": false,
    "last_error": "", "source": "store", "installed_at": "…", "sha256": "…"
  },
  "runtime": { "online": true, "loaded": true, "isolation_mode": "shared" },
  "latest": { "revision": "1.1.0", "reviewed": true },
  "rollback": { "available": false, "revision": "" },
  "task_counts": { "running": 0, "failed": 1, "total": 5 }
}
```

## 6. 权限

### GET /api/plugins/:id/permissions

```json
{
  "policy_state": "ok",
  "configured": true,
  "strict": true,
  "version": "sha256:…",
  "requested": [{
    "name": "books.read", "scope": "library:all", "reason": "搜索书库",
    "resource_scoped": true, "enforced": true
  }],
  "granted": ["books.read:library:all", "jobs.create"],
  "effective": [{ "permission": "books.read", "scope": "library:all" }],
  "unenforced": ["network.public"],
  "warnings": []
}
```

- `policy_state`：`absent` / `ok` / `last-good` / `broken`（来自 `plugin-grants.js`）。
- `absent` 时 `strict=false`、`configured=false`，并给出警告：
  `“该插件尚未配置 grants.json，Legacy 兼容模式下声明权限不会被裁剪”`。
- `broken` 时 `strict=true` 且全部拒绝，提示管理员修复策略文件。
- `unenforced` 来自 `descriptor.UNENFORCED_PERMISSIONS`（如 `network.*`），不得声称已强制。

### PUT /api/plugins/:id/permissions

> 实施状态：4C.4 已实现（`src/core/toolbox/grants-admin.js`）。以下为实际契约。

请求：

```json
{
  "if_version": "sha256:…",
  "permissions": [
    { "name": "books.read", "scope": "library:all" },
    { "name": "jobs.create" }
  ]
}
```

规则：

1. `permissions` 必须是数组，≤64 条；`name` 必须同时存在于权限目录和该插件 Manifest 声明中。
2. 未知权限 → `400 PERMISSION_INVALID`；未声明 → `400 PERMISSION_NOT_DECLARED`。
3. 资源型权限（`RESOURCE_SCOPED`）必须带 scope → 否则 `400 PERMISSION_SCOPE_REQUIRED`；
   scope 通过 `assertScope` → 否则 `400 PERMISSION_SCOPE_INVALID`。
4. 非资源型权限的 scope 归一化为 `*`。
5. `if_version` 必须等于当前 `grants.json` 的 SHA-256；不匹配 → `409 POLICY_VERSION_CONFLICT`
   （`details.current_version` 返回最新版本）。写入串行化，并发请求只有一个成功。
6. `policy_state=broken` → `409 POLICY_BROKEN`；`last-good`（文件不可读）→ `409 POLICY_NOT_WRITABLE`；
   两种状态都不修改原文件。
7. 原子替换 `state/grants.json`（tmp + rename + 0600），保留其他插件条目，
   写入后刷新 `grants.last-good.json` 与内存缓存；空数组表示“已配置但全部拒绝”，不会退回 Legacy。
8. 审计：`permission.grant` / `permission.revoke` / `permission.scope.update`，
   `detail.changed_fields` 只包含权限标识，不记录配置值。

响应：

```json
{
  "ok": true,
  "version": "sha256:…",
  "policy_state": "ok",
  "changed": { "granted": ["jobs.create"], "revoked": [], "scope_updated": [], "total": 1 },
  "permissions": { "policy_state": "ok", "effective": [], "catalog": [] }
}
```

`permissions` 为写入后的最新只读视图（与 GET 同结构）。

## 7. 配置

### GET /api/plugins/:id/config

```json
{
  "schema": { "type": "object", "properties": { "api_token": { "type": "string", "x-sensitive": true } }, "required": ["api_token"] },
  "values": { "api_token": "******", "font_size": 14 },
  "sensitive": { "api_token": true },
  "version": "sha256:…",
  "has_custom_ui": true,
  "runtime_online": true,
  "configured": true,
  "validation": { "ok": true, "errors": [] }
}
```

- 无 `config.schema` → `404 CONFIG_SCHEMA_MISSING`；前端显示“该插件无声明式配置”。
- 运行时离线 → `503 RUNTIME_UNAVAILABLE`；前端降级为“打开插件界面配置”。
- 敏感字段一律 `******`；`sensitive[field]` 表示是否已配置，不暴露原文。
- `version` 由 Runtime 对配置内容（键排序 JSON）取 SHA-256，用于乐观并发控制。

### PUT /api/plugins/:id/config

> 实施状态：4C.4 已实现（`src/core/toolbox/plugin-config.js` + Runtime `PUT /internal/tool/:id/config`）。

请求：

```json
{
  "if_version": "sha256:…",
  "values": { "font_size": 16, "api_token": "new-secret" },
  "clear_sensitive": ["webhook_secret"]
}
```

规则：

1. `values` / `clear_sensitive` 必须是对象 / 字符串数组；只提交发生变化的字段。
2. 未知字段或类型/枚举/范围/长度不符 → `400 CONFIG_VALIDATION_FAILED`，`details.errors[]` 只含字段名与规则。
3. 值为 `******` 的敏感字段视为“保持原值”，不会被写入；留空同样保持原值。
4. 只有出现在 `clear_sensitive` 且 Schema 标记 `x-sensitive` 的字段才会被删除；
   同一字段不能同时出现在 `values` 与 `clear_sensitive`。
5. 必填字段按“当前已配置状态 + 本次提交”判断，缺一即失败（敏感字段只看是否已配置，不读明文）。
6. Node 通过 `PUT /internal/tool/{id}/config` 交给 Runtime：Runtime 在进程内加锁完成
   “读取 → 版本校验 → 字段合并 → AES-256-GCM 落盘（tmp + rename）”。
7. `if_version` 不匹配 → `409 CONFIG_VERSION_CONFLICT`（`details.current_version`）。
8. Runtime 不可用 → `503 RUNTIME_UNAVAILABLE`，不会退回 Node 直接读写加密文件。
9. 审计：`config.update`（字段名列表）、`config.secret.clear`（被清除的字段名）。

响应：`{ "schema": …, "values": { "api_token": "******" }, "sensitive": {…}, "version": "sha256:…",
"changed": { "fields": ["font_size"], "cleared": [] } }`

## 8. 版本

### GET /api/plugins/:id/versions

```json
{
  "current": { "revision": "1.1.0", "source": "store", "sha256": "…", "installed_at": "…" },
  "latest": { "revision": "1.1.0", "reviewed": true, "compatibility": { "supported": true } },
  "rollback": { "available": false, "revision": "" },
  "update_available": false,
  "review": { "reviewed_at": "2026-11-09", "notes": "…", "limitations": ["…"] }
}
```

- 只展示真实存在的：当前版本、一个回滚目标、商店最新版本。
- 无 changelog 字段 → 不渲染“更新说明”；只展示审查备注/限制。

## 9. 日志

### GET /api/plugins/:id/logs?type=errors|audit|tasks&limit=50&offset=0

```json
{
  "entries": [{
    "at": "2026-11-10T03:00:00.000Z",
    "level": "error",
    "source": "task",
    "tool_id": "zlibrary",
    "code": "TASK_FAILED",
    "message": "…"
  }],
  "type": "errors",
  "limit": 50, "offset": 0,
  "note": "Runtime stdout 不在本接口内；容器日志请查看 toolbox-runtime"
}
```

数据来源：

| type | 来源 | 权限 |
| --- | --- | --- |
| `errors` | `toolbox_tools.last_error` + 失败任务 `error` | 管理员会话 |
| `tasks` | `toolbox_tasks` 的 stage/message | 管理员会话 |
| `audit` | `state/audit.jsonl`（管理操作） | 管理员会话 |

限制：`limit` 1..200；消息脱敏并截断 1000 字符；`audit` 只返回该 `tool_id` 的记录。

## 10. 任务

### GET /api/plugins/tasks?status=&tool_id=&limit=50&offset=0

- `status`：`running|completed|failed|cancelled`（空 = 全部）。
- 复用 `toolbox_tasks`；`total` 为同条件计数（新增 `countTasks`）。
- 返回任务字段与 `/api/toolbox/tasks` 一致（`id/tool_id/operation/status/stage/progress/created_at/finished_at/error/message/result_book_id`）。

### GET /api/plugins/tasks/:id

```json
{
  "task": { "...": "同上" },
  "plugin": { "tool_id": "zlibrary", "name": "Z-Library 入库" },
  "book": { "id": 1, "title": "…" },
  "artifacts": [{ "artifact_id": "art_…", "format": "EPUB", "size": 1024, "sha256": "…", "title": "…" }]
}
```

`/api/plugins/tasks` 必须先于 `/:id` 注册。

## 11. 运行时与安全

### GET /api/plugins/runtime（扩展现有）

保留 `runtimes`、`builtinInstances`，新增：

```json
{
  "toolbox": {
    "online": true, "status": 200, "error": "",
    "info": { "plugins": ["md_to_epub"], "isolated": false, "isolation_mode": "shared",
              "toolbox_dir": "/toolbox", "plugin_auth_only": false },
    "path": { "checked": true, "node": "/toolbox", "runtime": "/toolbox", "mismatch": false }
  },
  "security": { "...": "同 GET /api/plugins/security 的 security 字段" }
}
```

### GET /api/plugins/security

```json
{
  "runtime": {
    "online": true, "isolation_mode": "shared", "isolated": false,
    "plugin_auth_only": false, "node_plugin_auth_only": false,
    "uid": { "enabled": false, "missing_capabilities": [] },
    "path": { "checked": true, "mismatch": false }
  },
  "policy": { "state": "ok", "strict_tools": ["md_to_epub"], "unconfigured_tools": [] },
  "plugins": {
    "installed": 2, "enabled": 2,
    "reviewed": 1, "unreviewed": ["zlibrary"],
    "failed": [], "pending_restart": []
  },
  "env": { "allow_unreviewed": false, "legacy_compat": true },
  "risks": [
    { "code": "SHARED_WORKER_UNREVIEWED", "level": "high",
      "message": "共享 Worker 内存在未审查插件，插件可读取同卷其它插件配置" }
  ]
}
```

- 所有字段由服务端根据 Runtime health 与环境变量计算；前端不提供开关。
- `allow_unreviewed=true` 时追加 `UNREVIEWED_ALLOWED` 高风险提示。
- `path.mismatch=true` 时追加 `TOOLBOX_PATH_MISMATCH` 提示（入库会失败）。

## 12. 审计事件

写入 `TOOLBOX_DIR/state/audit.jsonl`，单行 JSON：

```json
{ "ts": "2026-11-10T03:00:00.000Z", "actor": "admin", "action": "plugin.disable",
  "tool_id": "zlibrary", "result": "ok", "detail": { "before": true, "after": false } }
```

覆盖动作：`plugin.install|update|rollback|enable|disable|uninstall|runtime.restart|permissions.update|config.update`。
不记录：配置值、Cookie、令牌、绝对路径。轮转：>1MB 时重命名 `audit.1.jsonl`，最多保留 3 份。

## 13. 兼容与版本化

- 新接口固定无版本前缀，与现有 `/api/*` 一致；字段只加不改。
- 内部握手 `POST /internal/tool/:id/config` 仅在共享卷/容器网络内可用，需 `X-Mybooks-Runtime-Secret`；
  不经过用户会话，不返回明文给浏览器。
- 旧 `/api/toolbox/*` 语义不变；新增审计不影响返回体。

## 14. Phase 4C.2 实施状态（2026-11-10）

已实现（只读）：

| 接口 | 数据来源 | 说明 |
| --- | --- | --- |
| `GET /api/plugins/overview` | `toolbox_tools`、`toolbox_tasks`（GROUP BY）、Descriptor、商店缓存、Runtime healthz | 一次工具列表 + 一次任务聚合，无逐插件查询；无商店缓存时 `updates_available=null` |
| `GET /api/plugins/store/index` | `store.getIndex()` + `annotate()` | `peekIndex()` 仅供总览，不触发网络；返回体移除 `download_url` |
| `GET /api/plugins/store/:id` | 同上 | 未收录 `404 STORE_NOT_FOUND` |
| `GET /api/plugins/installed` | Descriptor + `toolbox_tools` + Runtime healthz + 商店缓存 | `runtime_status` 区分 `loaded/not_loaded/runtime_offline/disabled` |
| `GET /api/plugins/:id` | Descriptor（`toPublicDescriptor`）+ 安装记录 + Runtime + 商店缓存 | 不返回 `raw`、绝对路径 |
| `GET /api/plugins/:id/permissions` | `plugin-grants.js` + Manifest 声明 + `permissions.js` | `absent/ok/last-good/broken` 原样映射；`can_modify` 仅 `ok` 为 true，`write_supported=false` |
| `GET /api/plugins/:id/config` | Runtime `GET /internal/tool/:id/config` + Manifest Schema | 敏感字段 `******`；未声明字段不回显；离线 `503 RUNTIME_UNAVAILABLE` |
| `GET /api/plugins/:id/versions` | 安装记录 + 商店缓存 + `previous_path` | 只展示 current/latest/一个真实回滚目标 |
| `GET /api/plugins/tasks`、`/tasks/:id` | `toolbox_tasks`、`toolbox_artifacts` | `tool_id|plugin_id`、`status`、`limit`、`offset`；不返回 `details` 与 `rel_path` |
| `GET /api/plugins/:id/logs` | `last_error` + 失败任务 + `audit.jsonl` | `stdout` 明确返回 `SOURCE_NOT_IMPLEMENTED` |
| `GET /api/plugins/security` | Runtime healthz + 环境变量 + grants + Descriptor | `risk` 服务端计算；不返回路径/密钥 |
| `GET /api/plugins/runtime` | 原有 `runtimes/builtinInstances` + 新增 `toolbox/security` | 原字段不变；`toolbox.info` 不含 `toolbox_dir/data_dir` |

新增内部桥：

```http
GET /internal/tool/:id/config
X-Mybooks-Runtime-Secret: <runtime-secret>
→ { ok: true, tool_id, config: {...} }   # 仅 Node 使用；浏览器不可达
```

- 只读；不执行插件代码；`config.json` 不存在返回 `CONFIG_NOT_FOUND`，解密失败返回 `CONFIG_DECRYPT_FAILED`。
- Node 侧再按 `x-sensitive` 掩码，浏览器永远拿不到明文。

未实现（保持 4C.4）：

- `PUT /api/plugins/:id/permissions`、`PUT /api/plugins/:id/config`。
- 权限写入差异校验、`if_version`、`grants.last-good.json` 更新。
- 任何安装/更新/回滚/启停/卸载的新写入口（仍只用 `/api/toolbox/*`）。

审计：

- `core/toolbox/audit.js` 追加 JSONL，单行 ≤8KB，文件 >1MB 轮转，保留 3 份；
- 已接入 install/update/rollback/enable/disable/uninstall/runtime.restart；
- 不记录 Cookie、令牌、配置值与绝对路径。

---

## 15. Phase 4C.4 实施状态（2026-11-10）

新增写入能力（全部基于既有模块，没有第二套权限库或加密实现）：

| 接口 | 实现 | 关键约束 |
| --- | --- | --- |
| `PUT /api/plugins/:id/permissions` | `core/toolbox/grants-admin.js` | 仅 Manifest 声明权限；scope 走 `assertScope`；序列化写入 + `if_version` 409；broken/last-good 拒写；原子替换 + last-good + 缓存失效 |
| `PUT /api/plugins/:id/config` | `core/toolbox/plugin-config.js` → Runtime `PUT /internal/tool/:id/config` | 字段级合并；敏感字段掩码/留空保持、显式清除；版本冲突 409；Runtime 离线 503 |
| `GET /api/plugins/:id/permissions` | 追加 `catalog`、`write_supported=true`、`can_modify`（`ok` / `absent` 可写） | 只读视图不变，仅加法字段 |
| `GET /api/plugins/:id/config` | 追加 `version`、`sensitive`、`configured`、`validation` | 仍不返回敏感原文 |
| `GET /api/plugins/:id/logs?type=audit&since=` | `audit.list({ since })` | 审计条目追加 `actor`、`result`；`since` 由服务端过滤 |

内部桥（Runtime → Node 的配置通道）：

```http
PUT /internal/tool/:id/config
X-Mybooks-Runtime-Secret: <runtime-secret>
{ "version": "sha256:…", "values": {...}, "clear": ["secret_field"] }
→ { ok: true, tool_id, version, changed_fields, cleared }
```

- Runtime 内 `threading.Lock` 串行完成“读取 → 版本校验 → 合并 → `storage.set_config`（AES-256-GCM，tmp + replace）”。
- 版本号算法两侧一致：`sha256` over 键排序、无空格的 JSON；
  Node 兜底实现（旧 Runtime 无 `version` 字段）与 Python 实测哈希完全一致。
- 不执行插件代码；`CONFIG_VERSION_CONFLICT`(409)、`CONFIG_INVALID`(400)、`CONFIG_WRITE_FAILED`(500)。

未实现/边界：

- 配置历史版本与 diff 视图；插件自定义配置界面仍走 `/toolbox/tool/:id`。
- Runtime stdout 仍不提供逐插件捕获。
- 权限写入不修改 Kernel `GrantStore`（仅 Toolbox `state/grants.json`）。

---

## 16. Phase 4C.4-R 修复（2026-11-10）

详见 [remediation.md](remediation.md)。契约增量：

### 权限

- `GET /api/plugins/:id/permissions` 新增 `out_of_range: string[]`：已授予但超出 Manifest 声明范围的历史条目。
- `PUT /api/plugins/:id/permissions` 新增校验与错误码：

| 场景 | 结果 |
| --- | --- |
| 请求 scope 超出 Manifest 声明（含 `book:1 → *`、`artifact:1 → artifact:*`、跨资源类型） | `400 PERMISSION_SCOPE_OUT_OF_RANGE`，消息含声明范围 |
| Manifest 未写 scope | 视为 `*`（与历史裸权限条目一致） |
| 保存成功后 | 响应含 `audit: { ok, recorded }`；`audit.ok=false` 表示业务已写入但审计失败 |

资源包含规则（与 `grants-admin.scopeCovers` 一致）：`*` 覆盖一切；同类型 `type:*` 覆盖同类型值；
`library:all` 覆盖 `book:<id>` / `book:*`；其余跨类型或无法证明的请求一律拒绝。

### 配置

- `GET /api/plugins/:id/config` 的 `version` 语义：**配置文件不存在时为 `''`**，存在时为内容哈希。
- `PUT /api/plugins/:id/config` 用同一语义做 `if_version` 比较，首次保存不再返回 409。
- 配置文件损坏/密钥不可读时返回 `502 CONFIG_UNAVAILABLE`（消息说明原因），不会覆盖原文件，
  也不会回退为“空配置”。
- 保存成功后响应含 `audit: { ok, recorded }`。

### 内部桥

```http
GET/PUT /internal/tool/:id/config
403 { "code": "CROSS_PLUGIN_DENIED" }   # 插件子进程访问其他插件配置
```

绑定在应用启动时从 `TOOLBOX_ONLY_TOOL` 固化；Supervisor 与共享宿主不绑定，保持管理能力。
错误码：`CONFIG_CORRUPTED` / `CONFIG_KEY_UNREADABLE` / `CONFIG_READ_FAILED` / `CONFIG_DECRYPT_FAILED`。
