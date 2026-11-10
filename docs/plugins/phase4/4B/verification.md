# Phase 4B 验收与安全审查报告（4B-V）

> 审查对象：MyBooks 插件平台 Phase 4B
> 分支：`codex/plugin-platform`
> 基线提交：`0eb76dcc19ef6e22d31cd7e1a8adf65f7ffca035`（= `origin/codex/plugin-platform`；4B-R 修复未提交）
> 审查方式：4B-V 只读审查；4B-R（§15）按授权修复并重新验收；均未提交、未推送、未合并
> 审查日期：2026-11-10
> 结论：**4B-V 为 BLOCKED（P0=0，P1=2，P2=8，P3=6）；4B-R 修复后重新验收为 CONDITIONAL PASS（P0=0，P1=0）**

---

## 1. 结论摘要

| 项目 | 4B-V 结果 | 4B-R 结果 |
| --- | --- | --- |
| 自动化测试 | `npm test` 800/800；Python SDK 13/13；Runtime SDK 4/4 | `npm test` 807/807；Python SDK 35/35；Runtime 73/73（10 skipped） |
| 迁移 | v0→v28、v27→v28、幂等、失败回滚通过 | 未改动迁移 |
| Artifact 安全 | 穿越/绝对路径/符号链接/跨插件/扩展名/80MB/SHA 均拒绝 | 未回归（原有测试全过） |
| 权限与身份 | 无身份/错令牌/跨插件/停用/`POLICY_BROKEN` 均 fail-closed | 未回归 |
| Docker | 镜像可构建，容器内 SDK/旧 CoreAPI 可导入 | `:4br` 重建通过，`compat.from_tool` 与 dict 调用在容器内实测通过 |
| 真实插件 | md_to_epub 全链路；zlibrary 用户手工端到端 | md_to_epub 转换/下载/入库通过；zlibrary 0.1.1 加载/UI/路径自检通过 |
| 前端 | v1.js 逻辑用例全过；CSP sandbox | 未改动 |
| 阻断原因 | 2 个 P1 | 已修复并新增独立回归 |

4B-V 按分级规则判为 BLOCKED；两个 P1 修复后，4B-R 结论为 **CONDITIONAL PASS**（条件见 §15.7）。

---

## 2. 检查文件（静态审查范围）

插件核心：
`src/core/plugins/{kernel,registry,lifecycle,context,capability-router,runtime-manager,permissions}.js`、
`src/core/plugins/adapters/legacy-toolbox.js`

工具链核心：
`src/core/toolbox/{access-policy,plugin-grants,artifacts,library,config-schema,tasks,installer,descriptor,import,security,store,runtime}.js`

HTTP 与 UI：
`src/http/{routes.toolbox,routes.toolbox.internal,routes.toolbox.ui}.js`、`src/http/middleware.auth.js`、`server.js`

数据层：
`src/db/{index,toolbox,books,book_files}.js`

SDK 与运行时：
`plugin-sdk/python/mybooks_plugin_sdk/{__init__,sdk,client,contract,errors,books,files,jobs,config,metadata,compat}.py`、
`public/static/plugin-sdk/v1.js`、`toolbox-runtime/webserver/toolbox/{sdk,core_api,node_client,identity,config,storage,base_tool}.py`、
`toolbox-runtime/Dockerfile`、`toolbox-runtime/requirements.txt`、`scripts/sync-plugin-sdk.mjs`

规格与文档：
`docs/plugins/phase4/4B/spec.md`、`docs/plugins/phase4/4B/tasks.md`、`docs/plugins/phase4/SDK-SPEC.md`

---

## 3. 迁移验证（实际执行）

| 用例 | 结果 |
| --- | --- |
| 空库 v0 → v28 | 通过，`toolbox_artifacts` 与 3 个索引创建 |
| v27 → v28 增量 | 通过 |
| 重复执行迁移 | 幂等，`user_version` 不倒退 |
| 注入失败迁移 | 事务整体回滚，`user_version` 与旧数据保持不变 |
| 约束 | `artifact_id` UNIQUE、`size >= 0` CHECK、`status IN ('active','deleted')` 均生效 |

---

## 4. Python SDK 契约（P1）

按 `SDK-SPEC.md` §4.3/§4.4 文档签名逐项调用实测：

| 文档示例 | 实测结果 |
| --- | --- |
| `sdk.books.search({"q": "三体", "limit": 20})` | dict 被当成 query 字符串，静默返回错误查询结果，无报错 |
| `sdk.jobs.create({"operation": "download"})` | `operation` 被当成 dict，触发长度校验错误 |
| `sdk.jobs.progress(job_id, 42)` | `TypeError`（实现为 `progress(job_id)` 只读） |
| `sdk.jobs.complete(job_id, status="done")` | `TypeError`（实现无 `status` 参数） |
| `sdk.files.publish({"job_id":..., "path":...})` | dict 被当成 path，且 `task_id=None` |
| `sdk.files.import_file({...})` | `TypeError` |
| `sdk.metadata.search({"isbn": "..."})` | dict 被当成查询串，静默查错 |

即“文档写一套、实现是另一套”，且失败方式包含**静默错误**，插件作者按文档写会得到错误数据而不是异常。详见 [P1-1](#p1-1)。

`compat.from_tool` 在真实镜像内的实测：

```text
ModuleNotFoundError: No module named 'toolbox'
```

原因：`compat.py` 导入 `from toolbox.node_client import NodeClient`，镜像实际路径是 `webserver.toolbox.node_client`；`storage` 导入失败被 `except` 静默吞掉，导致旧插件拿到的 `sdk.config` 不可用。详见 [P1-2](#p1-2)。

---

## 5. Artifact 与文件安全（实际执行）

以下用例均在隔离临时数据库/目录中执行，全部按预期拒绝或通过：

- 合法发布 → 返回 `artifact_id`，DTO 不含宿主绝对路径。
- `../`、插件目录内穿越、绝对路径越界、跨插件绝对路径、反斜杠 → 拒绝。
- Windows junction 指向数据目录外 → 拒绝。
- 文件不存在、非电子书扩展名、非法格式、超过 80MB → 拒绝。
- SHA-256 与文件不一致、声明格式与真实格式不一致 → 拒绝。
- 跨插件任务发布 → `403 TASK_TOOL_MISMATCH`；跨插件读取/删除 → `403`。
- 不存在/非法 `artifact_id` → `404`；删除后再查 → `404`；停用后 → `403 TOOL_DISABLED`。
- 卸载删除登记记录；`purgeData=1` 删除插件数据目录。
- 软删除不删除磁盘文件（记录为 P3，见 [P3-1](#p3-1)）。

---

## 6. 权限与身份隔离（实际执行）

| 用例 | 结果 |
| --- | --- |
| 无插件身份 | 403 |
| 缺令牌 / 错误令牌 | 403 |
| body `tool_id` 与令牌不一致 | 403 |
| 未安装插件 | 404 |
| `grants.json` 损坏且无 last-good 快照 | 403 `POLICY_BROKEN` |
| 隔离模式不发送共享 internal-secret | 通过 |
| `state/identities.json` 损坏 | fail-closed |
| `book:<id>` 资源级权限 | 缺 resource 时 `PERMISSION_RESOURCE_REQUIRED` |
| 停用插件 | 所有内部路由 403 |

---

## 7. Docker 与运行时

- `npm run sdk:sync` 成功；`plugin-sdk/python/mybooks_plugin_sdk` 与 `toolbox-runtime/sdk` 单一源一致；`.gitignore` 正确忽略生成物。
- `mybooks-toolbox-runtime:4bv` 构建成功；容器内 `webserver.toolbox.*` 与旧 `BaseTool`/`CoreAPI` 可导入，进程 `uid=1000`。
- 共享模式 healthz 正常；Supervisor 模式 child 上线，但 `uid_isolation=false`（缺 `CAP_SETUID`/`CAP_SETGID`），见 [P2-7](#p2-7)。
- Node 镜像 `mybooks-4bv-node` 由当前基线 Dockerfile 构建，`/healthz` 正常。

---

## 8. 真实插件验证

### 8.1 `md_to_epub 1.1.0`（已审查、SHA 匹配）

| 环节 | 结果 |
| --- | --- |
| 应用内商店安装 | 201，`source=store`，`trust=reviewed`，`supported=true` |
| 插件 UI / CSP | 200；`sandbox`；`script-src` 仅含宿主 origin 与 `plugin-sdk/v1.js` |
| Markdown → EPUB | 成功 |
| EPUB 下载 / 结构校验 | 成功（zip 结构、mimetype 正确） |
| 入库 | 成功（`book_id=1`） |
| 停用/启用、Worker 重启、卸载 | 全部通过 |
| 跨进程 SDK 任务链 | Python SDK → 内部 HTTP → SQLite → 文件 → Artifact → 入库 → 完成任务 → 查询结果 → 删除 Artifact，全部通过 |

### 8.2 `zlibrary 0.1.1`（本轮新增：自行审查 + 隔离验证）

**包获取与完整性**

- 商店索引 `latest_revision=0.1.1`，`core_api_version=1.3.0`。
- 下载 `https://mybooks.top/toolbox/files/others/zlibrary-0.1.1.zip`，实测 SHA-256 `af0914bbe4ef4b29db63e83d7995f82703a1a7ebc069151360708c3f5efadf4e`，与索引一致。
- 应用内安装仍返回 `409 REVIEW_REQUIRED`（未加入上游审查 allowlist），**未修改 allowlist**。

**代码审查结论**

| 维度 | 结论 |
| --- | --- |
| 后门/外联 | 未发现硬编码外联地址、上传、遥测；网络仅访问配置的入口与其跳转目标 |
| 凭据处理 | 只保存会话 cookie / `remix_userkey` / `bsrv`，**不保存邮箱密码**；对外 API 全部掩码 |
| 凭据落盘 | 经宿主 `storage.set_config` 加密（AES-256-GCM），文件权限 `0600`，实测密文 |
| 文件写入 | 仅写插件 `work/` 目录；文件名清洗 `/ \ : * ?` 等并限长；下载有 `max_mb` 上限，HTML 响应拒绝 |
| 前端 | 无 `innerHTML`/`eval`/`document.write`；全部 `textContent`；无外部 CDN；使用 `MyBooksToolBridge` |
| 危险调用 | 后端无 `subprocess`/`eval`/`os.system` |
| 私网访问 | `_validate_url` 拒绝 `http`、URL 内凭据、私网/链路本地 IP 字面量；DoH 只接受公网 A 记录 |
| 依赖 | `requests`、`beautifulsoup4` 已在 runtime `requirements.txt` 中，容器内导入成功 |

风险点（不构成 P0/P1）：`entry_url` 可配置为任意公网 HTTPS 入口，密码登录会把凭据发往该入口（钓鱼风险，管理员自担）；改用 DoH 时系统 DNS 分支未固定 IP，理论存在 DNS rebinding；挑战求解为最多 2,000,000 次 SHA-1 的 CPU 循环（自伤型）。对应 [P3-5](#p3-5)、[P3-6](#p3-6)。

**隔离运行验证**

验证方式：隔离容器（Node + Runtime，临时 `/data`、`/toolbox` 卷），通过应用上传接口安装，仅在容器内临时设置 `MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=true`；仓库、allowlist、SSRF 均未改动。安装结果：`201`、`source=dev`、`reviewed=false`、`warnings=[UNREVIEWED_ALLOWED]`。

| 检查 | 结果 |
| --- | --- |
| 安装 / 启用 / runtime 加载 | 通过（`plugins: ["zlibrary","md_to_epub"]`） |
| 未登录访问代理接口 | 401 |
| 插件页 `/toolbox/tool/zlibrary` | 200 |
| iframe HTML 与 CSP | 200；`sandbox allow-scripts...`；`script-src` 无 `unsafe-inline` |
| 配置读取/保存/夹紧 | 通过（`timeout=999` → 120；`tag` 持久化） |
| 配置存储 | `config.json` 为 AES-256-GCM 密文，`0600` |
| 私网入口 | 保存时可写入，使用时 `health` 返回 `err=dns.private`，未发起请求 |
| `health` / `search`（外网被阻断） | 结构化错误 `entry.unreachable`，无崩溃、无 500 堆栈泄漏 |
| 空查询 / 非法 book_token / 过期 token | `params.missing`、`params.invalid`、`book.expired` |
| 游客账号导入失败后 | 未持久化任何账号 |
| 停用后路由 | 拒绝（`TOOL_DISABLED`） |
| 卸载 + `purge_data=1` | 插件目录与数据目录删除，runtime 重载后仅剩 `md_to_epub` |
| 离线单元检查 | 17/17 通过（URL 校验、文件名清洗、bookcard 解析、错误码映射、挑战求解、无危险调用） |

**端到端补充验证**：自动化环境内 `zlib.ch` TCP 被阻断（`curl` 20s 超时，容器内 `entry.unreachable`），属网络环境限制而非插件缺陷。2026-11-10 在本机原生 Node + runtime 环境（真实数据目录）由用户手工执行，**搜索 → 下载 → 入库成功**，zlibrary 0.1.1 记为「代码审查通过 + 隔离运行通过 + 用户手工端到端通过」。

---

## 9. 前端 SDK 与 CSP

- `public/static/plugin-sdk/v1.js` 用 `vm` 执行验证：`ready`、`call`、非法路由、`jobs.watch` 最小间隔 500ms、`stop`、`timeout`、`pagehide` 清理、`BRIDGE_MISSING` 全部通过。
- 插件 UI CSP：`sandbox`、`default-src 'none'`、无通配符、`script-src` 不含 `unsafe-inline`，仅宿主 origin + `toolbox-bridge.js` + `plugin-sdk/v1.js`。

---

## 10. 自动化测试

| 套件 | 结果 |
| --- | --- |
| `npm test` | 800 通过 / 0 失败 / 0 跳过 |
| Python SDK 单测 | 13/13 |
| Runtime SDK 单测 | 4/4（宿主与容器内均通过） |
| 前端 SDK 用例 | 全部通过 |
| 隔离安全用例（本轮脚本） | 通过（负向用例均为预期拒绝） |
| zlibrary 离线单元 | 17/17 |
| zlibrary HTTP 用例 | 20 项，安全预期全部满足（4 项为口径差异，已在正文说明） |

---

## 11. 问题清单

### P0

无。

### P1

<a id="p1-1"></a>
#### P1-1 Python SDK 公开调用契约与 `SDK-SPEC` 不一致

- 位置：`plugin-sdk/python/mybooks_plugin_sdk/{books,jobs,files,metadata}.py`、`contract.py`；文档 `docs/plugins/phase4/SDK-SPEC.md` §4.3/§4.4
- 触发：按文档传入 dict 或命名参数调用
- 根因：实现采用“位置参数 + 少数关键字”签名，未做 dict/关键字归一化，也未在收到不支持的形态时报错
- 影响：插件按官方文档编写必然失败；`books.search`/`metadata.search`/`files.publish` 属于**静默错误**，可能把错误数据写进书库或 Artifact
- 复现：`sdk.books.search({"q": "x"})` 返回按 dict 字符串检索的结果；`sdk.jobs.progress(job_id, 42)` 抛 `TypeError`
- 修复建议：统一入口做“dict / 关键字 / 位置”三种形态归一化；不支持的参数抛 `PluginError("VALIDATION")`；补充契约测试向量
- 建议测试：以 `SDK-SPEC` 每个示例为一条测试，断言参数被正确解析且不产生静默降级

<a id="p1-2"></a>
#### P1-2 `compat.from_tool` 在真实镜像不可用

- 位置：`plugin-sdk/python/mybooks_plugin_sdk/compat.py`
- 触发：在 runtime 容器内调用 `compat.from_tool` / `compat.attach`
- 根因：导入了不存在的顶层包 `toolbox.*`（镜像内实际为 `webserver.toolbox.*`）；`storage` 导入失败被静默捕获
- 影响：SDK 宣称的“旧插件零改动兼容”实际不可用；失败被吞掉后表现为配置能力缺失，难以排查
- 复现：容器内 `python -c "from mybooks_plugin_sdk import compat; compat.from_tool(object())"` → `ModuleNotFoundError: No module named 'toolbox'`
- 修复建议：改为 `webserver.toolbox.node_client` / `webserver.toolbox.storage`；导入失败时抛出明确错误而不是静默跳过；容器内加入冒烟测试
- 建议测试：镜像构建后在容器内执行 `compat.from_tool` 冒烟用例，并覆盖 storage 不可用场景

### P2

<a id="p2-1"></a>
#### P2-1 终态任务仍可被 PATCH

- 位置：[routes.toolbox.internal.js](file:///c:/littleBIngbing/mybooks-server/src/http/routes.toolbox.internal.js)（`PATCH /internal/toolbox/tasks/:id`）、[tasks.js](file:///c:/littleBIngbing/mybooks-server/src/core/toolbox/tasks.js)
- 触发：任务已 `completed`/`failed`/`cancelled` 后再次 PATCH
- 根因：更新前未校验当前状态是否允许迁移
- 影响：已完成任务可被改写为 `cancelled`、进度可被覆盖，审计与结果不可信
- 复现：任务完成后 PATCH `{"status":"cancelled","progress":5}` → 200 且状态变更
- 修复建议：仅允许 `running`/`pending` 更新；终态只允许追加消息/结果字段
- 建议测试：终态 PATCH 返回 409 且数据不变

<a id="p2-2"></a>
#### P2-2 任务进度可倒退

- 位置：[toolbox.js](file:///c:/littleBIngbing/mybooks-server/src/db/toolbox.js)（`updateTask`）
- 触发：`progress` 从 80 更新为 30
- 根因：只做 0..100 夹紧，无单调约束
- 影响：前端进度条回退，用户误判任务状态
- 复现：连续 PATCH 80、30，最终为 30
- 修复建议：非终态下 `progress = max(old, new)`，或显式允许重启阶段并提供标记
- 建议测试：回退请求被忽略或返回 409

<a id="p2-3"></a>
#### P2-3 卸载后 Worker 仍保留已加载插件

- 位置：[runtime-manager.js](file:///c:/littleBIngbing/mybooks-server/src/core/plugins/runtime-manager.js)、`toolbox-runtime/runtime.py`
- 触发：卸载插件但未重启 Worker
- 根因：卸载只删文件与登记，未通知 Runtime 卸载模块
- 影响：Runtime healthz 仍列出已卸载插件；旧代码在进程内继续可被调用（路由已由 Node 拦截）
- 复现：卸载后 `GET /api/toolbox/runtime` 仍含该插件，直到 `restart`
- 修复建议：卸载后触发 Runtime reload；或 healthz 以 Node 登记为准
- 建议测试：卸载后 healthz 不含该插件

<a id="p2-4"></a>
#### P2-4 Node 与 Runtime 的 `/toolbox` 绝对路径必须一致

- 位置：[import.js](file:///c:/littleBIngbing/mybooks-server/src/core/toolbox/import.js)（`resolveToolFile`）、部署文档
- 触发：双容器部署时两侧挂载路径不同
- 根因：插件传入的是 Runtime 视角的绝对路径，Node 用同一字符串校验
- 影响：入库报“插件文件不存在”，下载成功后无法入库
- 复现：Node 挂 `/data/toolbox`、Runtime 挂 `/toolbox` 时必现
- 修复建议：部署文档明确“两侧同路径”；或由 Node 做路径前缀映射
- 建议测试：双容器同一 compose 下跑一次下载入库

<a id="p2-5"></a>
#### P2-5 本地/开发安装已审查包仍显示 `REVIEW_REQUIRED`

- 位置：[descriptor.js](file:///c:/littleBIngbing/mybooks-server/src/core/toolbox/descriptor.js)（`compatibilityView`）
- 触发：以 `source=dev`/本地安装已审查包
- 根因：用 `trust === 'reviewed'` 判断，而本地来源被映射为 `trust='local'`
- 影响：已审查包显示“未审查/不支持”，误导用户
- 复现：本地上传 `md_to_epub 1.1.0` → `compatibility.supported=false`
- 修复建议：兼容性判断改用 allowlist/SHA 结果，而非来源 trust
- 建议测试：本地安装已审查包 → `supported=true`、`reviewed=true`

<a id="p2-6"></a>
#### P2-6 Node 启动即把所有 `running` 任务标记失败

- 位置：[toolbox.js](file:///c:/littleBIngbing/mybooks-server/src/db/toolbox.js)（`recoverRunningTasks`）
- 触发：Node 重启时 Worker 仍在执行任务
- 根因：只按状态恢复，没有与 Runtime 交叉确认
- 影响：仍在运行的任务被误标 `failed`，结果丢失
- 复现：任务运行中重启 Node → 任务变 `failed`
- 修复建议：先向 Runtime 查询在跑任务；确认丢失后再标记失败
- 建议测试：Worker 存活时重启 Node，任务不被误杀

<a id="p2-7"></a>
#### P2-7 Supervisor 默认无独立 UID/文件系统隔离

- 位置：`toolbox-runtime/runtime.py`、Supervisor 启动参数、Docker 运行参数
- 触发：以默认容器权限启动 Supervisor 模式
- 根因：容器未授予 `CAP_SETUID`/`CAP_SETGID`，无法为子进程切换 UID
- 影响：插件间仍是同 UID，进程级沙箱不是安全边界；healthz 已如实报告 `uid_isolation=false`
- 复现：`supervisor` healthz 显示 `uid_isolation=false`
- 修复建议：补能力与 `no-new-privileges` 之外的 UID 切换配置；或明确文档化为“共享 Worker 模式”
- 建议测试：Supervisor healthz `uid_isolation=true`，`/proc` 可见不同 UID

<a id="p2-8"></a>
#### P2-8 共享 Worker 内插件可读他人文件与配置

- 位置：`toolbox-runtime/webserver/toolbox/storage.py`、共享 Worker 架构
- 触发：同进程加载多个插件
- 根因：同 UID、同卷，`config.json` 仅 `0600` 对同 UID 无效
- 影响：恶意插件可读取其他插件凭据（如 zlibrary `remix_userkey`）
- 复现：在共享 Worker 内以另一插件身份读取 `/toolbox/data/zlibrary/config.json`
- 修复建议：启用独立 UID + 每插件目录权限；或在文档中把“仅运行审查过的插件”提升为强制前置条件
- 建议测试：跨插件读取返回 `EACCES`

### P3

<a id="p3-1"></a>
#### P3-1 软删除 Artifact 不删除磁盘文件，无 GC

- 位置：[artifacts.js](file:///c:/littleBIngbing/mybooks-server/src/core/toolbox/artifacts.js)
- 触发：`DELETE /internal/toolbox/artifacts/:id`
- 根因：只改状态，不删文件
- 影响：磁盘长期增长
- 复现：删除后文件仍在 `data/<tool_id>/`
- 修复建议：延迟 GC（按 TTL）或提供显式清理任务
- 建议测试：GC 后文件消失，登记为 `deleted`

<a id="p3-2"></a>
#### P3-2 发布校验与哈希/读取之间存在 TOCTOU

- 位置：[artifacts.js](file:///c:/littleBIngbing/mybooks-server/src/core/toolbox/artifacts.js)
- 触发：插件在校验后替换文件
- 根因：`realpath`/`stat`/`sha256` 分步执行
- 影响：理论上可让登记信息与真实文件不一致
- 复现：并发替换目标文件
- 修复建议：打开文件句柄后基于 fd 计算哈希与大小
- 建议测试：并发替换场景下 hash 与内容一致

<a id="p3-3"></a>
#### P3-3 重复发布生成多条 Artifact 记录

- 位置：[artifacts.js](file:///c:/littleBIngbing/mybooks-server/src/core/toolbox/artifacts.js)
- 触发：同一文件多次 `publish`
- 根因：无 `(tool_id, sha256, path)` 去重
- 影响：结果列表与实际产物膨胀
- 修复建议：按 SHA + 逻辑名去重或返回既有记录
- 建议测试：重复发布返回同一 `artifact_id`

<a id="p3-4"></a>
#### P3-4 books/metadata 输入校验偏宽松

- 位置：[library.js](file:///c:/littleBIngbing/mybooks-server/src/core/toolbox/library.js)、`src/core/toolbox/import.js`
- 触发：传入非数组 `authors`、非法 ISBN
- 影响：字段被宽松归一化，可能写入非预期格式
- 修复建议：统一走 `contract.py` 同源校验向量
- 建议测试：非法输入返回 `VALIDATION`

<a id="p3-5"></a>
#### P3-5 zlibrary `entry_url` 保存时未校验

- 位置：`zlibrary-0.1.1/backend/tool.py`（`_normalize_entry`/`save_config`）
- 触发：保存 `http://127.0.0.1:8080/`
- 根因：保存路径只做字符串归一化，未调用 `zlib_client._validate_url`
- 影响：非法/私网入口可写入配置，使用期才报 `dns.private`（未发起请求，无 SSRF）
- 复现：`POST config` 返回 200 且回显 `http://127.0.0.1:8080/`；`GET health` 返回 `err=dns.private`
- 修复建议：保存时复用 `_validate_url`，失败直接返回 `params.invalid`
- 建议测试：保存私网入口返回错误且原配置不变

<a id="p3-6"></a>
#### P3-6 zlibrary 下载跳转与系统 DNS 分支的残余风险

- 位置：`zlibrary-0.1.1/backend/zlib_client.py`
- 触发：`/dl/` 返回 302 到其他公网域；或系统 DNS 模式下的域名重绑定
- 根因：重定向只校验 scheme/凭据/公网 IP 字面量，不限制 origin；系统 DNS 分支未固定解析结果
- 影响：理论上可从非入口域下载内容（仍限制为公网 HTTPS），或命中重绑定后的私网地址
- 修复建议：下载重定向限定同 origin；统一走 DoH 并固定 IP
- 建议测试：重定向到其他域被拒绝

---

## 12. 未验证项

| 项目 | 原因 |
| --- | --- |
| zlibrary 自动化环境下的搜索/登录/下载 | 自动化环境 `zlib.ch` TCP 被阻断；用户已在原生环境手工验证搜索→下载→入库成功，登录/号池轮换未单独覆盖 |
| zlibrary 号池轮换、配额更新、挑战页真实交互 | 同上，需要可达站点与真实账号 |
| 浏览器内真实渲染与交互 | 本轮以 HTTP + CSP + `vm` 逻辑验证代替，未做肉眼渲染核对 |
| 独立 UID 子进程隔离 | 当前容器缺 `CAP_SETUID`，`uid_isolation=false` |
| `zlibrary` 商店审查 allowlist | 未修改 allowlist；0.1.1 仍为未审查状态 |

---

## 13. 是否可进入 Phase 4C

> 历史结论（4B-V）：**否（BLOCKED）**。两个 P1 已在 4B-R 修复，最新结论见 §15.7（CONDITIONAL PASS）。

必须先完成：

1. 修复 P1-1：SDK 参数形态归一化 + 与 `SDK-SPEC` 对齐 + 契约测试向量。
2. 修复 P1-2：`compat.py` 导入路径修正 + 失败显式化 + 镜像内冒烟测试。

建议在进入 4C 前同时处理：P2-1、P2-2（任务状态机）、P2-3（卸载 reload）、P2-5（trust 判定），并将 P2-4/P2-6/P2-7/P2-8 写入部署与安全文档。

P3 可留待 4C/后续迭代，但 P3-5、P3-6 建议随手修（改动小）。

---

## 14. 测试环境与清理

- 临时脚本与数据均在仓库外：`%TEMP%\mybooks-4bv\`（隔离验证脚本、归档）与已删除的 `%TEMP%\mybooks-4bv-zl\`（容器数据卷）。
- 容器 `mybooks-4bv-zlnode`、`mybooks-4bv-zlrt` 与网络 `mybooks-4bv-zlnet` 已删除；镜像 `mybooks-4bv-node`、`mybooks-toolbox-runtime:4bv` 保留以便复现。
- `git status --short` 无输出；`HEAD` 与 `origin/codex/plugin-platform` 均为 `0eb76dcc19ef6e22d31cd7e1a8adf65f7ffca035`。
- 未修改业务代码、allowlist、SSRF 配置；zlibrary 安装仅在隔离容器内通过 `MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=true` 临时放行，并已随容器销毁。

---

## 15. Phase 4B-R 修复与重新验收（2026-11-10）

> 本轮**修改业务代码**（这是 4B-R 的授权范围），未提交、未推送。
> 基线仍为 `0eb76dcc19ef6e22d31cd7e1a8adf65f7ffca035`。

### 15.1 修改文件

| 文件 | 修改内容 |
| --- | --- |
| `plugin-sdk/python/mybooks_plugin_sdk/contract.py` | 新增 dict 参数归一化（白名单/等价字段/必填校验）、任务状态与进度校验 |
| `plugin-sdk/python/mybooks_plugin_sdk/books.py` | search/get/update/reading_status 支持 dict 与位置参数 |
| `plugin-sdk/python/mybooks_plugin_sdk/files.py` | publish/import_file/metadata/delete 支持 dict；相对路径按插件数据目录解析 |
| `plugin-sdk/python/mybooks_plugin_sdk/jobs.py` | create/get/progress(读/写)/complete(status)/cancel/message 统一契约 |
| `plugin-sdk/python/mybooks_plugin_sdk/metadata.py` | query/isbn dict 二选一，拒绝空查询 |
| `plugin-sdk/python/mybooks_plugin_sdk/errors.py` | 补充 `PLUGIN_ARGUMENT_INVALID`、`TASK_PROGRESS_INVALID`、`TASK_ALREADY_FINISHED` 等错误码 |
| `plugin-sdk/python/mybooks_plugin_sdk/compat.py` | 真实包路径 `webserver.toolbox.*`、复用 `sdk_for` 缓存、失败保留原因 |
| `toolbox-runtime/webserver/toolbox/node_client.py` | `update_task` 返回 task（与其他方法一致） |
| `toolbox-runtime/runtime.py` | healthz 增加 `toolbox_dir`/`data_dir`/`isolation_mode`/`isolated` |
| `toolbox-runtime/webserver/supervisor.py` | isolation_status 增加 `mode`（process/uid） |
| `src/http/routes.toolbox.internal.js` | 终态任务禁改 + 进度 0..100 单调校验 |
| `src/http/routes.toolbox.js` | `/api/toolbox/runtime` 增加路径自检与共享 Worker 风险报告 |
| `src/db/toolbox.js` | `recoverRunningTasks` 支持 createdBefore/excludeToolIds/staleBefore |
| `server.js` | 启动恢复按 Runtime 在线状态与插件加载情况区分；路径不一致与未审查插件告警 |
| `src/core/toolbox/descriptor.js` | 已审查判定优先于来源：本地安装的已审查包 → `reviewed` |
| `src/core/toolbox/installer.js` | 卸载后触发 Worker 重载 |
| `src/core/toolbox/runtime.js` | `runtimePathStatus()` 路径自检 |

### 15.2 两个 P1 的根因与修复

**P1-1 SDK 契约不一致**

- 根因：方法直接把第一个参数 `str()`，dict 被当成查询串/路径；`jobs.progress` 只有只读签名；`jobs.complete` 没有 `status`。
- 修复：`contract.py` 增加 `normalize_*_args`，统一“dict 或位置参数 → 规范化字段”：
  - 未知字段/缺失必填 → `PluginError(PLUGIN_ARGUMENT_INVALID)`；
  - dict 不再隐式 `str()`；
  - `progress(job_id)` 读、`progress(job_id, value)` 写；越界 `TASK_PROGRESS_INVALID`；
  - `complete` 只接受 `completed/failed/cancelled`，`done → completed`，`error=` 派生 `failed`；未知状态 `TASK_STATUS_INVALID`；
  - `import_file` 相对路径按 `storage.tool_root(tool_id)` 解析（与宿主绝对路径要求对齐）。
- 验证：新增 [test_contract_dict.py](file:///c:/littleBIngbing/mybooks-server/plugin-sdk/python/tests/test_contract_dict.py) 22 项，覆盖两个文档示例、旧位置参数、非法字段、缺参、错误码传播、相对路径。

**P1-2 `compat.from_tool` 在真实镜像不可用**

- 根因：`from toolbox.node_client import NodeClient`，镜像内包路径只有 `webserver.toolbox.*`；storage 导入失败被 `except ImportError` 静默吞掉，导致配置能力悄悄缺失。
- 修复：按 `webserver.toolbox` → `toolbox` 顺序导入；全部失败抛 `CompatSetupError` 并 `raise ... from ImportError` 保留原因；默认复用 `webserver.toolbox.sdk.sdk_for(tool)`，与 `CoreAPI.sdk` 同实例；不再静默禁用 storage。
- 验证：新增 [test_compat_runtime.py](file:///c:/littleBIngbing/mybooks-server/toolbox-runtime/tests/test_compat_runtime.py) 7 项；镜像内实测 `compat-ok 1.0.0 container_fixture`。

### 15.3 八个 P2 的逐项处理

| 编号 | 处理 | 结果 |
| --- | --- | --- |
| P2-1 终态任务仍可 PATCH | 终态任务一律 `TASK_ALREADY_FINISHED`（409）；仅 running → 终态 | 已修复，HTTP 回归通过 |
| P2-2 进度可倒退 | 宿主拒绝回退（409 `TASK_PROGRESS_REGRESSION`），越界 400；相同值幂等 | 已修复，HTTP 回归通过 |
| P2-3 卸载后 Worker 未重载 | 卸载成功后触发 `reloadRuntime`；响应 `runtime.reloading=true`；Node 侧记录先删，路由立即 404 | 已修复（运行时离线时不影响卸载结果） |
| P2-4 本地已审查包误判 | `trustOf` 先按 allowlist+SHA 判 reviewed，再判断来源；真实安装 md_to_epub 显示 `reviewed=true` | 已修复并实测 |
| P2-5 `/toolbox` 路径不一致 | Runtime healthz 上报 `toolbox_dir`；Node 启动与 `/api/toolbox/runtime` 报告 `toolbox_path.mismatch`，不一致时打印明确错误 | 已修复（只报告不阻断） |
| P2-6 启动误标 running 失败 | Runtime 离线才全量回收；在线时保留已加载插件的任务，仅回收未加载/超 6 小时无进展任务；只处理启动前创建的任务 | 已修复，单测覆盖三种分支 |
| P2-7 未启用独立 UID | 不默认启用；healthz 输出 `isolation_mode=shared/process/uid` 与 `missing_capabilities`；文档明确各模式能力 | 如实报告，未夸大 |
| P2-8 共享 Worker 跨插件读文件 | 认定为部署限制：`/api/toolbox/runtime.isolation.risk=high`（共享 + 未审查），启动打印告警；要求生产只装已审查插件或启用隔离 | 明确风险与限制，未声称已隔离 |

### 15.4 P3 安全复评（zlibrary）

- **P3-5 `entry_url` 保存未校验**：未发起请求，使用期仍会拒绝私网（`dns.private`），不构成 SSRF；但会写入非法配置。**维持 P3**，作为 zlibrary 上架前修复项。
- **P3-6 下载重定向不限 origin / 系统 DNS 未固定**：存在“上游镜像被控制 → 302 到内网”的理论 SSRF 面；插件本身已具备公网请求能力，风险取决于部署网络与镜像可信度。**提升为 P2（仅针对 zlibrary 0.1.1 上架）**：加入 allowlist 前必须上游修复（同 origin + 固定 DoH IP）。
- 结论：两项都不影响 Phase 4B 的 SDK/宿主验收，但 zlibrary 0.1.1 **不能**在修复前进入已审查 allowlist。

### 15.5 新增回归测试

| 测试 | 数量 | 覆盖 |
| --- | --- | --- |
| `plugin-sdk/python/tests/test_contract_dict.py` | 22 | 两个 P1 的文档示例、旧参数、非法字段、任务状态/进度、相对路径、错误码 |
| `toolbox-runtime/tests/test_compat_runtime.py` | 7 | 真实包路径、`sdk_for` 一致性、`CoreAPI.sdk` 一致性、失败保留原因 |
| `test/plugins-4br-unit.test.js` | 6 | 本地已审查包 trust、任务恢复三分支、路径自检、卸载重载 |
| `test/plugins-4br-http.test.js` | 1 | 终态禁改、进度回退/越界、完成态查询 |

### 15.6 实际执行结果

| 项目 | 结果 |
| --- | --- |
| `npm test` | **807/807 pass**，0 fail / 0 skip |
| `python -m unittest discover -s plugin-sdk/python/tests` | **35/35 pass** |
| `python -m unittest discover -s toolbox-runtime/tests` | **73 tests OK**（10 skipped，环境相关） |
| 其中 `test_sdk.py` / `test_compat_runtime.py` | 4/4、7/7 通过 |
| `npm run sdk:sync` | 成功（`toolbox-runtime/sdk` 为生成目录，gitignored） |
| Docker 镜像 `mybooks-toolbox-runtime:4br` | 构建成功；容器内 `compat.from_tool` 无 `ModuleNotFoundError`，dict 调用参数正确；healthz 返回 `toolbox_dir=/toolbox`、`isolation_mode=shared` |
| 真实宿主链路（Python SDK → Node → SQLite/文件） | 通过：books.create/search、jobs.create、progress=42 落库、publish artifact、metadata 不含路径、import、`complete(status="done")→completed`、result 含书籍与 Artifact、终态再更新 409 |
| md_to_epub 1.1.0（真实包，SHA 命中 allowlist） | 通过：本地安装显示 `reviewed=true`；UI 200；转换成功（1 章）；EPUB 下载 2091 字节且 `PK` 头；入库 `book_id=1` |
| zlibrary 0.1.1（真实包） | 加载成功、UI 200、路径自检一致；外网仍被环境阻断，未做真实下载 |
| Legacy BaseTool | md_to_epub（Legacy）完整转换成功，未回归 |

测试使用仓库外临时目录：`%TEMP%\mybooks-4br\`（已清理）。

### 15.7 最终结论

**CONDITIONAL PASS。**

- P0=0，P1=0（两个 P1 已修复并有独立回归）；P2 已修复 6 项，2 项（P2-7/P2-8）转为明确的部署条件与运行时风险提示；P3 余 4 项留待 4C。
- **可以开始 Phase 4C**，但必须附带以下条件：
  1. 生产环境不安装未审查插件；如必须运行，启用 `TOOLBOX_ISOLATE_PLUGINS=1` + `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true`，并尽量启用独立 UID。
  2. zlibrary 0.1.1 加入 allowlist 前，上游必须修复 P3-5（保存时校验 URL）与 P3-6（下载重定向同 origin + DoH 固定 IP）。
  3. `Plugin`/`route` 装饰器、Bridge v2、4D UI Slot 仍未实现，4C 不得按已实现消费。
- Git：工作区包含本轮修复（未提交、未推送），`HEAD` 仍为 `0eb76dcc19ef6e22d31cd7e1a8adf65f7ffca035`。
