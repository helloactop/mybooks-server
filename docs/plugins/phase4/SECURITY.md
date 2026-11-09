# Phase 4 安全设计

> 基线：Phase 3g.1（独立 UID 注册表、私有目录 2710/2750/0640、每插件令牌、严格认证）
> 原则：**独立 UID ≠ 恶意代码沙箱**；任何未实测的能力不得标记为已实现。

## 1. 资产与威胁模型

| 资产 | 泄露/破坏后果 | 现有保护 |
| --- | --- | --- |
| 书库数据库（SQLite） | 全量书籍/用户数据泄露 | 插件不直接访问；内部接口 + 权限 |
| 电子书文件 | 未授权读取/删除 | `/books-files` 需会话；插件只拿产物 |
| 宿主凭据（`internal-secret`、`config.key`） | 冒用内部接口、解密配置 | 0600 + 独立 UID 不可读 |
| 插件身份令牌（`identities.json`） | 冒充其他插件 | 0600 + 子进程仅注入本插件令牌 |
| 插件配置（cookie/API key） | 账号失窃 | AES-256-GCM + 私有目录 0600 |
| 插件产物（`work/`） | 跨插件读取/篡改 | 2750/0640 + 属组隔离 |
| 宿主 UI 会话 | 越权操作 | Cookie/Bearer + `requireSession` |
| 供应链（安装包/索引） | 恶意代码进入宿主 | SHA-256 + allowlist + 审查 |

威胁行为者：

1. **恶意第三方插件**：读取凭据、越权、耗尽资源、攻击同容器进程。
2. **被入侵的商店/索引**：投递篡改包或降级包。
3. **错误部署**：模式不一致、权限过大、回滚不彻底。
4. **宿主用户误操作**：安装未审查插件、过度授权。
5. **网络攻击者**：SSRF、DNS 重绑定、外部服务伪造。

## 2. 信任级别

| trust | 含义 | 可否默认运行 | 来源 |
| --- | --- | --- | --- |
| `official` | 官方维护、签名可验证 | 是（仍需权限授权） | 官方商店 + 官方公钥 |
| `reviewed` | 人工审查且 SHA-256 命中 allowlist | 是 | allowlist |
| `community` | 第三方发布、有签名/仓库但未审查 | 否（需 `ALLOW_UNREVIEWED=true`） | 第三方商店 |
| `unreviewed` | 无审查、无签名或哈希不匹配 | 否 | 本地/未知来源 |
| `local` | 开发者本地安装 | 否（默认） | 上传 ZIP |

- Manifest 不能声明自己的 `trust`。
- 更新后 trust 重新计算；权限新增或信任降级必须重新确认。
- 商店索引被篡改但 SHA-256 不匹配时拒绝安装（现有 `store.js` 行为）。

## 3. 权限体系

### 3.1 现有权限目录（`src/core/plugins/permissions.js`）

| 权限 | 资源型 | 用途 | 现状 |
| --- | --- | --- | --- |
| `books.read` | 是 | 查询书籍/详情 | ✅ |
| `books.write` | 是 | 创建/更新/导入 | ✅ |
| `books.delete` | 是 | 删除书籍 | ✅ |
| `metadata.read` | 否 | 搜索/ISBN | ✅ |
| `metadata.write` | 是 | 写回元数据 | ✅ |
| `files.read` | 是 | 读取/导出/下载 | ✅ |
| `files.write` | 是 | 上传/发布产物/导入 | ✅ |
| `network.public` | 否 | 访问公网 | ◐ 仅声明，运行时未强制 |
| `network.private` | 否 | 访问内网 | ◐ 仅声明，运行时未强制 |
| `jobs.create` | 否 | 创建任务 | ✅ |
| `settings.read` | 否 | 读取宿主设置 | ✅ |
| `ui.contribute` | 否 | 提供 UI 页面/Slot | ◐ 现有 iframe 未按此校验 |

### 3.2 Phase 4 新增（4A 版本化目录）

| 权限 | 资源型 | 用途 | 备注 |
| --- | --- | --- | --- |
| `jobs.read` | 否 | 查询本人任务状态 | 避免复用 `jobs.create` |
| `events.subscribe` | 否 | 订阅事件 | 仍需 Manifest 声明事件名 |
| `artifacts.publish` | 是 | 发布产物（可选拆分） | 若保留 `files.write` 可不新增 |

新增权限必须：

1. 写入版本化权限目录（`permission catalog v2`）；
2. 旧宿主遇到未知权限时拒绝该插件进入严格模式；
3. 在授权 UI 中展示 `reason` 与 scope；
4. 有对应后端强制点与测试。

### 3.3 授权生命周期

```text
Manifest 声明（permissions[]）
  → 安装/更新时计算差异
  → 用户确认（Web/Android 同一宿主授权）
  → 写入 grants.json（permission:scope 数组）
  → 运行时 GrantStore.require(permission, resource)
  → 撤销立即生效（内存与磁盘同步）
  → 审计记录（追加写）
```

- 撤销：删除 `grants.json` 条目后，下一次调用立即 403；不需要重启。
- 更新：新增权限不得自动继承旧授权；减少权限不自动回收（需用户确认或保持现状）。
- 敏感操作（删除书籍、写元数据、访问内网）可在 UI 增加二次确认；后端仍以权限为准。

### 3.4 权限示例

```json
{
  "version": 1,
  "tools": {
    "zlibrary": [
      "network.public",
      "books.read:library:all",
      "files.write:artifact:zlibrary:*",
      "jobs.create"
    ],
    "md_to_epub": [
      "files.write:artifact:md_to_epub:*",
      "books.write:library:all",
      "jobs.create"
    ]
  }
}
```

## 4. 安全能力现状矩阵

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 每插件身份令牌 | ✅ | 48-hex；`PLUGIN_AUTH_ONLY` 下只认令牌 |
| 错误令牌/未知/停用拒绝 | ✅ | 不回退共享密钥 |
| 共享密钥 Legacy | ◐ | 默认开启；需显式关闭才形成强边界 |
| grants + scope | ✅ | 资源型权限必须显式 resource |
| grants 损坏 fail-closed | ✅ | `broken` 全局拒绝 |
| 独立 UID 注册表 | ✅ | 持久化、无冲突、可回滚 |
| 私有目录权限 | ✅ | 2710/2750/0640，跨插件不可读 |
| 内存上限 | ✅ | `RLIMIT_AS` 实测生效 |
| 文件描述符上限 | ✅ | `ulimit -n 256` |
| 访问控制（Node/Python 模式一致） | ✅ | `runtime-mode.json` 校验 |
| sandbox iframe | ✅ | 无 `allow-same-origin`；CSP + nonce |
| Bridge 路由白名单 | ✅ | 只代理 manifest 声明路径 |
| SHA-256 + allowlist | ✅ | 商店与本地包 |
| 包签名 | ○ 4C | 定义 `publisher` 与 detached `manifest.sig`，未实现验签 |
| 权限审计日志 | ○ 4C/4B | 追加写 `state/audit.jsonl`，未实现 |
| 网络出口限制 | ⏳ 未来 | 插件可访问任意地址；`network.*` 未强制 |
| CPU/磁盘配额 | ⏳ 未来 | 仅 supervisor 容量 + `RLIMIT_AS` |
| 容器级隔离 | ⏳ 未来 | 方案 D，不承诺 Phase 4 |
| 插件间通信 | ⏳ 未来 | 当前无官方插件间 API；同容器仍可能影响彼此 |
| 升级安全（防降级/重放） | ◐ | 语义化版本比较；未阻止手动安装旧包 |
| UI 隔离（恶意 CSS/JS） | ◐ | iframe 不透明源；CSP 允许 `unsafe-inline` 样式 |

## 5. 关键风险与处置

| 风险 | 影响 | Phase 4 处置 | 残余风险 |
| --- | --- | --- | --- |
| 插件读取其他插件产物 | 数据泄露 | 已 2750/0640；不提供跨插件 API | 同容器 root/调试工具仍可读 |
| 插件访问内网/云元数据 | SSRF | 4C 增加出口策略设计；4D 展示权限 | 未实施网络策略 |
| 插件冒充其他插件 | 越权 | 每子进程令牌 + 身份头校验 | Legacy 共享 Worker 下无法阻止同进程冒用 |
| grants 配置错误 | 过度授权 | 授权 UI + 差异提示 + 审计 | 管理员误操作 |
| 商店投毒 | 恶意代码 | SHA-256 + allowlist + trust | 未签名包仍可能被允许 |
| 更新降级/回滚攻击 | 旧漏洞 | 版本比较 + 回滚审计 | 本地包可手动安装旧版 |
| UI 消息伪造 | 越权调用 | source/nonce/toolId/路由白名单 | 同源 XSS 仍可绕过 |
| root 容器逃逸 | 宿主被控 | 只读根、cap 收窄、no-new-privileges | 仍是 root 容器 |
| 依赖漏洞 | RCE/DoS | 4C 增加依赖扫描 | 现有 `undici`/`yauzl` 告警未处理 |

## 6. 安全审计（4C）

事件字段：

```json
{
  "ts": "2026-11-09T12:00:00Z",
  "event": "permission.denied",
  "plugin_id": "zlibrary",
  "user_id": 1,
  "permission": "books.write",
  "resource": "book:1",
  "route": "download",
  "code": "PERMISSION_DENIED"
}
```

- 只追加写 `state/audit.jsonl`，按天滚动，大小上限 + 脱敏。
- 必记：安装/更新/回滚/卸载、授权/撤销、权限拒绝、插件崩溃、隔离配置失败。
- 不记录：Cookie、令牌、配置明文、电子书内容。

## 7. 安全测试清单（4A–4F）

1. 未授权调用所有资源型能力 → 403，错误码稳定。
2. 错误/缺失令牌、停用插件、伪造 `tool_id` → 403。
3. grants 损坏/缺失快照 → fail-closed。
4. `PLUGIN_AUTH_ONLY` Node/Python 不一致 → 503 `runtime.mode`。
5. 无 root/缺 capability 启用独立 UID → 启动失败，不降级。
6. 跨插件读取 `config.json`/`work/` → 拒绝。
7. 路径穿越、符号链接、超大 body、错误 nonce → 拒绝。
8. 未审查包/哈希不匹配/降级包 → 拒绝安装。
9. 插件崩溃/超时/取消 → 任务失败，不留 running。
10. 更新新增权限 → 未重新授权前调用被拒。

## 8. 明确不承诺

- 不承诺“插件无法逃逸容器”。
- 不承诺“独立 UID = 沙箱”。
- 不承诺“声明权限 = 已授权”。
- 不承诺“SHA-256 校验 = 代码安全”。
- 不承诺 Phase 4 完成网络出口限制、CPU/磁盘配额或恶意代码隔离。
