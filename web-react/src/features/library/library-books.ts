import type { LibraryLocation, LibrarySort } from './library-navigation';

export const BOOK_PAGE_SIZE = 48;
export interface LibraryBook {
  id: number;
  title: string;
  author: string;
  publisher: string;
  translators: readonly string[];
  cover: string;
  status: string;
}
export interface LibraryBookPage { books: readonly LibraryBook[]; total: number | null; }
export type LoadLibraryBooks = (params: URLSearchParams, signal: AbortSignal) => Promise<LibraryBookPage>;

export function isBookView(view: LibraryLocation['view']) {
  return ['all', 'unread', 'finished', 'ebooks', 'pdf', 'collection', 'folder'].includes(view);
}

export function effectiveSort(location: LibraryLocation): LibrarySort {
  return location.sort === 'relevance' && !location.query.trim() ? 'updated' : location.sort ?? (location.query.trim() ? 'relevance' : 'updated');
}

export function bookQuery(location: LibraryLocation): URLSearchParams {
  const params = new URLSearchParams();
  const query = location.query.trim();
  // 将用户查询整体括起来，避免其中的 or 绕过格式筛选。由既有服务端解析搜索语法。
  const format = location.view === 'pdf' ? 'format:PDF' : location.view === 'ebooks' ? 'format:true' : '';
  if (query || format) params.set('q', query && format ? `(${query}) and ${format}` : query || format);
  if (location.view === 'unread') params.set('status', 'wish');
  if (location.view === 'finished') params.set('status', 'done');
  if (location.view === 'collection' && location.collectionId) params.set('collection', location.collectionId);
  if (location.view === 'folder' && location.folderId) params.set('folder', location.folderId);
  if (location.author) params.set('author_exact', location.author);
  if (location.publisher) params.set('publisher', location.publisher);
  if (location.translator) params.set('translator', location.translator);
  params.set('sort', effectiveSort(location));
  params.set('size', String(BOOK_PAGE_SIZE));
  const page = location.page ?? 1;
  // 深链接输入过大的页码时回到第一页，避免不安全的 offset。
  const start = (page - 1) * BOOK_PAGE_SIZE;
  params.set('start', String(Number.isSafeInteger(start) && start >= 0 ? start : 0));
  return params;
}

export function parseLibraryBooks(data: unknown): readonly LibraryBook[] {
  if (!Array.isArray(data)) throw new Error('invalid-books');
  return data.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || !Number.isSafeInteger(item.id) || Number(item.id) <= 0 ||
      !('title' in item) || typeof item.title !== 'string') throw new Error('invalid-book');
    const row = item as Record<string, unknown>;
    return { id: Number(row.id), title: item.title, author: typeof row.author === 'string' ? row.author : '', publisher: typeof row.publisher === 'string' ? row.publisher : '',
      cover: typeof row.cover === 'string' ? row.cover : '', status: typeof row.status === 'string' ? row.status : '',
      translators: Array.isArray(row.translators) ? row.translators.filter((name): name is string => typeof name === 'string' && !!name.trim()) : [] };
  });
}

export function bookCoverSource(raw: string): string | undefined {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url)) return '/api/img-proxy?url=' + encodeURIComponent(url);
  // 只允许同源绝对路径，不把 javascript/data 或协议相对地址交给图片标签。
  if (/^\/(?!\/)/.test(url) && !/[\\\u0000-\u0020]/.test(url)) return url;
  return undefined;
}
