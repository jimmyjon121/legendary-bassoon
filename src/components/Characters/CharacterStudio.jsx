import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, User, Sparkles, MessageCircle } from 'lucide-react';
import { useCharacterStore } from '../../stores/characterStore';
import { CharacterChat } from './CharacterChat';
import { LorebookEditor } from './LorebookEditor';
import { CharacterCreator } from './CharacterCreator';

function CharacterForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(
    initial || {
      name: '',
      display_name: '',
      species: '',
      gender: '',
      pronouns: '',
      age_appearance: '',
      description: '',
      system_prompt: '',
      appearance: '',
    }
  );

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave?.(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={handleChange('name')}
            className="input text-sm"
            placeholder="e.g. Aurelia"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Display name / Nickname</label>
          <input
            type="text"
            value={form.display_name}
            onChange={handleChange('display_name')}
            className="input text-sm"
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Species</label>
          <input
            type="text"
            value={form.species}
            onChange={handleChange('species')}
            className="input text-sm"
            placeholder="human, elf, android…"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Gender</label>
          <input
            type="text"
            value={form.gender}
            onChange={handleChange('gender')}
            className="input text-sm"
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Pronouns</label>
          <input
            type="text"
            value={form.pronouns}
            onChange={handleChange('pronouns')}
            className="input text-sm"
            placeholder="she/her, he/him, they/them…"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Age appearance</label>
          <input
            type="text"
            value={form.age_appearance}
            onChange={handleChange('age_appearance')}
            className="input text-sm"
            placeholder="e.g. appears mid-20s"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Short description</label>
          <input
            type="text"
            value={form.description}
            onChange={handleChange('description')}
            className="input text-sm"
            placeholder="One-line vibe summary"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1">Appearance details</label>
        <textarea
          value={form.appearance}
          onChange={handleChange('appearance')}
          className="input-area text-sm"
          rows={3}
          placeholder="Height, build, hair, eyes, style, distinguishing features…"
        />
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1">System prompt (advanced)</label>
        <textarea
          value={form.system_prompt}
          onChange={handleChange('system_prompt')}
          className="input-area text-xs"
          rows={4}
          placeholder="Optional instructions that shape how this character behaves."
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-secondary text-xs"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="btn btn-primary text-xs"
        >
          {saving ? 'Saving…' : 'Save Character'}
        </button>
      </div>
    </form>
  );
}

export function CharacterStudio({ isOpen, onClose }) {
  const { characters, loadCharacters, saveCharacter, deleteCharacter } = useCharacterStore();
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [chatCharacter, setChatCharacter] = useState(null);
  const [showCreator, setShowCreator] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadCharacters();
      setEditing(null);
      setSelected(null);
    }
  }, [isOpen, loadCharacters]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-4xl max-h-[80vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-workspace-nsfw/20">
                <Sparkles size={18} className="text-workspace-nsfw" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Character Studio</h2>
                <p className="text-xs text-text-muted">
                  Create and manage companions for the Private workspace. Fully local and encrypted.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Left: list */}
            <div className="w-1/2 border-r border-forge-border p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-medium text-text-primary uppercase tracking-wide">
                  Characters
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreator(true);
                    setEditing(null);
                    setSelected(null);
                  }}
                  className="flex items-center gap-1 text-xs text-workspace-nsfw hover:underline"
                >
                  <Plus size={14} />
                  New
                </button>
              </div>
              <div className="flex-1 overflow-y-auto rounded border border-forge-border bg-forge-bg/40">
                {(!characters || characters.length === 0) ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <User size={32} className="text-text-muted mb-3" />
                    <p className="text-xs text-text-secondary mb-1">
                      No characters yet
                    </p>
                    <p className="text-[11px] text-text-muted">
                      Click “New” to create your first character for the Private workspace.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-forge-border/60">
                    {characters.map((char) => (
                      <button
                        key={char.id}
                        type="button"
                        onClick={() => {
                          setSelected(char);
                          setEditing(null);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-forge-hover/60 transition-colors ${
                          selected?.id === char.id ? 'bg-forge-hover/80' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm text-text-primary truncate">
                              {char.display_name || char.name}
                            </p>
                            {char.description && (
                              <p className="text-[11px] text-text-muted truncate">
                                {char.description}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Delete ${char.name}? This cannot be undone.`)) {
                                deleteCharacter(char.id);
                              }
                            }}
                            className="text-[10px] text-status-error hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: editor / details */}
            <div className="w-1/2 p-4 overflow-y-auto">
              {editing ? (
                <CharacterForm
                  initial={editing.id ? editing : null}
                  saving={saving}
                  onCancel={() => setEditing(null)}
                  onSave={async (values) => {
                    setSaving(true);
                    const payload = editing.id
                      ? { ...editing, ...values }
                      : values;
                    const res = await saveCharacter(payload);
                    setSaving(false);
                    if (res?.success) {
                      setEditing(null);
                    }
                  }}
                />
              ) : selected ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-text-primary">
                        {selected.display_name || selected.name}
                      </h3>
                      <p className="text-[11px] text-text-muted">
                        {selected.species || 'Character'} • Private workspace
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() => setEditing(selected)}
                    >
                      Edit
                    </button>
                  </div>
                  {selected.description && (
                    <div>
                      <p className="text-xs text-text-muted mb-1">Summary</p>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap">
                        {selected.description}
                      </p>
                    </div>
                  )}
                  {selected.appearance && (
                    <div>
                      <p className="text-xs text-text-muted mb-1">Appearance</p>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap">
                        {selected.appearance}
                      </p>
                    </div>
                  )}
                  {selected.system_prompt && (
                    <div>
                      <p className="text-xs text-text-muted mb-1">System Prompt</p>
                      <pre className="text-[11px] text-text-muted bg-forge-bg border border-forge-border rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {selected.system_prompt}
                      </pre>
                    </div>
                  )}
                  <p className="text-[11px] text-text-muted">
                    This character lives in the encrypted Private workspace. Lore and memories
                    are stored locally and used automatically when chatting.
                  </p>

                  <LorebookEditor character={selected} />
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      className="btn btn-primary text-xs"
                      onClick={() => setChatCharacter(selected)}
                    >
                      <MessageCircle size={14} />
                      Open Chat
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <p className="text-xs text-text-muted">
                    Select a character on the left to view details, or create a new one.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
        <CharacterChat
          character={chatCharacter}
          isOpen={!!chatCharacter}
          onClose={() => setChatCharacter(null)}
        />
        <CharacterCreator
          isOpen={showCreator}
          onClose={() => {
            setShowCreator(false);
            loadCharacters();
          }}
        />
      </motion.div>
    </AnimatePresence>
  );
}

export default CharacterStudio;


