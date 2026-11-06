export interface BookDraft {
  title: string; author: string; translators: string[]; tags: string[]; isbn: string; summary: string; cover: string;
}
export interface EditableBook extends BookDraft { id?: number; revision?: number; uuid?: string }
export interface BookEditorService {
  load: (id: number, signal: AbortSignal) => Promise<EditableBook>;
  save: (book: EditableBook, signal: AbortSignal) => Promise<EditableBook>;
  lookup: (query: string, signal: AbortSignal) => Promise<BookDraft[]>;
  uploadCover: (data: string, signal: AbortSignal) => Promise<string>;
  uploadBook: (id: number, file: File, signal: AbortSignal) => Promise<void>;
}
export const emptyBook = (): EditableBook => ({ title: '', author: '', translators: [], tags: [], isbn: '', summary: '', cover: '' });
export function splitNames(value: string): string[] { return [...new Set(value.split(/[、，,;；\n]+/).map(s => s.trim()).filter(Boolean))]; }
function names(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(Boolean))];
  if (typeof value !== 'string') return [];
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return names(parsed); } catch { /* 历史文本 */ }
  return splitNames(value);
}
export function parseEditableBook(data: unknown): EditableBook {
  if (!data || typeof data !== 'object') throw new Error('服务器返回的书籍数据有误');
  const row = data as Record<string, unknown>;
  if (typeof row.title !== 'string') throw new Error('服务器返回的书籍数据有误');
  const text = (v: unknown) => typeof v === 'string' ? v : '';
  return { title: row.title, author: text(row.author), translators: names(row.translators), tags: names(row.tags),
    isbn: text(row.isbn), summary: text(row.summary), cover: text(row.cover),
    ...(Number.isSafeInteger(row.id) && Number(row.id) > 0 ? { id: Number(row.id) } : {}),
    ...(Number.isSafeInteger(row.revision) && Number(row.revision) > 0 ? { revision: Number(row.revision) } : {}),
    ...(typeof row.uuid === 'string' && row.uuid ? { uuid: row.uuid } : {}) };
}
export function bookPayload(book: EditableBook) {
  if (!book.title.trim()) throw new Error('请填写书名');
  if (book.id && (!book.revision || !book.uuid)) throw new Error('缺少书籍版本，请重新打开编辑');
  return { title: book.title.trim(), author: book.author.trim(), translators: book.translators, tags: book.tags,
    isbn: book.isbn.trim(), summary: book.summary, cover: book.cover,
    ...(book.id ? { expected_revision: book.revision, expected_uuid: book.uuid } : {}) };
}
export function validateBookFile(file: Pick<File, 'name' | 'size'>) {
  if (!/\.(epub|pdf|mobi|azw3|txt)$/i.test(file.name)) throw new Error('支持 EPUB、PDF、MOBI、AZW3、TXT 文件');
  if (!file.size || file.size > 80 * 1024 * 1024) throw new Error('书籍文件不能为空，且不能超过 80MB');
}
export function validateCoverFile(file: Pick<File, 'type' | 'size'>) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('封面支持 JPG、PNG、GIF、WebP');
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('封面不能为空，且不能超过 5MB');
}
export function exactMetadata(rows: BookDraft[], book: BookDraft): BookDraft | undefined {
  const isbn = (v: string) => v.replace(/[-\s]/g, '').toUpperCase();
  const matched = book.isbn.trim() ? rows.filter(row => isbn(row.isbn) === isbn(book.isbn))
    : rows.filter(row => row.title.trim().toLocaleLowerCase() === book.title.trim().toLocaleLowerCase());
  return matched.length === 1 ? matched[0] : undefined;
}
