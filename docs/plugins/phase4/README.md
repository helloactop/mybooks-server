# Mybooks 插件平台 Phase 4 架构与开发规划

> 2026-11-09 · 分支 `codex/plugin-platform` · 基线 `5f52290c`（Phase 3g.1 完成）
> 本目录只包含架构与规范，不包含 Phase 4 实施代码。
> 所有“已实现/未实现”均以当前仓库源码为准；规划项一律标注目标阶段。

## 1. 本轮范围

Phase 4 的目标是把 Phase 0–3g.1 的“插件运行内核”发展为可分发的插件平台：

- 统一 Manifest v1 与插件注册标准；
- 统一 Python / 前端 SDK；
- 插件商店与宿主管理 UI；
- 插件自定义 UI 容器与通信协议；
- Web 与 Android 共用一套后端协议；
- 在不重写 Plugin Kernel、Runtime Manager 和旧 Toolbox API 的前提下逐阶段落地。

本轮**不实施**任何代码，只产出可执行的架构决策、规范、迁移方案与阶段计划。

## 2. 文档导航

| 文档 | 内容 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 现状审查、目标架构、模块边界、7 张架构图、接入点 |
| [MANIFEST-V1.md](MANIFEST-V1.md) | Manifest v1 完整规范与两个真实插件示例 |
| [SDK-SPEC.md](SDK-SPEC.md) | Python SDK、前端 SDK、能力契约、错误码 |
| [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) | 宿主管理 UI、插件 UI 容器选型、Bridge v2、Android 跨端 |
| [SECURITY.md](SECURITY.md) | 威胁模型、信任级别、权限/审计、已实现与未实现边界 |
| [MIGRATION.md](MIGRATION.md) | 旧 Toolbox 插件到 Manifest v1 的兼容与回滚 |
| [ROADMAP.md](ROADMAP.md) | Phase 4A–4F 目标、模块、API、测试、验收与依赖 |

## 3. 现状一句话总结

- **已有**：PluginKernel（Registry/Context/Lifecycle/EventBus）、CapabilityRouter、RuntimeManager、Python Supervisor、每插件身份令牌、GrantStore + `grants.json`、持久化 UID 注册表、私有数据目录、sandbox iframe + Bridge v1、商店索引下载校验、安装/更新/回滚/卸载、任务与取消。
- **缺口**：Manifest 没有版本号与权限/配置/UI/依赖声明；没有统一 PluginDescriptor 注册表；没有 `/api/plugins/*` 商店与管理 API；没有 SDK 包；没有 UI Registry/Slots/Schema UI；Bridge 未版本协商；Android 只有协议原则、无插件协议；网络出口、审计日志、包签名未实现。

## 4. 五个必须先定的决策（详见各文档）

1. **Manifest v1 是旧 manifest 的超集**：保留 `tool_id/revision/entry_backend/api_routes` 等旧字段，新增 `manifest_version` 与新声明块；旧包不改造即可继续安装运行。
2. **插件声明 ≠ 授权**：`permissions[]` 只进入“待授权清单”，实际调用仍由 `GrantStore`/`grants.json` 决定。
3. **UI 容器继续使用 sandbox iframe**（无 `allow-same-origin`）+ Bridge v2 版本协商；不把 Web Components 当作第三方隔离边界；复杂页面在 Android 走受限 WebView，简单表单走 Schema UI。
4. **商店与运行时解耦**：商店只做索引、下载、校验、审查状态；安装/启停/调用仍只走现有 installer 与 RuntimeManager。
5. **逐插件迁移、可回滚**：兼容层双读新旧 Manifest 与 Bridge v1/v2；任何阶段都能退回 Phase 3g.1 行为。

## 5. 阶段划分

```text
4A Manifest v1 与插件注册标准（无 UI，先打地基）
4B 统一 Plugin SDK（Python 先行，前端 Bridge SDK 跟随）
4C 插件商店与宿主管理 UI（复用 /api/toolbox 数据 + 新增 /api/plugins 只读视图）
4D 插件 UI 容器与通信协议（Bridge v2、Slots、Schema UI）
4E Web 插件集成与迁移（真实插件逐个切换）
4F Android 跨端接入（协议协商 + 受限 WebView / Schema UI）
```

依赖关系：4A → 4B → 4C；4A → 4D → 4E；4C/4D → 4F。4B 与 4D 可并行，但都必须以 4A 的 Manifest 为准。

## 6. 状态标记约定

| 标记 | 含义 |
| --- | --- |
| ✅ 已实现 | 当前仓库存在代码与测试/实证 |
| ◐ 已具备需完善 | 有基础实现，但存在明确缺口 |
| ○ Phase 4 计划 | 本轮只设计，尚未实现 |
| ⏳ 未来阶段 | 容器级隔离、网络出口策略等，不承诺在 Phase 4 完成 |

## 7. 与现有文档的关系

- [STATUS.md](../STATUS.md)：事实性进度与验收记录，Phase 4 完成后回写。
- [isolation-design.md](../isolation-design.md)：Phase 3g.1 隔离边界，本目录不重复其实现细节。
- [mybooks-plugin-architecture.md](../mybooks-plugin-architecture.md)：长期目标架构；本目录把其中 Phase 4 部分细化为可执行规范。
- [mybooks-plugin-development-standards.md](../mybooks-plugin-development-standards.md)：开发约束；Manifest/SDK/UI 规范必须与其兼容。

## 8. 非目标

- 不在 Phase 4 实现容器级恶意代码沙箱、网络出口白名单、syscall 过滤。
- 不让插件直接访问数据库、宿主密钥、Docker Socket 或宿主 DOM。
- 不支持动态下载/加载 Android APK 或任意原生代码。
- 不修改 `main`，不一次性重写旧 Toolbox 安装器、Python Loader 或 Android 同步协议。
