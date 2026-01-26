import React, { useEffect, useState } from 'react';

export function BackupSettings() {
  const [backups, setBackups] = useState([]);
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const loadBackups = async () => {
    if (!window.electronAPI?.listBackups) return;
    try {
      const list = await window.electronAPI.listBackups();
      setBackups(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to list backups:', err);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleCreateBackup = async () => {
    if (!window.electronAPI?.createBackup || !window.electronAPI?.selectFolder) {
      setError('Backup is only available in the desktop app.');
      return;
    }
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const folder = await window.electronAPI.selectFolder({
        title: 'Choose backup folder',
      });
      if (!folder) {
        setIsWorking(false);
        return;
      }
      const res = await window.electronAPI.createBackup({ targetPath: folder });
      if (!res?.success) {
        throw new Error(res?.error || 'Backup failed');
      }
      setMessage(`Backup created at ${res.filePath}`);
      await loadBackups();
    } catch (err) {
      console.error('Failed to create backup:', err);
      setError(err.message || String(err));
    } finally {
      setIsWorking(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!window.electronAPI?.restoreBackup || !window.electronAPI?.selectFile) {
      setError('Restore is only available in the desktop app.');
      return;
    }
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const file = await window.electronAPI.selectFile({
        title: 'Select DevForge backup file',
        filters: [{ name: 'DevForge Backup', extensions: ['devforge-backup'] }],
      });
      if (!file) {
        setIsWorking(false);
        return;
      }
      const res = await window.electronAPI.restoreBackup({ backupPath: file });
      if (!res?.success) {
        throw new Error(res?.error || 'Restore failed');
      }
      setMessage('Backup restored. Please restart DevForge to apply changes.');
    } catch (err) {
      console.error('Failed to restore backup:', err);
      setError(err.message || String(err));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">Backups</h3>
        <p className="text-xs text-text-muted mb-3">
          Create encrypted backups of your conversations, settings, and templates. Models
          themselves are not included.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={isWorking}
            className="btn btn-primary text-xs"
          >
            Create backup
          </button>
          <button
            type="button"
            onClick={handleRestoreBackup}
            disabled={isWorking}
            className="btn btn-secondary text-xs"
          >
            Restore from backup
          </button>
        </div>
      </div>

      {message && (
        <div className="text-xs text-status-success bg-status-success/10 border border-status-success/40 rounded px-3 py-2">
          {message}
        </div>
      )}
      {error && (
        <div className="text-xs text-status-error bg-status-error/10 border border-status-error/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <h4 className="text-xs font-medium text-text-primary mb-2 uppercase tracking-wide">
          Recent backups
        </h4>
        <div className="border border-forge-border rounded-lg max-h-40 overflow-y-auto bg-forge-bg/40">
          {backups.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-muted">
              No backups found in your Documents folder yet.
            </div>
          )}
          {backups.map((b) => (
            <div
              key={b.path}
              className="px-3 py-2 text-xs text-text-secondary border-b border-forge-border/60"
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{b.name}</span>
                <span className="ml-2 text-[10px] text-text-muted">
                  {Math.round((b.size / (1024 * 1024)) * 10) / 10} MB
                </span>
              </div>
              <div className="text-[10px] text-text-muted">
                {new Date(b.modified).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BackupSettings;


