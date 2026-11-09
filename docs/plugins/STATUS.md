# 插件平台进度（AI 接手）

> 2026-11-09 · 分支 `codex/plugin-platform`（基于 `main`，代码 HEAD `7f825df6`）
> 最近提交：`cdd410e6` 身份文件校验 · `013300f0` 第三轮文档 · `7f825df6` 隔离子进程 · `fefba089` 隔离文档
> 文档：[架构](mybooks-plugin-architecture.md) · [规范](mybooks-plugin-development-standards.md)

## 现状

Phase 1 完成：内核（Registry / Context / Lifecycle / EventBus / Kernel）+ 只读 Legacy Adapter + `GET /api/plugins`。
Phase 2 完成：`metadata.search@1` 契约、豆瓣/OpenLibrary 双 Provider、服务编排；旧 `/api/metadata/search` 的 `results` 形状、缓存与错误码保持不变。
Phase 3a 完成：权限模型 + 运行时身份绑定（Context/Kernel 已接入，默认拒绝）。
Phase 3b 部分完成：Runtime Manager + Legacy 运行时只读状态 + `GET /api/plugins/runtime`。
Phase 3c 部分完成：内部接口按工具令牌校验归属（旧 Worker 不带令牌仍兼容）。
Phase 3d 部分完成：内部书库/导入/导出/任务按 `state/grants.json` 裁剪；未配置的工具保持兼容。
Phase 3e 完成：Capability Router（权限 → Provider → 超时 → 输出校验），元数据服务已迁移。
2026-11-09 审查修复完成：CI 图标校验、Legacy/Strict 访问模式、grants fail-closed、Context 私有封装、宿主组合根、ISBN 检索、Provider 兜底、AbortSignal 取消传播。
2026-11-09 第二轮修复：损坏策略前置阻断无身份 Legacy 路径、停用插件统一拒绝、错误类型授权不再 fail-open、Python 身份文件仅对 FileNotFoundError 降级。
2026-11-09 第三轮修复：Python 身份文件严格校验 `version`/`tokens` 结构，文件存在但缺令牌不再降级；Legacy 共享密钥路径与 Docker 共享卷的隔离缺口写为 Phase 3f 强制验收项。
2026-11-09 隔离运行时（opt-in）：容器内每插件子进程 supervisor（懒启动、容量上限、空闲淘汰、崩溃重启、反向代理）；`TOOLBOX_ISOLATE_PLUGINS=1` 启用。
未完成：跨容器/恶意代码沙箱、Runtime Manager 的真实 invoke/cancel、`source.*` / `book.*` 能力、UI、SDK。
旧 Toolbox 路由/Bridge/安装包/迁移保持兼容；仅新增可选身份令牌与策略文件。

## 已完成

| 模块 | 文件 | 关键行为 | 规范 | 提交 |
| --- | --- | --- | --- | --- |
| Registry | [registry.js](../../src/core/plugins/registry.js) | 注册/查询/显式选择/稳定排序/disposer 幂等/停用即失效 | 3.1、13.1 | `3ee452c2` |
| Context | [context.js](../../src/core/plugins/context.js) | 身份绑定、禁止冒用实例、逆序清理、dispose 后拒绝注册 | 3.2 | `f061edf8` |
| Lifecycle | [lifecycle.js](../../src/core/plugins/lifecycle.js) | 并发 start 去重、失败回滚、stop 顺序、`fail()` 撤能力 | 3.3、5.5 | `f061edf8` |
| EventBus | [events.js](../../src/core/plugins/events.js) | `emit`/`emitAwait`、异常隔离、traceId、超时、订阅上限 | 3.5、5.7 | `b39d1507` |
| Kernel | [kernel.js](../../src/core/plugins/kernel.js) | 组合 Registry/EventBus/GrantStore、define/start/stop/remove/dispose | 13.1、架构 5.1 | `b39d1507` |
| Permissions | [permissions.js](../../src/core/plugins/permissions.js) | 权限目录、scope、默认拒绝、授予/撤销 | 6.3、6.7 | `7994523e` |
| Identity | [identity.js](../../src/core/plugins/identity.js) | 不透明令牌 → 实例身份；不信任自报 ID | 6.2 | `7994523e` |
| Runtime Manager | [runtime-manager.js](../../src/core/plugins/runtime-manager.js) | 适配器注册/健康/超时；未实现操作显式 unsupported | 6.1、架构 7.1 | `e610ef75` |
| Runtime 状态 API | [legacy-runtime.js](../../src/core/plugins/adapters/legacy-runtime.js) + [routes.plugins.js](../../src/http/routes.plugins.js) | `GET /api/plugins/runtime` 只读健康状态 | 6.1、11.3 | `e610ef75` |
| Internal Identity | [identities.js](../../src/core/toolbox/identities.js) + [identity.py](../../toolbox-runtime/webserver/toolbox/identity.py) | 每工具令牌；import/export/tasks 校验归属；旧 Worker 兼容；Python 严格校验文件结构与缺令牌 | 6.2 | `2aeb2467` |
| Scoped Grants | [plugin-grants.js](../../src/core/toolbox/plugin-grants.js) + [routes.toolbox.internal.js](../../src/http/routes.toolbox.internal.js) | `grants.json` 配置即严格；books/files/metadata/jobs 按 scope 校验 | 6.3、13.3 | `10ec6016` |
| Legacy Adapter | [legacy-toolbox.js](../../src/core/plugins/adapters/legacy-toolbox.js) | 只读 `toolbox_tools` → 统一描述符；状态映射；脱敏 | 5.2、13.1 | `b459632a` |
| Plugins API | [routes.plugins.js](../../src/http/routes.plugins.js) | `GET /api/plugins`，会话后挂载，只读 | 9.1、13.1 | `b459632a` |
| Metadata 契约 | [metadata-search.js](../../src/core/plugins/capabilities/metadata-search.js) | 输入/输出校验、上限、稳定错误码、候选规范化 | 4.1–4.3 | `26fd251d` |
| Providers | [douban.js](../../src/core/plugins/providers/douban.js) · [openlibrary.js](../../src/core/plugins/providers/openlibrary.js) | 双来源统一候选，可显式切换 | 4.2、17.3 | `26fd251d` |
| Metadata 服务 | [services/metadata.js](../../src/core/plugins/services/metadata.js) + [plugin-services.js](../../src/http/plugin-services.js) | 注册/优先级选择/超时/错误映射；旧路由复用 | 3.6、4.1、4.4 | `26fd251d` |
| Capability Router | [capability-router.js](../../src/core/plugins/capability-router.js) | 权限门禁 → Provider 选择 → 超时/取消 → 输入/输出校验 | 3.6、4.1、13.3 | `9b70229b` |
| Access Policy | [access-policy.js](../../src/core/toolbox/access-policy.js) | 区分 Legacy 兼容 / Strict 插件；未知新插件默认拒绝；损坏策略前置阻断 | 4.2、6.2、6.4 | `d7121c1e`、`96e077e7` |
| Grants Fail-Closed | [plugin-grants.js](../../src/core/toolbox/plugin-grants.js) | `absent/ok/last-good/broken` 四态；损坏不扩权、重启仍安全；错误类型不退宽松 | 5.2、5.3 | `d7121c1e`、`96e077e7` |
| Scope Enforcement | [permissions.js](../../src/core/plugins/permissions.js) | `can()` 展示 vs `require()` 授权；资源型权限必须带 resource | 5.3 | `d7121c1e` |
| Context Encapsulation | [context.js](../../src/core/plugins/context.js) | WeakMap 私有状态；不暴露 Registry/EventBus/GrantStore | 6.2、6.3 | `938a2d71` |
| Host Composition | [plugin-services.js](../../src/http/plugin-services.js) | 单一 Kernel/Registry/RuntimeManager；内置 Provider 统一注册 | 7.1–7.4 | `f8c4e0ae` |
| Metadata Fallback | [services/metadata.js](../../src/core/plugins/services/metadata.js) | Provider 优先级 + 可配置兜底；显式来源不兜底 | 8.3、8.4 | `f8c4e0ae`、`57ed3576` |
| Cancellation | [capability-router.js](../../src/core/plugins/capability-router.js) | AbortSignal 传达到 Provider/fetch；超时与取消语义分离 | 9.2–9.4 | `2cc697a4` |
| Disabled Plugin Guard | [routes.toolbox.internal.js](../../src/http/routes.toolbox.internal.js) | 已安装但停用的插件统一 `TOOL_DISABLED` 403 | 11.3、13.3 | `96e077e7` |
| Isolation Supervisor | [supervisor.py](../../toolbox-runtime/webserver/supervisor.py) + [runtime.py](../../toolbox-runtime/runtime.py) | 每插件子进程、懒启动、容量上限、空闲淘汰、崩溃重启、反向代理 | 6.1、6.5 | `7f825df6` |
| CI / Sprite | [lucide-icons.json](../../scripts/lucide-icons.json) | 补齐 `arrow-left` 并同步 sprite/资源版本 | — | `8b4171bb` |

测试：`test/plugin-*.test.js`、`test/plugins-http.test.js`、`test/metadata-*.test.js`、
`test/toolbox-access-policy.test.js`、`test/toolbox-grants.test.js`。整套 `npm test` 762/762。

## 目标文件结构（架构 第十五章）

图例：✅ 已有 ｜ ○ 规划（按 Phase 增量创建，禁止先建空壳）

```text
src/
├── core/
│   ├── plugins/
│   │   ├── kernel.js ✅          registry.js ✅       context.js ✅
│   │   ├── lifecycle.js ✅       events.js ✅
│   │   ├── capabilities/metadata-search.js ✅（本次新增分层）
│   │   ├── providers/douban.js ✅  providers/openlibrary.js ✅（本次新增分层）
│   │   ├── services/
│   │   │   ├── metadata.js ✅
│   │   │   └── sources.js ○  books.js ○  reader.js ○  device.js ○   Phase 3+
│   │   ├── adapters/
│   │   │   ├── legacy-toolbox.js ✅  legacy-runtime.js ✅（只读健康）
│   │   │   └── python.js ○  javascript.js ○  http.js ○  calibre.js ○  legado.js ○  Phase 3/6
│   │   ├── permissions.js ✅  identity.js ✅（本次新增）
│   │   ├── runtime-manager.js ✅  capability-router.js ✅
│   │   ├── jobs.js ○  artifacts.js ○                                Phase 3+
│   │   ├── manifest.js ○  dependencies.js ○  manager.js ○           Phase 5
│   │   └── ui-registry.js ○                                         Phase 4
│   └── toolbox/ ✅（已有代码原位保留，不迁移）
├── db/
│   ├── plugins.js ○                                                 Phase 5（暂不建表）
│   └── toolbox.js ✅
└── http/
    ├── routes.plugins.js ✅
    ├── routes.plugins.ui.js ○                                       Phase 4
    ├── plugin-services.js ✅（本仓库组装点，不在架构树内）
    └── routes.toolbox*.js ✅（保留兼容）

plugin-runtimes/ ○                                                   Phase 3+
├── python/{runner.py, rpc.py, sdk/}
├── javascript/{runner.js, rpc.js, sdk/}
└── legacy/toolbox-runtime（引用现有实现）

plugin-sdk/ ○                                                        Phase 5
├── javascript/  python/  schemas/  examples/  test-kit/  docs/
```

说明：
- `capabilities/` + `providers/` 是本次实现的分层（契约与实现分离）；架构文档原树只列 `services/`，三者均在 `src/core/plugins/`。
- `core/toolbox/`、`db/toolbox.js`、`http/routes.toolbox*.js` 是兼容边界：不迁移、不改协议。
- `core/toolbox/identities.js` + `plugin-grants.js` + Python `toolbox/identity.py` 是内部身份/授权兼容层，不迁入 `plugins/`。
- 规划文件按 Phase 增量创建，不得用空壳/TODO 占位。

## 验收对照（规范 13.2）

- ✅ 1、2、4、5、6、7、8、9、11
- ◐ 3：事件/服务可释放，`ctx.ui` 未实现
- ✅ 10：本文

Phase 2 门禁（规范 13 章 / 架构 17.3）：契约、内置 Provider、旧 API 兼容 ✅；真实豆瓣/OpenLibrary 联网未验收（测试用 fixture）。

Phase 3a：权限与身份绑定内核 ✅。
Phase 3b：Runtime Manager 与只读状态 ✅（仅 health；Legacy 的 invoke/cancel 显式 unsupported）。
Phase 3c：内部 import/export/tasks 按工具令牌校验归属 ✅；无令牌旧 Worker 仍兼容。
Phase 3d：书库/元数据/文件/任务接口按 `grants.json` 裁剪 ✅；未配置工具保持兼容。
Phase 3e：Capability Router 统一权限/Provider/超时/输出校验 ✅；元数据服务已迁移。
Phase 3f（部分完成）：容器内每插件子进程（opt-in），故障/资源隔离 ✅；跨容器/恶意代码沙箱、宿主凭据隔离未做。

## 内部接口信任模型（本次新增）

两种执行模式在 `src/core/toolbox/access-policy.js` 中显式判定：

| 调用方 | 判定 | 权限行为 |
| --- | --- | --- |
| 旧 Worker，无身份头，`MYBOOKS_TOOLBOX_LEGACY_COMPAT` 默认 true | `legacy-compat` | 保留旧行为；**不受单插件 `grants.json` 约束**；启动日志明确提示“不是强隔离” |
| 身份令牌有效 + 工具已在 `grants.json` 配置 | `strict` | 按权限 + 资源 scope 校验，缺失 403 |
| 身份令牌有效 + 已安装旧插件但无策略 | `legacy-verified` | 兼容旧插件，但归属已校验 |
| 身份令牌有效 + 未知/未安装的新运行时 | `strict` | 默认拒绝 |
| 已安装但 `enabled=false` 的插件 | `strict` | 统一 `TOOL_DISABLED` 403，任何内部读写/任务都不再放行 |
| `grants.json` 损坏且无快照 | `strict` | 全局 fail-closed；无身份 Legacy 路径同样 403 `POLICY_BROKEN` |

`grants.json` 状态：`absent`（无策略文件）/ `ok` / `last-good`（文件损坏但沿用
`state/grants.last-good.json` 可信快照）/ `broken`（无任何可信策略，全部拒绝）。
删除 `grants.json` 但保留快照时不会回到宽松模式；恢复 Legacy 兼容需同时移除快照。
`broken` 在读取身份之前判定，因此关闭 `MYBOOKS_TOOLBOX_LEGACY_COMPAT` 与否都无法绕过。

**已知边界（Phase 3f 强制验收项）**：`grants.json` 正常时，无身份头的 Legacy 请求仍进入
`legacy-compat`，不受单插件授权约束。该路径要求持有 `internal-secret`，不是匿名外部入口；
但旧 Python Worker 内的插件代码与共享密钥处于同一信任域，因此：
- 仅允许**已审查的可信旧插件**使用该路径；
- **不可信插件不得运行在共享 Worker 中，也不得走 `legacy-compat`**；
- 新 Runtime 必须使用独立凭据（每进程/每容器）并默认拒绝，不能靠继续叠加权限判断掩盖共享执行环境问题。

授权值必须是数组：合法 JSON 里写成字符串/`null` 等错误类型时，该插件仍进入严格模式
（`configured=true`、空授权 → 全部 403），不会退回宽松兼容。

权限判定拆分为：`has()` 只用于展示性查询（可省略 resource）；`require()` 用于敏感操作，
`books.read/write/delete`、`files.read/write`、`metadata.write` 必须显式给出
`book:<id>` / `library:all` / `artifact:*` 等资源，省略即 403。

`PluginContext` 使用 WeakMap 保存 Registry/EventBus/GrantStore，实例被冻结，
公开面只有 `plugin / logger / permissions / register / on / track / dispose`。

## 元数据与取消

- `/api/metadata/search` 先用 `checkIsbn` 校验：合法 ISBN（含 ISBN-10/分隔符）传 `{ isbn }`，
  非法 ISBN 返回 400 `VALIDATION`，普通书名才传 `{ query }`。
- Provider 兜底模式：`MYBOOKS_METADATA_FALLBACK=off|no-results|recoverable`，默认 `no-results`；
  显式 `providerId` 永不兜底；`BLOCKED` 不兜底，旧错误码保持。
- 空结果不进入 10 分钟缓存；缓存 key 对 ISBN 使用归一化后的 ISBN-13。
- `CapabilityRouter.invoke({ signal })` 把 AbortSignal 传到 Provider 与 `fetch`；
  超时为 `UPSTREAM_TIMEOUT`（504），调用方取消为 `CAPABILITY_ABORTED`（499）。

## Docker / 非 Docker 身份文件权限

- 主镜像 `USER node`（uid/gid 1000），`toolbox-runtime` 镜像显式 `USER 1000:1000`，
  同一 `toolbox-data` 卷下 `state/identities.json`（0600）双方可读写。
- 宿主 UID 不同（NAS bind mount）时，Python 读取身份文件失败会抛
  `PLUGIN_IDENTITY_UNAVAILABLE`，拒绝静默降级；只有 `FileNotFoundError` 才允许
  旧协议，`PermissionError` 等一律显式失败。需让两个容器使用同一 UID/GID，
  或改用受控凭据交付，不允许 `chmod 777`。
- 严格部署可设 `MYBOOKS_TOOLBOX_LEGACY_COMPAT=false`：无身份头的内部请求一律 403。
- Python 侧身份文件校验：只有确认文件不存在才按旧协议处理；文件存在但不可读、JSON 结构错误
  （`version` 非 1、`tokens` 非对象、条目非法）或**缺少该工具令牌**，一律抛
  `PLUGIN_IDENTITY_UNAVAILABLE`，不再发出无身份请求。
- `compose.yaml` 的 `read_only: true` 只保护容器根文件系统，**不会**把 `/toolbox` 命名卷变成只读；
  Node 与 Python Worker 同为 UID/GID 1000，旧 Worker 内的插件代码仍可读写该卷中的身份/策略文件。
  因此当前部署**不能**视为跨插件隔离；隔离需分离宿主凭据与插件数据目录，并改用独立进程/容器 + 受限 RPC。

## 测试基线

```bash
npm test                                  # 762/762（2026-11-09）
npm run check:public                      # 通过
npm run check:icons                       # 通过（lucide-static 1.70.0，23 个图标）
cd toolbox-runtime
"C:/Users/11731/.venvs/mybooks-toolbox/Scripts/python.exe" -m unittest discover -s tests -v
                                          # 20/20（含 supervisor / busy 探活；本机 Python 3.15，镜像 3.12 未跑）
```

`npm ci --ignore-scripts` 未在本机重复执行（依赖与 lockfile 未变）；CI 会执行。

## Phase 3f 隔离运行时

已实现（opt-in，`TOOLBOX_ISOLATE_PLUGINS=1`）：

- supervisor 在容器内为每个插件拉起独立子进程（`runtime.py` + `TOOLBOX_ONLY_TOOL`），
  supervisor 只做反向代理，不再于主进程加载插件代码；
- 懒启动；`TOOLBOX_MAX_CHILDREN`（默认 2）限制并发子进程；
  `TOOLBOX_CHILD_MEMORY_MB`（默认 384，POSIX `ulimit -v`）；
  `TOOLBOX_CHILD_IDLE_SECONDS`（默认 600）空闲淘汰，淘汰前探测 `/internal/busy`；
- 子进程崩溃只影响自身，下次请求自动重启；`POST /internal/reload` 全量重载；
- `/healthz` 额外返回 `isolated / children / deferred`，Node 侧 `/tool/{id}/...` 协议不变。

明确边界：同一容器、同一 UID、共享 `/toolbox` 与网络 —— 这是**故障/资源隔离**，
不是恶意代码沙箱。

仍未完成：

1. 跨容器隔离或独立 UID + 只读插件数据目录，把身份令牌升级为进程级凭据。
2. Runtime Manager 的 invoke/cancel/start/stop 接到该 supervisor（当前 Node 仍走兼容路由）。
3. 真实插件验收（Z-Library、Markdown 转 EPUB）与资源上限压测。
4. **强制验收**：不可信插件不得走 `legacy-compat` 无身份路径；越权、缺令牌、身份文件损坏
   均显式 403 且无降级路径；宿主凭据与插件数据目录分离。

对应规范 3.6、6.1–6.6；架构 7、13、17.4。

## 硬约束

- 不改 `/api/toolbox/*`、`/get/tool/*`、Bridge、安装包与已有迁移；Python Worker 仅新增可选身份头。
- 旧 `/api/metadata/search` 的 `results` 形状、缓存与错误码保持；Provider 只返回候选，不写库。
- `server.js` 只允许加初始化/路由挂载，不改既有注册顺序。
- 内部接口保持 `internal-secret` + 可选令牌双路径；无身份头旧 Worker 必须继续可用，
  但仅在 `MYBOOKS_TOOLBOX_LEGACY_COMPAT`（默认 true）显式开启时。
- 权限策略：`state/grants.json`；某工具一旦配置数组即严格模式，未配置保持旧行为。格式 `["books.read:library:*", "files.read:book:*", "jobs.create"]`。
- 策略损坏/不可读时用 `state/grants.last-good.json` 快照；无快照则全局拒绝，禁止扩权。
- 未知/未安装的新运行时没有策略时默认拒绝；不得为它提供无身份兼容回退。
- 共享 Python 进程仍不是强隔离；身份令牌与 grants 只做归属/授权校验，不得宣称已实现跨插件隔离。
- 新代码 CommonJS，不新增依赖。
- 不把未运行/未验证写成“已通过”。

## 接口速查

```js
const kernel = new PluginKernel();
kernel.define({ instanceId, providerId, activate, deactivate });
await kernel.start(instanceId);

// activate(ctx) 内：
ctx.register({ capability: 'metadata.search', version: '1', providerId, invoke });
ctx.on('book.imported', handler);

// 权限与身份
kernel.grants.grant('inst.alpha', 'metadata.read', 'book:*');
const identities = new IdentityRegistry();
identities.bind({ token, instanceId: 'inst.alpha', runtimeId: 'legacy-toolbox' });

// 通用能力调用（传 principal 时先校验权限；signal 会传到 Provider）
const router = new CapabilityRouter({ registry, grants });
const controller = new AbortController();
await router.invoke({ capability, version, input, contract, principal, signal: controller.signal });

// 元数据与运行时服务（旧路由已接入）
const { metadata, runtimes, kernel, start } = require('./src/http/plugin-services');
await start();                             // 激活内置 Provider（幂等）
await metadata.service.search({ query: '三体' }, { providerId: 'openlibrary' });
await metadata.service.search({ isbn: '9787020002207' }); // 默认按优先级 + 兜底
await runtimes.healthAll();               // GET /api/plugins/runtime
await kernel.stop('builtin.douban');      // 停用后能力立即不可调用
```
