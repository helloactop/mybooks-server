import { useId, useRef, useState } from 'react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import { GlassDialog } from '../GlassDialog/GlassDialog';
import MainLayout from '../../../layouts/MainLayout';
import { Select } from './Select';
import type { SelectOption, SelectOptionGroup } from './Select';
import '../Button/button-preview.css';
import './select-preview.css';

const sortOptions: readonly SelectOption[] = [
  { value: 'recent', label: '最近更新' }, { value: 'title', label: '书名' }, { value: 'author', label: '作者' },
];
const categories: readonly SelectOptionGroup[] = [
  { label: '文学', options: [{ value: 'fiction', label: '小说' }, { value: 'poetry', label: '诗歌' }, { value: 'drama', label: '戏剧（禁用示例）', disabled: true }] },
  { label: '知识', options: [{ value: 'history', label: '历史' }, { value: 'science', label: '科学' }] },
  { label: '暂不可选分组', disabled: true, options: [{ value: 'archived', label: '已归档分类' }] },
];
const keyboardOptions: readonly SelectOption[] = [{ value: 'first', label: '首项' }, { value: 'blocked', label: '禁用项', disabled: true }, { value: 'last', label: '末项' }];
const manyOptions: readonly SelectOption[] = Array.from({ length: 30 }, (_, index) => ({ value: `item-${index + 1}`, label: `演示选项 ${String(index + 1).padStart(2, '0')}` }));
const alphabetOptions: readonly SelectOption[] = [{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }, { value: 'gamma', label: 'Gamma' }];
const viewOptions: readonly SelectOption[] = [{ value: 'grid', label: '网格' }, { value: 'list', label: '列表' }];
const longOptions: readonly SelectOption[] = [{ value: 'long', label: '这是一条很长的选项名称，用于检查选择框在手机窄屏中的宽度约束和文字截断。' }];

export default function SelectPreview() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [category, setCategory] = useState('fiction');
  const [changes, setChanges] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [formStatus, setFormStatus] = useState('尚未提交');
  const [valueEvents, setValueEvents] = useState(0);
  const [nativeEvents, setNativeEvents] = useState(0);
  const [lastValue, setLastValue] = useState('first');
  const selectRef = useRef<HTMLSelectElement>(null);
  const formId = useId();
  const categoryName = categories.flatMap((group) => group.options).find((option) => option.value === category)?.label;

  return (
    <MainLayout>
      <div className="button-preview select-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>Select</h1><p>从选择入口到下拉选项，统一玻璃材质与交互。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
            <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
            <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox">Checkbox</a>
            <a href="/mybooks/playground/switch">Switch</a><a href="/mybooks/playground/radio-group">RadioGroup</a>
            <a href="/mybooks/playground/select" aria-current="page">Select</a>
            <a href="/mybooks/playground/text-area">TextArea</a>
            <a href="/mybooks/playground/toast">Toast</a>
            <a href="/mybooks/playground/tooltip">Tooltip</a>
            <a href="/mybooks/playground/dropdown-menu">DropdownMenu</a>
            <a href="/mybooks/playground/badge">Badge / Chip</a>
            <a href="/mybooks/books/all">书库</a>
          </nav>
          <p className="button-preview__caption">所有选项只更新本页状态；自定义玻璃菜单支持分组、键盘、触屏与原生表单。</p>
        </header>
        <div className="button-preview__grid">
          <section className="select-preview__scene" aria-labelledby="select-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="select-material-heading">稳定的选择入口</h2>
            <div className="select-preview__materials">
              <Select label="液态选择框" options={sortOptions} defaultValue="recent" />
              <Select label="磨砂选择框" options={sortOptions} defaultValue="recent" material="frosted" />
              <Select label="实色选择框" options={sortOptions} defaultValue="recent" material="solid" />
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · CONTROLLED & GROUPS</span><h2>分类与外部赋值</h2>
            <div className="select-preview__stack">
              <Select id="select-category" label="图书分类" options={categories} value={category} placeholder="请选择分类"
                description="选项可以分组，也可以单独禁用某项或整组。"
                onValueChange={(next) => { setCategory(next); setChanges((count) => count + 1); }} />
              <output id="select-category-status" aria-live="polite">当前：{categoryName ?? (category ? '未匹配的原始值' : '未选择')} · 选择 {changes} 次</output>
              <div className="button-preview__row"><Button variant="secondary" onClick={() => setCategory('history')}>从外部选择历史</Button><Button variant="ghost" onClick={() => setCategory('')}>清空分类</Button></div>
              <Button variant="ghost" onClick={() => setCategory('missing-category')}>演示无匹配值</Button>
              <p className="button-preview__caption">原值暂时不在选项中时显示占位提示，保留调用方状态，不自动选中其他分类。</p>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · STATES</span><h2>禁用、空选项与错误</h2>
            <div className="select-preview__stack">
              <Select label="禁用的选择框" options={sortOptions} defaultValue="title" disabled />
              <Select label="空选项示例" options={[]} placeholder="暂无可选项" disabled />
              <Select label="错误状态示例" options={sortOptions} description="说明和错误文字关联到可见的选择入口。" error="请选择一个有效的演示选项。" />
              <fieldset disabled className="select-preview__fieldset"><legend>父 fieldset 禁用</legend><Select label="继承禁用状态" options={sortOptions} defaultValue="recent" /></fieldset>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · SIZE</span><h2>尺寸与长选项</h2>
            <div className="select-preview__stack">
              <Select label="小号选择框" options={sortOptions} defaultValue="title" size="sm" />
              <Select label="中号选择框" options={sortOptions} defaultValue="title" />
              <Select label="大号选择框" options={sortOptions} defaultValue="title" size="lg" />
              <Select label="长文本选择框" options={longOptions} defaultValue="long" description="外框不会被长选项撑宽，选择文字由浏览器截断。" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · NATIVE FORM</span><h2>原生验证与重置</h2>
            <form id={formId} className="select-preview__stack" onSubmit={(event) => {
              event.preventDefault(); const data = new FormData(event.currentTarget); setSubmits((count) => count + 1);
              setFormStatus(`分类：${data.get('category')} · 排序：${data.get('sort')} · 外部字段：${data.get('external-view')} · 禁用字段${data.has('unavailable') ? '已包含' : '未包含'}`);
            }} onReset={() => setFormStatus('表单已重置')}>
              <Select label="必选分类" name="category" options={categories} required placeholder="请选择必填分类" />
              <Select label="表单排序" name="sort" options={sortOptions} defaultValue="title" />
              <Select label="禁用的表单字段" name="unavailable" options={sortOptions} defaultValue="recent" disabled />
              <div className="button-preview__row"><Button type="submit">提交选择框示例</Button><Button type="reset" variant="secondary">重置选择框表单</Button></div>
              <output id="select-form-count" aria-live="polite">已提交 {submits} 次</output>
              <output id="select-form-status" aria-live="polite">{formStatus}</output>
            </form>
            <div className="select-preview__external"><Select label="表单外选择框" name="external-view" options={viewOptions} defaultValue="grid" form={formId} /></div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">05 · KEYBOARD & REF</span><h2>键盘、事件与引用</h2>
            <div className="select-preview__stack">
              <Select ref={selectRef} id="select-focus-target" label="键盘选择示例" options={keyboardOptions} defaultValue="first"
                description="方向键展开与浏览；回车或空格确认，Esc 取消，Tab 离开。禁用项自动跳过。" aria-describedby="select-external-help"
                onChange={() => setNativeEvents((count) => count + 1)}
                onValueChange={(next) => { setValueEvents((count) => count + 1); setLastValue(next); }} />
              <p id="select-external-help" className="button-preview__caption">ref 指向表单 select，调用 focus() 会转到可见入口；保留说明关联，不添加焦点描边。</p>
              <Button variant="secondary" onClick={() => selectRef.current?.focus()}>聚焦选择框</Button>
              <output id="select-ref-status" aria-live="polite">值回调 {valueEvents} 次 · 原生事件 {nativeEvents} 次 · 值：{lastValue || '未选择'}</output>
              <Select label="字母查找示例" options={alphabetOptions} defaultValue="alpha" description="输入 G 定位 Gamma，再按回车确认。" />
              <div dir="rtl"><Select label="RTL 选择框" options={sortOptions} defaultValue="title" /></div>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">06 · SCROLL & DIALOG</span><h2>长列表与弹窗内使用</h2>
            <div className="select-preview__stack">
              <Select label="长列表选择框" options={manyOptions} defaultValue="item-28" description="30 个演示选项；菜单自动限高、翻转并滚动到当前项，隐藏滚动条。" />
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>打开选择框弹窗</Button>
            </div>
          </GlassSurface>
        </div>
        <GlassDialog open={dialogOpen} onOpenChange={setDialogOpen} title="弹窗内的选择框" description="展开菜单后，第一次 Esc 仅关闭菜单。">
          <Select label="弹窗分类" options={categories} defaultValue="fiction" />
        </GlassDialog>
      </div>
    </MainLayout>
  );
}
