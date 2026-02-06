import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Save, Copy, Check } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';

export function CodeEditor({ onSelectionChange }) {
  const { activeFilePath, openFiles, updateActiveFileContent, saveActiveFile } = useEditorStore(
    (state) => ({
      activeFilePath: state.activeFilePath,
      openFiles: state.openFiles,
      updateActiveFileContent: state.updateActiveFileContent,
      saveActiveFile: state.saveActiveFile,
    }),
  );

  const textareaRef = useRef(null);
  const [lineCount, setLineCount] = useState(0);
  const [cursorLine, setCursorLine] = useState(1);
  const [copied, setCopied] = useState(false);

  const fileState = activeFilePath ? openFiles[activeFilePath] : null;
  const content = fileState?.content ?? '';
  const dirty = !!fileState?.dirty;

  // Update line count when content changes
  useEffect(() => {
    setLineCount(content.split('\n').length);
  }, [content]);

  // Handle text selection change
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !onSelectionChange) return;
    
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart !== selectionEnd) {
      const selected = value.substring(selectionStart, selectionEnd);
      // Calculate start line number
      const beforeSelection = value.substring(0, selectionStart);
      const startLine = beforeSelection.split('\n').length;
      onSelectionChange(selected, startLine);
    } else {
      onSelectionChange(null, null);
    }
  }, [onSelectionChange]);

  // Track cursor line
  const handleCursorChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const beforeCursor = textarea.value.substring(0, textarea.selectionStart);
    setCursorLine(beforeCursor.split('\n').length);
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveActiveFile();
    }
    // Tab handling
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      const { selectionStart, selectionEnd, value } = textarea;
      const newValue = value.substring(0, selectionStart) + '  ' + value.substring(selectionEnd);
      updateActiveFileContent(newValue);
      // Restore cursor position
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      });
    }
  }, [saveActiveFile, updateActiveFileContent]);

  const copyContent = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  // Get file extension for display
  const ext = activeFilePath?.split('.').pop()?.toLowerCase() || '';
  const langMap = {
    js: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX',
    py: 'Python', css: 'CSS', html: 'HTML', json: 'JSON', md: 'Markdown',
    rs: 'Rust', go: 'Go', java: 'Java', cpp: 'C++', c: 'C', sh: 'Shell',
    yaml: 'YAML', yml: 'YAML', toml: 'TOML', sql: 'SQL', xml: 'XML',
  };
  const language = langMap[ext] || ext.toUpperCase() || 'Text';

  if (!activeFilePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center border border-dashed border-forge-border rounded-lg bg-forge-bg/40">
        <p className="text-xs text-text-muted mb-1">No file selected</p>
        <p className="text-[11px] text-text-muted">
          Choose a file from the project tree to start coding.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border border-forge-border rounded-lg bg-forge-bg/80 overflow-hidden">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-forge-border bg-forge-surface/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-xs text-text-primary font-mono">
            {activeFilePath.split(/[/\\]/).pop()}
            {dirty && <span className="ml-1 text-workspace-code">●</span>}
          </span>
          <span className="text-[10px] text-text-muted px-1 py-0.5 rounded bg-forge-bg/60">
            {language}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyContent}
            className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
            title="Copy file content"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            onClick={saveActiveFile}
            disabled={!dirty}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
              dirty
                ? 'bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30'
                : 'text-text-muted/40 cursor-default'
            }`}
          >
            <Save size={12} />
            Save
          </button>
        </div>
      </div>
      
      {/* Editor area with line numbers */}
      <div className="flex-1 min-h-0 flex overflow-auto">
        {/* Line numbers gutter */}
        <div className="flex-shrink-0 bg-forge-bg/40 border-r border-forge-border/30 px-2 py-3 select-none text-right"
          style={{ minWidth: `${Math.max(3, String(lineCount).length + 1)}ch` }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className={`text-[11px] font-mono leading-[1.4] ${
                cursorLine === i + 1 ? 'text-text-primary' : 'text-text-muted/40'
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>
        
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="flex-1 min-w-0 bg-transparent text-[12px] font-mono text-text-primary py-3 px-3 resize-none outline-none leading-[1.4]"
          spellCheck={false}
          value={content}
          onChange={(e) => updateActiveFileContent(e.target.value)}
          onSelect={handleSelect}
          onKeyUp={handleCursorChange}
          onMouseUp={() => { handleSelect(); handleCursorChange(); }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-forge-border/30 bg-forge-surface/30 text-[10px] text-text-muted">
        <span className="truncate" title={activeFilePath}>{activeFilePath}</span>
        <div className="flex items-center gap-3">
          <span>Ln {cursorLine}</span>
          <span>{lineCount} lines</span>
          {dirty && <span className="text-workspace-code">Modified</span>}
        </div>
      </div>
    </div>
  );
}

export default CodeEditor;
