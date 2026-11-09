# 旧插件迁移方案

> 目标：旧 Toolbox 插件不改包也能继续运行；新包可逐步采用 Manifest v1；每一步都能回滚。
> 状态：○ Phase 4A 起实施；本文是迁移契约，不是已完成事实。

## 1. 迁移原则

1. **包格式不变**：仍是 ZIP/7z，根目录 `manifest.json` + `backend/` + `frontend/`，不强制重打包。
2. **双读**：宿主同时支持 Legacy manifest 与 Manifest v1，按包内容自动选择。
3. **只加不改**：v1 新增字段全部可选；旧字段继续有效。
4. **逐插件迁移**：不要求所有插件同一版本切换；新旧插件可同时安装。
5. **可回滚**：任一插件可装回旧包；宿主可关闭 v1 解析回到 Phase 3g.1 行为。
6. **权限不继承**：迁移不自动扩大授权；新增权限必须重新确认。

## 2. 现有插件清单

| 插件 | 版本 | 现状 | 迁移优先级 |
| --- | --- | --- | --- |
| `md_to_epub` | 1.1.0（商店） | ✅ 真实转换/入库已验证 | 4E 第一批（结构简单） |
| `zlibrary` | 0.1.0（商店） | ✅ 安装/路由/任务已验证；外网受环境限制 | 4E 第二批（有配置/任务/网络） |
| 其他 Toolbox 插件 | 各版本 | 走 Legacy Worker/共享进程 | 保持 Legacy，按需迁移 |
| 内置 Provider（豆瓣/OpenLibrary） | — | Kernel 内置，无安装包 | 不迁移，继续走 CapabilityRouter |

## 3. 兼容层设计

```text
plugins/<id>/manifest.json
        │
        ├─ 无 manifest_version ──► parseManifest()（现有，Legacy）
        │                              └─ 补默认值 → PluginDescriptor
        └─ manifest_version=1 ───► normalizeManifest()（新增）
                                       └─ 校验/归一 → PluginDescriptor
                                                        │
                                   installer / runtime / UI / API 只读 Descriptor
```

- 新增 `src/core/toolbox/manifest-v1.js`，不修改现有 `parseManifest` 的对外行为。
- `PluginDescriptor` 是只读视图；数据库仍存原始 `manifest` JSON 与 `toolbox_tools` 字段。
- 安装器、运行时、UI 只需要 Descriptor；旧代码路径不用重写。

### 3.1 Legacy 包的默认值

| Descriptor 字段 | Legacy 默认 |
| --- | --- |
| `manifest_version` | 0 |
| `runtime.type` | `python` |
| `runtime.entry` | `entry_backend` |
| `routes` | `api_routes`（方法默认 GET/POST） |
| `frontend.entry` | `entry_frontend`（可为空） |
| `frontend.bridge` | 1 |
| `permissions` | `[]`（不声明；按 `grants.json` 现有规则） |
| `config_schema` | 无（插件自绘配置） |
| `ui.pages` | 有 `entry_frontend` → 一个 `toolbox.tool` 页面 |
| `ui.slots` | `[]` |
| `events` / `provides` | `[]` |
| `trust` | 由 allowlist 计算：命中 → `reviewed`，否则 `unreviewed`/`community` |
| `compatibility` | 现有 `assessCompatibility` |

### 3.2 开关

| 环境变量 | 取值 | 行为 |
| --- | --- | --- |
| `MYBOOKS_PLUGIN_MANIFEST_V1` | `auto`（默认） | 有 `manifest_version` 用 v1，否则 Legacy |
| | `off` | 忽略 v1 字段，全部按 Legacy 解析（紧急回滚） |
| | `strict` | 只接受 v1；用于新部署/CI，不用于旧数据 |

回滚只需把开关设为 `off` 并重启 Node；已安装目录与数据不变。

## 4. 字段迁移对照

| Legacy | v1 | 迁移动作 |
| --- | --- | --- |
| `tool_id` | `tool_id` | 不变 |
| `revision` | `revision` | 不变 |
| `author: "X"` | `author: {name: "X"}` | 自动归一；v1 也接受字符串 |
| `repo_url` | `repo_url` | 不变 |
| `entry_backend` | `runtime.entry` | 自动映射；两者都存在时必须一致 |
| `entry_frontend` | `frontend.entry` | 自动映射 |
| `api_routes` | `routes` | 合并；`routes` 可声明 `methods/timeout_ms` |
| `page` | `ui.pages[].id` | 旧字段保留，逐步废弃 |
| `core_api_version` | 同名 | 不变 |
| `locales/default_locale` | 同名 | 不变 |
| 无 | `manifest_version` | 迁移动作：加 `1` |
| 无 | `permissions[]` | 逐项声明并等待授权 |
| 无 | `config.schema` | 可选，不填则继续插件自绘 |
| 无 | `ui` | 可选，不填则默认整页 iframe |
| 无 | `resources` | 可选，默认宿主上限 |
| 无 | `lifecycle` | 可选，不填无钩子 |

## 5. 逐插件迁移步骤

### 5.1 通用步骤

1. 复制旧 `manifest.json`，加 `manifest_version: 1`。
2. 把 `entry_backend` 复制到 `runtime.entry`（保留旧字段）。
3. 用 `routes` 声明方法/超时（可与 `api_routes` 并存）。
4. 声明 `permissions[]`：按实际调用逐项列出，scope 取最小必要。
5. 若有配置页：写 `config.schema`（敏感字段 `x-sensitive: true`）。
6. 若有前端：加 `frontend.bridge: 2` 与 `ui.pages`（`slot: toolbox.tool`）。
7. 运行严格校验：`validateManifest(raw, {strict: true})`。
8. 在测试环境安装，验证安装/启用/调用/停用/更新/回滚。
9. 更新商店索引（SHA-256、revision），allowlist 重新审查。
10. 发布；保留旧版本作为回滚点。

### 5.2 md_to_epub

```text
1. manifest_version: 1
2. runtime.entry = backend.main.MdToEpubTool
3. routes: convert(POST, 300s), download(GET)
4. permissions: files.write(artifact:*), books.write(library:all), jobs.create
5. config.schema: title/author/language/toc_depth
6. frontend.bridge = 2, ui.pages = [{slot: toolbox.tool}]
7. 保留 entry_backend/entry_frontend/api_routes 以兼容旧宿主
```

验收：Web 上传 Markdown + 图片 → 转换 → 下载 → 选择入库 `book_id`；停用后入口消失；回滚旧包后仍可转换。

### 5.3 zlibrary

```text
1. manifest_version: 1
2. routes: health/config/search/download/progress/cancel
3. permissions: network.public, books.read(library:all),
   files.write(artifact:*), jobs.create
4. config.schema: cookie(x-sensitive)/email/mirror/download_dir
5. ui.pages: toolbox.tool；保留旧 frontend 入口
6. 不声明 network.private（禁止内网访问的意图）
```

验收：配置保存/掩码读取；搜索任务进度；取消；下载入库；外网不可用时返回明确上游错误而非崩溃。

## 6. 接口保留与废弃

### 6.1 Phase 4 必须保留（不得删除/改语义）

| 接口/格式 | 原因 |
| --- | --- |
| `/api/toolbox/*` 全部现有路由 | 旧 Web/脚本/自动化依赖 |
| `/get/tool/:id/*`、`/toolbox/tool/:id` | 插件前端入口 |
| `/api/toolbox/tool/:id/:route` 代理协议 | Bridge v1 依赖 |
| `MyBooksToolBridge` v1 API | 第三方插件已使用 |
| Python `BaseTool`/`BaseHandler`/`CoreAPI` | 旧插件代码不重写 |
| `toolbox_tools` 表与字段 | 数据库兼容 |
| `state/installed.json`、`identities.json`、`grants.json`、`uid-map.json` | 部署/回滚依赖 |
| `pending_restart` 语义 | 重启生效模型 |
| 共享 `internal-secret`（Legacy 模式） | 旧 Worker 兼容；严格部署可关闭 |

### 6.2 计划废弃（Phase 4 内只标记，不删除）

| 项 | 替代 | 最早删除 |
| --- | --- | --- |
| `manifest.page` | `ui.pages[].id` | Phase 5 |
| `api_routes`（仅 v1 包） | `routes` | Phase 5 |
| `/toolbox-assets/:id/*` | `/get/tool/:id/*` | 已 301，Phase 5 |
| Bridge v1 消息 | Bridge v2 | Phase 4 内保留；Phase 5 评估 |
| `MYBOOKS_TOOLBOX_LEGACY_COMPAT=true` 默认 | `PLUGIN_AUTH_ONLY=true` | 下一个大版本 |
| `network.*` 仅声明 | 出口策略（未来） | 与容器级隔离同步 |

## 7. 回滚方案

### 7.1 单插件回滚

```bash
# 方式一：使用既有安装器（保留 .previous）
curl -X POST /api/toolbox/<id>/rollback

# 方式二：重新安装旧 ZIP
curl -X POST /api/toolbox/<id>/update/upload -F file=@old.zip
```

- 数据目录、加密配置、UID 分配不迁移；旧版本必须能读取同一 `config.json`（同一 `config.key`）。
- 若旧版本不兼容新数据目录权限（极少数），回滚前按 Phase 3g.1 文档调整属主。

### 7.2 宿主回滚

```bash
MYBOOKS_PLUGIN_MANIFEST_V1=off   # 关闭 v1 解析
MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=false
TOOLBOX_ISOLATE_PLUGINS=0
TOOLBOX_CHILD_UID_BASE=0
```

- 回滚不删除数据库表、不删除 `state/` 文件。
- Phase 4A 不新增必需表；如需新增审计/Artifact 表，必须提供“缺少表时禁用功能”的降级路径。

## 8. 数据库与存储兼容

| 变更 | 阶段 | 兼容策略 |
| --- | --- | --- |
| Manifest v1 存 `manifest` JSON | 4A | 复用现有列，无迁移 |
| 权限目录 v2 | 4A | 代码内版本化，不写库 |
| 审计日志 | 4C | 追加文件；失败不影响主流程 |
| Artifact 描述 | 4B | 可先存内存/JSON 索引，后续再建表 |
| 商店多来源缓存 | 4C | 文件缓存，不写 DB |
| 依赖关系 | 4A | 读时计算，不建表 |

任何新增表必须：先迁移、可空、有默认值、旧代码忽略；不得要求用户先升级数据库才能启动。

## 9. 迁移验收

1. 旧包（无 `manifest_version`）安装/启用/调用/停用/回滚全部通过。
2. 同一宿主同时安装 Legacy 包与 v1 包，互不影响。
3. v1 包在 `MYBOOKS_PLUGIN_MANIFEST_V1=off` 下按 Legacy 解析，仍能启动（字段缺失时给出明确错误）。
4. 权限新增未授权 → 403；授权后 → 200。
5. Bridge v1 页面在 v2 宿主上无回归。
6. 回滚单插件与宿主后，书库/文件/配置/UID 均不丢失。

## 10. 风险

| 风险 | 缓解 |
| --- | --- |
| v1 解析与 Legacy 行为不一致 | 共用 `PluginDescriptor` 契约测试 + 真实插件回归 |
| 插件声明权限过大 | 授权 UI 差异 + 最小 scope 审查 |
| 旧宿主无法识别 v1 字段 | 保留全部旧字段；v1 只增不改 |
| 回滚后数据不可读 | 不迁移数据目录；同一 config.key |
| 商店索引与包不一致 | SHA-256 双重校验（现有） |
