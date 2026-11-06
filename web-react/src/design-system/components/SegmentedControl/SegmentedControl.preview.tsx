import { useRef, useState } from 'react';
import { BookOpen, Check, LayoutGrid, List, LoaderCircle } from 'lucide-react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import MainLayout from '../../../layouts/MainLayout';
import { SegmentedControl } from './SegmentedControl';
import type { SegmentedControlOption } from './SegmentedControl';
import '../Button/button-preview.css';
import './segmented-control-preview.css';

const readingOptions: readonly SegmentedControlOption[] = [
  { value: 'unread', label: '未读' }, { value: 'reading', label: '在读' }, { value: 'read', label: '已读' },
];
const iconOptions: readonly SegmentedControlOption[] = [
  { value: 'unread', label: '未读', icon: BookOpen },
  { value: 'reading', label: '在读', icon: LoaderCircle },
  { value: 'read', label: '已读', icon: Check },
];
const disabledOptions: readonly SegmentedControlOption[] = [
  { value: 'available', label: '可选' }, { value: 'pending', label: '不可选', disabled: true }, { value: 'other', label: '另一项' },
];
const viewOptions: readonly SegmentedControlOption[] = [
  { value: 'grid', label: '网格', icon: LayoutGrid }, { value: 'list', label: '列表', icon: List },
];

export default function SegmentedControlPreview() {
  const [reading, setReading] = useState('unread');
  const [changes, setChanges] = useState(0);
  const [view, setView] = useState('grid');
  const [submits, setSubmits] = useState(0);
  const groupRef = useRef<HTMLDivElement>(null);

  return (
    <MainLayout>
      <div className="button-preview segmented-control-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>SegmentedControl</h1>
          <p>在少量互斥选项之间切换，选中项由玻璃滑块承托。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a>
            <a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a>
            <a href="/mybooks/playground/text-field">TextField</a>
            <a href="/mybooks/playground/segmented-control" aria-current="page">SegmentedControl</a>
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
          <p className="button-preview__caption">仅演示本页状态，不访问书库。</p>
        </header>
        <div className="button-preview__grid">
          <section className="segmented-control-preview__scene" aria-labelledby="segmented-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span>
            <h2 id="segmented-material-heading">让选中项平滑移动</h2>
            <div className="segmented-control-preview__materials">
              <div><p>液态</p><SegmentedControl label="液态材质" options={readingOptions} intensity="strong" fullWidth /></div>
              <div><p>磨砂</p><SegmentedControl label="磨砂材质" options={readingOptions} material="frosted" fullWidth /></div>
              <div><p>实色</p><SegmentedControl label="实色材质" options={readingOptions} material="solid" fullWidth /></div>
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · CONTROLLED</span><h2>阅读状态</h2>
            <div className="segmented-control-preview__stack">
              <SegmentedControl ref={groupRef} label="阅读状态" options={iconOptions} value={reading} fullWidth
                onValueChange={(next) => { setReading(next); setChanges((count) => count + 1); }} />
              <output id="segmented-reading-status" aria-live="polite">当前：{readingOptions.find((option) => option.value === reading)?.label} · 切换 {changes} 次</output>
              <div className="button-preview__row">
                <Button variant="secondary" onClick={() => setReading('unread')}>从外部设为未读</Button>
                <Button variant="ghost" onClick={() => groupRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus()}>聚焦当前选项</Button>
              </div>
              <p className="button-preview__caption">点击当前项不会重复触发变更；外部赋值会同步更新滑块。</p>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · SIZE</span><h2>三种尺寸</h2>
            <div className="segmented-control-preview__stack">
              <div><p className="button-preview__caption">小号 · 36px</p><SegmentedControl label="小号尺寸" options={readingOptions} size="sm" /></div>
              <div><p className="button-preview__caption">中号 · 44px</p><SegmentedControl label="中号尺寸" options={readingOptions} /></div>
              <div><p className="button-preview__caption">大号 · 52px</p><SegmentedControl label="大号尺寸" options={readingOptions} size="lg" /></div>
              <p className="button-preview__caption">触控环境中，每一项的点击区域至少 44px 高；长文字会自动换行。</p>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · KEYBOARD & DISABLED</span><h2>键盘与禁用</h2>
            <div className="segmented-control-preview__stack">
              <SegmentedControl label="跳过禁用项" options={disabledOptions} fullWidth />
              <SegmentedControl label="整组禁用" options={readingOptions} defaultValue="reading" disabled fullWidth />
              <p className="button-preview__caption">Tab 进入当前项；方向键循环切换，自动跳过禁用项；Home / End 跳到首尾。Enter 和空格也可选择，不显示焦点描边。</p>
              <div dir="rtl"><SegmentedControl label="从右到左" options={readingOptions} fullWidth /></div>
              <p className="button-preview__caption">上方最后一组演示 RTL 布局，左右方向键按视觉方向移动。</p>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · VIEW & FORM</span><h2>视图切换</h2>
            <form className="segmented-control-preview__stack" onSubmit={(event) => { event.preventDefault(); setSubmits((count) => count + 1); }}>
              <SegmentedControl label="显示方式" options={viewOptions} value={view} onValueChange={setView} />
              <output id="segmented-view-status">当前：{view === 'grid' ? '网格视图' : '列表视图'}</output>
              <div className="segmented-control-preview__view" data-view={view} aria-label="示例内容">
                {['书籍一', '书籍二', '书籍三'].map((book) => <span key={book}><BookOpen aria-hidden="true" />{book}</span>)}
              </div>
              <Button type="submit">提交示例</Button>
              <output id="segmented-form-status" aria-live="polite">已提交 {submits} 次</output>
              <p className="button-preview__caption">选项始终是 type="button"，切换视图不会提交表单。业务值由调用方保存。</p>
            </form>
          </GlassSurface>
        </div>
      </div>
    </MainLayout>
  );
}
