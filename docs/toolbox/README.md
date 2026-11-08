# Mybooks 工具箱：动态工具系统

本目录记录 Mybooks 对 PoxenStudio/MyBooks Toolbox 动态工具系统的兼容实现。
Node.js 主服务不改成 Python；第三方 Python 工具运行在独立 Worker 容器中。

## 1. 架构

```text
浏览器
  │  /toolbox                     Mybooks 外层管理页
  │  /toolbox/tool/{id}           通用宿主页（原生 HTML + iframe）
  │  /get/tool/{id}/index.html    插件自己的原生前端
  ▼
Node.js / Express
  ├── routes.toolbox.js           商店、安装、启停、任务、API 网关
  ├── routes.toolbox.ui.js        页面、插件资源、CSP、图标、/book 深链
  ├── routes.toolbox.internal.js  Python Worker 专用内部接口（共享密钥）
  ├── core/toolbox/store.js      mybooks.top 索引 + SHA-256 + SSRF/重定向校验
  ├── core/toolbox/installer.js  解压、manifest、原子安装/更新/回滚/卸载
  ├── core/toolbox/library.js    书库 ↔ Calibre 风格 dict 的内部适配
  └── SQLite (books.db)          现有书籍、文件、标签、同步表 + 工具箱表
  ▼
Python 3.12 Worker（独立容器，非 root、无公网端口）
  ├── plugin_host.py             importlib 动态 package / Handler 路由表
  ├── webserver/toolbox/         BaseTool、CoreAPI、Storage、Tasks、NodeClient
  ├── webserver/services/        AsyncService、BackgroundService 兼容层
  ├── webserver/handlers/base.py js / is_admin / auth / 请求上下文
  └── 插件自己的 backend/       原样 import，不重写业务逻辑
  ▼
共享卷 toolbox-data（/toolbox）
  plugins/<tool_id>/             安装目录
  data/<tool_id>/                插件私有配置、工作目录、导出文件
  state/installed.json           Node 导出的启用清单
  state/runtime-secret           Node → Python 鉴权
  state/internal-secret          Python → Node 鉴权
```

主数据库 `data/books.db`、`uploads/`、`books-files/` **不挂载给 Python Worker**。
插件需要正文时，Node 的 `exportFile` 把文件复制到共享卷的
`data/<tool_id>/exports/`，插件只读取该副本。

## 2. 上游对照

| 上游 | 本实现 | 状态 |
| --- | --- | --- |
| `manifest.json` 必填字段、`entry_backend`、`entry_frontend`、`api_routes` | `src/core/toolbox/manifest.js` | 兼容 |
| ZIP / 7z 安装包 | `zip.js`（yauzl + node-7z）/ `installer.js` | 兼容 |
| SHA-256 → 安全解压 → manifest → 安装记录 → 待重启 | `installer.js` | 兼容 |
| `/api/toolbox/{id}/install`、`/enable`、`/disable`、`DELETE` | `routes.toolbox.js` | 兼容，另保留 `/install`、`/update` |
| `InstalledTool` 的 type/source/enabled/install_time/update_time/pending_restart/last_error | `toolbox_tools` 表 + `routes.toolbox.js` | 兼容 |
| `importlib` package、相对 import、模块缓存、BaseTool 子类 | `toolbox-runtime/webserver/toolbox/plugin_host.py` | 兼容 |
| `api_routes[]` 动态路由 | Python 注册表 + 通配 dispatcher；Node 网关只放行声明路径 | 行为兼容，路径按字面匹配 |
| `/get/tool/{id}/index.html`、资源、图标 | `routes.toolbox.ui.js` | 兼容 |
| `toolbox-bridge.js` 的 toolId/theme/locale/fetch/notify/onChange | `public/static/toolbox-bridge.js` | 兼容，使用 sandbox 不透明源 + nonce |
| `BaseTool` 工作目录/任务/入库 | `webserver/toolbox/base_tool.py` | 已覆盖首批工具 |
| `CoreAPI.calibre/db/tasks/messages/storage/settings/utils` | `webserver/toolbox/core_api.py` + `library.js` | 按首批工具并集实现 |
| `AsyncService.register_function/register_service` | `async_service.py` | 兼容；单 Worker 串行 |
| `BackgroundService` 内存任务 | `background_service.py` | 兼容 |
| `script src="/static/toolbox-bridge.js"` | Node 静态文件 + SW 跳过缓存 | 兼容 |

完整逐插件矩阵见 [UPSTREAM_COMPATIBILITY.md](UPSTREAM_COMPATIBILITY.md)。

## 3. 生命周期（“重启 Worker 生效”）

1. 管理员在 `/toolbox` 商店选择已审查插件。
2. Node 下载 ZIP/7z，校验商店 SHA-256，校验重定向/大小/主机。
3. 在 `plugins/.staging-*` 解压，做路径/符号链接/压缩比/条目数检查。
4. 解析 manifest，校验 `tool_id/revision/entry_backend/entry_frontend/api_routes`。
5. 原子移动到 `plugins/<tool_id>`；旧版本移到 `.previous/`。
6. 写入 `toolbox_tools`（`pending_restart=1`）与 `state/installed.json`。
7. 管理员点击“重启插件运行时” → Node 调 Python `/internal/reload`。
8. Python `importlib` 加载启用的工具，返回加载报告；Node 按报告清
   `pending_restart`，加载失败的写入 `last_error`。
9. 打开 `/toolbox/tool/<id>`，iframe 加载插件原生 UI；所有 API 经
   `/api/toolbox/tool/<id>/<route>` 到 Node，再到 Python。

安装/更新请求本身不会执行第三方 Python 代码；禁用工具后 Node 立即拒绝 API 和
前端资源，不必等待 Worker 重启。

## 4. 前端隔离

插件页面使用 `sandbox="allow-scripts allow-modals allow-downloads"`，没有
`allow-same-origin`；同时响应头带 CSP `sandbox`，即使直接打开也是不透明源。
插件拿不到主站 Cookie/DOM，也不能直接访问 `/api/*`。所有接口通过
`postMessage` RPC 交给父页面，父页面校验：

- `event.source === iframe.contentWindow`
- 本次随机 nonce
- `toolId`
- manifest `api_routes` 精确路由白名单
- HTTP 方法白名单

Bridge 的 `fetch` 返回解析后的 JSON 或文本，与上游一致；FormData 会拆成
字符串/文件片段，由父页面重建，兼容 MD 转 EPUB 的上传。

## 5. 文档索引

- [UPSTREAM_COMPATIBILITY.md](UPSTREAM_COMPATIBILITY.md)：上游源码映射与逐插件矩阵
- [API.md](API.md)：管理 API、插件 API 网关、Bridge、Python 内部接口
- [SECURITY.md](SECURITY.md)：威胁模型、已实现控制、已知限制
- [DEPLOYMENT.md](DEPLOYMENT.md)：Docker、首次安装、更新回滚
- [TESTING.md](TESTING.md)：运行命令与真实验收记录
