# Phase 4C.4-R：安全修复与专项回归

> 基线：`7deb7d96`（= `origin/codex/plugin-platform`）
> 范围：只修 P1/P2 缺陷，不新增功能；未提交、未推送。
> 结论：**PASS**（两项 P1 均已复现并修复；残留风险边界见 §7）

## 1. P1-1 权限 scope 越权扩大

| 项 | 内容 |
| --- | --- |
| 原始位置 | `src/core/toolbox/grants-admin.js` `normalizeRequested()` |
| 是否复现 | **是**。Manifest 声明 `books.read` scope `book:1`，以 `permissions:[{name:'books.read',scope:'*'}]` 调用 `updatePermissions` 返回成功，`grants.json` 写入裸 `books.read`（= `*`）。 |
| 根因 | 只校验“权限名在目录 + 在 Manifest 声明 + scope 语法合法”，没有校验实际范围是否属于 Manifest 声明范围。`assertScope('*')` 只验证格式。 |
| 修复 | 新增 `scopeCovers(declared, requested)` 资源语义模型：<br/>· `*` 覆盖一切；请求 `*` 只有在声明 `*` 时允许<br/>· 同类型精确匹配；`type:*` 覆盖同类型任意值<br/>· `library:all` 覆盖 `book:<id>` / `book:*`<br/>· 跨资源类型（book ↔ artifact ↔ library）一律拒绝<br/>· 无法证明时保守拒绝<br/>拒绝时返回 `400 PERMISSION_SCOPE_OUT_OF_RANGE`，消息包含声明范围。 |
| 修改文件 | `grants-admin.js`（新增 `parseScope`/`scopeCovers`，接入 `normalizeRequested`）、`center.js`（新增 `out_of_range` 列表）、`plugin-center.js`（前端同算法 + 导出）、`page-plugin-detail.js`（声明范围展示、越界提示、越界历史授权不进入草稿）、`plugins.css` |
| 新增测试 | `test/plugins-scope-boundary.test.js`（9 项）：声明 `book:1` 时 `*`/`library:all`/跨类型/`artifact:*` 拒绝；合法精确与缩小成功；多 scope 共存；历史越权条目不被悄悄保留；撤销后内部调用 403；`if_version` 409 不改文件；未声明权限拒绝；`network.*` 保持 `unenforced` |
| 安全边界变化 | 管理端不能再把授权扩大到 Manifest 声明之外；已存在的越权条目在下次保存时被清除，并在权限视图 `out_of_range` 中提示 |
| 兼容性 | Manifest 未写 scope 时按 `*` 处理（与历史裸权限条目语义一致），旧插件不受影响；`/internal/toolbox/*` 的运行时判定未改 |

## 2. P1-2 Runtime 跨插件配置访问

| 项 | 内容 |
| --- | --- |
| 原始位置 | `toolbox-runtime/runtime.py` `InternalConfigHandler` |
| 是否复现 | **是**。设置 `TOOLBOX_ONLY_TOOL=plugin_alpha`（子进程身份）后，用自己的 runtime-secret 请求 `GET/PUT /internal/tool/plugin_beta/config` 均返回 200，可读可写他插件配置（测试先失败后通过）。 |
| 根因 | Handler 只校验 runtime-secret；子进程同样注册该路由，且使用共享数据卷，请求目标 `tool_id` 未与进程绑定身份比较。 |
| 修复 | `make_app()` 在启动时读取 `TOOLBOX_ONLY_TOOL` 并作为 `bound_tool` 注入 handler；`make_supervisor_app()` 显式传空（Supervisor 是可信管理方）。请求 `tool_id` 与绑定不一致 → `403 CROSS_PLUGIN_DENIED`。绑定在启动时固化，运行期修改 `os.environ` 无效。 |
| 修改文件 | `toolbox-runtime/runtime.py` |
| 新增测试 | `toolbox-runtime/tests/test_config_identity.py`（7 项）：本插件可读；他插件 GET/PUT 403 且配置不变；篡改环境变量不解绑；无/错 secret 403；宿主模式可管理任意插件 |
| 安全边界变化 | 插件子进程只能访问自己的配置；Supervisor/共享宿主仍可管理全部插件（Node 管理链路不变） |
| 兼容性 | `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY` 只影响 Python→Node，不影响该接口；共享模式与 Supervisor 模式均验证 |

## 3. P2-1 配置损坏后的错误降级

| 项 | 内容 |
| --- | --- |
| 原始位置 | `toolbox-runtime/webserver/toolbox/storage.py` `get_config()` / `_load_key()` |
| 是否复现 | **是**。读取损坏 JSON 返回 `{}`（随后保存会覆盖原文件）；密钥文件不可解析时自动生成新密钥。 |
| 根因 | `except (OSError, ValueError)` 统一降级为空对象；`_load_key()` 把“文件不存在”和“读取/解析失败”合并处理。 |
| 修复 | 只有 `ENOENT` 返回 `{}`；JSON 损坏 → `CONFIG_CORRUPTED`，读取失败 → `CONFIG_READ_FAILED`，解密失败 → `CONFIG_DECRYPT_FAILED`，密钥不可读/非法 → `CONFIG_KEY_UNREADABLE`（绝不重建）；密钥创建改为 `link()`/`O_EXCL` 独占；`set_config` 增加 `fsync`、失败清理临时文件并返回 `CONFIG_WRITE_FAILED`；`StorageError` 增加 `code`。 |
| 修改文件 | `storage.py`、`runtime.py`（透传错误码）、`src/core/toolbox/plugin-config.js`（把损坏/密钥异常映射为 `CONFIG_UNAVAILABLE` 502，且不覆盖） |
| 新增测试 | `toolbox-runtime/tests/test_storage_recovery.py`（9 项）：缺失返回空、首次保存、JSON 损坏不覆盖、密文损坏、密钥不可读不重建、写盘失败保留旧配置、密钥稳定、旧明文兼容、版本稳定 |
| 兼容性 | 正常配置与旧明文配置文件行为不变；AES-256-GCM 格式未改；已安装插件数据未改动 |

## 4. P2-2 首次配置保存版本冲突

| 项 | 内容 |
| --- | --- |
| 原始位置 | `runtime.py` `InternalConfigHandler` GET/PUT、`src/core/toolbox/plugin-config.js` `fetchRaw()` |
| 是否复现 | **是（代码路径）**。配置文件不存在时 Node 返回 `version:''`，而 Runtime 用空对象哈希比较 → 首次保存必然 409。原 HTTP 测试使用的是“已有配置”的假 Runtime，未覆盖该路径。 |
| 根因 | 两侧对“配置不存在”的版本语义不一致。 |
| 修复 | Runtime 以 `storage.config_exists()` 判定：文件不存在时版本为空串（GET 与 PUT 一致）；Node 优先采用 Runtime 返回的 `version`（即使为空串），仅在旧 Runtime 完全缺字段时用本地兜底。 |
| 修改文件 | `runtime.py`、`storage.py`（`config_exists`）、`plugin-config.js` |
| 新增测试 | `test/plugins-config-first-save.test.js`（8 项）：首次读取 `version=''`、首次保存成功、旧版本号 409、并发首次保存仅一个成功、Runtime 版本权威、旧 Runtime 兜底稳定、损坏不覆盖、Unicode/嵌套/键序版本稳定 |
| 兼容性 | 已有配置的版本算法未改；Node 与 Python 的哈希实测一致（Docker 内 PUT/GET 对照） |

## 5. P2-3 审计可靠性

| 项 | 内容 |
| --- | --- |
| 原始位置 | `grants-admin.js`、`plugin-config.js`、`routes.plugins.admin.js` |
| 现状 | 审计失败原本只返回 `false`，响应不体现。 |
| 修复 | 成功写入的响应增加 `audit: { ok, recorded }`；失败响应增加 `audit_ok`；前端在 `audit.ok === false` 时追加警告 Toast。**一致性策略：业务写入先落盘，审计失败不回滚、不重试，显式标记部分成功**（两项独立文件写入，本轮不引入事务）。 |
| 修改文件 | `grants-admin.js`（可注入 `auditLog`）、`plugin-config.js`、`routes.plugins.admin.js`、`page-plugin-detail.js` |
| 新增测试 | `test/plugins-audit-failure.test.js`（5 项）：权限写入成功+审计失败、重试幂等不扩权、`recordFailure` 返回 false、配置写入成功+审计失败且不泄露明文、审计模块自身不抛 |
| 剩余风险 | 权限文件与审计文件非事务；极端断电可能只有其一落盘。已用 `audit.ok=false` 明确暴露，未宣称强一致。 |

## 6. P2-4 Schema 类型一致性

| 项 | 内容 |
| --- | --- |
| 原始位置 | `public/js/plugin-config-form.js` |
| 现状 | `array` / `object` 会落回 `string`，被当作文本框提交。 |
| 修复 | `buildFields` 标记 `unsupported`；`collectChanges` 永不提交此类字段；`validateField` 跳过；前端渲染只读 `<pre>` JSON 并提示“请使用插件界面配置”；必填且未配置时阻止保存并给出明确文案。 |
| 新增测试 | `test/plugins-detail-ui.test.js` 扩充：数组/对象不进入 values、必填未配置报错、只读类型标签 |
| 兼容性 | 标量类型、敏感字段掩码/清除语义不变 |

> 说明：`test/plugins-detail-ui.test.js` 的数组用例在本轮追加（原文件 10 项 → 12 项）。

## 7. 残留风险（明确边界）

1. **共享 Worker + 同 UID**：插件代码与宿主同进程、同数据卷、同密钥。恶意插件可直接读 `data/<other>/config.json` 密文（可解密），HTTP 层修复无法阻止。需要 `TOOLBOX_ISOLATE_PLUGINS=1` + 独立 UID 才能形成 OS 级边界。
2. **独立 UID 未真实验证**：容器缺少 `CAP_SETUID`/`CAP_CHOWN` 等能力，`uid_isolation.uid_enabled=false`；本轮标记 **未验证**，未声称通过。
3. **审计非事务**：见 §5，采用“部分成功 + 显式标记”。
4. **Manifest 未写 scope**：按 `*` 处理（历史语义），此时 scope 校验退化为“任意合法范围”。已在测试与文档中说明。

## 8. 兼容性回归

- `/api/plugins/*` 只增加响应字段（`out_of_range`、`audit`、`version`），未删除或改名。
- `/api/toolbox/*`、`/internal/toolbox/*` 未改动。
- Legacy `grants.json` 解析、`last-good`、fail-closed 语义未改。
- Bridge v1、插件 iframe CSP、安装/更新/回滚/卸载语义未改。
- Z-Library 未审查安装门禁未改。
- 数据库 Schema 未改。

## 9. 本轮测试结果（全部实跑）

| 套件 | 结果 |
| --- | --- |
| `npm test` | **914 / 914 通过**（原 890 + 24 新增） |
| `python -m unittest discover -s plugin-sdk/python/tests` | **35 / 35** |
| `python -m unittest discover -s toolbox-runtime/tests` | **95 通过 / 0 失败 / 10 跳过**（跳过均为 POSIX 权限/UID 相关） |
| Docker 镜像内 Runtime | **95 通过 / 0 失败 / 1 跳过** |
| Docker Supervisor 模式冒烟 | `/healthz` `isolation_mode=process`；宿主 `PUT /internal/tool/:id/config` 成功；`uid_isolation.uid_enabled=false`（缺少 capabilities，未验证） |
| `npm run check:public` / `npm run check:icons` | 通过 |
| 浏览器（真实登录） | 声明范围展示、越界行内提示、越界保存失败且保留草稿、改回后保存成功、数组字段只读、无控制台报错 |

未执行：真实 md_to_epub / zlibrary 端到端（属 4C.5）；独立 UID 真实验证（环境不支持）。

## 10. 验收结论

- P1-1、P1-2 均已复现 → 修复 → 有回归测试。
- P2-1 ~ P2-4 已修复并有测试。
- 关键测试全部通过，未通过关闭认证/放宽权限的方式换取通过。
- **结论：PASS**，具备进入 4C.5 的条件。4C.5 需补：真实插件全链路、390px 响应式矩阵、独立 UID 环境验证、`verification.md`。
