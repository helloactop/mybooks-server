/* 首页 / 榜单专用只读 feed:避免浏览器为几十张卡片拉全库书目 */
const express = require('express');

const { db } = require('../db/index');
const { homeFeed, rankFeed } = require('../db/feeds');
const { publicBook } = require('./public-book');

const router = express.Router();

router.get('/api/home/feed', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const feed = homeFeed(db, { gridMax: req.query.grid, entLimit: req.query.ent });
  res.json({
    featured: publicBook(feed.featured),
    grid: feed.grid.map(publicBook),
    gallery: feed.gallery.map(publicBook),
  });
});

router.get('/api/rank/feed', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const feed = rankFeed(db, { size: req.query.size });
  res.json({ total: feed.total, done: feed.done, reread: feed.reread.map(publicBook) });
});

module.exports = router;