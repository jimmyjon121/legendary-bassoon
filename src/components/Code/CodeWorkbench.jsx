import React, { useState, useCallback } from 'react';
import { ProjectExplorer } from './ProjectExplorer';
import { CodeEditor } from './CodeEditor';
import { TerminalPane } from './TerminalPane';
import { CodeChatPanel } from './CodeChatPanel';
import { useEditorStore } from '../../stores/editorStore';
import { api } from '../../utils/electronAPI';
import { AgentPanel } from './AgentPanel';
import { PlanBuilder } from './PlanBuilder';
import { LivePreview } from './LivePreview';
import {
  Layers, Eye, EyeOff, Files, Terminal, Bot, MessageSquare,
  PanelLeftClose, ChevronDown, ChevronUp, ExternalLink, Loader2,
  ShieldCheck,
} from 'lucide-react';

export function CodeWorkbench() {
  const activeFilePath = useEditorStore((state) => state.activeFilePath);
  const openFiles = useEditorStore((state) => state.openFiles);
  const rootPath = useEditorStore((state) => state.rootPath);
  const files = useEditorStore((state) => state.files);

  const [panelMode, setPanelMode] = useState('chat');
  const [pendingPlan, setPendingPlan] = useState(null);
  const [extractedPlan, setExtractedPlan] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(180);
  const [selectedCode, setSelectedCode] = useState(null);
  const [selectionStartLine, setSelectionStartLine] = useState(null);
  const [openingDevForge, setOpeningDevForge] = useState(false);
  const [handoffResult, setHandoffResult] = useState(null);
  const projectName = rootPath ? rootPath.split(/[/\\]/).filter(Boolean).pop() : '';

  const currentFileContent = activeFilePath && openFiles[activeFilePath]
    ? openFiles[activeFilePath].content
    : null;

  const handleSelectionChange = useCallback((code, startLine) => {
    setSelectedCode(code);
    setSelectionStartLine(startLine);
  }, []);

  const handleExecutePlan = useCallback((plan) => {
    setPendingPlan(plan);
    setPanelMode('agent');
  }, []);

  const handleExtractPlan = useCallback((plan) => {
    setExtractedPlan(plan);
    setPanelMode('plan');
  }, []);

  const handleOpenInDevForge = useCallback(async () => {
    if (!rootPath) {
      setHandoffResult({
        success: false,
        error: 'Choose a project folder before opening DevForge.',
      });
      return;
    }

    setOpeningDevForge(true);
    setHandoffResult(null);
    try {
      const result = await api.openInDevForge(rootPath);
      setHandoffResult(result || {
        success: false,
        error: 'DevForge handoff returned no result.',
      });
    } catch (error) {
      setHandoffResult({
        success: false,
        error: error?.message || 'DevForge handoff failed.',
      });
    } finally {
      setOpeningDevForge(false);
    }
  }, [rootPath]);

  // Build grid template dynamically
  const gridCols = [
    showExplorer ? '240px' : '0px',
    '1fr',
    showPreview ? '1fr' : '',
    '360px',
  ].filter(Boolean).join(' ');

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-[#000000]">
      <div className="flex-shrink-0 h-[42px] border-b border-[#121218] bg-[#050507] flex items-center justify-between gap-3 px-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-[#d6d6d6]">
            Code
          </span>
          {rootPath && (
            <span className="text-[11px] text-[#808080] truncate" title={rootPath}>
              {projectName}
            </span>
          )}
        </div>
        <div className="min-w-0 flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenInDevForge}
            disabled={openingDevForge}
            className="h-7 px-2.5 flex items-center gap-1.5 rounded bg-[#101018] border border-[#242436] text-[11px] text-[#d6d6d6] hover:text-white hover:bg-[#171722] disabled:opacity-60 disabled:cursor-wait transition-colors"
            title="Open this project in the DevForge IDE"
          >
            {openingDevForge ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            <span>{openingDevForge ? 'Opening...' : 'Open Full IDE'}</span>
          </button>
        </div>
      </div>
      {/* ── Activity Bar + Main Content ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* ─── Activity Bar (VS Code-style icon strip) ─── */}
        <div className="w-[48px] flex-shrink-0 bg-[#040406] border-r border-[#121218] flex flex-col items-center py-2 gap-1">
          <ActivityBarButton
            icon={<Files size={20} />}
            active={showExplorer}
            onClick={() => setShowExplorer(!showExplorer)}
            title="Explorer"
          />
          <ActivityBarButton
            icon={<MessageSquare size={20} />}
            active={panelMode === 'chat'}
            onClick={() => setPanelMode('chat')}
            title="AI Chat"
          />
          <ActivityBarButton
            icon={<Layers size={20} />}
            active={panelMode === 'plan'}
            onClick={() => setPanelMode('plan')}
            title="Plan Builder"
          />
          <ActivityBarButton
            icon={<Bot size={20} />}
            active={panelMode === 'agent'}
            onClick={() => setPanelMode('agent')}
            title="Autonomous Agent"
          />
          <div className="flex-1" />
          <ActivityBarButton
            icon={showPreview ? <EyeOff size={18} /> : <Eye size={18} />}
            active={showPreview}
            onClick={() => setShowPreview(!showPreview)}
            title={showPreview ? 'Hide Preview' : 'Show Preview'}
          />
          <ActivityBarButton
            icon={<Terminal size={18} />}
            active={showTerminal}
            onClick={() => setShowTerminal(!showTerminal)}
            title={showTerminal ? 'Hide Terminal' : 'Show Terminal'}
          />
        </div>

        {/* ─── Main Grid ─── */}
        <div
          className="flex-1 min-w-0 grid gap-0 overflow-hidden"
          style={{ gridTemplateColumns: gridCols }}
        >
          {/* ── Explorer Panel ── */}
          {showExplorer && (
            <div className="h-full overflow-hidden border-r border-[#121218] bg-[#050507]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#121218]">
                <span className="text-[11px] text-[#bbbbbb] uppercase tracking-wider font-semibold">Explorer</span>
                <button
                  type="button"
                  onClick={() => setShowExplorer(false)}
                  className="p-0.5 rounded text-[#808080] hover:text-[#cccccc] hover:bg-[#171722] transition-colors"
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
              <ProjectExplorer />
            </div>
          )}

          {/* ── Editor + Terminal (Center) ── */}
          <div className="flex flex-col h-full overflow-hidden">
            {/* Editor */}
            <div className="flex-1 min-h-0">
              <CodeEditor
                handoffResult={handoffResult}
                onOpenInDevForge={handleOpenInDevForge}
                openingDevForge={openingDevForge}
                onSelectionChange={handleSelectionChange}
                projectName={projectName}
              />
            </div>
            
            {/* Terminal Panel */}
            {showTerminal && (
              <div
                className="flex-shrink-0 border-t border-[#121218]"
                style={{ height: terminalHeight }}
              >
                <div className="flex items-center justify-between px-3 py-1 bg-[#0b0b10] border-b border-[#121218]">
                  <div className="flex items-center gap-2">
                    <Terminal size={12} className="text-[#808080]" />
                    <span className="text-[11px] text-[#bbbbbb] uppercase tracking-wider font-semibold">Terminal</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTerminalHeight(h => Math.min(h + 60, 400))}
                      className="p-0.5 rounded text-[#808080] hover:text-[#cccccc] hover:bg-[#171722]"
                      title="Expand"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTerminalHeight(h => Math.max(h - 60, 100))}
                      className="p-0.5 rounded text-[#808080] hover:text-[#cccccc] hover:bg-[#171722]"
                      title="Shrink"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                </div>
                <div className="h-[calc(100%-28px)]">
                  <TerminalPane />
                </div>
              </div>
            )}
          </div>

          {/* ── Live Preview (Optional) ── */}
          {showPreview && (
            <div className="h-full overflow-hidden border-l border-[#121218]">
              <LivePreview onClose={() => setShowPreview(false)} />
            </div>
          )}

          {/* ── Right: AI Panel ── */}
          <div className="h-full flex flex-col overflow-hidden border-l border-[#121218] bg-[#050507]">
            {/* Alpha guardrail */}
            <div className="flex-shrink-0 border-b border-[#121218] bg-[#08080d] px-3 py-2">
              <div className="flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-500/5 px-2.5 py-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-amber-100">Paid alpha scope</p>
                  <p className="mt-0.5 text-[10px] leading-4 text-[#8f92a3]">
                    This hub view is read/chat/quick-agent only. Use the full DevForge IDE for serious coding.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenInDevForge}
                  disabled={openingDevForge}
                  className="shrink-0 rounded-md border border-amber-400/20 px-2 py-1 text-[10px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-wait disabled:opacity-60"
                >
                  {openingDevForge ? 'Opening...' : 'Open IDE'}
                </button>
              </div>
            </div>

            {/* Mode Tabs */}
            <div className="flex-shrink-0 flex items-center gap-0 border-b border-[#121218] bg-[#0b0b10]">
              <ModeTab
                label="Plan"
                icon={<Layers size={13} />}
                active={panelMode === 'plan'}
                onClick={() => setPanelMode('plan')}
                color="#c084fc"
              />
              <ModeTab
                label="Chat"
                icon={<MessageSquare size={13} />}
                active={panelMode === 'chat'}
                onClick={() => setPanelMode('chat')}
                color="#22d3ee"
              />
              <ModeTab
                label="Agent"
                icon={<Bot size={13} />}
                active={panelMode === 'agent'}
                onClick={() => setPanelMode('agent')}
                color="#f59e0b"
              />
            </div>

            {/* Panel Content */}
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
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ACTIVITY BAR BUTTON
// ─────────────────────────────────────────────────────────────────
function ActivityBarButton({ icon, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-[40px] h-[40px] flex items-center justify-center rounded-lg transition-all ${
        active
          ? 'text-white bg-[#171722]'
          : 'text-[#808080] hover:text-[#cccccc] hover:bg-[#101018]'
      }`}
      title={title}
    >
      {icon}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// MODE TAB (Plan / Chat / Agent)
// ─────────────────────────────────────────────────────────────────
function ModeTab({ label, icon, active, onClick, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-all border-b-2 ${
        active
          ? 'text-[#cccccc] border-current'
          : 'text-[#808080] hover:text-[#bbbbbb] border-transparent'
      }`}
      style={active ? { borderBottomColor: color, color } : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

export default CodeWorkbench;
