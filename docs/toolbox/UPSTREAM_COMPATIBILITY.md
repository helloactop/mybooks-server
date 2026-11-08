# 上游源码映射与插件兼容矩阵

上游基线：PoxenStudio/MyBooks `develop` 分支（本地审计时 commit
`fdf982a`）。本文件只记录**实际实现和实测结果**，不把 Mock 结果写成真实网络成功。

## 1. 上游关键源码位置

| 上游文件 | 关键行为 | 本实现 |
| --- | --- | --- |
| `webserver/services/toolbox_store.py` | 仅 `mybooks.top` HTTPS、SHA-256、索引缓存 | `src/core/toolbox/store.js`；额外做 DNS 公网/重定向/大小检查 |
| `webserver/toolbox/toolbox_manager.py:121` `validate_manifest` | 必填字段、tool_id、semver、entry_backend | `src/core/toolbox/manifest.js` |
| `toolbox_manager.py:148` `_safe_extract` | ZIP 路径穿越 | `src/core/toolbox/zip.js`；ZIP + 7z，另查符号链接/压缩炸弹 |
| `toolbox_manager.py:213` `install_from_zip` | 解压→校验→落盘→记录，不 import | `installer.js`；增加 `.previous` 回滚与 DB 失败回滚 |
| `toolbox_manager.py:452` `load_all` | importlib、模块缓存、启用清单 | `webserver/toolbox/plugin_host.py:reload()` |
| `toolbox_manager.py:570` `collect_tool_routes` | manifest api_routes → Handler | `plugin_host.py` 路由表 + `runtime.py` dispatcher |
| `webserver/toolbox/base_tool.py:25` | 工作目录、任务、入库 | `webserver/toolbox/base_tool.py` |
| `webserver/toolbox/core_api.py:690` | `CalibreAPI/AppDBAPI/Tasks/Messages/Storage/Settings/Utils` | `webserver/toolbox/core_api.py` + `src/core/toolbox/library.js` |
| `webserver/services/async_service.py:332` `start_service` | 每服务一个线程+队列 | `async_service.py`；单 Worker |
| `async_service.py:385` `register_function` | 同步包装 | 同语义 |
| `async_service.py:397` `register_service` | 入队后返回 None | 同语义 |
| `webserver/handlers/base.py:208` `js` / `:299` `is_admin` | JSON 包装/管理员 | `webserver/handlers/base.py`；不泄露 traceback |
| `webserver/handlers/static_files.py:554` | `/get/tool/{id}/icon|index.html|assets` | `src/http/routes.toolbox.ui.js` |
| `app/public/static/toolbox-bridge.js` | toolId/theme/locale/fetch/notify/onChange/resize | `public/static/toolbox-bridge.js`；不透明源 + nonce RPC |
| `app/src/pages/toolbox/_id.vue` | iframe 承载、主题语言 postMessage、resize | `public/toolbox-tool.html` + `page-toolbox-tool.js` |
| `app/src/pages/admin/toolbox.vue` | 商店/安装/启停/更新/重启提示 | `public/toolbox.html` + `page-toolbox.js` |
| `webserver/models.py:1011` `InstalledTool` | type/source/revision/enabled/time | `toolbox_tools`（migration v26/v27） |

## 2. 接口语义差异

| 项目 | 上游 | 本实现 | 兼容性 |
| --- | --- | --- | --- |
| 安装后生效 | 重启整个 Node/Python 服务 | 独立 Worker `/internal/reload` | 满足“不重启 Node”；pending_restart 由加载报告清除 |
| iframe 权限 | 同源 iframe | `sandbox` 无 `allow-same-origin` + CSP sandbox | 更严格；插件使用 Bridge 不受影响 |
| Bridge fetch | iframe 同源 fetch，返回 JSON/text | 父页面代取，返回 JSON/text；支持 FormData | 对插件可观察行为一致 |
| 下载文件 | iframe 直接打开 API URL | 父页面代取 blob 下载 | 兼容 md_to_epub / epub_translator |
| 删除书籍 | Calibre 移到 `.caltrash` | Mybooks 软删除（回收站 14 天） | 可恢复；应用侧数据不迁移 |
| 格式合并 | Calibre `merge_formats` | 复制目标缺少的格式到目标书 | 保持“同名格式不复制”语义 |
| 封面读取 | Calibre cover 字节 | 仅 `/uploads` 本地封面返回字节；外链封面返回缺失 | quality_check 对外链封面有限制 |
| 语言字段 | Calibre languages | Mybooks 无语言列，返回空/自定义字段 | 需按插件限制说明 |
| `entry_frontend` | 上游实际固定 `frontend/index.html` | 支持 manifest entry_frontend；URL 仍是 `/index.html` | 兼容 |
| api_routes 路径 | 正则片段 | 字面路径精确匹配 | 当前商店 8 个插件均为字面路径 |
| 7z | py7zr | node-7z + 7zip-bin；先列目录校验 | 兼容 |

## 3. 首批 8 个插件矩阵

图例：✅ 已实测；◐ 已实现/部分实测；○ 仅静态加载；— 不支持/环境限制。

| 能力 | zlibrary | md_to_epub | book_dedup | tags_cleaner | mbti_tester | epub_translator | quality_check | audiobook_srt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Manifest / 7z / ZIP | ✅ | ✅ | ✅ (7z) | ✅ | ✅ (7z) | ✅ (7z) | ✅ | ✅ |
| Python import/相对 import | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| BaseTool / Handler | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 原生前端资源 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ○ |
| Bridge fetch/notify/theme/locale | ✅ | ✅ FormData | ✅ | ✅ | ✅ | ✅ | ○ | ○ |
| 后台任务 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Docker | ○ |
| 书库查询 | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ Docker | ✅ 加载 |
| 书库写入/入库 | ✅ 离线模拟 | ✅ 真实入库 | ✅ 合并/软删除 | ✅ 标签替换 | — | ◐ 未接 LLM | — 只读 | — |
| 文件/封面读取 | ✅ | ✅ 下载 | ✅ 格式大小 | — | — | ◐ 导出 | ✅ Docker | — |
| 最终结论 | 兼容（网络取决于环境） | 兼容 | 兼容 | 兼容 | 兼容 | 兼容（LLM 未测） | 兼容（Docker 实测） | 有限：无有声书目录 |

### 实测证据

- **zlibrary**：真实商店 SHA-256 校验；原始 `frontend/index.html` 在 `/get/tool/zlibrary/index.html` 加载；`config/accounts/progress` 经 Bridge 返回原协议；离线模拟下载 + 真实 EPUB 入库 + 标签写入 + 任务完成（`toolbox_tasks.status=completed`、`result_book_id=1`）。健康检查在本机 Windows 返回 `entry.unreachable`，未伪报成功；用户 Ubuntu 环境此前实测 EAPI 可用；真实公网搜索/下载未在本机验收。
- **md_to_epub**：浏览器原生 UI 选中 `.md` → Bridge FormData → Node multipart 网关 → Python 转换 → EPUB 入库（book_id=4）→ 父页面二进制下载；下载文件 `file` 识别为 EPUB，`unzip -l` 正常。
- **book_dedup**：3 本书扫描得到 1 组；`/merge_plan` 预览；`/merge` 把 PDF 并入 EPUB 书并软删除来源；`groups` 显示 gone；全部经原 Handler。
- **tags_cleaner**：3 本书后台任务，`http://example.com` 标签被清除，`set_metadata` 落库，任务 completed。
- **mbti_tester**：3 本书分析返回 `book_count=3`、类型 `XXXX`（样本不足），无异常。
- **quality_check**：Docker Python 3.12 加载成功；`/checks` 返回 91 项中的检查定义；`scope=all` 体检完成，`/report` 返回 3 本书、0 issues、task_id。
- **audiobook_srt**：Docker 加载成功；`/overview` 返回 env 未安装、无有声书；Mybooks 当前无 audio 目录，功能受限。
- **epub_translator**：加载成功；库搜索 `formats:EPUB` 返回 EPUB 书；LLM 配置/翻译未配置，未发起外部 LLM 请求。

## 4. 未实现/明确限制

- 插件运行在**共享 Python 进程**；allowlist + 非 root 容器限制是当前边界，不是强沙箱。要运行任意不可信商店插件，需要按插件独立容器/进程。
- 单 Worker：所有插件共享一个 Python 进程；`AsyncService` 每个服务一个串行线程；重启后插件内存状态丢失，任务由 Node 标记失败并保留历史。
- `quality_check` 外链封面无法读取（只读本地 `/uploads`）。
- `audiobook_srt` 依赖 Mybooks 不存在的声音目录；可通过 `MYBOOKS_AUDIO_DIR` 指向共享目录，但仍缺少宿主音频管理。
- `calibre.set_cover`、`add_format`、`remove_formats`、`set_custom`、`search_books(include_comments)` 等未覆盖的能力抛
  `UnsupportedCapability`，不会静默返回空值。
- 安装包内 `api_routes.path` 按字面匹配；带正则元字符的旧插件需要额外适配。
- 未做按插件网络出口控制；网络型插件需要外网。
