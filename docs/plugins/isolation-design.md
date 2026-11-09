# 插件运行时隔离设计（Phase 3g 实现版）

> 2026-11-09 · 分支 `codex/plugin-platform`
> 目标：在不破坏现有 Docker Compose、Toolbox API、Bridge、安装包与数据库的前提下，
> 把「插件与宿主同信任域」收敛到「插件凭据可验证 + 数据目录受限」。
> 本文区分【已落地】与【未落地】；未落地部分不得在 STATUS 记为完成。

## 1. 威胁模型

插件代码默认不可信。需要防的不是“插件功能错误”，而是：

1. 读取宿主凭据（`internal-secret`、`runtime-secret`、其他插件身份令牌、配置密钥）。
2. 冒充其他插件调用宿主内部接口（越权读写书库/任务/导入）。
3. 通过共享可写目录篡改其他插件或宿主元数据。
4. 通过 `legacy-compat` 无身份路径绕过单插件授权。
5. 逃逸到宿主文件系统或进程（容器边界之外的提权）。

## 2. 当前边界（事实）

| 维度 | 默认部署（Legacy） | 隔离推荐部署 | 证据 |
| --- | --- | --- | --- |
| 容器用户 | `toolbox-runtime` / `my-books` 均为 1000:1000 | `TOOLBOX_RUNTIME_USER=0:0` + 各插件独立 UID | Docker 实测子进程 uid 2077 / 2015 |
| 插件进程 | 共享 Worker（同进程加载全部插件） | `TOOLBOX_ISOLATE_PLUGINS=1`，每插件一个子进程 | `/healthz` `children` |
| 内部接口凭据 | 共享 `internal-secret`（旧 Worker 兼容） | 每插件令牌；`MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true` 时只认令牌 | Node 令牌认证 + `plugins-internal-auth.test.js` |
| 身份文件 | 与插件同 UID，可读 `identities.json` | 0600 且属主为宿主运行 UID；子进程只拿环境令牌 | uid 2077 读取被拒 |
| 数据目录 | `data/<tool>` 共享可写 | `data/<tool>` 0711、`work/*` 0755、`config.json` 0600 | Docker `ls -ld` |
| 配置密钥 | 由 Worker 自动生成 | supervisor 生成 `state/config.key`（0600）并注入 | `MYBOOKS_TOOLBOX_DATA_KEY` |
| 网络 | 共享容器网络 | 仍共享（无出口限制） | 未解决 |

## 3. A：每插件令牌成为内部接口凭据【已落地】

Node（`src/http/routes.toolbox.internal.js`）：

- `requireInternal` 顺序：策略损坏 403 → 读身份头（出现即必须有效）→
  无身份且 `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true` 则 403 `PLUGIN_IDENTITY_REQUIRED` →
  否则校验共享密钥 → 停用插件 403 `TOOL_DISABLED` → `resolveAccess` →
  隔离模式下非 `strict` 403 `PLUGIN_GRANTS_REQUIRED`。
- 有效插件身份可省略共享 `internal-secret`；身份错误时**不会**回退密钥路径。
- `access-policy.js` 新增 `ENV_PLUGIN_AUTH_ONLY` / `pluginAuthOnlyEnabled()`，
  `modeNotice()` 在启动日志标明当前是 Legacy 兼容还是只认令牌。

Python（`toolbox-runtime/webserver/toolbox/`）：

- `config.plugin_auth_only()` 读取同名环境变量。
- `node_client.py`：隔离模式只发送 `X-Mybooks-Plugin-Id` + `X-Mybooks-Plugin-Token`，
  不读取也不发送宿主的 `internal-secret`；缺 ID/令牌时抛
  `PLUGIN_IDENTITY_MISSING`（403），身份文件不可用时抛 `PLUGIN_IDENTITY_UNAVAILABLE`。
- `identity.py`：环境令牌优先，且必须与 `MYBOOKS_PLUGIN_ID` 匹配；文件存在但结构非法或
  缺条目时拒绝降级。

验证：

- Node：`test/plugins-internal-auth.test.js`（匿名/仅共享密钥/错误令牌/缺令牌/无 grants/停用插件）。
- Docker：共享密钥 200（默认）→ `PLUGIN_AUTH_ONLY=true` 后 403；令牌 + grants 200；
  收窄 scope 后列表 403、单书 200、他书 403；身份冒用与 body `tool_id` 不一致 403。

## 4. B：Legacy 与 Strict 的显式区分【已落地】

- 默认 `MYBOOKS_TOOLBOX_LEGACY_COMPAT=true` + `PLUGIN_AUTH_ONLY=false`，旧 Worker 继续可用。
- 隔离部署建议同时设置：
  - `TOOLBOX_ISOLATE_PLUGINS=1`
  - `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true`（Node 与 Python 同名变量）
  - `MYBOOKS_TOOLBOX_LEGACY_COMPAT=false`
  - `grants.json` 为每个插件显式授权（否则 403 `PLUGIN_GRANTS_REQUIRED`）
- 不做自动联动：Compose 无法按条件关联变量，避免“以为开了隔离其实还在兼容”。
  启动日志（`modeNotice`）会打印当前模式，便于部署核对。

## 5. C：独立 UID + 私有数据目录【已落地，opt-in】

启动：

```bash
TOOLBOX_ISOLATE_PLUGINS=1 \
TOOLBOX_RUNTIME_USER=0:0 \
TOOLBOX_CHILD_UID_BASE=2000 \
docker compose up -d
```

映射与降权：

- UID = `TOOLBOX_CHILD_UID_BASE + sha256(tool_id) % 200`（稳定，不随启动顺序变化）。
- 容器以 root 启动后，supervisor 通过 `preexec_fn` 执行 `setgid`/`setuid`。
- 容器需要 `SETUID`、`SETGID`、`CHOWN`、`DAC_OVERRIDE`、`KILL`（compose 已声明，
  仅 root 启动时真正生效）：
  - `SETUID/SETGID`：降权；
  - `CHOWN`：把 `data/<tool>` 交给插件 UID；
  - `DAC_OVERRIDE`：读取 0600 的 `state/identities.json`/`config.key`；
  - `KILL`：向不同 UID 的子进程发送 SIGTERM/SIGKILL（reload/停止/空闲淘汰）。
- 缺失上述能力时：终止失败只记日志、不关闭仍被采集线程读取的管道，避免卡死 supervisor；
  但该部署应视为配置错误。

数据布局：

```text
/toolbox/data/<tool_id>/           0711  属主=插件 UID（宿主 Node 可穿透、不可列举）
/toolbox/data/<tool_id>/<work>/    0755  转换/下载产物，供宿主导入
/toolbox/data/<tool_id>/config.json 0600 加密配置（插件私有）
/toolbox/state/config.key           0600 属主=state 目录属主（旧 Worker 可读，插件不可读）
/toolbox/state/identities.json      0600 插件不可读；令牌由 supervisor 注入
/toolbox/state/internal-secret      0600 插件不可读
```

为什么不是全 0700：现有安装/下载/入库流程由 Node（uid 1000）读取插件产物文件。
0700 会导致入库报“插件文件不存在”。0711 + 产物 0755 保留功能，同时不让插件列举其他插件目录；
代价是已知路径的 `work/` 产物可被同容器其他插件读取（见第 8 节）。

配置密钥：

- 子进程以独立 UID 无法在 `state/` 创建 `config.key`，且 `storage` 缺密钥时会生成随机密钥，
  导致多进程配置互相解不开。
- supervisor 首启生成 `state/config.key`（0600，属主为 state 目录属主），
  通过 `MYBOOKS_TOOLBOX_DATA_KEY` 注入所有子进程，保证重启/多插件复用同一密钥。

## 6. D：每插件独立容器【未落地】

- 由编排层按 manifest 创建短生命周期容器，网络仅允许回宿主内部接口，根文件系统只读，
  按插件设置 CPU/内存/网络配额。
- 需要 Runtime Manager 从“进程适配器”升级为“编排适配器”，并定义镜像、卷、网络与凭据契约。
- 属于后续 Phase，不在 Phase 3g 范围。

## 7. 迁移与回滚

启用（回滚点：去掉三个环境变量即可）：

1. 先设 `MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY=true`（不启用独立 UID），观察 403 日志并补齐 `grants.json`。
2. 再设 `TOOLBOX_ISOLATE_PLUGINS=1`，确认 `/healthz.children` 与插件路由正常。
3. 最后设 `TOOLBOX_RUNTIME_USER=0:0` + `TOOLBOX_CHILD_UID_BASE=2000`，确认子进程 UID 与权限。

回滚：

```bash
docker compose down
docker run --rm -u 0 -v mybooks-server_toolbox-data:/toolbox \
  sh -c 'chown -R 1000:1000 /toolbox/data /toolbox/state/config.key'
docker compose up -d      # 去掉 PLUGIN_AUTH_ONLY / CHILD_UID_BASE / RUNTIME_USER
```

- 数据文件本身不迁移、不删除；回滚只调整属主。
- 回滚后已加密的 `config.json` 仍可解密（同一个 `config.key`），已在 Docker 中验证。

## 8. 仍然存在的风险

1. **网络不受限**：插件仍可访问任意外网/内网地址；SSRF 防护在宿主侧，不覆盖插件自身请求。
2. **同容器进程隔离有限**：不同 UID 的插件无法读其他插件 `config.json`/身份文件，
   但可穿透已知路径读取其他插件 `work/` 产物；也能耗尽共享 CPU/内存/磁盘。
3. **Legacy 模式仍是共享信任域**：默认部署未启用独立 UID 时，上述结论都不成立。
4. **每插件令牌的强度**：令牌 48 hex 存储在 `identities.json`；启用独立 UID 后才对插件保密。
5. **root 启动**：`TOOLBOX_RUNTIME_USER=0:0` 扩大容器内攻击面；能力集已收窄到 5 项，
   但仍是比 1000:1000 更大的信任面，必须配合只读根文件系统与 `no-new-privileges`。

## 9. 验收对照

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 有效插件令牌可在不带共享密钥时调用内部接口 | ✅ | Node 测试 + Docker 200 |
| 共享密钥在 `PLUGIN_AUTH_ONLY=true` 时被拒 | ✅ | Docker 403 `PLUGIN_IDENTITY_REQUIRED` |
| 错误令牌/未知插件/停用插件/无授权插件不回退 Legacy | ✅ | Node 测试 + Docker 403 |
| Python 隔离模式不读取宿主共享密钥 | ✅ | 单元测试（`NodeClientAuthOnlyTests`） |
| 插件子进程读不到 `internal-secret`/`identities.json` | ✅ | Docker uid 2077 Permission denied |
| 插件私有 `config.json` 0600，产物可供宿主导入 | ✅ | Docker `ls -ld` + md_to_epub 入库 `book_id=1` |
| 进程重启后按需恢复 | ✅ | `docker compose restart toolbox-runtime` 后路由 200 |
| 插件无法访问宿主任意文件/网络出站限制 | ❌ | 需方案 D / 容器级网络策略 |
| 其他插件的 `work/` 产物不可读 | ❌ | 0711+0755 折衷，已知路径可读 |
