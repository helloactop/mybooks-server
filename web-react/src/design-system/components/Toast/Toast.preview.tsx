import { useRef, useState } from 'react';
import { ToastProvider, useToast } from './Toast';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import { GlassDialog } from '../GlassDialog/GlassDialog';
import { TextField } from '../TextField/TextField';
import MainLayout from '../../../layouts/MainLayout';
import '../Button/button-preview.css';
import './toast-preview.css';

function ToastExamples() {
  const { toast, dismiss, dismissAll } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [restored, setRestored] = useState(0);
  const [status, setStatus] = useState('尚未触发提示');
  const repeated = useRef(0);
  const latestId = useRef('');
  return <MainLayout><div className="button-preview toast-preview">
    <header className="button-preview__header">
      <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span><h1>Toast</h1><p>轻量反馈，保留当前操作和阅读节奏。</p>
      <nav aria-label="组件预览" className="button-preview__nav">
        <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
        <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
        <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
        <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
        <a href="/mybooks/playground/switch">Switch</a><a href="/mybooks/playground/radio-group">RadioGroup</a>
        <a href="/mybooks/playground/select">Select</a><a href="/mybooks/playground/text-area">TextArea</a>
        <a href="/mybooks/playground/toast" aria-current="page">Toast</a>
        <a href="/mybooks/playground/tooltip">Tooltip</a>
            <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a>
            <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
      <p className="button-preview__caption">所有提示和操作只用于本页演示，不保存或修改图书。</p>
      <output id="toast-demo-status" className="button-preview__status">{status}</output>
    </header>
    <div className="button-preview__grid">
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">01 · FEEDBACK</span><h2>四种语义</h2>
        <div className="toast-preview__stack">
          <p className="button-preview__caption">成功、提醒和信息默认 5 秒关闭；错误提示保留到手动关闭。</p>
          <div className="button-preview__row">
            <Button onClick={() => { toast({ title: '保存成功', description: '演示修改已保存。', variant: 'success' }); setStatus('已显示成功提示'); }}>成功提示</Button>
            <Button variant="secondary" onClick={() => toast({ title: '操作失败', description: '这是一条演示错误，请检查后重试。', variant: 'error' })}>错误提示</Button>
            <Button variant="secondary" onClick={() => toast({ title: '需要留意', description: '部分演示内容尚未填写完整。', variant: 'warning' })}>提醒提示</Button>
            <Button variant="ghost" onClick={() => toast({ title: '小提示', description: '可以继续编辑，提示不会抢走焦点。' })}>信息提示</Button>
          </div>
          <TextField label="持续编辑示例" placeholder="提示出现时可以继续输入" />
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">02 · TIMEOUT & PAUSE</span><h2>自动关闭与阅读暂停</h2>
        <div className="toast-preview__stack">
          <p className="button-preview__caption">鼠标悬停、键盘聚焦提示或切换到后台时暂停计时，离开后继续剩余时间。</p>
          <div className="button-preview__row">
            <Button variant="secondary" onClick={() => toast({ id: 'short-demo', title: '短时提示', description: '1.2 秒后自动关闭；聚焦关闭按钮可暂停。', duration: 1200 })}>短时自动关闭</Button>
            <Button variant="ghost" onClick={() => toast({ title: '保留的提示', description: '此提示需要手动关闭。', duration: 0 })}>手动关闭示例</Button>
          </div>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">03 · QUEUE & UPDATE</span><h2>有序堆叠与替换</h2>
        <div className="toast-preview__stack">
          <div className="button-preview__row">
            <Button variant="secondary" onClick={() => { dismissAll(); for (let i = 1; i <= 5; i++) toast({ id: `queue-${i}`, title: `队列提示 ${i}`, description: '关闭前面的提示，下一条会依次补位。', duration: 0 }); }}>连续显示五条</Button>
            <Button variant="ghost" onClick={() => { repeated.current++; toast({ id: 'repeat-demo', title: '同一任务的提示', description: `已更新 ${repeated.current} 次，复用一条提示。`, duration: 0 }); }}>更新同一条提示</Button>
          </div>
          <div className="button-preview__row">
            <Button variant="secondary" onClick={() => { latestId.current = toast({ title: '可由外部关闭', description: '点击“关闭最新演示提示”移除此项。', duration: 0 }); }}>记录提示标识</Button>
            <Button variant="ghost" onClick={() => dismiss(latestId.current)}>关闭最新演示提示</Button>
          </div>
          <Button variant="ghost" onClick={dismissAll}>清空所有提示</Button>
        </div>
      </GlassSurface>
      <GlassSurface material="solid" elevation="sm">
        <span className="button-preview__eyebrow">04 · ACTION & DIALOG</span><h2>附加操作与弹窗</h2>
        <div className="toast-preview__stack">
          <div className="button-preview__row">
            <Button variant="secondary" onClick={() => toast({ title: '演示内容已移除', description: '可以通过下面的操作恢复；只影响本页计数。', action: { label: '撤销演示操作', onClick: () => setRestored((count) => count + 1) } })}>带撤销的提示</Button>
            <Button variant="ghost" onClick={() => setDialogOpen(true)}>打开提示测试弹窗</Button>
          </div>
          <output id="toast-action-status">已撤销 {restored} 次</output>
          <Button variant="ghost" onClick={() => toast({ title: '长内容提示', description: '这是一段较长的演示说明，检查小屏幕中的换行与阅读。\n' + '很长的连续文本'.repeat(15), duration: 0 })}>长内容提示</Button>
          <p className="button-preview__caption">不会锁定页面滚动。聚焦提示内按钮时，Esc 仅关闭当前提示。</p>
        </div>
      </GlassSurface>
    </div>
    <GlassDialog open={dialogOpen} onOpenChange={setDialogOpen} title="弹窗内的轻提示" description="轻提示在弹窗中仍可关闭和操作。">
      <div className="toast-preview__stack">
        <TextField label="弹窗演示输入" placeholder="显示提示时焦点保持在当前操作" />
        <Button onClick={() => toast({ id: 'modal-demo', title: '弹窗中的提示', description: '提示可以在这里关闭；弹窗关闭后仍会保留。', duration: 0 })}>弹窗内显示提示</Button>
      </div>
    </GlassDialog>
  </div></MainLayout>;
}
export default function ToastPreview() { return <ToastProvider><ToastExamples /></ToastProvider>; }
