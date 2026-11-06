import { FilterSelect } from '../../../design-system/components/FilterSelect/FilterSelect';
import { Button } from '../../../design-system/components/Button/Button';
import type { LibraryFacets } from '../useLibraryFacets';
import type { LibraryLocation } from '../library-navigation';
import { LibraryToolbar } from './LibraryToolbar';

export function LibraryFilters({ location, facets, onNavigate }: {
  location: LibraryLocation; facets: LibraryFacets; onNavigate: (location: LibraryLocation) => void;
}) {
  const options = (names: readonly string[], selected?: string) => [...new Set([...(selected ? [selected] : []), ...names])]
    .map((name) => ({ value: name, label: name }));
  return <>
    <div className="library-books__filters" role="group" aria-label="图书筛选">
      <FilterSelect label="作者" emptyOptionLabel="全部作者" value={location.author ?? ''} options={options(facets.authors, location.author)}
        disabled={facets.status !== 'ready'} onValueChange={(author) => onNavigate({ ...location, author: author || undefined, page: undefined })} />
      <LibraryToolbar location={location} onNavigate={onNavigate} />
      <FilterSelect label="译者" emptyOptionLabel="全部译者" value={location.translator ?? ''} options={options(facets.translators, location.translator)}
        disabled={facets.status !== 'ready'} onValueChange={(translator) => onNavigate({ ...location, translator: translator || undefined, page: undefined })} />
      <FilterSelect label="出版社" emptyOptionLabel="全部出版社" value={location.publisher ?? ''} options={options(facets.publishers, location.publisher)}
        disabled={facets.status !== 'ready'} onValueChange={(publisher) => onNavigate({ ...location, publisher: publisher || undefined, page: undefined })} />
    </div>
    {facets.status === 'error' && <div className="library-books__filter-error" role="alert"><span>筛选选项载入失败：{facets.error}</span>
      <Button material="solid" variant="ghost" size="sm" onClick={facets.retry}>重新载入</Button></div>}
  </>;
}
