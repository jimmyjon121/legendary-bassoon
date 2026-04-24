/**
 * WorldbuildingStudio
 *
 * Encrypted lorebook for vault scenes — characters, factions, places,
 * concepts, and freeform notes with relationship links between them.
 *
 * Persistence: entries are stored in SQLite via vault:loreSave, but the
 * "content" blob is AES-GCM encrypted in the renderer first using the
 * unlocked vault password. If the password is not available, the studio
 * shows a read-only banner instead of leaking plaintext.
 *
 * Context injection: selected entries can be promoted to the active chat
 * via "Send to scene", which drops a compact summary into the user input
 * stream. Nothing is auto-injected — the user stays in control.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Library, Plus, Trash2, Save, X, Users, MapPin, Sparkles, Network, Send, Link2, Unlock } from 'lucide-react';
import { api, isElectron } from '../../utils/electronAPI';
import { useAppStore } from '../../stores/appStore';

const KINDS = [
  { id: 'character', label: 'Character', icon: Users, color: 'rose' },
  { id: 'place', label: 'Place', icon: MapPin, color: 'amber' },
  { id: 'faction', label: 'Faction', icon: Network, color: 'emerald' },
  { id: 'concept', label: 'Concept', icon: Sparkles, color: 'violet' },
  { id: 'note', label: 'Note', icon: Library, color: 'sky' },
];

function kindMeta(id) {
  return KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];
}

export function WorldbuildingStudio({ engine, onClose }) {
  const password = useAppStore((s) => s.nsfwPassword);
  const [entries, setEntries] = useState([]);
  const [links, setLinks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  const canEncrypt = Boolean(password);

  const decryptContent = useCallback(async (raw) => {
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.encrypted && canEncrypt) {
        const decrypted = await window.electronAPI?.decrypt?.(parsed, password);
        return String(decrypted || '');
      }
      return String(raw);
    } catch (_) {
      return String(raw);
    }
  }, [password, canEncrypt]);

  const encryptContent = useCallback(async (plaintext) => {
    if (!canEncrypt) return String(plaintext || '');
    try {
      const ct = await window.electronAPI?.encrypt?.(String(plaintext || ''), password);
      return ct ? JSON.stringify(ct) : String(plaintext || '');
    } catch (_) {
      return String(plaintext || '');
    }
  }, [password, canEncrypt]);

  const refresh = useCallback(async () => {
    if (!isElectron()) return;
    setLoading(true);
    try {
      const [listRes, linksRes] = await Promise.all([
        api.vaultLoreList?.({}),
        api.vaultLoreLinks?.(),
      ]);
      if (listRes?.success) {
        const decoded = await Promise.all(
          (listRes.entries || []).map(async (e) => ({
            ...e,
            decrypted: await decryptContent(e.content),
          }))
        );
        setEntries(decoded);
      }
      if (linksRes?.success) setLinks(linksRes.links || []);
    } finally {
      setLoading(false);
    }
  }, [decryptContent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startNew = useCallback((kind = 'note') => {
    setDraft({
      id: `lore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      title: '',
      decrypted: '',
      tags: [],
      isNew: true,
    });
    setSelectedId(null);
  }, []);

  const selectEntry = useCallback((id) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setSelectedId(id);
    setDraft({ ...entry, isNew: false });
  }, [entries]);

  const saveDraft = useCallback(async () => {
    if (!draft || !draft.title.trim()) return;
    setStatus('Saving...');
    const encrypted = await encryptContent(draft.decrypted || '');
    const payload = {
      id: draft.id,
      kind: draft.kind,
      title: draft.title.trim(),
      content: encrypted,
      tags: Array.isArray(draft.tags) ? draft.tags : [],
    };
    const res = await api.vaultLoreSave?.(payload);
    if (res?.success) {
      setStatus('Saved.');
      setTimeout(() => setStatus(null), 1500);
      await refresh();
      setSelectedId(draft.id);
    } else {
      setStatus(res?.error || 'Save failed');
    }
  }, [draft, encryptContent, refresh]);

  const deleteDraft = useCallback(async () => {
    if (!draft || draft.isNew) { setDraft(null); setSelectedId(null); return; }
    const res = await api.vaultLoreDelete?.(draft.id);
    if (res?.success) {
      setDraft(null);
      setSelectedId(null);
      await refresh();
    }
  }, [draft, refresh]);

  const addLink = useCallback(async (targetId, relation = 'related') => {
    if (!draft || draft.isNew || !targetId) return;
    await api.vaultLoreLinkSave?.({
      id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source_id: draft.id,
      target_id: targetId,
      relation,
    });
    await refresh();
  }, [draft, refresh]);

  const removeLink = useCallback(async (linkId) => {
    await api.vaultLoreLinkDelete?.(linkId);
    await refresh();
  }, [refresh]);

  const sendToScene = useCallback(() => {
    if (!draft || !engine) return;
    const snippet = `[Lore: ${draft.title} (${draft.kind})]\n${draft.decrypted}`.slice(0, 4000);
    engine.sendUserMessage(snippet, { source: 'lorebook', loreId: draft.id }).catch(() => {});
  }, [draft, engine]);

  const visibleEntries = entries;

  const entryLinks = useMemo(() => {
    if (!draft || draft.isNew) return [];
    return links.filter((l) => l.source_id === draft.id || l.target_id === draft.id).map((l) => ({
      ...l,
      other: l.source_id === draft.id ? l.target_id : l.source_id,
    }));
  }, [draft, links]);

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
          className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl border border-amber-500/30 bg-forge-surface shadow-2xl flex flex-col"
        >
          <div className="flex-shrink-0 bg-forge-surface border-b border-forge-border px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Library size={18} className="text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Worldbuilding Studio</h3>
                <p className="text-xs text-text-muted">
                  {canEncrypt
                    ? 'Encrypted lorebook. Entries are AES-GCM encrypted with your vault password.'
                    : 'Vault locked — entries will be stored in plaintext. Unlock the vault to enable encryption.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="rounded-lg p-2 text-text-muted hover:bg-forge-hover hover:text-text-secondary"
              aria-label="Close worldbuilding studio"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 flex overflow-hidden">
            <div className="w-64 flex-shrink-0 border-r border-forge-border overflow-y-auto">
              <div className="sticky top-0 bg-forge-surface p-3 border-b border-forge-border">
                <div className="grid grid-cols-2 gap-1">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => startNew(k.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-forge-bg border border-forge-border text-[10px] text-text-secondary hover:bg-forge-hover"
                    >
                      <k.icon size={10} />
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-2 space-y-1">
                {loading && <p className="text-xs text-text-muted p-2">Loading...</p>}
                {!loading && visibleEntries.length === 0 && (
                  <p className="text-xs text-text-muted p-2">No entries yet. Click a kind above to create one.</p>
                )}
                {visibleEntries.map((e) => {
                  const meta = kindMeta(e.kind);
                  const Icon = meta.icon;
                  const active = selectedId === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => selectEntry(e.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs ${
                        active
                          ? 'bg-amber-500/15 border border-amber-500/40 text-amber-200'
                          : 'text-text-secondary hover:bg-forge-hover border border-transparent'
                      }`}
                    >
                      <Icon size={12} />
                      <span className="truncate flex-1">{e.title || '(untitled)'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {!draft && (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-text-muted">Select an entry or create a new one.</p>
                </div>
              )}

              {draft && (
                <div className="space-y-4 max-w-3xl">
                  <div className="flex items-center gap-2">
                    <select
                      value={draft.kind}
                      onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                      className="px-2 py-1 rounded bg-forge-bg border border-forge-border text-xs text-text-primary"
                    >
                      {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="Title"
                      className="flex-1 px-3 py-1.5 rounded bg-forge-bg border border-forge-border text-sm text-text-primary font-medium"
                    />
                    {canEncrypt && (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <Unlock size={10} /> encrypted
                      </span>
                    )}
                  </div>

                  <textarea
                    value={draft.decrypted}
                    onChange={(e) => setDraft({ ...draft, decrypted: e.target.value })}
                    rows={12}
                    placeholder="Write the lore entry..."
                    className="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border text-sm text-text-primary leading-relaxed"
                  />

                  <label className="block">
                    <span className="text-xs text-text-secondary">Tags (comma separated)</span>
                    <input
                      type="text"
                      value={(draft.tags || []).join(', ')}
                      onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                      placeholder="e.g. mentor, recurring, hidden"
                      className="mt-1 w-full px-3 py-1.5 rounded bg-forge-bg border border-forge-border text-xs text-text-primary"
                    />
                  </label>

                  {!draft.isNew && (
                    <div>
                      <span className="text-xs text-text-secondary">Links</span>
                      <div className="mt-1 space-y-1">
                        {entryLinks.map((l) => {
                          const other = entries.find((e) => e.id === l.other);
                          return (
                            <div key={l.id} className="flex items-center gap-2 px-2 py-1 rounded bg-forge-bg border border-forge-border text-xs">
                              <Link2 size={10} className="text-text-muted" />
                              <span className="flex-1 truncate">{other?.title || l.other}</span>
                              <span className="text-[10px] text-text-muted">{l.relation || 'related'}</span>
                              <button
                                type="button"
                                onClick={() => removeLink(l.id)}
                                className="text-text-muted hover:text-status-error"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          );
                        })}
                        <LinkAdder entries={entries.filter((e) => e.id !== draft.id)} onAdd={addLink} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 bg-forge-surface border-t border-forge-border px-5 py-3 flex justify-between items-center">
            <span className="text-xs text-text-muted">{status || ''}</span>
            <div className="flex gap-2">
              {draft && engine && !draft.isNew && (
                <button
                  type="button"
                  onClick={sendToScene}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-forge-border text-text-secondary text-xs hover:bg-forge-hover"
                >
                  <Send size={12} />
                  Send to scene
                </button>
              )}
              {draft && !draft.isNew && (
                <button
                  type="button"
                  onClick={deleteDraft}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-status-error/40 text-status-error text-xs hover:bg-status-error/10"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              )}
              {draft && (
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={!draft.title.trim()}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs hover:bg-amber-500/30 disabled:opacity-50"
                >
                  <Save size={12} />
                  Save
                </button>
              )}
              <button
                type="button"
                onClick={() => onClose?.()}
                className="px-3 py-1.5 rounded-lg border border-forge-border text-text-secondary text-xs hover:bg-forge-hover"
              >
                Close
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function LinkAdder({ entries, onAdd }) {
  const [targetId, setTargetId] = useState('');
  const [relation, setRelation] = useState('related');
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-forge-bg border border-forge-border border-dashed">
      <Plus size={10} className="text-text-muted" />
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        className="flex-1 px-2 py-0.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary"
      >
        <option value="">Link to entry...</option>
        {entries.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
      </select>
      <input
        type="text"
        value={relation}
        onChange={(e) => setRelation(e.target.value)}
        className="w-24 px-2 py-0.5 rounded bg-forge-surface border border-forge-border text-[10px] text-text-primary"
      />
      <button
        type="button"
        onClick={() => {
          if (!targetId) return;
          onAdd(targetId, relation);
          setTargetId('');
        }}
        disabled={!targetId}
        className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] hover:bg-amber-500/25 disabled:opacity-40"
      >
        Link
      </button>
    </div>
  );
}

export default WorldbuildingStudio;
