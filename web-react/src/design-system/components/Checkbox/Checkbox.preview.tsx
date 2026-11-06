import { useRef, useState } from 'react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import MainLayout from '../../../layouts/MainLayout';
import { Checkbox } from './Checkbox';
import '../Button/button-preview.css';
import './checkbox-preview.css';

const books = [{ id: 'one', label: '演示图书一' }, { id: 'two', label: '演示图书二' }, { id: 'three', label: '演示图书三' }];

export default function CheckboxPreview() {
  const [selected, setSelected] = useState<string[]>([]);
  const [refChanges, setRefChanges] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [formStatus, setFormStatus] = useState('尚未提交');
  const focusRef = useRef<HTMLInputElement>(null);
  const allSelected = selected.length === books.length;
  const someSelected = selected.length > 0 && !allSelected;

  return (
    <MainLayout>
      <div className="button-preview checkbox-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>Checkbox</h1>
          <p>选中、半选与批量选择，保留原生复选框交互。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a><a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button">IconButton</a><a href="/mybooks/playground/text-field">TextField</a>
            <a href="/mybooks/playground/segmented-control">SegmentedControl</a><a href="/mybooks/playground/glass-dialog">GlassDialog</a>
            <a href="/mybooks/playground/glass-popover">GlassPopover</a><a href="/mybooks/playground/checkbox" aria-current="page">Checkbox</a>
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
          <p className="button-preview__caption">所有勾选只更新本页状态，不访问或修改真实书库。</p>
        </header>
        <div className="button-preview__grid">
          <section className="checkbox-preview__scene" aria-labelledby="checkbox-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span><h2 id="checkbox-material-heading">一小块轻量玻璃</h2>
            <div className="checkbox-preview__materials">
              <Checkbox label="液态选择" defaultChecked />
              <Checkbox label="磨砂选择" material="frosted" defaultChecked />
              <Checkbox label="实色选择" material="solid" defaultChecked />
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · BATCH SELECT</span><h2>全选与半选</h2>
            <div className="checkbox-preview__stack">
              <Checkbox id="checkbox-select-all" label="全选演示图书" checked={allSelected} indeterminate={someSelected}
                description="选择部分图书时显示横线，全选时显示勾。"
                onCheckedChange={(next) => setSelected(next ? books.map((book) => book.id) : [])} />
              <div className="checkbox-preview__books">
                {books.map((book) => <Checkbox key={book.id} label={book.label} checked={selected.includes(book.id)}
                  onCheckedChange={(next) => setSelected((current) => next ? [...current, book.id] : current.filter((id) => id !== book.id))} />)}
              </div>
              <output id="checkbox-batch-status" aria-live="polite">已选 {selected.length} / {books.length} · {allSelected ? '全选' : someSelected ? '半选' : '未选择'}</output>
              <Button variant="secondary" onClick={() => setSelected([])}>清空选择</Button>
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · STATES</span><h2>禁用与错误</h2>
            <div className="checkbox-preview__stack">
              <Checkbox label="禁用的未选项" disabled />
              <Checkbox label="禁用的已选项" disabled defaultChecked />
              <Checkbox label="禁用的半选项" disabled indeterminate />
              <Checkbox label="错误状态示例" description="错误文字通过 aria-describedby 关联。" error="请选择这个演示选项。" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">03 · SIZE</span><h2>尺寸与长标签</h2>
            <div className="checkbox-preview__stack">
              <Checkbox label="小号复选框" size="sm" description="20px 方框" defaultChecked />
              <Checkbox label="中号复选框" description="24px 方框，默认尺寸" defaultChecked />
              <Checkbox label="大号复选框" size="lg" description="28px 方框" defaultChecked />
              <Checkbox label="这是一条可以自动换行的较长选项名称，用于检查窄屏下标签与说明的布局。" description="点击文字也可以切换；整行点击区域至少 44px 高。" />
            </div>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · NATIVE FORM</span><h2>表单提交与重置</h2>
            <form className="checkbox-preview__stack" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setSubmits((count) => count + 1);
              setFormStatus(`已提交 ${data.getAll('export').join('、') || '无导出项'} · 禁用字段${data.has('unavailable') ? '已包含' : '未包含'}`);
            }} onReset={() => setFormStatus('表单已重置')}>
              <Checkbox label="必选示例" name="requiredFlag" value="yes" required description="未勾选时由浏览器阻止提交。" />
              <Checkbox label="导出封面" name="export" value="covers" defaultChecked />
              <Checkbox label="导出元数据" name="export" value="metadata" />
              <Checkbox label="禁用的表单字段" name="unavailable" value="ignored" defaultChecked disabled />
              <div className="button-preview__row"><Button type="submit">提交复选框示例</Button><Button type="reset" variant="secondary">重置复选框表单</Button></div>
              <output id="checkbox-form-count" aria-live="polite">已提交 {submits} 次</output>
              <output id="checkbox-form-status" aria-live="polite">{formStatus}</output>
            </form>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">05 · KEYBOARD & REF</span><h2>键盘与原生引用</h2>
            <div className="checkbox-preview__stack">
              <Checkbox ref={focusRef} id="checkbox-focus-target" label="聚焦示例" onCheckedChange={() => setRefChanges((count) => count + 1)}
                description="Tab 切换焦点，空格切换勾选；不添加焦点描边。" aria-describedby="checkbox-external-help" />
              <p id="checkbox-external-help" className="button-preview__caption">保留调用方提供的外部说明关联。</p>
              <Button variant="secondary" onClick={() => focusRef.current?.focus()}>聚焦复选框</Button>
              <output id="checkbox-ref-status" aria-live="polite">已切换 {refChanges} 次</output>
            </div>
          </GlassSurface>
        </div>
      </div>
    </MainLayout>
  );
}
