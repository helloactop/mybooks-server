import { useId, useRef, useState } from 'react';
import { BookOpen, Pencil, Rows3, ShieldCheck } from 'lucide-react';
import { GlassSurface } from '../../glass/GlassSurface';
import type { GlassMaterial } from '../../glass/glass-engine';
import { Button } from '../Button/Button';
import { TextField } from '../TextField/TextField';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl';
import MainLayout from '../../../layouts/MainLayout';
import { GlassDialog } from './GlassDialog';
import type { GlassDialogCloseReason, GlassDialogSize } from './GlassDialog';
import '../Button/button-preview.css';
import './glass-dialog-preview.css';

const materialOptions = [{ value: 'liquid', label: '液态' }, { value: 'frosted', label: '磨砂' }, { value: 'solid', label: '实色' }] as const;
const sizeOptions = [{ value: 'sm', label: '小号' }, { value: 'md', label: '中号' }, { value: 'lg', label: '大号' }] as const;
const reasons: Record<GlassDialogCloseReason, string> = { escape: 'Esc', backdrop: '遮罩', 'close-button': '关闭按钮', native: '原生关闭' };

export default function GlassDialogPreview() {
  const [material, setMaterial] = useState<GlassMaterial>('liquid');
  const [size, setSize] = useState<GlassDialogSize>('md');
  const [basicOpen, setBasicOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [longOpen, setLongOpen] = useState(false);
  const [lockedOpen, setLockedOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const [lastClose, setLastClose] = useState('尚未关闭弹窗');
  const [savedTitle, setSavedTitle] = useState('尚未保存');
  const titleRef = useRef<HTMLInputElement>(null);
  const nativeDialogRef = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const change = (setter: (value: boolean) => void) => (next: boolean, reason: GlassDialogCloseReason) => {
    setter(next);
    if (!next) setLastClose(`最近关闭方式：${reasons[reason]}`);
  };
  const finish = (setter: (value: boolean) => void) => {
    setter(false);
    setLastClose('最近关闭方式：操作按钮');
  };

  return (
    <MainLayout>
      <div className="button-preview dialog-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>GlassDialog</h1>
          <p>把内容放到玻璃之上，保留清晰的标题与操作。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a>
            <a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a>
            <a href="/mybooks/playground/text-field">TextField</a>
            <a href="/mybooks/playground/segmented-control">SegmentedControl</a>
            <a href="/mybooks/playground/glass-dialog" aria-current="page">GlassDialog</a>
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
          <output id="dialog-close-status" className="button-preview__status" aria-live="polite">{lastClose}</output>
        </header>
        <div className="button-preview__grid">
          <section className="dialog-preview__scene" aria-labelledby="dialog-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质与尺寸</span>
            <h2 id="dialog-material-heading">一个独立的内容层</h2>
            <div className="dialog-preview__settings">
              <div><p>面板材质</p><SegmentedControl label="弹窗材质" options={materialOptions} value={material} onValueChange={(next) => setMaterial(next as GlassMaterial)} fullWidth /></div>
              <div><p>面板宽度</p><SegmentedControl label="弹窗尺寸" options={sizeOptions} value={size} onValueChange={(next) => setSize(next as GlassDialogSize)} fullWidth /></div>
            </div>
            <Button id="dialog-basic-trigger" size="lg" startIcon={BookOpen} onClick={() => setBasicOpen(true)}>打开基础弹窗</Button>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · FORM & FOCUS</span><h2>表单与焦点</h2>
            <p className="button-preview__caption">打开后聚焦书名，复用 TextField 与 Button；保存只更新本页文字。</p>
            <div className="button-preview__row"><Button id="dialog-form-trigger" startIcon={Pencil} onClick={() => setFormOpen(true)}>打开编辑示例</Button></div>
            <output id="dialog-save-status" aria-live="polite">保存结果：{savedTitle}</output>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · SCROLL</span><h2>长内容滚动</h2>
            <p className="button-preview__caption">标题和底部操作保持可见，中间正文独立滚动，背景页面锁定。</p>
            <Button id="dialog-long-trigger" variant="secondary" startIcon={Rows3} onClick={() => setLongOpen(true)}>打开长内容</Button>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · DISMISS</span><h2>关闭行为</h2>
            <p className="button-preview__caption">默认支持 Esc、遮罩和关闭按钮。此示例关闭前两项并隐藏右上角按钮，只能从底部返回。</p>
            <Button id="dialog-locked-trigger" variant="secondary" startIcon={ShieldCheck} onClick={() => setLockedOpen(true)}>打开受控关闭示例</Button>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · KEYBOARD</span><h2>键盘与多层弹窗</h2>
            <p className="button-preview__caption">Tab 保持在当前模态弹窗中，关闭后回到打开它的按钮。基础弹窗还可以打开子弹窗；关闭子层后，父层继续保持模态状态。</p>
            <p className="button-preview__caption">沿用 32px 圆角，不添加焦点描边。全部操作只影响组件预览。</p>
          </GlassSurface>
        </div>
      </div>

      <GlassDialog ref={nativeDialogRef} open={basicOpen} onOpenChange={change(setBasicOpen)} title="玻璃弹窗"
        description="这是组件预览，所有操作只影响本页。" material={material} size={size} closeLabel="关闭基础弹窗"
        footer={<><Button variant="secondary" onClick={() => finish(setBasicOpen)}>取消</Button><Button onClick={() => finish(setBasicOpen)}>完成</Button></>}>
        <div className="dialog-preview__content">
          <p>标题、正文与底部操作共用一层玻璃材质。你可以先切换预览页的材质和尺寸，再打开查看。</p>
          <p>按 Esc 或点击面板外的遮罩即可关闭。选中文字、在内容中拖动，不会触发遮罩关闭。</p>
          <Button variant="secondary" onClick={() => setChildOpen(true)}>打开子弹窗</Button>
          <Button variant="ghost" onClick={() => nativeDialogRef.current?.close()}>原生关闭弹窗</Button>
        </div>
      </GlassDialog>
      <GlassDialog open={childOpen} onOpenChange={change(setChildOpen)} title="子弹窗" size="sm" material={material}
        description="当前只有最上层弹窗可以操作。" closeLabel="关闭子弹窗"
        footer={<Button onClick={() => finish(setChildOpen)}>返回父弹窗</Button>}>
        <p className="dialog-preview__paragraph">关闭这一层后，焦点回到父弹窗的打开按钮，背景仍保持锁定。</p>
      </GlassDialog>
      <GlassDialog open={formOpen} onOpenChange={change(setFormOpen)} title="编辑图书示例"
        description="使用演示字段，不读写真实书库。" material={material} initialFocusRef={titleRef} closeLabel="关闭编辑弹窗"
        footer={<><Button variant="secondary" onClick={() => finish(setFormOpen)}>取消编辑</Button><Button type="submit" form={formId}>保存示例</Button></>}>
        <form id={formId} className="dialog-preview__form" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get('title') ?? '').trim();
          if (!name) { titleRef.current?.focus(); return; }
          setSavedTitle(name);
          finish(setFormOpen);
        }}>
          <TextField ref={titleRef} label="书名" name="title" defaultValue="阅读的乐趣" required maxLength={120} autoComplete="off" />
          <TextField label="作者" name="author" placeholder="输入作者" autoComplete="off" />
          <p className="dialog-preview__paragraph">表单在正文中，保存按钮位于固定操作区，通过 form 属性关联。</p>
        </form>
      </GlassDialog>
      <GlassDialog open={longOpen} onOpenChange={change(setLongOpen)} title="长内容示例" size="lg" material={material}
        description="中间区域滚动，标题与操作区保持可见。" closeLabel="关闭长内容弹窗"
        footer={<Button onClick={() => finish(setLongOpen)}>阅读完成</Button>}>
        <div className="dialog-preview__long">
          {Array.from({ length: 16 }, (_, index) => (
            <section key={index}><h3>第 {index + 1} 段 · 阅读笔记示例</h3><p>这里是用于检验滚动的演示内容。正文超过可用高度时，只滚动面板中间区域。底部的操作按钮始终可见，背景页面不会跟着滚动。窄屏下，文字会根据面板宽度自动换行。</p></section>
          ))}
        </div>
      </GlassDialog>
      <GlassDialog open={lockedOpen} onOpenChange={change(setLockedOpen)} title="受控关闭示例" size="sm" material={material}
        description="此示例保留弹窗，直到点击底部按钮。" closeOnEscape={false} closeOnBackdrop={false} showCloseButton={false}
        footer={<Button onClick={() => finish(setLockedOpen)}>返回预览</Button>}>
        <p className="dialog-preview__paragraph">Esc 和遮罩点击均不会关闭。业务页面可在保存期间使用这些选项，仍需提供明确的离开方式。</p>
      </GlassDialog>
    </MainLayout>
  );
}
