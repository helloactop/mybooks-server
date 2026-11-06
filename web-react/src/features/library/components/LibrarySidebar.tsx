import { Bookmark, BookText, ChartNoAxesCombined, CircleCheck, FileText, FolderClosed, House, LibraryBig, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings, StickyNote, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import type { SidebarAccountProfile } from '../../auth/useAccountProfile';
import { IconButton } from '../../../design-system/components/IconButton/IconButton';
import { libraryHref } from '../library-navigation';
import type { LibraryCollection, LibraryLocation, LibraryView } from '../library-navigation';
import './library-sidebar.css';

interface SidebarItem { view: LibraryView; label: string; icon: LucideIcon; }
const personalItems: readonly SidebarItem[] = [
  { view: 'home', label: '首页', icon: House },
  { view: 'statistics', label: '阅读统计', icon: ChartNoAxesCombined },
];
const libraryItems: readonly SidebarItem[] = [
  { view: 'all', label: '全部图书', icon: LibraryBig },
  { view: 'unread', label: '未读', icon: Bookmark },
  { view: 'finished', label: '已读', icon: CircleCheck },
  { view: 'ebooks', label: '电子书', icon: BookText },
  { view: 'pdf', label: 'PDF 文档', icon: FileText },
  { view: 'notes', label: '读书心得', icon: StickyNote },
];
export interface LibrarySidebarProps {
  location: LibraryLocation;
  collections: readonly LibraryCollection[];
  collectionsStatus: 'loading' | 'ready' | 'error';
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate: (location: LibraryLocation) => void;
  onRetry: () => void;
  basePath?: string;
  onRequireLogin?: () => void;
  authenticated?: boolean;
  accountProfile?: SidebarAccountProfile | null;
}

export function libraryLocationLabel(location: LibraryLocation, collections: readonly LibraryCollection[]): string {
  if (location.view === 'settings') return '设置';
  if (location.view === 'folder') return collections.find((item) => item.source === 'app' && item.id === location.folderId)?.name ?? '我的分类';
  return location.view === 'collection' ? collections.find((item) => item.source !== 'app' && item.id === location.collectionId)?.name ?? '我的分类'
    : [...personalItems, ...libraryItems].find((item) => item.view === location.view)?.label ?? '全部图书';
}

export function LibrarySidebar({ location, collections, collectionsStatus, collapsed = false, onToggleCollapsed,
  onNavigate, onRetry, basePath = '/mybooks', onRequireLogin, authenticated = true, accountProfile,
}: LibrarySidebarProps) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const accountName = accountProfile?.nickname || '我的账户';
  const avatar = accountProfile?.avatarUrl;
  const settingsLocation: LibraryLocation = { view: 'settings', query: '' };
  const navigate = (event: MouseEvent<HTMLAnchorElement>, next: LibraryLocation) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(next);
  };
  const renderItem = ({ view, label, icon: Icon }: SidebarItem) => {
    const next: LibraryLocation = view === 'home' ? { view: 'home', query: '' } : { ...location, view, collectionId: undefined, folderId: undefined, page: undefined };
    return <li key={view}><a className="library-sidebar__link" href={libraryHref(next, basePath)} aria-label={label} title={collapsed ? label : undefined} aria-current={location.view === view ? 'page' : undefined}
      onClick={(event) => navigate(event, next)}><Icon aria-hidden="true" focusable="false" /><span>{label}</span></a></li>;
  };
  return <aside className="library-sidebar" aria-label="书库侧边栏" data-collapsed={collapsed}>
    {onToggleCollapsed && <div className="library-sidebar__header"><span className="library-sidebar__brand">My Books</span><IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose}
      label={collapsed ? '展开侧边栏' : '收起侧边栏'} variant="ghost" material="solid" onClick={onToggleCollapsed} aria-expanded={!collapsed} /></div>}
    <nav className="library-sidebar__navigation" aria-label="书库导航">
      <section className="library-sidebar__section" aria-label="My Books">
        <ul>{personalItems.map(renderItem)}</ul>
      </section>
      <section className="library-sidebar__section" aria-label="书库">
        <h2 className="library-sidebar__heading">书库</h2><ul>{libraryItems.map(renderItem)}</ul>
      </section>
      <section className="library-sidebar__section" aria-label="我的分类">
        <h2 className="library-sidebar__heading">我的分类</h2>
        {collectionsStatus === 'loading' && <p className="library-sidebar__message" role="status">正在载入分类…</p>}
        {collectionsStatus === 'error' && <div className="library-sidebar__message library-sidebar__error"><span role="status">分类暂时无法载入</span>
          <IconButton icon={RefreshCw} label="重新载入分类" size="sm" material="solid" variant="ghost" onClick={onRetry} /></div>}
        {authenticated && collectionsStatus === 'ready' && !collections.length && <p className="library-sidebar__message">暂无分类</p>}
        {collectionsStatus === 'ready' && <ul>{collections.map((collection) => {
          const next: LibraryLocation = collection.source === 'app'
            ? { ...location, view: 'folder', folderId: collection.id, collectionId: undefined, page: undefined }
            : { ...location, view: 'collection', collectionId: collection.id, folderId: undefined, page: undefined };
          return <li key={collection.id}><a className="library-sidebar__link" data-folder={collection.source === 'app'}
            style={{ '--library-folder-indent': `${Math.min(collection.depth ?? 0, 6) * 12}px` } as CSSProperties}
            href={libraryHref(next, basePath)} title={collection.path ?? collection.name} aria-label={collection.name}
            aria-current={location.view === next.view && (next.view === 'folder' ? location.folderId === collection.id : location.collectionId === collection.id) ? 'page' : undefined} onClick={(event) => navigate(event, next)}>
            <FolderClosed aria-hidden="true" focusable="false" /><span>{collection.name}</span></a></li>;
        })}</ul>}
      </section>
    </nav>
    <footer className="library-sidebar__footer">
      {authenticated
        ? <span className="library-sidebar__account" aria-label={`已登录：${accountName}`} title={accountName}><span className="library-sidebar__avatar">
          {avatar && avatar !== failedAvatar ? <img src={avatar} alt="" onError={() => setFailedAvatar(avatar)} /> : <UserRound aria-hidden="true" focusable="false" />}
        </span><span className="library-sidebar__account-name">{accountName}</span></span>
        : <button type="button" className="library-sidebar__account" onClick={onRequireLogin} aria-label="登录" title={collapsed ? '登录' : undefined}><span className="library-sidebar__avatar"><UserRound aria-hidden="true" focusable="false" /></span><span className="library-sidebar__account-name">登录</span></button>}
      <a className="library-sidebar__settings" href={libraryHref(settingsLocation, basePath)} aria-label="设置" title="设置"
        aria-current={location.view === 'settings' ? 'page' : undefined} onClick={(event) => navigate(event, settingsLocation)}><Settings aria-hidden="true" focusable="false" /></a>
    </footer>
  </aside>;
}
