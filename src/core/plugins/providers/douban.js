/* ============================================================
 * 内置豆瓣 Provider（metadata.search@1）
 *
 * 只做“统一候选”适配：抓取、Cookie、反爬仍在 metadata-sources，
 * 本文件不碰 Express、数据库或路由白名单。
 * search / lookupIsbn 由组装层注入，便于测试与后续替换实现。
 * ============================================================ */

const { CAPABILITY, VERSION, candidateFromBook } = require('../capabilities/metadata-search');

function blockedError() {
  return Object.assign(new Error('豆瓣拒绝访问'), { code: 'BLOCKED' });
}

function createDoubanProvider({ search, lookupIsbn } = {}) {
  if (typeof search !== 'function' || typeof lookupIsbn !== 'function') {
    throw new TypeError('豆瓣 Provider 需要注入 search 与 lookupIsbn');
  }

  return {
    instanceId: 'builtin.douban',
    providerId: 'douban',
    capability: CAPABILITY,
    version: VERSION,
    priority: 100,
    metadata: { displayName: '豆瓣' },
    invoke: async (input) => {
      if (input.isbn) {
        const result = await lookupIsbn(input.isbn);
        if (!result || result.status === 'not_found') return { candidates: [] };
        if (result.status === 'blocked') throw blockedError();
        if (result.status === 'found' && result.book) {
          return { candidates: [candidateFromBook(result.book, 'douban')] };
        }
        return { candidates: [] };
      }

      const books = await search(input.query);
      return { candidates: books.slice(0, input.limit).map((book) => candidateFromBook(book, 'douban')) };
    },
  };
}

module.exports = { createDoubanProvider };
