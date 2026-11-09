# Plugin SDK 规范

> 状态：◐ Phase 4B 已实施（Python SDK 1.0.0 / 前端 `/static/plugin-sdk/v1.js`）；4D UI Slot 与事件订阅未实施
> 原则：SDK 是**薄封装**，不复制宿主逻辑；所有权限、校验、审计仍在 Node 侧完成。

## 1. 分层

```text
插件代码
  ├─ Python SDK（mybooks-plugin-sdk）
  │    └─ 现有 CoreAPI / NodeClient → /internal/toolbox/*
  └─ 前端 SDK（/static/plugin-sdk/v1.js）
       └─ 现有 MyBooksToolBridge → postMessage → /api/toolbox/tool/:id/*
宿主
  └─ 内部接口 → GrantStore / grants.json → 书库/文件/任务服务
```

- Python SDK 不直接访问 SQLite、`/toolbox` 卷中的凭据或宿主进程。
- 前端 SDK 不直接拿 Cookie/Bearer Token；所有请求经宿主页面代理。
- 同一能力在 Python 与前端使用**同名、同参数、同错误码**，只是传输不同。

## 2. 版本与兼容

| SDK | 版本 | 兼容策略 |
| --- | --- | --- |
| Python SDK | `1.x` | 只增加可选参数/新方法；旧方法签名不变 |
| 前端 SDK | `/static/plugin-sdk/v1.js` | v1 永久保留；v2 通过 `MyBooksUI.ready({ protocol: 2 })` 协商 |
| Bridge | v1 / v2 | v1 键名与语义不变，v2 只做加法 |
| Capability | `name@version` | 同一能力多版本共存；调用方显式或按优先级选择 |

废弃策略：标记 `deprecated` 后至少保留 2 个次版本；Phase 4 内不删除任何 v1 接口。

## 3. 能力目录

### 3.1 书籍

| 能力 | 权限 | 现状 | 说明 |
| --- | --- | --- | --- |
| `books.search@1` | `books.read` | ◐ 现有 `/internal/toolbox/library/books?q=` | 返回精简列表，必须带 scope |
| `books.get@1` | `books.read` | ◐ 现有 `?ids=` | 单本/批量详情 |
| `books.create@1` | `books.write` | ✅ 4B | 创建书籍记录，返回 `book_id`；不创建文件/阅读记录 |
| `books.update@1` | `books.write`（`book:<id>`） | ✅ 4B `PATCH /books/:id` | 字段白名单更新；现有 metadata 接口仍用 `metadata.write` |
| `books.reading-status@1` | `books.read` | ✅ 4B `GET /books/:id/reading` | 只读阅读状态与进度 |

### 3.2 文件

| 能力 | 权限 | 现状 | 说明 |
| --- | --- | --- | --- |
| `files.publish@1` | `files.write`（`artifact:create`） | ✅ 4B | 把 `work/` 产物登记为 Artifact，返回 `artifact_id`；授权范围 `artifact:*` |
| `files.download@1` | `files.read` | ◐ 现有下载路由 | 流式下载，不整块读入内存 |
| `files.import@1` | `files.write` + `books.write` | ✅ 现有 `/internal/toolbox/import` | 兼容旧 `file_path` 入参 |
| `files.export@1` | `files.read` | ✅ 现有 `/internal/toolbox/library/export` | 导出指定格式 |
| `files.metadata@1` | `files.read`（`artifact:<id>`） | ✅ 4B `GET /artifacts/:id` | 大小、格式、SHA-256、任务归属；不返回路径 |

### 3.3 任务

| 能力 | 权限 | 现状 | 说明 |
| --- | --- | --- | --- |
| `jobs.create@1` | `jobs.create` | ✅ 现有 `POST /internal/toolbox/tasks` | 创建任务 |
| `jobs.get@1` | `jobs.create`（本人任务） | ✅ 4B `GET /tasks/:id` | 查询状态/阶段 |
| `jobs.progress@1` | `jobs.create` | ✅ 现有 `PATCH /tasks/:id` | 进度 0–100 |
| `jobs.cancel@1` | `jobs.create` | ✅ 4B `POST /tasks/:id/cancel` | 跨插件 403；无 cancel 路由 409 `CANCEL_UNSUPPORTED` |
| `jobs.result@1` | `jobs.create` | ✅ 4B `GET /tasks/:id/result` | 结果摘要 + 书籍 + Artifacts；不含宿主路径 |

### 3.4 配置

| 能力 | 权限 | 现状 | 说明 |
| --- | --- | --- | --- |
| `config.get@1` | 无（仅本插件） | ✅ 现有 `storage.get_config` | 敏感字段返回掩码 |
| `config.set@1` | 无（仅本插件） | ✅ 现有 `storage.set_config` | 加密落盘 |
| `config.validate@1` | 无（仅本插件） | ✅ 4B `POST /config/validate` | 按 Manifest `config.schema` 校验，不回显值 |

### 3.5 元数据

| 能力 | 权限 | 现状 | 说明 |
| --- | --- | --- | --- |
| `metadata.search@1` | `metadata.read` | ✅ CapabilityRouter | 多 Provider 选择、兜底 |
| `metadata.isbn@1` | `metadata.read` | ◐ 现有 ISBN 路由 | 单 ISBN 校验/查询 |

### 3.6 事件

| 事件 | 触发 | 现状 |
| --- | --- | --- |
| `book.created` | 书籍创建/导入成功 | ○ 4B 接入 EventBus |
| `book.updated` | 书籍字段更新 | ○ 4B |
| `reading.status.changed` | 阅读状态变化 | ○ 4B |
| `plugin.enabled` / `plugin.disabled` | 生命周期 | ○ 4A |

订阅必须在 Manifest `events[]` 中声明；未声明不投递。事件只携带最小字段（`book_id`、变更字段名），不携带全文或凭据。

## 4. Python SDK

### 4.1 包结构（规划）

```text
plugin-sdk/python/
├── pyproject.toml                # mybooks-plugin-sdk
├── mybooks_plugin_sdk/
│   ├── __init__.py               # sdk, Plugin, route, Response
│   ├── books.py  files.py  jobs.py  config.py  metadata.py
│   ├── errors.py                 # PluginError 与错误码
│   ├── contract.py               # 输入/输出校验（与 Node 共用测试向量）
│   └── compat.py                 # 旧 BaseTool/CoreAPI 适配
└── tests/
```

SDK 由 Worker 镜像预装，插件包不携带 SDK 副本。

### 4.2 兼容模式（现有插件）

现有 `BaseTool` + `CoreAPI` 继续可用，不强制迁移：

```python
from webserver.toolbox.plugin_host import BaseTool

class ZLibraryTool(BaseTool):
    async def search(self, handler):
        data = await self.api.node.search_books(handler.get_query_argument("q"))
        return {"err": "ok", "items": data}
```

SDK 的兼容层只是把 `self.api` 的命名空间映射为 `sdk.*`，行为不变。

### 4.3 SDK 模式（4B 新增）

```python
from mybooks_plugin_sdk import Plugin, route, Response, errors

class MdToEpubTool(Plugin):
    plugin_id = "md_to_epub"

    @route("convert", methods=["POST"], timeout_ms=300000)
    async def convert(self, req):
        title = req.form.get("title") or "Untitled"
        task = await self.sdk.jobs.create({"operation": "convert", "details": {"title": title}})

        work = self.sdk.files.work_dir(unique_key=task["job_id"])
        epub = await self.build_epub(req.files["markdown"], work, title)

        artifact = await self.sdk.files.publish({
            "job_id": task["job_id"],
            "path": epub,
            "format": "epub",
            "max_bytes": 80 * 1024 * 1024,
        })
        await self.sdk.jobs.progress(task["job_id"], 100)
        await self.sdk.jobs.complete(task["job_id"], status="done")
        return Response.json({"err": "ok", "artifact_id": artifact["artifact_id"]})
```

约束：

- `req.form` / `req.files` 只包含本次请求数据，最大 body 由 Manifest 与宿主上限共同约束。
- 插件返回统一 `{"err": "ok", "data": ...}`；异常抛 `errors.PluginError(code, message)`，宿主映射为稳定错误码。
- 任务失败必须调用 `jobs.complete(status="failed")`；进程崩溃由宿主标记失败。

### 4.4 能力调用签名（节选）

```python
await sdk.books.search({"q": "三体", "limit": 20})
await sdk.books.get(book_id=1)
await sdk.books.create({"title": "三体", "authors": ["刘慈欣"]})
await sdk.books.update(book_id=1, fields={"title": "三体（新版）"})
await sdk.books.reading_status(book_id=1)

await sdk.files.publish({"job_id": 12, "path": "out.epub", "format": "epub"})
await sdk.files.import_file({"job_id": 12, "path": "out.epub", "title": "三体"})
await sdk.files.metadata(artifact_id="art_...")

task = await sdk.jobs.create({"operation": "download"})
await sdk.jobs.progress(task["job_id"], 42)
await sdk.jobs.complete(task["job_id"], status="done")
await sdk.jobs.cancel(task["job_id"])

cfg = await sdk.config.get()          # 敏感字段为 "******"
await sdk.config.set({"cookie": "..."})
await sdk.config.validate({"title": "x"})

await sdk.metadata.search({"isbn": "9787020002207"})
```

所有方法默认 60 秒超时；`jobs.*` 与 `files.*` 的长操作按能力建议值（见能力目录）。取消使用 `asyncio.CancelledError` 或宿主 `abort` 信号。

### 4.5 错误码

| 错误码 | HTTP | 可重试 | 说明 |
| --- | --- | --- | --- |
| `VALIDATION` | 400 | 否 | 参数/配置不合法 |
| `PERMISSION_DENIED` | 403 | 否 | 无授权 |
| `PERMISSION_RESOURCE_REQUIRED` | 403 | 否 | 资源型权限缺 resource |
| `PLUGIN_IDENTITY_REQUIRED` | 403 | 否 | 严格模式缺身份 |
| `PLUGIN_IDENTITY_INVALID` | 403 | 否 | 令牌错误 |
| `TOOL_DISABLED` | 403 | 否 | 插件已停用 |
| `POLICY_BROKEN` | 403 | 否 | grants 损坏且无快照 |
| `NOT_FOUND` | 404 | 否 | 资源不存在 |
| `CONFLICT` | 409 | 否 | 版本/状态冲突 |
| `CANCEL_UNSUPPORTED` | 409 | 否 | 插件无 cancel 路由 |
| `RATE_LIMITED` | 429 | 是 | 超出配额 |
| `UPSTREAM_TIMEOUT` | 504 | 是 | 上游/运行时超时 |
| `CAPABILITY_ABORTED` | 499 | 否 | 调用方取消 |
| `RUNTIME_UNAVAILABLE` | 503 | 是 | Worker/子进程不可用 |
| `RUNTIME_ISOLATION` | 503 | 否 | 独立 UID/权限配置错误 |
| `RUNTIME_MODE` | 503 | 否 | Node/Python 认证模式不一致 |

Python SDK 将 HTTP 错误映射为 `PluginError(code, message, status, retryable)`；插件不得把宿主错误码改写成 `err=ok`。

## 5. 前端 SDK

### 5.1 加载

```html
<script src="/static/toolbox-bridge.js"></script>
<script src="/static/plugin-sdk/v1.js"></script>
```

- `toolbox-bridge.js` 保持现有路径与 v1 API。
- `plugin-sdk/v1.js` 是新增的薄封装，不替代 Bridge。
- 资源由宿主提供并带 CSP 白名单；插件不得自行加载 CDN 脚本（默认 `default-src 'none'`）。

### 5.2 API

```js
MyBooksUI.ready({ protocol: 2 }).then((caps) => {
  // caps: { protocol: 2, bridge: 2, slots: [...], schema: true }
});

// 能力调用（等价 bridge.fetch）
const data = await MyBooksUI.bridge.fetch('search?q=三体');
const res = await MyBooksUI.bridge.fetch('convert', {
  method: 'POST',
  body: JSON.stringify({ title: '三体' }),
});

// 任务轮询（4B）
const stop = MyBooksUI.jobs.watch(jobId, {
  intervalMs: 1500,
  onUpdate(job) { /* status/progress */ },
  onDone(job) { /* result */ },
});

// 配置表单（4D，Schema UI）
MyBooksUI.config.render(document.querySelector('#config'), schema, {
  values: await MyBooksUI.config.get(),
  onSave: (values) => MyBooksUI.config.save(values),
});

// 主题/语言
MyBooksUI.onThemeChange((theme) => {});
MyBooksUI.onLocaleChange((locale) => {});
```

### 5.3 消息协议（v2）

| 方向 | type | 说明 |
| --- | --- | --- |
| 插件 → 宿主 | `hello` | `{protocol:2, sdk:"1.0.0", capabilities:[...]}` |
| 宿主 → 插件 | `hello-ack` | 协商结果与可用能力 |
| 插件 → 宿主 | `fetch` | 现有字段 + `id/timeoutMs` |
| 宿主 → 插件 | `fetch-result` | 现有字段 + `status/ok` |
| 插件 → 宿主 | `notify` | 现有 |
| 宿主 → 插件 | `theme-change` / `locale-change` | 现有 |
| 插件 → 宿主 | `download` / `open-book` | 现有 |
| 插件 → 宿主 | `resize` | 现有（高度上报） |

新增消息必须：
1. 同时校验 `event.source === iframe.contentWindow`、`nonce`、`toolId`；
2. 在宿主端做字段白名单与长度/大小限制；
3. 不因为 `event.origin === 'null'` 放行；
4. 不把宿主 Token、Cookie、内部路径返回给插件。

## 6. 与现有 CoreAPI 的映射

| CoreAPI | SDK | 说明 |
| --- | --- | --- |
| `api.storage.get_config/set_config` | `sdk.config.*` | 加密落盘不变 |
| `api.tasks.create_task/update_progress/complete_task` | `sdk.jobs.*` | 任务表不变 |
| `api.calibre.import_file/get_metadata/set_metadata` | `sdk.books.*` / `sdk.files.*` | 走内部接口 |
| `api.node.search_books/books/fields` | `sdk.books.search/get` | 现有 NodeClient |
| `api.messages.send_message` | `sdk.jobs.message`（新增） | 现状保留 |
| `api.settings.get` | 插件只读宿主设置 | 需 `settings.read` |
| `api.utils.*` | 保留在 CoreAPI | 纯函数，不进入 SDK v1 |

## 7. 测试要求

- 契约测试：Python/前端共用 JSON 测试向量（输入/输出/错误码）。
- 兼容测试：旧 `BaseTool` 插件在 SDK 安装后行为不变。
- 权限测试：未授权调用必须 403，且错误码不被改写。
- 传输测试：Bridge v1 请求在 v2 宿主上仍工作；未知消息被忽略。
- 真实插件：zlibrary、md_to_epub 各跑一条完整链路（搜索/转换/下载/入库）。

## 8. Phase 4B 实施结果（2026-11-09）

已实现并验证：

- Python `plugin-sdk/python/mybooks_plugin_sdk` 1.0.0：`books/files/jobs/config/metadata` + `PluginError` + `compat.from_tool/attach`；无第三方运行时依赖。
- Runtime：`CoreAPI.sdk` 懒加载（旧属性不变）、`NodeClient.request` 与新能力方法、`toolbox/sdk.py` 缓存装配；镜像构建前 `npm run sdk:sync`，SDK 位于 `/app/sdk`。
- 内部接口：books create/PATCH/reading、artifacts publish/get/delete、tasks get/result/cancel、config validate、metadata search。
- Artifact：`toolbox_artifacts`（migrate v28，纯增量）；`files.write:artifact:*` / `files.read:artifact:*`；路径穿越、符号链接、跨插件、超限、SHA 校验均有测试。
- 前端：`/static/plugin-sdk/v1.js`（Bridge 薄封装、`jobs.watch().stop()`、pagehide 自动释放）；CSP 精确放行该文件。
- 测试：Node 800/800（新增 `test/plugins-sdk-contract.test.js`）；Python SDK 13 项、runtime 4 项；Docker 镜像内可导入并跑通 runtime SDK 测试。

未实施（不得标记为完成）：

- `Plugin` / `route` 装饰器加载体系（宿主仍只加载 `BaseTool`）。
- 事件订阅（`book.created` 等）与 4D UI Slot。
- `files.download@1` 的独立 Artifact 下载端点（现有书库下载路由保持不变）。
- 真实插件数据包本轮未重新下载；旧插件兼容由现有 `plugin-*.test.js` / `toolbox.test.js` 回归覆盖。
