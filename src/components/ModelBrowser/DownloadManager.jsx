/**
 * DownloadManager Component
 * 
 * Shows download progress and manages active downloads.
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  X, Download, CheckCircle, XCircle, Pause, Play, Trash2,
  Folder, RefreshCw, Loader2, AlertCircle,
} from 'lucide-react';
import { useHuggingFaceStore } from '../../stores/huggingfaceStore';

function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  }
  return `${bytesPerSec.toFixed(0)} B/s`;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatETA(bytesRemaining, speed) {
  if (!speed || speed === 0) return '--';
  const seconds = bytesRemaining / speed;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
}

const STATUS_ICONS = {
  pending: Loader2,
  downloading: Download,
  completed: CheckCircle,
  error: XCircle,
  cancelled: XCircle,
};

const STATUS_COLORS = {
  pending: 'text-yellow-400',
  downloading: 'text-blue-400',
  completed: 'text-green-400',
  error: 'text-red-400',
  cancelled: 'text-gray-400',
};

export function DownloadManager({ downloads, onClose }) {
  const { cancelDownload, downloadDir, changeDownloadDir, importToOllama } = useHuggingFaceStore();

  const activeDownloads = downloads.filter(d => 
    d.status === 'downloading' || d.status === 'pending'
  );
  const completedDownloads = downloads.filter(d => d.status === 'completed');
  const failedDownloads = downloads.filter(d => 
    d.status === 'error' || d.status === 'cancelled'
  );

  const handleImportToOllama = async (download) => {
    const modelName = download.filename.replace('.gguf', '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const result = await importToOllama(download.destPath, modelName);
    if (result.success) {
      // Could show a success toast here
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed top-0 right-0 bottom-0 w-96 bg-forge-surface border-l border-forge-border shadow-2xl z-50 flex flex-col"
    >
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-forge-border">
        <div className="flex items-center gap-3">
          <Download size={18} className="text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Downloads</h3>
            <p className="text-[10px] text-text-muted">
              {activeDownloads.length} active, {completedDownloads.length} completed
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-forge-hover text-text-muted"
        >
          <X size={18} />
        </button>
      </div>

      {/* Download Directory */}
      <div className="px-4 py-3 border-b border-forge-border bg-forge-bg/50">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Download Location</p>
            <p className="text-xs text-text-secondary truncate" title={downloadDir}>
              {downloadDir || 'Not set'}
            </p>
          </div>
          <button
            onClick={changeDownloadDir}
            className="p-2 rounded hover:bg-forge-hover text-text-muted hover:text-text-primary"
            title="Change download directory"
          >
            <Folder size={14} />
          </button>
        </div>
      </div>

      {/* Downloads List */}
      <div className="flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center p-4">
              <Download size={32} className="text-text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-text-secondary">No downloads yet</p>
              <p className="text-xs text-text-muted">Select a model to start downloading</p>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Active Downloads */}
            {activeDownloads.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
                  Active ({activeDownloads.length})
                </p>
                <div className="space-y-2">
                  {activeDownloads.map((download) => (
                    <DownloadItem
                      key={download.id}
                      download={download}
                      onCancel={() => cancelDownload(download.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed Downloads */}
            {completedDownloads.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
                  Completed ({completedDownloads.length})
                </p>
                <div className="space-y-2">
                  {completedDownloads.map((download) => (
                    <DownloadItem
                      key={download.id}
                      download={download}
                      onImport={() => handleImportToOllama(download)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Failed Downloads */}
            {failedDownloads.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
                  Failed ({failedDownloads.length})
                </p>
                <div className="space-y-2">
                  {failedDownloads.map((download) => (
                    <DownloadItem
                      key={download.id}
                      download={download}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function DownloadItem({ download, onCancel, onImport }) {
  const StatusIcon = STATUS_ICONS[download.status] || Download;
  const statusColor = STATUS_COLORS[download.status] || 'text-text-muted';
  
  const isActive = download.status === 'downloading' || download.status === 'pending';
  const isCompleted = download.status === 'completed';
  
  const bytesRemaining = download.totalBytes - download.downloadedBytes;
  const eta = formatETA(bytesRemaining, download.speed);

  return (
    <div className="p-3 rounded-lg border border-forge-border bg-forge-bg/50">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${statusColor}`}>
          <StatusIcon size={16} className={download.status === 'downloading' ? 'animate-pulse' : download.status === 'pending' ? 'animate-spin' : ''} />
        </div>
        
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-text-primary truncate" title={download.filename}>
            {download.filename}
          </p>
          <p className="text-[10px] text-text-muted truncate">
            {download.modelId}
          </p>

          {/* Progress */}
          {isActive && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                <span>{formatSize(download.downloadedBytes)} / {formatSize(download.totalBytes)}</span>
                <span>{download.progress}%</span>
              </div>
              <div className="h-1.5 bg-forge-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${download.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-text-muted mt-1">
                <span>{formatSpeed(download.speed || 0)}</span>
                <span>ETA: {eta}</span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {download.status === 'error' && download.error && (
            <div className="mt-2 flex items-center gap-1 text-[10px] text-red-400">
              <AlertCircle size={10} />
              {download.error}
            </div>
          )}

          {/* Actions */}
          <div className="mt-2 flex items-center gap-2">
            {isActive && onCancel && (
              <button
                onClick={onCancel}
                className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-[10px] hover:bg-red-500/30 transition-colors"
              >
                Cancel
              </button>
            )}
            {isCompleted && onImport && (
              <button
                onClick={onImport}
                className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-[10px] hover:bg-green-500/30 transition-colors"
              >
                Import to Ollama
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DownloadManager;












