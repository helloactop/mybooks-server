# Phase 4B 任务清单（执行顺序）

> 每项完成后必须能独立验证；失败不得通过修改测试掩盖。

## 4B.1 基线审查（已完成）

- [x] 确认 HEAD `fd61d391`、工作区干净、与 origin 同步
- [x] 核实内部路由、权限、任务表、书库适配、Python CoreAPI/NodeClient、Bridge v1、CSP
- [x] 形成复用点与缺失能力清单（见 `spec.md` 第 1 节）

## 4B.2 宿主接口补齐

- [x] `src/db/index.js`：`migrateV28` 新增 `toolbox_artifacts`，注册迁移
- [x] `src/db/toolbox.js`：Artifact 读写函数
- [x] `src/core/toolbox/artifacts.js`：发布/查询、路径与 SHA-256 校验、插件归属
- [x] `src/core/toolbox/library.js`：`createBook` / `updateBook` / `readingStatus`
- [x] `src/core/toolbox/config-schema.js`：`validateConfig` / `sensitiveFields`
- [x] `src/http/routes.toolbox.internal.js`：books / artifacts / tasks / config / metadata 路由
- [x] `src/core/plugins/descriptor.js` 或现有入口：确保可读 `configuration.schema`（不改变 4A 行为）
- [x] 手工冒烟：两条真实插件（zlibrary、md_to_epub）内部调用不受影响

## 4B.3 Python SDK

- [x] `plugin-sdk/python/pyproject.toml`
- [x] `mybooks_plugin_sdk/{__init__,errors,contract,client,books,files,jobs,config,metadata,compat}.py`
- [x] `node_client.py`：公开 `request` + 新能力方法
- [x] `toolbox-runtime/webserver/toolbox/sdk.py` 与 `CoreAPI.sdk`
- [x] `scripts/sync-plugin-sdk.mjs` + `package.json` `sdk:sync`
- [x] `toolbox-runtime/Dockerfile`：`COPY sdk` + `PYTHONPATH`
- [x] `plugin-sdk/python/tests/` 三个测试文件
- [x] `toolbox-runtime/tests/test_sdk.py`

## 4B.4 前端 SDK

- [x] `public/static/plugin-sdk/v1.js`
- [x] `src/http/routes.toolbox.ui.js` CSP 放行精确路径
- [x] 手工验证：旧插件页面不加载新 SDK 仍正常；新 SDK 可 `ready()`、`call()`、`jobs.watch().stop()`

## 4B.5 集成测试与文档

- [x] `test/plugins-sdk-contract.test.js`（含最小任务链）
- [x] `npm test` 全量通过（记录真实数量）
- [x] Python 单测通过（本机与 Docker 分别记录）
- [x] Docker 镜像内 `import mybooks_plugin_sdk` 通过
- [x] 更新 `docs/plugins/STATUS.md`、`phase4/SDK-SPEC.md`、`phase4/ROADMAP.md`
- [x] 输出交付报告（HEAD、文件清单、兼容性、安全边界、测试结果、未完成项、回滚、4C 前待办）

## 明确不做（本轮）

- 不新增 `Plugin`/`route` 装饰器加载体系
- 不实现 Phase 4C 商店 UI / 4D UI Slot
- 不修改 Android 仓库
- 不重写 PluginKernel / Registry / RuntimeManager
- 不自动提交、推送或合并分支
