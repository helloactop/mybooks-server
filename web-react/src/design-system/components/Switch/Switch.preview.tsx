import { useRef, useState } from 'react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import MainLayout from '../../../layouts/MainLayout';
import { Switch } from './Switch';
import '../Button/button-preview.css';
import './switch-preview.css';

export default function SwitchPreview() {
  const [showProgress, setShowProgress] = useState(true);
  const [changes, setChanges] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [formStatus, setFormStatus] = useState('尚未提交');
  const [refChanges, setRefChanges] = useState(0);
  const [nativeEvents, setNativeEvents] = useState(0);
  const [lastChecked, setLastChecked] = useState(false);
  const switchRef = useRef<HTMLInputElement>(null);

  return (
    <MainLayout>
      <div className="button-preview switch-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>Switch</h1><p>切换一项设置，滑块即时响应，玻璃轨道保持稳定。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
            <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
            <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
            <a href="/mybooks/playground/switch" aria-current="page">Switch</a>
            <a href="/mybooks/playground/radio-group">RadioGroup</a>
            <a href="/mybooks/playground/select">Select</a>
            <a href="/mybooks/playground/text-area">TextArea</a>
            <a href="/mybooks/playground/toast">Toast</a>
            <a href="/mybooks/playground/tooltip">Tooltip</a>
            <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a>
            <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
          <p className="button-preview__caption">设置仅在本页生效，不保存到服务器，也不修改真实书库。</p>
        </header>
        <div className="button-preview__grid">
          <section className="switch-preview__scene" aria-labelledby="switch-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="switch-material-heading">轻量轨道，稳定切换</h2>
            <div className="switch-preview__materials">
              <Switch label="液态开关" defaultChecked />
              <Switch label="磨砂开关" material="frosted" defaultChecked />
              <Switch label="实色开关" material="solid" defaultChecked />
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · CONTROLLED</span><h2>即时设置预览</h2>
            <div className="switch-preview__stack">
              <Switch id="switch-progress" label="显示阅读进度" checked={showProgress}
                description="受控状态立即更新下方演示内容。"
                onCheckedChange={(next) => { setShowProgress(next); setChanges((count) => count + 1); }} />
              <div className="switch-preview__example">
                <span>{showProgress ? '演示阅读进度 · 40%' : '阅读进度已隐藏'}</span>
                <progress value={40} max={100} aria-label="演示阅读进度" hidden={!showProgress} />
              </div>
              <output id="switch-progress-status" aria-live="polite">当前：{showProgress ? '开启' : '关闭'} · 切换 {changes} 次</output>
              <Button variant="secondary" onClick={() => setShowProgress(false)}>从外部关闭进度</Button>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · STATES</span><h2>禁用与错误</h2>
            <div className="switch-preview__stack">
              <Switch label="禁用的关闭状态" disabled />
              <Switch label="禁用的开启状态" disabled defaultChecked />
              <Switch label="错误状态示例" description="说明和错误文字关联到原生开关。" error="这是一条演示错误，请检查此项设置。" defaultChecked />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · SIZE & LABEL</span><h2>尺寸与标签位置</h2>
            <div className="switch-preview__stack">
              <Switch label="小号开关" size="sm" description="40 × 24px 轨道" defaultChecked />
              <Switch label="中号开关" description="48 × 28px 轨道，默认尺寸" defaultChecked />
              <Switch label="大号开关" size="lg" description="56 × 32px 轨道" defaultChecked />
              <Switch label="左侧轨道示例" labelPosition="end" description="标签也可放在轨道之后。" />
              <Switch label="这是一条较长的设置名称，用于检查窄屏时自动换行和整行点击的行为。" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · NATIVE FORM</span><h2>表单提交与重置</h2>
            <form className="switch-preview__stack" onSubmit={(event) => {
              event.preventDefault(); const data = new FormData(event.currentTarget); setSubmits((count) => count + 1);
              setFormStatus(`进度字段：${data.has('progress') ? '已提交' : '未包含'} · 紧凑字段：${data.has('compact') ? '已提交' : '未包含'} · 禁用字段：${data.has('unavailable') ? '已提交' : '未包含'}`);
            }} onReset={() => setFormStatus('表单已重置')}>
              <Switch label="必开示例" name="requiredSetting" value="yes" required description="用于演示浏览器原生 required 验证。" />
              <Switch label="提交进度设置" name="progress" value="enabled" defaultChecked />
              <Switch label="提交紧凑设置" name="compact" value="enabled" />
              <Switch label="禁用的表单设置" name="unavailable" value="ignored" defaultChecked disabled />
              <div className="button-preview__row"><Button type="submit">提交开关示例</Button><Button type="reset" variant="secondary">重置开关表单</Button></div>
              <output id="switch-form-count" aria-live="polite">已提交 {submits} 次</output>
              <output id="switch-form-status" aria-live="polite">{formStatus}</output>
            </form>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">05 · KEYBOARD & REF</span><h2>键盘、事件与引用</h2>
            <div className="switch-preview__stack">
              <Switch ref={switchRef} id="switch-focus-target" label="键盘操作示例" labelPosition="end"
                description="Tab 访问，空格切换，不添加焦点描边。" aria-describedby="switch-external-help"
                onChange={() => setNativeEvents((count) => count + 1)}
                onCheckedChange={(next) => { setRefChanges((count) => count + 1); setLastChecked(next); }} />
              <p id="switch-external-help" className="button-preview__caption">支持原生事件与布尔值回调，同时保留外部说明关联。</p>
              <Button variant="secondary" onClick={() => switchRef.current?.focus()}>聚焦开关</Button>
              <output id="switch-ref-status" aria-live="polite">布尔回调 {refChanges} 次 · 原生事件 {nativeEvents} 次 · {lastChecked ? '开启' : '关闭'}</output>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">06 · RTL</span><h2>从右到左布局</h2>
            <div dir="rtl"><Switch id="switch-rtl-sample" label="RTL 开关" defaultChecked description="滑块方向随布局方向变化。" /></div>
            <p className="button-preview__caption">滑块为实色小圆点，只有它参与位移动画；轨道不做整体透明度或缩放动画。</p>
          </GlassSurface>
        </div>
      </div>
    </MainLayout>
  );
}
