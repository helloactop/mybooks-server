/* ============================================================
 * 插件文件 → Mybooks 书库入库适配
 *
 * 复用现有 parseBook / addBook / validateEbookFile / upsertFile，
 * 不改 80MB 与格式白名单，也不让插件直接写 SQLite。
 *
 * 顺序刻意设计成“先落文件、再写数据库”：
 *   · 文件写失败 → 数据库没有任何变化；
 *   · 数据库失败 → 删掉刚写的新文件；
 *   · 进程在两者之间中断 → 最多留下一个无登记文件，不会出现
 *     “数据库指向不存在的正文”。
 * ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const { db: defaultDb, inTransaction } = require('../../db/index');
const books = require('../../db/books');
const bookFiles = require('../../db/book_files');
const { parseBook } = require('../book');
const { validateEbookFile, ebookFileName } = require('../ebook');
const { fileDigest } = require('../file-digest');
const { FILES_DIR, TOOLBOX_DIR } = require('../paths');
const { ToolboxError, assertInside } = require('./security');

async function resolveToolFile(filePath, toolId) {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new ToolboxError('TOOL_IMPORT_PATH', '插件提供的文件路径无效');
  }
  const dataRoot = path.join(TOOLBOX_DIR, 'data');
  fs.mkdirSync(dataRoot, { recursive: true });
  const realRoot = await fs.promises.realpath(dataRoot);
  let stat;
  try {
    stat = await fs.promises.lstat(filePath);
  } catch {
    throw new ToolboxError('TOOL_IMPORT_PATH', '插件文件不存在');
  }
  if (stat.isSymbolicLink()) throw new ToolboxError('TOOL_IMPORT_PATH', '插件文件不能是符号链接');
  const real = await fs.promises.realpath(filePath);
  assertInside(realRoot, real, 'TOOL_IMPORT_PATH');
  const toolRoot = path.join(realRoot, toolId);
  assertInside(toolRoot, real, 'TOOL_IMPORT_PATH');
  const finalStat = await fs.promises.stat(real);
  if (!finalStat.isFile()) throw new ToolboxError('TOOL_IMPORT_PATH', '插件文件不是普通文件');
  return { real, size: finalStat.size };
}

function findBookByDigest(handleDb, sha256) {
  if (!sha256) return null;
  return handleDb.prepare(`
    SELECT b.id FROM book_files f JOIN books b ON b.id = f.book
    WHERE f.sha256 = ? AND b.deleted_at IS NULL LIMIT 1
  `).get(sha256) || null;
}

function findBookByTitleAuthor(handleDb, title, author) {
  return handleDb.prepare(`
    SELECT id FROM books
    WHERE deleted_at IS NULL AND lower(title) = lower(?) AND lower(author) = lower(?)
    LIMIT 1
  `).get(title, author) || null;
}

function copyIntoLibrary(sourcePath, bookId, format) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fileName = ebookFileName(bookId || 0, format);
    const target = path.join(FILES_DIR, fileName);
    try {
      fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_EXCL);
      const stat = fs.statSync(target);
      return { fileName, target, size: stat.size };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new ToolboxError('TOOL_IMPORT_FILE', '无法生成唯一的书籍文件名', 500);
}

async function importToolFile({
  toolId, filePath, title, authors = [], handleDb = defaultDb,
} = {}) {
  const cleanTitle = String(title || '').trim().slice(0, 500);
  if (!cleanTitle) throw new ToolboxError('TOOL_IMPORT_TITLE', '插件没有提供书名');
  const authorList = (Array.isArray(authors) ? authors : String(authors || '').split(/[&，、,/]+/))
    .map((name) => String(name || '').trim()).filter(Boolean).slice(0, 20);
  const author = [...new Set(authorList)].join('、');

  const resolved = await resolveToolFile(filePath, toolId);
  const formatCheck = validateEbookFile(path.basename(resolved.real), resolved.size);
  if (!formatCheck.ok) {
    throw new ToolboxError(formatCheck.code === 'VALIDATION' ? 'TOOL_IMPORT_FORMAT' : 'TOOL_IMPORT_FILE',
      formatCheck.error);
  }
  const digest = await fileDigest(resolved.real);

  const duplicate = findBookByDigest(handleDb, digest.sha256);
  if (duplicate) {
    return {
      book_id: duplicate.id,
      format: formatCheck.format,
      sha256: digest.sha256,
      dedup: 'sha256',
      existing: true,
      message: '书库已有同一文件，未重复入库',
    };
  }

  const match = author ? findBookByTitleAuthor(handleDb, cleanTitle, author) : null;
  const targetBookId = match ? match.id : null;
  const format = formatCheck.format;
  if (targetBookId && bookFiles.getFile(handleDb, targetBookId, format)) {
    throw new ToolboxError('TOOL_IMPORT_DUPLICATE',
      `书库已有《${cleanTitle}》的 ${format} 文件；不会覆盖已有正文`);
  }

  const copied = copyIntoLibrary(resolved.real, targetBookId, format);
  try {
    const result = inTransaction(handleDb, () => {
      let book;
      let dedup = '';
      if (targetBookId) {
        book = books.getBook(targetBookId, handleDb);
        dedup = 'title-author';
      } else {
        const parsed = parseBook({ title: cleanTitle, authors: authorList, status: 'wish' });
        if (parsed.errors.length) {
          throw new ToolboxError('TOOL_IMPORT_VALIDATION', parsed.errors.join(';'));
        }
        book = books.addBook(parsed.values, null, handleDb);
      }
      bookFiles.upsertFile(handleDb, book.id, {
        format,
        path: copied.fileName,
        size: copied.size,
        sha256: digest.sha256,
      });
      books.touchBook(book.id, handleDb);
      return { book_id: book.id, dedup };
    });
    return {
      book_id: result.book_id,
      format,
      sha256: digest.sha256,
      dedup: result.dedup,
      existing: false,
      message: result.dedup ? '已把新格式挂到现有书籍' : '已新建书籍并入库',
    };
  } catch (err) {
    try { fs.unlinkSync(copied.target); } catch { /* 数据库失败后清理新文件 */ }
    if (err instanceof ToolboxError) throw err;
    throw new ToolboxError('TOOL_IMPORT_DB', `写入书库失败：${err.message}`, 500);
  }
}

function getBookMetadata(bookId, handleDb = defaultDb) {
  const book = books.getBook(Number(bookId), handleDb);
  if (!book) throw new ToolboxError('BOOK_NOT_FOUND', '书籍不存在', 404);
  let tags = [];
  try { tags = JSON.parse(book.tags || '[]'); } catch { tags = []; }
  return {
    id: book.id,
    title: book.title,
    authors: String(book.author || '').split('、').filter(Boolean),
    tags: Array.isArray(tags) ? tags : [],
    publisher: book.publisher,
    pub_year: book.pub_year,
    isbn: book.isbn,
    series: book.series,
    series_index: book.series_index,
  };
}

function addTags(bookId, tags, handleDb = defaultDb) {
  const id = Number(bookId);
  const book = books.getBook(id, handleDb);
  if (!book) throw new ToolboxError('BOOK_NOT_FOUND', '书籍不存在', 404);
  let current = [];
  try { current = JSON.parse(book.tags || '[]'); } catch { current = []; }
  if (!Array.isArray(current)) current = [];
  const incoming = (Array.isArray(tags) ? tags : [tags])
    .map((tag) => String(tag || '').trim()).filter(Boolean);
  const merged = [...new Set([...current, ...incoming])];
  const parsed = parseBook({
    ...book,
    authors: String(book.author || '').split('、').filter(Boolean),
    tags: merged,
  });
  if (parsed.errors.length) throw new ToolboxError('TOOL_IMPORT_VALIDATION', parsed.errors.join(';'));
  books.updateBook(id, parsed.values, null, handleDb);
  return getBookMetadata(id, handleDb);
}

module.exports = { importToolFile, getBookMetadata, addTags, resolveToolFile };
