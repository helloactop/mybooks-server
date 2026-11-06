import { useEffect, useState } from 'react';
import { apiGet, requestErrorMessage } from '../../shared/api';

export interface LibraryFacetOptions { authors: readonly string[]; publishers: readonly string[]; translators: readonly string[]; }
export interface LibraryFacets extends LibraryFacetOptions { status: 'loading' | 'ready' | 'error'; error: string; retry: () => void; }

function parseNames(data: unknown): string[] {
  if (!Array.isArray(data)) throw new Error('invalid-facets');
  return [...new Set(data.filter((item) => item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim()
    && (typeof item.count !== 'number' || item.count > 0)).map((item) => String(item.name)))];
}

export function useLibraryFacets(enabled: boolean): LibraryFacets {
  const [options, setOptions] = useState<LibraryFacetOptions>({ authors: [], publishers: [], translators: [] });
  const [status, setStatus] = useState<LibraryFacets['status']>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setStatus('loading'); setError('');
    void Promise.all([apiGet('/api/authors', controller.signal), apiGet('/api/publishers', controller.signal), apiGet('/api/translators', controller.signal)])
      .then(([authors, publishers, translators]) => {
        if (controller.signal.aborted) return;
        setOptions({ authors: parseNames(authors.data), publishers: parseNames(publishers.data), translators: parseNames(translators.data) }); setStatus('ready');
      }).catch((err: unknown) => {
        if (!controller.signal.aborted) { setStatus('error'); setError(requestErrorMessage(err)); }
      });
    return () => controller.abort();
  }, [enabled, attempt]);
  return { ...options, status, error, retry: () => setAttempt((value) => value + 1) };
}
