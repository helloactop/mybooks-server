/* ============================================================
 * 公开只读 API（无需登录）
 *
 * 只暴露首页/榜单/统计/导航和公开详情需要的白名单字段。
 * 管理 API（/api/books、/api/stats?vl=、分类写操作、同步、导出、设备）
 * 仍在 /api 的会话/写权限守卫之后，不受这里影响。
 * ============================================================ */

const express = require('express');

const { db } = require('../db/index');
const { homeFeed, rankFeed } = require('../db/feeds');
const stats = require('../db/stats');
const books = require('../db/books');
const categories = require('../db/categories');
const { publicBook } = require('./public-book');

const router = express.Router();

function publicCache(res) {
  res.set('Cache-Control', 'no-store');
}

function sendHomeFeed(req, res) {
  publicCache(res);
  const feed = homeFeed(db, { gridMax: req.query.grid, entLimit: req.query.ent });
  res.json({
    featured: publicBook(feed.featured),
    grid: feed.grid.map(publicBook),
    gallery: feed.gallery.map(publicBook),
  });
}

function sendRankFeed(req, res) {
  publicCache(res);
  const feed = rankFeed(db, { size: req.query.size });
  res.json({ total: feed.total, done: feed.done, reread: feed.reread.map(publicBook) });
}

// /api/home/feed 保留给旧公开页/测试；新代码统一走 /api/public/*。
router.get('/api/home/feed', sendHomeFeed);
router.get('/api/public/home/feed', sendHomeFeed);
router.get('/api/rank/feed', sendRankFeed);
router.get('/api/public/rank/feed', sendRankFeed);

// 公开统计不接受 ?vl=；虚拟书库是登录后的私人作用域。
router.get('/api/public/stats', (_req, res) => {
  publicCache(res);
  res.json(stats.getStats(db));
});

router.get('/api/public/books/:id', (req, res) => {
  publicCache(res);
  if (!/^\d+$/.test(String(req.params.id))) {
    return res.status(400).json({ error: '书籍 id 应为正整数', code: 'VALIDATION' });
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: '书籍 id 应为正整数', code: 'VALIDATION' });
  }
  const row = books.getBook(id, db);
  if (!row) return res.status(404).json({ error: '书籍不存在', code: 'NOT_FOUND' });
  res.json(publicBook(row));
});

router.get('/api/public/authors', (_req, res) => {
  publicCache(res);
  res.json(categories.listAuthors(db).map(({ name, count }) => ({ name, count })));
});

router.get('/api/public/tags', (_req, res) => {
  publicCache(res);
  res.json(categories.listTags(db).map(({ name, count }) => ({ name, count })));
});

module.exports = router;
