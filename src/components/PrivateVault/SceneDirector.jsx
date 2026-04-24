/**
 * SceneDirector
 *
 * Beat-by-beat scene planner for vault scenes. The user writes a list of
 * beats (scene objectives) and intensity curve; the engine compiles this
 * into a structured system-brief prompt and sends it as a single turn.
 *
 * This does NOT replace sendUserMessage — it sits alongside it. The user
 * is always the director: the SceneDirector only sends what the user clicks
 * Send on. Beats and intensity are transparent and editable at any time.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Plus, Trash2, Play, X, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';

const DEFAULT_BEATS = [
  { id: 'b-1', label: 'Setup', detail: 'Establish where we are and who is present.', intensity: 0.1 },
  { id: 'b-2', label: 'Escalation', detail: 'Raise tension gradually — eye contact, tone, proximity.', intensity: 0.45 },
  { id: 'b-3', label: 'Climax', detail: 'The pivotal beat. The thing the scene is really about.', intensity: 0.9 },
  { id: 'b-4', label: 'Aftermath', detail: 'Wind down. Breath returning. Something tender.', intensity: 0.25 },
];

const PACING_PRESETS = [
  { id: 'slow', label: 'Slow burn', note: 'Long setup, measured escalation' },
  { id: 'standard', label: 'Standard', note: 'Balanced pacing across beats' },
  { id: 'fast', label: 'Fast', note: 'Minimal setup, rapid escalation' },
];

export function SceneDirector({ engine, onClose }) {
  const [beats, setBeats] = useState(DEFAULT_BEATS);
  const [pacing, setPacing] = useState('standard');
  const [setting, setSetting] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updateBeat = useCallback((id, patch) => {
    setBeats((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const removeBeat = useCallback((id) => {
    setBeats((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const addBeat = useCallback(() => {
    setBeats((prev) => [
      ...prev,
      { id: `b-${Date.now()}`, label: `Beat ${prev.length + 1}`, detail: '', intensity: 0.5 },
    ]);
  }, []);

  const moveBeat = useCallback((id, dir) => {
    setBeats((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!engine || typeof engine.directScene !== 'function') return;
    setSubmitting(true);
    try {
      const ok = await engine.directScene({
        beats,
        pacing,
        setting: setting.trim() || null,
        notes: notes.trim() || null,
      });
      if (ok) onClose?.();
    } finally {
      setSubmitting(false);
    }
  }, [engine, beats, pacing, setting, notes, onClose]);

  const intensityGraph = useMemo(() => {
    if (beats.length === 0) return null;
    const max = Math.max(...beats.map((b) => b.intensity || 0), 0.01);
    return beats.map((b, i) => ({
      left: `${(i / Math.max(1, beats.length - 1)) * 100}%`,
      bottom: `${((b.intensity || 0) / max) * 100}%`,
      label: b.label,
    }));
  }, [beats]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-rose-500/30 bg-forge-surface shadow-2xl"
        >
          <div className="sticky top-0 bg-forge-surface border-b border-forge-border px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Film size={18} className="text-rose-400" />
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Scene Director</h3>
                <p className="text-xs text-text-muted">Plan the scene beat by beat. You stay in control.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="rounded-lg p-2 text-text-muted hover:bg-forge-hover hover:text-text-secondary"
              aria-label="Close scene director"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <label className="block">
              <span className="text-xs text-text-secondary">Setting / Context (optional)</span>
              <textarea
                value={setting}
                onChange={(e) => setSetting(e.target.value)}
                rows={2}
                placeholder="Where we are, who the characters are, any important framing..."
                className="mt-1 w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border text-sm text-text-primary"
              />
            </label>

            <div>
              <span className="text-xs text-text-secondary">Pacing</span>
              <div className="mt-1 flex gap-2">
                {PACING_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPacing(p.id)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs ${
                      pacing === p.id
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                        : 'bg-forge-bg border-forge-border text-text-secondary hover:bg-forge-hover'
                    }`}
                  >
                    <span className="block font-medium">{p.label}</span>
                    <span className="block text-[10px] text-text-muted mt-0.5">{p.note}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Beats</span>
                <button
                  type="button"
                  onClick={addBeat}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-forge-bg border border-forge-border text-xs text-text-secondary hover:bg-forge-hover"
                >
                  <Plus size={10} />
                  Add Beat
                </button>
              </div>

              <div className="space-y-2">
                {beats.map((b, idx) => (
                  <div key={b.id} className="p-3 rounded-lg bg-forge-bg border border-forge-border">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col items-center pt-1">
                        <GripVertical size={12} className="text-text-muted" />
                        <button
                          type="button"
                          onClick={() => moveBeat(b.id, 'up')}
                          disabled={idx === 0}
                          className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveBeat(b.id, 'down')}
                          disabled={idx === beats.length - 1}
                          className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={b.label}
                          onChange={(e) => updateBeat(b.id, { label: e.target.value })}
                          className="w-full px-2 py-1 rounded bg-forge-surface border border-forge-border text-sm text-text-primary font-medium"
                        />
                        <textarea
                          value={b.detail}
                          onChange={(e) => updateBeat(b.id, { detail: e.target.value })}
                          rows={2}
                          placeholder="What happens in this beat?"
                          className="w-full px-2 py-1 rounded bg-forge-surface border border-forge-border text-xs text-text-primary"
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-text-muted w-16">Intensity</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={b.intensity}
                            onChange={(e) => updateBeat(b.id, { intensity: Number(e.target.value) })}
                            className="flex-1"
                          />
                          <span className="text-[10px] text-text-muted w-8 text-right">
                            {Math.round((b.intensity || 0) * 100)}%
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBeat(b.id)}
                        className="p-1 text-text-muted hover:text-status-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {intensityGraph && (
              <div className="h-16 relative bg-forge-bg rounded-lg border border-forge-border p-2">
                <div className="absolute inset-2 border-b border-forge-border" />
                {intensityGraph.map((pt, i) => (
                  <div
                    key={i}
                    className="absolute w-1.5 h-1.5 rounded-full bg-rose-400"
                    style={{ left: pt.left, bottom: pt.bottom, transform: 'translate(-50%, 50%)' }}
                    title={pt.label}
                  />
                ))}
              </div>
            )}

            <label className="block">
              <span className="text-xs text-text-secondary">Director notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Tone, voice, things to avoid, kinks to include..."
                className="mt-1 w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border text-sm text-text-primary"
              />
            </label>
          </div>

          <div className="sticky bottom-0 bg-forge-surface border-t border-forge-border px-5 py-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose?.()}
              className="px-3 py-1.5 rounded-lg border border-forge-border text-text-secondary text-xs hover:bg-forge-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || beats.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs hover:bg-rose-500/30 disabled:opacity-50"
            >
              <Play size={12} />
              {submitting ? 'Directing...' : 'Direct Scene'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default SceneDirector;
