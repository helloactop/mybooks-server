# 插件平台进度（AI 接手）

> 2026-11-09 · 分支 `codex/plugin-platform`（基于 `main`，Phase 3g.1 提交见 `git log --oneline -5`）
> 最近提交：Phase 3g.1 安全补强（UID 注册表 / Popen 降权 / 严格配置校验）· `4f7f6718` Phase 3g 文档 · `238aad33` 子进程凭据隔离 · `a45c920d` 任务取消 + 崩溃管道回收
> 文档：[架构](mybooks-plugin-architecture.md) · [规范](mybooks-plugin-development-standards.md) · [隔离设计](isolation-design.md)

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
2026-11-09 Phase 3f 收尾：supervisor 状态读取/reload 异常/世代竞态/崩溃重试加固；Runtime Manager 接入 start/stop/invoke/health；CI 新增 Python 测试任务。
2026-11-09 剩余项处理：Runtime Manager `cancel` 接入插件 cancel 路由（禁止跨工具取消）；崩溃子进程重启前回收 stdout/stderr；补不可信插件安装门禁测试。
2026-11-09 真实插件验收 + 隔离增量：商店下载 zlibrary@0.1.0 / md_to_epub@1.1.0 并完成真实转换、下载、入库；supervisor 每子进程独立 runtime-secret、裁剪子进程环境、按插件注入身份令牌；Docker 镜像内 Python 测试通过。设计见 [isolation-design.md](isolation-design.md)。
2026-11-09 Phase 3g 内部认证 + 独立 UID：Node 内部接口接受每插件令牌（`MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY` 下只认令牌，共享 `internal-secret` 被拒），Python `NodeClient` 隔离模式不再读取宿主共享密钥；`TOOLBOX_CHILD_UID_BASE` 让每个插件以独立 UID 运行，插件数据目录 0711 / 产物 0755 / `config.json` 0600，`state/config.key` 由 supervisor 生成并注入。Docker 双容器内完成负向认证、越权、身份冒用、真实插件转换入库与进程重启验证。
未完成：Z-Library 外部网络（本机/容器 DNS 被 VPN fake-IP 命中 SSRF 防护）、UI 浏览器验收、`source.*` / `book.*` 能力、UI、SDK。
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
| Runtime Adapter | [legacy-runtime.js](../../src/core/plugins/adapters/legacy-runtime.js) + [runtime.js](../../src/core/toolbox/runtime.js) + [tasks.js](../../src/core/toolbox/tasks.js) | health/start/stop/invoke/reload/cancel 接到 Python 运行时；cancel 校验任务归属后转发插件 cancel 路由 | 6.1、13.4 | `a45c920d` |
| Runtime 状态 API | [legacy-runtime.js](../../src/core/plugins/adapters/legacy-runtime.js) + [routes.plugins.js](../../src/http/routes.plugins.js) | `GET /api/plugins/runtime` 只读健康状态 | 6.1、11.3 | `e610ef75` |
| Internal Identity | [identities.js](../../src/core/toolbox/identities.js) + [identity.py](../../toolbox-runtime/webserver/toolbox/identity.py) | 每工具令牌；import/export/tasks 校验归属；旧 Worker 兼容；Python 严格校验文件结构与缺令牌；隔离模式按 `MYBOOKS_PLUGIN_ID` 注入并使用本插件令牌 | 6.2 | `2aeb2467`、`238aad33` |
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
| Isolation Supervisor | [supervisor.py](../../toolbox-runtime/webserver/supervisor.py) + [runtime.py](../../toolbox-runtime/runtime.py) | 每插件子进程、懒启动、容量上限、空闲淘汰、崩溃重启、反向代理；`/internal/start`、`/internal/stop`；每子进程独立 runtime-secret、裁剪环境、按插件注入令牌 | 6.1、6.5 | `7f825df6`、`d9052f0e`、`238aad33` |
| CI / Sprite | [lucide-icons.json](../../scripts/lucide-icons.json) | 补齐 `arrow-left` 并同步 sprite/资源版本 | — | `8b4171bb` |

测试：`test/plugin-*.test.js`、`test/plugins-http.test.js`、`test/metadata-*.test.js`、
`test/toolbox-access-policy.test.js`、`test/toolbox-grants.test.js`。整套 `npm test` 769/769。

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
Phase 3b：Runtime Manager 与只读状态 ✅（health/start/stop/invoke/reload/cancel 已接；cancel 复用插件 cancel 路由）。
Phase 3c：内部 import/export/tasks 按工具令牌校验归属 ✅；无令牌旧 Worker 仍兼容。
Phase 3d：书库/元数据/文件/任务接口按 `grants.json` 裁剪 ✅；未配置工具保持兼容。
Phase 3e：Capability Router 统一权限/Provider/超时/输出校验 ✅；元数据服务已迁移。
Phase 3f（部分完成）：容器内每插件子进程（opt-in），故障/资源隔离 ✅；跨容器/恶意代码沙箱、宿主凭据隔离未做。

## 内部接口信任模型（本次新增）

两种执行模式在 `src/core/toolbox/access-policy.js` 中显式判定：

| 调用方 | 判定 | 权限行为 |
| --- | --- | --- |
| 旧 Worker，无身份头，`MYBOOKS_TOOLBOX_LEGACY_COMPAT` 默认 true 且未开启 `PLUGIN_AUTH_ONLY` | `legacy-compat` | 保留旧行为；**不受单插件 `grants.json` 约束**；启动日志明确提示“不是强隔离” |
| 身份令牌有效 + 工具已在 `grants.json` 配置 | `strict` | 按权限 + 资源 scope 校验，缺失 403 |
| 身份令牌有效 + 已安装旧插件但无策略 | `legacy-verified` | 兼容旧插件，但归属已校验；`PLUGIN_AUTH_ONLY=true` 时改为 403 `PLUGIN_GRANTS_REQUIRED` |
| 身份令牌有效 + 未知/未安装的新运行时 | `strict` | 默认拒绝 |
| 错误令牌 / 缺令牌 / 身份与 body `tool_id` 不一致 | `strict` | 403，**不回退**共享密钥 |
| 已安装但 `enabled=false` 的插件 | `strict` | 统一 `TOOL_DISABLED` 403，任何内部读写/任务都不再放行 |
| `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true` 的匿名请求 | — | 403 `PLUGIN_IDENTITY_REQUIRED`（共享密钥也不接受） |
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
- 独立 UID 模式（`TOOLBOX_CHILD_UID_BASE>0` + `TOOLBOX_RUNTIME_USER=0:0`）下，插件子进程
  UID 由持久化注册表 `state/uid-map.json` 分配（见 Phase 3g.1），读不到 0600 的
  `state/identities.json`、`state/internal-secret` 与 `state/config.key`；
  身份令牌与配置密钥由 supervisor 通过环境变量注入。
- 宿主 UID 不同（NAS bind mount）时，Python 读取身份文件失败会抛
  `PLUGIN_IDENTITY_UNAVAILABLE`，拒绝静默降级；只有 `FileNotFoundError` 才允许
  旧协议，`PermissionError` 等一律显式失败。需让两个容器使用同一 UID/GID，
  或改用受控凭据交付，不允许 `chmod 777`。
- 严格部署可设 `MYBOOKS_TOOLBOX_LEGACY_COMPAT=false` 与
  `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true`：无身份头的内部请求一律 403。
- Python 侧身份文件校验：只有确认文件不存在才按旧协议处理；文件存在但不可读、JSON 结构错误
  （`version` 非 1、`tokens` 非对象、条目非法）或**缺少该工具令牌**，一律抛
  `PLUGIN_IDENTITY_UNAVAILABLE`，不再发出无身份请求。
- `compose.yaml` 的 `read_only: true` 只保护容器根文件系统，**不会**把 `/toolbox` 命名卷变成只读；
  未启用独立 UID 时插件仍与旧 Worker 同 UID，可读写该卷中的身份/策略文件。

## 测试基线

```bash
npm test                                  # 770/770（2026-11-09，含 test/plugins-internal-auth.test.js）
npm run check:public                      # 通过
npm run check:icons                       # 通过（lucide-static 1.70.0，23 个图标）
cd toolbox-runtime
python -m unittest discover -s tests -v
                                          # Windows 本机：POSIX-only 用例跳过
docker run --rm -v "$PWD:/app:ro" --entrypoint python \
  mybooks-server-toolbox-runtime:latest \
  -m unittest discover -s tests -v        # 容器内 Python 3.12：62 通过 + 1 跳过（需 root）
```

CI：`.github/workflows/ci.yml` 的 `test` 与 `python` job 在 `ceb7f5dd` 上均
`completed/success`（GitHub API 查询，2026-11-09）。

## Phase 3f 隔离运行时

已实现（opt-in，`TOOLBOX_ISOLATE_PLUGINS=1`）：

- supervisor 在容器内为每个插件拉起独立子进程（`runtime.py` + `TOOLBOX_ONLY_TOOL`），
  supervisor 只做反向代理，不再于主进程加载插件代码；
- 懒启动；`TOOLBOX_MAX_CHILDREN`（默认 2）限制并发子进程；
  `TOOLBOX_CHILD_MEMORY_MB`（默认 384，POSIX `ulimit -v`）；
  `TOOLBOX_CHILD_IDLE_SECONDS`（默认 600）空闲淘汰，淘汰前探测 `/internal/busy`；
- `_read_state()` 对缺失/损坏/结构非法状态文件一律返回空 dict；`reload()` 捕获所有异常并
  返回报告，不再把 Node 的重载调用打挂；
- 世代号 + `_ensure_lock`：reload 期间启动的子进程会被丢弃并返回 503 让调用方重试；
  并发 `ensure_child` 只拉起一个进程；子进程崩溃后的请求自动重启并重试一次；
- `POST /internal/start/{tool}` 预热、`POST /internal/stop/{tool}` 停止；
  `POST /internal/reload` 全量重载；`/healthz` 返回 `isolated / children / deferred`，
  Node 侧 `/tool/{id}/...` 协议不变；
- 每子进程独立 `runtime-secret`（`secrets.token_hex(24)`）：supervisor 代理时重写
  `X-Mybooks-Runtime-Secret`，子进程密钥不能调用 `/internal/reload|start|stop`；
- 子进程环境移除 `MYBOOKS_TOOLBOX_INTERNAL_SECRET`；每插件令牌仅通过
  `MYBOOKS_PLUGIN_ID` + `MYBOOKS_PLUGIN_TOKEN` 注入自己的子进程，`identity.py` 校验 ID 匹配后优先使用；
- 任务取消：`RuntimeManager.cancel` → `core/toolbox/tasks.js` → 插件 manifest 的 `cancel`
  路由；校验任务归属、运行状态与工具启用，跨工具取消返回 404；
- 崩溃子进程在重启前关闭 `stdout/stderr` 管道，避免长期运行泄漏文件句柄。

明确边界：同一容器、同一 UID、共享 `/toolbox` 与网络 —— 这是**故障/资源隔离**，
不是恶意代码沙箱。本轮只收窄了环境变量暴露面；同 UID 下插件仍可直接读取
`state/identities.json`、`internal-secret`、`runtime-secret`。

仍未完成（Phase 3g 已补齐第 1 项，其余见下）：

1. ~~每插件内部凭据（Node 接受插件令牌、拒绝共享 internal-secret）与独立 UID/私有目录~~
   → 已在 Phase 3g 落地，见下一节。
2. 资源上限压测（`TOOLBOX_CHILD_MEMORY_MB`）与网络出口限制。
3. `MYBOOKS_TOOLBOX_LEGACY_COMPAT=false` 与 `TOOLBOX_ISOLATE_PLUGINS=1` 的强制联动；
   Compose 已暴露开关，但默认仍为 true。

对应规范 3.6、6.1–6.6；架构 7、13、17.4。

## Phase 3g 内部认证 + 独立 UID（已落地，默认仍兼容）

第一阶段：内部接口认证（Node）
- `routes.toolbox.internal.js` 的 `requireInternal` 改为“身份优先、密钥兜底”：
  请求带 `X-Mybooks-Plugin-Id` / `X-Mybooks-Plugin-Token` 时必须有效；无效/未知/停用插件
  直接 403，**不会**回退到共享密钥。
- 新增 `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY`（Node 与 Python 同名）：开启后只认每插件令牌，
  匿名或仅带共享 `internal-secret` 的请求返回 403 `PLUGIN_IDENTITY_REQUIRED`；
  插件未在 `grants.json` 显式配置时返回 403 `PLUGIN_GRANTS_REQUIRED`。
- `access-policy.js` 导出 `ENV_PLUGIN_AUTH_ONLY` / `pluginAuthOnlyEnabled()`，`modeNotice()` 明确提示隔离模式。
- `node_client.py`：隔离模式只发送插件令牌，**绝不读取** `internal-secret`；缺插件 ID/令牌或
  身份文件不可用时抛 `PLUGIN_IDENTITY_MISSING` / `PLUGIN_IDENTITY_UNAVAILABLE`，不降级。
- Legacy 兼容：`MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=false`（默认）时旧 Worker 无身份头仍可调用；
  身份头一旦出现即进入严格校验，错误令牌/未知/停用/无权限插件一律拒绝。

第二阶段：独立 UID 与私有目录（opt-in）
- `supervisor.py`：`TOOLBOX_CHILD_UID_BASE`（0=关闭）>0 时为每个插件分配稳定 UID；
  **Phase 3g.1 起改为持久化注册表 `state/uid-map.json`（不再用哈希取模），并通过
  `subprocess.Popen(user=/group=/extra_groups=/umask=)` 降权，不再使用 `preexec_fn`**。
  `TOOLBOX_RUNTIME_USER=0:0` 允许容器以 root 启动后降权。
- 数据目录：**Phase 3g.1 起为 `data/<tool_id>` 2710（setgid）、`work/<hash>` 2750、
  产物 0640、`config.json` 0600**，其他插件不可读；宿主 Node 通过共享属组（`TOOLBOX_HOST_GID`）
  读取产物完成入库。`state/config.key` 由 supervisor 首次生成（0600）并注入子进程。
- Compose：`cap_drop: ALL` 之外按需补 `SETUID`/`SETGID`/`CHOWN`/`FOWNER`/`FSETID`/
  `DAC_OVERRIDE`/`KILL`，仅在 root 启动时生效；[compose.yaml](../../compose.yaml) 已同步变量与注释。

Docker 双容器真实验收（`docker compose up -d --build`，2026-11-09）

| 场景 | 配置 | 结果 |
| --- | --- | --- |
| 共享密钥兼容 | 默认模式 | 仅 `X-Toolbox-Internal-Secret` → 200 |
| 错误令牌 | 默认模式 | 403 `PLUGIN_IDENTITY_INVALID` |
| 严格模式匿名 | `PLUGIN_AUTH_ONLY=true` | 共享密钥 → 403 `PLUGIN_IDENTITY_REQUIRED`；无头 → 403 |
| 严格模式无授权 | 同上 | 有效令牌但无 grants → 403 `PLUGIN_GRANTS_REQUIRED` |
| 严格模式授权 | 同上 | 令牌 + `books.read:library:all` → 200；收窄到 `book:1` 后列表 403、`books?ids=1` 200、`ids=2` 403 |
| 身份冒用 | 同上 | `zlibrary` 令牌 + `md_to_epub` 头 → 403；body `tool_id` 不一致 → 403 |
| 独立 UID | `TOOLBOX_CHILD_UID_BASE=2000` | zlibrary 子进程 uid 2077、md_to_epub uid 2015（Phase 3g 哈希分配；3g.1 改为注册表分配） |
| 私有目录/密钥 | 同上 | `data/<tool>` 0711、`work/*` 0755、`config.json` 0600、`state/config.key` 0600；插件配置写入返回 200（3g.1 收紧为 2710/2750/0640，见下节） |
| 真实插件（严格+隔离） | 同上 | md_to_epub 转换 + 入库成功（`book_id=1`），子进程经插件令牌调用 Node 内部接口 |
| 进程重启 | `docker compose restart toolbox-runtime` | 两插件按需重新拉起，`/healthz` 与原生路由恢复 200 |
| 回滚 Legacy | 默认环境 + `chown -R 1000:1000 /toolbox/data` | 插件列表、配置解密、共享密钥、转换入库全部恢复 |

本轮 Docker 验收中发现并修复的问题：
1. `preexec_fn` 降权需要 `SETUID`/`SETGID`；私有目录 chown 需要 `CHOWN`；
   supervisor 读 0600 凭据、写 `state/config.key` 需要 `DAC_OVERRIDE`；
   向不同 UID 子进程发信号需要 `KILL`。缺失时 `terminate()` EPERM，且旧实现会在
   `finally` 中关闭仍被采集线程读取的管道，导致整条 `_lock` 卡死、`/healthz` 超时。
   现已改为：发信号失败只记日志，子进程未退出时**不关闭管道**，`reload()` 在锁外回收子进程。
2. 独立 UID 下 `state/config.key` 无法由插件创建，且 `storage` 会自动生成随机密钥覆盖，
   导致配置无法解密。现由 supervisor 首启生成（0600、属主为 state 目录属主）并注入
   `MYBOOKS_TOOLBOX_DATA_KEY`，多个子进程复用同一密钥。
3. 产物目录 0700 会让宿主 Node（uid 1000）无法读取导入文件（“插件文件不存在”）。
   现为 0711/0755，`config.json` 保持 0600。

回滚独立 UID（不破坏数据）：
```bash
docker compose down
# 1) 把插件数据与配置密钥还给旧 Worker 的 UID（1000）
docker run --rm -u 0 -v mybooks-server_toolbox-data:/toolbox \
  sh -c 'chown -R 1000:1000 /toolbox/data /toolbox/state/config.key'
# 2) 去掉 TOOLBOX_CHILD_UID_BASE / TOOLBOX_RUNTIME_USER，恢复默认值
docker compose up -d
```
（注意：卷名以 `docker volume ls` 实际名称为准。）

已知边界（Phase 3g 状态；3g.1 已收紧为 2710/2750/0640，其他插件不可读 `work/` 产物）：
独立 UID 仍共用容器、网络与 `/toolbox` 卷；读不到对方的 `config.json`、`identities.json`、`internal-secret`。
这不是恶意代码沙箱，网络出口、syscall、CPU/内存仍需后续 Phase 的容器级隔离补齐。

## Phase 3g.1 安全补强（2026-11-09）

基线 `4f7f6718`，不修改 `main`，Toolbox API / Bridge / 安装包格式保持不变。

### 已修复问题

1. **UID 分配改为持久化注册表**：`state/uid-map.json`（`version=1`、`assignments`，0600）。
   - 同一 `tool_id` 一旦分配即固定，安装、重启、回滚都不会漂移；
   - 新插件取 `[base, base+TOOLBOX_CHILD_UID_COUNT)` 内**最小空闲 UID**，不再用
     `sha256(tool_id) % 200`，两个插件不可能共用 UID；
   - 升级前的哈希 UID 目录按目录属主**采纳**，重装/迁移不改属主；
   - 卸载后只有在该插件数据目录**已删除**时才回收 UID，否则保留，避免新插件接管旧数据；
   - 注册表损坏、分配重复、UID 池耗尽 → `IsolationError`，拒绝启动（fail-closed）。
2. **移除 `preexec_fn`**：改用 `subprocess.Popen(user=uid, group=uid, extra_groups=[], umask=0o027, start_new_session=True)`，
   多线程 supervisor 不再执行 fork 后的回调；非 POSIX 或 Python < 3.9 显式报错。
3. **隔离配置严格校验**：
   - 启用独立 UID 但 `euid != 0` → 明确提示“不会退回共享 UID”，supervisor 启动失败（`SystemExit(2)`）；
   - 缺少 `CAP_CHOWN/CAP_DAC_OVERRIDE/CAP_FOWNER/CAP_FSETID/CAP_KILL/CAP_SETGID/CAP_SETUID`
     时列出缺失项并拒绝启动；
   - Node 安装/状态写入 `state/runtime-mode.json`，Python 启动子进程前对比本端
     `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY`；不一致时 `/internal/start`、代理与 reload 返回
     503 `runtime.mode`，`/healthz` 同时返回 `plugin_auth_only` / `node_plugin_auth_only`。
4. **产物受控交付**（不改导入 API）：`data/<tool_id>` 2710（setgid）、子目录 2750、
   文件 0640、根级 `config.json` 0600；插件间**不可读**，宿主 Node 通过共享属组
   `TOOLBOX_HOST_GID`（默认 1000）读取产物完成入库。`storage.py` 在私有模式下不再 chmod
   根目录，避免插件进程（无 `CAP_FSETID`）清掉 setgid 位导致产物落入插件组。
5. Compose 增加 `TOOLBOX_CHILD_UID_COUNT`、`TOOLBOX_HOST_GID`，并将 capabilities
   固定为上述 7 项。

### 实际测试结果

- Node：`npm test` **770/770 通过**。
- Python：容器内 `python -m unittest discover -s tests` **62 用例通过，1 跳过**
  （需 root 的跨 UID 读取）；Windows 本机 10 项 POSIX-only 跳过。
- Docker 双容器（`mybooks-g1`，真实插件）：
  - `/healthz`：`plugin_auth_only=true`、`node_plugin_auth_only=true`、
    `missing_capabilities=[]`、`assignments={"md_to_epub":2000}`；
  - 子进程 `Uid 2000`；`Max open files 256`；`Max address space 402653184`（384MB，
    实际生效的 `RLIMIT_AS`，不是仅写入 `ulimit` 配置）；
  - `md_to_epub` 真实转换并入库：`{"err":"ok","imported":true,"book_id":1}`；
  - 跨插件读取：`OTHER_PLUGIN_DENIED`、`IDENTITIES_DENIED`、`SECRET_DENIED`；
    宿主属组读取产物 `HOST_GROUP_READ_OK`；
  - `docker compose restart toolbox-runtime` 后 UID 仍为 2000（注册表持久化）；
  - 人为制造 Node/Python 模式不一致 → reload 返回“部署配置不一致…”；恢复 Node 后正常；
  - 非 root 启动：`euid=1000 不是 root…不会退回共享 UID`；
  - 移除 `FOWNER`/`FSETID`：`缺少 capabilities：CAP_FOWNER, CAP_FSETID`；
  - 注册表序列：5000/5001/5002 唯一、重启稳定、池耗尽给出明确错误。

### 尚未解决的安全风险

1. **共享网络**：插件仍可访问任意内网/外网地址，无出口限制（需方案 D）。
2. **非容器级隔离**：不同 UID 只解决文件/凭据边界；同容器进程仍共享 PID/网络，
   CPU 与内存仅靠 supervisor 容量上限和 `RLIMIT_AS`，不等于 cgroup 配额。
3. **内存限制的边界**：`RLIMIT_AS` 已验证真实生效，但不覆盖线程栈、共享内存与
   cgroup OOM 行为；未做长时间压测。
4. **Legacy 模式**：默认部署仍与插件共享信任域；隔离结论只在推荐部署下成立。
5. **root 容器**：`TOOLBOX_RUNTIME_USER=0:0` 扩大攻击面，capabilities 已收窄至 7 项，
   仍需配合只读根文件系统与 `no-new-privileges`。
6. **依赖告警**：`npm audit --omit=dev` 的 `undici`/`yauzl` 告警本阶段未处理。

### Phase 4 准入结论

**具备 Phase 4 开发条件，但附条件**：

- 以 `TOOLBOX_ISOLATE_PLUGINS=1` + `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true`（Node/Python 一致）
  + `TOOLBOX_CHILD_UID_BASE>0`（root 启动）作为 Phase 4 的推荐部署基线；
- 独立 UID 分配、降权与产物权限已可复现验证，可作为 SDK/Manifest 的默认假设；
- **不可信第三方插件**的对外承诺仍需网络出口限制与容器级隔离，不计入本轮完成项；
- 未完成项：Z-Library 外网验收、UI 浏览器验收、资源压测。

## Phase 3 验收对照（本阶段收尾）

| # | 验收项 | 状态 | 证据 / 缺口 |
| --- | --- | --- | --- |
| 1 | Supervisor 可靠性 | ✅ | 状态文件缺失/损坏/结构非法统一返回 `{}`；`reload()` 捕获全部异常；崩溃自动重启；世代号防 reload/spawn 竞态；并发 ensure 复用同一子进程；Phase 3g 修复“终止失败仍关管道”导致的 supervisor 卡死；Python 62 用例（3g.1 含 UID/降权/权限） |
| 2 | Runtime Manager 集成 | ✅ | `health/start/stop/invoke/reload/cancel` 经单一 Toolbox 适配器接到 Python 运行时；cancel 复用插件 `cancel` 路由并校验任务归属；安装/启停仍只走 `/api/toolbox/*`，无第二套生命周期 |
| 3 | 安全隔离 | ◐ | 每插件令牌可作为内部接口唯一凭据（`PLUGIN_AUTH_ONLY`），错误令牌/未知/停用/无授权插件一律 403 不回退；独立 UID 模式下插件读不到 `internal-secret`/`identities.json`/其他插件 `config.json`。仍共享容器、网络与 `/toolbox` 卷，尚非恶意代码沙箱 |
| 4 | 真实插件测试 | ◐ | Docker 双容器内 zlibrary/md_to_epub 商店安装、严格认证、隔离子进程、md_to_epub 真实转换+入库（`book_id=1`）、运行时重启恢复均通过；Z-Library 外部搜索/下载仍被环境 DNS 阻断，UI 未做浏览器渲染 |
| 5 | 测试与 CI | ◐ | Node 770/770、容器内 Python 62 通过 + 1 跳过；`check:public`/`check:icons`/`docker compose config` 通过；`RLIMIT_AS` 已在 Docker 中验证生效，CPU/磁盘/网络出口限制未做 |

## 真实插件验收（离线可做 vs 未验证）

真实插件包（2026-11-09 从商店下载）：

| 插件 | 版本 | SHA-256 | allowlist |
| --- | --- | --- | --- |
| zlibrary | 0.1.0 | `de770be426bba247eca04ad8470f9deff9deee277e7ae659eed2e10c0cba3f7a` | 命中，可默认安装 |
| md_to_epub | 1.1.0 | `9b5dde1dc3c523605d36eb80a3b1a7dd4be3133ecb056f9a858dd538b5907483` | 命中（Phase 3g 加入精确 SHA-256 allowlist），可默认安装 |

### 已完成且经过验证（真实包）

- 商店/本地安装：zlibrary 默认安装成功；md_to_epub 在 Phase 3g 加入 allowlist 后默认安装成功
  （未加入前需显式 `ALLOW_UNREVIEWED=true`）；安装后 `manifest` 路由、前端 `index.html`、图标均存在。
- 启用/停用：`setEnabled` 后 DB 与 `state/installed.json` 的 `enabled` 同步。
- md_to_epub 真实后端：真实 `runtime.py` 加载商店包后，multipart 转换返回 200，
  下载得到合法 EPUB（ZIP magic + `application/epub+zip`），缺密钥 403、缺用户上下文 401。
- md_to_epub 真实入库：启动真实 Node 服务 + runtime，`import_to_library=1` 返回 `book_id`，
  文件落到 `books-files/**/*.epub`。
- Z-Library 真实后端：`config` / `progress` / `cancel` 路由返回 `err=ok`；`cancel` 对无运行任务
  返回 `task.not_running`，符合插件协议。
- supervisor 隔离模式：`healthz.isolated=true`；两个插件分别拉起子进程；代理转发、显式
  `stop`、停止后懒启动、supervisor 重启后重新加载均成功；无密钥请求被 401/403 拒绝。
- Docker 双容器（Phase 3g）：Node + Python 两容器中完成商店安装、`PLUGIN_AUTH_ONLY` 严格认证、
  独立 UID 子进程、私有目录权限、md_to_epub 真实转换 + 入库、`docker compose restart` 恢复；
  详细用例与结果见“Phase 3g”一节。
- 更新/回滚守卫：商店已是最新时 `NO_UPDATE`，无上一版本时 `NO_ROLLBACK`；卸载成功。
- 取消：无 `cancel` 路由的 md_to_epub 返回 404/409，zlibrary 有路由；跨工具任务取消被拒绝。
- 凭据收窄：子进程 `MYBOOKS_TOOLBOX_INTERNAL_SECRET` 为空；runtime-secret 与宿主不同；
  代理头被重写；仅注入本插件令牌；以上均有 Python 回归测试。

### 已实现但尚未真实环境验收

- 更新/回滚的实际版本切换：本轮只验证守卫与自动化夹具，未用两个真实版本包走完整回滚。
- 资源上限（`TOOLBOX_CHILD_MEMORY_MB`）压测与网络出口限制。

### 因环境限制未验证

- Z-Library 真实搜索/下载/健康检查：本机与容器内 DNS 均把 `zlib.ch` 解析为 `198.18.0.193`
  （RFC 2544 保留段，Clash/VPN fake-IP），被 SSRF 防护判定为 `dns.private`；这属于本地
  DNS/VPN 环境问题，**未关闭** SSRF 防护，也不能标记通过。
- UI：前端资源存在，但未做浏览器登录态下的渲染/交互验收。

### 仍需后续 Phase

- 跨容器/网络出口限制、每插件独立容器或受限 RPC（见 [isolation-design.md](isolation-design.md) 方案 D）。
- `source.*` / `book.*` 能力、通用 UI、SDK、Manifest 管理属于 Phase 4/5，不计入 Phase 3 缺陷。

手动补验步骤（需真实网络/浏览器）：

1. `docker compose up -d --build`，设置 `TOOLBOX_ISOLATE_PLUGINS=1`、
   `MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=false`、`MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true`；
   需要独立 UID 时再加 `TOOLBOX_RUNTIME_USER=0:0` 与 `TOOLBOX_CHILD_UID_BASE=2000`。
2. 商店安装 `zlibrary@0.1.0`，核对 SHA-256 命中 allowlist；打开工具箱 UI，搜索并下载 EPUB/TXT，
   确认任务进度、入库、书架可见与文件下载。
3. 安装 `md_to_epub@1.1.0`，在 UI 上传 Markdown + 图片，转换、下载、选择入库。
4. 停用/启用、更新/回滚、重启 `toolbox-runtime`：确认 `/api/plugins/runtime` 的
   `children/deferred` 与实际进程一致，运行中任务重启后标记失败而不是卡死。
5. 以插件子进程 UID（如 2077）尝试读取 `state/internal-secret` 与 `state/identities.json`，
   预期 Permission denied；若仍可读，说明没有启用独立 UID 或卷权限未生效。

## 残留安全风险

1. **Legacy 共享密钥**：`MYBOOKS_TOOLBOX_LEGACY_COMPAT` 默认开启；正式隔离部署应同时设置
   `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true` 并在 `grants.json` 中为每个插件显式授权。
   旧 Worker 与宿主同信任域的问题只在关闭 Legacy/开启隔离后消失。
2. **子进程非完整沙箱**：独立 UID 模式下插件读不到 `internal-secret`、`identities.json`、
   其他插件 `config.json` 与 `work/` 产物，但仍共享容器、网络与 `/toolbox` 卷；
   也可能影响同容器进程。仅提供故障/凭据/数据隔离。
3. **进程级凭据的适用范围**：每插件令牌在“每子进程”模型下等价于每进程凭据；Legacy 共享 Worker
   下仍是每工具令牌，无法阻止同进程插件冒用。`PLUGIN_AUTH_ONLY` 不改变 Legacy 模式的这一事实。
4. **取消能力受插件协议约束**：取消依赖插件 manifest 声明 `cancel` 路由；无该路由的插件
   返回 409 `CANCEL_UNSUPPORTED`。supervisor 只能停止整个子进程，不能中断单个请求。
5. **资源限制不完整**：`RLIMIT_AS` 已验证生效（384MB），但未覆盖 CPU、磁盘与 cgroup OOM，
   网络出口仍无限制。
6. **依赖告警**：`npm audit --omit=dev` 仍有 9 项（2 moderate / 5 high / 2 critical，`undici`、`yauzl`），
   本阶段未处理，需单独评估可利用性。

## 是否具备进入 Phase 4 的条件

**具备开发条件（附部署前提）。**

1. 安全隔离已达到“每插件凭据 + 独立 UID 注册表 + 私有目录 0640”，3g.1 的 UID 碰撞、
   降权与产物权限问题已修复并有回归测试；仍是共享网络/容器的进程级隔离，
   未达到“完全不可信插件可运行”的门槛（需网络出口限制与容器级隔离）。
2. Z-Library 外部搜索/下载与真实 UI 仍未验收（受本地 DNS/VPN fake-IP 与浏览器验收缺失影响）。
3. `MYBOOKS_TOOLBOX_LEGACY_COMPAT=false` 与隔离开关仍非默认联动；Phase 4 部署须显式使用
   推荐隔离配置，Node/Python 的 `PLUGIN_AUTH_ONLY` 不一致时已会拒绝启动子进程。

Phase 4（通用 UI / Manifest / SDK）可以在隔离模型稳定的前提下启动；不建议在未完成真实网络/UI
验收前把“不可信第三方插件”作为对外承诺。

## 硬约束

- 不改 `/api/toolbox/*`、`/get/tool/*`、Bridge、安装包与已有迁移；Python Worker 仅新增可选身份头。
- 旧 `/api/metadata/search` 的 `results` 形状、缓存与错误码保持；Provider 只返回候选，不写库。
- `server.js` 只允许加初始化/路由挂载，不改既有注册顺序。
- 内部接口保持 `internal-secret` + 每插件令牌双路径；无身份头旧 Worker 在
  `MYBOOKS_TOOLBOX_LEGACY_COMPAT`（默认 true）且未开启 `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY`
  时继续可用；开启隔离后只认插件令牌。
- 身份/权限失败必须 fail-closed：错误令牌、未知插件、停用插件、无授权插件不得回退 Legacy。
- 权限策略：`state/grants.json`；某工具一旦配置数组即严格模式，未配置保持旧行为。格式 `["books.read:library:*", "files.read:book:*", "jobs.create"]`。
- 策略损坏/不可读时用 `state/grants.last-good.json` 快照；无快照则全局拒绝，禁止扩权。
- 未知/未安装的新运行时没有策略时默认拒绝；不得为它提供无身份兼容回退。
- 共享 Python 进程与 supervisor 子进程都不是强隔离；独立 UID 只是凭据/数据边界，
  不得宣称已实现跨插件网络/syscall 隔离或恶意代码沙箱。
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
