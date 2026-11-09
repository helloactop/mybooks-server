# Manifest v1 规范

> 状态：○ 规划（Phase 4A 实施）· 与现有 `src/core/toolbox/manifest.js` 双读兼容
> 关键词：MUST / SHOULD / MAY 按 RFC 2119 语义使用。

## 1. 目标与原则

1. **超集兼容**：v1 是现有 manifest 的超集。没有 `manifest_version` 的旧包继续按 Legacy 解析，不改包、不改安装器入口。
2. **声明与授权分离**：Manifest 只声明“需要什么权限”，不产生任何授权；实际调用由 `GrantStore` / `grants.json` 决定。
3. **不可自证可信**：插件不能通过 Manifest 把自己标记为官方/已审查；信任级别由宿主/商店赋予。
4. **前向兼容**：新增可选字段不破坏旧宿主；未知字段有明确处理策略。
5. **可执行校验**：所有字段有类型、范围、长度与枚举约束，解析失败不影响已安装版本。

## 2. 版本规则

| 字段 | 含义 | 规则 |
| --- | --- | --- |
| `manifest_version` | Manifest 结构版本 | 整数；v1 = `1`；缺失视为 Legacy（等价 0） |
| `revision` | 插件版本（沿用旧字段名） | `x.y.z` 语义化版本；同一版本内容不可变 |
| `core_api_version` | 插件依赖的宿主 CoreAPI 版本 | `x.y.z`；大于宿主 `CORE_API_MAX` 时拒绝加载 |
| `min_host_version` | 可选的最低宿主版本 | `x.y.z`；仅用于展示与阻断，不能替代 `core_api_version` |
| `api_version` | 新增能力的契约版本 | 出现在 `provides[].version`，如 `1` |

> 注意：`core_api_version` 是 **宿主能力版本**，`manifest_version` 是 **文件结构版本**，两者不能混用。

## 3. 字段总表

### 3.1 基本信息（必填）

| 字段 | 类型 | 必填 | 旧字段映射 | 说明 |
| --- | --- | --- | --- | --- |
| `manifest_version` | integer | v1 必填 | — | 固定 `1` |
| `tool_id` | string | 是 | 同名 | `^[a-z0-9_]{1,64}$`；v1 中作为稳定唯一 ID |
| `name` | string | 是 | 同名 | ≤120 字符 |
| `description` | string | 是 | 同名 | ≤2000 字符 |
| `revision` | string | 是 | 同名 | `x.y.z` |
| `author` | string \| object | 是 | 同名（字符串） | v1 允许 `{ "name", "url" }` |
| `core_api_version` | string | 是 | 同名 | `x.y.z` |
| `repo_url` | string | 是 | 同名 | https URL |
| `entry_backend` | string | Legacy 必填 | 同名 | `<module>.<ClassName>` |
| `runtime.entry` | string | v1 必填 | 映射自 `entry_backend` | 与旧格式同义 |

### 3.2 展示与发现（可选）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `homepage` | string | https URL |
| `icon` | string | 包内相对路径，默认 `icon.png`；只允许 png/jpg/jpeg/webp |
| `license` | string | SPDX 标识或短文本 |
| `categories` | string[] | 最多 8 项，取值见 §3.8 |
| `tags` | string[] | 最多 20 项，≤32 字符 |
| `publish_date` | string | ISO 日期；沿用旧字段 |
| `locales` / `default_locale` | string[] / string | 沿用旧规则 |

### 3.3 运行时

```json
"runtime": {
  "type": "python",
  "entry": "backend.main.MdToEpubTool",
  "python": ">=3.12",
  "limits": {
    "memory_mb": 384,
    "timeout_seconds": 300,
    "max_open_files": 256
  }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `type` | 是 | Phase 4 只允许 `python`；`javascript` 预留，宿主不支持时拒绝 |
| `entry` | 是 | 模块 + 类名；模块必须在包内 |
| `python` | 否 | 版本约束；不满足时拒绝 |
| `limits.memory_mb` | 否 | 不得超过宿主上限（默认 384） |
| `limits.timeout_seconds` | 否 | 单请求上限，默认 120 |
| `limits.max_open_files` | 否 | 默认 256 |

### 3.4 后端路由

v1 保留旧 `api_routes`，并新增可直接表达方法与超时的 `routes`：

```json
"api_routes": [
  { "path": "convert", "handler": "backend.routes.ConvertHandler" }
],
"routes": [
  {
    "path": "convert",
    "handler": "backend.routes.ConvertHandler",
    "methods": ["POST"],
    "timeout_ms": 120000,
    "max_body_bytes": 104857600
  }
]
```

规则：

- `path` 不得包含 `..`、反斜杠、协议前缀；最多 32 条且不重复。
- `methods` 默认 `["GET", "POST"]`；只允许 GET/POST/PUT/PATCH/DELETE。
- v1 中若同时存在 `api_routes` 与 `routes`，按 `path` 合并，冲突时以 `routes` 为准并记录 warning。
- 路由豁免权：宿主只代理声明过的精确路径（现有 `findRoute` 行为），未声明一律 404 `ROUTE_NOT_FOUND`。

### 3.5 前端入口

```json
"frontend": {
  "entry": "frontend/index.html",
  "bridge": 2,
  "theme": "auto",
  "min_height": 480
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `entry` | 否 | 包内 HTML；映射旧 `entry_frontend`；无前端可省略 |
| `bridge` | 否 | 支持的最高 Bridge 版本；默认 1 |
| `theme` | 否 | `auto` / `light` / `dark` |
| `min_height` | 否 | 宿主 iframe 初始高度 |

### 3.6 权限声明

```json
"permissions": [
  { "name": "books.read", "scope": "library:all", "reason": "搜索并展示书籍" },
  { "name": "files.write", "scope": "artifact:md_to_epub:*", "reason": "保存转换产物" },
  { "name": "jobs.create", "reason": "创建转换任务" }
]
```

规则：

1. `name` 必须在权限目录中（见 [SECURITY.md](SECURITY.md#3-权限体系)）；未知权限 → 严格模式拒绝安装。
2. 资源型权限（`books.*`、`files.*`、`metadata.write`）必须给出 `scope`。
3. `scope` 只表达“申请范围上限”，用户授权可进一步收窄，不能扩大。
4. `reason` 必填且 ≤200 字符，用于授权 UI；禁止空泛文案。
5. 声明不等于授权；未授权调用返回 403 `PERMISSION_DENIED`。
6. 更新新增权限时，宿主必须展示差异并要求重新确认（Phase 4C）。

### 3.7 配置 Schema

```json
"config": {
  "schema": {
    "type": "object",
    "properties": {
      "cookie": { "type": "string", "x-sensitive": true, "title": "登录 Cookie" },
      "download_dir": { "type": "string", "default": "downloads" },
      "concurrency": { "type": "integer", "minimum": 1, "maximum": 4, "default": 1 }
    },
    "required": ["cookie"]
  }
}
```

支持子集：`type`（object/string/integer/number/boolean/array）、`properties`、`required`、`enum`、`default`、`minimum`、`maximum`、`maxLength`、`format`（url/email/date-time）、`x-sensitive`、`x-multiline`、`title`、`description`。

- `x-sensitive` 字段由宿主加密保存（沿用 `storage.set_config`），读取接口只返回掩码。
- 配置校验失败返回 `VALIDATION`，不写入。
- 插件不得自行在 Manifest 中声明“已配置”，配置状态由存储层判断。

### 3.8 分类枚举

`toolbox` 管理端使用以下固定分类（可扩展但需版本化）：

```text
metadata      元数据与书源
conversion    格式转换
library       书库管理
reader        阅读增强
sync          同步与备份
device        设备与推送
statistics    统计与可视化
other         其他
```

### 3.9 依赖

```json
"dependencies": {
  "plugins": [{ "tool_id": "zlibrary", "version": "^0.1.0", "optional": false }],
  "capabilities": [{ "name": "metadata.search", "version": "1", "optional": true }]
}
```

- 只允许声明已安装或商店可解析的依赖；循环依赖必须在安装前拒绝。
- 依赖失败不自动安装（Phase 4A 只做检测与提示），避免供应链放大。
- 运行时（4B）可按 `capabilities` 声明做 Provider 选择，但不改变现有 Registry。

### 3.10 资源与生命周期

```json
"resources": {
  "memory_mb": 384,
  "timeout_seconds": 300,
  "max_artifact_mb": 80,
  "max_concurrent_jobs": 1
},
"lifecycle": {
  "on_install": "backend.hooks.on_install",
  "on_enable": "backend.hooks.on_enable",
  "on_disable": "backend.hooks.on_disable",
  "on_uninstall": "backend.hooks.on_uninstall"
}
```

- 生命周期钩子只允许在宿主控制下执行；`on_install` 不得在安装请求内执行第三方代码（现行安装器只落盘，重启后才加载）。
- 钩子失败不得阻止卸载；必须记录 `last_error`。

### 3.11 事件与能力 Provider

```json
"events": [
  { "name": "book.created", "filter": { "source": "import" } },
  { "name": "reading.status.changed" }
],
"provides": [
  { "capability": "books.convert", "version": "1", "entry": "backend.capabilities.ConvertProvider" }
]
```

- 事件名必须在宿主事件目录中；未声明的事件不会投递。
- `provides` 只声明能力实现；注册仍需经过 Kernel/Registry 的契约校验与权限检查。

### 3.12 UI 声明

```json
"ui": {
  "protocol": 2,
  "pages": [
    {
      "id": "main",
      "title": "Markdown 转 EPUB",
      "entry": "frontend/index.html",
      "slot": "toolbox.tool"
    }
  ],
  "slots": [
    {
      "id": "book-actions",
      "slot": "book.detail.actions",
      "schema": {
        "type": "object",
        "properties": {
          "label": { "type": "string", "default": "转换为 EPUB" }
        }
      }
    }
  ]
}
```

Phase 4 只强制实现 `toolbox.tool`（整页 iframe）；其他 Slot 由 4D 定义、4E 逐步开放，未识别的 Slot 必须被宿主忽略而不是报错。

### 3.13 发布者与签名

```json
"publisher": {
  "name": "PoxenStudio",
  "key_id": "ed25519:8f2c...",
  "url": "https://example.com"
}
```

- 包签名放在**独立文件** `manifest.sig`（detached），不放进 Manifest 自身体，避免自引用。
- 校验顺序：host 白名单 → SHA-256 → 签名（若配置了可信公钥）→ 审查状态。
- 无签名或签名未知的包仍可安装（在允许未审查插件的部署中），但信任级别只能是 `community` 或 `unreviewed`。
- 签名通过 ≠ 代码安全；仅表示发布者与内容完整。

## 4. 未知字段与兼容策略

| 情况 | 运行期（安装/加载） | 严格校验（打包/发布/审核） |
| --- | --- | --- |
| `x-` 前缀字段 | 允许，原样保留 | 允许 |
| 未知顶层字段 | 忽略 + warning（不参与执行） | 拒绝 `MANIFEST_UNKNOWN_FIELD` |
| 未知 `routes[]` 字段 | 忽略 + warning | 拒绝 |
| 未知权限名 | 拒绝该插件进入严格模式 | 拒绝 |
| 未知 `ui.slot` | 忽略该 Slot | warning |
| 未知 `runtime.type` | 拒绝加载 `RUNTIME_UNSUPPORTED` | 拒绝 |

严格校验模式通过 `validateManifest(raw, { strict: true })` 提供，供商店发布与 CI 使用。

## 5. 归一化描述符（PluginDescriptor）

解析结果统一为：

```json
{
  "id": "md_to_epub",
  "name": "Markdown to EPUB",
  "version": "1.2.0",
  "manifest_version": 1,
  "source": "store",
  "trust": "reviewed",
  "runtime": { "type": "python", "entry": "backend.main.MdToEpubTool" },
  "routes": [{ "path": "convert", "methods": ["POST"] }],
  "frontend": { "entry": "frontend/index.html", "bridge": 2 },
  "permissions": [{ "name": "files.write", "scope": "artifact:md_to_epub:*" }],
  "config_schema": { "...": "..." },
  "ui": { "protocol": 2, "pages": ["main"], "slots": [] },
  "compatibility": { "supported": true, "reasons": [] },
  "raw": { "...": "原始 manifest..." }
}
```

- `trust` 由宿主赋值：`official | reviewed | community | unreviewed | local`，Manifest 不能自证。
- `raw` 仅内部使用，对外 DTO 必须脱敏（不返回绝对路径、密钥、完整签名材料）。

## 6. 完整示例 A：Z-Library 插件

```json
{
  "manifest_version": 1,
  "tool_id": "zlibrary",
  "name": "Z-Library",
  "description": "从 Z-Library 搜索并下载电子书，支持账号配置与下载进度。",
  "revision": "0.1.0",
  "author": { "name": "PoxenStudio", "url": "https://github.com/PoxenStudio" },
  "homepage": "https://github.com/PoxenStudio/mybooks-toolbox-zlibrary",
  "repo_url": "https://github.com/PoxenStudio/mybooks-toolbox-zlibrary",
  "license": "MIT",
  "icon": "icon.png",
  "publish_date": "2026-11-01",
  "core_api_version": "1.3.0",
  "min_host_version": "1.0.0",
  "categories": ["metadata", "library"],
  "tags": ["z-library", "ebook", "download"],
  "locales": ["zh", "zh-TW", "en"],
  "default_locale": "zh",

  "runtime": {
    "type": "python",
    "entry": "backend.main.ZLibraryTool",
    "python": ">=3.12",
    "limits": { "memory_mb": 384, "timeout_seconds": 180, "max_open_files": 256 }
  },

  "entry_backend": "backend.main.ZLibraryTool",
  "api_routes": [
    { "path": "health", "handler": "backend.routes.HealthHandler" },
    { "path": "config", "handler": "backend.routes.ConfigHandler" },
    { "path": "search", "handler": "backend.routes.SearchHandler" },
    { "path": "download", "handler": "backend.routes.DownloadHandler" },
    { "path": "progress", "handler": "backend.routes.ProgressHandler" },
    { "path": "cancel", "handler": "backend.routes.CancelHandler" }
  ],
  "routes": [
    { "path": "health", "handler": "backend.routes.HealthHandler", "methods": ["GET"] },
    { "path": "config", "handler": "backend.routes.ConfigHandler", "methods": ["GET", "POST"] },
    { "path": "search", "handler": "backend.routes.SearchHandler", "methods": ["GET", "POST"], "timeout_ms": 120000 },
    { "path": "download", "handler": "backend.routes.DownloadHandler", "methods": ["POST"], "timeout_ms": 120000 },
    { "path": "progress", "handler": "backend.routes.ProgressHandler", "methods": ["GET"] },
    { "path": "cancel", "handler": "backend.routes.CancelHandler", "methods": ["POST"] }
  ],

  "frontend": { "entry": "frontend/index.html", "bridge": 2, "theme": "auto" },
  "entry_frontend": "frontend/index.html",

  "permissions": [
    { "name": "network.public", "reason": "访问 Z-Library 站点搜索与下载" },
    { "name": "books.read", "scope": "library:all", "reason": "避免重复下载并展示已入库状态" },
    { "name": "files.write", "scope": "artifact:zlibrary:*", "reason": "保存下载的电子书文件" },
    { "name": "jobs.create", "reason": "创建下载任务并上报进度" }
  ],

  "config": {
    "schema": {
      "type": "object",
      "properties": {
        "cookie": { "type": "string", "x-sensitive": true, "title": "登录 Cookie" },
        "email": { "type": "string", "format": "email", "title": "账号邮箱" },
        "mirror": { "type": "string", "enum": ["auto", "zlib.ch", "custom"], "default": "auto" },
        "download_dir": { "type": "string", "default": "downloads" }
      },
      "required": ["cookie"]
    }
  },

  "resources": {
    "memory_mb": 384,
    "timeout_seconds": 180,
    "max_artifact_mb": 80,
    "max_concurrent_jobs": 1
  },

  "lifecycle": {
    "on_enable": "backend.hooks.on_enable",
    "on_disable": "backend.hooks.on_disable"
  },

  "ui": {
    "protocol": 2,
    "pages": [
      { "id": "main", "title": "Z-Library", "entry": "frontend/index.html", "slot": "toolbox.tool" }
    ],
    "slots": []
  },

  "events": [{ "name": "book.imported" }],
  "provides": [],

  "publisher": {
    "name": "PoxenStudio",
    "key_id": "ed25519:example-key-id",
    "url": "https://github.com/PoxenStudio"
  },

  "compatibility": { "platforms": ["web", "android"], "host": ">=1.0.0 <2.0.0" }
}
```

## 7. 完整示例 B：Markdown to EPUB 插件

```json
{
  "manifest_version": 1,
  "tool_id": "md_to_epub",
  "name": "Markdown to EPUB",
  "description": "把 Markdown 与本地图片转换为 EPUB，并可直接导入书库。",
  "revision": "1.2.0",
  "author": { "name": "PoxenStudio" },
  "homepage": "https://github.com/PoxenStudio/mybooks-toolbox-md-to-epub",
  "repo_url": "https://github.com/PoxenStudio/mybooks-toolbox-md-to-epub",
  "license": "MIT",
  "icon": "icon.png",
  "publish_date": "2026-11-05",
  "core_api_version": "1.3.0",
  "min_host_version": "1.0.0",
  "categories": ["conversion"],
  "tags": ["markdown", "epub", "convert"],
  "locales": ["zh", "en"],
  "default_locale": "zh",

  "runtime": {
    "type": "python",
    "entry": "backend.main.MdToEpubTool",
    "python": ">=3.12",
    "limits": { "memory_mb": 384, "timeout_seconds": 300, "max_open_files": 256 }
  },

  "entry_backend": "backend.main.MdToEpubTool",
  "api_routes": [
    { "path": "convert", "handler": "backend.routes.ConvertHandler" },
    { "path": "download", "handler": "backend.routes.DownloadHandler" }
  ],
  "routes": [
    {
      "path": "convert",
      "handler": "backend.routes.ConvertHandler",
      "methods": ["POST"],
      "timeout_ms": 300000,
      "max_body_bytes": 104857600
    },
    { "path": "download", "handler": "backend.routes.DownloadHandler", "methods": ["GET"] }
  ],

  "frontend": { "entry": "frontend/index.html", "bridge": 2, "theme": "auto", "min_height": 520 },
  "entry_frontend": "frontend/index.html",

  "permissions": [
    { "name": "files.write", "scope": "artifact:md_to_epub:*", "reason": "保存转换后的 EPUB 文件" },
    { "name": "books.write", "scope": "library:all", "reason": "用户选择入库时创建书籍记录" },
    { "name": "jobs.create", "reason": "创建转换任务并上报进度" }
  ],

  "config": {
    "schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string", "title": "书名" },
        "author": { "type": "string", "title": "作者" },
        "language": { "type": "string", "enum": ["zh", "en", "ja"], "default": "zh" },
        "toc_depth": { "type": "integer", "minimum": 1, "maximum": 6, "default": 3 }
      },
      "required": ["title"]
    }
  },

  "resources": {
    "memory_mb": 384,
    "timeout_seconds": 300,
    "max_artifact_mb": 80,
    "max_concurrent_jobs": 2
  },

  "lifecycle": {
    "on_disable": "backend.hooks.on_disable"
  },

  "ui": {
    "protocol": 2,
    "pages": [
      { "id": "main", "title": "Markdown 转 EPUB", "entry": "frontend/index.html", "slot": "toolbox.tool" }
    ],
    "slots": [
      {
        "id": "import-actions",
        "slot": "book.import.actions",
        "schema": {
          "type": "object",
          "properties": { "label": { "type": "string", "default": "从 Markdown 创建" } }
        }
      }
    ]
  },

  "events": [],
  "provides": [
    { "capability": "books.convert", "version": "1", "entry": "backend.capabilities.ConvertProvider" }
  ],

  "publisher": { "name": "PoxenStudio", "key_id": "ed25519:example-key-id" },
  "compatibility": { "platforms": ["web", "android"], "host": ">=1.0.0 <2.0.0" }
}
```

## 8. 校验错误码

| 错误码 | 触发条件 |
| --- | --- |
| `MANIFEST_INVALID` | 缺必填、类型错误、格式非法（沿用现有） |
| `MANIFEST_VERSION_UNSUPPORTED` | `manifest_version` 非 1 |
| `MANIFEST_UNKNOWN_FIELD` | 严格模式出现未知顶层字段 |
| `MANIFEST_PERMISSION_UNKNOWN` | 声明了权限目录外的权限 |
| `MANIFEST_PERMISSION_SCOPE_REQUIRED` | 资源型权限缺 scope |
| `MANIFEST_ROUTE_DUPLICATE` | 路由重复 |
| `MANIFEST_UI_SLOT_UNKNOWN` | 严格模式出现未知 Slot |
| `MANIFEST_DEPENDENCY_CYCLE` | 依赖成环 |
| `CORE_API_TOO_NEW` | 依赖的 CoreAPI 高于宿主实现 |
| `RUNTIME_UNSUPPORTED` | `runtime.type` 不受支持 |

## 9. 与旧 Manifest 的字段映射

| 旧字段 | v1 字段 | 处理 |
| --- | --- | --- |
| `tool_id` | `tool_id` | 同义，保持 |
| `revision` | `revision` | 同义，保持 |
| `author`（字符串） | `author` / `author.name` | 归一化为 `{ name }` |
| `repo_url` | `repo_url` / `repository` | 保持旧值 |
| `entry_backend` | `runtime.entry` | 双向映射 |
| `entry_frontend` | `frontend.entry` | 双向映射 |
| `api_routes` | `routes` | 合并，`routes` 优先 |
| `page` | `ui.pages[].id`（legacy） | 旧字段保留但不再新增使用 |
| `locales` / `default_locale` | 同名 | 保持 |
| `core_api_version` | 同名 | 保持 |

迁移细则见 [MIGRATION.md](MIGRATION.md)。
