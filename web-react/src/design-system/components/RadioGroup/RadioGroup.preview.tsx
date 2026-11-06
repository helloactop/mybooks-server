import { useId, useRef, useState } from 'react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import MainLayout from '../../../layouts/MainLayout';
import { RadioGroup } from './RadioGroup';
import type { RadioGroupOption } from './RadioGroup';
import '../Button/button-preview.css';
import './radio-group-preview.css';

const sortOptions: readonly RadioGroupOption[] = [
  { value: 'recent', label: '最近更新', description: '按最近修改时间排列。' },
  { value: 'title', label: '书名', description: '按书籍名称排列。' },
  { value: 'author', label: '作者', description: '按作者名称排列。' },
];
const compactOptions: readonly RadioGroupOption[] = [{ value: 'one', label: '选项一' }, { value: 'two', label: '选项二' }];
const keyboardOptions: readonly RadioGroupOption[] = [
  { value: 'first', label: '可选首项' }, { value: 'disabled', label: '禁用中间项', disabled: true }, { value: 'last', label: '可选末项' },
];

export default function RadioGroupPreview() {
  const [sort, setSort] = useState<string | null>('recent');
  const [changes, setChanges] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [formStatus, setFormStatus] = useState('尚未提交');
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const formId = useId();

  return (
    <MainLayout>
      <div className="button-preview radio-group-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>RadioGroup</h1><p>为互斥选项保留清晰的说明与原生单选行为。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
            <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
            <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
            <a href="/mybooks/playground/switch">Switch</a><a href="/mybooks/playground/radio-group" aria-current="page">RadioGroup</a>
            <a href="/mybooks/playground/select">Select</a>
            <a href="/mybooks/playground/text-area">TextArea</a>
            <a href="/mybooks/playground/toast">Toast</a>
            <a href="/mybooks/playground/tooltip">Tooltip</a>
            <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a>
            <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
          <p className="button-preview__caption">全部选项仅更新本页状态，不修改真实书库或服务器设置。</p>
        </header>
        <div className="button-preview__grid">
          <section className="radio-group-preview__scene" aria-labelledby="radio-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="radio-material-heading">圆形标记，轻量折射</h2>
            <div className="radio-group-preview__materials">
              <RadioGroup name="material-liquid" label="液态单选" options={compactOptions} defaultValue="one" />
              <RadioGroup name="material-frosted" label="磨砂单选" options={compactOptions} defaultValue="one" material="frosted" />
              <RadioGroup name="material-solid" label="实色单选" options={compactOptions} defaultValue="one" material="solid" />
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · CONTROLLED</span><h2>带说明的排序选项</h2>
            <div className="radio-group-preview__stack">
              <RadioGroup ref={groupRef} id="radio-sort" name="preview-sort" label="排序方式" description="受控值与外部操作同步。"
                options={sortOptions} value={sort} onValueChange={(next) => { setSort(next); setChanges((count) => count + 1); }}
                aria-describedby="radio-external-help" />
              <output id="radio-sort-status" aria-live="polite">当前：{sortOptions.find((option) => option.value === sort)?.label ?? '尚未选择'} · 切换 {changes} 次</output>
              <div className="button-preview__row">
                <Button variant="secondary" onClick={() => setSort('author')}>从外部选择作者</Button>
                <Button variant="ghost" onClick={() => setSort(null)}>清空受控选择</Button>
                <Button variant="ghost" onClick={() => {
                  const group = groupRef.current;
                  (group?.querySelector<HTMLInputElement>('input:checked:not(:disabled)') ?? group?.querySelector<HTMLInputElement>('input:not(:disabled)'))?.focus();
                }}>聚焦当前单选项</Button>
              </div>
              <p id="radio-external-help" className="button-preview__caption">保留调用方的外部说明关联；重复点击当前项不触发变更。</p>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · KEYBOARD & DISABLED</span><h2>方向键与禁用</h2>
            <div className="radio-group-preview__stack">
              <RadioGroup name="preview-keyboard" label="跳过禁用项" options={keyboardOptions} defaultValue="first" />
              <RadioGroup name="preview-disabled" label="整组禁用" options={compactOptions} defaultValue="two" disabled orientation="horizontal" />
              <RadioGroup name="preview-error" label="错误状态示例" options={compactOptions} description="组选项说明。" error="请选择一个有效的演示选项。" />
              <p className="button-preview__caption">Tab 进入单选组，方向键移动并选择；浏览器会跳过禁用项并保持单选互斥。空格选择当前项，不添加焦点描边。</p>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · SIZE & LAYOUT</span><h2>尺寸与横向排列</h2>
            <div className="radio-group-preview__stack">
              <RadioGroup name="preview-small" label="小号单选组" options={compactOptions} defaultValue="one" size="sm" orientation="horizontal" />
              <RadioGroup name="preview-medium" label="中号单选组" options={compactOptions} defaultValue="one" orientation="horizontal" />
              <RadioGroup name="preview-large" label="大号单选组" options={compactOptions} defaultValue="one" size="lg" orientation="horizontal" />
              <RadioGroup name="preview-long" label="长标签示例" options={[
                { value: 'long', label: '这是一条会自动换行的较长单选项名称，用于检查手机窄屏布局。', description: '说明也可以换行，整行点击区域至少 44px 高。' },
              ]} />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · NATIVE FORM</span><h2>表单提交与重置</h2>
            <form id={formId} className="radio-group-preview__stack" onSubmit={(event) => {
              event.preventDefault(); const data = new FormData(event.currentTarget); setSubmits((count) => count + 1);
              setFormStatus(`排序：${data.get('form-sort')} · 外部字段：${data.get('external-mode')} · 禁用组${data.has('disabled-mode') ? '已包含' : '未包含'}`);
            }} onReset={() => setFormStatus('表单已重置')}>
              <RadioGroup name="form-sort" label="表单排序" options={sortOptions} required />
              <RadioGroup name="disabled-mode" label="禁用表单组" options={compactOptions} defaultValue="one" disabled />
              <div className="button-preview__row"><Button type="submit">提交单选示例</Button><Button type="reset" variant="secondary">重置单选表单</Button></div>
              <output id="radio-form-count" aria-live="polite">已提交 {submits} 次</output>
              <output id="radio-form-status" aria-live="polite">{formStatus}</output>
            </form>
            <div className="radio-group-preview__external">
              <RadioGroup name="external-mode" label="表单外的单选组" options={compactOptions} defaultValue="one" form={formId} />
              <p className="button-preview__caption">此组位于 form 外，通过 form 属性参与提交与重置。</p>
            </div>
          </GlassSurface>
        </div>
      </div>
    </MainLayout>
  );
}
