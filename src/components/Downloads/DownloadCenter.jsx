/**
 * DownloadCenter - Main download management UI
 * Shows all downloads with progress, controls, and status
 */

import React, { useEffect, useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Pause,
  Play,
  X,
  RefreshCw,
  Trash2,
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Zap,
  Filter,
  Search,
  MoreVertical,
  Calendar,
  ArrowUpCircle,
  ArrowDownCircle,
} from 'lucide-react';
import { useDownloads, useDownloadStats, useDownloadActions, JobStatus } from '../../stores/appStore';

// Format bytes to human readable
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// Format speed to human readable
const formatSpeed = (bytesPerSecond) => {
  if (!bytesPerSecond || bytesPerSecond === 0) return '0 B/s';
  return `${formatBytes(bytesPerSecond)}/s`;
};

// Format time remaining
const formatTimeRemaining = (bytes, speed) => {
  if (!speed || speed === 0) return '∞';
  const seconds = bytes / speed;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
};

// Status badge component
const StatusBadge = memo(({ status }) => {
  const config = {
    [JobStatus.QUEUED]: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Queued' },
    [JobStatus.SCHEDULED]: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Scheduled' },
    [JobStatus.PREFLIGHT]: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', label: 'Checking...' },
    [JobStatus.DOWNLOADING]: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Downloading' },
    [JobStatus.VERIFYING]: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Verifying' },
    [JobStatus.INSTALLING]: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Installing' },
    [JobStatus.COMPLETED]: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Complete' },
    [JobStatus.PAUSED]: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Paused' },
    [JobStatus.ERROR]: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Error' },
    [JobStatus.CANCELLED]: { bg: 'bg-gray-500/20', text: 'text-gray-500', label: 'Cancelled' },
  };
  
  const { bg, text, label } = config[status] || config[JobStatus.QUEUED];
  
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
});

// Individual download item component
const DownloadItem = memo(({ job, onPause, onResume, onRetry, onCancel, onDelete, onSetPriority, onConvertNpu }) => {
  const [expanded, setExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  
  const isActive = [JobStatus.DOWNLOADING, JobStatus.PREFLIGHT, JobStatus.VERIFYING].includes(job.status);
  const isPaused = job.status === JobStatus.PAUSED;
  const isFailed = job.status === JobStatus.ERROR;
  const isCompleted = job.status === JobStatus.COMPLETED;
  const remaining = job.totalBytes - job.downloadedBytes;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="bg-surface-2/45 border border-border/25 rounded-xl overflow-hidden"
    >
      {/* Main row */}
      <div className="p-3.5 flex items-center gap-3">
        {/* Icon */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          isActive ? 'bg-green-500/20' : 
          isCompleted ? 'bg-emerald-500/20' : 
          isFailed ? 'bg-red-500/20' : 
          'bg-surface-3/50'
        }`}>
          {isActive ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Download className="w-5 h-5 text-green-400" />
            </motion.div>
          ) : isCompleted ? (
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          ) : isFailed ? (
            <AlertCircle className="w-5 h-5 text-red-400" />
          ) : isPaused ? (
            <Pause className="w-5 h-5 text-gray-400" />
          ) : (
            <Clock className="w-5 h-5 text-gray-400" />
          )}
        </div>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary truncate">{job.name}</span>
            <StatusBadge status={job.status} />
          </div>
          
          <div className="flex items-center gap-3 mt-1 text-sm text-text-muted">
            <span>{formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}</span>
            {isActive && job.speed > 0 && (
              <>
                <span>•</span>
                <span className="text-green-400">{formatSpeed(job.speed)}</span>
                <span>•</span>
                <span>{formatTimeRemaining(remaining, job.speed)} left</span>
              </>
            )}
            {isFailed && job.lastError && (
              <span className="text-red-400 truncate">{job.lastError}</span>
            )}
          </div>
          
          {/* Progress bar */}
          {!isCompleted && (
            <div className="mt-2 h-1.5 bg-surface-3 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${
                  isActive ? 'bg-gradient-to-r from-green-500 to-emerald-400' :
                  isFailed ? 'bg-red-500' :
                  isPaused ? 'bg-gray-400' :
                  'bg-blue-500'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${job.progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          {isActive && (
            <button
              onClick={() => onPause(job.id)}
              className="p-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-text-primary transition-colors"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          
          {isPaused && (
            <button
              onClick={() => onResume(job.id)}
              className="p-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-green-400 transition-colors"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          
          {isFailed && (
            <button
              onClick={() => onRetry(job.id)}
              className="p-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-yellow-400 transition-colors"
              title="Retry"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          
          {!isCompleted && (
            <button
              onClick={() => onCancel(job.id)}
              className="p-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-red-400 transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {isCompleted && onConvertNpu && (
            <button
              onClick={() => onConvertNpu(job)}
              className="px-2 py-1 text-xs bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 rounded-lg transition-colors flex items-center gap-1"
              title="Convert to OpenVINO for NPU acceleration"
            >
              <Zap className="w-3 h-3" /> NPU
            </button>
          )}
          
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-text-primary transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-text-primary transition-colors"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-surface-2 border border-border rounded-lg shadow-[0_18px_44px_-28px_rgba(0,0,0,0.9)] z-10 min-w-[160px]">
                <button
                  onClick={() => { onSetPriority(job.id, (job.priority || 0) + 1); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-surface-3 flex items-center gap-2"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  Increase Priority
                </button>
                <button
                  onClick={() => { onSetPriority(job.id, Math.max(0, (job.priority || 0) - 1)); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-surface-3 flex items-center gap-2"
                >
                  <ArrowDownCircle className="w-4 h-4" />
                  Decrease Priority
                </button>
                <hr className="border-border my-1" />
                <button
                  onClick={() => { onDelete(job.id, true); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-red-500/20 text-red-400 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/30 bg-surface-1/50"
          >
            <div className="p-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-text-muted">File:</span>
                <span className="ml-2 text-text-primary">{job.filename}</span>
              </div>
              <div>
                <span className="text-text-muted">Provider:</span>
                <span className="ml-2 text-text-primary">{job.provider || 'Unknown'}</span>
              </div>
              <div>
                <span className="text-text-muted">Type:</span>
                <span className="ml-2 text-text-primary">{job.modelType || 'Model'}</span>
              </div>
              <div>
                <span className="text-text-muted">Priority:</span>
                <span className="ml-2 text-text-primary">{job.priority || 0}</span>
              </div>
              {job.expectedHash && (
                <div className="col-span-2">
                  <span className="text-text-muted">Expected Hash:</span>
                  <span className="ml-2 text-text-primary font-mono text-xs">{job.expectedHash}</span>
                </div>
              )}
              {job.retryCount > 0 && (
                <div>
                  <span className="text-text-muted">Retries:</span>
                  <span className="ml-2 text-yellow-400">{job.retryCount}</span>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-text-muted">Destination:</span>
                <span className="ml-2 text-text-primary truncate">{job.destinationDir}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// Filter tabs
const FilterTabs = memo(({ active, onChange, stats }) => {
  const tabs = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'active', label: 'Active', count: stats.active + stats.queued },
    { id: 'paused', label: 'Paused', count: stats.paused },
    { id: 'completed', label: 'Completed', count: stats.completed },
    { id: 'failed', label: 'Failed', count: stats.failed },
  ];
  
  return (
    <div className="flex gap-2">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            active === tab.id
              ? 'bg-accent-primary/20 text-accent-primary'
              : 'hover:bg-surface-3 text-text-muted hover:text-text-primary'
          }`}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className={`ml-1.5 ${active === tab.id ? 'text-accent-primary' : 'text-text-muted'}`}>
              ({tab.count})
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

// Main component
export const DownloadCenter = memo(({ isOpen, onClose }) => {
  const downloads = useDownloads();
  const stats = useDownloadStats();
  const {
    initializeDownloads,
    pauseDownload,
    resumeDownload,
    retryDownload,
    cancelDownload,
    deleteDownload,
    setDownloadPriority,
    clearCompletedDownloads,
  } = useDownloadActions();
  
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Initialize downloads on mount
  useEffect(() => {
    initializeDownloads?.();
  }, [initializeDownloads]);
  
  // Filter downloads
  const filteredDownloads = downloads.filter(job => {
    // Text search
    if (searchQuery && !job.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    
    // Status filter
    switch (filter) {
      case 'active':
        return [JobStatus.QUEUED, JobStatus.DOWNLOADING, JobStatus.PREFLIGHT, JobStatus.VERIFYING, JobStatus.SCHEDULED].includes(job.status);
      case 'paused':
        return job.status === JobStatus.PAUSED;
      case 'completed':
        return job.status === JobStatus.COMPLETED;
      case 'failed':
        return job.status === JobStatus.ERROR;
      default:
        return true;
    }
  });
  
  if (!isOpen) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[80vh] bg-surface-1 border border-border rounded-xl shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-green-500/18 to-emerald-500/18 flex items-center justify-center">
                <Download className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-text-primary">Download Center</h2>
                <p className="text-sm text-text-muted">
                  {stats.active} active • {formatSpeed(stats.totalSpeed)}
                </p>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-3 rounded-lg text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Search and filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search downloads..."
                className="w-full pl-9 pr-4 py-2 bg-surface-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              />
            </div>
            
            <FilterTabs active={filter} onChange={setFilter} stats={stats} />
            
            {stats.completed > 0 && (
              <button
                onClick={clearCompletedDownloads}
                className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-surface-3 rounded-lg transition-colors"
              >
                Clear Completed
              </button>
            )}
          </div>
        </div>
        
        {/* Downloads list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredDownloads.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-12 text-text-muted"
              >
                <HardDrive className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-lg">No downloads</p>
                <p className="text-sm mt-1">
                  {filter === 'all' ? 'Start downloading models to see them here' : `No ${filter} downloads`}
                </p>
              </motion.div>
            ) : (
              filteredDownloads.map(job => (
                <DownloadItem
                  key={job.id}
                  job={job}
                  onPause={pauseDownload}
                  onResume={resumeDownload}
                  onRetry={retryDownload}
                  onCancel={cancelDownload}
                  onDelete={deleteDownload}
                  onSetPriority={setDownloadPriority}
                  onConvertNpu={async (completedJob) => {
                    try {
                      const result = await window.electronAPI?.convertModelToNPU?.({
                        inputPath: completedJob.outputPath || completedJob.metadata?.outputPath || completedJob.name,
                        precision: 'fp16',
                      });
                      if (result?.success) {
                        alert(`Converted to OpenVINO for NPU: ${result.outputPath || 'done'}`);
                      } else {
                        alert(`NPU conversion failed: ${result?.error || 'Unknown error'}`);
                      }
                    } catch (err) {
                      alert(`NPU conversion error: ${err?.message || 'Unknown'}`);
                    }
                  }}
                />
              ))
            )}
          </AnimatePresence>
        </div>
        
        {/* Footer with stats */}
        <div className="p-4 border-t border-border bg-surface-2/50">
          <div className="flex items-center justify-between text-sm text-text-muted">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Zap className="w-4 h-4 text-green-400" />
                {stats.active} Active
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4 text-blue-400" />
                {stats.queued} Queued
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                {stats.completed} Completed
              </span>
            </div>
            <span>Total: {stats.total} downloads</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});

export default DownloadCenter;



