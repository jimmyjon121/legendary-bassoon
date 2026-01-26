/**
 * ConversionManager - UI for model format conversions
 * 
 * Features:
 * - Convert between model formats
 * - Re-quantize GGUF models
 * - Track conversion progress
 * - View conversion queue
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  RefreshCw,
  Trash2,
  Play,
  XCircle,
  CheckCircle,
  AlertCircle,
  Clock,
  FileCode,
  Cpu,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Settings,
  Info,
} from 'lucide-react';
import { useConversionJobs, useQuantTypes, useConverterActions } from '../../stores/appStore';

// Format file size
const formatFileSize = (bytes) => {
  if (!bytes) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

// Format duration
const formatDuration = (seconds) => {
  if (!seconds) return '--';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

// Status badge component
const StatusBadge = memo(({ status }) => {
  const config = {
    queued: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Queued' },
    running: { icon: RefreshCw, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Converting', animate: true },
    verifying: { icon: RefreshCw, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'Verifying', animate: true },
    completed: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Completed' },
    error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Failed' },
    cancelled: { icon: XCircle, color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Cancelled' },
  };
  
  const { icon: Icon, color, bg, label, animate } = config[status] || config.queued;
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${color}`}>
      <Icon className={`w-3 h-3 ${animate ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
});

// Conversion job card
const ConversionJobCard = memo(({ job, onCancel }) => {
  const [expanded, setExpanded] = useState(false);
  
  const typeLabels = {
    'gguf-requant': 'Re-quantization',
    'safetensors-to-gguf': 'SafeTensors → GGUF',
    'pytorch-to-gguf': 'PyTorch → GGUF',
    'onnx-optimize': 'ONNX Optimization',
    'to-openvino': 'OpenVINO Conversion',
  };
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg overflow-hidden"
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileCode className="w-4 h-4 text-[var(--accent-primary)]" />
              <span className="font-medium text-sm text-[var(--text-primary)] truncate">
                {job.sourcePath?.split(/[/\\]/).pop() || 'Unknown file'}
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {typeLabels[job.type] || job.type}
              {job.options?.quantType && ` → ${job.options.quantType}`}
            </div>
          </div>
          <StatusBadge status={job.status} />
        </div>
        
        {/* Progress bar */}
        {(job.status === 'running' || job.status === 'verifying') && (
          <div className="mb-3">
            <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)]"
                initial={{ width: 0 }}
                animate={{ width: `${job.progress || 0}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-[var(--text-muted)]">
              <span>{job.progress}%</span>
              <span>{job.status === 'verifying' ? 'Verifying checksum...' : 'Converting...'}</span>
            </div>
          </div>
        )}
        
        {/* Error message */}
        {job.status === 'error' && job.error && (
          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
            {job.error}
          </div>
        )}
        
        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center gap-1"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Details
          </button>
          
          {(job.status === 'queued' || job.status === 'running') && (
            <button
              onClick={() => onCancel(job.id)}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <XCircle className="w-3 h-3" />
              Cancel
            </button>
          )}
        </div>
        
        {/* Expanded details */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-[var(--border-dim)] space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Source</span>
                  <span className="text-[var(--text-secondary)] truncate max-w-[200px]" title={job.sourcePath}>
                    {job.sourcePath}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Output</span>
                  <span className="text-[var(--text-secondary)] truncate max-w-[200px]" title={job.outputPath}>
                    {job.outputPath}
                  </span>
                </div>
                {job.startedAt && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Started</span>
                    <span className="text-[var(--text-secondary)]">
                      {new Date(job.startedAt).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                {job.completedAt && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Completed</span>
                    <span className="text-[var(--text-secondary)]">
                      {new Date(job.completedAt).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                
                {/* Logs preview */}
                {job.logs && job.logs.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[var(--text-muted)] mb-1">Logs</div>
                    <div className="bg-[var(--bg-tertiary)] rounded p-2 max-h-32 overflow-y-auto font-mono text-[10px] text-[var(--text-muted)]">
                      {job.logs.slice(-10).map((log, i) => (
                        <div key={i} className="whitespace-pre-wrap">{log}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

// New conversion form
const NewConversionForm = memo(({ onSubmit, quantTypes, onCancel }) => {
  const [filePath, setFilePath] = useState('');
  const [conversionType, setConversionType] = useState('');
  const [quantType, setQuantType] = useState('Q4_K_M');
  const [supportedConversions, setSupportedConversions] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const { getSupportedConversions } = useConverterActions();
  
  const handleFileSelect = async () => {
    try {
      const result = await window.electronAPI?.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Model Files', extensions: ['gguf', 'safetensors', 'bin', 'pt', 'pth', 'onnx'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result && !result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        setFilePath(selectedPath);
        
        // Get supported conversions
        setLoading(true);
        const conversions = await getSupportedConversions(selectedPath);
        if (conversions && !conversions.error) {
          setSupportedConversions(conversions);
          if (conversions.length > 0) {
            setConversionType(conversions[0].type);
          }
        }
        setLoading(false);
      }
    } catch (error) {
      console.error('File selection error:', error);
    }
  };
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!filePath || !conversionType) return;
    
    const options = {};
    if (quantType) options.quantType = quantType;
    
    onSubmit(conversionType, filePath, options);
  };
  
  const selectedConversion = supportedConversions.find(c => c.type === conversionType);
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* File selection */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
          Source Model
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={filePath}
            readOnly
            placeholder="Select a model file..."
            className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-dim)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />
          <button
            type="button"
            onClick={handleFileSelect}
            className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-lg text-sm font-medium transition-colors"
          >
            Browse
          </button>
        </div>
      </div>
      
      {/* Conversion type */}
      {supportedConversions.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Conversion Type
          </label>
          <div className="grid gap-2">
            {supportedConversions.map((conv) => (
              <label
                key={conv.type}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  conversionType === conv.type
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                    : 'border-[var(--border-dim)] bg-[var(--bg-tertiary)] hover:border-[var(--border)]'
                } ${!conv.available ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="conversionType"
                  value={conv.type}
                  checked={conversionType === conv.type}
                  onChange={(e) => setConversionType(e.target.value)}
                  disabled={!conv.available}
                  className="hidden"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm text-[var(--text-primary)]">
                    {conv.name}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {conv.description}
                  </div>
                </div>
                {!conv.available && (
                  <span className="text-xs text-amber-400">Tool not found</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
      
      {/* Quantization type */}
      {selectedConversion?.options?.quantTypes && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Target Quantization
          </label>
          <select
            value={quantType}
            onChange={(e) => setQuantType(e.target.value)}
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-dim)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {selectedConversion.options.quantTypes.map((qt) => (
              <option key={qt} value={qt}>{qt}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Lower quantization = smaller file, faster inference, lower quality
          </p>
        </div>
      )}
      
      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Analyzing file...
        </div>
      )}
      
      {/* No conversions available */}
      {filePath && !loading && supportedConversions.length === 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-400">
          No conversions available for this file type.
        </div>
      )}
      
      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!filePath || !conversionType || loading || !selectedConversion?.available}
          className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Play className="w-4 h-4" />
          Start Conversion
        </button>
      </div>
    </form>
  );
});

// Main component
export const ConversionManager = memo(({ isOpen, onClose }) => {
  const [showNewForm, setShowNewForm] = useState(false);
  const jobs = useConversionJobs();
  const quantTypes = useQuantTypes();
  const {
    fetchConversionJobs,
    fetchQuantTypes,
    createConversionJob,
    cancelConversionJob,
    clearCompletedJobs,
    setupConverterListeners,
  } = useConverterActions();
  
  // Initialize on mount
  useEffect(() => {
    if (isOpen) {
      fetchConversionJobs();
      fetchQuantTypes();
    }
  }, [isOpen, fetchConversionJobs, fetchQuantTypes]);
  
  // Setup event listeners
  useEffect(() => {
    const cleanup = setupConverterListeners();
    return cleanup;
  }, [setupConverterListeners]);
  
  // Stats
  const stats = useMemo(() => {
    return {
      total: jobs.length,
      active: jobs.filter(j => j.status === 'running' || j.status === 'queued').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'error').length,
    };
  }, [jobs]);
  
  // Handle new conversion
  const handleNewConversion = useCallback(async (type, sourcePath, options) => {
    await createConversionJob(type, sourcePath, options);
    setShowNewForm(false);
  }, [createConversionJob]);
  
  if (!isOpen) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-2xl max-h-[80vh] bg-[var(--bg-primary)] border border-[var(--border-dim)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--border-dim)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--accent-primary)]/10 rounded-lg">
              <Sparkles className="w-5 h-5 text-[var(--accent-primary)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Model Converter
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Convert and re-quantize model formats
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>
        
        {/* Stats bar */}
        <div className="px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-dim)] flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[var(--text-muted)]">
              Total: <span className="text-[var(--text-primary)] font-medium">{stats.total}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              Active: <span className="text-blue-400 font-medium">{stats.active}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              Completed: <span className="text-emerald-400 font-medium">{stats.completed}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              Failed: <span className="text-red-400 font-medium">{stats.failed}</span>
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {stats.completed > 0 && (
              <button
                onClick={clearCompletedJobs}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Clear completed
              </button>
            )}
            <button
              onClick={() => setShowNewForm(true)}
              className="px-3 py-1.5 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
            >
              <Play className="w-3 h-3" />
              New Conversion
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {showNewForm ? (
            <NewConversionForm
              onSubmit={handleNewConversion}
              quantTypes={quantTypes}
              onCancel={() => setShowNewForm(false)}
            />
          ) : (
            <>
              {jobs.length === 0 ? (
                <div className="text-center py-12">
                  <FileCode className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                    No conversions yet
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">
                    Convert model formats, re-quantize GGUF models, or optimize for specific hardware.
                  </p>
                  <button
                    onClick={() => setShowNewForm(true)}
                    className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Start New Conversion
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {jobs.map((job) => (
                      <ConversionJobCard
                        key={job.id}
                        job={job}
                        onCancel={cancelConversionJob}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Footer info */}
        <div className="p-3 border-t border-[var(--border-dim)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Info className="w-3 h-3" />
            <span>
              Conversions require llama.cpp or Python with appropriate libraries installed.
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});

export default ConversionManager;



