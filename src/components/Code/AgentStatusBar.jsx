import React, { useState, useEffect, useCallback } from 'react';
import { Activity, AlertTriangle, Brain, CheckCircle2, GitBranch, Layers, Loader2, Sparkles, Command, ChevronDown } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useAppStore } from '../../stores/appStore';
import { CommandPalette } from './CommandPalette';
import { ModelManager } from './ModelManager';

export function AgentStatusBar() {
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showModelManager, setShowModelManager] = useState(false);

  // Global keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCommand = useCallback((commandId) => {
    console.log('Command:', commandId);
    // Handle commands here
    switch (commandId) {
      case 'settings.models':
        setShowModelManager(true);
        break;
      case 'file.save':
        useEditorStore.getState().saveActiveFile?.();
        break;
      case 'file.openProject':
        useEditorStore.getState().chooseProjectRoot?.();
        break;
      case 'project.refresh':
      case 'project.index':
        useEditorStore.getState().analyzeProject?.();
        break;
      default:
        console.log('Unhandled command:', commandId);
    }
  }, []);
  const {
    rootPath,
    activeFilePath,
    openFiles,
    projectContext,
    isAnalyzingProject,
    pendingAgentActions,
  } = useEditorStore((state) => ({
    rootPath: state.rootPath,
    activeFilePath: state.activeFilePath,
    openFiles: state.openFiles,
    projectContext: state.projectContext,
    isAnalyzingProject: state.isAnalyzingProject,
    pendingAgentActions: state.pendingAgentActions,
  }));

  const { currentModel, isGenerating } = useAppStore((state) => ({
    currentModel: state.currentModel,
    isGenerating: state.isGenerating,
  }));

  const openFileCount = Object.keys(openFiles || {}).length;
  const hasUnsaved = Object.values(openFiles || {}).some((file) => file?.dirty);

  return (
    <div className="flex items-center justify-between px-4 py-2 border border-forge-border rounded-xl bg-forge-surface/60">
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2 text-text-primary font-medium">
          <Sparkles size={14} className="text-workspace-code" />
          Agent ready
          {isGenerating && <Loader2 size={12} className="animate-spin text-workspace-code" />}
        </div>
        <StatusPill
          icon={Layers}
          label={rootPath ? rootPath.split(/[\\/]/).pop() : 'No project'}
          helper={`${openFileCount} open`}
        />
        <StatusPill
          icon={GitBranch}
          label={projectContext?.branch || 'detached'}
          helper={projectContext?.gitStatus || 'clean'}
        />
        {activeFilePath && (
          <StatusPill
            icon={Activity}
            label={activeFilePath.split(/[\\/]/).pop()}
            helper={hasUnsaved ? 'unsaved changes' : 'synced'}
            danger={hasUnsaved}
          />
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px]">
          {isAnalyzingProject && (
            <span className="flex items-center gap-1 text-text-muted">
              <Loader2 size={12} className="animate-spin" />
              Mapping project…
            </span>
          )}
        {pendingAgentActions?.length > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <AlertTriangle size={12} />
            {pendingAgentActions.length} queued action(s)
          </span>
        )}
        
        {/* Model Switcher */}
        <button
          onClick={() => setShowModelManager(true)}
          className="flex items-center gap-1 px-2 py-1 rounded bg-forge-bg/50 hover:bg-forge-bg text-text-muted hover:text-forge-text transition-colors"
        >
          <Brain size={12} />
          {currentModel || 'No model'}
          <ChevronDown size={10} />
        </button>

        {/* Command Palette Trigger */}
        <button
          onClick={() => setShowCommandPalette(true)}
          className="flex items-center gap-1 px-2 py-1 rounded bg-forge-bg/50 hover:bg-forge-bg text-text-muted hover:text-forge-text transition-colors"
          title="Command Palette (Ctrl+K)"
        >
          <Command size={12} />
          <kbd className="text-[9px] opacity-60">Ctrl+K</kbd>
        </button>

        <button
          type="button"
          className="px-2 py-1 rounded text-[11px] bg-workspace-code/15 text-workspace-code hover:bg-workspace-code/25 transition-colors"
          onClick={() => useEditorStore.getState().analyzeProject?.()}
        >
          Refresh context
        </button>
      </div>

      {/* Modals */}
      <CommandPalette 
        isOpen={showCommandPalette} 
        onClose={() => setShowCommandPalette(false)}
        onCommand={handleCommand}
      />
      {showModelManager && (
        <ModelManager onClose={() => setShowModelManager(false)} />
      )}
    </div>
  );
}

function StatusPill({ icon: Icon, label, helper, danger }) {
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-full border ${
        danger ? 'border-amber-400 text-amber-400' : 'border-forge-border text-text-muted'
      }`}
    >
      <Icon size={11} />
      <span className="text-[11px] text-text-primary">{label}</span>
      {helper && <span className="text-[10px] text-text-muted">{helper}</span>}
      {!danger && <CheckCircle2 size={10} className="text-emerald-400" />}
      {danger && <AlertTriangle size={10} />}
    </div>
  );
}

export default AgentStatusBar;

