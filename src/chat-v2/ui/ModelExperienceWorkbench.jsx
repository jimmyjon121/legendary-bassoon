import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle,
  ClipboardList,
  History,
  Loader,
  Save,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { api, safeCall } from '../../utils/electronAPI';
import { useToastStore } from '../../stores/toastStore';

const TABS = [
  { id: 'plan', label: 'Plan', Icon: ClipboardList },
  { id: 'profiles', label: 'Profiles', Icon: SlidersHorizontal },
  { id: 'eval', label: 'Eval', Icon: BarChart3 },
  { id: 'history', label: 'History', Icon: History },
  { id: 'save', label: 'Save', Icon: Save },
];

const DEFAULT_SELECTED = ['auto', 'fast', 'low-vram'];
const SAFE_SELECTED = ['low-vram'];

function smallJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return '{}';
  }
}

function formatMetric(value, suffix = '') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 'n/a';
  return `${Math.round(number * 10) / 10}${suffix}`;
}

function inferParamBillions(model = '') {
  const match = String(model || '').match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z0-9]|$)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isLargeLocalModel(model = '') {
  const normalized = String(model || '').toLowerCase();
  if (!normalized.startsWith('gguf:') && !normalized.includes('.gguf')) return false;
  const billions = inferParamBillions(model);
  if (billions && billions >= 14) return true;
  return /(?:24b|30b|32b|33b|34b|70b|72b|104b)/i.test(String(model || ''));
}

function ProfileBadge({ profile, selected, onToggle }) {
  const plan = profile?.plan || {};
  const options = plan.effectiveOptions || {};
  return (
    <button
      type="button"
      onClick={() => onToggle(profile.id)}
      className={`min-h-[112px] rounded-lg border p-3 text-left transition ${
        selected
          ? 'border-cyan-400/35 bg-cyan-500/10'
          : 'border-white/[0.08] bg-black/20 hover:border-white/16'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm font-medium text-zinc-100">{profile.label}</div>
        {selected && <CheckCircle size={14} className="text-cyan-300" />}
      </div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{profile.description}</div>
      <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-zinc-400">
        <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
          {plan.taskIntent || 'auto'}
        </span>
        <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
          ctx {options.num_ctx || 'auto'}
        </span>
        <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
          temp {options.temperature ?? 'auto'}
        </span>
      </div>
    </button>
  );
}

function ResultRow({ row, profileById }) {
  const profile = profileById.get(row.profileId);
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-zinc-100">
          {profile?.label || row.profileId} / {row.task?.label || row.task?.id}
        </div>
        <span className={row.success ? 'text-xs text-emerald-300' : 'text-xs text-red-300'}>
          {row.success ? 'passed' : 'failed'}
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-[11px] text-zinc-400 sm:grid-cols-4">
        <span>TTFT {formatMetric(row.metrics?.firstTokenMs, 'ms')}</span>
        <span>TPS {formatMetric(row.metrics?.tokensPerSecond)}</span>
        <span>Quality {row.quality?.label || 'unscored'}</span>
        <span>Backend {row.backendTrace?.backend || 'auto'}</span>
      </div>
      {row.memoryWarning && <div className="mt-2 text-[11px] text-amber-200">{row.memoryWarning}</div>}
      {row.error && <div className="mt-2 text-[11px] text-red-200">{row.error}</div>}
      {row.outputPreview && (
        <div className="mt-2 max-h-24 overflow-auto rounded border border-white/[0.06] bg-white/[0.025] p-2 text-[11px] leading-4 text-zinc-300">
          {row.outputPreview}
        </div>
      )}
    </div>
  );
}

export function ModelExperienceWorkbench({
  open,
  onClose,
  model,
  workspace,
  experiencePlan,
  runtimeState,
  warnings = [],
  onApplySession,
  onResetAuto,
}) {
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState('plan');
  const [snapshot, setSnapshot] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [workbenchHistory, setWorkbenchHistory] = useState([]);
  const [workbenchRun, setWorkbenchRun] = useState(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState(DEFAULT_SELECTED);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);

  const largeLocalModel = useMemo(() => isLargeLocalModel(model), [model]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const recommendation = workbenchRun?.recommendation || snapshot?.recommendation || null;
  const winningProfileId = recommendation?.profileId || selectedProfileIds[0] || 'auto';
  const currentPlan = experiencePlan || profiles.find((profile) => profile.id === 'auto')?.plan || null;
  const evalStatusText = progress?.status
    ? `status ${progress.status}`
    : (largeLocalModel ? 'Live eval blocked for large GGUF until isolated runner is available' : '5 local tasks / bounded generation');

  const refreshWorkbench = useCallback(async () => {
    if (!open || !model) return;
    setIsLoading(true);
    try {
      const payload = { model, workspace };
      const [snap, built, history] = await Promise.all([
        safeCall('modelWorkbenchGetSnapshot', [payload], { success: false, profiles: [], history: [] }),
        safeCall('modelWorkbenchBuildProfiles', [payload], { success: false, profiles: [] }),
        safeCall('modelWorkbenchGetHistory', [{ model, limit: 12 }], []),
      ]);
      setSnapshot(snap || null);
      setProfiles(Array.isArray(built?.profiles) ? built.profiles : []);
      setWorkbenchHistory(Array.isArray(history) ? history : []);
      const selected = (built?.profiles || []).filter((profile) => profile.selected).map((profile) => profile.id);
      if (largeLocalModel) {
        setSelectedProfileIds(SAFE_SELECTED);
      } else if (selected.length) {
        setSelectedProfileIds(Array.from(new Set(selected)));
      }
    } finally {
      setIsLoading(false);
    }
  }, [open, model, workspace, largeLocalModel]);

  useEffect(() => {
    void refreshWorkbench();
  }, [refreshWorkbench]);

  useEffect(() => {
    if (!open) return undefined;
    return api.onModelWorkbenchProgress?.((event) => setProgress(event)) || (() => {});
  }, [open]);

  const toggleProfile = useCallback((profileId) => {
    setSelectedProfileIds((prev) => {
      const set = new Set(prev);
      if (set.has(profileId)) set.delete(profileId);
      else set.add(profileId);
      return Array.from(set);
    });
  }, []);

  const runEval = useCallback(async (allProfiles = false, riskAccepted = false) => {
    if (!model || isRunning) return;
    let acceptedRisk = riskAccepted;
    if (allProfiles && largeLocalModel) {
      useToastStore.getState().error(
        'Full eval blocked',
        'Large local GGUF eval needs isolated runner containment before it can safely benchmark in Workbench.',
      );
      return;
    }
    if (allProfiles && !largeLocalModel && !riskAccepted) {
      const accepted = window.confirm(
        'Running every Workbench profile can take a long time and may pressure VRAM/RAM. Continue with the full suite?',
      );
      if (!accepted) return;
      acceptedRisk = true;
    }
    setIsRunning(true);
    setProgress({ status: 'starting' });
    try {
      const ids = allProfiles ? profiles.map((profile) => profile.id) : selectedProfileIds;
      const result = await safeCall('modelWorkbenchRunEval', [{
        model,
        workspace,
        profileIds: ids,
        fullSuite: allProfiles,
        riskAccepted: acceptedRisk,
      }], { success: false, error: 'Eval unavailable' });
      setWorkbenchRun(result || null);
      setActiveWorkbenchTab('eval');
      await refreshWorkbench();
      if (result?.success) {
        useToastStore.getState().success('Workbench eval complete', 'Local profile results are ready.');
      } else if (result?.blocked) {
        useToastStore.getState().error('Workbench eval blocked', result?.error || 'This model needs isolated eval containment first.');
      } else {
        useToastStore.getState().error('Workbench eval ended', result?.error || result?.warnings?.[0] || 'No winning profile yet.');
      }
    } finally {
      setIsRunning(false);
    }
  }, [model, workspace, profiles, selectedProfileIds, isRunning, refreshWorkbench, largeLocalModel]);

  const cancelEval = useCallback(async () => {
    const runId = progress?.runId || workbenchRun?.runId;
    if (!runId) return;
    await safeCall('modelWorkbenchCancelEval', [{ runId }], { success: false });
    setProgress((prev) => ({ ...(prev || {}), status: 'cancel_requested' }));
  }, [progress?.runId, workbenchRun?.runId]);

  const saveWinner = useCallback(async (target) => {
    if (!workbenchRun?.runId) {
      useToastStore.getState().error('No eval winner', 'Run an eval before saving a winning profile.');
      return;
    }
    const result = await safeCall('modelWorkbenchSaveWinner', [{
      runId: workbenchRun.runId,
      profileId: winningProfileId,
      target,
    }], { success: false });
    if (!result?.success) {
      useToastStore.getState().error('Save failed', result?.error || 'Could not save Workbench winner.');
      return;
    }
    if (target === 'session') {
      onApplySession?.(result.session || {});
      useToastStore.getState().success('Applied to chat', 'The winning profile is active for this chat.');
    } else {
      useToastStore.getState().success('Preset saved', 'The winning profile is now the default for this model.');
    }
    await refreshWorkbench();
  }, [workbenchRun?.runId, winningProfileId, onApplySession, refreshWorkbench]);

  if (!open) return null;

  return (
    <div className="border-t border-cyan-400/10 bg-[#050b12]">
      <div className="mx-auto w-full max-w-6xl px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Sparkles size={16} className="text-cyan-300" />
              Model Experience Workbench
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {model || 'No model'} / {workspace || 'casual'} / local-only eval and tuning
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isLoading && <Loader size={14} className="animate-spin text-cyan-300" />}
            <button
              type="button"
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.08]"
              onClick={refreshWorkbench}
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-1.5 text-zinc-400 hover:text-zinc-100"
              onClick={onClose}
              aria-label="Close Workbench"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveWorkbenchTab(id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] transition ${
                activeWorkbenchTab === id
                  ? 'border-cyan-400/30 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/[0.08] bg-white/[0.03] text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {activeWorkbenchTab === 'plan' && (
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Current Autopilot Plan</div>
              <div className="grid gap-2 text-[12px] text-zinc-300 sm:grid-cols-2">
                <span>Task: {currentPlan?.taskIntent || 'auto'}</span>
                <span>Family: {currentPlan?.profile?.family || 'unknown'}</span>
                <span>Context: {currentPlan?.effectiveOptions?.num_ctx || 'auto'}</span>
                <span>Backend: {currentPlan?.explicitBackendPin || currentPlan?.softBackendPreference || 'auto'}</span>
                <span>Backend source: {runtimeState?.backendDecisionSource || 'auto'}</span>
                <span>Mode: {currentPlan?.tuningMode || 'auto'}</span>
              </div>
              <pre className="mt-3 max-h-56 overflow-auto rounded border border-white/[0.06] bg-white/[0.025] p-3 text-[11px] text-zinc-400">
                {smallJson(currentPlan?.effectiveOptions || {})}
              </pre>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Trace</div>
              <div className="space-y-2 text-[11px] text-zinc-400">
                <div>Override: {(currentPlan?.overrideTrace || []).join(' -> ') || 'base defaults'}</div>
                <div>Clamp: {(currentPlan?.clampReasons || []).join(' -> ') || 'none'}</div>
                <div>Warnings: {[...(warnings || []), ...(currentPlan?.warnings || [])].filter(Boolean).join(' | ') || 'none'}</div>
                <div>Recommendation: {recommendation?.profileId || 'not enough local history yet'}</div>
              </div>
            </div>
          </div>
        )}

        {activeWorkbenchTab === 'profiles' && (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {profiles.map((profile) => (
              <ProfileBadge
                key={profile.id}
                profile={profile}
                selected={selectedProfileIds.includes(profile.id)}
                onToggle={toggleProfile}
              />
            ))}
          </div>
        )}

        {activeWorkbenchTab === 'eval' && (
          <div className="space-y-3">
            {largeLocalModel && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-[12px] text-amber-100">
                Large local GGUF detected. Live Workbench eval is blocked in-app to protect normal chat; plan/profile inspection stays available until isolated eval runner containment lands.
              </div>
            )}
            {workbenchRun?.blocked && (
              <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-[12px] text-red-100">
                {workbenchRun.error || 'Workbench eval is blocked for this model.'}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => runEval(false)}
                disabled={!model || isRunning || selectedProfileIds.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/15 px-3 text-[11px] font-medium text-cyan-100 disabled:opacity-40"
              >
                {isRunning ? <Loader size={12} className="animate-spin" /> : <Activity size={12} />}
                {largeLocalModel ? 'Check Eval Readiness' : 'Run Selected Suite'}
              </button>
              <button
                type="button"
                onClick={() => runEval(true)}
                disabled={!model || isRunning || largeLocalModel}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-zinc-300 disabled:opacity-40"
              >
                Run All Profiles
              </button>
              <button
                type="button"
                onClick={cancelEval}
                disabled={!isRunning && progress?.status !== 'running'}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-3 text-[11px] text-red-200 disabled:opacity-40"
              >
                Cancel
              </button>
              <span className="text-[11px] text-zinc-500">
                {evalStatusText}
              </span>
            </div>
            {workbenchRun?.recommendation && (
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3 text-[12px] text-emerald-100">
                Recommended: {workbenchRun.recommendation.profileId} - {workbenchRun.recommendation.reason}
              </div>
            )}
            <div className="grid gap-2">
              {(workbenchRun?.results || []).slice(-24).map((row, index) => (
                <ResultRow key={`${row.profileId}-${row.task?.id}-${index}`} row={row} profileById={profileById} />
              ))}
            </div>
          </div>
        )}

        {activeWorkbenchTab === 'history' && (
          <div className="grid gap-2">
            {workbenchHistory.length === 0 && (
              <div className="rounded-lg border border-white/[0.08] bg-black/20 p-4 text-sm text-zinc-500">
                No local Workbench history yet.
              </div>
            )}
            {workbenchHistory.map((row) => (
              <div key={row.id} className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-zinc-100">{row.status} / {row.recommendation?.profileId || 'no winner'}</span>
                  <span className="text-[11px] text-zinc-500">{row.createdAt}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-zinc-400">
                  {(row.summary?.profiles || []).map((profile) => (
                    <span key={profile.profileId} className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
                      {profile.profileId}: {Math.round((profile.successRate || 0) * 100)}% / {profile.avgTokensPerSecond || 0} tps
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeWorkbenchTab === 'save' && (
          <div className="rounded-lg border border-white/[0.08] bg-black/20 p-4">
            <div className="text-sm font-medium text-zinc-100">Winning Profile</div>
            <div className="mt-1 text-[12px] text-zinc-500">
              {winningProfileId ? `Selected winner: ${winningProfileId}` : 'Run an eval to get a recommended profile.'}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveWinner('session')}
                disabled={!workbenchRun?.runId}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/15 px-3 text-[11px] font-medium text-cyan-100 disabled:opacity-40"
              >
                <Sparkles size={12} />
                Apply To This Chat
              </button>
              <button
                type="button"
                onClick={() => saveWinner('preset')}
                disabled={!workbenchRun?.runId}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 text-[11px] font-medium text-emerald-100 disabled:opacity-40"
              >
                <Save size={12} />
                Save Model Preset
              </button>
              <button
                type="button"
                onClick={onResetAuto}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-zinc-300"
              >
                Reset To Auto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ModelExperienceWorkbench;
