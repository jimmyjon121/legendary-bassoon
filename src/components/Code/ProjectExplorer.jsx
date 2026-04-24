import React, { useMemo, useState } from 'react';
import {
  Folder,
  FolderOpen as FolderOpenIcon,
  RefreshCw,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Copy,
  FileJson,
  FileCode2,
  FileType,
  FileImage,
  FileText,
  File,
  Braces,
  Hash,
  Settings,
  Database,
  FilePlus,
  FolderPlus,
  Sparkles,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { shallow } from 'zustand/shallow';

// Empty folder prompt with quick actions
function EmptyFolderPrompt({ error }) {
  const [showNewFile, setShowNewFile] = useState(false);
  const [fileName, setFileName] = useState('');
  const { createFile, rootPath } = useEditorStore();

  const handleCreateFile = async () => {
    if (!fileName.trim()) return;
    await createFile(fileName.trim());
    setFileName('');
    setShowNewFile(false);
  };

  const quickStart = [
    { name: 'index.js', desc: 'JavaScript entry' },
    { name: 'main.py', desc: 'Python script' },
    { name: 'app.jsx', desc: 'React component' },
    { name: 'README.md', desc: 'Documentation' },
  ];

  return (
    <div className="text-xs px-3 py-4 space-y-4">
      {/* Status */}
      <div className="text-center">
        <FolderOpen size={32} className="mx-auto mb-2 text-amber-400/50" />
        <p className="text-text-muted">Empty project folder</p>
        {error && (
          <p className="text-status-error text-[10px] mt-1">{error}</p>
        )}
      </div>

      {/* New File Input */}
      {showNewFile ? (
        <div className="space-y-2">
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="filename.js"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFile();
              if (e.key === 'Escape') setShowNewFile(false);
            }}
            className="w-full text-[11px] h-7 px-2 rounded bg-forge-bg border border-workspace-code/50 text-text-primary placeholder-text-muted focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreateFile}
              className="flex-1 text-[10px] py-1 rounded bg-workspace-code text-white hover:bg-workspace-code/80"
            >
              Create
            </button>
            <button
              onClick={() => setShowNewFile(false)}
              className="flex-1 text-[10px] py-1 rounded bg-forge-hover text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Create New */}
          <button
            onClick={() => setShowNewFile(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-workspace-code/20 border border-workspace-code/30 text-workspace-code hover:bg-workspace-code/30 transition-colors"
          >
            <FilePlus size={14} />
            <span>Create New File</span>
          </button>

          {/* Quick Start Templates */}
          <div className="pt-2">
            <p className="text-[10px] text-text-muted mb-2 uppercase tracking-wide">Quick Start</p>
            <div className="grid grid-cols-2 gap-1">
              {quickStart.map((item) => (
                <button
                  key={item.name}
                  onClick={() => createFile(item.name)}
                  className="text-left px-2 py-1.5 rounded bg-forge-hover/50 hover:bg-forge-hover text-text-secondary hover:text-text-primary transition-colors"
                >
                  <div className="text-[11px] font-medium">{item.name}</div>
                  <div className="text-[9px] text-text-muted">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* AI Hint */}
          <div className="pt-2 text-center">
            <p className="text-[10px] text-text-muted">
              <Sparkles size={10} className="inline mr-1 text-workspace-code" />
              Use the Agent to build your project
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// File type to color mapping for a vibrant, VSCode-like experience
const FILE_COLORS = {
  // JavaScript/TypeScript - Yellow/Blue
  js: { color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  jsx: { color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  ts: { color: 'text-blue-400', bg: 'bg-blue-400/10' },
  tsx: { color: 'text-blue-400', bg: 'bg-blue-400/10' },
  
  // Python - Green
  py: { color: 'text-green-400', bg: 'bg-green-400/10' },
  
  // Web - Orange/Pink
  html: { color: 'text-orange-400', bg: 'bg-orange-400/10' },
  css: { color: 'text-pink-400', bg: 'bg-pink-400/10' },
  scss: { color: 'text-pink-400', bg: 'bg-pink-400/10' },
  
  // Data - Amber
  json: { color: 'text-amber-300', bg: 'bg-amber-300/10' },
  yaml: { color: 'text-amber-300', bg: 'bg-amber-300/10' },
  yml: { color: 'text-amber-300', bg: 'bg-amber-300/10' },
  
  // Markdown - Cyan
  md: { color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  mdx: { color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  
  // Config - Gray
  config: { color: 'text-slate-400', bg: 'bg-slate-400/10' },
  env: { color: 'text-slate-400', bg: 'bg-slate-400/10' },
  
  // Images - Purple
  png: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  jpg: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  jpeg: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  gif: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  svg: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  webp: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  ico: { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  
  // Shell - Lime
  sh: { color: 'text-lime-400', bg: 'bg-lime-400/10' },
  bash: { color: 'text-lime-400', bg: 'bg-lime-400/10' },
  ps1: { color: 'text-blue-300', bg: 'bg-blue-300/10' },
  bat: { color: 'text-lime-400', bg: 'bg-lime-400/10' },
  
  // Database - Red
  sql: { color: 'text-red-400', bg: 'bg-red-400/10' },
  db: { color: 'text-red-400', bg: 'bg-red-400/10' },
  
  // Rust - Orange
  rs: { color: 'text-orange-500', bg: 'bg-orange-500/10' },
  
  // Go - Teal
  go: { color: 'text-teal-400', bg: 'bg-teal-400/10' },
  
  // C/C++ - Blue
  c: { color: 'text-blue-500', bg: 'bg-blue-500/10' },
  cpp: { color: 'text-blue-500', bg: 'bg-blue-500/10' },
  h: { color: 'text-blue-400', bg: 'bg-blue-400/10' },
  
  // Default
  default: { color: 'text-text-muted', bg: '' },
};

function getFileStyle(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  
  // Check for special filenames
  if (name.startsWith('.env')) return FILE_COLORS.env;
  if (name.includes('config')) return FILE_COLORS.config;
  
  return FILE_COLORS[ext] || FILE_COLORS.default;
}

function getFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  
  // JSON files
  if (ext === 'json') return FileJson;
  
  // Code files
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'cs'].includes(ext)) {
    return FileCode2;
  }
  
  // Markdown
  if (['md', 'mdx'].includes(ext)) return FileText;
  
  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return FileImage;
  
  // Config files
  if (['yaml', 'yml', 'toml', 'ini'].includes(ext) || name.includes('config')) return Settings;
  
  // CSS/Style
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return Braces;
  
  // HTML
  if (['html', 'htm'].includes(ext)) return FileType;
  
  // SQL
  if (['sql', 'db'].includes(ext)) return Database;
  
  // Shell
  if (['sh', 'bash', 'ps1', 'bat'].includes(ext)) return Hash;
  
  return File;
}

function GitBadge({ status }) {
  if (!status) return null;
  
  const badges = {
    M: { label: 'M', color: 'text-amber-400', title: 'Modified' },
    A: { label: 'A', color: 'text-emerald-400', title: 'Added' },
    D: { label: 'D', color: 'text-red-400', title: 'Deleted' },
    '?': { label: 'U', color: 'text-slate-400', title: 'Untracked' },
  };
  
  const badge = badges[status] || { label: status, color: 'text-text-muted', title: status };

  return (
    <span 
      className={`text-[9px] font-bold px-1 rounded ${badge.color}`} 
      title={badge.title}
    >
      {badge.label}
    </span>
  );
}

function TreeNode({ node, depth, onOpen, onOpenInExplorer, onCopyPath, activeFilePath }) {
  const [open, setOpen] = React.useState(depth < 1);
  const isActive = node.type === 'file' && node.path === activeFilePath;
  
  const handleFileClick = () => {
    if (node.type === 'file') {
      onOpen(node.path);
    } else {
      setOpen(v => !v);
    }
  };

  if (node.type === 'dir') {
    const hasActiveChild = activeFilePath?.startsWith(node.path);
    
    return (
      <div className="text-xs select-none">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-1.5 py-1 w-full text-left rounded transition-colors ${
            hasActiveChild ? 'bg-workspace-code/5' : 'hover:bg-forge-hover/60'
          }`}
        >
          <span className="text-text-muted">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {open ? (
            <FolderOpenIcon size={14} className="text-amber-400/80" />
          ) : (
            <Folder size={14} className="text-amber-400/60" />
          )}
          <span className={`truncate ${hasActiveChild ? 'text-text-primary' : 'text-text-secondary'}`}>
            {node.name}
          </span>
        </button>
        {open && node.children && node.children.length > 0 && (
          <div className="ml-2 pl-2 border-l border-forge-border/30">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onOpen={onOpen}
                onOpenInExplorer={onOpenInExplorer}
                onCopyPath={onCopyPath}
                activeFilePath={activeFilePath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const Icon = getFileIcon(node.name);
  const style = getFileStyle(node.name);

  return (
    <div 
      className={`group flex items-center gap-1 px-1.5 py-1 w-full rounded text-xs transition-all ${
        isActive 
          ? `bg-workspace-code/20 border border-workspace-code/40 ${style.bg}` 
          : 'hover:bg-forge-hover/60 border border-transparent'
      }`}
    >
      <button
        type="button"
        onClick={handleFileClick}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
      >
        <Icon size={14} className={`flex-shrink-0 ${isActive ? 'text-workspace-code' : style.color}`} />
        <span className={`truncate ${isActive ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
          {node.name}
        </span>
      </button>
      <GitBadge status={node.gitStatus} />
      <div className={`flex items-center gap-0.5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-forge-bg/80"
          title="Open in Explorer"
          onClick={(e) => {
            e.stopPropagation();
            onOpenInExplorer(node.path);
          }}
        >
          <ExternalLink size={11} className="text-text-muted" />
        </button>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-forge-bg/80"
          title="Copy path"
          onClick={async (e) => {
            e.stopPropagation();
            onCopyPath(node.path);
          }}
        >
          <Copy size={11} className="text-text-muted" />
        </button>
      </div>
    </div>
  );
}

export function ProjectExplorer() {
  const { rootPath, files, isScanning, error, chooseProjectRoot, scanProject, openFile, activeFilePath } =
    useEditorStore((state) => ({
      rootPath: state.rootPath,
      files: state.files,
      isScanning: state.isScanning,
      error: state.error,
      chooseProjectRoot: state.chooseProjectRoot,
      scanProject: state.scanProject,
      openFile: state.openFile,
      activeFilePath: state.activeFilePath,
    }), shallow);

  const [query, setQuery] = useState('');

  const filteredFiles = useMemo(() => {
    if (!query.trim()) return files;
    const q = query.toLowerCase();

    const filterNode = (node) => {
      const matches = node.name.toLowerCase().includes(q);
      if (node.type === 'file') {
        return matches ? node : null;
      }
      const children = (node.children || [])
        .map(filterNode)
        .filter(Boolean);
      if (children.length || matches) {
        return { ...node, children };
      }
      return null;
    };

    return files.map(filterNode).filter(Boolean);
  }, [files, query]);

  const handleOpenInExplorer = (path) => {
    try {
      window.electronAPI?.openInExplorer?.(path);
    } catch (e) {
      console.error('Failed to open in explorer:', e);
    }
  };

  const handleCopyPath = async (path) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (e) {
      console.error('Failed to copy path:', e);
    }
  };

  return (
    <div className="h-full flex flex-col border border-forge-border rounded-lg bg-forge-bg/60 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-forge-border space-y-2 bg-forge-surface/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-amber-400" />
            <span className="text-xs font-medium text-text-primary">Project</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={chooseProjectRoot}
              className="text-[11px] px-2 py-0.5 rounded bg-forge-hover/50 text-text-muted hover:text-text-primary hover:bg-forge-hover transition-colors"
            >
              Open…
            </button>
            {rootPath && (
              <button
                type="button"
                onClick={() => scanProject(rootPath)}
                className="p-1 rounded hover:bg-forge-hover text-text-muted hover:text-text-secondary transition-colors"
                title="Rescan project"
              >
                <RefreshCw size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files…"
            className="w-full text-[11px] h-7 px-2 rounded bg-forge-bg/80 border border-forge-border/50 text-text-primary placeholder-text-muted focus:outline-none focus:border-workspace-code/50 transition-colors"
          />
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 text-xs min-h-0">
        {isScanning && (
          <div className="flex items-center gap-2 text-text-muted text-xs px-2 py-3">
            <RefreshCw size={12} className="animate-spin" />
            Scanning project…
          </div>
        )}
        {!isScanning && !rootPath && (
          <div className="text-text-muted text-xs px-2 py-3 text-center">
            <FolderOpen size={24} className="mx-auto mb-2 text-text-muted/50" />
            No project loaded.<br />
            Click <span className="font-medium text-workspace-code">Open…</span> to choose a folder.
          </div>
        )}
        {!isScanning && rootPath && files.length === 0 && (
          <EmptyFolderPrompt error={error} />
        )}
        {!isScanning &&
          filteredFiles.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              onOpen={openFile}
              onOpenInExplorer={handleOpenInExplorer}
              onCopyPath={handleCopyPath}
              activeFilePath={activeFilePath}
            />
          ))}
      </div>

      {/* Footer - Current path */}
      {rootPath && (
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-forge-border bg-forge-surface/20 text-[10px] text-text-muted truncate">
          {rootPath}
        </div>
      )}
    </div>
  );
}

export default ProjectExplorer;
