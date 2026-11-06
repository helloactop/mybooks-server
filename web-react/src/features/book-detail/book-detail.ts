export interface BookDetail {
  id: number; title: string; author: string; translators: readonly string[]; cover: string;
  isbn: string; rating: number | null; summary: string; tags: readonly string[];
}
export type LoadBookDetail = (id: number, signal: AbortSignal) => Promise<BookDetail>;

export function parseBookDetail(data: unknown, expectedId: number): BookDetail {
  if (!data || typeof data !== 'object') throw new Error('invalid-book-detail');
  const row = data as Record<string, unknown>;
  if (row.id !== expectedId || typeof row.title !== 'string') throw new Error('invalid-book-detail');
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const rating = Number(row.rating);
  let tags: unknown = row.tags;
  if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
  return { id: expectedId, title: row.title, cover: text(row.cover), author: text(row.author), isbn: text(row.isbn), summary: text(row.summary),
    translators: Array.isArray(row.translators) ? row.translators.filter((name): name is string => typeof name === 'string' && !!name.trim()) : [],
    rating: Number.isFinite(rating) && rating > 0 && rating <= 10 ? rating : null,
    tags: Array.isArray(tags) ? [...new Set(tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))] : [] };
}
