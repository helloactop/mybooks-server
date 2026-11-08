# 工具箱测试记录

测试日期：2026-11-08/09。所有结果来自本机实际执行；未执行的项目明确标注。

## 1. Node

```bash
npm test
npm run check:public
```

结果：

- `npm test`：**609 passed / 0 failed**（包含 `test/toolbox.test.js` 9 项）。
- `npm run check:public`：通过；260 个文本文件检查，46 个二进制/大文件跳过。
- 覆盖：manifest、ZIP 路径穿越/符号链接/压缩炸弹/7z 拒绝、安装/更新/回滚/卸载、
  pending_restart、入库新建/同 SHA 去重/同格式冲突/标签/路径边界、任务中断恢复、
  商店标注。

## 2. Python 兼容层

```bash
cd toolbox-runtime
python -m unittest discover -s tests -v
```

结果：**9 passed**。覆盖配置 AES 加密、BackgroundService 镜像、AsyncService
同步/异步、BaseHandler 共享密钥/UUID 用户/管理员、PluginHost importlib + 路由表、
NodeClient 内部接口。

## 3. 插件自带测试

```bash
cd tool_zlibrary
python -m unittest discover -s tests -v
```

结果：**53 passed**（Z-Library manifest/package/挑战/DNS/EAPI/HTML/账号/下载 smoke）。

## 4. 真实商店与安装

在临时 `MYBOOKS_TOOLBOX_DIR` 上启动 Node（测试端口 13002），实际访问
`https://mybooks.top/toolbox/fulllist.json`：

- `zlibrary`（ZIP）、`md_to_epub`（ZIP）、`book_dedup`（7z）均下载、SHA-256
  校验、解压、写安装记录成功。
- 安装后三项 `pending_restart=true`。
- 启动独立 Python Worker 后调用 `POST /api/toolbox/runtime/restart`，
  三项加载报告 `loaded=true`，`pending_restart` 清 0。
- 关闭 zlibrary：API 返回 404、`/get/tool/zlibrary/index.html` 404；
  重新启用 + Worker restart 后 API 恢复 200。

本机 DNS 把 `mybooks.top` 解析到 `198.18.0.197`（代理/VPN 地址）；测试时显式
设置 `MYBOOKS_TOOLBOX_ALLOW_PRIVATE_STORE=true`。生产环境默认不放开此选项。

## 5. 八插件加载（Docker Python 3.12）

构建 `toolbox-runtime` 镜像后，挂载包含 8 个插件的共享卷启动：

```text
zlibrary        loaded
tags_cleaner    loaded
quality_check   loaded
md_to_epub      loaded
mbti_tester     loaded
epub_translator loaded
book_dedup      loaded
audiobook_srt   loaded
```

宿主 Python 3.15 venv 缺少 Pillow 的 cp315 wheel，quality_check 在宿主环境
`No module named 'PIL'`；Docker Python 3.12 镜像内通过 `Pillow 11.3.0` 正常加载。
这是本机测试环境差异，不是插件兼容性失败。

## 6. 三类插件真实验收

### A. 原 UI + 网络 + 异步任务（zlibrary）

- `/get/tool/zlibrary/index.html` 原文件加载；CSS/JS/locales 全部 200。
- Bridge 调 `config/accounts/progress` 返回原协议；设置面板读到 `tool-tag`。
- 原生 UI 主题切换（light→dark）和语言切换（zh→English）通过 postMessage 生效。
- 离线模拟下载（FakeClient 写 EPUB）→ 真实入库 book_id=1 → 标签 → 任务 completed。
- 真实健康检查：本机返回 `entry.unreachable`（未伪报成功）；用户 Ubuntu 环境
  此前已验证 EAPI 可用。真实公网搜索/下载未在本机完成。

### B. 文件上传/转换/临时下载（md_to_epub）

- 浏览器原生 UI 选择 `test.md` → Bridge FormData → Node multipart 网关 →
  Python `ConvertHandler`（`self.request.files`）→ `import_file`。
- 返回 `err=ok`、`book_id=4`、`download_url`。
- 通过 `GET /api/toolbox/tool/md_to_epub/download?...` 下载得到真实 EPUB
  （`file` 识别为 EPUB，`unzip -l` 含 mimetype/container/content.opf）。
- 依赖：markdown-it-py、mdit-py-plugins、lxml；Docker 镜像已安装。

### C. 后台任务 + 书库读写

- **book_dedup**：3 本书扫描 → 1 组；`merge_plan` 预览 PDF 并入 EPUB；
  `merge` 后目标书 `file_formats=EPUB, PDF`，来源书 API 404（软删除/回收站）。
- **tags_cleaner**：后台任务把 `http://example.com` 标签移除，任务 `completed`。
- **quality_check**（Docker）：`/checks` 返回检查定义；`scope=all` 对 3 本书
  完成体检，`/report` 返回 task_id、total_books=3、issues_total=0。
- **mbti_tester**：`/analyze` 返回 `book_count=3`。
- **epub_translator**：`/books?q=` 返回 EPUB 库中书；未配置 LLM，未发外部请求。
- **audiobook_srt**：Docker `/overview` 返回 env 未安装、无有声书；功能受限。

## 7. 未完成/未验证

- 真实 Z-Library 公网搜索、下载、账号额度刷新：本机网络不可达；未用 Mock 冒充成功。
- epub_translator 真实 LLM 翻译：未提供 API Key。
- audiobook_srt 真实转写：无有声书目录、未安装 faster-whisper 模型。
- Docker Compose 完整栈（Node + Worker + 数据库初始化）未在本机以生产规模跑通；
  `docker compose config` 通过，两个镜像构建成功。
- 移动端截图：未纳入本次自动化；桌面端已用 Chrome 实际打开 `/toolbox`、
  zlibrary 原生 UI、md_to_epub 原生 UI 检查。截图不写入仓库。
- 多插件同时运行的压力/内存测试未做。
