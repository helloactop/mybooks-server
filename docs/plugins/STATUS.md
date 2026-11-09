# 插件平台进度（AI 接手）

> 2026-11-09 · 分支 `codex/plugin-registry`（基于 `main`）
> 文档：[架构](mybooks-plugin-architecture.md) · [规范](mybooks-plugin-development-standards.md)

## 现状

Phase 1 完成：内核（Registry / Context / Lifecycle / EventBus / Kernel）+ 只读 Legacy Adapter + `GET /api/plugins`。
Phase 2 完成：`metadata.search@1` 契约、豆瓣/OpenLibrary 双 Provider、服务编排；旧 `/api/metadata/search` 的 `results` 形状、缓存与错误码保持不变。
Phase 3a 完成：权限模型 + 运行时身份绑定（Context/Kernel 已接入，默认拒绝）。
未完成：Runtime Manager、内部 RPC 身份接入、隔离进程、`source.*` / `book.*` 能力、UI、SDK。
旧 Toolbox 路由/Bridge/安装器/Worker/迁移**零改动**。

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
| Legacy Adapter | [legacy-toolbox.js](../../src/core/plugins/adapters/legacy-toolbox.js) | 只读 `toolbox_tools` → 统一描述符；状态映射；脱敏 | 5.2、13.1 | `b459632a` |
| Plugins API | [routes.plugins.js](../../src/http/routes.plugins.js) | `GET /api/plugins`，会话后挂载，只读 | 9.1、13.1 | `b459632a` |
| Metadata 契约 | [metadata-search.js](../../src/core/plugins/capabilities/metadata-search.js) | 输入/输出校验、上限、稳定错误码、候选规范化 | 4.1–4.3 | `26fd251d` |
| Providers | [douban.js](../../src/core/plugins/providers/douban.js) · [openlibrary.js](../../src/core/plugins/providers/openlibrary.js) | 双来源统一候选，可显式切换 | 4.2、17.3 | `26fd251d` |
| Metadata 服务 | [services/metadata.js](../../src/core/plugins/services/metadata.js) + [plugin-services.js](../../src/http/plugin-services.js) | 注册/优先级选择/超时/错误映射；旧路由复用 | 3.6、4.1、4.4 | `26fd251d` |

测试：`test/plugin-*.test.js`、`test/plugins-http.test.js`、`test/metadata-*.test.js`，共 93 个。

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
│   │   │   ├── legacy-toolbox.js ✅
│   │   │   └── python.js ○  javascript.js ○  http.js ○  calibre.js ○  legado.js ○  Phase 3/6
│   │   ├── permissions.js ✅  identity.js ✅（本次新增）
│   │   ├── runtime-manager.js ○  capability-router.js ○             Phase 3b
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
- 规划文件按 Phase 增量创建，不得用空壳/TODO 占位。

## 验收对照（规范 13.2）

- ✅ 1、2、4、5、6、7、8、9、11
- ◐ 3：事件/服务可释放，`ctx.ui` 未实现
- ✅ 10：本文

Phase 2 门禁（规范 13 章 / 架构 17.3）：契约、内置 Provider、旧 API 兼容 ✅；真实豆瓣/OpenLibrary 联网未验收（测试用 fixture）。

Phase 3a：权限与身份绑定内核 ✅；内部 RPC 仍用共享 `internal-secret`，尚未按令牌校验，隔离未做。

## 测试基线

```bash
npm test                                  # 702/702
npm run check:public                      # 通过
cd toolbox-runtime
"C:/Users/11731/.venvs/mybooks-toolbox/Scripts/python.exe" -m unittest discover -s tests -v
                                          # 9/9（本机 Python 3.15；镜像 3.12 未跑）
```

## 下一步：Phase 3b 运行时与内部身份接入

1. Runtime Manager：统一 `prepare/start/invoke/health/cancel/stop`，先接 Legacy Python Worker；先提供只读运行时状态。
2. 内部接口身份：用 `IdentityRegistry` 令牌取代“信任请求体 `tool_id`”，需协议版本/兼容策略（规范 6.2）。
3. 隔离：独立进程/容器、网络出口与资源限制；共享 Worker 仅保留给已审查插件（规范 6.4）。
4. 测试：越权拒绝、插件失联撤能力、超时/取消、并发与资源上限。

对应规范 3.6、6.1–6.6；架构 7、13、17.4。

## 硬约束

- 不改 `/api/toolbox/*`、`/get/tool/*`、Bridge、安装器、Python Worker、已有迁移。
- 旧 `/api/metadata/search` 的 `results` 形状、缓存与错误码保持；Provider 只返回候选，不写库。
- `server.js` 只允许加初始化/路由挂载，不改既有注册顺序。
- 内部身份切换前保持 `internal-secret` 兼容；不做不兼容的 RPC 协议变更。
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

// 元数据服务（旧路由已接入）
const { service } = require('./src/http/plugin-services');
await service.search({ query: '三体' }, { providerId: 'openlibrary' });
```
