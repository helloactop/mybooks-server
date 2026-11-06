import { useEffect, useState } from 'react';
import { ApiError, apiGet, requestErrorMessage } from '../../shared/api';
import { bookQuery, parseLibraryBooks } from './library-books';
import type { LibraryBookPage, LoadLibraryBooks } from './library-books';
import type { LibraryLocation } from './library-navigation';

export const loadLibraryBooks: LoadLibraryBooks = async (params, signal) => {
  const { data, total } = await apiGet('/api/books?' + params, signal);
  try { return { books: parseLibraryBooks(data), total }; }
  catch { throw new ApiError('服务器返回的图书数据格式有误，请刷新后重试', 502, 'INVALID_RESPONSE'); }
};

type BooksState = LibraryBookPage & { key: string; status: 'loading' | 'ready' | 'error'; error: string };

export function useLibraryBooks(location: LibraryLocation, load: LoadLibraryBooks = loadLibraryBooks) {
  const key = bookQuery(location).toString();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BooksState>({ key, books: [], total: null, status: 'loading', error: '' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, books: [], total: null, status: 'loading', error: '' });
    void load(new URLSearchParams(key), controller.signal).then((page) => {
      if (!controller.signal.aborted) setState({ ...page, key, status: 'ready', error: '' });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key, books: [], total: null, status: 'error', error: requestErrorMessage(error) });
    });
    return () => controller.abort();
  }, [key, attempt, load]);
  // URL 已变但 effect 尚未运行时，不显示上一分类的数据或数量。
  return { ...(state.key === key ? state : { key, books: [], total: null, status: 'loading' as const, error: '' }),
    retry: () => setAttempt((value) => value + 1) };
}
