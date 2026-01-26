import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export function LorebookEditor({ character }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!character) return;
    let cancelled = false;

    const load = async () => {
      if (!window.electronAPI?.listLoreEntries) return;
      setLoading(true);
      setError(null);
      try {
        const rows = await window.electronAPI.listLoreEntries(character.id);
        if (!cancelled) {
          setEntries(Array.isArray(rows) ? rows : []);
        }
      } catch (e) {
        console.error('Failed to load lore entries:', e);
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [character]);

  if (!character) return null;

  const handleChange = (id, field, value) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
    );
  };

  const handleAdd = () => {
    const id = `local-${Date.now()}`;
    setEntries((prev) => [
      {
        id,
        character_id: character.id,
        entry_name: '',
        keywords: '[]',
        content: '',
        priority: 50,
        enabled: 1,
        position: 'before_char',
        max_tokens: 200,
        cooldown_messages: 0,
        isLocalOnly: true,
      },
      ...prev,
    ]);
  };

  const handleSave = async (entry) => {
    if (!window.electronAPI?.saveLoreEntry) return;
    setSavingId(entry.id);
    setError(null);
    try {
      const keywords =
        typeof entry.keywords === 'string'
          ? entry.keywords
          : JSON.stringify(entry.keywords || []);
      const payload = {
        ...entry,
        character_id: character.id,
        keywords,
        enabled: entry.enabled === 0 ? 0 : 1,
      };
      const res = await window.electronAPI.saveLoreEntry(payload);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to save lore entry');
      }
      // Refresh from DB to get canonical version
      const rows = await window.electronAPI.listLoreEntries(character.id);
      setEntries(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error('Failed to save lore entry:', e);
      setError(e.message || String(e));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (entry) => {
    if (!window.electronAPI?.deleteLoreEntry) return;
    if (!entry.id || entry.id.startsWith('local-')) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      return;
    }
    if (!window.confirm('Delete this lore entry? This cannot be undone.')) return;
    setSavingId(entry.id);
    setError(null);
    try {
      const res = await window.electronAPI.deleteLoreEntry(entry.id);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to delete lore entry');
      }
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (e) {
      console.error('Failed to delete lore entry:', e);
      setError(e.message || String(e));
    } finally {
      setSavingId(null);
    }
  };

  const renderKeywordsField = (raw) => {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  };

  return (
    <div className="mt-4 border border-forge-border rounded-lg bg-forge-bg/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border">
        <div>
          <p className="text-xs font-medium text-text-primary">Lorebook</p>
          <p className="text-[11px] text-text-muted">
            Add world info or backstory snippets that should be injected when
            keywords are mentioned.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1 text-[11px] text-workspace-nsfw hover:underline"
        >
          <Plus size={12} />
          Add entry
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-[11px] text-status-error bg-status-error/10 border-b border-status-error/30">
          {error}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto divide-y divide-forge-border/60">
        {loading && entries.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-text-muted">
            Loading lore entries…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-text-muted">
            No lore entries yet. Add a few key facts, places, or backstory
            snippets for this character.
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="px-3 py-2 space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={entry.entry_name || ''}
                onChange={(e) =>
                  handleChange(entry.id, 'entry_name', e.target.value)
                }
                placeholder="Entry name (optional)"
                className="input text-[11px] flex-1"
              />
              <select
                value={entry.position || 'before_char'}
                onChange={(e) =>
                  handleChange(entry.id, 'position', e.target.value)
                }
                className="input text-[11px] w-32"
              >
                <option value="before_char">Before character</option>
                <option value="after_char">After character</option>
                <option value="before_example">Before examples</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={renderKeywordsField(entry.keywords)}
                onChange={(e) =>
                  handleChange(entry.id, 'keywords', e.target.value)
                }
                placeholder='Keywords JSON or comma list, e.g. ["clinic","night shift"]'
                className="input text-[11px] flex-1 font-mono"
              />
            </div>
            <textarea
              value={entry.content || ''}
              onChange={(e) =>
                handleChange(entry.id, 'content', e.target.value)
              }
              rows={3}
              className="input-area text-[11px]"
              placeholder="Lore content injected when keywords are mentioned."
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <label className="flex items-center gap-1">
                  <span>Priority</span>
                  <input
                    type="number"
                    className="input w-16 text-[11px]"
                    value={entry.priority ?? 50}
                    onChange={(e) =>
                      handleChange(
                        entry.id,
                        'priority',
                        parseInt(e.target.value || '50', 10),
                      )
                    }
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span>Cooldown</span>
                  <input
                    type="number"
                    className="input w-16 text-[11px]"
                    value={entry.cooldown_messages ?? 0}
                    onChange={(e) =>
                      handleChange(
                        entry.id,
                        'cooldown_messages',
                        parseInt(e.target.value || '0', 10),
                      )
                    }
                  />
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={entry.enabled !== 0}
                    onChange={(e) =>
                      handleChange(entry.id, 'enabled', e.target.checked ? 1 : 0)
                    }
                  />
                  <span>Enabled</span>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDelete(entry)}
                  className="text-[11px] text-status-error hover:underline flex items-center gap-1"
                  disabled={savingId === entry.id}
                >
                  <Trash2 size={12} />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(entry)}
                  className="btn btn-secondary text-[11px]"
                  disabled={savingId === entry.id}
                >
                  {savingId === entry.id ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LorebookEditor;

















