import React, { useState, useMemo } from 'react';
import { Play, Pause, Square, ListChecks, FileCode2, TerminalSquare, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';
import agentOrchestrator from '../../services/agents/agentOrchestrator';
import DiffViewer from './DiffViewer';

const statusIcon = {
  pending: <AlertTriangle size={14} className="text-amber-400" />,
  running: <Loader2 size={14} className="animate-spin text-blue-400" />,
  complete: <CheckCircle size={14} className="text-emerald-400" />,
  failed: <AlertTriangle size={14} className="text-status-error" />,
};

export function AgentPanel() {
  const [taskInput, setTaskInput] = useState('');
  const agent = useAgentStore((state) => state);

  const steps = agent.plan?.steps || [];

  const handleStart = () => {
    if (!taskInput.trim()) return;
    agentOrchestrator.startNightShift(taskInput.trim());
  };

  const handlePause = () => agent.pauseAgent();
  const handleResume = () => agent.resumeAgent();
  const handleStop = () => agent.stopAgent();

  const hasProposed = (agent.proposedChanges || []).length > 0;

  const filesTouched = useMemo(() => {
    return (agent.filesTouched || []).slice().reverse();
  }, [agent.filesTouched]);

  return (
    <div className="h-full flex flex-col border border-forge-border rounded-lg bg-forge-bg/70 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border/50 bg-forge-surface/60">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <ListChecks size={16} />
          <span>Autonomous Agent</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={agent.isRunning}
            className="flex items-center gap-1 px-2 py-1 rounded bg-workspace-code text-white text-xs hover:bg-workspace-code/80 disabled:opacity-50"
          >
            <Play size={14} />
            Start
          </button>
          <button
            type="button"
            onClick={agent.isPaused ? handleResume : handlePause}
            disabled={!agent.isRunning}
            className="flex items-center gap-1 px-2 py-1 rounded bg-forge-hover text-text-primary text-xs disabled:opacity-40"
          >
            <Pause size={14} />
            {agent.isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={!agent.isRunning}
            className="flex items-center gap-1 px-2 py-1 rounded bg-forge-bg text-text-muted text-xs disabled:opacity-40"
          >
            <Square size={14} />
            Stop
          </button>
        </div>
      </div>

      {/* Task Input */}
      <div className="p-3 border-b border-forge-border/40 bg-forge-surface/50">
        <textarea
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder="Describe what you want the agent to build..."
          rows={2}
          className="w-full text-sm px-3 py-2 rounded border border-forge-border/40 bg-forge-bg/70 text-text-primary focus:outline-none focus:border-workspace-code/60"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 p-3 min-h-0">
        {/* Plan */}
        <div className="border border-forge-border/60 rounded-lg bg-forge-bg/60">
          <div className="px-3 py-2 border-b border-forge-border/60 text-xs text-text-muted uppercase flex items-center gap-2">
            <ListChecks size={12} />
            Plan
          </div>
          <div className="divide-y divide-forge-border/40">
            {steps.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-muted">No plan yet.</div>
            )}
            {steps.map((step, idx) => (
              <div key={step.id || idx} className="px-3 py-2 flex items-center gap-2">
                {statusIcon[step.status || 'pending']}
                <div className="flex-1">
                  <div className="text-sm text-text-primary">{step.title}</div>
                  <div className="text-[11px] text-text-muted">{step.description}</div>
                </div>
                <span className="text-[10px] text-text-muted">{step.owner}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Files touched */}
        <div className="border border-forge-border/60 rounded-lg bg-forge-bg/60">
          <div className="px-3 py-2 border-b border-forge-border/60 text-xs text-text-muted uppercase flex items-center gap-2">
            <FileCode2 size={12} />
            Context Files
          </div>
          <div className="max-h-32 overflow-auto text-sm text-text-muted px-3 py-2 space-y-1">
            {filesTouched.length === 0 && <div>No files yet.</div>}
            {filesTouched.map((f, idx) => (
              <div key={`${f.path}-${idx}`} className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-forge-hover text-text-primary">
                  {f.action || 'read'}
                </span>
                <span className="truncate">{f.path}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Proposed changes */}
        {hasProposed && (
          <div className="space-y-3">
            {(agent.proposedChanges || []).map((change) => (
              <DiffViewer
                key={change.id}
                title={change.summary || change.path || 'Change'}
                diff={change.diff}
                after={change.content}
                onApprove={() => agent.approveChange(change.id)}
                onReject={() => agent.rejectChange(change.id)}
              />
            ))}
          </div>
        )}

        {/* Agent log */}
        <div className="border border-forge-border/60 rounded-lg bg-forge-bg/60">
          <div className="px-3 py-2 border-b border-forge-border/60 text-xs text-text-muted uppercase flex items-center gap-2">
            <TerminalSquare size={12} />
            Agent Log
          </div>
          <div className="max-h-40 overflow-auto text-xs text-text-muted px-3 py-2 space-y-1">
            {(agent.log || []).slice().reverse().map((entry) => (
              <div key={entry.id} className="whitespace-pre-wrap">
                {new Date(entry.ts).toLocaleTimeString()} — {entry.message}
              </div>
            ))}
            {(!agent.log || agent.log.length === 0) && <div>No activity yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentPanel;

