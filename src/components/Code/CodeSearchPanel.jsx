import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { searchCodeIndex, hasCodeIndex } from '../../services/codeIndexer';

export function CodeSearchPanel() {
  const { rootPath, isIndexingCode } = useEditorStore((state) => ({
    rootPath: state.rootPath,
    isIndexingCode: state.isIndexingCode,
  }));
  const openFile = useEditorStore((state) => state.openFile);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [touched, setTouched] = useState(false);

  const handleSearch = () => {
    setTouched(true);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (!hasCodeIndex()) {
      // Index is built as part of "Map project" / analyzeProject;
      // if it's missing, nudge the user instead of doing heavy work implicitly.
      setResults([
        {
          path: '',
          name: 'Index not ready',
          excerpt: 'Click "Refresh context" in the Agent bar to build the project index first.',
        },
      ]);
      return;
    }
    const hits = searchCodeIndex(query.trim(), { limit: 15 });
    setResults(hits);
  };

  if (!rootPath) {
    return (
      <div className="border border-dashed border-forge-border rounded-lg p-2 text-[11px] text-text-muted">
        Open a project to search code.
      </div>
    );
  }

  return (
    <div className="border border-forge-border rounded-lg bg-forge-bg/70 p-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Search size={12} className="text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder="Search code (name or text)…"
          className="flex-1 bg-transparent border-none outline-none text-[11px] text-text-primary"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={isIndexingCode}
          className="px-2 py-1 text-[11px] rounded bg-forge-elevated text-text-muted hover:text-text-primary disabled:opacity-60"
        >
          Go
        </button>
      </div>
      <div className="border-t border-forge-border pt-1 max-h-36 overflow-auto text-[11px]">
        {!touched && (
          <div className="text-text-muted px-1 py-1">
            Type a term and press Enter. Use **Map project** to refresh the search index.
          </div>
        )}
        {touched && results.length === 0 && (
          <div className="text-text-muted px-1 py-1">No matches found.</div>
        )}
        {results.map((hit) => (
          <button
            key={`${hit.path}-${hit.name}-${hit.excerpt}`}
            type="button"
            className="w-full text-left px-1 py-1 rounded hover:bg-forge-hover/60"
            onClick={() => hit.path && openFile(hit.path)}
          >
            <div className="flex items-center justify-between">
              <span className="text-text-primary truncate max-w-[150px]">{hit.name}</span>
              {hit.lang && <span className="text-[10px] text-text-muted uppercase">{hit.lang}</span>}
            </div>
            {hit.excerpt && (
              <div className="text-[10px] text-text-muted line-clamp-2 whitespace-pre-wrap">{hit.excerpt}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default CodeSearchPanel;














