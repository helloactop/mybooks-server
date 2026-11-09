# 插件平台进度（AI 接手）

> 2026-11-09 · 分支 `codex/plugin-platform`（基于 `main`）
> 文档：[架构](mybooks-plugin-architecture.md) · [规范](mybooks-plugin-development-standards.md)

## 现状

Phase 1 完成：内核（Registry / Context / Lifecycle / EventBus / Kernel）+ 只读 Legacy Adapter + `GET /api/plugins`。
Phase 2 完成：`metadata.search@1` 契约、豆瓣/OpenLibrary 双 Provider、服务编排；旧 `/api/metadata/search` 的 `results` 形状、缓存与错误码保持不变。
Phase 3a 完成：权限模型 + 运行时身份绑定（Context/Kernel 已接入，默认拒绝）。
Phase 3b 部分完成：Runtime Manager + Legacy 运行时只读状态 + `GET /api/plugins/runtime`。
Phase 3c 部分完成：内部接口按工具令牌校验归属（旧 Worker 不带令牌仍兼容）。
未完成：书库接口的权限裁剪、隔离进程/容器、`source.*` / `book.*` 能力、UI、SDK。
旧 Toolbox 路由/Bridge/安装包/迁移保持兼容；仅新增可选身份令牌。

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
| Internal Identity | [identities.js](../../src/core/toolbox/identities.js) + [identity.py](../../toolbox-runtime/webserver/toolbox/identity.py) | 每工具令牌；import/export/tasks 校验归属；旧 Worker 兼容 | 6.2 | `2aeb2467` |
| Legacy Adapter | [legacy-toolbox.js](../../src/core/plugins/adapters/legacy-toolbox.js) | 只读 `toolbox_tools` → 统一描述符；状态映射；脱敏 | 5.2、13.1 | `b459632a` |
| Plugins API | [routes.plugins.js](../../src/http/routes.plugins.js) | `GET /api/plugins`，会话后挂载，只读 | 9.1、13.1 | `b459632a` |
| Metadata 契约 | [metadata-search.js](../../src/core/plugins/capabilities/metadata-search.js) | 输入/输出校验、上限、稳定错误码、候选规范化 | 4.1–4.3 | `26fd251d` |
| Providers | [douban.js](../../src/core/plugins/providers/douban.js) · [openlibrary.js](../../src/core/plugins/providers/openlibrary.js) | 双来源统一候选，可显式切换 | 4.2、17.3 | `26fd251d` |
| Metadata 服务 | [services/metadata.js](../../src/core/plugins/services/metadata.js) + [plugin-services.js](../../src/http/plugin-services.js) | 注册/优先级选择/超时/错误映射；旧路由复用 | 3.6、4.1、4.4 | `26fd251d` |

测试：`test/plugin-*.test.js`、`test/plugins-http.test.js`、`test/metadata-*.test.js`，共 107 个。

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
│   │   ├── runtime-manager.js ✅  capability-router.js ○             Phase 3b
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
- `core/toolbox/identities.js` + Python `toolbox/identity.py` 是内部身份令牌，服务兼容层，不迁入 `plugins/`。
- 规划文件按 Phase 增量创建，不得用空壳/TODO 占位。

## 验收对照（规范 13.2）

- ✅ 1、2、4、5、6、7、8、9、11
- ◐ 3：事件/服务可释放，`ctx.ui` 未实现
- ✅ 10：本文

Phase 2 门禁（规范 13 章 / 架构 17.3）：契约、内置 Provider、旧 API 兼容 ✅；真实豆瓣/OpenLibrary 联网未验收（测试用 fixture）。

Phase 3a：权限与身份绑定内核 ✅。
Phase 3b：Runtime Manager 与只读状态 ✅（仅 health；Legacy 的 invoke/cancel 显式 unsupported）。
Phase 3c：内部 import/export/tasks 按工具令牌校验归属 ✅；无令牌旧 Worker 仍兼容。书库接口尚未按权限裁剪，隔离未做。

## 测试基线

```bash
npm test                                  # 716/716
npm run check:public                      # 通过
cd toolbox-runtime
"C:/Users/11731/.venvs/mybooks-toolbox/Scripts/python.exe" -m unittest discover -s tests -v
                                          # 10/10（本机 Python 3.15；镜像 3.12 未跑）
```

## 下一步：Phase 3d 权限裁剪与隔离

1. 内部书库接口接入 `GrantStore`：`books.read` / `files.read` 等按 scope 拒绝（当前只校验身份归属，未做权限裁剪）。
2. 独立进程/容器隔离：网络出口、资源限制；共享 Worker 仅限已审查插件（规范 6.4），隔离完成前不开放第三方代码。
3. Runtime Manager 的 invoke/cancel/start/stop 接隔离运行时，禁止用 Legacy 假实现。
4. 测试：越权拒绝、插件失联撤能力、超时/取消、资源上限。

对应规范 3.6、6.1–6.6；架构 7、13、17.4。

## 硬约束

- 不改 `/api/toolbox/*`、`/get/tool/*`、Bridge、安装包与已有迁移；Python Worker 仅新增可选身份头。
- 旧 `/api/metadata/search` 的 `results` 形状、缓存与错误码保持；Provider 只返回候选，不写库。
- `server.js` 只允许加初始化/路由挂载，不改既有注册顺序。
- 内部接口保持 `internal-secret` + 可选令牌双路径；无身份头旧 Worker 必须继续可用。
- 共享 Python 进程仍不是强隔离；身份令牌只做归属校验，不得宣称已实现跨插件隔离。
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

// 元数据与运行时服务（旧路由已接入）
const { metadata, runtimes } = require('./src/http/plugin-services');
await metadata.service.search({ query: '三体' }, { providerId: 'openlibrary' });
await runtimes.healthAll();               // GET /api/plugins/runtime
```
