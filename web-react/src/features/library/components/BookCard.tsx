import { BookCover } from './BookCover';
import { Pencil } from 'lucide-react';
import { IconButton } from '../../../design-system/components/IconButton/IconButton';
import type { LibraryBook } from '../library-books';
import './book-card.css';

export interface BookCardProps {
  book: LibraryBook;
  onOpen?: () => void;
  onEdit?: () => void;
}

/** 业务展示组件：不获取数据、不编辑书籍，可复用于分类与搜索结果。 */
export function BookCard({ book, onOpen, onEdit }: BookCardProps) {
  const title = book.title || '未命名图书';
  return <article className="book-card">
    {onOpen && <button type="button" className="book-card__open" aria-label={`查看《${title}》详情`} title={title} onClick={onOpen} />}
    <BookCover className="book-card__cover" title={title} cover={book.cover} />
    <div className="book-card__heading"><h2 className="book-card__title" title={title}>{title}</h2>
      {onEdit && <IconButton className="book-card__edit" icon={Pencil} label={`编辑《${title}》`} size="sm" material="solid" variant="ghost" onClick={onEdit} />}</div>
    {book.author && <p className="book-card__author" title={book.author}>{book.author}</p>}
    {!!book.translators.length && <p className="book-card__translators" title={'译者：' + book.translators.join('、')}>译者：{book.translators.join('、')}</p>}
  </article>;
}
