/**
 * CharacterEvolutionPanel
 *
 * Opt-in, reversible succession UI. Shows the character's evolution
 * history as a linear timeline with rollback and "branch from here"
 * actions, and a manual snapshot form. All evolutions are stored via
 * the `charEvolution:*` IPC handlers and can be exported as JSONL for
 * downstream LoRA training (the app itself does not train anything —
 * exporting keeps the feature privacy-first and reversible).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Download, History, Save, Sparkles } from 'lucide-react';
import { api } from '../../utils/electronAPI';

export function CharacterEvolutionPanel({ character }) {
  const [state, setState] = useState({ enabled: false, currentVersion: 0 });
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState({ summary: '', added: '', removed: '', voiceShift: '' });

  const characterId = character?.id;

  const refresh = useCallback(async () => {
    if (!characterId) return;
    try {
      const st = await api.charEvolutionGetState?.(characterId);
      if (st?.success) setState(st.state);
      const h = await api.charEvolutionListHistory?.({ characterId, limit: 200 });
      if (h?.success) setHistory(h.history || []);
    } catch (_) { /* noop */ }
  }, [characterId]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleEnabled = useCallback(async () => {
    if (!characterId) return;
    setBusy(true);
    try {
      await api.charEvolutionSetEnabled?.({ characterId, enabled: !state.enabled });
      await refresh();
    } finally { setBusy(false); }
  }, [characterId, state.enabled, refresh]);

  const takeSnapshot = useCallback(async () => {
    if (!characterId) return;
    if (!state.enabled) return;
    const added = draft.added.split(',').map((s) => s.trim()).filter(Boolean);
    const removed = draft.removed.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = {
      characterId,
      summary: draft.summary.trim().slice(0, 400),
      deltas: { added, removed, voiceShift: draft.voiceShift.trim() },
      traitState: { added, removed, voiceShift: draft.voiceShift.trim() },
      createdBy: 'user',
    };
    setBusy(true);
    try {
      const res = await api.charEvolutionSnapshot?.(payload);
      if (res?.success) {
        setStatus(`Saved v${res.version}.`);
        setDraft({ summary: '', added: '', removed: '', voiceShift: '' });
        await refresh();
      } else {
        setStatus(res?.error || 'Snapshot failed');
      }
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 2000);
    }
  }, [characterId, state.enabled, draft, refresh]);

  const revertTo = useCallback(async (version) => {
    if (!characterId) return;
    if (!window.confirm(`Revert ${character?.name || 'character'} to version ${version}? You can always move forward again.`)) return;
    setBusy(true);
    try {
      const res = await api.charEvolutionRevertTo?.({ characterId, version });
      if (res?.success) {
        setStatus(`Reverted to v${version}.`);
        await refresh();
      } else {
        setStatus(res?.error || 'Revert failed');
      }
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 2000);
    }
  }, [characterId, character?.name, refresh]);

  const exportJsonl = useCallback(async () => {
    if (!characterId) return;
    setBusy(true);
    try {
      const res = await api.charEvolutionExportJsonl?.(characterId);
      if (res?.success && res.jsonl) {
        const blob = new Blob([res.jsonl], { type: 'application/x-ndjson' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${character?.name || 'character'}-evolution.jsonl`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus(`Exported ${res.lines} version(s).`);
      } else {
        setStatus(res?.error || 'Nothing to export');
      }
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 2500);
    }
  }, [characterId, character?.name]);

  const timeline = useMemo(() => history.slice().sort((a, b) => b.version - a.version), [history]);

  if (!characterId) return null;

  return (
    <div className="mt-4 border border-forge-border rounded-lg bg-forge-bg/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border bg-forge-surface">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-workspace-nsfw" />
          <div>
            <p className="text-xs font-medium text-text-primary">Character Evolution</p>
            <p className="text-[10px] text-text-muted">
              Opt-in, reversible. Every snapshot is versioned; nothing overwrites your base character.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleEnabled}
          disabled={busy}
          className={`px-2.5 py-1 text-[11px] rounded-full border ${
            state.enabled
              ? 'bg-status-success/20 border-status-success/40 text-status-success'
              : 'bg-forge-bg border-forge-border text-text-secondary'
          }`}
        >
          {state.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {state.enabled && (
        <div className="p-3 space-y-3">
          <div className="space-y-2">
            <label className="block text-[11px] text-text-secondary">
              <span className="block mb-1">Summary of this change</span>
              <input
                type="text"
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                placeholder="e.g. starts trusting the protagonist"
                className="w-full px-2 py-1 rounded bg-forge-surface border border-forge-border text-xs text-text-primary"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] text-text-secondary">
                <span className="block mb-1">Gained (comma)</span>
                <input
                  type="text"
                  value={draft.added}
                  onChange={(e) => setDraft({ ...draft, added: e.target.value })}
                  placeholder="patience, humor"
                  className="w-full px-2 py-1 rounded bg-forge-surface border border-forge-border text-xs text-text-primary"
                />
              </label>
              <label className="block text-[11px] text-text-secondary">
                <span className="block mb-1">Lost (comma)</span>
                <input
                  type="text"
                  value={draft.removed}
                  onChange={(e) => setDraft({ ...draft, removed: e.target.value })}
                  placeholder="mistrust"
                  className="w-full px-2 py-1 rounded bg-forge-surface border border-forge-border text-xs text-text-primary"
                />
              </label>
            </div>
            <label className="block text-[11px] text-text-secondary">
              <span className="block mb-1">Voice shift (optional)</span>
              <input
                type="text"
                value={draft.voiceShift}
                onChange={(e) => setDraft({ ...draft, voiceShift: e.target.value })}
                placeholder="warmer cadence, fewer formalities"
                className="w-full px-2 py-1 rounded bg-forge-surface border border-forge-border text-xs text-text-primary"
              />
            </label>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">
                Current: v{state.currentVersion}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={exportJsonl}
                  disabled={busy || !timeline.length}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-forge-surface border border-forge-border text-[11px] text-text-secondary hover:bg-forge-hover disabled:opacity-40"
                >
                  <Download size={10} />
                  Export JSONL
                </button>
                <button
                  type="button"
                  onClick={takeSnapshot}
                  disabled={busy || !draft.summary.trim()}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-workspace-nsfw/20 border border-workspace-nsfw/40 text-workspace-nsfw text-[11px] hover:bg-workspace-nsfw/30 disabled:opacity-40"
                >
                  <Save size={10} />
                  Snapshot
                </button>
              </div>
            </div>
          </div>

          {timeline.length > 0 && (
            <div className="border-t border-forge-border pt-2">
              <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1 uppercase tracking-wide">
                <History size={10} /> Timeline
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {timeline.map((v) => {
                  const current = v.version === state.currentVersion;
                  return (
                    <div
                      key={v.id}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded border text-[11px] ${
                        current
                          ? 'bg-workspace-nsfw/10 border-workspace-nsfw/40 text-text-primary'
                          : 'bg-forge-surface border-forge-border text-text-secondary'
                      }`}
                    >
                      <span className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full ${current ? 'bg-workspace-nsfw/30' : 'bg-forge-bg'}`}>
                        <Sparkles size={10} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-text-muted">v{v.version}</span>
                          {current && <span className="text-[10px] text-workspace-nsfw">current</span>}
                          <span className="text-[10px] text-text-muted">{new Date(v.createdAt).toLocaleString()}</span>
                        </div>
                        {v.summary && <p className="truncate">{v.summary}</p>}
                        {(v.deltas?.added?.length || v.deltas?.removed?.length) ? (
                          <p className="text-[10px] text-text-muted truncate">
                            {v.deltas?.added?.length ? `+${v.deltas.added.join(', ')}` : ''}
                            {v.deltas?.removed?.length ? ` −${v.deltas.removed.join(', ')}` : ''}
                          </p>
                        ) : null}
                      </div>
                      {!current && (
                        <button
                          type="button"
                          onClick={() => revertTo(v.version)}
                          disabled={busy}
                          className="text-[10px] text-text-secondary hover:underline disabled:opacity-40"
                        >
                          Revert
                        </button>
                      )}
                    </div>
                  );
                })}
                {state.currentVersion !== 0 && (
                  <button
                    type="button"
                    onClick={() => revertTo(0)}
                    disabled={busy}
                    className="w-full text-[10px] text-text-muted hover:underline py-1"
                  >
                    Revert to base character (v0)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!state.enabled && (
        <div className="p-3">
          <p className="text-[11px] text-text-muted">
            When enabled, you can snapshot personality changes between scenes and roll them
            back at any time. No automatic mutation happens — every change is your call.
          </p>
        </div>
      )}

      {status && (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-text-muted">{status}</p>
        </div>
      )}
    </div>
  );
}

export default CharacterEvolutionPanel;
