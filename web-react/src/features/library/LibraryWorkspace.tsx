import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import MainLayout from '../../layouts/MainLayout';
import { GlassDialog } from '../../design-system/components/GlassDialog/GlassDialog';
import { IconButton } from '../../design-system/components/IconButton/IconButton';
import { LibrarySidebar, libraryLocationLabel } from './components/LibrarySidebar';
import { libraryHref, readLibraryLocation } from './library-navigation';
import type { LibraryCollection, LibraryLocation } from './library-navigation';
import { useLibraryCollections } from './useLibraryCollections';
import { useSidebarSwipe } from './useSidebarSwipe';
import { LibraryBooks } from './components/LibraryBooks';
import { LibrarySearch } from './components/LibrarySearch';
import { useLibraryFacets } from './useLibraryFacets';
import type { LibraryFacetOptions } from './useLibraryFacets';
import { isBookView } from './library-books';
import type { LibraryBook, LoadLibraryBooks } from './library-books';
import type { LoadBookDetail } from '../book-detail/book-detail';
import { BookDetailDialog } from '../book-detail/BookDetailDialog';
import { BookEditorDialog } from '../book-editor/BookEditorDialog';
import type { BookEditorService } from '../book-editor/book-editor';
import { HomePage } from '../home/HomePage';
import { SettingsPage } from '../settings/SettingsPage';
import { LoginDialog } from '../auth/LoginDialog';
import { useAccountProfile } from '../auth/useAccountProfile';
import { apiGet } from '../../shared/api';
import './library-workspace.css';

export interface LibraryWorkspaceProps {
  collections?: readonly LibraryCollection[];
  loadBooks?: LoadLibraryBooks;
  facets?: LibraryFacetOptions;
  loadBook?: LoadBookDetail;
  homeBooks?: readonly LibraryBook[];
  guestPreview?: boolean;
  editorService?: BookEditorService;
  basePath?: string;
}

export default function LibraryWorkspace({ collections: suppliedCollections, loadBooks, facets: suppliedFacets, loadBook, homeBooks, guestPreview = false, editorService, basePath = '/mybooks' }: LibraryWorkspaceProps) {
  const preview = suppliedCollections !== undefined;
  const readLocation = () => readLibraryLocation(window.location.pathname, window.location.search, basePath, preview && !guestPreview ? 'all' : 'home');
  const [location, setLocation] = useState(readLocation);
  const [query, setQuery] = useState(location.query);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('mybooks.admin.sidebarCollapsed') === 'true'; } catch { return false; }
  });
  const [auth, setAuth] = useState<'checking' | 'anonymous' | 'authenticated'>(preview ? guestPreview ? 'anonymous' : 'authenticated' : 'checking');
  const [loginOpen, setLoginOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [homeBook, setHomeBook] = useState<LibraryBook | null>(null);
  const [homeDetailOpen, setHomeDetailOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const waitingForLoginClose = useRef(false);
  const contentRef = useRef<HTMLElement>(null);
  const sidebarDialogRef = useRef<HTMLDialogElement>(null);
  const swipeHandlers = useSidebarSwipe(sidebarDialogRef, sidebarOpen, () => setSidebarOpen(false));
  const authenticated = auth === 'authenticated';
  const accountProfile = useAccountProfile(!preview && authenticated);
  const remote = useLibraryCollections(!preview && authenticated);
  const remoteFacets = useLibraryFacets(!preview && authenticated && suppliedFacets === undefined && isBookView(location.view));
  const facets = suppliedFacets ? { ...suppliedFacets, status: 'ready' as const, error: '', retry: remoteFacets.retry } : remoteFacets;
  const collections = authenticated ? suppliedCollections ?? remote.collections : [];
  const collectionsStatus = preview || !authenticated ? 'ready' : remote.status;
  const activeLabel = libraryLocationLabel(location, collections);
  const commit = (next: LibraryLocation, replace = false) => {
    const href = libraryHref(next, basePath);
    if (href !== window.location.pathname + window.location.search) {
      if (replace) window.history.replaceState(null, '', href); else window.history.pushState(null, '', href);
    }
    setLocation(next); setQuery(next.query);
  };
  const resume = () => { const action = pending.current; pending.current = null; action?.(); };
  const requestAccess = (action: () => void) => {
    setSidebarOpen(false);
    if (authenticated) { action(); return; }
    pending.current = action;
    if (auth === 'anonymous') setLoginOpen(true);
  };
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    void apiGet('/api/auth/me', controller.signal, { redirectOnUnauthorized: false }).then(({ data }) => {
      if (!controller.signal.aborted) setAuth(data && typeof data === 'object' && 'authenticated' in data && data.authenticated === true ? 'authenticated' : 'anonymous');
    }).catch(() => { if (!controller.signal.aborted) setAuth('anonymous'); });
    return () => controller.abort();
  }, [preview]);
  useEffect(() => {
    if (auth === 'authenticated' && pending.current && !waitingForLoginClose.current) { setLoginOpen(false); resume(); }
    else if (auth === 'anonymous' && pending.current) setLoginOpen(true);
  }, [auth]);
  useEffect(() => {
    if (!preview && auth === 'anonymous' && location.view !== 'home') {
      const destination = location;
      pending.current = () => commit(destination);
      commit({ view: 'home', query: '' }, true); setLoginOpen(true);
    }
  }, [auth, location, preview]);
  useEffect(() => {
    const expired = (event: Event) => {
      event.preventDefault();
      const destination = location;
      pending.current ??= homeDetailOpen ? () => setHomeDetailOpen(true) : () => commit(destination);
      setHomeDetailOpen(false); setAuth('anonymous'); commit({ view: 'home', query: '' }, true); setLoginOpen(true);
    };
    window.addEventListener('mybooks:login-required', expired);
    return () => window.removeEventListener('mybooks:login-required', expired);
  }, [location, homeDetailOpen]);
  useEffect(() => {
    const href = libraryHref(location, basePath);
    if (href !== window.location.pathname + window.location.search) window.history.replaceState(null, '', href);
  }, []);
  useEffect(() => {
    const changed = () => { const next = readLocation(); setLocation(next); setQuery(next.query); setSidebarOpen(false); };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, [preview, basePath]);
  useEffect(() => { document.title = `${location.query ? '搜索图书' : activeLabel} · My Books`; }, [activeLabel, location.query]);
  useEffect(() => {
    const drawer = window.matchMedia('(max-width: 767px), (orientation: portrait)');
    const changed = () => { if (!drawer.matches) setSidebarOpen(false); };
    drawer.addEventListener('change', changed);
    return () => drawer.removeEventListener('change', changed);
  }, []);
  const sidebarProps = { location, collections, collectionsStatus, basePath, onRetry: remote.retry, authenticated, accountProfile,
    onRequireLogin: () => { pending.current = null; setSidebarOpen(false); setLoginOpen(true); },
    onNavigate: (next: LibraryLocation) => { if (next.view === 'home') { commit(next); setSidebarOpen(false); } else requestAccess(() => commit(next)); } };
  const toggleSidebar = () => {
    const next = !sidebarCollapsed; setSidebarCollapsed(next);
    try { localStorage.setItem('mybooks.admin.sidebarCollapsed', String(next)); } catch { /* 存储可禁用。 */ }
  };
  const search = <LibrarySearch query={query} onQueryChange={setQuery}
    onSearch={() => requestAccess(() => commit({ ...location, view: 'all', collectionId: undefined, query: query.trim(), page: undefined }))}
    onClearSearch={() => { setQuery(''); if (location.query) commit({ ...location, query: '', page: undefined }); }} />;
  const saved = () => { setRefreshKey(value => value + 1); remoteFacets.retry(); remote.retry(); };
  const add = !preview || editorService ? () => requestAccess(() => { setEditingId(undefined); setCreateOpen(true); }) : undefined;
  const edit = add ? (id: number) => requestAccess(() => { setEditingId(id); setCreateOpen(true); }) : undefined;
  const showHome = location.view === 'home' || !authenticated;
  return <>
    <MainLayout contentRef={contentRef} sidebar={<LibrarySidebar {...sidebarProps} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} />}
      sidebarCollapsed={sidebarCollapsed} topBar={location.view === 'all' ? search : undefined} contentLabel={`${showHome ? '首页' : activeLabel}内容区域`}
      mobileHeader={<><IconButton icon={Menu} label="打开侧边栏" variant="ghost" material="solid" onClick={() => setSidebarOpen(true)}
        aria-haspopup="dialog" aria-expanded={sidebarOpen} aria-controls="library-sidebar-dialog" /><span className="library-workspace__brand">My Books</span></>}>
      {showHome ? <HomePage books={homeBooks} onAdd={add} onEdit={edit} refreshKey={refreshKey} onOpenBook={(book) => requestAccess(() => { setHomeBook(book); setHomeDetailOpen(true); })} />
        : location.view === 'settings' ? <SettingsPage anchorRef={contentRef} onSignedOut={() => {
          pending.current = null; waitingForLoginClose.current = false;
          setLoginOpen(false); setCreateOpen(false); setEditingId(undefined);
          setHomeDetailOpen(false); setHomeBook(null); setSidebarOpen(false);
          commit({ view: 'home', query: '' }, true); setAuth('anonymous');
        }} />
        : (suppliedCollections === undefined || loadBooks) && (isBookView(location.view)
          ? <LibraryBooks key={`${refreshKey}:${location.view === 'folder' ? remote.revision : 0}`} onAdd={add} onEdit={edit} location={location} title={activeLabel} onNavigate={commit} load={loadBooks} facets={facets} loadBook={loadBook} dialogAnchorRef={contentRef} />
          : <section className="library-books__pending"><h1>{activeLabel}</h1><p>此页面将在后续迁移。</p></section>)}
    </MainLayout>
    <GlassDialog ref={sidebarDialogRef} id="library-sidebar-dialog" className="library-sidebar-dialog" open={sidebarOpen} onOpenChange={setSidebarOpen}
      title="My Books" closeLabel="关闭侧边栏" material="solid" size="sm"><div className="library-sidebar-dialog__gesture" {...swipeHandlers}><LibrarySidebar {...sidebarProps} /></div></GlassDialog>
    <LoginDialog open={loginOpen} onOpenChange={(next) => { if (!next) pending.current = null; setLoginOpen(next); }} anchorRef={contentRef}
      onSuccess={() => { waitingForLoginClose.current = true; setAuth('authenticated'); setLoginOpen(false); }}
      onAfterClose={() => { waitingForLoginClose.current = false; if (auth === 'authenticated') resume(); }} />
    <BookEditorDialog bookId={editingId} open={authenticated && createOpen} onOpenChange={setCreateOpen} anchorRef={contentRef} service={editorService} onSaved={saved} />
    <BookDetailDialog book={homeBook} open={authenticated && homeDetailOpen} onOpenChange={setHomeDetailOpen} anchorRef={contentRef} load={loadBook} />
  </>;
}
