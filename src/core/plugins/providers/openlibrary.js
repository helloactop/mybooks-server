/* ============================================================
 * 内置 Open Library Provider（metadata.search@1）
 *
 * 作为豆瓣的可替换来源：ISBN 走 detail 接口，关键词走 search.json。
 * 网络实现由组装层注入，本文件只做候选规范化。
 * ============================================================ */

const { CAPABILITY, VERSION, candidateFromBook } = require('../capabilities/metadata-search');

function createOpenLibraryProvider({ search, lookupIsbn } = {}) {
  if (typeof search !== 'function' || typeof lookupIsbn !== 'function') {
    throw new TypeError('Open Library Provider 需要注入 search 与 lookupIsbn');
  }

  return {
    instanceId: 'builtin.openlibrary',
    providerId: 'openlibrary',
    capability: CAPABILITY,
    version: VERSION,
    priority: 50,
    metadata: { displayName: 'Open Library' },
    invoke: async (input, context = {}) => {
      const options = { signal: context.signal };
      if (input.isbn) {
        const result = await lookupIsbn(input.isbn, options);
        if (!result || result.status !== 'found' || !result.book) return { candidates: [] };
        return { candidates: [candidateFromBook(result.book, 'openlibrary')] };
      }

      const books = await search(input.query, input.limit, options);
      return { candidates: books.slice(0, input.limit).map((book) => candidateFromBook(book, 'openlibrary')) };
    },
  };
}

module.exports = { createOpenLibraryProvider };
