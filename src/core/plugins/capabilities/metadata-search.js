/* ============================================================
 * metadata.search@1 契约：输入校验、候选规范化、稳定错误码
 *
 * 输入：query? / isbn? / title? / authors? / limit? / locale?
 * 输出：candidates[]，插件只返回候选，不直接写书库。
 * 所有字符串都有上限，Provider 输出仍会被宿主再裁剪一次。
 * ============================================================ */

const { checkIsbn, normalizeIsbn } = require('../../isbn');

const CAPABILITY = 'metadata.search';
const VERSION = '1';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

class MetadataSearchError extends Error {
  constructor(code, message, status = 400, cause) {
    super(message || code);
    this.name = 'MetadataSearchError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function invalid(message) {
  return new MetadataSearchError('INVALID_INPUT', message, 400);
}

function readString(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid(`${field} 必须是字符串`);
  const text = value.trim();
  if (text.length > max) throw invalid(`${field} 过长`);
  return text;
}

function readAuthors(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > 5) throw invalid('authors 最多 5 项');
  return list.map((item) => readString(item, 'authors', 100)).filter(Boolean);
}

function normalizeInput(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('查询参数必须是对象');

  const query = readString(raw.query, 'query', 200);
  const title = readString(raw.title, 'title', 200);
  const authors = readAuthors(raw.authors);
  const isbnRaw = readString(raw.isbn, 'isbn', 32);

  let isbn = '';
  if (isbnRaw) {
    if (!checkIsbn(isbnRaw)) throw invalid('isbn 不合法');
    isbn = normalizeIsbn(isbnRaw);
  }

  let q = query;
  if (!q && title) q = [title, ...authors].join(' ');
  if (!q && !isbn) throw invalid('缺少 query、isbn 或 title');

  let limit = DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    if (!Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > MAX_LIMIT) {
      throw invalid(`limit 必须是 1..${MAX_LIMIT} 的整数`);
    }
    limit = raw.limit;
  }

  const locale = readString(raw.locale, 'locale', 16) || 'zh-CN';
  return Object.freeze({ query: q, isbn, title, authors: Object.freeze(authors), limit, locale });
}

function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clipList(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim().slice(0, maxLen) : ''))
    .filter(Boolean)
    .slice(0, maxItems);
}

// 旧字段形状（mapToBook / mapOpenLibraryBook）→ 统一候选。
function candidateFromBook(book, source) {
  const authors = Array.isArray(book.authors)
    ? book.authors
    : (typeof book.author === 'string' && book.author.trim() ? book.author.split(' / ') : []);
  return {
    title: book.title,
    authors,
    isbn: book.isbn,
    publisher: book.publisher,
    pubYear: book.pubYear,
    description: book.summary,
    cover: book.cover,
    source,
    sourceId: source === 'douban' ? book.doubanId : (source === 'openlibrary' ? book.openlibraryId : ''),
    sourceUrl: source === 'douban' ? book.doubanUrl : (source === 'openlibrary' ? book.openlibraryUrl : ''),
    rating: book.rating,
    tags: book.tags,
    translators: book.translators,
  };
}

function sanitizeCandidate(raw, providerId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MetadataSearchError('PROVIDER_INVALID_OUTPUT', `Provider ${providerId} 输出了非法候选`, 502);
  }
  const title = clip(raw.title, 500);
  if (!title) throw new MetadataSearchError('PROVIDER_INVALID_OUTPUT', `Provider ${providerId} 的候选缺少标题`, 502);

  return Object.freeze({
    title,
    authors: Object.freeze(clipList(raw.authors, 10, 200)),
    isbn: clip(raw.isbn, 20),
    publisher: clip(raw.publisher, 200),
    pubYear: clip(raw.pubYear, 10),
    description: clip(raw.description, 2000),
    cover: clip(raw.cover, 500),
    source: clip(raw.source, 32) || providerId,
    sourceId: clip(raw.sourceId, 128),
    sourceUrl: clip(raw.sourceUrl, 500),
    rating: Number.isFinite(raw.rating) ? Math.max(0, Math.min(10, raw.rating)) : 0,
    tags: Object.freeze(clipList(raw.tags, 20, 50)),
    translators: Object.freeze(clipList(raw.translators, 10, 100)),
  });
}

function normalizeCandidates(result, providerId, limit) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.candidates)) {
    throw new MetadataSearchError('PROVIDER_INVALID_OUTPUT', `Provider ${providerId} 未返回 candidates 数组`, 502);
  }
  return Object.freeze(
    result.candidates.slice(0, limit).map((item) => sanitizeCandidate(item, providerId)),
  );
}

module.exports = {
  CAPABILITY,
  VERSION,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MetadataSearchError,
  normalizeInput,
  candidateFromBook,
  normalizeCandidates,
};
