import { useRef, useState } from 'react';
import { BookOpen, Heart, Info, MoreHorizontal, Settings } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { GlassDialog } from '../GlassDialog/GlassDialog';
import { GlassPopover } from '../GlassPopover/GlassPopover';
import { Switch } from '../Switch/Switch';
import MainLayout from '../../../layouts/MainLayout';
import '../Button/button-preview.css';
import './tooltip-preview.css';

export default function TooltipPreview() {
  const [clicks, setClicks] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, setState] = useState('尚未显示提示');
  const actionRef = useRef<HTMLButtonElement | null>(null);
  return <MainLayout><div className="button-preview tooltip-preview">
    <header className="button-preview__header">
      <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span><h1>Tooltip</h1><p>为图标操作补充简短、清晰的说明。</p>
      <nav aria-label="组件预览" className="button-preview__nav">
        <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
        <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
        <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
        <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
        <a href="/mybooks/playground/switch">Switch</a><a href="/mybooks/playground/radio-group">RadioGroup</a>
        <a href="/mybooks/playground/select">Select</a><a href="/mybooks/playground/text-area">TextArea</a>
        <a href="/mybooks/playground/toast">Toast</a><a href="/mybooks/playground/tooltip" aria-current="page">Tooltip</a>
        <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a>
            <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
      <p className="button-preview__caption">所有按钮仅用于本页演示，不访问或修改书库。鼠标悬停或用 Tab 聚焦按钮查看提示。</p>
    </header>
    <div className="button-preview__grid">
      <section className="tooltip-preview__scene" aria-labelledby="tooltip-material-heading">
        <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="tooltip-material-heading">给操作一行解释</h2>
        <div className="tooltip-preview__materials">
          <div><span>液态材质</span><Tooltip content="把这本书加入收藏" trigger={(props) => <IconButton {...props} icon={Heart} label="收藏图书" />} /></div>
          <div><span>磨砂材质</span><Tooltip content="打开阅读记录" material="frosted" trigger={(props) => <IconButton {...props} icon={BookOpen} label="阅读记录" />} /></div>
          <div><span>实色材质</span><Tooltip content="调整书库显示设置" material="solid" trigger={(props) => <IconButton {...props} icon={Settings} label="书库设置" />} /></div>
        </div>
      </section>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">01 · KEYBOARD & ACTION</span><h2>键盘与原有操作</h2>
        <div className="tooltip-preview__stack">
          <p className="button-preview__caption">键盘聚焦立即显示，Esc 关闭并保留焦点；回车/空格照常激活按钮。</p>
          <form onSubmit={(event) => { event.preventDefault(); setSubmits((count) => count + 1); }}>
            <div className="button-preview__row">
              <Tooltip id="tooltip-action" content="显示操作说明，保留按钮原有行为" aria-describedby="tooltip-external-help" disabled={disabled}
                onOpenChange={(open) => setState(open ? '操作提示已显示' : '操作提示已关闭')}
                trigger={(props) => <Button {...props} id="tooltip-focus-source" ref={(node) => { props.ref.current = node; actionRef.current = node; }}
                  onClick={() => setClicks((count) => count + 1)}>演示操作</Button>} />
              <Button type="submit" variant="secondary">提交演示表单</Button>
            </div>
          </form>
          <p id="tooltip-external-help" className="button-preview__caption">此按钮同时保留外部说明关联，默认不提交表单。</p>
          <output id="tooltip-action-status">按钮操作 {clicks} 次 · 表单提交 {submits} 次</output>
          <output id="tooltip-open-status">{state}</output>
          <Button variant="ghost" onClick={() => actionRef.current?.focus()}>聚焦演示操作</Button>
          <Switch label="关闭演示操作的 Tooltip" checked={disabled} onCheckedChange={setDisabled} />
          <Tooltip content="当前不可用的操作" trigger={(props) => <Button {...props} disabled>禁用的原生按钮</Button>} />
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">02 · PLACEMENT</span><h2>方向、换行与边界</h2>
        <div className="tooltip-preview__stack">
          <div className="button-preview__row">
            <Tooltip content="优先显示在按钮上方，空间不足时自动翻转。" trigger={(props) => <Button {...props} variant="secondary">上方提示</Button>} />
            <Tooltip content="优先显示在按钮下方，保持可读边距。" side="bottom" trigger={(props) => <Button {...props} variant="secondary">下方提示</Button>} />
          </div>
          <Tooltip content={'这是一条较长的说明，会在手机窄屏中自然换行，限制在可视区域内。\n连续文本同样可以换行：' + '1234567890'.repeat(10)}
            trigger={(props) => <Button {...props} variant="ghost">长说明提示</Button>} />
          <div dir="rtl"><Tooltip content="从右侧起点对齐，适配 RTL。" side="bottom" align="start" trigger={(props) => <Button {...props} variant="secondary">RTL 提示</Button>} /></div>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">03 · OVERFLOW</span><h2>滚动容器内的提示</h2>
        <div className="tooltip-preview__scroll">
          <p className="button-preview__caption">提示可越过容器裁切边界；按钮离开可视范围时关闭。</p>
          <Tooltip content="即使按钮位于可滚动容器内，提示也能完整显示。" side="bottom" trigger={(props) => <Button {...props} variant="secondary">容器内提示</Button>} />
          <div className="tooltip-preview__scroll-space">继续向下滚动</div>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">04 · DIALOG & POPOVER</span><h2>嵌套使用</h2>
        <div className="tooltip-preview__stack">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>打开 Tooltip 弹窗</Button>
          <GlassPopover label="带说明的快捷操作" trigger={(props) => <Button {...props} variant="secondary" startIcon={MoreHorizontal}>打开快捷操作</Button>}>
            <div className="tooltip-preview__stack"><p>提示不会关闭当前快捷操作面板。</p>
              <Tooltip content="这条提示位于浮层内部，Esc 优先关闭提示。" trigger={(props) => <IconButton {...props} icon={Info} label="浮层中的说明" />} />
            </div>
          </GlassPopover>
          <p className="button-preview__caption">Tooltip 只放文字，不放按钮、链接或表单；需要操作时使用 Popover。</p>
        </div>
      </GlassSurface>
    </div>
    <GlassDialog open={dialogOpen} onOpenChange={setDialogOpen} title="弹窗里的 Tooltip" description="用 Tab 聚焦说明按钮，第一次 Esc 只关闭提示。">
      <div className="tooltip-preview__stack">
        <Tooltip content="弹窗中的说明同样使用玻璃材质，保持当前焦点。" trigger={(props) => <IconButton {...props} icon={Info} label="弹窗中的说明" />} />
        <Button variant="secondary" onClick={() => setDialogOpen(false)}>完成 Tooltip 演示</Button>
      </div>
    </GlassDialog>
  </div></MainLayout>;
}
