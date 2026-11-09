# 插件平台进度（AI 接手）

> 2026-11-09 · 分支 `codex/plugin-registry`（基于 `main`）
> 文档：[架构](mybooks-plugin-architecture.md) · [规范](mybooks-plugin-development-standards.md)

## 现状

Phase 1 完成：内核（Registry / Context / Lifecycle / EventBus / Kernel）+ 只读 Legacy Adapter + `GET /api/plugins`。
未开始：`metadata.search` Provider、权限、运行时隔离、UI、SDK。
旧 Toolbox 路由/Bridge/安装器/Worker/迁移**零改动**；`server.js` 仅新增只读路由挂载。

## 已完成

| 模块 | 文件 | 关键行为 | 规范 | 提交 |
| --- | --- | --- | --- | --- |
| Registry | [registry.js](../../src/core/plugins/registry.js) | 注册/查询/显式选择/稳定排序/disposer 幂等/停用即失效 | 3.1、13.1 | `3ee452c2` |
| Context | [context.js](../../src/core/plugins/context.js) | 身份绑定、禁止冒用实例、逆序清理、dispose 后拒绝注册 | 3.2 | `f061edf8` |
| Lifecycle | [lifecycle.js](../../src/core/plugins/lifecycle.js) | 并发 start 去重、失败回滚、stop 顺序、`fail()` 撤能力 | 3.3、5.5 | `f061edf8` |
| EventBus | [events.js](../../src/core/plugins/events.js) | `emit`/`emitAwait`、异常隔离、traceId、超时、订阅上限 | 3.5、5.7 | `b39d1507` |
| Kernel | [kernel.js](../../src/core/plugins/kernel.js) | 组合 Registry/EventBus、define/start/stop/remove/dispose | 13.1、架构 5.1 | `b39d1507` |
| Legacy Adapter | [legacy-toolbox.js](../../src/core/plugins/adapters/legacy-toolbox.js) | 只读 `toolbox_tools` → 统一描述符；状态映射；脱敏 | 5.2、13.1 | `b459632a` |
| Plugins API | [routes.plugins.js](../../src/http/routes.plugins.js) | `GET /api/plugins`，会话后挂载，只读 | 9.1、13.1 | `b459632a` |

测试：`test/plugin-*.test.js` + `test/plugins-http.test.js`，共 57 个。

## 验收对照（规范 13.2）

- ✅ 1、2、4、5、6、7、8、9、11
- ◐ 3：事件/服务可释放，`ctx.ui` 未实现
- ✅ 10：本文

## 测试基线

```bash
npm test                                  # 666/666
npm run check:public                      # 通过
cd toolbox-runtime
"C:/Users/11731/.venvs/mybooks-toolbox/Scripts/python.exe" -m unittest discover -s tests -v
                                          # 9/9（本机 Python 3.15；镜像 3.12 未跑）
```

## 下一步：Phase 2 元数据 Provider

1. 定义 `metadata.search@1`：JSON Schema、错误码、超时、来源字段（规范 4.1–4.3）。
2. 把现有 [douban.js](../../src/core/douban.js) + [metadata-sources.js](../../src/http/metadata-sources.js) 适配为内置 Provider；旧 `/api/metadata/search` 保持可用。
3. `server.js` 最小内核初始化并注册内置 Provider；新增第二个 Provider 验证可平替。
4. 契约测试：输入/输出、错误码、版本、Provider 选择顺序。

对应规范 4.3、13.1；架构 5.2–5.3、17.3。

## 硬约束

- 不改 `/api/toolbox/*`、`/get/tool/*`、Bridge、安装器、Python Worker、已有迁移。
- Legacy 只读；调用继续走原 `proxyTool`。
- `server.js` 只允许加初始化/路由挂载，不改既有注册顺序。
- 新代码 CommonJS，不新增依赖。
- 不把未运行/未验证写成“已通过”。

## 接口速查

```js
const kernel = new PluginKernel();
kernel.define({ instanceId, providerId, activate, deactivate });
await kernel.start(instanceId);

// activate(ctx) 内：
ctx.register({ capability, version, providerId, invoke });
ctx.on('book.imported', handler);

// 只读旧插件视图
const legacy = new LegacyToolboxAdapter({ db });
legacy.list(); // GET /api/plugins
```
