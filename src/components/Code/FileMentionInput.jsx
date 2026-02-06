import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FileCode, FolderTree, ChevronRight, X, Hash } from 'lucide-react';

/**
 * FileMentionInput - A textarea wrapper that supports @file mentions
 * 
 * When the user types '@', a dropdown appears showing matching files
 * from the project tree. Selecting a file inserts @path/to/file.ext.
 * 
 * On submit, mentioned files are parsed and their contents can be fetched.
 */

// Flatten a file tree into a list of {path, name, type}
function flattenTree(nodes, prefix = '') {
  const result = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'coverage', '.venv', 'venv']);
  
  for (const node of nodes || []) {
    if (SKIP.has(node.name)) continue;
    if (node.name.startsWith('.') && !node.name.startsWith('.env')) continue;
    
    const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
    result.push({
      path: node.path || fullPath,
      name: node.name,
      type: node.type,
      relativePath: fullPath,
    });
    
    if (node.type === 'dir' && node.children) {
      result.push(...flattenTree(node.children, fullPath));
    }
  }
  return result;
}

// Parse @mentions from text
export function parseMentions(text) {
  // Match @path/to/file.ext patterns (supports spaces in quotes: @"path with spaces")
  const regex = /@(?:"([^"]+)"|(\S+?\.\w+))/g;
  const mentions = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push({
      fullMatch: match[0],
      path: match[1] || match[2],
      index: match.index,
    });
  }
  return mentions;
}

// Remove @mention syntax from text for clean display
export function stripMentions(text) {
  return text.replace(/@(?:"([^"]+)"|(\S+?\.\w+))/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function FileMentionInput({
  value,
  onChange,
  onKeyDown,
  onSubmit,
  placeholder,
  disabled,
  projectFiles = [],
  className,
  inputRef: externalRef,
}) {
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;
  const dropdownRef = useRef(null);
  
  const [showDropdown, setShowDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionedFiles, setMentionedFiles] = useState([]);

  // Build flat file list
  const flatFiles = useMemo(() => flattenTree(projectFiles), [projectFiles]);

  // Filter files based on mention query
  const filteredFiles = useMemo(() => {
    if (!mentionQuery) return flatFiles.slice(0, 20);
    const q = mentionQuery.toLowerCase();
    return flatFiles
      .filter(f => 
        f.name.toLowerCase().includes(q) || 
        f.relativePath.toLowerCase().includes(q)
      )
      .slice(0, 15);
  }, [flatFiles, mentionQuery]);

  // Track mentioned files in the input
  useEffect(() => {
    const mentions = parseMentions(value);
    setMentionedFiles(mentions.map(m => m.path));
  }, [value]);

  // Handle input changes - detect @ trigger
  const handleChange = useCallback((e) => {
    const newValue = e.target.value;
    onChange(newValue);

    const textarea = e.target;
    const cursorPos = textarea.selectionStart;
    const textBefore = newValue.substring(0, cursorPos);
    
    // Find the last @ before cursor
    const lastAtIndex = textBefore.lastIndexOf('@');
    
    if (lastAtIndex >= 0) {
      const afterAt = textBefore.substring(lastAtIndex + 1);
      // Only show dropdown if @ is at start of word (preceded by space/newline/start)
      const charBefore = lastAtIndex > 0 ? textBefore[lastAtIndex - 1] : ' ';
      if (/[\s\n]/.test(charBefore) || lastAtIndex === 0) {
        // Check if the text after @ doesn't contain spaces (unless we're still typing)
        if (!afterAt.includes(' ') || afterAt.length < 2) {
          setShowDropdown(true);
          setMentionQuery(afterAt);
          setMentionStart(lastAtIndex);
          setSelectedIndex(0);
          return;
        }
      }
    }
    
    setShowDropdown(false);
  }, [onChange]);

  // Handle file selection from dropdown
  const selectFile = useCallback((file) => {
    const textarea = ref.current;
    if (!textarea) return;

    const beforeMention = value.substring(0, mentionStart);
    const afterCursor = value.substring(textarea.selectionStart);
    
    // Insert the file path with @ prefix
    const mention = `@${file.relativePath} `;
    const newValue = beforeMention + mention + afterCursor;
    
    onChange(newValue);
    setShowDropdown(false);
    
    // Restore focus and cursor position
    requestAnimationFrame(() => {
      textarea.focus();
      const newCursor = beforeMention.length + mention.length;
      textarea.selectionStart = textarea.selectionEnd = newCursor;
    });
  }, [value, mentionStart, onChange, ref]);

  // Handle keyboard navigation in dropdown
  const handleKeyDownInternal = useCallback((e) => {
    if (showDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredFiles.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectFile(filteredFiles[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowDropdown(false);
        return;
      }
    }
    
    // Pass through to parent handler
    onKeyDown?.(e);
  }, [showDropdown, filteredFiles, selectedIndex, selectFile, onKeyDown]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return;
    const selected = dropdownRef.current.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, showDropdown]);

  // Remove a mentioned file
  const removeMention = useCallback((filePath) => {
    const regex = new RegExp(`@(?:"${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"|${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s?`, 'g');
    const newValue = value.replace(regex, '').trim();
    onChange(newValue);
  }, [value, onChange]);

  return (
    <div className="relative flex-1">
      {/* Mentioned files chips */}
      {mentionedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-forge-border/20">
          {mentionedFiles.map((path, i) => (
            <span
              key={`${path}-${i}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-workspace-code/15 text-workspace-code border border-workspace-code/25"
            >
              <FileCode size={9} />
              <span className="truncate max-w-[120px]">{path.split('/').pop()}</span>
              <button
                onClick={() => removeMention(path)}
                className="hover:text-red-400 transition-colors"
              >
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
      )}
      
      {/* Textarea */}
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={className}
        style={{ height: 'auto', minHeight: '38px' }}
        onInput={(e) => {
          e.target.style.height = 'auto';
          e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
        }}
      />
      
      {/* Autocomplete dropdown */}
      {showDropdown && filteredFiles.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 right-0 mb-1 max-h-[200px] overflow-y-auto bg-forge-surface border border-forge-border rounded-lg shadow-xl z-50"
        >
          <div className="px-2 py-1 text-[10px] text-text-muted border-b border-forge-border/30">
            Type to filter files • Enter to select • Esc to cancel
          </div>
          {filteredFiles.map((file, idx) => {
            const isDir = file.type === 'dir';
            return (
              <button
                key={file.path}
                data-selected={idx === selectedIndex}
                onClick={() => selectFile(file)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                  idx === selectedIndex 
                    ? 'bg-workspace-code/20 text-text-primary' 
                    : 'text-text-secondary hover:bg-forge-hover/50'
                }`}
              >
                {isDir ? (
                  <FolderTree size={12} className="text-amber-400 flex-shrink-0" />
                ) : (
                  <FileCode size={12} className="text-workspace-code flex-shrink-0" />
                )}
                <span className="text-[11px] font-mono truncate">{file.relativePath}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default FileMentionInput;
