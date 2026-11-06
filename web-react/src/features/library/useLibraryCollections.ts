import { useEffect, useState } from 'react';
import type { LibraryCollection } from './library-navigation';
import { apiGet } from '../../shared/api';
import { parseLibraryFolders } from './library-folders';

export function useLibraryCollections(enabled: boolean) {
  const [collections, setCollections] = useState<readonly LibraryCollection[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const current = new AbortController(); controller = current;
      setStatus('loading');
      try {
        const { data } = await apiGet('/api/sync/folders', current.signal);
        const parsed = parseLibraryFolders(data);
        if (current.signal.aborted) return;
        setCollections(parsed.collections); setRevision(parsed.revision);
        setStatus('ready');
      } catch {
        if (!current.signal.aborted) setStatus('error');
      }
    };
    void load();
    const foreground = () => { if (!document.hidden) void load(); };
    window.addEventListener('focus', foreground); document.addEventListener('visibilitychange', foreground);
    return () => { controller?.abort(); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground); };
  }, [enabled, attempt]);
  return { collections, status, revision, retry: () => setAttempt((value) => value + 1) };
}
