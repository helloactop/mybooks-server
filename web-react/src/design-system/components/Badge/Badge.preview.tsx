import { useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, Clock, Tag, TriangleAlert } from 'lucide-react';
import { Badge } from './Badge';
import { Chip } from '../Chip/Chip';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import MainLayout from '../../../layouts/MainLayout';
import '../Button/button-preview.css';
import './badge-preview.css';

const demoTags = [{ id: 'fiction', label: '小说' }, { id: 'history', label: '历史' }, { id: 'science', label: '科学' }];

export default function BadgePreview() {
  const [selected, setSelected] = useState<string[]>(['fiction']);
  const [tags, setTags] = useState(demoTags);
  const [choice, setChoice] = useState(false);
  const [combinedVisible, setCombinedVisible] = useState(true);
  const [extraVisible, setExtraVisible] = useState({ long: true, rtl: true });
  const [removes, setRemoves] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [changes, setChanges] = useState(0);
  const chipRefs = useRef(new Map<string, HTMLSpanElement>());
  const resetRef = useRef<HTMLButtonElement>(null);
  const combinedResetRef = useRef<HTMLButtonElement>(null);
  const extraResetRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const next = chipRefs.current.get(pendingFocus.current)?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    (next ?? resetRef.current)?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [tags]);
  const removeTag = (id: string) => {
    const index = tags.findIndex((tag) => tag.id === id);
    const root = chipRefs.current.get(id);
    if (root?.contains(document.activeElement)) pendingFocus.current = tags[index + 1]?.id ?? tags[index - 1]?.id ?? '';
    setTags((current) => current.filter((tag) => tag.id !== id));
    setRemoves((count) => count + 1);
  };
  return <MainLayout><div className="button-preview badge-preview">
    <header className="button-preview__header">
      <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span><h1>Badge / Chip</h1><p>清晰呈现状态、数量和筛选条件。</p>
      <nav aria-label="组件预览" className="button-preview__nav">
        <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
        <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
        <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
        <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
        <a href="/mybooks/playground/switch">Switch</a><a href="/mybooks/playground/radio-group">RadioGroup</a>
        <a href="/mybooks/playground/select">Select</a><a href="/mybooks/playground/text-area">TextArea</a>
        <a href="/mybooks/playground/toast">Toast</a><a href="/mybooks/playground/tooltip">Tooltip</a>
        <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a><a href="/mybooks/playground/badge" aria-current="page">Badge / Chip</a>
        <a href="/mybooks/books/all">书库</a>
          </nav>
      <p className="button-preview__caption">所有标签、选择和移除操作只更新本页演示状态，不修改书库。</p>
    </header>
    <div className="button-preview__grid">
      <section className="badge-preview__scene" aria-labelledby="badge-material-heading">
        <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="badge-material-heading">轻巧的标签，也有统一材质</h2>
        <div className="badge-preview__materials">
          <div><span>液态材质</span><Badge material="liquid" icon={BookOpen}>在读</Badge><Chip material="liquid" label="液态标签" icon={Tag} /></div>
          <div><span>磨砂材质</span><Badge material="frosted" icon={BookOpen}>在读</Badge><Chip material="frosted" label="磨砂标签" icon={Tag} /></div>
          <div><span>实色材质 · 默认</span><Badge icon={BookOpen}>在读</Badge><Chip label="实色标签" icon={Tag} /></div>
        </div>
      </section>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">01 · BADGE</span><h2>状态与数量</h2>
        <div className="badge-preview__stack">
          <div className="badge-preview__row"><Badge>未读</Badge><Badge tone="accent" icon={BookOpen}>在读</Badge><Badge tone="success" icon={CheckCircle2}>已读</Badge><Badge tone="warning" icon={Clock}>待处理</Badge><Badge tone="danger" icon={TriangleAlert}>导入失败</Badge></div>
          <div className="badge-preview__row"><span>数量：</span><Badge aria-label="0 本图书">{0}</Badge><Badge tone="accent" aria-label="12 本图书">{12}</Badge><Badge>99+</Badge></div>
          <div className="badge-preview__row"><Badge size="sm">小号标签</Badge><Badge>中号标签</Badge><Badge size="lg">大号标签</Badge></div>
          <Badge>这是一段较长的状态说明，会在窄屏中换行，不会撑宽页面。</Badge>
          <p className="button-preview__caption">Badge 只展示信息，不增加按钮或 Tab 停靠点。颜色和文字一起表达状态。</p>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">02 · SELECTABLE CHIP</span><h2>选择筛选条件</h2>
        <div className="badge-preview__stack">
          <div className="badge-preview__row" role="group" aria-label="演示分类筛选">
            {demoTags.map((tag) => <Chip key={tag.id} label={tag.label} selectable selected={selected.includes(tag.id)}
              onSelectedChange={(next) => { setSelected((current) => next ? [...current, tag.id] : current.filter((id) => id !== tag.id)); setChanges((count) => count + 1); }} />)}
          </div>
          <output id="chip-selection-status" aria-live="polite">已选：{demoTags.filter((tag) => selected.includes(tag.id)).map((tag) => tag.label).join('、') || '无'} · 变更 {changes} 次</output>
          <Button variant="ghost" onClick={() => setSelected([])}>清空 Chip 选择</Button>
          <div className="badge-preview__row"><Chip label="非受控选择" selectable defaultSelected /><Chip label="禁用的选择" selectable defaultSelected disabled /></div>
          <p className="button-preview__caption">回车或空格切换，选中后显示勾选标记，不添加焦点描边。</p>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">03 · REMOVABLE CHIP</span><h2>移除标签与焦点衔接</h2>
        <div className="badge-preview__stack">
          <div className="badge-preview__row" role="group" aria-label="演示可移除标签">
            {tags.map((tag) => <Chip key={tag.id} ref={(node) => { if (node) chipRefs.current.set(tag.id, node); else chipRefs.current.delete(tag.id); }}
              label={tag.label} icon={Tag} onRemove={() => removeTag(tag.id)} />)}
          </div>
          <output id="chip-removal-status" aria-live="polite">剩余 {tags.length} 项 · 已移除 {removes} 次</output>
          <Button ref={resetRef} variant="secondary" onClick={() => setTags(demoTags)}>恢复演示标签</Button>
          <Chip label="不可移除的禁用标签" onRemove={() => setRemoves((count) => count + 1)} disabled />
          <p className="button-preview__caption">关闭按钮支持回车、空格、Delete 和 Backspace；移除后焦点转到相邻标签，全部移除后转到恢复按钮。</p>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">04 · COMPOSITION & FORM</span><h2>选择和移除各自独立</h2>
        <div className="badge-preview__stack">
          <form onSubmit={(event) => { event.preventDefault(); setSubmits((count) => count + 1); }}>
            <div className="badge-preview__row">{combinedVisible && <Chip label="可选择且可移除" selectable selected={choice} onSelectedChange={setChoice}
              onRemove={() => { setRemoves((count) => count + 1); setCombinedVisible(false); combinedResetRef.current?.focus({ preventScroll: true }); }}
              removeLabel="演示移除组合标签" />}<Button type="submit" variant="secondary">提交标签示例表单</Button></div>
          </form>
          <output id="chip-combined-status" aria-live="polite">组合标签：{combinedVisible ? choice ? '选中' : '未选中' : '已移除'} · 表单提交 {submits} 次</output>
          <Button ref={combinedResetRef} variant="ghost" onClick={() => setCombinedVisible(true)}>恢复组合标签</Button>
          <fieldset disabled className="badge-preview__fieldset"><legend>父 fieldset 禁用</legend><Chip label="继承禁用的标签" selectable material="liquid" onRemove={() => setRemoves((count) => count + 1)} /></fieldset>
          <div className="badge-preview__row"><Chip label="小号 Chip" size="sm" selectable /><Chip label="中号 Chip" selectable /><Chip label="大号 Chip" size="lg" selectable /></div>
          {extraVisible.long && <Chip label="这是一条较长的可移除标签，文字自然换行，移除按钮保持可点击" icon={Tag}
            onRemove={() => { setExtraVisible((current) => ({ ...current, long: false })); extraResetRef.current?.focus({ preventScroll: true }); }} />}
          {extraVisible.rtl && <div dir="rtl"><Chip label="RTL 标签示例" selectable defaultSelected
            onRemove={() => { setExtraVisible((current) => ({ ...current, rtl: false })); extraResetRef.current?.focus({ preventScroll: true }); }} /></div>}
          <Button ref={extraResetRef} variant="ghost" onClick={() => setExtraVisible({ long: true, rtl: true })}>恢复长文本与 RTL 示例</Button>
        </div>
      </GlassSurface>
    </div>
  </div></MainLayout>;
}
