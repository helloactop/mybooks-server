import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { TextField } from '../../../design-system/components/TextField/TextField';
import { IconButton } from '../../../design-system/components/IconButton/IconButton';
import './library-search.css';

export function LibrarySearch({ query, onQueryChange, onSearch, onClearSearch }: {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <form className="library-search" role="search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
    <TextField ref={inputRef} className="library-search__field" label="搜索图书" type="search" placeholder="搜索图书"
      startIcon={Search} material="liquid" intensity="subtle" value={query}
      onChange={(event) => onQueryChange(event.currentTarget.value)} enterKeyHint="search" />
    {query && <IconButton className="library-search__clear" icon={X} label="清除搜索" size="sm" variant="ghost" material="solid"
      onClick={() => { onClearSearch(); inputRef.current?.focus(); }} />}
  </form>;
}
