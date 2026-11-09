# 插件运行时隔离设计（Phase 3f 增量）

> 2026-11-09 · 分支 `codex/plugin-platform`
> 目标：在不破坏现有 Docker Compose、Toolbox API、Bridge 与安装格式的前提下，
> 逐步把「插件与宿主同信任域」收敛到「可运行不可信插件」。
> 本文区分【已落地】与【方案/未落地】，未落地部分不得在 STATUS 中记为完成。

## 1. 威胁模型

插件代码默认不可信。需要防的不是“插件功能错误”，而是：

1. 读取宿主凭据（`internal-secret`、`runtime-secret`、其他插件身份令牌）。
2. 冒充其他插件调用宿主内部接口（越权读写书库/任务/导入）。
3. 通过共享可写目录篡改其他插件或宿主元数据。
4. 通过 `legacy-compat` 无身份路径绕过单插件授权。
5. 逃逸到宿主文件系统或进程（容器边界之外的提权）。

## 2. 当前边界（事实）

| 维度 | 现状 | 风险 |
| --- | --- | --- |
| 容器用户 | `toolbox-runtime` 与 `my-books` 均为 UID/GID 1000 | 进程间文件权限无意义 |
| 数据卷 | 两个服务共享命名卷 `toolbox-data:/toolbox` | `read_only: true` 只保护镜像层，不保护命名卷 |
| 凭据文件 | `state/internal-secret`、`state/runtime-secret`、`state/identities.json`（0600） | 同 UID 下插件可直接读取全部令牌 |
| 插件进程 | 默认共享 Worker；`TOOLBOX_ISOLATE_PLUGINS=1` 时每插件一个子进程 | 子进程隔离解决故障/资源，但不是恶意代码沙箱 |
| Legacy 路径 | 无身份头 + `MYBOOKS_TOOLBOX_LEGACY_COMPAT` 默认开启 | 旧 Worker 不受单插件 `grants.json` 约束 |

## 3. 本轮已落地（有测试）

1. **每子进程独立 runtime-secret**
   - `supervisor.py` 为每个子进程生成 `secrets.token_hex(24)`，通过
     `MYBOOKS_TOOLBOX_RUNTIME_SECRET` 注入；代理时把 Node 发来的宿主密钥重写为该子进程密钥。
   - 子进程即使拿到自己的密钥，也无法调用 supervisor 的 `/internal/reload|start|stop`
     （这些接口只认宿主密钥）。
2. **子进程环境裁剪**
   - 从子进程环境移除 `MYBOOKS_TOOLBOX_INTERNAL_SECRET`；子进程不会再从环境变量直接拿到宿主内部密钥。
3. **身份令牌按进程下发**
   - supervisor 从 `state/identities.json` 读取该工具令牌，仅通过
     `MYBOOKS_PLUGIN_ID` + `MYBOOKS_PLUGIN_TOKEN` 注入给自己的子进程；
   - `identity.py` 优先使用环境令牌，且校验 `MYBOOKS_PLUGIN_ID` 与当前 `tool_id` 一致。
   - 这使子进程不必读取共享身份文件才能调用 Node 内部接口。
4. **回归测试**
   - `test_runtime.py`：子进程密钥与宿主不同、代理头被重写、`internal-secret` 不在环境、
     令牌只注入对应插件、两个子进程密钥不同。

**仍存在（未解决）**：同一 UID 下插件仍可直接打开 `/toolbox/state/*` 读取宿主
`internal-secret`、`runtime-secret` 与 `identities.json`。因此本轮是“减少凭据暴露面”，
不是“凭据隔离”。

## 4. 方案阶梯与兼容性

### A. 内部接口改为每插件凭据（不换容器，中等改动）

- Node 内部路由在 `X-Mybooks-Plugin-Token` 有效且身份匹配时，允许省略共享
  `internal-secret`；旧 Worker 仍走原共享密钥路径。
- Python `NodeClient` 在隔离模式只发送插件令牌，不再读取 `state/internal-secret`。
- 兼容性：协议是增量字段，旧 Worker 不受影响；需要 Node 侧新增校验分支与回退开关
  `MYBOOKS_TOOLBOX_ALLOW_LEGACY_INTERNAL_SECRET=true`。
- 迁移：先灰度开启，观察 403 日志；回滚只需恢复开关。
- 未落地原因：需要同时改 Node 授权链与全部内部路由测试，属于独立 Phase。

### B. legacy-compat 与隔离模式互斥（低成本）

- `TOOLBOX_ISOLATE_PLUGINS=1` 时推荐设置 `MYBOOKS_TOOLBOX_LEGACY_COMPAT=false`；
  所有子进程请求必须携带每插件令牌。
- 兼容性：自己安装并启用隔离模式的上线可立即切换；旧部署保持默认 `true`。
- 未落地原因：Compose 无法按条件联动两个变量，需在部署文档/`setup` 脚本中显式设置。
- 建议：作为 Phase 4 入口门槛，而不是本轮强制默认值。

### C. 每插件独立 UID + 私有目录（强隔离，较大改动）

- `toolbox-runtime` 以 root 启动，入口创建 UID 池（如 2000+index），supervisor 用
  `preexec_fn`/`setuid` 降权启动子进程；`chown` 插件安装目录与 `data/<tool_id>`。
- Node 仍为 1000，只读写 `state/` 与库数据；插件卷按目录 0700 隔离。
- Compose 兼容性：镜像需去掉 `USER 1000:1000` 或改为 entrypoint 降权；命名卷不变。
- 迁移：启动时扫描 `plugins/<id>` 与 `data/<id>` 并 chown；保留
  `TOOLBOX_CHILD_UID_BASE=0`（关闭）作为回滚开关。
- 风险：root 启动扩大攻击面；UID 池与镜像、卷权限耦合，必须在独立分支做完整回归。
- 结论：**本轮不实现**，需专门设计评审。

### D. 每插件独立容器（最强）

- 由编排层按 manifest 创建短生命周期容器，网络仅允许回宿主内部接口。
- 需要 Runtime Manager 从“进程适配器”升级为“编排适配器”，并定义镜像/资源/网络契约。
- 属于 Phase 5+，不在当前范围。

## 5. 推荐顺序

1. 现在：保持 A/B/C 不动，只累积可验证的凭据收窄（本轮已完成）。
2. Phase 3g：落地 A（每插件内部凭据），同时把 `legacy-compat` 作为显式部署开关。
3. Phase 4 前：落地 C（独立 UID + 私有目录），并在 Docker 中做越权回归。
4. Phase 5+：按需评估 D。

## 6. 验收标准（未来）

- 插件进程无法读取其他插件的令牌或宿主 `internal-secret`（文件级验证）。
- 无身份/错误身份/错误插件 ID 的内部调用统一 403，且不存在降级路径。
- 插件 A 无法通过文件系统改写插件 B 的安装目录或数据。
- 以上在 Docker 非 root、只读根文件系统、命名卷条件下可复现。
