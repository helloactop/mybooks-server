import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { IconButton } from '../../../design-system/components/IconButton/IconButton';
import { Button } from '../../../design-system/components/Button/Button';
import { BOOK_PAGE_SIZE } from '../library-books';
import type { LibraryBook, LoadLibraryBooks } from '../library-books';
import { BookDetailDialog } from '../../book-detail/BookDetailDialog';
import type { LoadBookDetail } from '../../book-detail/book-detail';
import type { LibraryLocation } from '../library-navigation';
import { useLibraryBooks } from '../useLibraryBooks';
import { BookCard } from './BookCard';
import { LibraryFilters } from './LibraryFilters';
import type { LibraryFacets } from '../useLibraryFacets';
import './library-books.css';

export function LibraryBooks({ location, title, onNavigate, load, facets, loadBook, dialogAnchorRef, onAdd, onEdit }: {
  onAdd?: () => void; onEdit?: (id: number) => void;
  location: LibraryLocation; title: string; onNavigate: (location: LibraryLocation) => void; load?: LoadLibraryBooks; facets: LibraryFacets; loadBook?: LoadBookDetail; dialogAnchorRef?: RefObject<HTMLElement | null>;
}) {
  const state = useLibraryBooks(location, load);
  const rootRef = useRef<HTMLElement>(null);
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const page = location.page ?? 1;
  const count = state.total;
  const pages = count === null ? null : Math.max(1, Math.ceil(count / BOOK_PAGE_SIZE));
  const next = count === null ? state.books.length === BOOK_PAGE_SIZE : page < pages!;
  useEffect(() => {
    const content = rootRef.current?.closest('.main-layout__content');
    if (content) content.scrollTop = 0;
  }, [location.view, location.query, location.collectionId, location.folderId, location.sort, location.author, location.publisher, location.translator, page]);
  // 其他设备删除图书后，原来的最后一页可能不复存在，回到新的末页。
  useEffect(() => {
    if (state.status === 'ready' && pages !== null && page > pages) onNavigate({ ...location, page: pages > 1 ? pages : undefined });
  }, [state.status, pages, page, location, onNavigate]);
  return <section className="library-books" ref={rootRef} aria-label={title}>
    <header className="library-books__header"><div className="library-books__heading"><div className="library-books__title-row"><h1>{title}</h1>{onAdd && <IconButton icon={Plus} label="添加书籍" size="sm" material="solid" variant="ghost" onClick={onAdd} />}</div>
      <p className="library-books__count" role="status">{state.status === 'loading' ? '正在载入图书…' : state.status === 'error' ? '图书载入失败'
        : count === null ? `本页 ${state.books.length} 本图书` : `共 ${count} 本图书`}{location.query && ` · 搜索“${location.query}”`}</p></div>
      <LibraryFilters location={location} facets={facets} onNavigate={onNavigate} />
    </header>
    {state.status === 'loading' && <div className="library-books__state" role="status">正在载入图书…</div>}
    {state.status === 'error' && <div className="library-books__state" role="alert"><p>{state.error}</p><Button material="solid" size="sm" variant="secondary" onClick={state.retry}>重新载入</Button></div>}
    {state.status === 'ready' && !state.books.length && <div className="library-books__state"><BookOpen aria-hidden="true" /><p>{location.query ? '没有找到匹配的图书' : '这里还没有图书'}</p>
      <span>{location.query ? '试试其他关键词，或清除搜索条件。' : '点击标题旁的加号添加书籍。'}</span></div>}
    {state.status === 'ready' && !!state.books.length && <ul className="library-books__grid" aria-label="图书列表">{state.books.map((book) => <li key={book.id}>
      <BookCard book={book} onEdit={onEdit ? () => onEdit(book.id) : undefined} onOpen={() => { setSelectedBook(book); setDetailOpen(true); }} /></li>)}</ul>}
    {state.status === 'ready' && (page > 1 || next) && <nav className="library-books__pagination" aria-label="图书分页">
      <Button startIcon={ChevronLeft} size="sm" variant="secondary" material="solid" disabled={page <= 1} onClick={() => onNavigate({ ...location, page: page > 2 ? page - 1 : undefined })}>上一页</Button>
      <span>第 {page} 页{pages !== null && ` / 共 ${pages} 页`}</span>
      <Button endIcon={ChevronRight} size="sm" variant="secondary" material="solid" disabled={!next} onClick={() => onNavigate({ ...location, page: page + 1 })}>下一页</Button>
    </nav>}
    <BookDetailDialog book={selectedBook} open={detailOpen} onOpenChange={setDetailOpen} load={loadBook} anchorRef={dialogAnchorRef} />
  </section>;
}
