# 工具箱部署与回滚

## 1. Docker Compose

`compose.yaml` 新增 `toolbox-runtime`，与 `my-books` 通过内部网络通信：

- `my-books`：保持 Node/Express/SQLite；挂载 `mybooks-data:/data` 与
  `toolbox-data:/toolbox`；`MYBOOKS_TOOLBOX_DIR=/toolbox`、
  `MYBOOKS_TOOLBOX_RUNTIME_URL=http://toolbox-runtime:8765`。
- `toolbox-runtime`：Python 3.12-slim；`read_only`、`tmpfs /tmp`、非 root、
  `cap_drop ALL`、`no-new-privileges`、内存 1g / CPU 2 / PID 256；
  无公网端口；只挂载 `toolbox-data:/toolbox`。
- 健康检查：Node `/healthz`；Python `/healthz`。

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec my-books npm run setup
```

首次访问 `http://localhost:3000/login`。

## 2. 首次安装插件

1. 打开 `/toolbox`。
2. 商店只显示 `zlibrary` 等已审查项可安装；未审查项显示原因。
3. 点击安装（会下载、校验 SHA-256、解压、写安装记录）。
4. UI 显示“待重启”；点击“重启插件运行时”。
5. Worker reload 后 `pending_restart` 清 0；点击“打开”进入插件原生 UI。

安装/更新不在请求内执行 Python 代码；重启 Worker 不重启 Node 主服务。

## 3. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MYBOOKS_TOOLBOX_DIR` | `/toolbox`（容器）/ `<storage>/toolbox` | 插件/数据/状态根 |
| `MYBOOKS_TOOLBOX_RUNTIME_URL` | `http://127.0.0.1:8765` | Node → Worker |
| `MYBOOKS_NODE_INTERNAL_URL` | `http://127.0.0.1:3000` | Worker → Node |
| `MYBOOKS_TOOLBOX_RUNTIME_SECRET` | 自动生成 `state/runtime-secret` | Node → Worker |
| `MYBOOKS_TOOLBOX_INTERNAL_SECRET` | 自动生成 `state/internal-secret` | Worker → Node |
| `MYBOOKS_TOOLBOX_DATA_KEY` | 自动生成 `state/config.key` | 插件配置 AES 密钥（base64/64hex） |
| `MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED` | `false` | 允许安装未审查插件（不推荐生产） |
| `MYBOOKS_TOOLBOX_ALLOW_PRIVATE_STORE` | `false` | 允许可信商店域名解析到内网 |
| `MYBOOKS_AUDIO_DIR` | `/toolbox/data/audio` | audiobook_srt 扫描目录 |
| `TOOLBOX_RUNTIME_PORT` | `8765` | Worker 内部端口 |
| `TOOLBOX_MAX_BODY_BYTES` | `104857600` | 插件上传上限 |

密钥文件由 Node 启动时在共享卷生成；Node/Python 必须同时可读写 `state/`。

## 4. 更新

- 商店更新：`POST /api/toolbox/:id/update` 或 UI“更新”。
- 旧版本保留在 `plugins/.previous/<id>`；DB 记录 `previous_revision`。
- UI“回滚”调用 `POST /api/toolbox/:id/rollback`。
- 更新/回滚后均为“待重启”；重启 Worker 后生效。

## 5. 卸载

- UI/`DELETE /api/toolbox/:id` 默认保留 `data/<tool_id>`。
- `?purge_data=1` 同时删除插件私有数据。
- 卸载后 Node 立即拒绝 API/资源；Worker 在下次 reload 时移除路由。

## 6. 回滚/恢复

1. 单个插件：先用 UI“回滚”到 `.previous` 版本；再不行卸载并重装。
2. 全部插件：停止 Node，备份 `toolbox-data` 卷；需要时用备份卷恢复
   `plugins/` 与 `state/installed.json`。
3. 数据库：migration v26/v27 只新增 `toolbox_tools/toolbox_tasks` 与三列，
   不触碰书籍/同步表；回退版本可忽略这些表/列，旧代码不会读取它们。
4. 不要求为了安装/更新插件重启 Node；只有 Node 主程序升级才重启 Node。

## 7. 备份

```bash
docker run --rm -v mybooks-server_toolbox-data:/toolbox -v "$PWD":/backup \
  alpine tar czf /backup/toolbox-data.tgz -C /toolbox .
```

同时备份 `mybooks-data` 中的 `books.db`、`uploads/`、`books-files/`。
`toolbox-data` 含加密配置与插件代码，按敏感数据保管。

## 8. Nginx

建议显式拒绝内部接口和 Worker 端口：

```nginx
location /internal/ { return 404; }
```

Node 只绑定 `127.0.0.1:3000`；Worker 不映射宿主端口。
