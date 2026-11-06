import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import { GlassSurface } from '../../glass/GlassSurface';
import MainLayout from '../../../layouts/MainLayout';
import { Button } from './Button';
import './button-preview.css';

export default function ButtonPreview() {
  const [clicks, setClicks] = useState(0);
  const [lastAction, setLastAction] = useState('尚未触发');
  const [loading, setLoading] = useState(false);
  const [submits, setSubmits] = useState(0);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const record = (label: string) => {
    setClicks((value) => value + 1);
    setLastAction(label);
  };
  const simulateSave = () => {
    setLoading(true);
    timer.current = window.setTimeout(() => {
      setLoading(false);
      timer.current = null;
      record('模拟保存完成');
    }, 2500);
  };

  return (
    <MainLayout>
      <div className="button-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>Button</h1>
          <p>浅蓝主题、32px 圆角，以及完整的原生按钮交互。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a>
            <a href="/mybooks/playground/button" aria-current="page">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a>
            <a href="/mybooks/playground/text-field">TextField</a>
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
          <output className="button-preview__status" aria-live="polite">点击次数：{clicks} · 最近操作：{lastAction}</output>
        </header>
        <div className="button-preview__grid">
          <section className="button-preview__glass-scene" aria-labelledby="button-glass-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span>
            <h2 id="button-glass-heading">让背景穿过按钮</h2>
            <p>纹理背景下可以清楚比较边缘折射、磨砂和实色的差别。</p>
            <div className="button-preview__row">
              <Button id="button-liquid-example" size="lg" intensity="strong" startIcon={Plus} onClick={() => record('液态按钮')}>液态按钮</Button>
              <Button material="frosted" size="lg" startIcon={Search} onClick={() => record('磨砂按钮')}>磨砂按钮</Button>
              <Button material="solid" size="lg" startIcon={BookOpen} onClick={() => record('实色按钮')}>实色按钮</Button>
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · VARIANTS</span>
            <h2>操作层级</h2>
            <div className="button-preview__row">
              <Button id="button-primary" onClick={() => record('主要按钮')}>主要按钮</Button>
              <Button variant="secondary" onClick={() => record('次要按钮')}>次要按钮</Button>
              <Button variant="ghost" onClick={() => record('轻量按钮')}>轻量按钮</Button>
              <Button variant="danger" startIcon={Trash2} onClick={() => record('危险操作示例')}>危险操作</Button>
            </div>
            <p className="button-preview__caption">这些示例只记录本页点击，不操作书库数据。</p>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · SIZE & ICONS</span>
            <h2>尺寸与图标</h2>
            <div className="button-preview__row">
              <Button size="sm" startIcon={Search} onClick={() => record('小号搜索')}>搜索</Button>
              <Button startIcon={Plus} onClick={() => record('添加图书')}>添加图书</Button>
              <Button size="lg" startIcon={BookOpen} endIcon={ChevronRight} onClick={() => record('查看书籍')}>查看书籍</Button>
            </div>
            <Button variant="secondary" fullWidth onClick={() => record('整行按钮')}>整行按钮</Button>
          </GlassSurface>
          <GlassSurface material="frosted" elevation="sm">
            <span className="button-preview__eyebrow">03 · STATES</span>
            <h2>加载与禁用</h2>
            <div className="button-preview__row">
              <Button id="button-simulate-save" loading={loading} loadingLabel="保存中…" startIcon={Plus} onClick={simulateSave}>模拟保存</Button>
              <Button loading>加载中按钮</Button>
              <Button disabled onClick={() => record('禁用按钮被触发')}>已禁用</Button>
              <Button variant="secondary" disabled>禁用次要按钮</Button>
            </div>
            <p className="button-preview__caption">加载期间阻止重复操作，按钮宽度保持稳定。</p>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · FORM & KEYBOARD</span>
            <h2>表单与键盘</h2>
            <form className="button-preview__form" onSubmit={(event) => { event.preventDefault(); setSubmits((value) => value + 1); }}>
              <label htmlFor="button-preview-text">表单示例内容</label>
              <input id="button-preview-text" name="content" defaultValue="演示内容" />
              <div className="button-preview__row">
                <Button onClick={() => record('普通按钮')}>普通按钮</Button>
                <Button type="submit" name="action" value="save">提交示例</Button>
                <Button type="reset" variant="ghost">重置示例</Button>
              </div>
              <output id="button-form-status" aria-live="polite">已提交 {submits} 次</output>
            </form>
            <p className="button-preview__caption">普通按钮不提交表单。用 Tab 切换焦点，Enter 或空格触发操作。</p>
          </GlassSurface>
        </div>
      </div>
    </MainLayout>
  );
}
