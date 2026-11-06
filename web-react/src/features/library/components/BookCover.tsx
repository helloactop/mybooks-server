import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { bookCoverSource } from '../library-books';
import './book-cover.css';

export function BookCover({ title, cover, className, loading = 'lazy' }: {
  title: string; cover: string; className?: string; loading?: 'lazy' | 'eager';
}) {
  const source = bookCoverSource(cover);
  const [failedSource, setFailedSource] = useState<string>();
  return <div className={['book-cover', className].filter(Boolean).join(' ')}>
    {source && failedSource !== source
      ? <img className="book-cover__image" src={source} alt="" loading={loading} decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
      : <div className="book-cover__placeholder" aria-hidden="true"><BookOpen /><span>{title || '未命名图书'}</span></div>}
  </div>;
}
