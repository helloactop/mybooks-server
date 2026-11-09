# Phase 4B 实施规格（统一 Plugin SDK 与宿主能力接口）

> 状态：待批准后执行
> 基线：`codex/plugin-platform` @ `fd61d391`（工作区干净）
> 原则：Node 仍是权限与身份核心；Python Runtime 负责执行；SDK 只做薄封装。
> 本文件是 4B 的实现契约，不替代 `SDK-SPEC.md` / `ROADMAP.md` 的最终更新。

## 1. 4B.1 基线结论（已通过源码核实）

### 1.1 可直接复用

| 位置 | 现有能力 | 复用方式 |
| --- | --- | --- |
| `src/http/routes.toolbox.internal.js` | `requireInternal`、`requirePermission`、`toolIdForRequest`、`taskForRequest`、`fail` | 所有新增内部路由直接挂同一 router |
| `src/core/toolbox/library.js` | `searchBooks`、`getBooks`、`listIds`、`getFields`、`updateMetadata`、`exportFile`、`deleteBook`、`mergeFormats` | 书籍查询/更新/导出 |
| `src/core/toolbox/import.js` | `importToolFile`、`getBookMetadata`、`resolveToolFile` | 入库与书籍摘要 |
| `src/core/toolbox/tasks.js` | `cancelTask(taskId,{toolId})` | 任务取消（含 `CANCEL_UNSUPPORTED`） |
| `src/db/toolbox.js` | `createTask/getTask/updateTask/finishTask/recoverRunningTasks` | 任务状态机与崩溃恢复 |
| `src/core/toolbox/plugin-grants.js` + `access-policy.js` | strict/legacy 判定与 fail-closed | 不改语义 |
| `src/core/plugins/capability-router.js` + `src/http/plugin-services.js` | `metadata.service.search({query|isbn},{signal})` | 元数据统一入口 |
| `toolbox-runtime/webserver/toolbox/node_client.py` | `NodeClient`、`NodeError`、身份头、隔离模式不降级 | 作为 SDK 唯一传输层 |
| `toolbox-runtime/webserver/toolbox/core_api.py` | `CoreAPI` 命名空间（calibre/db/tasks/messages/storage/settings/utils） | 保留，新增 `api.sdk` |
| `public/static/toolbox-bridge.js` + `public/js/page-toolbox-tool.js` | Bridge v1 + 父页面路由白名单代理 | 前端 SDK 只做封装 |

### 1.2 当前缺失（4B 要补）

- 内部接口缺：`books` 创建、`PATCH books/:id`、`books/:id/reading`、`artifacts` 发布/查询、`tasks/:id` 查询、`tasks/:id/result`、`tasks/:id/cancel`、`config/validate`、`metadata/search`。
- Python 侧无统一 SDK 包；无稳定 `PluginError` 映射；无任务结果/Artifact/配置校验封装。
- 前端无 `/static/plugin-sdk/v1.js`；插件页 CSP 只允许 `toolbox-bridge.js`。
- 数据库无 Artifact 表。

## 2. 数据层

### 2.1 `src/db/index.js`

追加 `migrateV28(db)`（只新增表，不改既有列）：

```sql
CREATE TABLE IF NOT EXISTS toolbox_artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL UNIQUE,
  tool_id     TEXT NOT NULL,
  task_id     INTEGER,
  format      TEXT NOT NULL DEFAULT '',
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  sha256      TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  rel_path    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS toolbox_artifacts_tool_idx ON toolbox_artifacts (tool_id, id DESC);
CREATE INDEX IF NOT EXISTS toolbox_artifacts_task_idx ON toolbox_artifacts (task_id);
CREATE INDEX IF NOT EXISTS toolbox_artifacts_status_idx ON toolbox_artifacts (status, id DESC);
```

`rel_path` 相对 `<TOOLBOX_DIR>/data`，绝不存绝对路径。`migrations` 数组末尾追加 `migrateV28`。

生命周期与回滚：

- 创建：`status='active'`。
- 读取：只返回 `status='active'`；软删除后 404。
- 清理：`softDeleteArtifact` 标记 `deleted` + `deleted_at`；卸载插件且 `purge_data=1` 时按 `tool_id` 硬删除记录（文件随工具数据目录清理）。
- 回滚：迁移只新增表，代码回滚无需删表；旧版本不会读写该表。

### 2.2 `src/db/toolbox.js`

新增 `ARTIFACT_COLUMNS`、`insertArtifact(db, record)`、`getArtifactByPublicId(db, artifactId)`、`listArtifactsForTask(db, taskId)`；导出。其余函数签名不变。

## 3. 4B.2 宿主能力接口

### 3.1 新增 `src/core/toolbox/artifacts.js`

- `ARTIFACT_MAX_BYTES = 80 * 1024 * 1024`（与入库上限一致）。
- `publishArtifact({ toolId, taskId, path, format, title, sha256, maxBytes, handleDb })`
  - `path` 允许包内相对路径或绝对路径，但 realpath 必须位于 `<TOOLBOX_DIR>/data/<toolId>/`。
  - 拒绝：NUL/反斜杠/`..`/符号链接/非普通文件/越界/跨插件。
  - `format` 必须通过 `validateEbookFile()`（epub/pdf/azw3/mobi/txt），大小 ≤ `min(80MB, maxBytes)`。
  - 计算 SHA-256；请求带 `sha256` 时必须一致，否则 `ARTIFACT_SHA_MISMATCH`。
  - 若带 `taskId`：任务必须存在且 `task.tool_id === toolId`，否则 `TASK_TOOL_MISMATCH`。
  - 生成 `artifact_id = 'art_' + crypto.randomBytes(16).toString('hex')`；落库；返回 DTO。
- `getArtifact({ toolId, artifactId, handleDb })`：不存在 `ARTIFACT_NOT_FOUND` 404；`tool_id` 不匹配 `ARTIFACT_TOOL_MISMATCH` 403。
- DTO 固定为 `{ artifact_id, tool_id, task_id, format, mime, size, sha256, title, created_at }`，**无 path**。
- 错误码：`ARTIFACT_PATH_INVALID`、`ARTIFACT_TOO_LARGE`、`ARTIFACT_FORMAT`、`ARTIFACT_SHA_MISMATCH`、`ARTIFACT_NOT_FOUND`、`ARTIFACT_TOOL_MISMATCH`。

### 3.2 `src/core/toolbox/library.js`（追加，不改现有导出）

- `readingStatus(handleDb, bookId)` → `{ book_id, status, read_count, start_date, finish_date, last_read_at }`，书籍不存在 `BOOK_NOT_FOUND` 404。
- `createBook(handleDb, fields)` → 白名单 `title,authors,tags,translators,publisher,pubdate/pub_year,isbn,series,series_index,rating,summary/comments`；`parseBook` 校验；`books.addBook`；**不创建文件/阅读记录**；返回 `getBookMetadata` 摘要。
- `updateBook(handleDb, bookId, fields)` → 复用 `updateMetadata`，仅白名单字段；不接受 `status/read_count/read_logs`。

### 3.3 `src/core/toolbox/config-schema.js`（新增）

- `validateConfig(schema, values)` → `{ ok, errors: [{ field, code, message }] }`，只报告字段名与规则，不回报值。
- 支持子集：`type`（string/number/integer/boolean/array/object）、`required`、`enum`、`minimum`/`maximum`、`maxLength`、`items`、`x-sensitive`。
- 说明：`manifest-v1.js` 归一化后不保留 `minLength`/`pattern`/`additionalProperties`，因此校验器不实现这些规则；未知字段统一 `CONFIG_UNKNOWN_FIELD`。
- `sensitiveFields(schema)` → `x-sensitive: true` 的字段名集合。

### 3.4 内部路由（全部追加到 `src/http/routes.toolbox.internal.js`）

| 方法与路径 | 权限/资源 | 行为 |
| --- | --- | --- |
| `POST /internal/toolbox/books` | `books.write` / `library:all` | `library.createBook`；201 `{ok, book}` |
| `PATCH /internal/toolbox/books/:id` | `books.write` / `book:<id>` | `library.updateBook`；返回摘要；现有 `POST .../metadata` 仍只要求 `metadata.write` |
| `GET /internal/toolbox/books/:id/reading` | `books.read` / `book:<id>` | `library.readingStatus` |
| `POST /internal/toolbox/artifacts` | `files.write` / `artifact:create` | `publishArtifact`；201 `{ok, artifact}`；授权范围写作 `files.write:artifact:*` |
| `GET /internal/toolbox/artifacts/:id` | `files.read` / `artifact:<id>` | 归属校验后返回 DTO；授权范围 `files.read:artifact:*` |
| `GET /internal/toolbox/tasks/:id` | `jobs.create` + `taskForRequest` | 返回本人任务 |
| `GET /internal/toolbox/tasks/:id/result` | `jobs.create` + `taskForRequest` | running → 409 `TASK_NOT_FINISHED`；否则返回状态、错误、`result_book_id`、书籍摘要、artifact 列表 |
| `POST /internal/toolbox/tasks/:id/cancel` | `jobs.create` + `taskForRequest` | 复用 `cancelTask(task.id,{toolId})`；无 cancel 路由 → 409 `CANCEL_UNSUPPORTED` |
| `POST /internal/toolbox/config/validate` | 仅本插件（`toolIdForRequest`） | 读取 descriptor `configuration.schema`；无 schema → 404 `CONFIG_SCHEMA_MISSING`；返回 `{ok, errors}`，不回显值 |
| `POST /internal/toolbox/metadata/search` | `metadata.read` | 调用 `plugin-services.metadata.service.search`；返回标准化候选列表；禁止自建 Provider |

统一约束：

- 全部经过 `requireInternal`；严格模式默认拒绝；不新增任何宽松回退。
- 写操作先 `toolIdForRequest`，再校验插件安装/启用，再验权限。
- 错误沿用 `fail()` 的 `{error, code, status}`；5xx 不返回堆栈/绝对路径。
- 新增路由只注册在 `routes.toolbox.internal.js`（`server.js` 中挂载于 `/api` 会话守卫之前、静态资源之前），不另建公网可见路由文件。

## 4. 4B.3 Python SDK

### 4.1 目录（唯一源）

```text
plugin-sdk/python/
├── pyproject.toml                  # mybooks-plugin-sdk 1.0.0，无运行时第三方依赖
├── mybooks_plugin_sdk/
│   ├── __init__.py                 # SDK / PluginError / __version__
│   ├── client.py                   # HostClient：包装 NodeClient，NodeError→PluginError
│   ├── books.py                    # search/get/create/update/reading_status
│   ├── files.py                    # publish/metadata/import_file/export/work_dir
│   ├── jobs.py                     # create/get/progress/result/cancel/complete/message/wait
│   ├── config.py                   # get/set/validate（加密存储 + schema 校验）
│   ├── metadata.py                 # search/isbn（走 metadata@1 内部路由）
│   ├── errors.py                   # 稳定错误码 + 可重试标记
│   ├── contract.py                 # 输入/输出归一化与上限（与 Node 共用测试向量）
│   └── compat.py                   # from_tool/from_api，旧 BaseTool 零改动接入
└── tests/
    ├── test_contract.py
    ├── test_client.py
    └── test_compat.py
```

### 4.2 关键契约

- 所有 `sdk.*` 方法为 `async`；同步 HTTP 经 `asyncio.to_thread` 执行，默认 60s，`jobs/files` 长操作允许 `timeout` 覆盖。
- `sdk.jobs.create({operation, details})` 返回 `{job_id, status, progress}`；`job_id` 即宿主 task id。
- `sdk.files.publish({job_id, path, format, title, sha256?, max_bytes?})` 返回 Artifact DTO。
- `sdk.config.get()` 读取现有 `storage.get_config`（AES-256-GCM），`x-sensitive` 字段返回 `"******"`；`set()` 合并后调用 `storage.set_config`；`validate(values)` 调内部校验接口。
- `PluginError(code, message, status, retryable)`；`NodeError` 原样映射 code，禁止改写为成功。
- `compat.from_tool(tool)` 使用 `NodeClient.for_tool(tool.tool_id())` + `storage`；`compat.attach(tool)` 幂等设置 `tool.sdk`；`BaseTool/BaseHandler/CoreAPI` 行为不变。
- **不实现**新的 `Plugin`/`route` 装饰器加载体系：宿主 `plugin_host.py` 只识别 `BaseTool` + `api_routes`。SDK 不提供无法被宿主加载的表面 API。

### 4.3 Runtime 接入

- `toolbox-runtime/webserver/toolbox/sdk.py`：`sdk_for(owner)` 懒加载 `mybooks_plugin_sdk`，按 owner 缓存。
- `core_api.py`：`CoreAPI.__init__` 保存 `self._owner = owner`；新增只读属性 `CoreAPI.sdk`（懒加载，避免本地未装 SDK 时导入失败）。
- `node_client.py`：新增公开 `request(method, path, payload=None, timeout=20)`（委托 `_request`），以及 `create_book/update_book/reading_status/publish_artifact/get_artifact/get_task/task_result/cancel_task/validate_config/metadata_search`。
- 镜像：**单一源** `plugin-sdk/python`；`scripts/sync-plugin-sdk.mjs` 复制到 `toolbox-runtime/sdk/mybooks_plugin_sdk`（该目录 gitignore），`toolbox-runtime/Dockerfile` 增加 `COPY sdk ./sdk` + `ENV PYTHONPATH=/app:/app/sdk`；`package.json` 增加 `sdk:sync`。构建前必须执行 `npm run sdk:sync`。

## 5. 4B.4 前端 SDK

新增 `public/static/plugin-sdk/v1.js`（IIFE，不改 Bridge）：

- 前置检查 `window.MyBooksToolBridge`；缺失时 `MyBooksUI.ready()` 拒绝 `BRIDGE_MISSING`，不抛未捕获异常。
- `MyBooksUI.ready()` → `{protocol: 1, sdk: '1.0.0', bridge: 'v1', toolId}`。
- `call(route, {method, body, query, timeoutMs})`：路径只允许 `^[A-Za-z0-9_.\-]+$`，禁止 `://`、`..`、前导 `/`；对象 body 自动 `JSON.stringify`；错误统一为 `{code, message, status}`（Bridge 通用错误 → `HOST_ERROR`）。
- `jobs.get(jobId, {route='job'})`、`jobs.watch(jobId, {route='job', intervalMs=1500, timeoutMs=300000, onUpdate, onDone, onError})`
  - 串行 `setTimeout`（不重叠）；间隔下限 500ms；终态 `completed/failed/cancelled` 自动停止；返回 `{stop}`；`stop()` 清定时器并释放回调。
- `config.get({route='config'})` / `config.save(values, {route='config'})`：仅转发 Bridge。
- 不读 Cookie、不访问宿主 DOM、不拼自定义 URL、不实现 4D UI Slot。
- `src/http/routes.toolbox.ui.js` 的 `pluginCsp`：`script-src` 追加 `${origin}/static/plugin-sdk/v1.js`（精确文件，不用通配）。

## 6. 4B.5 测试

### 6.1 `test/plugins-sdk-contract.test.js`（Node）

用 `express + http` 起临时端口，挂载 `routes.toolbox.internal.js`，临时 `MYBOOKS_STORAGE_DIR/MYBOOKS_TOOLBOX_DIR`，写 `state/grants.json` 与 `identities.json`。覆盖：

1. 任务：create → PATCH progress → GET → result；running 时 result 409；跨插件 GET/PATCH 403；无 cancel 路由 409。
2. Artifact：合法发布、`../` 穿越、符号链接、超限、SHA 不一致、跨插件查询 403；返回体不含绝对路径。
3. 书籍：create/update/reading；未知字段被忽略；未授权 403；创建不产生文件。
4. 配置：schema 校验成功/失败；`x-sensitive` 值不出现在响应。
5. 身份：头 A + body B → `PLUGIN_IDENTITY_MISMATCH`；停用插件 403。
6. 错误码：403/404/409 的 `code` 与旧接口一致。
7. Legacy：无身份 + 共享密钥仍可访问既有 `library/books`（默认兼容）。
8. 最小链路：create task → progress → 生成 `work/out.epub` → publish artifact → import → complete task → result 含 `book_id` 与 artifact。

### 6.2 Python

- `plugin-sdk/python/tests/test_contract.py`：参数归一化、上限、错误码。
- `plugin-sdk/python/tests/test_client.py`：假 NodeClient 记录方法与路径；`NodeError` → `PluginError`；超时。
- `plugin-sdk/python/tests/test_compat.py`：假 BaseTool 的 `tool_id()`，验证 `compat.from_tool` 与 `api.sdk` 不改变旧属性。
- `toolbox-runtime/tests/test_sdk.py`：`sys.path` 指向 `plugin-sdk/python` 后 `import mybooks_plugin_sdk`；假 transport 跑通 create→progress→publish→complete。
- Docker 验证：`npm run sdk:sync` → 构建 `toolbox-runtime` → 容器内 `python -c "import mybooks_plugin_sdk"` 与 `python -m unittest discover -s tests -p 'test_sdk.py'`。Docker 不可用时明确标注“未运行”，不得声称已通过。

### 6.3 命令

```bash
npm test
node --test test/plugins-sdk-contract.test.js   # 若 scripts/test.js 不支持单文件，则以 npm test 输出为准
python -m unittest discover -s plugin-sdk/python/tests -v
python -m unittest discover -s toolbox-runtime/tests -v
npm run sdk:sync && docker build -t mybooks-toolbox-runtime:4b toolbox-runtime
docker run --rm mybooks-toolbox-runtime:4b python -c "import mybooks_plugin_sdk; print(mybooks_plugin_sdk.__version__)"
```

## 7. 文档更新（只标记已验证项）

- `docs/plugins/STATUS.md`：新增 4B 表格（能力、测试、真实结果、未完成项）。
- `docs/plugins/phase4/SDK-SPEC.md`：能力目录状态改为实际结果；补充 Artifact 结构与错误码；明确 `Plugin/route` 装饰器未实现。
- `docs/plugins/phase4/ROADMAP.md`：4B 拆分勾选，4C/4D 仍为未开始。
- 不修改 Android 仓库；不删除 Legacy Toolbox；不重写 Kernel/RuntimeManager。

## 8. 验收与回滚

- 验收：`npm test` 全绿；Python SDK 单测通过；Docker 内可导入；两个旧插件描述符与安装链路回归通过。
- 回滚：单步可回滚——DB 迁移只新增表（回滚代码无需删表）；新增路由独立于旧路由；SDK 目录与 `v1.js` 可整体删除；CSP 行可单独还原；`sdk:sync` 产物不入库。
- 不自动提交/推送/合并。

## 9. 已批准的架构决策

1. 新增纯增量 `toolbox_artifacts` 表（`migrateV28`），不改历史迁移与旧表；含生命周期与清理策略。
2. `PATCH /books/:id` 只要求 `books.write`（资源 `book:<id>`）；现有元数据接口保留 `metadata.write`；复合敏感操作按实际追加权限。
3. Artifact 发布使用 `files.write` + 专属资源：创建 `artifact:create`，读取 `artifact:<id>`；授权范围 `artifact:*`（与 `GrantStore` 的 `scope.endsWith(':*')` 前缀匹配一致）。导入书库时另行检查 `books.write`。
4. 暂不实现 `Plugin`/`route` 装饰器加载器；复用 `BaseTool`/`BaseHandler`/`PluginHost`/`CoreAPI`/`NodeClient`。
