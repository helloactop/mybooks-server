/* ============================================================
 * 豆瓣元数据路由:GET /api/v1/metadata/search?q=书名或ISBN
 *
 * 本文件只做 HTTP 协议适配(参数校验 / 缓存 / 状态码 / JSON 形状),
 * 网络抓取在 http/metadata-sources.js；Provider 契约与编排在 core/plugins。
 * 返回形状仍是旧 results[]，前端与旧客户端无需改动。
 *   · LRU 20 条缓存(候选页),10 分钟,命中也要查时间戳
 *   · 15s 超时;"禁止访问"明确报 502,提示配 Cookie
 * ============================================================ */

const express = require('express');
const { loadCookie } = require('./metadata-sources');
const { service: metadataService } = require('./plugin-services');
const { LruCache } = require('./lru');

const router = express.Router();

const SEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 分钟:与文件头声明一致
const searchCache = new LruCache(20);

// 统一候选 → 旧 results[] 形状；两个来源都补齐 authors 数组与专有字段。
function toLegacyResult(candidate) {
  const authors = candidate.authors;
  const result = {
    authors,
    translators: candidate.translators,
    title: candidate.title,
    author: authors.join(' / '),
    summary: candidate.description,
    publisher: candidate.publisher,
    pubYear: candidate.pubYear,
    isbn: candidate.isbn,
    rating: candidate.rating,
    tags: candidate.tags,
    cover: candidate.cover,
  };
  if (candidate.source === 'douban') {
    result.doubanId = candidate.sourceId;
    result.doubanUrl = candidate.sourceUrl;
  } else if (candidate.source === 'openlibrary') {
    result.openlibraryId = candidate.sourceId;
    result.openlibraryUrl = candidate.sourceUrl;
  }
  return result;
}

// 搜索处理函数:单独抽出(不写成 router.get 的内联回调),
// 便于测试直接以假 req/res + 桩 fetch 驱动,验证缓存 TTL 行为。
async function handleMetadataSearch(req, res) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '缺少搜索词(书名或 ISBN)', code: 'VALIDATION' });

  const isIsbn = /^\d{9,13}[xX]?$/.test(q.replace(/[- ]/g, ''));
  const searchKey = isIsbn ? `isbn:${q}` : q;

  const hit = searchCache.get(searchKey);
  if (hit) {
    // TTL 检查(此前缺这一步:注释写着 10 分钟,代码却是"命中就返回",
    // 条目只在被 20 条 LRU 淘汰前永久有效 —— 豆瓣改条目后一直拿旧数据)
    if (Date.now() - hit.t < SEARCH_CACHE_TTL) {
      res.set('X-Cache', 'hit');
      return res.json({ results: hit.results, cookieless: !loadCookie() });
    }
    searchCache.delete(searchKey); // 过期条目主动清掉,别占着容量位
  }

  try {
    const { candidates } = await metadataService.search({ query: q });
    const results = candidates.map(toLegacyResult);
    searchCache.set(searchKey, { t: Date.now(), results });
    res.set('X-Cache', 'miss');
    res.json({ results, cookieless: !loadCookie() });
  } catch (err) {
    if (err.code === 'VALIDATION' || err.code === 'INVALID_INPUT') {
      return res.status(400).json({ error: err.message, code: 'VALIDATION' });
    }
    if (err.code === 'UPSTREAM_TIMEOUT') {
      return res.status(504).json({ error: '连接豆瓣超时,请稍后重试', code: 'UPSTREAM_TIMEOUT' });
    }
    if (err.code === 'UPSTREAM_BLOCKED') {
      return res.status(502).json({
        error: '豆瓣拒绝访问。请配置登录 Cookie:浏览器登录豆瓣 → F12 → Network → 复制 Cookie 头,写入服务器 data/douban-cookie 文件(或 DOUBAN_COOKIE 环境变量)后重启',
        code: 'BLOCKED',
      });
    }
    if (err.code === 'UPSTREAM_ERROR') {
      return res.status(502).json({ error: err.message, code: 'UPSTREAM' });
    }
    console.error('[metadata] search failed:', err.message);
    res.status(500).json({ error: '豆瓣查询失败', code: 'INTERNAL' });
  }
}

router.get('/api/metadata/search', handleMetadataSearch);

module.exports = router;
// 供测试:处理函数、缓存实例与 TTL 常量(与 middleware.auth.js 导出
// resetTokenCache 同一思路 —— 路由照常注册,内部件可被单独驱动)
module.exports.handleMetadataSearch = handleMetadataSearch;
module.exports.searchCache = searchCache;
module.exports.SEARCH_CACHE_TTL = SEARCH_CACHE_TTL;
