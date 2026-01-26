import React, { useState, useCallback } from 'react';
import { Search, Replace, FileText, CheckCircle2, XCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { findInFiles, previewReplace, replaceInFiles } from '../../services/multiFileOps';
import { hasCodeIndex } from '../../services/codeIndexer';
import { useEditorStore } from '../../stores/editorStore';

export function FindReplacePanel() {
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [results, setResults] = useState([]);
  const [preview, setPreview] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceResult, setReplaceResult] = useState(null);
  const [expandedFiles, setExpandedFiles] = useState({});
  const [showReplace, setShowReplace] = useState(false);

  const { openFile } = useEditorStore();

  const handleSearch = useCallback(() => {
    if (!searchTerm.trim()) return;
    setIsSearching(true);
    setReplaceResult(null);

    // Run search (this is synchronous since it uses the in-memory index)
    const matches = findInFiles(searchTerm, { caseSensitive, wholeWord, regex: useRegex });
    
    // Group by file
    const byFile = {};
    for (const match of matches) {
      if (!byFile[match.path]) {
        byFile[match.path] = { path: match.path, name: match.name, matches: [] };
      }
      byFile[match.path].matches.push(match);
    }
    
    setResults(Object.values(byFile));
    setIsSearching(false);

    // Auto-expand first few files
    const expanded = {};
    Object.keys(byFile).slice(0, 3).forEach(path => { expanded[path] = true; });
    setExpandedFiles(expanded);
  }, [searchTerm, caseSensitive, wholeWord, useRegex]);

  const handlePreviewReplace = useCallback(() => {
    if (!searchTerm.trim() || !replaceTerm) return;
    const changes = previewReplace(searchTerm, replaceTerm, { caseSensitive, wholeWord, regex: useRegex });
    setPreview(changes);
  }, [searchTerm, replaceTerm, caseSensitive, wholeWord, useRegex]);

  const handleReplaceAll = useCallback(async () => {
    if (!searchTerm.trim()) return;
    setIsReplacing(true);
    setReplaceResult(null);

    try {
      const result = await replaceInFiles(searchTerm, replaceTerm, null, {
        caseSensitive,
        wholeWord,
        regex: useRegex,
      });
      setReplaceResult(result);
      
      // Clear results after successful replace
      if (result.success && result.modifiedFiles > 0) {
        setResults([]);
        setPreview([]);
      }
    } catch (error) {
      setReplaceResult({ success: false, error: error.message });
    }

    setIsReplacing(false);
  }, [searchTerm, replaceTerm, caseSensitive, wholeWord, useRegex]);

  const toggleFile = (path) => {
    setExpandedFiles(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const goToMatch = (match) => {
    openFile(match.path);
    // TODO: scroll to line in editor
  };

  const indexReady = hasCodeIndex();
  const totalMatches = results.reduce((sum, file) => sum + file.matches.length, 0);

  return (
    <div className="bg-forge-surface/50 rounded-lg border border-forge-border/30 p-3 flex flex-col gap-3 max-h-80 overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-forge-text-muted flex items-center gap-1.5">
          <Search size={12} />
          Find & Replace
        </h3>
        <button
          onClick={() => setShowReplace(!showReplace)}
          className="text-xs text-forge-text-muted hover:text-forge-text"
        >
          {showReplace ? 'Hide Replace' : 'Show Replace'}
        </button>
      </div>

      {!indexReady ? (
        <p className="text-xs text-forge-text-muted">
          Index not ready. Click "Map project" in the agent bar first.
        </p>
      ) : (
        <>
          {/* Search input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search across files..."
              className="flex-1 bg-forge-bg/50 border border-forge-border/30 rounded px-2 py-1 text-xs text-forge-text placeholder:text-forge-text-muted/50 focus:outline-none focus:border-workspace-code/50"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchTerm.trim()}
              className="px-2 py-1 bg-workspace-code/20 hover:bg-workspace-code/30 text-workspace-code rounded text-xs disabled:opacity-50"
            >
              {isSearching ? <RefreshCw size={12} className="animate-spin" /> : 'Find'}
            </button>
          </div>

          {/* Replace input */}
          {showReplace && (
            <div className="flex gap-2">
              <input
                type="text"
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                placeholder="Replace with..."
                className="flex-1 bg-forge-bg/50 border border-forge-border/30 rounded px-2 py-1 text-xs text-forge-text placeholder:text-forge-text-muted/50 focus:outline-none focus:border-workspace-code/50"
              />
              <button
                onClick={handleReplaceAll}
                disabled={isReplacing || !searchTerm.trim()}
                className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-xs disabled:opacity-50"
              >
                {isReplacing ? <RefreshCw size={12} className="animate-spin" /> : 'Replace All'}
              </button>
            </div>
          )}

          {/* Options */}
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1 text-forge-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="w-3 h-3"
              />
              Aa
            </label>
            <label className="flex items-center gap-1 text-forge-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
                className="w-3 h-3"
              />
              Word
            </label>
            <label className="flex items-center gap-1 text-forge-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
                className="w-3 h-3"
              />
              .*
            </label>
          </div>

          {/* Replace result */}
          {replaceResult && (
            <div className={`text-xs p-2 rounded ${replaceResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {replaceResult.success ? (
                <span className="flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  Replaced {replaceResult.totalReplacements} in {replaceResult.modifiedFiles} files
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <XCircle size={12} />
                  {replaceResult.error}
                </span>
              )}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="flex-1 overflow-y-auto space-y-1">
              <p className="text-xs text-forge-text-muted mb-2">
                {totalMatches} matches in {results.length} files
              </p>
              {results.map((file) => (
                <div key={file.path} className="text-xs">
                  <button
                    onClick={() => toggleFile(file.path)}
                    className="flex items-center gap-1 w-full text-left hover:bg-forge-bg/30 rounded px-1 py-0.5"
                  >
                    {expandedFiles[file.path] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <FileText size={12} className="text-workspace-code" />
                    <span className="text-forge-text truncate">{file.name}</span>
                    <span className="text-forge-text-muted ml-auto">({file.matches.length})</span>
                  </button>
                  {expandedFiles[file.path] && (
                    <div className="ml-5 space-y-0.5">
                      {file.matches.slice(0, 10).map((match, i) => (
                        <button
                          key={i}
                          onClick={() => goToMatch(match)}
                          className="block w-full text-left px-1 py-0.5 hover:bg-forge-bg/30 rounded truncate"
                        >
                          <span className="text-forge-text-muted">:{match.line}</span>
                          <span className="text-forge-text ml-2">{match.text}</span>
                        </button>
                      ))}
                      {file.matches.length > 10 && (
                        <p className="text-forge-text-muted px-1">...and {file.matches.length - 10} more</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default FindReplacePanel;













