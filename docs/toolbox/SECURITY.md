# 工具箱安全说明

工具代码属于**不可信服务器端代码**。当前实现提供的是“受控安装 + 独立非 root Worker +
API/文件边界”，不是针对任意恶意代码的强沙箱。

## 1. 默认信任策略

- 商店 ZIP 通过 SHA-256 只证明“下载完整”，**不证明代码可信**。
- 默认只把人工审查过的 `tool_id + revision + SHA-256` 列入 `allowlist.js` 才允许安装/运行。
- 商店中的其他工具仍展示，但标记“未审查”，安装按钮不可用。
- 如需测试其他已做兼容性审查的插件，管理员显式设置：

```bash
MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=true
```

  开启后 UI 明确显示“管理员已允许未审查插件；代码仍按不可信处理”。
- 禁用工具立即阻断 Node 网关和 `/get/tool` 资源；重新启用后仍需重启 Worker 才能加载代码。

## 2. 商店下载

- 仅 HTTPS；默认主机白名单 `mybooks.top`（可配置 `MYBOOKS_TOOLBOX_STORE_HOSTS`）。
- 禁止 URL 内嵌凭据、非 443 端口。
- 手动跟随最多 5 次重定向，每次重新校验 HTTPS/主机。
- 默认拒绝解析到私网/回环/链路本地/保留地址的域名（SSRF）。
- 部分内网 DNS/VPN 会把可信商店解析到 `198.18/15`；只有显式设置
  `MYBOOKS_TOOLBOX_ALLOW_PRIVATE_STORE=true` 才会对**白名单主机**放开解析检查；
  重定向到其他主机仍拒绝。
- 下载上限 50MB，Content-Length 与流式计数双重限制，超时 90s。
- SHA-256 不符、大小超限、网络中断都删除临时文件。

## 3. 安装包解压

- ZIP：yauzl 逐项校验绝对路径、`..`、反斜杠、NUL、点文件、符号链接、
  加密条目、条目数（2000）、单文件 100MB、总解压 200MB、压缩比 >200。
- 7z：先 `node-7z list` 校验全部成员路径/大小/压缩比/符号链接属性，再解压；
  解压后再次 walk 检查符号链接与路径边界。
- 不支持未知格式；7z 依赖 `7zip-bin` + `node-7z`。
- 所有解压先进入 `plugins/.staging-*`，校验 manifest 与 entry 文件后才原子移动。

## 4. 安装生命周期

- `installPrepared` 只写文件与 SQLite，不 import 第三方代码。
- 更新先移动旧目录到 `plugins/.previous/<id>`；DB/状态写失败会把旧目录移回。
- 回滚交换目录；卸载先移到 `.trash-*` 再删；DB 失败尽量恢复目录。
- `pending_restart` 记录磁盘状态与 Worker 加载状态不一致，UI 显示“待重启”。

## 5. 插件前端隔离

- iframe `sandbox="allow-scripts allow-modals allow-downloads"`，**没有**
  `allow-same-origin`；CSP 响应头再带 `sandbox`，即使直接打开也保持不透明源。
- 插件不能读父 DOM、Cookie、localStorage 或直接访问 `/api/*`。
- 资源只映射 `<plugin>/frontend/`，不暴露 backend、配置、密钥或其他插件。
- CSP 限制 `script/style/img/font/connect` 来源；外链图片只允许 HTTPS。
- 父页面 Bridge 只转发 manifest 声明的精确路由，方法限 GET/POST/PUT/PATCH/DELETE，
  非声明的 `/api/books`、`/api/auth`、`/api/admin` 一律不可达。
- 每次 iframe 加载生成随机 nonce，宿主同时校验 `event.source`、nonce、toolId；
  不把 `postMessage('*')` 或 `origin === "null"` 当作信任依据。
- `notify` 只显示文本；`download` 只允许当前工具声明路由；`open-book` 只接受正整数 id。
- FormData 传输拆成字符串/文件片段，父页面重建后发送；不把 Cookie/Token 交给 iframe。

## 6. Worker 隔离

- 独立 Python 3.12 容器；非 root（UID 1000）；不发布公网端口。
- 只挂载 `toolbox-data:/toolbox`；不挂载 `data/books.db`、`uploads`、
  `books-files`、Docker Socket。
- 根文件系统 `read_only: true`，`/tmp` tmpfs，`cap_drop: ALL`，
  `no-new-privileges`，内存/CPU/PID 限制。
- Worker 只接受带 `runtime-secret` 的内部请求；插件前端拿不到该密钥。
- Python → Node 使用独立 `internal-secret`；Node 内部接口只做导入/任务/元数据，
  不返回管理员 Token/Cookie。
- 账号等插件配置以 AES-256-GCM 整体加密落盘；密钥为 `state/config.key` 或
  `MYBOOKS_TOOLBOX_DATA_KEY`。任务/日志不输出配置正文。

## 7. 明确的安全限制

1. **同进程插件代码不是强沙箱**：所有启用的插件在同一个 Python 进程里 import。
   恶意插件可以读 `/toolbox` 共享卷、其他插件的前端/数据、进程内 Node 客户端密钥，
   甚至调用内部导入/元数据接口。当前安全边界依赖“只运行审查过的插件”。
2. 要运行任意商店插件，必须进一步做**按插件独立 Worker/容器**（每插件独立卷、
   独立密钥、独立网络出口），本项目尚未实现。
3. 没有 per-plugin 网络出口白名单；网络型插件可访问外网。
4. 没有对插件前端做代码审计；CSP/iframe 只限制浏览器侧越权。
5. 外链封面不读取，避免把任意 URL 变成服务端 SSRF；quality_check 会据此报告缺失。
6. 单 Worker 串行服务；一个插件死循环会拖住同服务队列（不同服务不同线程，
   但仍共享进程和 GIL/资源限制）。

## 8. 生产建议

- Nginx 额外拒绝 `/internal/` 公网访问；Node 只监听 `127.0.0.1`。
- 保持 `MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED=false`；逐个审查后再加入 allowlist。
- 把 `toolbox-data` 纳入备份；其中含加密配置、插件安装包和任务临时文件。
- 定期检查 Worker 日志和 `last_error`；加载失败不会自动执行未审查代码。
