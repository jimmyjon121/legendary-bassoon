import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, Square, ListChecks, FileCode2, TerminalSquare, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';
import { useAppStore } from '../../stores/appStore';
import { useEditorStore } from '../../stores/editorStore';
import agentOrchestrator from '../../services/agents/agentOrchestrator';
import DiffViewer from './DiffViewer';
import api from '../../utils/electronAPI';

const statusIcon = {
  pending: <AlertTriangle size={14} className="text-amber-400" />,
  running: <Loader2 size={14} className="animate-spin text-blue-400" />,
  in_progress: <Loader2 size={14} className="animate-spin text-blue-400" />,
  complete: <CheckCircle size={14} className="text-emerald-400" />,
  completed: <CheckCircle size={14} className="text-emerald-400" />,
  failed: <AlertTriangle size={14} className="text-status-error" />,
};

export function AgentPanel({ initialPlan = null, onPlanConsumed = null }) {
  const [taskInput, setTaskInput] = useState('');
  const [localError, setLocalError] = useState('');
  const [clarifyDraft, setClarifyDraft] = useState({});
  const [backendProgress, setBackendProgress] = useState(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState(null);
  const autoContinueGuardRef = useRef(false);
  const agent = useAgentStore((state) => state);
  const currentModel = useAppStore((state) => state.currentModel);
  const rootPath = useEditorStore((state) => state.rootPath);
  const setPlan = useAgentStore((state) => state.setPlan);
  const setTask = useAgentStore((state) => state.setTask);
  const addLog = useAgentStore((state) => state.addLog);

  const steps = agent.plan?.steps || [];
  const selectedTask = taskInput.trim() || agent.taskDescription?.trim() || '';
  const hasTask = Boolean(selectedTask);
  const hasModel = Boolean(currentModel);
  const hasProject = Boolean(rootPath);

  const formatEta = useCallback((ms) => {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return null;
    const seconds = Math.max(1, Math.round(value / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  }, []);

  const startDisabledReason =
    !hasModel
      ? 'Select a model to run the agent.'
      : !hasProject
        ? 'Open a project folder first (Project -> Open...).'
        : !hasTask
          ? 'Describe what you want the agent to build.'
          : '';

  useEffect(() => {
    if (!initialPlan) return;

    const inferredTask =
      initialPlan?.context?.requirements ||
      initialPlan?.description ||
      initialPlan?.title ||
      '';

    const normalizedPlan = {
      ...initialPlan,
      steps: (initialPlan.steps || []).map((step, index) => ({
        ...step,
        id: step.id || `step-${index + 1}`,
        status: ['pending', 'running', 'complete', 'failed'].includes(step.status)
          ? step.status
          : 'pending',
      })),
    };

    setPlan(normalizedPlan);
    if (inferredTask) {
      setTask(inferredTask);
      setTaskInput((prev) => prev || inferredTask);
    }

    onPlanConsumed?.();
  }, [initialPlan, onPlanConsumed, setPlan, setTask]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const unsubscribe = api.onAgentRunProgress((snapshot) => {
      if (snapshot && typeof snapshot === 'object') {
        setBackendProgress(snapshot);
      }
    });

    const pollRuntime = async () => {
      const [progress, runtime] = await Promise.all([
        api.agentGetRunProgress(),
        api.getLlmRuntimeState(),
      ]);

      if (cancelled) return;

      if (progress && typeof progress === 'object') {
        setBackendProgress(progress);
      }
      if (runtime && typeof runtime === 'object') {
        setRuntimeSnapshot(runtime);
      }

      timer = setTimeout(pollRuntime, agent.isRunning ? 2500 : 5000);
    };

    pollRuntime();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [agent.isRunning]);

  const getRunOptions = useCallback((taskText) => {
    const broadBuildTask = /(build|create|make|develop).*(app|platform|studio|tool)|like .* but better/i.test(
      String(taskText || '').toLowerCase()
    );
    return {
      autopilotMode: 'continuous',
      performanceMode: 'speed',
      doneCriteria: broadBuildTask ? { minFiles: 8 } : 'baseline',
      clarifyPolicy: 'auto',
      maxRounds: broadBuildTask ? 10 : 6,
      qualityGatePolicy: 'build+test+lint',
    };
  }, []);

  const handleStart = async ({ silent = false, source = 'manual' } = {}) => {
    if (startDisabledReason) {
      if (!silent) setLocalError(startDisabledReason);
      addLog(startDisabledReason, 'warn');
      return;
    }

    if (!selectedTask) {
      const message = 'Add a task description before starting the agent.';
      if (!silent) setLocalError(message);
      addLog(message, 'warn');
      return;
    }

    setLocalError('');
    try {
      addLog(
        source === 'auto-continue'
          ? 'Auto-continuing autonomous run from approved diffs...'
          : `Starting autonomous run: ${selectedTask}`
      );
      await agentOrchestrator.startNightShift(selectedTask, getRunOptions(selectedTask));
    } catch (error) {
      const message = `Failed to start agent: ${error?.message || 'Unknown error'}`;
      if (!silent) setLocalError(message);
      addLog(message, 'error');
      throw error;
    }
  };

  const handlePause = () => agentOrchestrator.pause();
  const handleResume = () => agentOrchestrator.resume();
  const handleStop = () => agentOrchestrator.stop();

  const hasProposed = (agent.proposedChanges || []).length > 0;

  const filesTouched = useMemo(() => {
    return (agent.filesTouched || []).slice().reverse();
  }, [agent.filesTouched]);

  useEffect(() => {
    const clarification = agent.pendingClarification;
    if (!clarification?.id) {
      setClarifyDraft({});
      return;
    }
    setClarifyDraft(clarification.defaults || {});
  }, [agent.pendingClarification]);

  const pendingClarification = agent.pendingClarification;

  const effectiveSteps = useMemo(() => {
    const backendSteps = Array.isArray(backendProgress?.planSteps) ? backendProgress.planSteps : [];
    if (!backendSteps.length) return steps;

    const byId = new Map((steps || []).map((step) => [String(step.id || ''), step]));
    const byTitle = new Map((steps || []).map((step) => [String(step.title || ''), step]));

    return backendSteps.map((step, index) => {
      const local = byId.get(String(step.id || '')) || byTitle.get(String(step.title || '')) || null;
      return {
        id: step.id || local?.id || `step-${index + 1}`,
        title: step.title || local?.title || `Step ${index + 1}`,
        description: local?.description || step.description || '',
        owner: step.owner || local?.owner || '',
        status: step.status || local?.status || 'pending',
      };
    });
  }, [backendProgress, steps]);

  const submitClarification = () => {
    if (!pendingClarification) return;
    const answers = { ...(clarifyDraft || {}) };
    for (const question of pendingClarification.questions || []) {
      const qid = question?.id;
      if (!qid) continue;
      if (!answers[qid]) {
        const recommended = question.options?.[0]?.id;
        if (recommended) answers[qid] = recommended;
      }
    }
    agent.submitClarification(answers, 'user');
    addLog('Clarifications received. Continuing autonomous run.');
  };

  const useClarificationDefaults = () => {
    if (!pendingClarification) return;
    agent.submitClarification(pendingClarification.defaults || {}, 'default');
    addLog('No clarification provided. Using smart defaults and continuing.');
  };

  const handleApproveChange = async (changeId) => {
    const ok = await agent.approveChange(changeId);
    if (!ok) return;

    const state = useAgentStore.getState();
    const remaining = (state.proposedChanges || []).length;
    const running = Boolean(state.isRunning);

    if (remaining === 0 && !running && hasTask && hasModel && hasProject && !autoContinueGuardRef.current) {
      autoContinueGuardRef.current = true;
      try {
        await handleStart({ silent: true, source: 'auto-continue' });
      } finally {
        autoContinueGuardRef.current = false;
      }
    }
  };

  const handleApproveAllAndContinue = async () => {
    const results = await agent.approveAllChanges();
    const failed = Array.isArray(results) ? results.filter((item) => !item.success).length : 0;

    if (failed > 0) {
      addLog(`Apply-all completed with ${failed} failed patch(es). Resolve remaining diffs and retry.`, 'warn');
      return;
    }

    const state = useAgentStore.getState();
    const remaining = (state.proposedChanges || []).length;
    const running = Boolean(state.isRunning);

    if (remaining === 0 && !running && hasTask && hasModel && hasProject && !autoContinueGuardRef.current) {
      autoContinueGuardRef.current = true;
      try {
        await handleStart({ silent: true, source: 'auto-continue' });
      } finally {
        autoContinueGuardRef.current = false;
      }
    }
  };

  const handleRejectAll = () => {
    const changes = [...(agent.proposedChanges || [])];
    for (const change of changes) {
      agent.rejectChange(change.id);
    }
    if (changes.length > 0) {
      addLog(`Rejected ${changes.length} proposed change(s).`, 'warn');
    }
  };

  const runStats = useMemo(() => {
    const total = effectiveSteps.length;
    const completed = effectiveSteps.filter((step) => ['complete', 'completed'].includes(step.status)).length;
    const failed = effectiveSteps.filter((step) => step.status === 'failed').length;
    const runningStep = effectiveSteps.find((step) => ['running', 'in_progress'].includes(step.status)) || null;
    const inFlight = runningStep ? 1 : 0;
    const remote = backendProgress || {};
    const passInfo = agent.runProgress || {};
    const totalPasses = Number(remote.totalPasses ?? passInfo.totalPasses) || 0;
    const completedPasses = Number(remote.completedPasses ?? passInfo.completedPasses) || 0;
    const currentPass = Number(remote.pass ?? passInfo.pass) || 0;

    let percent = 0;
    if (Number.isFinite(Number(remote.progressPct))) {
      percent = Math.max(0, Math.min(100, Number(remote.progressPct)));
    } else if (totalPasses > 0) {
      percent = Math.round((completedPasses / totalPasses) * 100);
      if (agent.isRunning && currentPass > completedPasses && percent < 100) {
        percent = Math.min(99, percent + Math.round(100 / Math.max(3, totalPasses * 3)));
      }
      if (!agent.isRunning && completedPasses >= totalPasses) {
        percent = 100;
      }
    } else if (total > 0) {
      percent = Math.round((completed / total) * 100);
      if (inFlight > 0 && percent < 100) {
        percent = Math.min(99, percent + Math.round(50 / total));
      }
      if (!agent.isRunning && completed === total) {
        percent = 100;
      }
    }

    const lastLog = (agent.log || [])[agent.log.length - 1];
    const phase = String(remote.phase || '').replace(/_/g, ' ').trim();
    const activity = remote.label || passInfo.label || runningStep?.title || (phase ? `${phase}...` : '') || lastLog?.message || (agent.isRunning ? 'Working...' : 'Idle');

    return {
      total,
      completed,
      failed,
      inFlight,
      percent,
      activity,
      totalPasses,
      completedPasses,
      currentPass,
      passMode: remote.mode || passInfo.mode || 'single',
      remoteStatus: remote.status || 'idle',
      remoteRunId: remote.runId || null,
    };
  }, [effectiveSteps, agent.log, agent.isRunning, agent.runProgress, backendProgress]);

  const queueStats = useMemo(() => {
    const queue = runtimeSnapshot?.queue || {};
    const lanes = queue.lanes || {};
    return {
      queued: Number(queue.queued || 0),
      active: Number(queue.active || 0),
      etaLabel: formatEta(queue.overallEtaMs),
      agentLane: lanes.lane_agent || null,
    };
  }, [runtimeSnapshot, formatEta]);

  const completionGate = useMemo(() => {
    const completion = backendProgress?.completionState;
    if (!completion || typeof completion !== 'object') return null;
    const missing = Array.isArray(completion.missing) ? completion.missing : [];
    return {
      done: Boolean(completion.done),
      missing,
      fileCount: Number(completion.fileCount || 0),
      reason: completion.reason || '',
    };
  }, [backendProgress]);

  const runGuide = useMemo(() => {
    const logs = agent.log || [];
    const latest = logs[logs.length - 1]?.message || '';
    const hasPendingChanges = (agent.proposedChanges || []).length > 0;
    const autoApplied = /auto-applied/i.test(logs.map((l) => l.message).join('\n'));
    const verificationFailed = logs.some((l) => /verification failed/i.test(l.message));

    if (agent.isRunning) {
      return {
        title: 'What is happening now',
        detail: runStats.activity || 'Autonomous run in progress.',
        next: 'You can keep it running. Use Pause only if you want to inspect intermediate diffs.',
      };
    }

    if (hasPendingChanges) {
      return {
        title: 'What changed',
        detail: `${agent.proposedChanges.length} proposed change(s) are ready for review.`,
        next: 'Click Apply All + Continue to keep autopilot moving without a manual restart.',
      };
    }

    if (verificationFailed) {
      return {
        title: 'What changed',
        detail: 'Implementation ran, but quality checks reported failures.',
        next: 'Open Agent Log for failing command output, then run Start again to let the agent fix it.',
      };
    }

    if (autoApplied) {
      return {
        title: 'What changed',
        detail: 'Changes were auto-applied successfully in this round.',
        next: 'Agent will keep iterating within this run policy until done criteria or blocker.',
      };
    }

    return {
      title: 'What changed',
      detail: latest || 'No recent run output.',
      next: 'Enter a goal and click Start to begin a continuous autonomous run.',
    };
  }, [agent.log, agent.isRunning, agent.proposedChanges, runStats.activity]);

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
            disabled={agent.isRunning || Boolean(startDisabledReason)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-workspace-code text-white text-xs hover:bg-workspace-code/80 disabled:opacity-50"
            title={startDisabledReason || 'Start autonomous run'}
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
          onChange={(e) => {
            setTaskInput(e.target.value);
            if (localError) setLocalError('');
          }}
          placeholder="Describe what you want the agent to build..."
          rows={2}
          className="w-full text-sm px-3 py-2 rounded border border-forge-border/40 bg-forge-bg/70 text-text-primary focus:outline-none focus:border-workspace-code/60"
        />
        {localError && (
          <div className="mt-2 text-xs text-amber-300">{localError}</div>
        )}
        {!localError && startDisabledReason && (
          <div className="mt-2 text-xs text-text-muted">{startDisabledReason}</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 p-3 min-h-0">
        {/* Clarification Gate */}
        {pendingClarification && (
          <div className="border border-amber-500/40 rounded-lg bg-amber-500/5 p-3 space-y-3">
            <div className="text-sm font-semibold text-amber-200">
              {pendingClarification.title || 'Quick clarification needed'}
            </div>
            <div className="text-xs text-text-muted">
              Agent is paused until this is answered. If you want full autopilot, click "Use Smart Defaults".
            </div>
            <div className="space-y-3">
              {(pendingClarification.questions || []).map((question) => (
                <div key={question.id} className="space-y-1">
                  <label className="text-xs text-text-secondary">{question.question}</label>
                  <select
                    className="w-full text-sm px-2 py-1.5 rounded border border-forge-border/40 bg-forge-bg/70 text-text-primary"
                    value={clarifyDraft[question.id] || ''}
                    onChange={(e) =>
                      setClarifyDraft((prev) => ({
                        ...prev,
                        [question.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="" disabled>Select an option</option>
                    {(question.options || []).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {question.options?.find((o) => o.id === (clarifyDraft[question.id] || ''))?.description && (
                    <div className="text-[11px] text-text-muted">
                      {question.options.find((o) => o.id === clarifyDraft[question.id])?.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={submitClarification}
                className="px-2.5 py-1.5 rounded bg-workspace-code text-white text-xs hover:bg-workspace-code/80"
              >
                Continue Run
              </button>
              <button
                type="button"
                onClick={useClarificationDefaults}
                className="px-2.5 py-1.5 rounded bg-forge-hover text-text-primary text-xs hover:bg-forge-hover/70"
              >
                Use Smart Defaults
              </button>
            </div>
          </div>
        )}

        {/* Live Progress */}
        <div className="border border-forge-border/60 rounded-lg bg-forge-bg/60 p-3">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Run Progress</span>
            <span>{runStats.percent}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-forge-bg/80 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-workspace-code via-purple-400 to-cyan-300 transition-all duration-300 ease-out"
              style={{ width: `${runStats.percent}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-text-secondary truncate" title={runStats.activity}>
            {runStats.activity}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-text-muted">
            {runStats.totalPasses > 0 && (
              <span>
                pass {Math.max(0, runStats.currentPass)}/{runStats.totalPasses} ({runStats.passMode})
              </span>
            )}
            <span>{runStats.completed}/{runStats.total || 0} complete</span>
            <span>{runStats.inFlight} running</span>
            <span>{(agent.filesTouched || []).length} actions</span>
            <span>{(agent.proposedChanges || []).length} changes</span>
            {runStats.failed > 0 && <span className="text-amber-300">{runStats.failed} failed</span>}
            {queueStats.etaLabel && <span>ETA {queueStats.etaLabel}</span>}
            <span>{queueStats.queued} queued</span>
            <span>{queueStats.active} active</span>
            {queueStats.agentLane && (
              <span>
                lane-agent q{queueStats.agentLane.queued || 0}/a{queueStats.agentLane.active || 0}
              </span>
            )}
          </div>
          <div className="mt-1 text-[10px] text-text-muted">
            backend: {runStats.remoteStatus}
            {runStats.remoteRunId ? ` | ${runStats.remoteRunId}` : ''}
          </div>
        </div>

        <div className="border border-workspace-code/30 rounded-lg bg-workspace-code/5 p-3">
          <div className="text-xs uppercase tracking-wide text-workspace-code mb-1">
            {runGuide.title}
          </div>
          <div className="text-sm text-text-primary">{runGuide.detail}</div>
          <div className="mt-2 text-xs text-text-muted">{runGuide.next}</div>
        </div>

        {completionGate && (
          <div className="border border-forge-border/60 rounded-lg bg-forge-bg/60 p-3">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-text-muted">
              <span>Definition Of Done</span>
              <span className={completionGate.done ? 'text-emerald-300' : 'text-amber-300'}>
                {completionGate.done ? 'met' : 'in progress'}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-text-secondary">
              {completionGate.done
                ? 'Baseline completion criteria satisfied.'
                : (completionGate.reason || 'Completion criteria still have open gaps.')}
            </div>
            <div className="mt-2 text-[11px] text-text-muted">files detected: {completionGate.fileCount}</div>
            {!completionGate.done && completionGate.missing.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {completionGate.missing.map((item) => (
                  <span
                    key={item}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Plan */}
        <div className="border border-forge-border/60 rounded-lg bg-forge-bg/60">
          <div className="px-3 py-2 border-b border-forge-border/60 text-xs text-text-muted uppercase flex items-center gap-2">
            <ListChecks size={12} />
            Plan
          </div>
          <div className="divide-y divide-forge-border/40">
            {effectiveSteps.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-muted">No plan yet.</div>
            )}
            {effectiveSteps.map((step, idx) => (
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
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleRejectAll}
                className="px-2 py-1 rounded bg-forge-hover text-text-primary text-xs hover:bg-forge-hover/70"
              >
                Reject All
              </button>
              <button
                type="button"
                onClick={handleApproveAllAndContinue}
                className="px-2 py-1 rounded bg-workspace-code text-white text-xs hover:bg-workspace-code/80"
              >
                Apply All + Continue
              </button>
            </div>
            {(agent.proposedChanges || []).map((change) => (
              <DiffViewer
                key={change.id}
                title={change.summary || change.path || 'Change'}
                diff={change.diff}
                before={change.before}
                after={change.content}
                onApprove={() => handleApproveChange(change.id)}
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
                {new Date(entry.ts).toLocaleTimeString()} - {entry.message}
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

