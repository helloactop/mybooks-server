/* ============================================================
 * 工具箱页面与插件前端静态资源
 *
 * 插件资源从 <TOOLBOX_DIR>/plugins/<id>/frontend/ 映射，不暴露
 * backend/config；CSP sandbox 让插件即使在顶层打开也保持不透明源，
 * 拿不到主站 Cookie/DOM。
 * ============================================================ */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { db } = require('../db/index');
const toolboxRepo = require('../db/toolbox');
const { ROOT, TOOLBOX_DIR } = require('../core/paths');
const { TOOL_ID_RE } = require('../core/toolbox/manifest');
const { assertInside, safeRelativePath } = require('../core/toolbox/security');

const router = express.Router();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

function page(res, name) {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'public', name));
}

router.get('/toolbox', (req, res) => page(res, 'toolbox.html'));
router.get('/toolbox/tool/:id', (req, res) => {
  if (!TOOL_ID_RE.test(String(req.params.id))) return res.redirect('/toolbox');
  page(res, 'toolbox-tool.html');
});

router.get('/book/:id(\\d+)', (req, res) => {
  res.redirect(302, `/shelf?book=${req.params.id}`);
});

function assetOrigin(req) {
  const host = String(req.get('host') || '');
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(host)) return '';
  const forwarded = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = /^https?$/.test(forwarded) ? forwarded : req.protocol;
  return `${protocol}://${host}`;
}

function pluginCsp(req, toolId) {
  const origin = assetOrigin(req);
  if (!origin) return '';
  // 上游资源前缀是 /get/tool/{id}/；这里保持同一路径契约。
  const base = `${origin}/get/tool/${toolId}/`;
  return [
    // 不透明源 + 禁止下载之外的能力；下载由用户点击触发，allow-downloads 只放行下载
    'sandbox allow-scripts allow-modals allow-downloads',
    "default-src 'none'",
    `script-src ${base} ${origin}/static/toolbox-bridge.js ${origin}/static/plugin-sdk/v1.js`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${origin} ${base} https: data:`,
    `font-src ${base} data:`,
    `connect-src ${base}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${origin}`,
  ].join('; ');
}

function enabledTool(toolId) {
  if (!TOOL_ID_RE.test(String(toolId || ''))) return null;
  const tool = toolboxRepo.getTool(db, toolId);
  return tool && tool.enabled ? tool : null;
}

async function serveFrontendAsset(req, res, toolId, rawAsset) {
  const tool = enabledTool(toolId);
  if (!tool) return res.status(404).type('text/plain').send('Tool not found');
  const entry = tool.manifest && tool.manifest.entry_frontend;
  if (!entry) return res.status(404).type('text/plain').send('No frontend');
  let asset;
  try {
    asset = safeRelativePath(rawAsset || entry, { allowEmpty: true }) || entry;
  } catch {
    return res.status(400).type('text/plain').send('Invalid path');
  }
  // 上游固定入口 /get/tool/{id}/index.html；即使 manifest 写的是别的文件名也映射到它。
  if (asset === 'index.html') asset = entry;
  const base = path.join(TOOLBOX_DIR, tool.install_path, 'frontend');
  const baseReal = await fs.promises.realpath(base);
  const target = assertInside(baseReal, path.join(baseReal, ...asset.split('/')), 'PATH_ESCAPE');
  const lstat = await fs.promises.lstat(target);
  if (lstat.isSymbolicLink() || !lstat.isFile()) return res.status(404).end();
  const real = await fs.promises.realpath(target);
  assertInside(baseReal, real, 'PATH_ESCAPE');

  const ext = path.extname(real).toLowerCase();
  const type = MIME[ext];
  if (!type) return res.status(404).end();
  res.set({
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // sandbox 的不透明源发起的 fetch 也带 Origin: null；插件前端自己的
    // locales/*.json 需要能通过。仅公开前端资产，无凭据、无隐私。
    'Access-Control-Allow-Origin': '*',
  });
  const csp = pluginCsp(req, toolId);
  if (csp) res.set('Content-Security-Policy', csp);
  res.sendFile(real);
}

function serveIcon(req, res, toolId) {
  const tool = enabledTool(toolId);
  if (!tool) return res.status(404).end();
  const base = path.join(TOOLBOX_DIR, tool.install_path);
  const candidates = [
    ['icon.png', 'image/png'], ['icon.jpg', 'image/jpeg'],
    ['icon.jpeg', 'image/jpeg'], ['icon.webp', 'image/webp'],
  ];
  for (const [name, type] of candidates) {
    const file = path.join(base, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.set({ 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.sendFile(file);
    }
  }
  res.status(404).end();
}

router.get('/get/tool/:toolId/icon', (req, res) => serveIcon(req, res, req.params.toolId));

router.get('/get/tool/:toolId/index.html', (req, res) => {
  serveFrontendAsset(req, res, req.params.toolId, 'index.html').catch(() => {
    if (!res.headersSent) res.status(404).end();
  });
});

router.get('/get/tool/:toolId/*', (req, res) => {
  serveFrontendAsset(req, res, req.params.toolId, req.params[0]).catch((err) => {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return res.status(404).end();
    if (!res.headersSent) res.status(400).type('text/plain').send('Invalid asset');
  });
});

// 旧路径保留一个 301，避免本轮改造前打开的页面 404。
router.get('/toolbox-assets/:toolId/*', (req, res) => {
  res.redirect(301, `/get/tool/${encodeURIComponent(req.params.toolId)}/${req.params[0] || ''}`);
});

module.exports = router;
