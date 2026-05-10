import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  FileCode2,
  Loader2,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { shallow } from 'zustand/shallow';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

function ensureMonacoEnvironment() {
  if (typeof window === 'undefined') return;

  if (!window.MonacoEnvironment || !window.MonacoEnvironment.__devforgeConfigured) {
    window.MonacoEnvironment = {
      getWorker(_moduleId, label) {
        switch (label) {
          case 'json':
            return new jsonWorker();
          case 'css':
          case 'scss':
          case 'less':
            return new cssWorker();
          case 'html':
          case 'handlebars':
          case 'razor':
            return new htmlWorker();
          case 'typescript':
          case 'javascript':
            return new tsWorker();
          default:
            return new editorWorker();
        }
      },
      __devforgeConfigured: true,
    };
  }

  loader.config({ monaco });
}

function registerDevforgeTheme(mountedMonaco) {
  try {
    mountedMonaco.editor.defineTheme('devforge-black', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#000000',
        'editorGutter.background': '#000000',
        'editorLineNumber.foreground': '#5f6677',
        'editorLineNumber.activeForeground': '#b8c0d4',
        'editorLineHighlightBackground': '#0a0a10',
        'editor.selectionBackground': '#234b79',
        'editor.inactiveSelectionBackground': '#1b2738',
        'editorCursor.foreground': '#7bdcff',
      },
    });
  } catch {
    // Theme registration is non-fatal; Monaco fallback still works.
  }
}

const EXT_TO_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python', pyw: 'python',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', svg: 'html',
  json: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp', h: 'cpp',
  c: 'c',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'powershell', psm1: 'powershell',
  bat: 'bat', cmd: 'bat',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini',
  sql: 'sql',
  xml: 'xml',
  dockerfile: 'dockerfile',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  lua: 'lua',
  r: 'r',
  graphql: 'graphql', gql: 'graphql',
};

function getLanguage(filePath) {
  if (!filePath) return 'plaintext';
  const name = filePath.split(/[/\\]/).pop().toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile';
  const ext = name.split('.').pop();
  return EXT_TO_LANG[ext] || 'plaintext';
}

function getFileName(filePath) {
  return filePath?.split(/[/\\]/).pop() || 'untitled';
}

function getLanguageLabel(lang) {
  const labels = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
    css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON', markdown: 'Markdown',
    rust: 'Rust', go: 'Go', java: 'Java', cpp: 'C++', c: 'C',
    shell: 'Shell', powershell: 'PowerShell', bat: 'Batch',
    yaml: 'YAML', sql: 'SQL', xml: 'XML', ruby: 'Ruby', php: 'PHP',
    swift: 'Swift', kotlin: 'Kotlin', lua: 'Lua', plaintext: 'Text',
    dockerfile: 'Dockerfile', ini: 'TOML',
  };
  return labels[lang] || lang;
}

function getFileColor(filePath) {
  const ext = filePath?.split('.').pop()?.toLowerCase();
  const colors = {
    js: '#f7df1e', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
    py: '#3776ab', css: '#1572b6', scss: '#cf649a', html: '#e34f26',
    json: '#292929', md: '#ffffff', rs: '#dea584', go: '#00add8',
    java: '#b07219', cpp: '#f34b7d', c: '#555555', sh: '#89e051',
    yaml: '#cb171e', yml: '#cb171e', sql: '#e38c00', xml: '#0060ac',
    rb: '#cc342d', php: '#4f5d95', svg: '#ffb13b',
  };
  return colors[ext] || '#888888';
}

function FileTabs({ openFiles, activeFilePath, onSelectFile, onCloseFile }) {
  const tabs = Object.keys(openFiles);
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center gap-0 overflow-x-auto bg-[#050507] border-b border-[#121218] min-h-[35px] scrollbar-hide">
      {tabs.map((path) => {
        const isActive = path === activeFilePath;
        const isDirty = openFiles[path]?.dirty;
        const fileName = getFileName(path);
        const fileColor = getFileColor(path);

        return (
          <div
            key={path}
            className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-[#2d2d2d] min-w-0 max-w-[180px] select-none transition-colors ${
              isActive
                ? 'bg-[#050507] text-[#cccccc] border-t-2 border-t-[#007acc]'
                : 'bg-[#0f1014] text-[#969696] hover:bg-[#171722] border-t-2 border-t-transparent'
            }`}
            onClick={() => onSelectFile(path)}
            title={path}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: fileColor }}
            />
            <span className="text-[12px] truncate font-normal">{fileName}</span>
            <button
              type="button"
              className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded transition-all ${
                isActive ? 'hover:bg-[#171722]' : 'hover:bg-[#202533]'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(path);
              }}
              title={isDirty ? 'Unsaved changes' : 'Close'}
            >
              {isDirty ? (
                <Circle size={8} className="text-[#cccccc] fill-current" />
              ) : (
                <X size={12} className="text-[#969696] opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function CodeEditor({
  handoffResult,
  onOpenInDevForge,
  openingDevForge = false,
  onSelectionChange,
  projectName,
}) {
  const {
    activeFilePath,
    openFiles,
    updateActiveFileContent,
    saveActiveFile,
    setActiveFile,
    closeFileTab,
  } = useEditorStore((state) => ({
    activeFilePath: state.activeFilePath,
    openFiles: state.openFiles,
    updateActiveFileContent: state.updateActiveFileContent,
    saveActiveFile: state.saveActiveFile,
    setActiveFile: state.setActiveFile,
    closeFileTab: state.closeFileTab,
  }), shallow);

  const editorRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [monacoStatus, setMonacoStatus] = useState('checking'); // checking | ready | fallback

  const fileState = activeFilePath ? openFiles[activeFilePath] : null;
  const content = fileState?.content ?? '';
  const dirty = !!fileState?.dirty;
  const language = useMemo(() => getLanguage(activeFilePath), [activeFilePath]);
  const languageLabel = useMemo(() => getLanguageLabel(language), [language]);

  useEffect(() => {
    let cancelled = false;
    setEditorReady(false);
    setMonacoStatus('checking');
    ensureMonacoEnvironment();

    const timer = setTimeout(() => {
      if (!cancelled) setMonacoStatus('fallback');
    }, 4500);

    loader.init()
      .then((mountedMonaco) => {
        registerDevforgeTheme(mountedMonaco);
        if (!cancelled) setMonacoStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setMonacoStatus('fallback');
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reloadToken]);

  useEffect(() => {
    if (monacoStatus !== 'ready' || editorReady) return undefined;
    const timer = setTimeout(() => {
      if (!editorReady) setMonacoStatus('fallback');
    }, 4000);
    return () => clearTimeout(timer);
  }, [monacoStatus, editorReady, reloadToken]);

  const handleEditorDidMount = useCallback((editor, mountedMonaco) => {
    editorRef.current = editor;
    registerDevforgeTheme(mountedMonaco);
    mountedMonaco.editor.setTheme('devforge-black');
    setEditorReady(true);

    editor.addCommand(mountedMonaco.KeyMod.CtrlCmd | mountedMonaco.KeyCode.KeyS, () => {
      saveActiveFile();
    });

    editor.onDidChangeCursorSelection(() => {
      if (!onSelectionChange) return;
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        const selectedText = editor.getModel()?.getValueInRange(selection) || '';
        onSelectionChange(selectedText, selection.startLineNumber);
      } else {
        onSelectionChange(null, null);
      }
    });
  }, [saveActiveFile, onSelectionChange]);

  const handleEditorChange = useCallback((value) => {
    if (value !== undefined) {
      updateActiveFileContent(value);
    }
  }, [updateActiveFileContent]);

  const handleFallbackSelect = useCallback((event) => {
    if (!onSelectionChange) return;
    const el = event.target;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;

    if (end > start) {
      const selectedText = content.slice(start, end);
      const startLine = content.slice(0, start).split('\n').length;
      onSelectionChange(selectedText, startLine);
    } else {
      onSelectionChange(null, null);
    }
  }, [content, onSelectionChange]);

  const copyContent = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  const [cursorInfo, setCursorInfo] = useState({ line: 1, column: 1 });
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return undefined;
    const disposable = editor.onDidChangeCursorPosition((e) => {
      setCursorInfo({ line: e.position.lineNumber, column: e.position.column });
    });
    return () => disposable.dispose();
  }, [activeFilePath]);

  const lineCount = content.split('\n').length;

  if (!activeFilePath) {
    const handoffState = handoffResult?.success
      ? {
          icon: <CheckCircle2 size={13} />,
          text: handoffResult.pid ? `DevForge opened as process ${handoffResult.pid}` : 'DevForge launch requested',
          className: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
        }
      : handoffResult
        ? {
            icon: <AlertTriangle size={13} />,
            text: handoffResult.error || 'DevForge needs setup before it can open.',
            className: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
          }
        : null;

    return (
      <div className="h-full flex flex-col bg-[#000000] rounded-lg overflow-hidden">
        <div className="flex items-center min-h-[35px] bg-[#0b0b10] border-b border-[#121218]" />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-[560px] rounded-xl border border-[#1d1d2a] bg-[#06060a] p-6 shadow-2xl shadow-black/30">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20">
                <FileCode2 size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/80">
                  Quick Code Workspace
                </p>
                <h2 className="mt-2 text-[18px] font-semibold leading-tight text-[#f3f3f5]">
                  Open the full DevForge IDE for this project.
                </h2>
                <p className="mt-2 text-[12px] leading-5 text-[#8f92a3]">
                  This Anvil view is for fast inspection, project chat, and quick agent tasks.
                  Use DevForge when you want the full coding shell with local models, Tab, Chat,
                  indexing, and Apply.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenInDevForge}
                    disabled={!onOpenInDevForge || openingDevForge}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-400 px-3.5 text-[12px] font-semibold text-[#17120a] transition-colors hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                  >
                    {openingDevForge ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                    {openingDevForge ? 'Opening DevForge...' : 'Open Full DevForge IDE'}
                  </button>
                  <span className="text-[11px] text-[#686b7a]">
                    {projectName ? `Project: ${projectName}` : 'Choose a project folder to start.'}
                  </span>
                </div>

                {handoffState && (
                  <div className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${handoffState.className}`}>
                    <span className="mt-0.5 shrink-0">{handoffState.icon}</span>
                    <span className="min-w-0 break-words">{handoffState.text}</span>
                  </div>
                )}

                <div className="mt-5 border-t border-[#171722] pt-4">
                  <p className="text-[11px] text-[#686b7a]">
                    Prefer to stay here? Pick a file from the project tree, or press{' '}
                    <kbd className="rounded border border-[#242436] bg-[#101018] px-1.5 py-0.5 text-[10px] text-[#a0a3b1]">
                      Ctrl+P
                    </kbd>{' '}
                    to search.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#000000] rounded-lg overflow-hidden border border-[#121218]">
      <FileTabs
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        onSelectFile={setActiveFile}
        onCloseFile={closeFileTab}
      />

      <div className="flex items-center justify-between px-3 py-1 bg-[#0b0b10] border-b border-[#121218]">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: getFileColor(activeFilePath) }}
          />
          <span className="text-[11px] text-[#cccccc] font-mono truncate max-w-[300px]">
            {activeFilePath}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyContent}
            className="p-1 rounded text-[#808080] hover:text-[#cccccc] hover:bg-[#171722] transition-colors"
            title="Copy file content"
          >
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            onClick={saveActiveFile}
            disabled={!dirty}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
              dirty
                ? 'bg-[#007acc]/20 text-[#3daee9] hover:bg-[#007acc]/30'
                : 'text-[#555555] cursor-default'
            }`}
            title="Save (Ctrl+S)"
          >
            <Save size={12} />
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {monacoStatus !== 'ready' ? (
          <div className="h-full flex flex-col bg-[#050507]">
            <div className="px-3 py-1.5 text-[11px] border-b border-[#26263a] bg-[#121218] text-amber-300 flex items-center justify-between gap-2">
              <span>
                {monacoStatus === 'checking'
                  ? 'Initializing editor engine. Showing fallback editor.'
                  : 'Monaco unavailable. Using fallback editor.'}
              </span>
              <button
                type="button"
                onClick={() => setReloadToken((v) => v + 1)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-400/40 text-amber-200 hover:bg-amber-500/10"
                title="Retry Monaco editor boot"
              >
                <RefreshCw size={11} />
                Retry Monaco
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => handleEditorChange(e.target.value)}
              onSelect={handleFallbackSelect}
              spellCheck={false}
              className="flex-1 w-full resize-none bg-[#050507] text-[#d4d4d4] font-mono text-[13px] p-3 outline-none"
            />
          </div>
        ) : (
          <Editor
            height="100%"
            language={language}
            value={content}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            theme="devforge-black"
            options={{
              fontSize: 13,
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
              fontLigatures: true,
              minimap: { enabled: true, maxColumn: 80, renderCharacters: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              renderLineHighlight: 'all',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              autoClosingBrackets: 'always',
              autoClosingQuotes: 'always',
              autoIndent: 'full',
              formatOnPaste: true,
              formatOnType: true,
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              wordWrap: 'off',
              lineNumbers: 'on',
              glyphMargin: false,
              folding: true,
              lineDecorationsWidth: 8,
              lineNumbersMinChars: 3,
              padding: { top: 8 },
              overviewRulerBorder: false,
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
                useShadows: false,
              },
              tabSize: 2,
              insertSpaces: true,
              detectIndentation: true,
            }}
            loading={
              <div className="flex items-center justify-center h-full bg-[#050507]">
                <div className="flex items-center gap-2 text-[#808080] text-sm">
                  <div className="w-4 h-4 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />
                  Loading editor...
                </div>
              </div>
            }
          />
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-[3px] bg-[#007acc] text-[11px] text-white/90 select-none">
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="flex items-center gap-1">
              <Circle size={6} className="fill-current" />
              Modified
            </span>
          )}
          {monacoStatus !== 'ready' && <span>Fallback</span>}
        </div>
        <div className="flex items-center gap-4">
          <span>Ln {cursorInfo.line}, Col {cursorInfo.column}</span>
          <span>{lineCount} lines</span>
          <span>{languageLabel}</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
}

export default CodeEditor;
