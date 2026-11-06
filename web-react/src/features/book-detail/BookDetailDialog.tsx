import type { RefObject } from 'react';
import { ContentDialog } from '../../design-system/components/ContentDialog/ContentDialog';
import { Chip } from '../../design-system/components/Chip/Chip';
import { BookCover } from '../library/components/BookCover';
import type { LibraryBook } from '../library/library-books';
import type { LoadBookDetail } from './book-detail';
import { useBookDetail } from './useBookDetail';
import './book-detail-dialog.css';

export interface BookDetailDialogProps {
  book: LibraryBook | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  load?: LoadBookDetail;
  anchorRef?: RefObject<HTMLElement | null>;
}

/** 只读业务弹窗：列表卡片与后续其他入口可共用，不包含编辑或状态变更。 */
export function BookDetailDialog({ book, open, onOpenChange, load, anchorRef }: BookDetailDialogProps) {
  const state = useBookDetail(book?.id, open, load);
  const current = state.detail ?? book;
  return <ContentDialog open={open} onOpenChange={onOpenChange} title={current?.title || '图书详情'} closeLabel="关闭图书详情"
    anchorRef={anchorRef} scrollKey={book?.id} className="book-detail-dialog">
    {current && <div className="book-detail-dialog__grid">
      <div className="book-detail-dialog__left">
        <BookCover title={current.title} cover={current.cover} loading="eager" />
        <dl className="book-detail-dialog__credits"><div><dt>作者</dt><dd>{current.author || '未提供'}</dd></div>
          {!!current.translators.length && <div><dt>译者</dt><dd>{current.translators.join('、')}</dd></div>}</dl>
      </div>
      <div className="book-detail-dialog__right" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <p role="status">正在载入图书详情…</p>}
        {state.status === 'error' && <div role="alert"><p>{state.error}</p></div>}
        {state.detail && <><section className="book-detail-dialog__summary"><h3>简介</h3><p>{state.detail.summary || '暂无简介'}</p></section>
          <dl className="book-detail-dialog__metadata"><div className="book-detail-dialog__isbn"><dt>ISBN</dt><dd>{state.detail.isbn || '未提供'}</dd></div>
            <div className="book-detail-dialog__rating"><dt>评分</dt><dd>{state.detail.rating === null ? '暂无评分' : `${state.detail.rating} / 10`}</dd></div>
            <div className="book-detail-dialog__tag-field"><dt>标签</dt><dd className="book-detail-dialog__tags">{state.detail.tags.length
              ? state.detail.tags.map((tag) => <Chip key={tag} label={tag} title={tag} material="solid" size="sm" />) : '暂无标签'}</dd></div></dl></>}
      </div>
    </div>}
  </ContentDialog>;
}
