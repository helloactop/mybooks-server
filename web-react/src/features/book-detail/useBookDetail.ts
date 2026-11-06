import { useEffect, useState } from 'react';
import { ApiError, apiGet, requestErrorMessage } from '../../shared/api';
import { parseBookDetail } from './book-detail';
import type { BookDetail, LoadBookDetail } from './book-detail';

export const loadBookDetail: LoadBookDetail = async (id, signal) => {
  const { data } = await apiGet('/api/books/' + id, signal);
  try { return parseBookDetail(data, id); }
  catch { throw new ApiError('服务器返回的图书详情有误，请重试', 502, 'INVALID_RESPONSE'); }
};

export function useBookDetail(id: number | undefined, open: boolean, load: LoadBookDetail = loadBookDetail) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ id?: number; detail: BookDetail | null; status: 'loading' | 'ready' | 'error'; error: string }>({ detail: null, status: 'loading', error: '' });
  useEffect(() => {
    if (!open || !id) return;
    const controller = new AbortController();
    setState({ id, detail: null, status: 'loading', error: '' });
    void load(id, controller.signal).then((detail) => {
      if (!controller.signal.aborted) setState({ id, detail, status: 'ready', error: '' });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ id, detail: null, status: 'error', error: requestErrorMessage(error) });
    });
    return () => controller.abort();
  }, [id, open, attempt, load]);
  return { ...(state.id === id ? state : { detail: null, status: 'loading' as const, error: '' }), retry: () => setAttempt((value) => value + 1) };
}
