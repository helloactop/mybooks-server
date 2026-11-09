/* ============================================================
 * 统一插件只读 API
 *
 * 仅提供查看视图；安装、启停、调用仍走旧 /api/toolbox/*。
 * 挂载点必须在 server.js 的 /api requireSession 之后。
 * ============================================================ */

const express = require('express');

const { db } = require('../db/index');
const { LegacyToolboxAdapter } = require('../core/plugins/adapters/legacy-toolbox');
const {
  getInstalledPluginDescriptors, getPluginDescriptor, toPublicDescriptor,
} = require('../core/toolbox/descriptor');
const { modeFromEnv } = require('../core/toolbox/manifest-v1');
const { TOOL_ID_RE } = require('../core/toolbox/manifest');
const { runtimes, kernel } = require('./plugin-services');

const router = express.Router();
const legacy = new LegacyToolboxAdapter({ db });

router.get('/api/plugins', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    plugins: legacy.list(),
    // 内置 Kernel 实例与旧 Toolbox 分开标记，不把只读视图伪装成统一生命周期。
    builtins: kernel.list().map((item) => ({ ...item, source: 'builtin-kernel' })),
  });
});

// Manifest v1 / Legacy 统一描述符（只读）。4C 管理端直接消费该结构。
router.get('/api/plugins/descriptors', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    manifest_mode: modeFromEnv(),
    plugins: getInstalledPluginDescriptors({ db }).map(toPublicDescriptor),
  });
});

router.get('/api/plugins/:id/descriptor', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!TOOL_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'invalid_plugin_id' });
  }
  const descriptor = getPluginDescriptor(req.params.id, { db });
  if (!descriptor) return res.status(404).json({ error: 'plugin_not_found' });
  return res.json({ manifest_mode: modeFromEnv(), plugin: toPublicDescriptor(descriptor) });
});

router.get('/api/plugins/runtime', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({
      runtimes: await runtimes.healthAll(),
      builtinInstances: kernel.registry ? kernel.registry.instances() : [],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
