import { FilterSelect } from '../../../design-system/components/FilterSelect/FilterSelect';
import { effectiveSort } from '../library-books';
import type { LibraryLocation, LibrarySort } from '../library-navigation';
import './library-toolbar.css';

const sortOptions = [
  { value: 'updated', label: '最近更新' }, { value: 'created', label: '最近添加' },
  { value: 'title', label: '书名' }, { value: 'author', label: '作者' }, { value: 'finish', label: '读完日期' },
];

export function LibraryToolbar({ location, onNavigate }: {
  location: LibraryLocation;
  onNavigate: (location: LibraryLocation) => void;
}) {
  const options = location.query.trim() ? [{ value: 'relevance', label: '相关度' }, ...sortOptions] : sortOptions;
  return <FilterSelect label="排序" className="library-toolbar" options={options} value={effectiveSort(location)}
    triggerLabel={location.sort ? undefined : '排序'}
    onValueChange={(sort) => { if (sort) onNavigate({ ...location, sort: sort as LibrarySort, page: undefined }); }} />;
}
