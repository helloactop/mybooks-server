const express = require('express');
const path = require('node:path');

// 与旧 public/ 分开托管，SPA 回退仅作用于挂载点（/mybooks），不能吞掉 API 或旧页面。
function createAdminRouter({
  distDir = path.resolve(__dirname, '../../web-react/dist'),
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    res.set('Cache-Control', 'no-store');
    // 只公开 SPA 外壳及其静态资源；私人业务数据仍由 /api 会话守卫校验。
    return next();
  });
  router.get('/', (req, res, next) => {
    const originalPath = req.originalUrl.split('?')[0];
    if (originalPath.endsWith('/')) return next();
    const query = req.originalUrl.slice(originalPath.length);
    return res.redirect(308, req.baseUrl + '/' + query);
  });
  router.use(express.static(distDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.startsWith(path.join(distDir, 'assets') + path.sep)) {
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      }
    },
  }));
  router.get('*', (req, res, next) => {
    // 缺失的 JS/CSS 等资源必须 404，不能返回 HTML 导致 MIME 错误。
    if (req.path.startsWith('/assets/') || path.extname(req.path) || !req.accepts('html')) return next();
    res.sendFile(path.join(distDir, 'index.html'), (error) => {
      if (!error) return;
      if (error.code === 'ENOENT') return res.status(503).json({ error: '新版管理面板暂不可用' });
      return next(error);
    });
  });
  return router;
}

module.exports = { createAdminRouter };
