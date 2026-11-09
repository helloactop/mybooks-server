/* ============================================================
 * 统一插件只读 API
 *
 * 仅提供查看视图；安装、启停、调用仍走旧 /api/toolbox/*。
 * 挂载点必须在 server.js 的 /api requireSession 之后。
 * ============================================================ */

const express = require('express');

const { db } = require('../db/index');
const { LegacyToolboxAdapter } = require('../core/plugins/adapters/legacy-toolbox');

const router = express.Router();
const legacy = new LegacyToolboxAdapter({ db });

router.get('/api/plugins', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ plugins: legacy.list() });
});

module.exports = router;
