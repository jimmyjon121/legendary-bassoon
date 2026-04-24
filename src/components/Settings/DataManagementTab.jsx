/**
 * DataManagementTab - Manage stored data, analytics, and storage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Trash2, Download, HardDrive, Brain, BarChart2,
  AlertTriangle, CheckCircle, RefreshCw, FileText, MessageSquare,
  Image, Zap, Clock, Archive, Shield, ChevronRight, ExternalLink
} from 'lucide-react';
import { safeCall, isElectron } from '../../utils/electronAPI';

export function DataManagementTab() {
  const [storageStats, setStorageStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(null);

  const loadStorageStats = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get ledger stats
      const stats = await safeCall('ledgerGetStats', [], null);
      
      // Get friction signals count
      const friction = await safeCall('ledger:getFrictionSignals', [{ limit: 1000 }], []);
      
      // Get database info (if available)
      const dbInfo = await safeCall('getStorageInfo', [], null);
      
      setStorageStats({
        events: stats?.events || 0,
        sessions: stats?.sessions || 0,
        friction: friction?.length || 0,
        runs: stats?.runs || 0,
        forks: stats?.forks || 0,
        evidence: stats?.evidence || 0,
        dbSize: dbInfo?.ledgerSize || 'Unknown',
        mainDbSize: dbInfo?.mainDbSize || 'Unknown',
        imagesCount: dbInfo?.imagesCount || 0,
        documentsCount: dbInfo?.documentsCount || 0,
      });
    } catch (error) {
      console.error('Failed to load storage stats:', error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadStorageStats();
  }, [loadStorageStats]);

  const handleClearData = async (dataType) => {
    if (clearConfirm !== dataType) {
      setClearConfirm(dataType);
      setTimeout(() => setClearConfirm(null), 5000); // Reset after 5s
      return;
    }

    setIsClearing(true);
    try {
      switch (dataType) {
        case 'events':
          await safeCall('ledger:clearEvents', [], null);
          break;
        case 'friction':
          await safeCall('ledger:clearFrictionSignals', [], null);
          break;
        case 'all':
          await safeCall('ledger:clearAll', [], null);
          break;
      }
      await loadStorageStats();
      setClearConfirm(null);
    } catch (error) {
      console.error('Failed to clear data:', error);
    }
    setIsClearing(false);
  };

  const handleExport = async (dataType) => {
    setIsExporting(true);
    try {
      let data;
      let filename;
      
      switch (dataType) {
        case 'events':
          data = await safeCall('ledger:listEvents', [{ limit: 10000 }], []);
          filename = `devforge-events-${new Date().toISOString().split('T')[0]}.json`;
          break;
        case 'friction':
          data = await safeCall('ledger:getFrictionSignals', [{ limit: 10000 }], []);
          filename = `devforge-friction-${new Date().toISOString().split('T')[0]}.json`;
          break;
        case 'all': {
          const events = await safeCall('ledger:listEvents', [{ limit: 10000 }], []);
          const friction = await safeCall('ledger:getFrictionSignals', [{ limit: 10000 }], []);
          data = { events, friction, exportedAt: new Date().toISOString() };
          filename = `devforge-export-${new Date().toISOString().split('T')[0]}.json`;
          break;
        }
      }

      // Trigger download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(null), 3000);
    } catch (error) {
      console.error('Failed to export data:', error);
    }
    setIsExporting(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary">Data & Storage</h3>
        <p className="text-sm text-text-muted mt-1">
          Manage your local data, analytics, and storage
        </p>
      </div>

      {/* Storage Overview */}
      <div className="grid grid-cols-3 gap-4">
        <StorageCard
          icon={Database}
          label="Events"
          value={storageStats?.events || 0}
          color="text-blue-400"
        />
        <StorageCard
          icon={Brain}
          label="Friction Signals"
          value={storageStats?.friction || 0}
          color="text-purple-400"
        />
        <StorageCard
          icon={Zap}
          label="Runs"
          value={storageStats?.runs || 0}
          color="text-amber-400"
        />
      </div>

      {/* Detailed Stats */}
      <div className="p-4 rounded-xl bg-forge-bg border border-forge-border">
        <h4 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <BarChart2 size={16} />
          Detailed Storage
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <StatRow label="Total Sessions" value={storageStats?.sessions || 0} />
          <StatRow label="Decision Forks" value={storageStats?.forks || 0} />
          <StatRow label="Evidence Items" value={storageStats?.evidence || 0} />
          <StatRow label="Documents" value={storageStats?.documentsCount || 0} />
          <StatRow label="Generated Images" value={storageStats?.imagesCount || 0} />
          <StatRow label="Ledger DB Size" value={storageStats?.dbSize} />
        </div>
      </div>

      {/* Export Success Toast */}
      <AnimatePresence>
        {exportSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-lg bg-emerald-400/20 border border-emerald-400/30 flex items-center gap-2"
          >
            <CheckCircle size={16} className="text-emerald-400" />
            <span className="text-sm text-emerald-400">Data exported successfully!</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Data Categories */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">Manage Data</h4>
        
        {/* Events */}
        <DataCategory
          icon={MessageSquare}
          title="Event Log"
          description="Messages, generations, workspace switches, and user actions"
          count={storageStats?.events || 0}
          onExport={() => handleExport('events')}
          onClear={() => handleClearData('events')}
          isConfirming={clearConfirm === 'events'}
          isClearing={isClearing}
          isExporting={isExporting}
        />

        {/* Friction Signals */}
        <DataCategory
          icon={Brain}
          title="Friction Signals"
          description="Learning data from regenerations, edits, and feedback"
          count={storageStats?.friction || 0}
          onExport={() => handleExport('friction')}
          onClear={() => handleClearData('friction')}
          isConfirming={clearConfirm === 'friction'}
          isClearing={isClearing}
          isExporting={isExporting}
        />
      </div>

      {/* Bulk Actions */}
      <div className="p-4 rounded-xl bg-status-error/5 border border-status-error/20">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-status-error flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-text-primary">Danger Zone</h4>
            <p className="text-xs text-text-muted mt-1 mb-3">
              These actions are irreversible. Export your data first if needed.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleExport('all')}
                disabled={isExporting}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-forge-surface border border-forge-border text-text-secondary text-xs hover:bg-forge-hover transition-colors disabled:opacity-50"
              >
                <Download size={12} />
                Export All Data
              </button>
              <button
                onClick={() => handleClearData('all')}
                disabled={isClearing}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  clearConfirm === 'all'
                    ? 'bg-status-error text-white'
                    : 'bg-status-error/20 text-status-error hover:bg-status-error/30'
                }`}
              >
                <Trash2 size={12} />
                {clearConfirm === 'all' ? 'Click Again to Confirm' : 'Clear All Data'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Vault Dead Switch */}
      <VaultDeadSwitchSection />

      {/* Privacy Note */}
      <div className="p-4 rounded-xl bg-forge-bg border border-forge-border">
        <div className="flex items-start gap-3">
          <Shield size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-text-primary">Privacy First</h4>
            <p className="text-xs text-text-muted mt-1">
              All data is stored locally on your machine. Nothing is ever sent to external servers.
              Your conversations, analytics, and learning data remain completely private.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * VaultDeadSwitchSection
 *
 * User-controlled "nuclear option" for the vault workspace.
 * Two-step confirmation: request code → type it back → execute.
 * Securely overwrites vault files and wipes the vault password hash.
 */
function VaultDeadSwitchSection() {
  const [code, setCode] = useState(null);
  const [input, setInput] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastReport, setLastReport] = useState(null);
  const [error, setError] = useState(null);

  const handlePrepare = async () => {
    setError(null);
    setLastReport(null);
    try {
      const res = await safeCall('vaultDeadSwitchPrepare', [], null);
      if (!res?.success || !res.code) {
        setError(res?.error || 'Failed to prepare dead switch');
        return;
      }
      setCode(res.code);
      setExpiresAt(res.expiresAt);
      setInput('');
    } catch (e) {
      setError(e?.message || 'Unavailable');
    }
  };

  const handleCancel = async () => {
    try { await safeCall('vaultDeadSwitchCancel', [], null); } catch (_) { /* noop */ }
    setCode(null);
    setInput('');
    setExpiresAt(null);
  };

  const handleExecute = async () => {
    if (!input || input.trim().length === 0) return;
    setIsRunning(true);
    setError(null);
    try {
      const res = await safeCall('vaultDeadSwitchExecute', [input.trim()], null);
      if (!res?.success) {
        setError(res?.error || 'Dead switch failed');
        setIsRunning(false);
        return;
      }
      setLastReport(res.report || { timestamp: new Date().toISOString() });
      setCode(null);
      setInput('');
      setExpiresAt(null);
    } catch (e) {
      setError(e?.message || 'Dead switch failed');
    } finally {
      setIsRunning(false);
    }
  };

  if (!isElectron()) return null;

  return (
    <div className="p-4 rounded-xl bg-forge-bg border border-status-error/40">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="text-status-error flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-text-primary">Vault Dead Switch</h4>
          <p className="text-xs text-text-muted mt-1">
            Securely overwrites and deletes all vault conversations, vault attachments, private model files, and the vault password hash on this machine.
            This action is immediate, irreversible, and leaves non-vault data untouched.
          </p>
          {lastReport && (
            <div className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
              Vault wipe completed at {new Date(lastReport.timestamp).toLocaleString()}.
              {Array.isArray(lastReport.wiped) && ` ${lastReport.wiped.length} file(s) overwritten.`}
            </div>
          )}
          {error && (
            <div className="mt-3 p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-xs text-status-error">
              {error}
            </div>
          )}
          {!code && (
            <button
              onClick={handlePrepare}
              className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-status-error/20 text-status-error text-xs hover:bg-status-error/30 transition-colors"
            >
              <Trash2 size={12} />
              Request Dead Switch Code
            </button>
          )}
          {code && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-text-secondary">
                Confirmation code (valid 5 min):
              </p>
              <code className="block p-2 rounded bg-black/40 text-status-error font-mono tracking-widest text-center select-all">
                {code}
              </code>
              <p className="text-xs text-text-muted">
                Type the code above to confirm. Click Cancel to abort.
              </p>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                placeholder="Type confirmation code"
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-2 rounded-lg bg-forge-surface border border-forge-border text-text-primary text-sm font-mono tracking-widest"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={isRunning}
                  className="px-3 py-1.5 rounded-lg bg-forge-surface border border-forge-border text-text-secondary text-xs hover:bg-forge-hover transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecute}
                  disabled={isRunning || !input || input.trim().length === 0}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-status-error text-white text-xs hover:bg-status-error/80 transition-colors disabled:opacity-50"
                >
                  <AlertTriangle size={12} />
                  {isRunning ? 'Wiping...' : 'Execute Dead Switch'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StorageCard({ icon: Icon, label, value, color }) {
  return (
    <div className="p-4 rounded-xl bg-forge-bg border border-forge-border">
      <Icon size={20} className={color} />
      <p className="text-2xl font-bold text-text-primary mt-2">{value.toLocaleString()}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-forge-border/30 last:border-0">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs font-medium text-text-secondary">{typeof value === 'number' ? value.toLocaleString() : value}</span>
    </div>
  );
}

function DataCategory({ icon: Icon, title, description, count, onExport, onClear, isConfirming, isClearing, isExporting }) {
  return (
    <div className="p-4 rounded-xl bg-forge-bg border border-forge-border">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-forge-surface">
            <Icon size={16} className="text-text-muted" />
          </div>
          <div>
            <h5 className="text-sm font-medium text-text-primary">{title}</h5>
            <p className="text-xs text-text-muted mt-0.5">{description}</p>
            <p className="text-xs text-text-secondary mt-1">{count.toLocaleString()} items</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onExport}
            disabled={isExporting || count === 0}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors disabled:opacity-50"
            title="Export"
          >
            <Download size={14} />
          </button>
          <button
            onClick={onClear}
            disabled={isClearing || count === 0}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
              isConfirming
                ? 'text-status-error bg-status-error/20'
                : 'text-text-muted hover:text-status-error hover:bg-status-error/10'
            }`}
            title={isConfirming ? 'Click again to confirm' : 'Clear'}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default DataManagementTab;


