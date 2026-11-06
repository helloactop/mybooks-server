import { useRef, useState } from 'react';
import { Copy, Download, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DropdownMenu } from './DropdownMenu';
import type { DropdownMenuEntry } from './DropdownMenu';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { GlassDialog } from '../GlassDialog/GlassDialog';
import { GlassPopover } from '../GlassPopover/GlassPopover';
import MainLayout from '../../../layouts/MainLayout';
import '../Button/button-preview.css';
import './dropdown-menu-preview.css';

export default function DropdownMenuPreview() {
  const [status, setStatus] = useState('尚未执行操作');
  const [actions, setActions] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [controlled, setControlled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const run = (name: string) => { setStatus(`已执行演示：${name}`); setActions((count) => count + 1); };
  const items: readonly DropdownMenuEntry[] = [
    { id: 'edit', label: '编辑资料', description: '修改书名、作者和简介', icon: Pencil, onSelect: () => run('编辑资料') },
    { id: 'copy', label: '复制书名', icon: Copy, onSelect: () => run('复制书名') },
    { id: 'move', label: '移动分类', description: '暂不可用的演示操作', icon: FolderInput, disabled: true, onSelect: () => run('移动分类') },
    { id: 'export', label: '导出记录', icon: Download, onSelect: () => run('导出记录') },
    { type: 'separator', id: 'danger-section' },
    { id: 'delete', label: '移至回收站', description: '打开确认弹窗，仅更新本页演示状态', icon: Trash2, danger: true, onSelect: () => setConfirmOpen(true) },
  ];
  const alphabetItems: readonly DropdownMenuEntry[] = [
    { id: 'alpha', label: 'Alpha', onSelect: () => run('Alpha') },
    { id: 'blocked', label: 'Blocked', disabled: true, onSelect: () => run('Blocked') },
    { id: 'beta', label: 'Beta', onSelect: () => run('Beta') },
    { id: 'gamma', label: 'Gamma', onSelect: () => run('Gamma') },
  ];
  const manyItems: readonly DropdownMenuEntry[] = Array.from({ length: 25 }, (_, index) => ({ id: `action-${index + 1}`, label: `演示操作 ${String(index + 1).padStart(2, '0')}`, onSelect: () => run(`操作 ${index + 1}`) }));
  return <MainLayout><div className="button-preview dropdown-menu-preview">
    <header className="button-preview__header">
      <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span><h1>DropdownMenu</h1><p>把相关操作收进一块清晰、轻量的玻璃菜单。</p>
      <nav aria-label="组件预览" className="button-preview__nav">
        <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
        <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
        <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
        <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
        <a href="/mybooks/playground/switch">Switch</a><a href="/mybooks/playground/radio-group">RadioGroup</a>
        <a href="/mybooks/playground/select">Select</a><a href="/mybooks/playground/text-area">TextArea</a>
        <a href="/mybooks/playground/toast">Toast</a><a href="/mybooks/playground/tooltip">Tooltip</a>
        <a href="/mybooks/playground/dropdown-menu" aria-current="page">DropdownMenu</a>
        <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
      <p className="button-preview__caption">所有操作仅更新本页演示状态，不复制实际内容、不导出文件，也不修改或删除图书。</p>
      <output id="menu-action-status" className="button-preview__status" aria-live="polite">{status} · 操作 {actions} 次</output>
    </header>
    <div className="button-preview__grid">
      <section className="dropdown-menu-preview__scene" aria-labelledby="menu-material-heading">
        <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="menu-material-heading">相关操作，集中呈现</h2>
        <div className="dropdown-menu-preview__materials">
          <DropdownMenu label="图书操作" items={items} trigger={(props) => <Button {...props} variant="secondary" endIcon={MoreHorizontal}>液态菜单</Button>} />
          <DropdownMenu label="磨砂图书操作" items={items} material="frosted" trigger={(props) => <Button {...props} variant="secondary" material="frosted" endIcon={MoreHorizontal}>磨砂菜单</Button>} />
          <DropdownMenu label="实色图书操作" items={items} material="solid" trigger={(props) => <Button {...props} variant="secondary" material="solid" endIcon={MoreHorizontal}>实色菜单</Button>} />
        </div>
      </section>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">01 · KEYBOARD & FORM</span><h2>方向键与按钮行为</h2>
        <div className="dropdown-menu-preview__stack">
          <form onSubmit={(event) => { event.preventDefault(); setSubmits((count) => count + 1); }}>
            <div className="button-preview__row">
              <Button variant="ghost">菜单前按钮</Button>
              <DropdownMenu id="menu-keyboard" label="键盘演示菜单" items={alphabetItems} trigger={(props) => <Button {...props} variant="secondary">键盘操作菜单</Button>} />
              <Button variant="ghost">菜单后按钮</Button>
              <Button type="submit" variant="secondary">提交菜单演示表单</Button>
            </div>
          </form>
          <output id="menu-form-status">表单提交 {submits} 次</output>
          <p className="button-preview__caption">回车/空格或下方向键打开首项，上方向键打开末项。菜单内方向键循环、Home/End 定位、输入字母查找；Tab 离开，Esc 关闭并返回。</p>
          <DropdownMenu label="禁用触发菜单" items={items} disabled trigger={(props) => <Button {...props}>禁用的菜单按钮</Button>} />
          <DropdownMenu label="全部禁用菜单" items={[{ id: 'blocked-only', label: '暂不可用', disabled: true, onSelect: () => run('不应执行') }]} trigger={(props) => <Button {...props} variant="ghost">全部禁用示例</Button>} />
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">02 · CONTROLLED & REF</span><h2>受控开关与图标入口</h2>
        <div className="dropdown-menu-preview__stack">
          <DropdownMenu ref={menuRef} label="受控图书菜单" items={items} open={controlled} onOpenChange={setControlled}
            trigger={(props) => <IconButton {...props} icon={MoreHorizontal} label="更多图书操作" />} />
          <div className="button-preview__row"><Button variant="secondary" onClick={() => setControlled((value) => !value)}>外部切换菜单</Button>
            <Button variant="ghost" onClick={() => setStatus(`菜单引用：${menuRef.current?.getAttribute('role') ?? '尚未就绪'}`)}>检查菜单引用</Button></div>
          <output id="menu-controlled-status">受控菜单：{controlled ? '打开' : '关闭'}</output>
          <div dir="rtl"><DropdownMenu label="RTL 操作菜单" items={alphabetItems} align="start" trigger={(props) => <Button {...props} variant="secondary">RTL 菜单</Button>} /></div>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">03 · SCROLL & LONG TEXT</span><h2>长列表与窄屏</h2>
        <div className="dropdown-menu-preview__stack">
          <DropdownMenu label="长列表菜单" items={manyItems} trigger={(props) => <Button {...props} variant="secondary">打开长菜单</Button>} />
          <DropdownMenu label="长文本菜单" items={[{ id: 'long', label: '这是一条很长的操作名称，检查在手机窄屏中的换行表现', description: '说明文字同样允许换行，不会撑宽页面。' + '1234567890'.repeat(5), icon: Pencil, onSelect: () => run('长文本操作') }]}
            trigger={(props) => <Button {...props} variant="ghost">打开长文本菜单</Button>} />
          <p className="button-preview__caption">菜单最高 320px，自动翻转并限制在视口内；隐藏滚动条，保留触控和键盘滚动。</p>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">04 · DIALOG & POPOVER</span><h2>弹窗与浮层中使用</h2>
        <div className="dropdown-menu-preview__stack">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>打开菜单演示弹窗</Button>
          <GlassPopover label="菜单的宿主浮层" trigger={(props) => <Button {...props} variant="secondary">打开宿主浮层</Button>}>
            <DropdownMenu label="浮层内操作菜单" items={alphabetItems} trigger={(props) => <Button {...props} variant="secondary">浮层内打开菜单</Button>} />
          </GlassPopover>
          <p className="button-preview__caption">内层菜单关闭后，宿主保持打开。危险操作交给调用方决定是否需要确认。</p>
        </div>
      </GlassSurface>
    </div>
    <GlassDialog open={dialogOpen} onOpenChange={setDialogOpen} title="弹窗中的操作菜单" description="先关闭菜单，再关闭弹窗。">
      <DropdownMenu label="弹窗内操作菜单" items={alphabetItems} trigger={(props) => <Button {...props} variant="secondary">弹窗内打开菜单</Button>} />
    </GlassDialog>
    <GlassDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="确认演示操作" description="本次确认只更新演示计数，不会删除任何图书。"
      footer={<><Button variant="secondary" onClick={() => setConfirmOpen(false)}>取消演示删除</Button><Button variant="danger" onClick={() => { run('移至回收站'); setConfirmOpen(false); }}>确认演示删除</Button></>}>
      <p>是否执行这个演示操作？</p>
    </GlassDialog>
  </div></MainLayout>;
}
