import { useRef, useState } from 'react';
import { ArrowDownWideNarrow, BookOpen, Filter, MoreHorizontal, Pencil, Star } from 'lucide-react';
import { GlassSurface } from '../../glass/GlassSurface';
import type { GlassMaterial } from '../../glass/glass-engine';
import { Button } from '../Button/Button';
import { TextField } from '../TextField/TextField';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl';
import { GlassDialog } from '../GlassDialog/GlassDialog';
import MainLayout from '../../../layouts/MainLayout';
import { GlassPopover } from './GlassPopover';
import '../Button/button-preview.css';
import './glass-popover-preview.css';

const materials: readonly { value: GlassMaterial; label: string }[] = [
  { value: 'liquid', label: '液态' }, { value: 'frosted', label: '磨砂' }, { value: 'solid', label: '实色' },
];
const sortOptions = [{ value: 'recent', label: '最近' }, { value: 'title', label: '书名' }, { value: 'author', label: '作者' }];

export default function GlassPopoverPreview() {
  const [lastAction, setLastAction] = useState('尚未操作');
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState('recent');
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <MainLayout>
      <div className="button-preview popover-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>GlassPopover</h1>
          <p>从按钮旁展开，容纳快捷操作、筛选与小型表单。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
            <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
            <a href="/mybooks/playground/glass-popover" aria-current="page">GlassPopover</a>
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
          <output id="popover-action-status" className="button-preview__status" aria-live="polite">最近操作：{lastAction}</output>
        </header>
        <div className="button-preview__grid">
          <section className="popover-preview__scene" aria-labelledby="popover-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="popover-material-heading">轻轻展开一个操作层</h2>
            <div className="button-preview__row">
              {materials.map(({ value, label }) => (
                <GlassPopover key={value} label={`${label}快捷操作`} material={value} size="sm"
                  onOpenChange={(next, reason) => { if (!next) setLastAction(`${label}浮层关闭：${reason}`); }}
                  trigger={(triggerProps) => <Button {...triggerProps} size="lg" material={value} startIcon={MoreHorizontal}>{label}操作</Button>}>
                  {({ close }) => <div className="popover-preview__stack">
                    <h2 className="popover-preview__title">{label}快捷操作</h2>
                    <Button variant="ghost" startIcon={BookOpen} onClick={() => { setLastAction('查看演示图书'); close(); }}>查看图书</Button>
                    <Button variant="ghost" startIcon={Pencil} onClick={() => { setLastAction('编辑演示图书'); close(); }}>编辑信息</Button>
                    <Button variant="ghost" startIcon={Star} onClick={() => { setLastAction('收藏演示图书'); close(); }}>收藏图书</Button>
                    <p className="popover-preview__caption">只记录本页状态，不访问书库。</p>
                  </div>}
                </GlassPopover>
              ))}
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · CONTROLLED</span><h2>排序与外部控制</h2>
            <div className="button-preview__row">
              <GlassPopover label="排序选项" open={sortOpen} onOpenChange={(next, reason) => { setSortOpen(next); setLastAction(`排序浮层：${next ? '打开' : '关闭'} · ${reason}`); }}
                trigger={(triggerProps) => <Button {...triggerProps} startIcon={ArrowDownWideNarrow}>设置排序</Button>}>
                {({ close }) => <div className="popover-preview__stack">
                  <h2 className="popover-preview__title">排序方式</h2>
                  <SegmentedControl label="排序方式" options={sortOptions} value={sort} onValueChange={setSort} fullWidth />
                  <p className="popover-preview__caption">当前：{sortOptions.find((option) => option.value === sort)?.label}</p>
                  <Button onClick={close}>应用排序</Button>
                </div>}
              </GlassPopover>
              <Button variant="secondary" onClick={() => setSortOpen((current) => !current)}>外部切换排序浮层</Button>
            </div>
            <p className="button-preview__caption">aria-expanded 与受控开关同步。再次点击触发按钮、Esc 或点击外部可关闭。</p>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · FORM & FOCUS</span><h2>小型筛选表单</h2>
            <GlassPopover label="快速筛选" initialFocusRef={searchRef} align="end"
              trigger={(triggerProps) => <Button {...triggerProps} variant="secondary" startIcon={Filter}>打开筛选</Button>}>
              {({ close }) => <form className="popover-preview__stack" onSubmit={(event) => {
                event.preventDefault(); const data = new FormData(event.currentTarget); setQuery(String(data.get('query') ?? '')); close();
              }}>
                <h2 className="popover-preview__title">快速筛选</h2>
                <TextField ref={searchRef} label="筛选关键词" type="search" name="query" placeholder="输入书名或作者" autoComplete="off" />
                <div className="popover-preview__actions"><Button type="button" variant="secondary" onClick={close}>取消筛选</Button><Button type="submit">应用筛选</Button></div>
              </form>}
            </GlassPopover>
            <p id="popover-query-status" className="popover-preview__result">筛选内容：{query || '尚未输入'}</p>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · POSITION & SCROLL</span><h2>边缘与长内容</h2>
            <p className="button-preview__caption">空间不足自动翻转，上下滚动时跟随按钮；正文滚动条隐藏。</p>
            <div className="popover-preview__edge">
              <GlassPopover label="长列表选项" size="lg" align="end"
                trigger={(triggerProps) => <Button {...triggerProps} variant="secondary">展开长列表</Button>}>
                {({ close }) => <div className="popover-preview__stack"><h2 className="popover-preview__title">长列表选项</h2>
                  {Array.from({ length: 16 }, (_, index) => <Button key={index} variant="ghost" fullWidth onClick={() => { setLastAction(`选择演示选项 ${index + 1}`); close(); }}>演示选项 {index + 1}</Button>)}
                </div>}
              </GlassPopover>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · OVERFLOW CONTAINER</span><h2>滚动容器内的按钮</h2>
            <div className="popover-preview__scrollbox" tabIndex={0}>
              <p className="button-preview__caption">浮层可以越过这个容器的裁切边界。</p>
              <GlassPopover label="滚动容器浮层" size="sm"
                trigger={(triggerProps) => <Button {...triggerProps} variant="secondary">容器内展开</Button>}>
                {({ close }) => <div className="popover-preview__stack"><h2 className="popover-preview__title">跟随触发按钮</h2><p>滚动容器时同步位置，按钮完全移出可见区域后关闭。</p><Button onClick={close}>知道了</Button></div>}
              </GlassPopover>
              <div className="popover-preview__spacer" aria-hidden="true" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">05 · INSIDE DIALOG</span><h2>弹窗中的浮层</h2>
            <p className="button-preview__caption">在 GlassDialog 内仍可显示。先按 Esc 关闭浮层，再按一次关闭弹窗。</p>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>打开组合示例</Button>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">06 · KEYBOARD</span><h2>沿用原生按钮交互</h2>
            <p className="button-preview__caption">Enter / 空格打开，Esc 关闭并回到触发按钮；Tab 可以离开浮层。沿用 32px 圆角，不加焦点描边。</p>
            <GlassPopover label="禁用触发示例" trigger={(triggerProps) => <Button {...triggerProps} variant="secondary" disabled>禁用触发按钮</Button>}><p>禁用按钮不会打开此浮层。</p></GlassPopover>
          </GlassSurface>
        </div>
      </div>
      <GlassDialog open={dialogOpen} onOpenChange={setDialogOpen} title="弹窗中的浮层" closeLabel="关闭组合弹窗"
        footer={<Button onClick={() => setDialogOpen(false)}>完成组合示例</Button>}>
        <div className="popover-preview__stack"><p>浮层与触发按钮保留在同一 DOM 上下文中。</p>
          <GlassPopover label="弹窗内筛选" size="sm" trigger={(triggerProps) => <Button {...triggerProps} variant="secondary">弹窗内展开</Button>}>
            {({ close }) => <div className="popover-preview__stack"><h3 className="popover-preview__title">弹窗内筛选</h3><TextField label="弹窗内关键词" placeholder="输入内容" /><Button onClick={close}>完成浮层操作</Button></div>}
          </GlassPopover>
        </div>
      </GlassDialog>
    </MainLayout>
  );
}
