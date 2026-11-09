# 插件平台进度（AI 接手）

> 2026-11-09 · 分支 `codex/plugin-registry`（基于 `main`）
> 文档：[架构](mybooks-plugin-architecture.md) · [规范](mybooks-plugin-development-standards.md)

## 现状

Phase 1 内核（Registry / Context / Lifecycle / EventBus / Kernel）已完成并有测试。
Legacy Adapter、只读 API、权限、运行时隔离、UI、SDK 均未开始。
旧 Toolbox、`server.js`、数据库迁移**零改动**。

## 已完成

| 模块 | 文件 | 关键行为 | 规范 | 提交 |
| --- | --- | --- | --- | --- |
| Registry | [registry.js](../../src/core/plugins/registry.js) | 注册/查询/显式选择/稳定排序/disposer 幂等/停用即失效 | 3.1、13.1 | `3ee452c2` |
| Context | [context.js](../../src/core/plugins/context.js) | 身份绑定、禁止冒用实例、逆序清理、dispose 后拒绝注册 | 3.2 | `f061edf8` |
| Lifecycle | [lifecycle.js](../../src/core/plugins/lifecycle.js) | 并发 start 去重、失败回滚、stop 顺序、`fail()` 撤能力 | 3.3、5.5 | `f061edf8` |
| EventBus | [events.js](../../src/core/plugins/events.js) | `emit`/`emitAwait`、异常隔离、traceId、超时、订阅上限 | 3.5、5.7 | `b39d1507` |
| Kernel | [kernel.js](../../src/core/plugins/kernel.js) | 组合 Registry/EventBus、define/start/stop/remove/dispose | 13.1、架构 5.1 | `b39d1507` |

测试：`test/plugin-{registry,context,lifecycle,events,kernel}.test.js`，共 51 个。

## 验收对照（规范 13.2）

- ✅ 1、2、4、6、7、8、9、11
- ◐ 3：事件/服务可释放，`ctx.ui` 未实现
- ○ 5：Legacy Adapter（PR4）
- ✅ 10：本文

## 测试基线

```bash
npm test                                  # 660/660
npm run check:public                      # 通过
cd toolbox-runtime
"C:/Users/11731/.venvs/mybooks-toolbox/Scripts/python.exe" -m unittest discover -s tests -v
                                          # 9/9（本机 Python 3.15；镜像 3.12 未跑）
```

## 下一步：PR4

1. `src/core/plugins/adapters/legacy-toolbox.js`：只读 `toolbox_tools` → 统一描述符；暴露 `pending_restart` / `last_error`，区分 `reviewed` / `compatibility`；不输出 `install_path`、sha，不写回 Manifest。
2. `GET /api/plugins`：注册在 `requireSession` 之后，只读，不接管旧调用。
3. 测试：字段脱敏、状态映射、未登录 401、旧路由无回归。

对应规范 5.2、9.1、13.1；架构 8.1、17.2。

## 硬约束

- 不改 `/api/toolbox/*`、`/get/tool/*`、Bridge、安装器、Python Worker、已有迁移。
- Legacy 在 Phase 1 只读；调用继续走原 `proxyTool`。
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
```
