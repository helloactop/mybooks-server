# 工具箱接口文档

所有 `/api/toolbox/*` 管理接口和插件网关都要求 Mybooks 设备会话/Bearer；
`/internal/toolbox/*` 只接受共享卷 `state/internal-secret`，不经过用户会话。
插件前端不直接请求 `/api/*`，只通过父页面 Bridge。

## 1. 管理 API（Node）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/toolbox/store/index` | 商店索引 + 安装/审查/兼容状态；`?refresh=1` 强制刷新 |
| POST | `/api/toolbox/store/refresh` | 清空缓存并重新拉商店 |
| GET | `/api/toolbox/installed` | 已安装工具（含 pending_restart/last_error） |
| GET | `/api/toolbox/list?include_disabled=1` | 上游管理端格式；返回 `store_enabled: true` |
| POST | `/api/toolbox/install` | body `{tool_id}`，商店安装 |
| POST | `/api/toolbox/:id/install` | 上游路径；已安装时走更新 |
| POST | `/api/toolbox/:id/update` | 商店更新到最新 revision |
| POST | `/api/toolbox/:id/enable` | 启用；`pending_restart=1` |
| POST | `/api/toolbox/:id/disable` | 停用；Node 立即拒绝 API/资源 |
| POST | `/api/toolbox/:id/rollback` | 回滚到保留的旧版本 |
| DELETE | `/api/toolbox/:id` | 卸载；默认保留私有数据，`?purge_data=1` 一并删除 |
| POST | `/api/toolbox/install/upload` | 开发者模式上传安装包（multipart `file`） |
| POST | `/api/toolbox/:id/update/upload` | 开发者模式更新上传 |
| GET | `/api/toolbox/runtime` | Worker 健康状态 |
| POST | `/api/toolbox/runtime/restart` | 独立 Worker reload；返回加载报告并清 pending_restart |
| GET | `/api/toolbox/tasks?status=&limit=` | 持久任务列表 |
| GET | `/api/toolbox/tasks/:id` | 单个任务 |
| POST | `/api/toolbox/tasks/:id/cancel` | 调用插件的 `cancel` 路由 |
| GET | `/api/toolbox/tools/:id/icon` | 已安装工具图标（需会话） |
| GET | `/api/toolbox/tool/:id/:route` | 插件 API 网关 |
| POST | `/api/toolbox/tool/:id/:route` | 插件 API 网关（也支持 PUT/PATCH/DELETE） |

管理端失败响应同时包含：

```json
{"error":"人类可读消息","code":"HOST_CODE","err":"plugin.code","msg":"人类可读消息"}
```

`err/msg` 兼容插件前端原生错误处理；`error/code` 供 Mybooks UI 使用。

## 2. 插件 API 网关

- `tool_id` 必须是 `^[a-z0-9_]{1,64}$`，已安装且 `enabled=1`。
- 路由必须出现在该插件 `manifest.api_routes` 中，按字面精确匹配。
- 方法：GET/POST/PUT/PATCH/DELETE；Python 端再检查 Handler 是否定义对应方法。
- JSON 请求体：`express.json` 解析后转发 JSON。
- `multipart/form-data`：Node 读取原始流（上限 100MB）转发给 Python；Tornado
  解析为 `self.request.files`，兼容 md_to_epub。
- `download` / `result` 的 GET 响应按二进制转发，保留 `Content-Type` /
  `Content-Disposition`。
- 超时：health/search/convert/translate 120s；download/result 60s；其余 45s。
- Worker 不可用返回 503 `host.unavailable`；未加载工具返回 404 `tool.disabled`。

## 3. 插件前端资源

| 路径 | 说明 |
| --- | --- |
| `/toolbox` | 工具箱管理页（会话保护） |
| `/toolbox/tool/:id` | 通用宿主页（会话保护） |
| `/get/tool/:id/index.html` | 插件 `entry_frontend`（映射为 index） |
| `/get/tool/:id/*` | `frontend/` 内资源；只允许 html/js/css/json/图片/字体 |
| `/get/tool/:id/icon` | 插件根目录 icon.png/jpg/webp |
| `/book/:id` | 302 到 `/shelf?book=:id`，供插件结果链接 |

`/get/tool/*` 不要求 Cookie（sandbox 不透明源不会带 Cookie），但只服务
已启用工具，且响应带 CSP `sandbox`、`frame-ancestors`、`connect-src` 限制。

## 4. MyBooksToolBridge 协议

插件页面加载 `/static/toolbox-bridge.js`，获得：

```js
window.MyBooksToolBridge = {
  toolId, theme, locale,
  fetch(path, options),       // Promise<JSON | text>
  notify(message, level),
  onThemeChange(fn), onLocaleChange(fn)
}
```

- `path` 相对插件 API 根，`/api/toolbox/tool/{toolId}/{path}`。
- `options` 支持 GET/POST/PUT/PATCH/DELETE、`headers`、字符串 body、FormData。
- `fetch` 解析 JSON 后返回对象/数组，否则返回文本；与上游一致，**不是**原生 Response。
- `notify` 通过 postMessage 交给宿主 Toast。
- `resize` 由 ResizeObserver 自动上报。

### postMessage

插件 → 宿主（`source: "mybooks-toolbox-bridge"`）：

```json
{"source":"mybooks-toolbox-bridge","nonce":"...","toolId":"zlibrary","type":"fetch","id":"...","path":"config","method":"GET"}
{"source":"mybooks-toolbox-bridge","nonce":"...","toolId":"md_to_epub","type":"fetch","id":"...","bodyType":"formdata","parts":[{"name":"files","fileName":"a.md","type":"text/markdown","buffer":"<ArrayBuffer>"}]}
{"source":"mybooks-toolbox-bridge","type":"notify","message":"...","level":"success"}
{"source":"mybooks-toolbox-bridge","type":"download","url":"/api/toolbox/tool/md_to_epub/download?token=...","filename":"book.epub"}
{"source":"mybooks-toolbox-bridge","type":"open-book","bookId":4}
{"source":"mybooks-toolbox-bridge","type":"resize","height":800}
```

宿主 → 插件（`source: "mybooks-toolbox-host"`）：

```json
{"source":"mybooks-toolbox-host","nonce":"...","toolId":"...","type":"fetch-result","id":"...","status":200,"json":{...}}
{"source":"mybooks-toolbox-host","type":"theme-change","theme":"dark"}
{"source":"mybooks-toolbox-host","type":"locale-change","locale":"en"}
```

宿主只信任 `event.source === iframe.contentWindow` + nonce + toolId；不靠
`event.origin === "null"` 判断。

## 5. Python Worker 内部接口

请求头：

- `X-Mybooks-Runtime-Secret`（Node → Python）
- `X-Toolbox-Internal-Secret`（Python → Node）
- `X-Mybooks-User-Id`（Node 会话 ID / 设备会话 ID）

Node → Python：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/internal/reload` | 重新读取安装清单并 import |
| GET | `/healthz` | 健康检查（无密钥，内部网络） |
| * | `/tool/:tool_id/:route` | 动态 Handler 分发 |

Python → Node：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/internal/toolbox/library/ids?q=&limit=` | 全库/查询 ID |
| GET | `/internal/toolbox/library/books?ids=|q=&limit=` | Calibre 风格书籍 dict |
| GET | `/internal/toolbox/library/fields?field=&ids=` | tags / #category 等批量字段 |
| GET | `/internal/toolbox/library/cover/:id` | base64 本地封面 |
| POST | `/internal/toolbox/library/export` | 复制正文到工具共享工作目录 |
| POST | `/internal/toolbox/library/books/:id/metadata` | 设置标签/标题/作者等 |
| POST | `/internal/toolbox/library/books/:id/delete` | 软删除（回收站） |
| POST | `/internal/toolbox/library/books/:id/merge-formats` | 复制目标缺少的格式 |
| POST | `/internal/toolbox/library/items` | 兼容 create_item（Mybooks 单管理员，记录为 no-op） |
| POST | `/internal/toolbox/import` | 文件 → Mybooks 书库（校验/查重/入库） |
| POST | `/internal/toolbox/tasks` | 创建持久任务 |
| PATCH | `/internal/toolbox/tasks/:id` | 进度/状态 |
| POST | `/internal/toolbox/tasks/:id/message` | 任务消息 |

这些内部接口不暴露给插件前端；Worker 的插件代码若恶意仍可读共享卷/进程内密钥，
见 [SECURITY.md](SECURITY.md) 的限制说明。
