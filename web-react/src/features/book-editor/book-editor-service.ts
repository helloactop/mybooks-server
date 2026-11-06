import { apiGet, apiRequest } from '../../shared/api';
import { bookPayload, parseEditableBook } from './book-editor';
import type { BookEditorService } from './book-editor';
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const bookEditorService: BookEditorService = {
  async load(id, signal) {
    const { data } = await apiGet(`/api/books/${id}`, signal);
    const book = parseEditableBook(data);
    if (book.id !== id || !book.revision || !book.uuid) throw new Error('书籍版本数据有误，请重新载入');
    return book;
  },
  async save(book, signal) {
    const { data } = await apiRequest(book.id ? `/api/books/${book.id}` : '/api/books', {
      method: book.id ? 'PATCH' : 'POST', signal, ...json(bookPayload(book)) });
    const saved = parseEditableBook(data);
    if (!saved.id || !saved.revision || !saved.uuid) throw new Error('保存响应缺少书籍版本，请刷新书库核对');
    return saved;
  },
  async lookup(query, signal) {
    const { data } = await apiGet('/api/v1/metadata/search?q=' + encodeURIComponent(query), signal);
    if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results)) throw new Error('豆瓣返回的数据有误');
    return data.results.map(parseEditableBook);
  },
  async uploadCover(data, signal) {
    const response = await apiRequest('/api/upload', { method: 'POST', signal, ...json({ data }) });
    const row = response.data as { url?: unknown } | null;
    if (typeof row?.url !== 'string' || !row.url.startsWith('/uploads/')) throw new Error('封面上传响应有误');
    return row.url;
  },
  async uploadBook(id, file, signal) {
    const body = new FormData(); body.append('file', file);
    await apiRequest(`/api/books/${id}/file`, { method: 'POST', body, signal });
  },
};
