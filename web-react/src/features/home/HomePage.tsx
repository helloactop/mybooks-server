import { useEffect, useState } from 'react';
import { apiGet, requestErrorMessage } from '../../shared/api';
import { parseLibraryBooks } from '../library/library-books';
import type { LibraryBook } from '../library/library-books';
import { BookCard } from '../library/components/BookCard';
import { Button } from '../../design-system/components/Button/Button';
import { IconButton } from '../../design-system/components/IconButton/IconButton';
import { Plus } from 'lucide-react';
import '../library/components/library-books.css';

export function HomePage({ books: suppliedBooks, onOpenBook, onAdd, onEdit, refreshKey }: { books?: readonly LibraryBook[]; onOpenBook: (book: LibraryBook) => void; onAdd?: () => void; onEdit?: (id: number) => void; refreshKey?: number }) {
  const [books, setBooks] = useState<readonly LibraryBook[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (suppliedBooks) return;
    const controller = new AbortController(); setStatus('loading'); setError('');
    void apiGet('/api/public/home/feed?grid=4&ent=16', controller.signal, { publicAccess: true }).then(({ data }) => {
      if (controller.signal.aborted) return;
      if (!data || typeof data !== 'object') throw new Error('invalid-home');
      const feed = data as Record<string, unknown>;
      const rows = [feed.featured, ...(Array.isArray(feed.grid) ? feed.grid : []), ...(Array.isArray(feed.gallery) ? feed.gallery : [])].filter(Boolean);
      setBooks([...new Map(parseLibraryBooks(rows).map((book) => [book.id, book])).values()]); setStatus('ready');
    }).catch((err: unknown) => { if (!controller.signal.aborted) { setStatus('error'); setError(requestErrorMessage(err)); } });
    return () => controller.abort();
  }, [suppliedBooks, attempt, refreshKey]);
  const rows = suppliedBooks ?? books;
  const actualStatus = suppliedBooks ? 'ready' : status;
  return <section className="library-books" aria-label="首页"><header className="library-books__header"><div className="library-books__heading"><div className="library-books__title-row"><h1>首页</h1>{onAdd && <IconButton icon={Plus} label="添加书籍" size="sm" material="solid" variant="ghost" onClick={onAdd} />}</div><p className="library-books__count">书库精选</p></div></header>
    {actualStatus === 'loading' && <p role="status">正在载入首页…</p>}
    {actualStatus === 'error' && <div role="alert"><p>{error}</p><Button material="solid" size="sm" onClick={() => setAttempt((value) => value + 1)}>重新载入</Button></div>}
    {actualStatus === 'ready' && !rows.length && <p className="library-books__state">书库中暂时没有图书</p>}
    {actualStatus === 'ready' && !!rows.length && <ul className="library-books__grid" aria-label="首页图书">{rows.map((book) => <li key={book.id}><BookCard book={book} onEdit={onEdit ? () => onEdit(book.id) : undefined} onOpen={() => onOpenBook(book)} /></li>)}</ul>}
  </section>;
}
