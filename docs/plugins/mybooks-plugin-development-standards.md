# Mybooks 通用插件平台开发规范

> **文档名称**：Mybooks Universal Plugin Platform — Development Standards  
> **文档版本**：v1.0（工程实施规范）  
> **更新日期**：2026-11-09  
> **适用仓库**：[shyshineinn/mybooks-server](https://github.com/shyshineinn/mybooks-server)  
> **配套文档**：[Mybooks 通用插件平台总体架构设计与开发规划](./mybooks-plugin-architecture.md)  
> **使用对象**：项目维护者、贡献者、Codex / Claude Code 等 AI 开发代理

> **重要说明**：本规范是**后续插件平台工程开发的约束**，不是对当前代码已实现特性的陈述。涉及 `src/core/plugins/`、`mybooks.plugin/v1`、ArtifactStore、多 Runtime 等内容均是**待实现目标**；现有 Toolbox 兼容实现以仓库代码为准。

---

## 0. 文档约定与执行等级

### 0.1 规范用语

| 用语 | 含义 |
| --- | --- |
| **必须 MUST** | 任何实现都需满足；不满足不能合并 |
| **禁止 MUST NOT** | 明确禁止；例外需单独架构和安全审查 |
| **应该 SHOULD** | 默认执行；例外需在 PR 中写明理由 |
| **可以 MAY** | 自由选择，不得破坏其他强制条款 |
| **现有** | 仓库当前包含且已经在源代码中可核实的行为 |
| **目标** | 规划实现，开发完成前不能在 UI/API 中声明已支持 |

### 0.2 规范优先级

1. 适用的法律、许可证与安全要求。
2. 仓库当前有效的 `SECURITY.md`、`CONTRIBUTING.md` 与实际兼容契约。
3. 本开发规范的强制条款。
4. 配套架构文档及已批准的 ADR（Architecture Decision Record）。
5. 模块注释、局部设计和开发者习惯。

发生冲突时，**先核实实际代码和已发布协议**，不得仅凭规划文档覆盖已经运行的生产数据或客户端行为。

### 0.3 变更原则

- **先审查、后修改**：读源文件、调用链、测试和文档，禁止凭印象创建“看起来合理”的替代文件。
- **小批次、可回退**：每个 PR 只解决清楚界定的目标，避免一次性重写插件商店、数据库和 UI。
- **兼容优先**：旧 Toolbox、书库、Android 同步不因插件内核升级而回归。
- **边界明确**：可信宿主与不可信插件之间必须有可执行的权限检查。
- **先测试、后宣称**：不将静态兼容、模拟成功或构建通过描述为真实联网业务成功。
- **不以插件数量衡量架构**：Provider 可替换、能力契约稳定、可控运行才是主要验收标准。

---

# 第一章：项目技术基线与修改边界

## 1.1 已核实技术基线

| 内容 | 现有实现或要求 |
| --- | --- |
| 主后端 | Node.js + Express、CommonJS |
| 推荐本地 Node | 仓库 `CONTRIBUTING.md` 使用 Node.js 24 |
| `package.json` 引擎 | `node >=22.5.0`（以仓库最新版本为准） |
| 数据库 | SQLite |
| Web | 原生 HTML/CSS/JavaScript |
| Toolbox 兼容 | Node 控制面 + Python 3.12/Tornado Worker |
| 安装 | ZIP/7z、摘要校验、暂存、回滚 |
| 插件 UI | sandbox iframe + Bridge |
| 移动端 | Android 独立项目；本仓库不应擅自修改客户端协议 |

**必须：** 以主仓库真实 `package.json`、`compose.yaml`、`CONTRIBUTING.md` 为依赖和命令的权威来源。新技术栈需要说明必要性、部署成本与回退方案。

## 1.2 代码职责分层

| 目录 | 正确职责 | 禁止的典型做法 |
| --- | --- | --- |
| `src/core/` | 业务规则、可复用服务、插件内核 | 随意读取 Express `req` / `res`，硬编码页面 DOM |
| `src/db/` | 数据访问、事务、查询和迁移 | 执行不受控外部网络请求 |
| `src/http/` | 认证后路由、参数校验、DTO、状态码 | 在路由内堆积插件加载、数据库事务和文件处理算法 |
| `toolbox-runtime/` | 旧 Python 插件兼容执行与 RPC | 直接挂载 Mybooks 主数据库或获取主站 Token |
| `public/` | Web 视图、样式、组件和 Bridge | 在浏览器中存放服务端密钥 |
| `test/` | 单元/集成/回归与安全测试 | 对真实 `data/` 目录写测试数据 |
| `docs/` | 协议、架构、安全、部署和迁移说明 | 将尚未实现功能标记为已上线 |

## 1.3 扩展目录设计原则

目标新增 `src/core/plugins/`，而 `src/core/toolbox/` 必须保留为 Legacy 模块。第一阶段**不迁移**已存在的安装器、CoreAPI 或 Worker 实现；仅经 Adapter 暴露统一视图。

建议逐步新增：

```text
src/core/plugins/
  kernel.js
  registry.js
  context.js
  lifecycle.js
  events.js
  permissions.js
  capability-router.js
  runtime-manager.js
  adapters/legacy-toolbox.js
```

后续 `manifest.js`、`jobs.js`、`artifacts.js`、`ui-registry.js`、`adapters/python.js` 等按阶段实现，禁止一次性创建大量空模块冒充完整平台。

## 1.4 不允许修改的稳定边界（除非另有批准）

- 现有图书主数据结构、字段语义和正常 CRUD 结果。
- 原 Android 图书/阅读同步接口和冲突保护语义。
- 当前 `/api/toolbox/*` 管理 API 与 `/get/tool/:id/*` 资源约定。
- `MyBooksToolBridge` 原有方法及旧插件可观察行为。
- 旧 `manifest.json` 约定与 `BaseTool` / `BaseHandler` 兼容方式。
- 已发布数据库迁移脚本及已有数据。
- 目前已采用的登录、设备会话、资源私有性和默认安全策略。

对其中任一边界提出变更时，必须写兼容影响、迁移方式、回滚步骤和回归测试。

---

# 第二章：代码风格与模块设计

## 2.1 JavaScript / Node.js

- 与现有工程一致使用 CommonJS `require()` / `module.exports`，除非建立单独 ADR 决定迁移。
- 优先 `const`，需要重新赋值时用 `let`，禁止新增无意的全局变量。
- 使用小而清楚的模块导出；业务依赖通过参数或工厂注入，减少循环引用。
- 异步 I/O 使用 `async/await`，始终处理超时、取消和错误路径。
- 不吞掉异常；对预期错误使用稳定 `code` 与 HTTP 状态，内部错误只在服务端记录必要脱敏信息。
- 不在模块顶层自动启动 Worker、访问生产数据或执行网络操作。
- 读取环境变量时进行校验并提供安全默认值；布尔配置显式比较 `'true'`。
- 文件操作使用已有路径边界和摘要工具，禁止拼接未经验证的路径直接访问。
- 不因“未来可能需要”引入庞大的第三方框架或运行时依赖。

## 2.2 Python Runtime

- Python Toolbox 兼容代码优先保持上游方法和返回值语义。
- 新的 Python SDK 与旧 `webserver/toolbox` 兼容层逻辑分离。
- 业务任务要暴露错误码、任务 ID、取消行为和超时，而不是无限阻塞请求线程。
- 不允许通过 `sys.path` 或全局包安装影响其他插件的依赖解析。
- 对插件 `import` / 初始化 / stop / dispose 都要捕获异常并记录归属。
- 不能通过捕获异常后返回 `{}`、`None` 等方式伪装未实现能力已经成功。

## 2.3 函数与类职责

- **Registry** 只管理注册、查询和注销，不承担 RPC 执行与权限裁决。
- **Router** 管理输入、Provider 选择、权限和调用编排。
- **Runtime Adapter** 只负责执行边界与传输，不决定书库权限。
- **Provider** 负责实现一个声明的能力。
- **Host Service** 负责事务、鉴权、文件归属等可信操作。
- **Adapter** 负责旧/外部协议到标准能力的明确转换。

不得建立一个同时负责安装、SQLite、RPC、UI、权限和任务的大型 `PluginManager` 类。

## 2.4 命名规范

- CommonJS 文件名优先 `kebab-case.js`，延续仓库已有命名的文件除外。
- 类：`PascalCase`，函数和变量：`camelCase`，常量：`UPPER_SNAKE_CASE`。
- JSON 字段按对应契约定义，不强行改变已发布 API 的 `snake_case`。
- Capability 标识：`domain.operation`，例如 `metadata.search`。
- Capability 版本单独命名为 `metadata.search@1`，不要嵌进插件自身版本。
- 事件使用领域动词过去式，例如 `book.imported`、`job.completed`。
- 插件 ID 应全局稳定且不与同名用户配置实例混淆；旧 Toolbox ID 仍允许原有正则。

## 2.5 注释与文档

- 优先说明**约束、设计理由、风险边界**，不复述代码的字面行为。
- 公共接口记录参数、返回、错误码、权限、幂等性与版本。
- `TODO` 要描述阻塞条件或 issue，不写不可验证的“完全支持”。
- 复杂跨模块设计先补 ADR 或设计节，再进行实现。

---

# 第三章：Plugin Kernel 核心编码契约

## 3.1 Registry 契约

`ServiceRegistry` 必须支持：

1. 注册 `capability + version + providerId + pluginInstanceId`。
2. 查询可用 Provider、按显式 ID 精确定位、稳定的选择排序。
3. 重复 ID 和协议不兼容时显式报错。
4. 注册返回 disposer；重复 dispose 幂等。
5. 生命周期停用后立即不可再接受新调用。
6. 仅导出不含密钥与绝对路径的安全元信息。

**禁止：** `registry.resolve()` 在不经授权、Runtime 和参数 Schema 验证的情况下直接执行不可信 Provider。内核的动态注册与可执行权限是两回事。

### 推荐接口（目标设计示意）

```js
const dispose = registry.register({
  instanceId: 'builtin.douban',
  providerId: 'douban',
  capability: 'metadata.search',
  version: '1',
  priority: 100,
  invoke: async (input, context) => searchDouban(input, context),
});

// 卸载时幂等撤销
dispose();
```

这是建议接口，并非现有仓库已经提供的 SDK；具体实现仍须考虑 `invoke` 的运行时信任边界。

## 3.2 Context 契约

- 每个实例获得独立的 `PluginContext`，包含只读身份与声明的受限接口。
- `ctx.register()` / `ctx.on()` / `ctx.ui.register()` 必须可返回释放函数。
- Context 内部保存所有 disposer；`dispose()` 逆序清理。
- 插件不得持有其他插件的可变 Context 对象。
- 受限 Host API 通过身份绑定的代理访问，不能把管理员 Token 原样交给插件。
- Context 被 dispose 后任何新的业务注册或敏感调用必须被拒绝。

## 3.3 Lifecycle 契约

状态至少区分 `discovered / validated / installed / disabled / starting / active / stopping / error`。

- `start()` 和 `stop()` 幂等；重复并发启动不得双注册。
- 初始化阶段注册的副作用先暂存，确认启动成功后再对 Consumer 可见，或有明确的原子撤销机制。
- 启动失败必须释放已注册资源、取消启动阶段任务，并记录 `last_error`。
- 停用先**阻止新调用**，然后取消或等待正在执行的任务，最后注销资源。
- 同一实例不能同时处于多个互斥生命周期状态。
- 失联或健康失败要撤销可执行能力，避免 Registry 指向死 Worker。
- 升级和回滚不能造成新旧两个版本同时持有同一个排他服务。

## 3.4 Dependency Resolver 契约

- required 与 optional 依赖明确分开。
- 对依赖声明进行版本范围校验；检测循环依赖。
- 依赖启动顺序由拓扑排序决定；依赖失败时 Consumer 进入可解释的阻塞/错误状态。
- 停用一个被依赖的插件前，列出受影响实例并应用可预测策略。
- 禁止插件自行修改宿主全局 Python/Node 依赖。

## 3.5 Event Bus 契约

- 每个事件定义 Schema、触发条件、是否可靠投递以及订阅权限。
- 区分普通 `emit` 与需要 await 的处理，不允许无限制同步串行执行全部监听器。
- 错误属于单独的订阅插件，不能掩盖原始书库操作结果。
- 事件监听注册必须有 disposer，停用后不得继续接收新事件。
- 对需要可靠交付的事件保存 `eventId`、`traceId`、重试次数；消费端实现幂等。
- 数据库提交后再公布 `book.imported` 等可靠事件；不能在事务中途提前对外通知。

## 3.6 Provider 选择规范

支持显式 Provider、用户默认 Provider、优先级、健康度与回退策略。**禁止对有副作用的能力执行不受控的自动重试**。多来源聚合结果需保留来源、置信度（如有）及原始候选 ID。

---

# 第四章：Capability API 与协议治理

## 4.1 每项 Capability 必须有契约

创建一个能力前先定义：

| 项目 | 要求 |
| --- | --- |
| 标识 | `domain.operation@major`，全局唯一 |
| 语义 | 明确读/写行为及副作用 |
| Input | JSON Schema、字段上限与默认值 |
| Output | JSON Schema、缺省字段和来源信息 |
| Error | 稳定错误码，区分用户错误与系统错误 |
| Permission | 需要的资源级授权 |
| Timeout | 默认 deadline 与取消机制 |
| Idempotency | 是否可安全重试，如何去重 |
| Streaming | 大内容/二进制走流或 Artifact，不塞进普通 JSON |
| Version | 兼容策略及弃用窗口 |
| Tests | Provider conformance tests |

## 4.2 首批 Capability

| 能力 | 用途 | 初期建议 |
| --- | --- | --- |
| `metadata.search@1` | 搜索元数据 | Phase 2 接入现有豆瓣服务 |
| `source.search@1` | 搜索图书来源 | 后续支持 Toolbox/Legado |
| `source.acquire@1` | 获取文件 | 必须先具备 Job / Artifact 协议 |
| `book.transform@1` | 电子书转换和修复 | 输入输出使用受控 Artifact |
| `book.import@1` | 正式入库 | 可信宿主服务，不直接交给普通插件 |
| `reader.sync@1` | 扩展阅读同步 | 不破坏旧 Android 同步协议 |
| `device.send@1` | 阅读设备推送 | 设备级凭据与权限 |
| `ui.contribute@1` | UI 声明 | 必须校验受支持 Slot |

## 4.3 元数据契约建议

```json
{
  "query": "example",
  "isbn": "9787020002207",
  "limit": 20,
  "locale": "zh-CN"
}
```

```json
{
  "candidates": [
    {
      "title": "示例书名",
      "authors": ["示例作者"],
      "isbn": "9787020002207",
      "source": "douban",
      "sourceId": "example-123"
    }
  ]
}
```

- 输入和输出均由 Schema 校验，设置字段数量、字符串长度和候选数量上限。
- 插件不得直接调用 SQL 修改书籍，仅返回候选，由宿主/用户决定是否写入。
- 多来源聚合时不能默默覆盖可信字段；保留来源与冲突信息。

## 4.4 版本与弃用策略

- 插件包版本、Manifest 版本、RPC 版本、Capability 版本分开管理。
- 同一 major 下的兼容变动应允许旧 Consumer 正常解析，新增字段优先可选。
- 删除或重命名公开字段、修改错误语义、改变读写副作用必须升级 major 或维护兼容适配。
- 旧协议弃用应记录发布时间、兼容期限、迁移指南及测试。
- 禁止仅为了代码整洁直接改变 Toolbox 的 `err/msg` 等兼容返回形态。

## 4.5 错误码设计

建议统一稳定层级，例如 `PLUGIN_NOT_ACTIVE`、`CAPABILITY_NOT_FOUND`、`CAPABILITY_VERSION_UNSUPPORTED`、`PERMISSION_DENIED`、`INVALID_INPUT`、`RUNTIME_UNAVAILABLE`、`RUNTIME_TIMEOUT`、`ARTIFACT_NOT_FOUND`、`DEPENDENCY_MISSING`。

错误响应区分可安全展示给用户的 `message` 与内部诊断详情；不得把堆栈、网络凭据、绝对路径或用户隐私直接返回插件 UI。

---

# 第五章：Legacy Toolbox 兼容规范

## 5.1 第一阶段强制保留内容

- `src/core/toolbox/manifest.js` 的旧 Manifest 解析、ID 与路由约定。
- `src/core/toolbox/installer.js` 的安全安装、更新、回滚、卸载。
- `src/core/toolbox/runtime.js` 的 Python Worker 代理。
- `toolbox-runtime/webserver/toolbox/plugin_host.py` 的 `BaseTool` / Handler 加载。
- `src/http/routes.toolbox.js` 与现有 `/api/toolbox/*`。
- `src/http/routes.toolbox.ui.js` 的资源隔离。
- `public/static/toolbox-bridge.js` 及原 `fetch/notify/theme/locale` 语义。
- 当前 `toolbox_tools`、`toolbox_tasks` 数据与运行恢复机制。

## 5.2 Legacy Adapter 的职责

- 根据旧数据库记录返回统一 `PluginDescriptor`。
- 暴露旧 Worker 是否实际加载、`pending_restart` 和 `last_error`。
- 默认只提供 `legacy.toolbox` 能力；需要业务映射时显式定义和单独测试。
- 调用旧 API 时继续使用原 `proxyTool()`，不能绕过原会话和路由白名单。
- 旧插件停用时，Registry 中的统一视图必须同步失效。
- 不写回修改旧 Manifest 的字段，避免影响已安装包的更新校验。

## 5.3 兼容行为清单

| 行为 | 必须维持 |
| --- | --- |
| 安装包 | ZIP / 7z 与原 Manifest 字段 |
| 生命周期 | `pending_restart` 与 reload 报告语义 |
| API | 原路径、方法、JSON/text/binary 返回 |
| Bridge | `fetch()` 返回 JSON 或文本，**不是**原生 `Response` |
| 页面 | `sandbox` iframe、CSP、资源路径与旧主题接口 |
| 文件导入 | 现有去重、格式限制及书库写入规则 |
| 任务 | 状态记录、进度、失败、取消和结果书籍 ID |
| 回滚 | 安装更新失败不留下半成品目录 |

## 5.4 兼容插件矩阵

当前仓库文档记录的八个首批插件：`zlibrary`、`md_to_epub`、`book_dedup`、`tags_cleaner`、`mbti_tester`、`epub_translator`、`quality_check`、`audiobook_srt`。

应对每个插件维护独立的：静态兼容、安装、动态加载、UI、任务、文件、真实外部依赖测试状态。不得因为“加载成功”就标记完整功能可用。具体基线见 `docs/toolbox/TESTING.md` 与 `UPSTREAM_COMPATIBILITY.md`。

---

# 第六章：Runtime、RPC 与安全权限

## 6.1 Runtime Adapter

统一接口建议为：

```text
prepare(installation)
start(instance)
invoke(instance, capability, input, requestContext)
health(instance)
cancel(instance, operationId)
stop(instance)
dispose(instance)
```

每项操作必须定义超时、幂等、返回值及状态转换。对运行时是否已加载、是否只是进程健康，必须分别展示。

## 6.2 插件身份不能自报自信

- RPC 调用中的 `pluginId` **不能直接视为真实身份**。
- 身份必须由受信任的 Runtime 会话、独立凭据或已鉴权的连接绑定。
- Node 的内部权限检查必须以**服务端解析的实例身份**为依据，而不是由插件随意提交 `tool_id` 字段。
- 敏感内部路由对插件、资源、动作、范围逐项校验授权。
- 同一 Python 进程共享一个 `internal-secret` 的旧模式不能当作跨插件权限隔离。

## 6.3 插件权限分层

| 权限类别 | 示例 | 重要约束 |
| --- | --- | --- |
| 图书只读 | `books.read` | 不自动包含电子书正文 |
| 元数据写入 | `metadata.write` | 检查目标书、字段和版本冲突 |
| 图书删除 | `books.delete` | 高危，记录审计并遵循回收站策略 |
| 文件读取 | `files.read` | 仅授予指定 Artifact / 书籍范围 |
| 网络 | `network.public` | 还需目标域名与 SSRF 控制 |
| UI | `ui.contribute` | 只允许受支持 Slot 和动作 |
| 配置 | `settings.read` | 不包含解密全部宿主秘密 |
| 任务 | `jobs.create` | 限制并发、资源和作用域 |

## 6.4 执行隔离

- 当前共享 Python Worker 仅用于已审查 Legacy 插件；其风险必须在开发与 UI 中真实表述。
- 第三方新插件应在独立受限进程/容器中执行，拥有独立身份、可写目录和资源限制。
- 禁止挂载主数据库、主电子书目录、管理员凭据或 Docker Socket。
- 使用 `read_only` 文件系统、独立 tmpfs、最小 Linux capability、`no-new-privileges` 和 CPU/内存/PID 配额（以目标平台支持情况为准）。
- Node Worker Threads / `vm` 不构成任意恶意 JS 的强沙箱。
- 外网插件限制出口目标或通过受控代理，禁止将内部网络可达性无约束暴露给插件。

## 6.5 网络与 SSRF

- 下载商店包的原 HTTPS/允许主机、重定向、DNS/IP 和下载体积校验继续保留。
- 第三方插件直接联网和宿主代理联网必须分别定义网络策略。
- 私网/回环/链路本地/保留地址在无授权情况下默认拒绝。
- 网络策略应处理重定向和 DNS Rebinding，不能只验证请求初始 URL。

## 6.6 依赖与供应链

- 摘要校验不是代码安全审查，签名也不等于行为安全。
- 安装、更新之前评估权限、来源、依赖、兼容性和资源成本。
- 未审查插件默认不能运行；不得把 `MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED` 改为生产默认开启。
- 插件独立依赖环境优先采用锁定版本、可重现构建。
- 不允许插件安装脚本以宿主高权限任意执行。

## 6.7 凭据与审计

- 配置中的 Token、Cookie、密钥使用可信 Credential Store 和引用传递。
- 日志、错误、任务详情、前端 DTO 不输出秘密值。
- 高危操作至少记录插件实例、用户、操作、对象 ID、结果和时间。
- 权限撤销后，新请求必须立即拒绝；已执行中的敏感任务按明确策略取消/收尾。

---

# 第七章：任务、Artifact 与数据一致性

## 7.1 Job Manager

- 任务有稳定 ID、归属插件实例、能力、阶段、状态、耗时和结果。
- 状态转换有合法表，重复完成/取消不造成非法更新。
- 任务取消有实际的 `cancel` 信号或超时终止，不能只把 UI 状态改成 cancelled。
- 失败记录原因；仅当操作具备幂等语义时自动重试。
- 停用插件先阻止新任务、再取消或排空正在执行的任务。
- 保留原有 `toolbox_tasks` 语义，新增统一视图而不是盲目迁移数据。

## 7.2 Artifact Store

Artifact ID 与真实路径解耦，至少记录：`artifactId`、所属插件、所属任务、格式、大小、SHA-256、存储引用、创建时间、状态、有效期。

- 插件只可读/写被授予的工作目录，不能通过任意绝对路径入库。
- 后台任务交付文件时，先确认文件存在且大小/摘要稳定，再注册 Artifact。
- 正式入库/下载时再次校验 Artifact 身份、状态与归属。
- 大文件使用授权流式下载，不把整个二进制强制加载为 Buffer。
- 下载过期与清理必须考虑正在使用的引用；清理幂等。
- 旧插件 `file_path` 通过兼容层过渡，不直接废弃。

## 7.3 书库写入一致性

- 图书新建/关联/格式处理复用现有 Mybooks 业务规则，避免插件绕过校验。
- 数据库多表写入使用 SQLite 事务。
- 文件系统不是 SQLite 事务的一部分；必须设计暂存、原子重命名/复制、失败清理和恢复扫描。
- `book.imported` 可靠事件在事务提交后投递；业务重试防止重复入库。
- 文件哈希与同书同格式冲突必须有清晰处理策略，不可静默覆盖用户文件。

---

# 第八章：数据库与迁移规范

## 8.1 迁移只能追加

仓库当前迁移包含 `migrateV26` / `migrateV27` 的 Toolbox 表。新功能新增更高版本迁移；**禁止修改已经发布的旧迁移以期自动改变现有用户数据库**。

## 8.2 新表设计原则

- 优先存储真实需要的状态，不为未实现的功能创建空表。
- 插件 Definition、Installation、Instance 与 Run 的主键语义清晰。
- 不在 `plugin_capabilities` 中把内存动态注册状态误当永久事实；运行时注册可由已安装实例重建。
- JSON 字段有 schemaVersion；读旧数据时兼容缺失可选字段。
- 所有新字段定义默认值、索引、唯一性约束和异常恢复策略。

## 8.3 事务与备份

- 多表一致性更新放在一个事务内。
- 迁移测试覆盖全新数据库与带旧 `toolbox_*` 数据的数据库。
- 真实用户升级前提示备份 `books.db`、书库文件和 `toolbox-data`。
- 回滚数据库结构不可保证时，必须文档说明使用备份恢复的操作。
- 不把安装包更新成功等同于配置/数据库迁移成功。

---

# 第九章：HTTP API、Web Bridge 与 Android 规范

## 9.1 API 鉴权

- 新 `/api/plugins/*` 应与现有管理 API 一样经过 `requireSession` 或明确的权限中间件。
- `server.js` 路由注册顺序必须保持有效：公开 API、内部受密钥保护路由、页面守卫、私有 API。
- 不要为了兼容插件让 `/api` 公开读写。
- 插件内部 RPC 与用户会话分离；内部密钥只用于传输鉴权，不能替代插件权限检查。

## 9.2 输入与输出

- 请求参数必须校验类型、范围、最大长度和有效路径。
- 对外 DTO 隐藏绝对安装路径、内部密钥、原始错误栈和敏感配置。
- 返回明确状态码，稳定 `code`，必要时兼容旧 `err/msg` 结构。
- 所有写接口说明幂等性、冲突处理与重试规则。
- 非可信远程内容进入 HTML 前进行安全编码；禁止未经处理的字符串拼接到可执行 DOM。

## 9.3 Bridge 向后兼容

当前 `MyBooksToolBridge` 的 `fetch()` 返回解析后的 JSON 或文本，而非原生 `Response` 对象。升级到 Bridge v2 时：

- 通过版本协商区分新旧协议，不能直接替换旧 `fetch` 语义。
- 保留 iframe `sandbox`（不包含 `allow-same-origin`），以及 CSP 不透明源约束。
- 消息来源校验至少包括真实 `iframe.contentWindow`、nonce、toolId 和动作白名单。
- UI 授权不能仅凭 `event.origin === 'null'` 或 `postMessage('*')`。
- 表单和文件经父页面重建并按路由白名单代理。
- 插件无法直接获取主站 Cookie、Bearer Token、数据库或 DOM。

## 9.4 UI Slots / Schema UI

- 预留明确 Slot（如 `book.detail.actions`、`settings.sections`），禁止第三方直接挂载任意主站元素。
- Slot 数据最小化，只给操作需要的书籍 ID、只读字段和授权上下文。
- Schema UI 统一校验字段、保存错误、Loading/Disabled 状态与国际化。
- 同一 Slot 多插件贡献稳定排序；插件停用时无残留 DOM 和事件处理器。
- 使用当前液态玻璃设计变量和 Lucide 图标，不强加新框架。
- 前端 HTML 资源 query 版本与 Service Worker 缓存版本需同步更新（遵守仓库 `CONTRIBUTING.md`）。

## 9.5 Android 客户端

- Android 只消费可用 Capability、任务和受支持 UI 描述，不执行服务端 Python / Node 代码。
- 增加面向 Android 的数据字段必须保持旧客户端兼容，未知组件类型应可降级或忽略。
- 改动阅读同步、删除恢复、冲突保护时，必须同时审核 `docs/SYNC_PROTOCOL.md`。
- Web 和 Android 对同一敏感操作应使用相同宿主授权，而不是客户端自行决定权限。

---

# 第十章：测试策略与覆盖标准

## 10.1 测试分层

| 层级 | 测试重点 | 期望 |
| --- | --- | --- |
| 单元 | Registry、Lifecycle、Schema、权限、依赖解析 | 快速、纯逻辑、可重复 |
| 集成 | Node ↔ Worker、DB、安装与回滚、文件入库 | 临时目录和测试 DB |
| 契约 | Provider 的 Input/Output、错误码、版本 | 各语言共用测试向量 |
| 安全 | 越权、路径穿越、SSRF、沙箱消息、资源滥用 | 拒绝默认，不泄密 |
| 兼容 | 原 Toolbox 八插件和 API/Bridge | 旧功能不回归 |
| 端到端 | 安装、启用、搜索、任务、文件交付、停用 | 明确环境和依赖 |
| 性能 | 并发、长任务、大文件、资源耗尽 | 不导致宿主不可用 |

## 10.2 必须覆盖的内核场景

- 同名注册冲突 / 不兼容版本拒绝。
- 多 Provider 选择顺序与显式选择。
- `register()` disposer、重复 `dispose()` 幂等。
- 并发启动、重复停止、停用后的调用拒绝。
- 初始化中途失败释放全部资源。
- EventBus 监听器异常不污染其他插件。
- 必需依赖缺失和循环依赖检测。
- Runtime 断连后能力摘除和任务错误归属。
- 未经授权访问书库或 Artifact 被拒绝。
- 旧 Toolbox `pending_restart` 与 Worker 加载状态映射正确。

## 10.3 测试环境要求

**必须使用隔离测试目录和测试数据库。** 仓库 `scripts/test.js` 会建立临时存储；按官方贡献指南执行整套 `npm test`。不得直接运行会加载默认数据库单例的单个测试文件，避免误访问用户实际 `data/`。

基线命令：

```bash
npm ci
npm test
npm run check:public

cd toolbox-runtime
python -m unittest discover -s tests -v
```

修改 Docker 时补充：

```bash
docker compose config
# 在可用的 Docker 环境中完成镜像构建和健康检查
```

无 Docker、无真实外部账号或网络不通时，必须明确报告**未验证**项；不得把 Mock 测试结果冒充真实平台成功。

## 10.4 回归矩阵

必须至少覆盖：

- `zlibrary`：原 UI、配置/进度、任务、文件入库和权限边界。
- `md_to_epub`：FormData、转换结果、二进制下载。
- `book_dedup`：扫描/合并/软删除行为。
- `tags_cleaner`：任务进度与元数据更新。
- `mbti_tester`：图书只读查询。
- `epub_translator`：格式导出与未配置 LLM 时的明确提示。
- `quality_check`：Docker 依赖与只读检查。
- `audiobook_srt`：可用性报告及缺少音频目录时的受限状态。

上述插件的真实联网等能力仍按 `docs/toolbox/TESTING.md` 具体记录，不扩大宣称。

## 10.5 通过条件

任何涉及内核或旧 Toolbox 的 PR，至少：

1. 全量 Node 测试通过。
2. 公开资源检查通过。
3. 相关 Python 测试通过。
4. 新增/修改能力有契约测试。
5. 兼容性影响明确，相关回归覆盖。
6. 安全敏感变更有拒绝路径与权限测试。
7. 无真实环境条件时明确列出未执行的验收项。

---

# 第十一章：开发流程、分支与提交规范

## 11.1 开始开发前（必做）

1. 确认需求边界、涉及仓库与目标阶段（Phase）。
2. 检查 `git status`、默认分支、当前提交与现有未提交变更。
3. 阅读相关源文件、调用方、现有测试和配套文档。
4. 列出影响的现有 API、数据库表、前端页面和 Worker。
5. 先写验收条件与回滚办法，明确不修改哪些模块。
6. 高风险变更先补 ADR；必要时拆分多个 PR。

## 11.2 每个 PR 的合理范围

建议按最小可验证切片提交。例如：

- PR 1：Registry + 单元测试。
- PR 2：PluginContext + Lifecycle + 故障测试。
- PR 3：LegacyToolboxAdapter + 原 API 兼容测试。
- PR 4：只读统一插件查询 API。
- PR 5：内置 Douban Provider + `metadata.search` 契约测试。

**禁止**在没有独立验收的前提下，把 UI 全面改版、数据库迁移、Python Loader 重写和商店升级塞进同一个 PR。

## 11.3 Git 提交与 PR 描述

Commit 主题应精确说明改动，例如：

```text
feat(plugins): add reversible service registry
feat(plugins): register legacy toolbox adapter
fix(toolbox): preserve binary download response
security(plugins): enforce instance-scoped permissions
test(plugins): cover lifecycle rollback
```

这是**推荐**格式，不强制替换项目维护者现有版本及提交制度。PR 至少包含：变更背景、具体行为变化、修改文件、兼容影响、安全影响、迁移步骤、测试命令与结果、无法验证项、回滚办法。UI 变更附脱敏截图。

## 11.4 代码审查重点

- 是否绕过书库原业务规则？
- 是否在插件上下文中暴露高权限对象？
- 停用/初始化失败时资源是否全部释放？
- 是否破坏旧 API、Bridge、Worker、同步？
- 是否新增不受限文件路径、网络出口或全局依赖？
- 是否对文件与数据库一致性做恢复设计？
- 错误是否可归属于具体插件且不泄漏敏感信息？
- 测试是否在独立环境运行、结果是否如实记录？

## 11.5 发布和升级

- 版本号由维护者决定，不随意递增应用或依赖版本。
- 对数据迁移、权限扩张、协议 breaking change 提前准备升级说明。
- 先备份再迁移；必要时使用灰度配置开关启用新 Registry 调用路径。
- 回滚恢复需要明确应用、数据库、插件目录和配置之间的对应关系。
- 新版 Kernel 不能依赖“升级成功后所有旧插件重新安装”。

---

# 第十二章：AI 编程代理专用执行规范

> 本章适用于 Codex、Claude Code 及其他自动化编程代理。目标是避免“看起来做完了，实际上没读源码、没测试、破坏兼容”的问题。

## 12.1 输入与核实

AI 代理开始实现前必须：

1. 使用**当前** `shyshineinn/mybooks-server` 仓库，而不是旧 `my-books` 仓库或同名第三方项目。
2. 阅读 `README.md`、`CONTRIBUTING.md`、相关 Toolbox 源码和测试。
3. 列出真实文件路径和关键调用链；不得编造尚不存在的模块。
4. 标记哪些是当前实现，哪些是本次新增，哪些是后续规划。
5. 不因此前讨论中出现 Vue / NestJS 等选项就假设已经采用这些技术。

## 12.2 实施约束

- 不在未获请求时重写整个项目或更改已确定的主技术栈。
- 不直接更改主数据库结构、Android 同步协议或旧 Toolbox Manifest，除非当前任务明确要求且通过评审。
- 新模块从最小可运行的核心开始，禁止空壳服务和“TODO 即完成”。
- 不擅自扩大权限、关闭安全校验、放开未审查插件运行。
- 不随意删测试、修改断言以使失败测试变绿。
- 遇到源码不足、工具不可用、外部网络失效，要明确报告事实和未完成项。
- 不使用真实个人数据库、Cookie、密钥、图书文件作为测试样本。
- 任何修改必须与现有代码风格和 API 约定一致。

## 12.3 推荐执行步骤

```text
A. Source Audit
   确定仓库/分支 → 阅读文件/调用链 → 收集测试基线

B. Change Plan
   目标与非目标 → 影响路径 → 兼容契约 → 安全与回滚

C. Small Implementation
   先内核/契约 → 再适配层 → 最后业务/UI 集成

D. Verify
   单元测试 → 集成/兼容 → 安全拒绝路径 → 文档检查

E. Delivery
   提交修改清单 → 测试结果 → 未验证项 → 后续工作
```

## 12.4 输出报告模板

```markdown
## 本次目标
...

## 源码核实
- 当前仓库/分支/提交：...
- 涉及文件与真实调用链：...

## 修改内容
- 新增：...
- 修改：...
- 保留：...

## 兼容与安全
- 原 API/数据/旧插件影响：...
- 权限与执行边界：...

## 验证
- 命令：...
- 通过：...
- 失败或未运行：...

## 风险与回滚
...
```

未经运行的命令不得写“已通过”；仅静态检查完成不得写“线上插件已可用”。

---

# 第十三章：各阶段交付门禁（Definition of Done）

| 阶段 | 必须交付 | 禁止跨越的门禁 |
| --- | --- | --- |
| Phase 0 基线 | 调用链/兼容矩阵/安全限制/测试基线 | 不核实仓库直接重构 |
| Phase 1 Kernel | Registry、Context、Lifecycle、EventBus、Legacy Adapter、测试 | 不用现有 Toolbox 直接切换主业务 |
| Phase 2 业务接入 | `metadata.search@1` 契约、内置 Provider、旧 API 兼容 | 未完成 Schema/权限即执行不可信代码 |
| Phase 3 Runtime | 可信身份、权限 Gateway、隔离执行、健康/取消测试 | 没有隔离就开放任意商店代码 |
| Phase 4 UI | Slots、Schema UI、Bridge v2、Web/Android 协商 | 破坏旧 Bridge 或直接注入宿主 DOM |
| Phase 5 SDK | Manifest v1、conformance tests、开发模板、版本规则 | 未实际运行就宣称通用兼容 |
| Phase 6 生态 | 外部 Adapter 与真实插件测试证据 | 把“加载成功”宣称功能全部可用 |
| Phase 7 深度插件化 | 至少一个可替换的内置能力、灰度与回滚 | 改动认证/数据库信任根造成越权 |

## 13.1 第一次实施的明确范围

**应首先实现：**

- `src/core/plugins/registry.js`
- `src/core/plugins/context.js`
- `src/core/plugins/lifecycle.js`
- `src/core/plugins/events.js`
- `src/core/plugins/kernel.js`
- `src/core/plugins/adapters/legacy-toolbox.js`
- `test/plugin-kernel.test.js`

`server.js` 仅增加最小初始化和必要的安全只读 API。旧 Toolbox 安装器、Python Worker、Web iframe、书库及 Android 同步都不应被第一轮重写。

## 13.2 第一阶段验收清单

- [ ] Registry 能注册、查询、注销和阻止冲突。
- [ ] 注册 disposer 幂等，停用后 Provider 立即不可执行。
- [ ] Context 能释放事件、服务和 UI 注册。
- [ ] 重复启停与启动失败回滚正确。
- [ ] Legacy Adapter 能读取旧插件、加载状态和错误。
- [ ] 旧 API、Bridge、旧插件包格式不变。
- [ ] 当前 Toolbox 核心测试无回归。
- [ ] `npm test` 和 `npm run check:public` 通过。
- [ ] Python 兼容测试通过或真实说明未执行原因。
- [ ] 文档更新了现状和未完成部分。
- [ ] 未打开未经审查插件的默认执行权限。

---

# 第十四章：安全、兼容与发布前总检查表

## 14.1 安全检查

- [ ] 无新泄漏的 Token/Cookie/数据库路径/绝对文件路径。
- [ ] 所有敏感接口都有可信身份及资源权限校验。
- [ ] 后端没有通过插件自报 ID 授权。
- [ ] 不可信插件没有主库/宿主目录直接访问能力。
- [ ] 网络访问符合 SSRF 和出口策略。
- [ ] UI 消息验证来源、nonce、插件 ID 和动作白名单。
- [ ] 压缩包、路径、符号链接及大小限制保留。
- [ ] 密钥和配置文件没有提交到 Git。

## 14.2 兼容检查

- [ ] 原有 Toolbox 的安装/更新/回滚/卸载行为保持。
- [ ] 原 Python import / Handler / CoreAPI 行为保持。
- [ ] 原 Bridge 的 JSON/text/FormData/下载语义保持。
- [ ] 原图书文件、回收站和阅读同步协议保持。
- [ ] 旧 SQLite 数据在升级后仍可读取。
- [ ] 旧 Web 静态资源和 Service Worker 缓存策略得到更新。

## 14.3 发布检查

- [ ] 执行测试并记录输出。
- [ ] 更新 README/协议/迁移/安全说明中受影响的章节。
- [ ] 备份和回滚方案可操作。
- [ ] 安装包和第三方依赖许可证得到核对。
- [ ] 变更报告中明确真实已支持、部分支持、未验证、计划支持。
- [ ] 完成仓库 `docs/OPEN_SOURCE.md` 要求的开源发布检查。

---

# 第十五章：参考资料与后续规范文件

## 15.1 仓库中的权威资料

- [`README.md`](https://github.com/shyshineinn/mybooks-server/blob/main/README.md)
- [`CONTRIBUTING.md`](https://github.com/shyshineinn/mybooks-server/blob/main/CONTRIBUTING.md)
- [`docs/toolbox/README.md`](https://github.com/shyshineinn/mybooks-server/blob/main/docs/toolbox/README.md)
- [`docs/toolbox/API.md`](https://github.com/shyshineinn/mybooks-server/blob/main/docs/toolbox/API.md)
- [`docs/toolbox/SECURITY.md`](https://github.com/shyshineinn/mybooks-server/blob/main/docs/toolbox/SECURITY.md)
- [`docs/toolbox/TESTING.md`](https://github.com/shyshineinn/mybooks-server/blob/main/docs/toolbox/TESTING.md)
- [`docs/toolbox/UPSTREAM_COMPATIBILITY.md`](https://github.com/shyshineinn/mybooks-server/blob/main/docs/toolbox/UPSTREAM_COMPATIBILITY.md)
- [`docs/SYNC_PROTOCOL.md`](https://github.com/shyshineinn/mybooks-server/blob/main/docs/SYNC_PROTOCOL.md)

## 15.2 后续适合独立的规范

- `PLUGIN_PROTOCOL.md`：Manifest 与 Capability Schema。
- `PLUGIN_LIFECYCLE.md`：状态机、热重载、依赖生命周期。
- `RUNTIME_PROTOCOL.md`：RPC、身份、调用、取消和流式传输。
- `UI_EXTENSION_SPEC.md`：Schema UI、Slots、Bridge 和 Android 协商。
- `SECURITY_MODEL.md`：威胁模型、授权和沙箱。
- `MIGRATION_PLAN.md`：迁移顺序、数据备份和回滚。
- `TEST_MATRIX.md`：插件兼容性与安全测试矩阵。
- `ADR/`：关键技术决策的历史记录。

---

## 最终工程准则

> **以现有源码为起点，以稳定业务契约为中心，以安全边界为底线，以可验证的小步提交推进。**
>
> Mybooks 的插件化不是把每一种工具都塞入一个 Loader；它是建设可以注册、发现、替换、审计和撤销业务能力的长期平台。任何扩展都不应以损坏用户现有书库、阅读数据或安全控制为代价。
