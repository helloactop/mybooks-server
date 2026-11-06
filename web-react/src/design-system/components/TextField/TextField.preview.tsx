import { useRef, useState } from 'react';
import { BookOpen, LockKeyhole, Mail, Search } from 'lucide-react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import MainLayout from '../../../layouts/MainLayout';
import { TextField } from './TextField';
import '../Button/button-preview.css';
import './text-field-preview.css';

export default function TextFieldPreview() {
  const [query, setQuery] = useState('');
  const [isbn, setIsbn] = useState('123');
  const [validated, setValidated] = useState(false);
  const [submits, setSubmits] = useState(0);
  const [formStatus, setFormStatus] = useState('尚未提交');
  const searchRef = useRef<HTMLInputElement>(null);
  const isbnError = validated && !/^(?:\d{10}|\d{13})$/.test(isbn) ? '请输入 10 位或 13 位数字 ISBN（演示校验）。' : undefined;

  return (
    <MainLayout>
      <div className="button-preview text-field-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>TextField</h1>
          <p>清晰的标签、稳定的输入，以及背景上的液态折射。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a>
            <a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a>
            <a href="/mybooks/playground/text-field" aria-current="page">TextField</a>
            <a href="/mybooks/playground/segmented-control">SegmentedControl</a>
            <a href="/mybooks/playground/glass-dialog">GlassDialog</a>
            <a href="/mybooks/playground/glass-popover">GlassPopover</a>
            <a href="/mybooks/playground/checkbox">Checkbox</a>
            <a href="/mybooks/playground/switch">Switch</a>
            <a href="/mybooks/playground/radio-group">RadioGroup</a>
            <a href="/mybooks/playground/select">Select</a>
            <a href="/mybooks/playground/text-area">TextArea</a>
            <a href="/mybooks/playground/toast">Toast</a>
            <a href="/mybooks/playground/tooltip">Tooltip</a>
            <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a>
            <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
          <p className="button-preview__caption">所有输入只保留在本页，不访问或修改书库。</p>
        </header>
        <div className="button-preview__grid">
          <section className="text-field-preview__scene" aria-labelledby="field-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span>
            <h2 id="field-material-heading">让背景穿过输入框</h2>
            <div className="text-field-preview__materials">
              <TextField label="液态材质" placeholder="输入试试看" startIcon={Search} intensity="strong" />
              <TextField label="磨砂材质" placeholder="输入试试看" startIcon={Search} material="frosted" />
              <TextField label="实色材质" placeholder="输入试试看" startIcon={Search} material="solid" />
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · INPUT</span><h2>输入与图标</h2>
            <div className="text-field-preview__stack">
              <TextField ref={searchRef} id="field-search" label="搜索图书" type="search" startIcon={Search}
                placeholder="书名、作者或 ISBN" description="支持连续输入，外部状态同步显示。"
                value={query} onChange={(event) => setQuery(event.target.value)} aria-describedby="field-external-help" />
              <output id="field-query-status">搜索内容：{query || '尚未输入'}</output>
              <p id="field-external-help" className="button-preview__caption">此示例同时保留调用方的说明关联。</p>
              <Button variant="secondary" onClick={() => searchRef.current?.focus()}>聚焦搜索输入框</Button>
              <TextField label="图书名称" startIcon={BookOpen} defaultValue="阅读的乐趣" description="非受控输入，初始值由 defaultValue 提供。" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · VALIDATION</span><h2>说明与错误</h2>
            <div className="text-field-preview__stack">
              <TextField label="ISBN" value={isbn} onChange={(event) => setIsbn(event.target.value)}
                description="这里只演示位数校验，不校验 ISBN 校验码。" error={isbnError} inputMode="numeric" />
              <Button variant="secondary" onClick={() => setValidated(true)}>校验 ISBN</Button>
              <TextField label="错误状态示例" defaultValue="不完整的内容" error="请补充完整内容。" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · SIZE & STATES</span><h2>尺寸与状态</h2>
            <div className="text-field-preview__stack">
              <TextField label="小号输入框" size="sm" placeholder="36px · 触控至少 44px" />
              <TextField label="中号输入框" placeholder="44px · 默认尺寸" />
              <TextField label="大号输入框" size="lg" placeholder="52px" />
              <TextField label="只读字段" defaultValue="来自服务器的标识" readOnly description="可聚焦、复制，并参与表单提交。" />
              <TextField label="禁用字段" defaultValue="暂不可编辑" disabled description="不可编辑，也不参与表单提交。" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · PASSWORD & FORM</span><h2>密码与原生表单</h2>
            <form className="text-field-preview__stack" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setSubmits((value) => value + 1);
              setFormStatus(`表单验证通过 · 邮箱：${data.get('email')} · 只读字段：${data.has('readonly') ? '已包含' : '缺失'} · 禁用字段：${data.has('disabled') ? '已包含' : '未包含'}`);
            }}>
              <TextField label="邮箱" name="email" type="email" autoComplete="email" required startIcon={Mail} placeholder="reader@example.com" />
              <TextField id="field-password" label="预览密码" name="password" type="password" autoComplete="new-password"
                minLength={6} required startIcon={LockKeyhole} description="输入至少 6 位；眼睛按钮只切换显示，不提交表单。" />
              <TextField label="表单只读字段" name="readonly" defaultValue="只读示例" readOnly />
              <TextField label="表单禁用字段" name="disabled" defaultValue="禁用示例" disabled />
              <div className="button-preview__row"><Button type="submit">提交示例</Button><Button type="reset" variant="secondary">重置表单</Button></div>
              <output id="field-form-count" aria-live="polite">已提交 {submits} 次</output>
              <output id="field-form-status" aria-live="polite">{formStatus}</output>
            </form>
          </GlassSurface>
        </div>
      </div>
    </MainLayout>
  );
}
