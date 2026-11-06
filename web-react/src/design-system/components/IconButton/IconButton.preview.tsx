import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, MoreHorizontal, Plus, RefreshCw, Search, Settings, Trash2 } from 'lucide-react';
import { GlassSurface } from '../../glass/GlassSurface';
import { Button } from '../Button/Button';
import MainLayout from '../../../layouts/MainLayout';
import { IconButton } from './IconButton';
import '../Button/button-preview.css';
import './icon-button-preview.css';

export default function IconButtonPreview() {
  const [clicks, setClicks] = useState(0);
  const [lastAction, setLastAction] = useState('尚未触发');
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('尚未刷新');
  const [submits, setSubmits] = useState(0);
  const searchRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const record = (label: string) => { setClicks((value) => value + 1); setLastAction(label); };
  const refresh = () => {
    setLoading(true);
    setRefreshStatus('刷新中…');
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setLoading(false);
      setRefreshStatus('刷新已完成');
      record('刷新完成');
    }, 2500);
  };

  return (
    <MainLayout>
      <div className="button-preview icon-button-preview">
        <header className="button-preview__header">
          <span className="button-preview__eyebrow">DESIGN SYSTEM · 开发预览</span>
          <h1>IconButton</h1>
          <p>纯图标操作，复用液态材质与原生按钮交互。</p>
          <nav aria-label="组件预览" className="button-preview__nav">
            <a href="/mybooks/playground/glass">GlassSurface</a>
            <a href="/mybooks/playground/button">Button</a>
            <a href="/mybooks/playground/icon-button" aria-current="page">IconButton</a>
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
          <section className="icon-button-preview__scene" aria-labelledby="icon-material-heading">
            <span className="button-preview__eyebrow">GLASS · 材质对比</span>
            <h2 id="icon-material-heading">小尺寸也有液态折射</h2>
            <div className="button-preview__row">
              <div className="icon-button-preview__sample"><IconButton icon={Search} label="液态搜索" variant="primary" size="lg" intensity="strong" onClick={() => record('液态搜索')} /><span>液态</span></div>
              <div className="icon-button-preview__sample"><IconButton icon={Search} label="磨砂搜索" variant="primary" size="lg" material="frosted" onClick={() => record('磨砂搜索')} /><span>磨砂</span></div>
              <div className="icon-button-preview__sample"><IconButton icon={Search} label="实色搜索" variant="primary" size="lg" material="solid" onClick={() => record('实色搜索')} /><span>实色</span></div>
            </div>
          </section>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">01 · ACTIONS</span><h2>常用操作</h2>
            <div className="button-preview__row">
              <IconButton icon={Plus} label="添加图书" variant="primary" onClick={() => record('添加图书')} />
              <IconButton ref={searchRef} id="icon-focus-target" icon={Search} label="搜索图书" onClick={() => record('搜索图书')} />
              <IconButton icon={Settings} label="打开设置" variant="ghost" onClick={() => record('打开设置')} />
              <IconButton icon={Trash2} label="删除示例" variant="danger" onClick={() => record('删除示例')} />
            </div>
            <p className="button-preview__caption">图标都有操作名称。悬停显示原生提示，操作只记录本页状态。</p>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">02 · SIZE & TOGGLE</span><h2>尺寸与切换状态</h2>
            <div className="button-preview__row">
              <IconButton icon={Search} label="小号搜索" size="sm" onClick={() => record('小号搜索')} />
              <IconButton icon={Bookmark} label="切换收藏" aria-pressed={bookmarked} onClick={() => { setBookmarked((value) => !value); record('切换收藏'); }} />
              <IconButton icon={MoreHorizontal} label="更多操作" size="lg" onClick={() => record('更多操作')} />
            </div>
            <output id="icon-bookmark-status" aria-live="polite">{bookmarked ? '已收藏' : '未收藏'}</output>
            <p className="button-preview__caption">精细指针尺寸为 36 / 44 / 52px；触控环境至少 44px。</p>
          </GlassSurface>
          <GlassSurface material="frosted" elevation="sm">
            <span className="button-preview__eyebrow">03 · STATES</span><h2>加载与禁用</h2>
            <div className="button-preview__row">
              <IconButton id="icon-refresh" icon={RefreshCw} label="刷新数据" loading={loading} onClick={refresh} />
              <IconButton icon={RefreshCw} label="持续加载示例" loading />
              <IconButton icon={Trash2} label="禁用的删除" variant="danger" disabled onClick={() => record('禁用操作被触发')} />
            </div>
            <output id="icon-refresh-status" aria-live="polite">{refreshStatus}</output>
            <p className="button-preview__caption">加载时保留操作名称与方形尺寸，阻止重复触发。</p>
          </GlassSurface>
          <GlassSurface material="solid" elevation="sm">
            <span className="button-preview__eyebrow">04 · FOCUS & FORM</span><h2>焦点与表单</h2>
            <div className="button-preview__row"><Button variant="secondary" onClick={() => searchRef.current?.focus()}>聚焦搜索图标</Button></div>
            <form className="button-preview__form" onSubmit={(event) => { event.preventDefault(); setSubmits((value) => value + 1); }}>
              <div className="button-preview__row">
                <IconButton icon={Plus} label="表单普通操作" onClick={() => record('表单普通操作')} />
                <IconButton icon={Check} label="提交表单示例" type="submit" variant="primary" name="action" value="save" />
              </div>
              <output id="icon-form-status" aria-live="polite">已提交 {submits} 次</output>
            </form>
          </GlassSurface>
        </div>
      </div>
    </MainLayout>
  );
}
