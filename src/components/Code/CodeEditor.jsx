import React from 'react';
import { Save } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';

export function CodeEditor() {
  const { activeFilePath, openFiles, updateActiveFileContent, saveActiveFile } = useEditorStore(
    (state) => ({
      activeFilePath: state.activeFilePath,
      openFiles: state.openFiles,
      updateActiveFileContent: state.updateActiveFileContent,
      saveActiveFile: state.saveActiveFile,
    }),
  );

  const fileState = activeFilePath ? openFiles[activeFilePath] : null;
  const content = fileState?.content ?? '';
  const dirty = !!fileState?.dirty;

  if (!activeFilePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center border border-dashed border-forge-border rounded-lg bg-forge-bg/40">
        <p className="text-xs text-text-muted mb-1">No file selected</p>
        <p className="text-[11px] text-text-muted">
          Choose a file from the project tree to start vibe‑coding.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border border-forge-border rounded-lg bg-forge-bg/80 overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-forge-border text-xs">
        <span className="truncate text-text-primary">
          {activeFilePath}
          {dirty && <span className="ml-1 text-workspace-code">*</span>}
        </span>
        <button
          type="button"
          onClick={saveActiveFile}
          disabled={!dirty}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] ${
            dirty
              ? 'bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30'
              : 'bg-forge-elevated text-text-muted cursor-default'
          }`}
        >
          <Save size={12} />
          Save
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <textarea
          className="w-full h-full min-h-full bg-transparent text-xs font-mono text-text-primary p-3 resize-none outline-none"
          spellCheck={false}
          value={content}
          onChange={(e) => updateActiveFileContent(e.target.value)}
        />
      </div>
    </div>
  );
}

export default CodeEditor;


