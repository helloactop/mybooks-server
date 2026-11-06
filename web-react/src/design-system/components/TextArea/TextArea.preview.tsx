import { useId, useRef, useState } from 'react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import { TextArea } from './TextArea';
import MainLayout from '../../../layouts/MainLayout';
import '../Button/button-preview.css';
import './text-area-preview.css';

export default function TextAreaPreview() {
  const [notes, setNotes] = useState('');
  const [nativeEvents, setNativeEvents] = useState(0);
  const [changes, setChanges] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [formStatus, setFormStatus] = useState('尚未提交');
  const formId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  return <MainLayout><div className="button-preview text-area-preview">
    <header className="button-preview__header">
      <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span><h1>TextArea</h1>
      <p>简介、备注和读书心得的多行输入。</p>
      <nav aria-label="组件预览" className="button-preview__nav">
        <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
        <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
        <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
        <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
        <a href="/mybooks/playground/switch">Switch</a><a href="/mybooks/playground/radio-group">RadioGroup</a>
        <a href="/mybooks/playground/select">Select</a><a href="/mybooks/playground/text-area" aria-current="page">TextArea</a>
        <a href="/mybooks/playground/toast">Toast</a>
            <a href="/mybooks/playground/tooltip">Tooltip</a>
            <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a>
            <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
      <p className="button-preview__caption">所有输入仅保留在本页，不访问或修改书库。</p>
    </header>
    <div className="button-preview__grid">
      <section className="text-area-preview__scene" aria-labelledby="area-material-heading">
        <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="area-material-heading">给长文字留出空间</h2>
        <div className="text-area-preview__materials">
          <TextArea label="液态多行文本框" rows={3} placeholder="写下一段阅读感受……" />
          <TextArea label="磨砂多行文本框" rows={3} material="frosted" placeholder="写下一段阅读感受……" />
          <TextArea label="实色多行文本框" rows={3} material="solid" placeholder="写下一段阅读感受……" />
        </div>
      </section>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">01 · INPUT</span><h2>多行输入与外部状态</h2>
        <div className="text-area-preview__stack">
          <TextArea ref={inputRef} id="area-notes" label="阅读备注" value={notes} onValueChange={(next) => { setNotes(next); setChanges((count) => count + 1); }}
            onChange={() => setNativeEvents((count) => count + 1)} maxLength={120} placeholder="记录几句想法，按回车换行。"
            description="输入长度上限为 120，支持连续编辑和换行。" aria-describedby="area-external-help" />
          <output id="area-count" aria-live="polite">{notes.length} / 120 · 值回调 {changes} 次 · 原生事件 {nativeEvents} 次</output>
          <p id="area-external-help" className="button-preview__caption">16px 文字，支持换行、复制和粘贴，不添加焦点描边。</p>
          <div className="button-preview__row"><Button variant="secondary" onClick={() => inputRef.current?.focus()}>聚焦阅读备注</Button><Button variant="ghost" onClick={() => setNotes('')}>清空阅读备注</Button></div>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">02 · STATES</span><h2>错误、只读与禁用</h2>
        <div className="text-area-preview__stack">
          <TextArea label="错误多行文本框" description="演示说明与错误同时关联。" error="请补充完整的内容。" defaultValue="待补充的内容" />
          <TextArea label="只读多行文本框" defaultValue="这段文字可以选择和复制。" readOnly rows={2} />
          <fieldset disabled className="text-area-preview__fieldset"><legend>父 fieldset 禁用</legend><TextArea label="禁用多行文本框" defaultValue="暂不可编辑" rows={2} /></fieldset>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">03 · ROWS & RESIZE</span><h2>行数与拖动高度</h2>
        <div className="text-area-preview__stack">
          <TextArea label="两行文本框" rows={2} placeholder="可在支持的桌面浏览器中纵向拖动。" />
          <TextArea label="固定高度文本框" rows={3} resize="none" defaultValue={Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行：长内容可以在文本框内滚动。`).join('\n')} />
          <div dir="rtl"><TextArea label="RTL 多行文本框" rows={2} defaultValue="نص تجريبي" /></div>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">04 · NATIVE FORM</span><h2>原生表单与重置</h2>
        <form id={formId} className="text-area-preview__stack" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget); setSubmits((count) => count + 1);
          setFormStatus(`正文：${data.get('body')} · 外部字段：${data.get('external')} · 只读字段${data.has('readonly') ? '已包含' : '未包含'} · 禁用字段${data.has('disabled') ? '已包含' : '未包含'}`);
        }} onReset={() => setFormStatus('表单已重置')}>
          <TextArea label="必填正文" name="body" required rows={3} placeholder="输入正文再提交。" />
          <TextArea label="表单只读内容" name="readonly" defaultValue="只读示例" readOnly rows={1} />
          <TextArea label="表单禁用内容" name="disabled" defaultValue="禁用示例" disabled rows={1} />
          <div className="button-preview__row"><Button type="submit">提交多行文本示例</Button><Button type="reset" variant="secondary">重置多行文本表单</Button></div>
          <output id="area-form-count" aria-live="polite">已提交 {submits} 次</output><output id="area-form-status" aria-live="polite">{formStatus}</output>
        </form>
        <div className="text-area-preview__external"><TextArea label="表单外备注" name="external" defaultValue="外部备注" rows={2} form={formId} /></div>
      </GlassSurface>
    </div>
  </div></MainLayout>;
}
