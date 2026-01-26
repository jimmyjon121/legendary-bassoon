import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react';
import { useCharacterStore } from '../../stores/characterStore';

const STEPS = [
  'identity',
  'appearance',
  'personality',
  'background',
  'nsfw',
  'advanced',
];

export function CharacterCreator({ isOpen, onClose }) {
  const { saveCharacter } = useCharacterStore();
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    name: '',
    display_name: '',
    species: '',
    gender: '',
    pronouns: '',
    age_appearance: '',
    description: '',
    appearance: '',
    personality_summary: '',
    likes: '',
    dislikes: '',
    quirks: '',
    backstory: '',
    system_prompt: '',
    nsfw_tags: '',
  });

  if (!isOpen) return null;

  const step = STEPS[stepIndex];

  const update = (field) => (e) => {
    const value = e.target ? e.target.value : e;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const canNext = () => {
    if (step === 'identity') {
      return form.name.trim().length > 0;
    }
    return true;
  };

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    }
  };

  const handlePrev = () => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const nsfwTags =
        form.nsfw_tags && form.nsfw_tags.trim()
          ? JSON.stringify(
              form.nsfw_tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            )
          : null;

      const payload = {
        name: form.name,
        display_name: form.display_name || null,
        species: form.species || null,
        gender: form.gender || null,
        pronouns: form.pronouns || null,
        age_appearance: form.age_appearance || null,
        description: form.description || form.personality_summary || null,
        appearance: form.appearance || null,
        system_prompt: form.system_prompt || null,
        nsfw_tags: nsfwTags,
      };
      const res = await saveCharacter(payload);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to create character');
      }
      setSaving(false);
      onClose?.();
    } catch (e) {
      console.error('Failed to create character:', e);
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'identity':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-1">
                Identity
              </h3>
              <p className="text-[11px] text-text-muted">
                Who is this character? This sets their core identity in the
                Private workspace.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Name</label>
                <input
                  type="text"
                  className="input text-sm"
                  value={form.name}
                  onChange={update('name')}
                  placeholder="Aurelia"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Display name / Nickname
                </label>
                <input
                  type="text"
                  className="input text-sm"
                  value={form.display_name}
                  onChange={update('display_name')}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Species
                </label>
                <input
                  type="text"
                  className="input text-sm"
                  value={form.species}
                  onChange={update('species')}
                  placeholder="human, elf, android…"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Gender
                </label>
                <input
                  type="text"
                  className="input text-sm"
                  value={form.gender}
                  onChange={update('gender')}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Pronouns
                </label>
                <input
                  type="text"
                  className="input text-sm"
                  value={form.pronouns}
                  onChange={update('pronouns')}
                  placeholder="she/her, he/him, they/them…"
                />
              </div>
            </div>
          </div>
        );
      case 'appearance':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-1">
                Appearance
              </h3>
              <p className="text-[11px] text-text-muted">
                Describe how they look and present themselves.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Age appearance
                </label>
                <input
                  type="text"
                  className="input text-sm"
                  value={form.age_appearance}
                  onChange={update('age_appearance')}
                  placeholder="appears mid‑20s"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Short description
                </label>
                <input
                  type="text"
                  className="input text-sm"
                  value={form.description}
                  onChange={update('description')}
                  placeholder="One‑line vibe summary"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                Appearance details
              </label>
              <textarea
                className="input-area text-sm"
                rows={4}
                value={form.appearance}
                onChange={update('appearance')}
                placeholder="Height, build, hair, eyes, style, distinguishing features…"
              />
            </div>
          </div>
        );
      case 'personality':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-1">
                Personality
              </h3>
              <p className="text-[11px] text-text-muted">
                How do they act, speak, and relate to you?
              </p>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                Personality summary
              </label>
              <textarea
                className="input-area text-sm"
                rows={3}
                value={form.personality_summary}
                onChange={update('personality_summary')}
                placeholder="Playful but caring, teasing, a bit mischievous…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Likes / interests
                </label>
                <textarea
                  className="input-area text-xs"
                  rows={3}
                  value={form.likes}
                  onChange={update('likes')}
                  placeholder="Comma‑separated: coffee, late nights, stargazing…"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Dislikes / boundaries
                </label>
                <textarea
                  className="input-area text-xs"
                  rows={3}
                  value={form.dislikes}
                  onChange={update('dislikes')}
                  placeholder="Comma‑separated: being ignored, cruelty…"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                Quirks & habits
              </label>
              <textarea
                className="input-area text-xs"
                rows={3}
                value={form.quirks}
                onChange={update('quirks')}
                placeholder="Little behaviours that make them feel alive."
              />
            </div>
          </div>
        );
      case 'background':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-1">
                Background
              </h3>
              <p className="text-[11px] text-text-muted">
                A short backstory that gives context to who they are.
              </p>
            </div>
            <textarea
              className="input-area text-sm"
              rows={6}
              value={form.backstory}
              onChange={update('backstory')}
              placeholder="Where did they come from, what do they do, what do they secretly want…"
            />
          </div>
        );
      case 'nsfw':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-1">
                Private / NSFW
              </h3>
              <p className="text-[11px] text-text-muted">
                This lives only in the encrypted Private workspace. Tags help
                you search and organize characters.
              </p>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                NSFW tags (comma‑separated, optional)
              </label>
              <textarea
                className="input-area text-xs"
                rows={3}
                value={form.nsfw_tags}
                onChange={update('nsfw_tags')}
                placeholder="romantic, dominant, nurturing…"
              />
            </div>
          </div>
        );
      case 'advanced':
      default:
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-1">
                Advanced Prompting
              </h3>
              <p className="text-[11px] text-text-muted">
                Optional system prompt tweaks for power users. You can leave
                this empty – the engine will still build a rich prompt.
              </p>
            </div>
            <textarea
              className="input-area text-xs"
              rows={6}
              value={form.system_prompt}
              onChange={update('system_prompt')}
              placeholder="Any extra guardrails or behaviour you want to hard-code for this character."
            />
          </div>
        );
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && !saving && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-2xl max-h-[80vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-forge-border">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-workspace-nsfw/20">
                <Sparkles size={16} className="text-workspace-nsfw" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">
                  New Character
                </h2>
                <p className="text-[11px] text-text-muted">
                  Guided setup for a Private workspace companion.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
              disabled={saving}
            >
              <X size={16} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="px-5 pt-2 pb-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-text-muted uppercase tracking-wide">
                Step {stepIndex + 1} of {STEPS.length}
              </span>
              <span className="text-[11px] text-text-secondary">
                {step === 'identity'
                  ? 'Identity'
                  : step === 'appearance'
                  ? 'Appearance'
                  : step === 'personality'
                  ? 'Personality'
                  : step === 'background'
                  ? 'Background'
                  : step === 'nsfw'
                  ? 'Private / NSFW'
                  : 'Advanced'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-forge-bg overflow-hidden">
              <div
                className="h-full bg-workspace-nsfw transition-all"
                style={{
                  width: `${((stepIndex + 1) / STEPS.length) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {renderStep()}
            {error && (
              <div className="mt-3 text-[11px] text-status-error bg-status-error/10 border border-status-error/30 rounded px-2 py-1">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-forge-border bg-forge-bg">
            <button
              type="button"
              onClick={handlePrev}
              disabled={saving || stepIndex === 0}
              className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary disabled:opacity-40"
            >
              <ArrowLeft size={12} />
              Back
            </button>
            <div className="flex items-center gap-2">
              {stepIndex < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={saving || !canNext()}
                  className="btn btn-primary text-xs"
                >
                  Next
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving || !canNext()}
                  className="btn btn-primary text-xs"
                >
                  {saving ? 'Creating…' : 'Create Character'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default CharacterCreator;

















