/* ============================================================
 * 插件运行时 ↔ Mybooks 书库的内部适配
 *
 * 把 Mybooks 的规范化 SQLite 数据翻译成上游 CoreAPI.calibre 的
 * “Calibre 风格 dict”，并把插件的读写意图落回现有业务函数。
 * Python 永远拿不到 SQLite 句柄。
 * ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { db: defaultDb } = require('../../db/index');
const books = require('../../db/books');
const bookFiles = require('../../db/book_files');
const customFields = require('../../db/custom_fields');
const identifiersRepo = require('../../db/identifiers');
const { splitAuthors, parseBook } = require('../book');
const { parseTranslators } = require('../translators');
const { fileDigest } = require('../file-digest');
const { FILES_DIR, UPLOAD_DIR, TOOLBOX_DIR } = require('../paths');
const { ToolboxError, assertInside, sha256File } = require('./security');
const { ebookFileName } = require('../ebook');

const COVER_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function bookTypeOf(custom) {
  const raw = custom && (custom.book_type || custom['书目类型'] || custom['类型']);
  if (raw == null) return 0;
  const value = String(raw).trim();
  return ['1', 'true', '实体书', 'physical'].includes(value) ? 1 : 0;
}

function languagesOf(custom) {
  const raw = custom && (custom.language || custom.languages || custom['语言']);
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw).split(/[,，、;/]+/).map((part) => part.trim()).filter(Boolean);
}

function bookDto(handleDb, row) {
  if (!row) return null;
  const files = bookFiles.listFiles(handleDb, row.id);
  const formats = files.map((file) => String(file.format).toUpperCase());
  const identifiers = identifiersRepo.getIdentifiers(handleDb, row.id) || {};
  const custom = customFields.getRawValues(handleDb, row.id) || {};
  const tags = parseJson(row.tags, []);
  const translators = parseJson(row.translators, []);
  const cover = String(row.cover || '');
  const created = row.created_at || '';
  const size = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  const bookType = bookTypeOf(custom);
  return {
    id: row.id,
    uuid: row.uuid || '',
    title: row.title || '',
    title_sort: row.title_sort || row.title || '',
    sort: row.title_sort || row.title || '',
    author: row.author || '',
    authors: splitAuthors(row.author || ''),
    tags: Array.isArray(tags) ? tags : [],
    series: row.series || '',
    series_index: row.series_index || 0,
    publisher: row.publisher || '',
    pubdate: row.pub_year || '',
    timestamp: created,
    added: created,
    comments: row.summary || '',
    comments_present: !!(row.summary || '').trim(),
    rating: Number(row.rating) || 0,
    isbn: row.isbn || identifiers.isbn || '',
    isbn10: '',
    isbn13: identifiers.isbn || row.isbn || '',
    identifiers,
    languages: languagesOf(custom),
    translators: Array.isArray(translators) ? translators : [],
    available_formats: formats,
    formats,
    files: files.map((file) => ({ format: String(file.format).toUpperCase(), size: file.size, sha256: file.sha256 || '' })),
    size,
    cover,
    thumb: cover,
    has_cover: !!cover,
    '#book_type': bookType,
    book_type: bookType,
    collector_id: null,
    collector: '',
    sole: false,
    custom,
  };
}

function validIds(ids) {
  return [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function getBooks(handleDb = defaultDb, ids = []) {
  return validIds(ids).map((id) => bookDto(handleDb, books.getBook(id, handleDb))).filter(Boolean);
}

function listIds(handleDb = defaultDb, { q = '', limit = 100000 } = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 100000, 100000));
  const rows = books.listBooks({ q: String(q || '') }, handleDb);
  return rows.slice(0, max).map((row) => row.id);
}

function searchBooks(handleDb = defaultDb, query = '', limit = 50) {
  const max = Math.max(1, Math.min(Number(limit) || 50, 500));
  const rows = books.listBooks({ q: String(query || '') }, handleDb);
  return rows.slice(0, max).map((row) => bookDto(handleDb, row)).filter(Boolean);
}

function getFields(handleDb, field, ids) {
  const values = {};
  const list = validIds(ids);
  for (const id of list) {
    const row = books.getBook(id, handleDb);
    if (!row) continue;
    if (field === 'tags' || field === 'tag') {
      values[id] = parseJson(row.tags, []);
    } else if (field === '#book_type' || field === 'book_type') {
      values[id] = bookTypeOf(customFields.getRawValues(handleDb, id) || {});
    } else {
      const label = String(field || '').replace(/^#/, '');
      const custom = customFields.getRawValues(handleDb, id) || {};
      values[id] = custom[label] == null ? null : custom[label];
    }
  }
  return values;
}

async function exportFile(handleDb, toolId, bookId, format) {
  const book = books.getBook(Number(bookId), handleDb);
  if (!book) throw new ToolboxError('BOOK_NOT_FOUND', '书籍不存在', 404);
  const fmt = String(format || '').toUpperCase();
  const file = bookFiles.getFile(handleDb, book.id, fmt);
  if (!file) throw new ToolboxError('FORMAT_NOT_FOUND', `这本书没有 ${fmt} 文件`, 404);
  const source = path.resolve(FILES_DIR, file.path);
  const baseReal = await fs.promises.realpath(FILES_DIR);
  const sourceReal = await fs.promises.realpath(source);
  assertInside(baseReal, sourceReal, 'FORMAT_PATH_ESCAPE');
  const digest = file.sha256 || (await fileDigest(sourceReal)).sha256;
  const dir = path.join(TOOLBOX_DIR, 'data', toolId, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${book.id}-${digest.slice(0, 16)}.${fmt.toLowerCase()}`);
  if (!fs.existsSync(target)) {
    const tmp = `${target}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    fs.copyFileSync(sourceReal, tmp, fs.constants.COPYFILE_EXCL);
    fs.renameSync(tmp, target);
  }
  return {
    path: target,
    size: fs.statSync(target).size,
    sha256: digest,
    format: fmt,
    book_id: book.id,
    title: book.title,
  };
}

function coverData(handleDb, bookId) {
  const book = books.getBook(Number(bookId), handleDb);
  if (!book) throw new ToolboxError('BOOK_NOT_FOUND', '书籍不存在', 404);
  const cover = String(book.cover || '');
  if (!cover.startsWith('/uploads/')) return { data: null, mime: '' };
  const name = cover.slice('/uploads/'.length);
  if (!name || name.includes('/') || name.includes('\\')) return { data: null, mime: '' };
  const file = path.join(UPLOAD_DIR, name);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return { data: null, mime: '' };
    const mime = COVER_MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
    return { data: fs.readFileSync(file).toString('base64'), mime, size: stat.size };
  } catch {
    return { data: null, mime: '' };
  }
}

function updateMetadata(handleDb, bookId, fields = {}) {
  const id = Number(bookId);
  const existing = books.getBook(id, handleDb);
  if (!existing) throw new ToolboxError('BOOK_NOT_FOUND', '书籍不存在', 404);
  const existingTags = parseJson(existing.tags, []);
  const existingTranslators = parseJson(existing.translators, []);
  const body = {
    ...existing,
    authors: splitAuthors(existing.author || ''),
    tags: fields.tags !== undefined ? fields.tags : existingTags,
    translators: fields.translators !== undefined ? fields.translators : existingTranslators,
    summary: fields.comments !== undefined ? fields.comments : existing.summary,
  };
  if (fields.title !== undefined) body.title = fields.title;
  if (fields.authors !== undefined) body.authors = fields.authors;
  else if (fields.author !== undefined) body.author = fields.author;
  if (fields.publisher !== undefined) body.publisher = fields.publisher;
  if (fields.series !== undefined) body.series = fields.series;
  if (fields.series_index !== undefined) body.series_index = fields.series_index;
  if (fields.rating !== undefined) body.rating = fields.rating;
  if (fields.pubdate !== undefined) body.pub_year = String(fields.pubdate).slice(0, 4);
  if (fields.isbn !== undefined) body.isbn = fields.isbn;
  const parsed = parseBook(body);
  if (parsed.errors.length) throw new ToolboxError('METADATA_INVALID', parsed.errors.join(';'));
  const updated = books.updateBook(id, parsed.values, null, handleDb);
  return bookDto(handleDb, updated);
}

function deleteBook(handleDb, bookId) {
  const id = Number(bookId);
  const existing = books.getBook(id, handleDb);
  if (!existing) throw new ToolboxError('BOOK_NOT_FOUND', '书籍不存在', 404);
  const deleted = books.softDeleteBook(handleDb, id);
  if (!deleted) throw new ToolboxError('DELETE_FAILED', '删除失败', 500);
  return { ok: true, book_id: id, deleted_at: deleted.deleted_at };
}

async function mergeFormats(handleDb, sourceId, targetId) {
  const source = books.getBook(Number(sourceId), handleDb);
  const target = books.getBook(Number(targetId), handleDb);
  if (!source) throw new ToolboxError('BOOK_NOT_FOUND', `来源书籍不存在：${sourceId}`, 404);
  if (!target) throw new ToolboxError('BOOK_NOT_FOUND', `目标书籍不存在：${targetId}`, 404);
  if (source.id === target.id) throw new ToolboxError('MERGE_SELF', '不能合并到自身');
  const sourceFiles = bookFiles.listFiles(handleDb, source.id);
  const targetFormats = new Set(bookFiles.listFiles(handleDb, target.id).map((file) => String(file.format).toUpperCase()));
  const moved = [];
  for (const file of sourceFiles) {
    const fmt = String(file.format).toUpperCase();
    if (targetFormats.has(fmt)) continue;
    const src = path.resolve(FILES_DIR, file.path);
    const baseReal = await fs.promises.realpath(FILES_DIR);
    const srcReal = await fs.promises.realpath(src);
    assertInside(baseReal, srcReal, 'FORMAT_PATH_ESCAPE');
    const name = ebookFileName(target.id, fmt);
    const dest = path.join(FILES_DIR, name);
    fs.copyFileSync(srcReal, dest, fs.constants.COPYFILE_EXCL);
    try {
      const digest = await fileDigest(dest);
      bookFiles.upsertFile(handleDb, target.id, {
        format: fmt, path: name, size: digest.size, sha256: digest.sha256,
      });
      books.touchBook(target.id, handleDb);
      moved.push(fmt);
    } catch (err) {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      throw err;
    }
  }
  if (!moved.length) throw new ToolboxError('NO_NEW_FORMATS', '来源书籍没有目标书籍缺少的格式');
  return { ok: true, moved, source_id: source.id, target_id: target.id };
}

function createItem(bookId, userId) {
  return { id: 0, book_id: Number(bookId), collector_id: userId || null };
}

// 只接受元数据字段；不创建正文文件、不写阅读记录，避免插件绕过导入流程。
const CREATE_FIELDS = [
  'title', 'authors', 'author', 'tags', 'translators', 'publisher', 'pubdate',
  'pub_year', 'isbn', 'series', 'series_index', 'rating', 'summary', 'comments',
];
const UPDATE_FIELDS = [
  'title', 'authors', 'author', 'tags', 'translators', 'publisher', 'pubdate',
  'isbn', 'series', 'series_index', 'rating', 'comments', 'summary',
];

function pickFields(fields, allowed) {
  const out = {};
  for (const key of allowed) {
    if (fields && fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

function createBook(handleDb, fields = {}) {
  const input = pickFields(fields, CREATE_FIELDS);
  const title = String(input.title || '').trim();
  if (!title) throw new ToolboxError('BOOK_TITLE_REQUIRED', '缺少书名');
  const authors = input.authors !== undefined
    ? input.authors
    : (input.author !== undefined ? splitAuthors(String(input.author || '')) : []);
  const parsed = parseBook({
    title,
    authors,
    tags: input.tags,
    translators: input.translators,
    publisher: input.publisher,
    pub_year: input.pub_year !== undefined ? input.pub_year : input.pubdate,
    isbn: input.isbn,
    series: input.series,
    series_index: input.series_index,
    rating: input.rating,
    summary: input.summary !== undefined ? input.summary : input.comments,
    status: 'wish',
  });
  if (parsed.errors.length) throw new ToolboxError('BOOK_INVALID', parsed.errors.join(';'));
  const created = books.addBook(parsed.values, null, handleDb);
  return bookDto(handleDb, created);
}

function updateBook(handleDb, bookId, fields = {}) {
  return updateMetadata(handleDb, bookId, pickFields(fields, UPDATE_FIELDS));
}

function readingStatus(handleDb, bookId) {
  const id = Number(bookId);
  const row = books.getBook(id, handleDb);
  if (!row) throw new ToolboxError('BOOK_NOT_FOUND', '书籍不存在', 404);
  let logs = [];
  try { logs = JSON.parse(row.read_logs || '[]'); } catch { logs = []; }
  let lastReadAt = null;
  if (Array.isArray(logs) && logs.length) {
    const last = logs[logs.length - 1];
    if (last && typeof last === 'object') {
      lastReadAt = last.at || last.date || last.time || null;
    } else if (typeof last === 'string') {
      lastReadAt = last;
    }
  }
  return {
    book_id: row.id,
    status: row.status || '',
    read_count: Number(row.read_count) || 0,
    start_date: row.start_date || null,
    finish_date: row.finish_date || null,
    last_read_at: lastReadAt,
  };
}

module.exports = {
  bookDto,
  getBooks,
  listIds,
  searchBooks,
  getFields,
  exportFile,
  coverData,
  updateMetadata,
  createBook,
  updateBook,
  readingStatus,
  deleteBook,
  mergeFormats,
  createItem,
  sha256File,
};
