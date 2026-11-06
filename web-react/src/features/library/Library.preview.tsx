import LibraryWorkspace from './LibraryWorkspace';
import type { LibraryBook, LoadLibraryBooks } from './library-books';
import { bookPayload, emptyBook, parseEditableBook } from '../book-editor/book-editor';
import type { BookEditorService, EditableBook } from '../book-editor/book-editor';
import type { LoadBookDetail } from '../book-detail/book-detail';
import mountainsCover from './preview-mountains.svg?no-inline';
import timeCover from './preview-time.svg?no-inline';

// 只在开发预览中使用；不访问个人书库，也不会打入生产构建。
const titles = ['星河漫游', '山海之间', '雨天的书店', '时间的回声', '寻找远方', '城市与花园', '纸上的旅行', '日常的光'];
const books: LibraryBook[] = Array.from({ length: 65 }, (_, index) => ({ id: index + 1,
  title: `${titles[index % titles.length]}${index >= titles.length ? ` · ${Math.floor(index / titles.length) + 1}` : ''}`,
  author: ['林一', '陈远', '许知', '周南'][index % 4], translators: index % 3 === 0 ? ['李青', '江明'] : [],
  publisher: ['青禾文学出版社', '远山出版工作室', '星海出版社'][index % 3],
  cover: index % 8 === 1 ? mountainsCover : index % 8 === 3 ? timeCover : '', status: ['wish', 'reading', 'done'][index % 3] }));
const loadBooks: LoadLibraryBooks = async (params, signal) => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  let rows = [...books];
  const status = params.get('status');
  if (status) rows = rows.filter((book) => book.status === status);
  if (params.has('author_exact')) rows = rows.filter((book) => book.author === params.get('author_exact'));
  if (params.has('publisher')) rows = rows.filter((book) => book.publisher === params.get('publisher'));
  if (params.has('translator')) rows = rows.filter((book) => book.translators.includes(params.get('translator')!));
  if (params.has('collection')) rows = rows.filter((book) => book.id % 2 === 0);
  const query = params.get('q') ?? '';
  if (query.includes('format:PDF')) rows = rows.filter((book) => book.id % 5 === 0);
  else if (query.includes('format:true')) rows = rows.filter((book) => book.id % 2 === 0);
  const text = query.replace(/\bformat:(PDF|true)\b/g, '').replace(/\band\b/g, '').replace(/[()]/g, '').trim();
  if (text) rows = rows.filter((book) => (book.title + book.author).includes(text));
  if (params.get('sort') === 'title') rows.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  else if (params.get('sort') === 'author') rows.sort((a, b) => a.author.localeCompare(b.author, 'zh-CN'));
  else rows.reverse();
  const start = Number(params.get('start') ?? 0);
  return { books: rows.slice(start, start + Number(params.get('size'))), total: rows.length };
};

const edited = new Map<number, EditableBook>();
const loadBook: LoadBookDetail = async (id, signal) => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const book = books.find((row) => row.id === id);
  if (!book) throw new Error('图书不存在');
  const summary = '这是一段用于查看图书详情布局的演示简介。故事从一间安静的书店出发，记录旅行中的山川、城市与普通人的日常。\n\n书页之间串联起不同的观察和回忆，也为每一次重读留下一点新的发现。';
  if (edited.has(id)) return { ...book, rating: null, ...edited.get(id)!, id };
  return { ...book, isbn: id % 2 ? '' : '9780000000001', rating: id % 5 ? 8.6 : null, tags: ['文学', '旅行', '观察'],
    summary: id === 58 ? Array(6).fill(summary).join('\n\n') : id % 5 ? summary : '' };
};

const editorService: BookEditorService = {
  async load(id, signal) { return { ...parseEditableBook(await loadBook(id, signal)), revision: edited.get(id)?.revision ?? 1, uuid: `demo-${id}` }; },
  async save(book) {
    bookPayload(book);
    const id = book.id ?? Math.max(...books.map(row => row.id)) + 1;
    const saved = { ...book, id, revision: (book.revision ?? 0) + 1, uuid: `demo-${id}` };
    edited.set(id, saved);
    const row = { ...saved, publisher: '', status: 'wish' };
    const index = books.findIndex(item => item.id === id);
    if (index < 0) books.push(row); else books[index] = { ...books[index], ...row };
    return saved;
  },
  async lookup(query) { return [{ ...emptyBook(), title: '山海之间', author: '陈远', translators: ['李青', '江明'], tags: ['文学', '旅行'], isbn: /^[-\d\s]+$/.test(query) ? query : '9780000000001', summary: '豆瓣填充流程的演示内容，仅在当前预览中使用。', cover: mountainsCover }]; },
  async uploadCover() { return mountainsCover; },
  async uploadBook() { /* 演示上传，不写入服务器。 */ },
};

export default function LibraryPreview({ guest = false }: { guest?: boolean }) {
  return <LibraryWorkspace editorService={editorService} collections={[{ id: '1', name: '我的图书' }, { id: '2', name: '阅读计划' }]} loadBooks={loadBooks} loadBook={loadBook} homeBooks={books.slice(0, 12)} guestPreview={guest}
    basePath={guest ? '/mybooks/playground/guest' : '/mybooks/playground/library'}
    facets={{ authors: [...new Set(books.map((book) => book.author))], publishers: [...new Set(books.map((book) => book.publisher))], translators: [...new Set(books.flatMap((book) => book.translators))] }} />;
}
