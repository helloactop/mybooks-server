/* ============================================================
 * My books 服务入口(薄壳)
 *
 * 职责只剩:创建 app、挂中间件、注册路由、监听端口。
 * 业务规则在 src/core/,数据访问在 src/db/,HTTP 适配在 src/http/。
 * ============================================================ */

const express = require('express');
const path = require('node:path');

const routesBooks = require('./src/http/routes.books');
const routesNotes = require('./src/http/routes.notes');
const routesMisc = require('./src/http/routes.misc');
const routesProxy = require('./src/http/routes.proxy');
const routesFiles = require('./src/http/routes.files');
const routesMetadata = require('./src/http/routes.metadata');
const routesIsbn = require('./src/http/routes.isbn');
const routesCategories = require('./src/http/routes.categories');
const routesCollections = require('./src/http/routes.collections');
const routesSavedSearches = require('./src/http/routes.savedSearches');
const routesCustomFields = require('./src/http/routes.customFields');
const routesFeeds = require('./src/http/routes.feeds');
const routesExport = require('./src/http/routes.export');
const routesEnrich = require('./src/http/routes.enrich');
const routesImport = require('./src/http/routes.import');
const routesPublic = require('./src/http/routes.public');
const routesToolbox = require('./src/http/routes.toolbox');
const routesToolboxInternal = require('./src/http/routes.toolbox.internal');
const routesToolboxUi = require('./src/http/routes.toolbox.ui');
const routesPlugins = require('./src/http/routes.plugins');
const routesPluginsAdmin = require('./src/http/routes.plugins.admin');
const pluginServices = require('./src/http/plugin-services');
const { modeNotice } = require('./src/core/toolbox/access-policy');
const { auth, requireSession } = require('./src/http/middleware.auth');
const routesAuth = require('./src/http/routes.auth');
const routesSync = require('./src/http/routes.sync');
const { UPLOAD_DIR, FILES_DIR } = require('./src/core/paths');
const { attachVlScope } = require('./src/http/middleware.vl');
const { db } = require('./src/db/index');
const books = require('./src/db/books');
const notes = require('./src/db/notes');
const toolboxRepo = require('./src/db/toolbox');
const toolboxInstaller = require('./src/core/toolbox/installer');
const { removeBookAssets } = require('./src/core/fs-utils');

const app = express();
const PORT = process.env.PORT || 3000;
// 线上建议 HOST=127.0.0.1:只监听本机,由 Nginx 反代对外,不把 Node 端口暴露到公网
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '10mb' }));
if (process.env.MYBOOKS_TRUST_PROXY) app.set('trust proxy', process.env.MYBOOKS_TRUST_PROXY);
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
// 认证端点先注册，不受书库读权限或业务写权限的阻挡。
app.use(routesAuth);
app.use('/api/v1/auth', (req, res, next) => {
  req.url = '/api/auth' + (req.url === '/' ? '' : req.url);
  routesAuth(req, res, next);
});
// CSV 导入允许直接发 text/csv 请求体(比 JSON 包一层 base64 省 33% 体积,
// 也更符合"把文件拖进来"的直觉)。只对这一个路由生效,不给全局加文本解析器 ——
// 那会让所有路由都接受任意文本体,收窄攻击面。
app.use('/api/import.csv', express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));

// 公开只读 API（首页/榜单/统计/公开详情/导航名单），字段白名单见 routes.public.js。
// 必须在下面的 /api 会话守卫之前注册。外链封面代理也属于公开图片资源。
app.use(routesPublic);
app.use(routesProxy);
// Python runtime 的内部接口：独立密钥鉴权，不经过用户会话。
app.use(routesToolboxInternal);

// 管理页面在静态目录之前拦截：未登录时跳登录页并保留原始路径；API 仍返回 401 JSON。
const MANAGEMENT_PAGES = new Set(['/shelf', '/shelf.html', '/tags', '/tags.html', '/notes', '/notes.html',
  '/toolbox', '/toolbox.html']);
app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const normal = String(req.path || '/').toLowerCase().replace(/\/+$/, '') || '/';
  const management = MANAGEMENT_PAGES.has(normal)
    || normal === '/notes' || normal.startsWith('/notes/')
    || normal === '/toolbox' || normal.startsWith('/toolbox/');
  if (!management) return next();
  if (auth.authenticate(req)) return next();
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl || req.path));
});

// 工具箱页面、插件前端资源（不透明源 iframe）与 /book 深链。
app.use(routesToolboxUi);

// 静态资源缓存策略:HTML 一律 no-cache(每次向服务器验证新鲜度),
// 解决"备案号/新功能要强制刷新才出现"—— index.html 自身没有 ?v= 缓存戳,
// 浏览器会缓存它,导致新发布的页面内容看不到。其余资源靠 ?v= 长缓存不受影响。
// extensions:['html'] 提供干净 URL:/shelf → shelf.html、/rank → rank.html、/stats → stats.html
// 注意:/notes 裸路径要重定向,必须挂在 static 之前 —— 否则会被 extensions
// 的 /notes → /notes.html 内部重写抢先命中(无 id 的心得页只能显示"找不到")。
app.get('/notes', (req, res) => res.redirect('/shelf'));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
// 封面是公开页面的展示资源；上传接口本身仍需要登录。
app.use('/uploads', express.static(UPLOAD_DIR));
// 原始电子书始终私有：即使公开首页可匿名浏览，也不能直接取正文原文件。
app.use('/books-files', requireSession, (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
}, express.static(FILES_DIR));

// 读书心得页:/notes/<书籍 id> —— 带路径参数,静态目录兜不住,显式路由。
// 与 *.html 同一套 no-cache 策略;非法 id 直接回书架(旧 hash 深链也收敛到这里)。
app.get('/notes/:id(\\d+)', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'notes.html'));
});
// 非法/缺失 id 的心得链接:/notes/abc → 书架(页面脚本会给出"找不到这本书"的引导)
app.get('/notes/:rest(.*)', (req, res) => res.redirect('/shelf'));

// 管理 API 全部要求设备会话/Bearer；公开读取只走上面的 /api/public 与公开 feed。
// 不再用 MYBOOKS_PUBLIC_READ 放开整个 /api 读接口。
app.use('/api', requireSession);
// 虚拟书库作用域(?vl=名称):解析一次挂到 req.vlScope,各路由只管取用
app.use('/api', attachVlScope);

// 工具箱：商店/安装管理/任务/插件接口代理（全部要求会话）
app.use(routesToolbox);
// 统一插件只读视图：在 /api 会话守卫之后，不改旧工具箱行为。
app.use(routesPlugins);
// Plugin Center 管理 API（只读）：固定段先于 /:id，旧的 /api/plugins/* 契约保持不变。
app.use(routesPluginsAdmin);

// 电子书文件路由(multipart 上传/列表/删除/下载登记)
app.use(routesFiles);
// 豆瓣元数据抓取(GET /api/v1/metadata/search)
app.use(routesMetadata);
// ISBN:单本校验查重 + 按 ISBN 批量添加
app.use(routesIsbn);

// API 版本化:多端(小程序/PWA/CLI)长期演进的保险。
// v1 是对多端承诺的稳定契约;老的 /api/* 路径继续工作,现有前端(网页端)零改动。
// 实现:挂载在 /api/v1 时 express 已把 req.url 剥成 "/books" 这类相对路径,
// 而路由定义在 "/api/books" 上 —— 所以挂载前把 "/api" 加回去,两套前缀共用同一套路由。
const apiV1 = express.Router();
apiV1.use((req, res, next) => {
  req.url = '/api' + req.url;   // /books → /api/books;缺失尾斜杠时补全
  if (req.url === '/api') req.url = '/api/';
  next();
});
apiV1.use(routesBooks);
apiV1.use(routesSync);
apiV1.use(routesNotes);
apiV1.use(routesMisc);
apiV1.use(routesProxy);
apiV1.use(routesFiles);
apiV1.use(routesMetadata);
apiV1.use(routesIsbn);
apiV1.use(routesCategories);
apiV1.use(routesCollections);
apiV1.use(routesSavedSearches);
apiV1.use(routesCustomFields);
apiV1.use(routesFeeds);
apiV1.use(routesExport);
apiV1.use(routesEnrich);
apiV1.use(routesImport);
app.use('/api/v1', apiV1);

app.use(routesBooks);
app.use(routesSync);
app.use(routesNotes);
app.use(routesMisc);
app.use(routesCategories);
app.use(routesCollections);
app.use(routesSavedSearches);
app.use(routesCustomFields);
app.use(routesExport);
app.use(routesEnrich);
app.use(routesImport);

// Markdown 渲染库(浏览器版;marked v16+ 的 exports 限制子路径,需手动拼接包内路径)
const MARKED_UMD = path.join(path.dirname(require.resolve('marked/package.json')), 'lib', 'marked.umd.js');
app.get('/vendor/marked.umd.js', (req, res) => res.sendFile(MARKED_UMD));
app.get('/vendor/purify.min.js', (req, res) => res.sendFile(require.resolve('dompurify/dist/purify.min.js')));

// 统一错误处理(必须挂在所有路由之后):
// 完整堆栈只进日志;对外只回通用文案,不泄漏内部路径/依赖细节
// (借鉴 calibre srv/errors.py 的对外简洁、对内详尽原则)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ->`, err.stack || err);
  if (res.headersSent) return; // 响应已开始输出,交给 express 默认终止
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: '服务器内部错误,请稍后重试', code: 'INTERNAL' });
});

// 回收站过期清理(对标 calibre expire_old_trash):启动时一次 + 每 6 小时一次。
// 数据库删除在 db 层完成,磁盘资产在提交后由这里清;失败只记日志,不影响服务。
const TRASH_MAINTENANCE_INTERVAL_MS = 6 * 3600 * 1000;
function runTrashMaintenance() {
  try {
    const purged = books.purgeExpired(db);
    let failed = 0;
    for (const item of purged) {
      failed += removeBookAssets(item.assets);
      if (!notes.removeNote(item.id)) failed += 1;
    }
    if (purged.length) {
      console.log(`[trash] 已清理 ${purged.length} 本过期书籍${failed ? `,${failed} 个文件/心得未能移除` : ''}`);
    }
  } catch (err) {
    console.error('[trash] 过期清理失败:', err.stack || err);
  }
}
runTrashMaintenance();
setInterval(runTrashMaintenance, TRASH_MAINTENANCE_INTERVAL_MS).unref();

// 工具箱启动恢复：
//   1. 把数据库里的启用清单写回共享卷，Python runtime 启动时即可读取；
//   2. 区分三种中断场景，避免把仍在执行的任务误判为失败：
//      · Runtime 完全离线 → 所有 running 任务都是中断的；
//      · Runtime 在线但插件未加载 → 该插件的任务已中断；
//      · Runtime 在线且插件已加载 → 保留 running，仅回收长时间无进展的僵死任务。
try {
  const tools = toolboxInstaller.syncInstalledState(db);
  const unreviewed = tools.filter((tool) => !(tool.compatibility && tool.compatibility.reviewed));
  if (unreviewed.length) {
    console.warn(
      '[toolbox] 警告：未审查插件 %s 与宿主同进程运行（共享 Worker 不是安全边界，'
      + '插件可读取同卷其它插件配置）。只应安装已审查插件；需要运行未审查代码时请启用 '
      + 'TOOLBOX_ISOLATE_PLUGINS=1 并使用独立 UID 模式。',
      unreviewed.map((tool) => tool.tool_id).join(', '));
  }
  const runtime = require('./src/core/toolbox/runtime');
  const TASK_STALE_MS = 6 * 3600 * 1000;
  const bootAt = new Date().toISOString();
  runtime.runtimeHealth({ timeoutMs: 3000 }).then((health) => {
    try {
      let recovered = 0;
      if (!health.online) {
        recovered = toolboxRepo.recoverRunningTasks(db, '插件运行时离线，任务已中断', {
          createdBefore: bootAt,
        });
        console.log('[toolbox] 运行时离线，已标记 %d 个任务为失败', recovered);
      } else {
        const loaded = new Set(((health.info && health.info.plugins) || []).map(String));
        recovered = toolboxRepo.recoverRunningTasks(
          db,
          '插件未加载或任务长时间无进展，已标记失败',
          {
            excludeToolIds: [...loaded],
            staleBefore: new Date(Date.now() - TASK_STALE_MS).toISOString(),
            createdBefore: bootAt,
          },
        );
        if (recovered) console.log('[toolbox] 已回收 %d 个中断/僵死任务', recovered);
        const pathStatus = runtime.runtimePathStatus(health.info);
        if (pathStatus.checked && pathStatus.mismatch) {
          console.error(
            '[toolbox] 部署路径不一致：Node=%s Runtime=%s；'
            + '请让两个进程挂载同一个 MYBOOKS_TOOLBOX_DIR，否则插件产物无法入库',
            pathStatus.node, pathStatus.runtime);
        }
      }
    } catch (err) {
      console.error('[toolbox] 任务恢复失败:', err.stack || err);
    }
  }).catch((err) => {
    console.error('[toolbox] 运行时健康检查失败:', err && (err.stack || err));
  });
  if (tools.length) {
    // 这是“服务启动加载”，不是安装时执行：Python Worker 可能比 Node 晚几秒启动，
    // 因此短暂重试；加载报告会写回 pending_restart/last_error。
    let attempt = 0;
    const warm = () => {
      toolboxInstaller.reloadAndSync(db).then((result) => {
        if (result.ok) return;
        attempt += 1;
        if (attempt <= 2) setTimeout(warm, attempt * 5000).unref();
      }).catch(() => {});
    };
    setTimeout(warm, 1500).unref();
  }
} catch (err) {
  console.error('[toolbox] 启动恢复失败:', err.stack || err);
}

// 明确打印内部接口的访问模式：Legacy 兼容 ≠ 强隔离，避免运维误判。
try { console.log('[toolbox]', modeNotice()); } catch { /* 启动提示失败不影响服务 */ }

// 宿主级插件服务：只创建一套 Kernel/Registry/RuntimeManager；
// 内置 Provider 的激活放在后台完成，失败只记录错误，不阻塞 Web 启动。
pluginServices.start().catch((err) => {
  console.error('[plugins] 内置 Provider 启动失败:', err && (err.stack || err));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`My books 已启动: http://${HOST === '0.0.0.0' || HOST === '127.0.0.1' ? 'localhost' : HOST}:${server.address().port}`);
});

// 优雅退出(借鉴 calibre srv/standalone.py 的 HandleInterrupt):
// SIGTERM(pm2 stop/restart)与 SIGINT(Ctrl+C)先停止接新请求,给在途请求
// 最多 3s 完成;之后兜底强杀。与 ecosystem.config.js 的 kill_timeout: 5000 呼应。
// WAL 模式下数据库本就崩溃安全,这里主要避免在途请求被硬切、临时文件残留。
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] 收到 ${signal},停止接受新请求,等待在途请求完成…`);
  // 释放宿主插件内核注册（幂等，失败不阻断退出）。
  pluginServices.dispose().catch((err) => {
    console.error('[plugins] 关闭内核失败:', err && (err.message || err));
  });
  server.close(() => {
    console.log('[shutdown] 全部连接已结束,进程退出');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('[shutdown] 等待超时,强制退出');
    process.exit(1);
  }, 3000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
