import React, { useState, useCallback } from 'react';
import { ProjectExplorer } from './ProjectExplorer';
import { CodeEditor } from './CodeEditor';
import { TerminalPane } from './TerminalPane';
import { CodeChatPanel } from './CodeChatPanel';
import { useEditorStore } from '../../stores/editorStore';
import { AgentPanel } from './AgentPanel';
import { PlanBuilder } from './PlanBuilder';
import { LivePreview } from './LivePreview';
import { TeammateToolbar } from './TeammateFeatures';
import { Layers, Eye, EyeOff, Sparkles } from 'lucide-react';

export function CodeWorkbench() {
  const activeFilePath = useEditorStore((state) => state.activeFilePath);
  const openFiles = useEditorStore((state) => state.openFiles);
  const rootPath = useEditorStore((state) => state.rootPath);
  const files = useEditorStore((state) => state.files);

  const [panelMode, setPanelMode] = useState('chat');
  const [pendingPlan, setPendingPlan] = useState(null);
  const [extractedPlan, setExtractedPlan] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedCode, setSelectedCode] = useState(null);
  const [selectionStartLine, setSelectionStartLine] = useState(null);

  // Get current file content for the chat panel
  const currentFileContent = activeFilePath && openFiles[activeFilePath] 
    ? openFiles[activeFilePath].content 
    : null;

  // Handle text selection from editor
  const handleSelectionChange = useCallback((code, startLine) => {
    setSelectedCode(code);
    setSelectionStartLine(startLine);
  }, []);

  // Handle plan execution - switch to agent and pass plan
  const handleExecutePlan = useCallback((plan) => {
    setPendingPlan(plan);
    setPanelMode('agent');
  }, []);

  // Handle plan extraction from chat - switch to Plan view
  const handleExtractPlan = useCallback((plan) => {
    setExtractedPlan(plan);
    setPanelMode('plan');
  }, []);

  // Handle investigate - triggers AI to search and summarize
  const handleInvestigate = useCallback(async (query) => {
    setPanelMode('chat');
  }, []);

  return (
    <div className={`mt-4 h-[calc(100vh-180px)] grid gap-3 overflow-hidden ${
      showPreview 
        ? 'grid-cols-[240px_1fr_1fr_320px]' 
        : 'grid-cols-[240px_1fr_320px]'
    }`}>
      {/* Left: Project Explorer - with its own scroll */}
      <div className="h-full overflow-hidden">
        <ProjectExplorer />
      </div>
      
      {/* Center: Editor + Terminal */}
      <div className="flex flex-col gap-3 h-full overflow-hidden">
        <div className="flex-1 min-h-0 relative">
          <CodeEditor onSelectionChange={handleSelectionChange} />
          {/* Preview Toggle Button */}
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className={`absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all ${
              showPreview
                ? 'bg-workspace-code text-white'
                : 'bg-forge-surface/80 text-text-muted hover:text-text-primary border border-forge-border/40 hover:border-workspace-code/40'
            }`}
            title={showPreview ? 'Hide Preview' : 'Show Live Preview'}
          >
            {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
            Preview
          </button>
        </div>
        <div className="h-[160px] flex-shrink-0">
          <TerminalPane />
        </div>
      </div>
      
      {/* Live Preview Panel - Only shown when toggled */}
      {showPreview && (
        <div className="h-full overflow-hidden">
          <LivePreview onClose={() => setShowPreview(false)} />
        </div>
      )}
      
      {/* Right: AI Panel - with mode toggle and teammate features */}
      <div className="h-full flex flex-col overflow-hidden">
        {/* Teammate Toolbar */}
        <div className="flex-shrink-0 px-2 pb-2">
          <TeammateToolbar onInvestigate={handleInvestigate} />
        </div>
        
        {/* Mode Toggle */}
        <div className="flex-shrink-0 flex items-center gap-1 px-2 pb-2 border-b border-forge-border/30">
          <div className="flex items-center gap-1 mr-2">
            <Sparkles size={12} className="text-workspace-code" />
            <span className="text-[10px] text-text-muted">Mode:</span>
          </div>
          <button
            type="button"
            onClick={() => setPanelMode('plan')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
              panelMode === 'plan'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'bg-forge-bg text-text-muted hover:text-text-primary'
            }`}
          >
            <Layers size={12} />
            Plan
          </button>
          <button
            type="button"
            onClick={() => setPanelMode('chat')}
            className={`px-2 py-1 rounded text-xs ${
              panelMode === 'chat'
                ? 'bg-workspace-code text-white'
                : 'bg-forge-bg text-text-muted hover:text-text-primary'
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setPanelMode('agent')}
            className={`px-2 py-1 rounded text-xs ${
              panelMode === 'agent'
                ? 'bg-workspace-code text-white'
                : 'bg-forge-bg text-text-muted hover:text-text-primary'
            }`}
          >
            Agent
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {panelMode === 'plan' ? (
            <PlanBuilder 
              currentFile={activeFilePath}
              onExecutePlan={handleExecutePlan}
              initialPlan={extractedPlan}
              onPlanConsumed={() => setExtractedPlan(null)}
            />
          ) : panelMode === 'agent' ? (
            <AgentPanel 
              initialPlan={pendingPlan}
              onPlanConsumed={() => setPendingPlan(null)}
            />
          ) : (
            <CodeChatPanel 
              currentFile={activeFilePath}
              currentFileContent={currentFileContent}
              selectedCode={selectedCode}
              selectionStartLine={selectionStartLine}
              rootPath={rootPath}
              projectFiles={files}
              openFilesList={Object.keys(openFiles)}
              onExtractPlan={handleExtractPlan}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default CodeWorkbench;
