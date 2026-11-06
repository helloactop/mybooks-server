export const libraryViews = ['all', 'home', 'statistics', 'unread', 'finished', 'ebooks', 'pdf', 'notes', 'collection', 'folder', 'settings'] as const;
export type LibraryView = typeof libraryViews[number];
export const librarySorts = ['updated', 'created', 'title', 'author', 'finish', 'relevance'] as const;
export type LibrarySort = typeof librarySorts[number];
export interface LibraryLocation { view: LibraryView; query: string; collectionId?: string; folderId?: string; sort?: LibrarySort; page?: number; author?: string; publisher?: string; translator?: string; }
export interface LibraryCollection { id: string; name: string; source?: 'app'; depth?: number; path?: string; }

export const bookViews = ['all', 'unread', 'finished', 'ebooks', 'pdf'] as const;

export function normalizeBasePath(basePath: string): string {
  const normalized = '/' + basePath.replace(/^\/+|\/+$/g, '');
  return normalized === '/' ? '/' : normalized;
}

function isLibraryView(value: string): value is LibraryView {
  return (libraryViews as readonly string[]).includes(value);
}

export function readLibraryLocation(pathname: string, search: string, basePath = '/mybooks', defaultView: LibraryView = 'home'): LibraryLocation {
  const base = normalizeBasePath(basePath);
  const path = pathname.replace(/\/+$/, '') || '/';
  let segments: string[] = [];
  if (path.startsWith(base + '/')) {
    segments = path.slice(base.length + 1).split('/').filter(Boolean).map((segment) => {
      try { return decodeURIComponent(segment); } catch { return segment; }
    });
  }
  let pathView: LibraryView | undefined;
  let pathCollection: string | undefined;
  let pathFolder: string | undefined;
  if (segments[0] === 'books' && segments.length === 2 && (bookViews as readonly string[]).includes(segments[1])) {
    pathView = segments[1] as LibraryView;
  } else if (segments[0] === 'collections' && segments.length === 2 && segments[1]) {
    pathView = 'collection';
    pathCollection = segments[1];
  } else if (segments[0] === 'folders' && segments.length === 2 && segments[1]) {
    pathView = 'folder'; pathFolder = segments[1];
  } else if (segments.length === 1 && isLibraryView(segments[0])) {
    pathView = segments[0];
  }

  const params = new URLSearchParams(search);
  const candidate = params.get('view');
  const legacyBookQuery = ['q', 'sort', 'author', 'publisher', 'translator', 'collection', 'page'].some((key) => params.has(key));
  const queryView = candidate && isLibraryView(candidate) ? candidate : params.has('folder') ? 'folder' : legacyBookQuery ? 'all' : undefined;
  const view = pathView ?? queryView ?? defaultView;
  const collectionId = pathCollection ?? params.get('collection') ?? undefined;
  const folderId = pathFolder ?? params.get('folder') ?? undefined;
  const sort = params.get('sort');
  const page = params.get('page') ?? '';
  const author = params.get('author')?.trim();
  const publisher = params.get('publisher')?.trim();
  const translator = params.get('translator')?.trim();
  return { view: view === 'collection' && !collectionId || view === 'folder' && !folderId ? 'all' : view, query: params.get('q') ?? '', collectionId: view === 'collection' ? collectionId : undefined,
    ...(view === 'folder' ? { folderId } : {}),
    sort: librarySorts.includes(sort as LibrarySort) ? sort as LibrarySort : undefined,
    page: /^\d+$/.test(page) && Number.isSafeInteger(Number(page)) && Number(page) > 1 && Number(page) <= Math.floor(Number.MAX_SAFE_INTEGER / 200) ? Number(page) : undefined,
    ...(author ? { author } : {}), ...(publisher ? { publisher } : {}), ...(translator ? { translator } : {}) };
}

export function libraryHref(location: LibraryLocation, basePath = '/mybooks'): string {
  const base = normalizeBasePath(basePath);
  const path = location.view === 'home' ? (base === '/' ? '/' : `${base}/`)
    : location.view === 'settings' ? `${base}/settings`
    : location.view === 'statistics' ? `${base}/statistics`
    : location.view === 'notes' ? `${base}/notes`
    : location.view === 'collection' ? `${base}/collections/${encodeURIComponent(location.collectionId ?? '')}`
    : location.view === 'folder' ? `${base}/folders/${encodeURIComponent(location.folderId ?? '')}`
    : `${base}/books/${location.view}`;
  const params = new URLSearchParams();
  if (location.query.trim()) params.set('q', location.query.trim());
  if (location.sort) params.set('sort', location.sort);
  if (location.author) params.set('author', location.author);
  if (location.publisher) params.set('publisher', location.publisher);
  if (location.translator) params.set('translator', location.translator);
  if (location.page && location.page > 1) params.set('page', String(location.page));
  return path + (params.size ? `?${params}` : '');
}

/** 旧侧栏演示地址对应正式功能，查询条件沿用同一套规范化规则。 */
export function legacySidebarHref(pathname: string, search = ''): string | null {
  const base = '/mybooks/playground/sidebar';
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path !== base && !path.startsWith(base + '/')) return null;
  return libraryHref(readLibraryLocation(path, search, base, 'all'));
}
