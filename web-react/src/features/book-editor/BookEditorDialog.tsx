import { useLayoutEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ContentDialog } from '../../design-system/components/ContentDialog/ContentDialog';
import { TextField } from '../../design-system/components/TextField/TextField';
import { TextArea } from '../../design-system/components/TextArea/TextArea';
import { Button } from '../../design-system/components/Button/Button';
import { BookCover } from '../library/components/BookCover';
import { bookEditorService } from './book-editor-service';
import { emptyBook, exactMetadata, splitNames, validateBookFile, validateCoverFile } from './book-editor';
import type { BookDraft, BookEditorService, EditableBook } from './book-editor';
import './book-editor-dialog.css';

export interface BookEditorDialogProps {
  open: boolean; bookId?: number; onOpenChange: (open: boolean) => void; onSaved: () => void;
  anchorRef?: RefObject<HTMLElement | null>; service?: BookEditorService;
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('读取封面失败')); reader.readAsDataURL(file); });
}
export function BookEditorDialog({ open, bookId, onOpenChange, onSaved, anchorRef, service = bookEditorService }: BookEditorDialogProps) {
  const formId = useId();
  const [draft, setDraft] = useState<EditableBook>(emptyBook);
  const [translators, setTranslators] = useState(''); const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [filling, setFilling] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [attempt, setAttempt] = useState(0);
  const [coverData, setCoverData] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<BookDraft[]>([]); const [persisted, setPersisted] = useState(false);
  const action = useRef<AbortController | null>(null); const lookup = useRef<AbortController | null>(null);
  const coverInput = useRef<HTMLInputElement>(null); const bookInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0); const uploadedCover = useRef('');
  const apply = (book: EditableBook) => { setDraft(book); setTranslators(book.translators.join('、')); setTags(book.tags.join('、')); };
  useLayoutEffect(() => {
    generation.current++; action.current?.abort(); lookup.current?.abort();
    setError(''); setNotice(''); setCoverData(''); setFile(null); setCandidates([]); setPersisted(false); setBusy(false); setFilling(false); uploadedCover.current = '';
    apply(emptyBook());
    const cleanup = () => { action.current?.abort(); lookup.current?.abort(); generation.current++; };
    if (!open || !bookId) { setLoading(false); return cleanup; }
    const controller = new AbortController(); setLoading(true);
    void service.load(bookId, controller.signal).then(book => { if (!controller.signal.aborted) { apply(book); setLoading(false); } })
      .catch(err => { if (!controller.signal.aborted) { setError(message(err)); setLoading(false); } });
    return () => { controller.abort(); cleanup(); };
  }, [open, bookId, service, attempt]);
  const unavailable = loading || busy || filling || (bookId !== undefined && draft.id !== bookId);
  const locked = unavailable || persisted;
  const fill = (book: BookDraft) => {
    const next = { ...draft };
    for (const field of ['title', 'author', 'isbn', 'summary', 'cover'] as const) { if (book[field]) next[field] = book[field]; }
    if (book.translators.length) next.translators = book.translators;
    if (book.tags.length) next.tags = book.tags;
    apply(next); setCandidates([]); setNotice('已填充豆瓣信息，可修改后再确定');
  };
  const save = async () => {
    if (unavailable || !draft.title.trim()) return;
    const controller = new AbortController(); action.current = controller; setBusy(true); setError(''); setNotice('');
    let saved = draft;
    try {
      if (!persisted) {
        let cover = draft.cover;
        if (coverData) { uploadedCover.current ||= await service.uploadCover(coverData, controller.signal); cover = uploadedCover.current; }
        saved = await service.save({ ...draft, translators: splitNames(translators), tags: splitNames(tags), cover }, controller.signal);
        if (controller.signal.aborted) return;
        setDraft(saved); setPersisted(true);
      }
      if (file) await service.uploadBook(saved.id!, file, controller.signal);
      if (!controller.signal.aborted) { onSaved(); onOpenChange(false); }
    } catch (err) {
      if (!controller.signal.aborted) { setError(message(err)); if (saved.id && (persisted || saved !== draft)) setNotice('书籍资料已保存，书籍文件尚未确认上传成功；再次确定会重试文件上传。'); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <ContentDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title={bookId ? '编辑书籍' : '添加书籍'} closeLabel="关闭书籍编辑"
    anchorRef={anchorRef} scrollKey={`${bookId ?? 'new'}:${open}`} closeOnBackdrop={!busy} closeOnEscape={!busy} showCloseButton={!busy} className="book-editor-dialog"
    footer={<div className="book-editor-dialog__actions">
      <Button size="sm" material="liquid" variant="secondary" disabled={locked} onClick={() => coverInput.current?.click()}>封面</Button>
      <Button size="sm" material="liquid" variant="secondary" disabled={locked} onClick={() => bookInput.current?.click()}>书籍</Button>
      <Button size="sm" material="liquid" variant="secondary" disabled={locked} onClick={async () => {
        const query = draft.isbn.trim() || draft.title.trim(); if (!query) { setError('先填写 ISBN 或书名，再点击填充'); return; }
        const controller = new AbortController(); lookup.current = controller; setFilling(true); setError(''); setNotice('正在查询豆瓣…'); setCandidates([]);
        try { const rows = await service.lookup(query, controller.signal); if (controller.signal.aborted) return;
          const match = exactMetadata(rows, draft); if (match) fill(match); else if (rows.length) { setCandidates(rows); setNotice('找到多个或非精确匹配的结果，请选择对应书籍'); } else setNotice('豆瓣没有找到这本书，请检查 ISBN 或书名');
        } catch (err) { if (!controller.signal.aborted) { setError(message(err)); setNotice(''); } }
        finally { if (!controller.signal.aborted) setFilling(false); }
      }}>填充</Button>
      <Button size="sm" material="liquid" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
      <Button size="sm" material="liquid" type="submit" form={formId} disabled={unavailable || !draft.title.trim()} loading={busy} loadingLabel="保存中">确定</Button>
    </div>}>
    <input hidden ref={coverInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" aria-label="上传封面文件" onChange={async event => {
      const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!selected) return;
      const current = generation.current;
      try { validateCoverFile(selected); const data = await readImage(selected); if (generation.current === current) { setCoverData(data); uploadedCover.current = ''; setError(''); } } catch (err) { if (generation.current === current) setError(message(err)); }
    }} />
    <input hidden ref={bookInput} type="file" accept=".epub,.pdf,.mobi,.azw3,.txt" aria-label="上传书籍文件" onChange={event => {
      const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!selected) return;
      try { validateBookFile(selected); setFile(selected); setError(''); } catch (err) { setError(message(err)); }
    }} />
    {loading && <p role="status">正在载入书籍…</p>}
    {error && <p role="alert" className="book-editor-dialog__error">{error}</p>}
    {notice && <p role="status" className="book-editor-dialog__notice">{notice}</p>}
    {bookId && !loading && draft.id !== bookId && <Button size="sm" material="liquid" onClick={() => setAttempt(value => value + 1)}>重新载入</Button>}
    <form id={formId} onSubmit={event => { event.preventDefault(); void save(); }} className="book-editor-dialog__form">
      <div className="book-editor-dialog__cover">{coverData ? <img src={coverData} alt="待保存封面" /> : <BookCover title={draft.title} cover={draft.cover} loading="eager" />}
        {file && <p title={file.name}>待上传：{file.name}</p>}</div>
      <div className="book-editor-dialog__fields">
        <TextField label="书名" required maxLength={300} material="solid" disabled={locked} value={draft.title} onChange={e => setDraft({ ...draft, title: e.currentTarget.value })} />
        <TextField label="作者" material="solid" disabled={locked} value={draft.author} onChange={e => setDraft({ ...draft, author: e.currentTarget.value })} />
        <TextField label="译者" placeholder="多位译者用顿号分隔" material="solid" disabled={locked} value={translators} onChange={e => setTranslators(e.currentTarget.value)} />
        <TextField label="标签" placeholder="多个标签用顿号分隔" material="solid" disabled={locked} value={tags} onChange={e => setTags(e.currentTarget.value)} />
        <TextField label="ISBN" maxLength={20} material="solid" disabled={locked} value={draft.isbn} onChange={e => setDraft({ ...draft, isbn: e.currentTarget.value })} />
        <TextArea className="book-editor-dialog__summary" label="简介" rows={4} maxLength={1000} resize="none" material="solid" disabled={locked} value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.currentTarget.value })} />
      </div>
    </form>
    {!!candidates.length && <div className="book-editor-dialog__candidates" aria-label="豆瓣匹配结果">{candidates.map((book, index) => <Button key={index} disabled={locked} size="sm" variant="secondary" material="solid" onClick={() => fill(book)}>{book.title} · {book.author || '作者未提供'}{book.isbn && ` · ${book.isbn}`}</Button>)}</div>}
  </ContentDialog>;
}
