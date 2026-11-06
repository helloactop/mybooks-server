import { useState } from 'react';
import type { GlassIntensity } from './glass-engine';
import { GlassSurface } from './GlassSurface';
import MainLayout from '../../layouts/MainLayout';
import './glass-preview.css';

export default function GlassSurfacePreview() {
  const [intensity, setIntensity] = useState<GlassIntensity>('regular');
  const [compact, setCompact] = useState(false);
  return (
    <MainLayout>
      <div className="glass-preview">
        <header className="glass-preview__header">
          <span className="glass-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>GlassSurface</h1>
          <p>32px 圆角、浅蓝主题与三种表面材质。文字和表单保持独立。</p>
          <nav className="glass-preview__nav" aria-label="组件预览">
            <a href="/mybooks/playground/glass" aria-current="page">GlassSurface</a>
            <a href="/mybooks/playground/button">Button</a>
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
          <div className="glass-preview__controls">
            <label htmlFor="glass-intensity">折射强度</label>
            <select id="glass-intensity" value={intensity} onChange={(event) => setIntensity(event.target.value as GlassIntensity)}>
              <option value="subtle">轻柔</option>
              <option value="regular">常规</option>
              <option value="strong">明显</option>
            </select>
            <button type="button" onClick={() => setCompact((value) => !value)}>切换容器宽度</button>
          </div>
        </header>
        <section className="glass-preview__scene" aria-label="材质对比">
          <div className="glass-preview__grid" data-compact={compact}>
            <GlassSurface id="preview-liquid" intensity={intensity} tone="accent">
              <span className="glass-preview__tag">01 · LIQUID</span>
              <h2>液态折射</h2>
              <p>背景通过边缘折射呈现，内容保持清晰。宽度变化后，输入内容仍会保留。</p>
              <label className="glass-preview__field" htmlFor="glass-preview-input">试着输入文字
                <input id="glass-preview-input" placeholder="输入内容后切换容器宽度" />
              </label>
              <details>
                <summary>展开额外内容</summary>
                <p>这段内容用于观察容器高度变化后的材质适配。</p>
              </details>
            </GlassSurface>
            <GlassSurface id="preview-frosted" material="frosted">
              <span className="glass-preview__tag">02 · FROSTED</span>
              <h2>轻磨砂</h2>
              <p>使用设计变量里的半透明底色和背景模糊，适合较大的内容面板。</p>
              <p className="glass-preview__caption">浏览器不支持折射时，液态材质也会回退到这里。</p>
            </GlassSurface>
            <GlassSurface id="preview-solid" material="solid" elevation="sm">
              <span className="glass-preview__tag">03 · SOLID</span>
              <h2>实色表面</h2>
              <p>使用白色背景和细边框，提供稳定的文字对比度。</p>
              <p className="glass-preview__caption">减少透明效果或无背景滤镜支持时，自动采用实色。</p>
            </GlassSurface>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
