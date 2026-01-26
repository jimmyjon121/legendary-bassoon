import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  X,
  Search,
  Loader,
  AlertCircle,
  CheckCircle2,
  PauseCircle,
  Globe,
  Link as LinkIcon,
} from 'lucide-react';

const SOURCE_TABS = [
  { id: 'ollama', label: 'Ollama Library' },
  { id: 'huggingface', label: 'HuggingFace' },
  { id: 'custom', label: 'Direct URL' },
];

const HF_EXTENSIONS = ['.gguf', '.safetensors', '.onnx', '.bin', '.pt', '.pth', '.zip'];

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return 'Unknown size';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

function parseRepoInput(input) {
  if (!input) return { repo: '', revision: 'main' };
  const trimmed = input.trim();
  try {
    if (trimmed.startsWith('http')) {
      const url = new URL(trimmed);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const repo = `${segments[0]}/${segments[1]}`;
        let revision = 'main';
        if (segments[2] === 'resolve' && segments[3]) {
          revision = segments[3];
        }
        if (url.searchParams.get('revision')) {
          revision = url.searchParams.get('revision');
        }
        return { repo, revision };
      }
    }
  } catch {
    // ignore parsing errors
  }
  return { repo: trimmed, revision: 'main' };
}

export function ModelBrowser({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('ollama');
  const [remoteModels, setRemoteModels] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [hfRepoInput, setHfRepoInput] = useState('');
  const [hfRepo, setHfRepo] = useState('');
  const [hfBranchInput, setHfBranchInput] = useState('main');
  const [hfBranch, setHfBranch] = useState('main');
  const [hfInfo, setHfInfo] = useState(null);
  const [hfFiles, setHfFiles] = useState([]);
  const [hfLoading, setHfLoading] = useState(false);
  const [hfError, setHfError] = useState(null);

  const [customUrl, setCustomUrl] = useState('');
  const [customFileName, setCustomFileName] = useState('');
  const [customStatus, setCustomStatus] = useState(null);
  const [customError, setCustomError] = useState(null);
  const [customChecksum, setCustomChecksum] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    loadDownloads();
    const interval = setInterval(loadDownloads, 5000); // Lite mode: Poll less frequently
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'ollama') return;
    loadModels();
  }, [isOpen, activeTab]);

  const loadModels = async () => {
    if (!window.electronAPI?.browseRemoteModels) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.browseRemoteModels();
      const list = res?.models || [];
      setRemoteModels(list);
    } catch (err) {
      console.error('Failed to load remote models:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadDownloads = async () => {
    if (!window.electronAPI?.getModelDownloads) return;
    try {
      const list = await window.electronAPI.getModelDownloads();
      setDownloads(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load download progress:', err);
    }
  };

  const startDownload = async (payload) => {
    if (!window.electronAPI?.startModelDownload) return;
    try {
      const res = await window.electronAPI.startModelDownload(payload);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to start download');
      }
      await loadDownloads();
      setCustomStatus(payload.type === 'url' ? 'Download started' : null);
    } catch (err) {
      console.error('Failed to start download:', err);
      if (payload.type === 'url') {
        setCustomError(err.message || String(err));
      } else if (payload.type === 'huggingface') {
        setHfError(err.message || String(err));
      } else {
        setError(err.message || String(err));
      }
    }
  };

  const cancelDownload = async (id) => {
    if (!window.electronAPI?.cancelModelDownload) return;
    try {
      await window.electronAPI.cancelModelDownload(id);
      await loadDownloads();
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
  };

  const handleHfLookup = async () => {
    if (!hfRepoInput.trim()) {
      setHfError('Enter a HuggingFace repo, e.g. TheBloke/Llama-2-7B-GGUF');
      return;
    }
    if (!window.electronAPI?.lookupHfRepo) return;
    const parsed = parseRepoInput(hfRepoInput);
    const revisionInput = hfBranchInput?.trim() || parsed.revision || 'main';
    setHfLoading(true);
    setHfError(null);
    setHfInfo(null);
    setHfFiles([]);
    try {
      const res = await window.electronAPI.lookupHfRepo({
        repo: parsed.repo,
        revision: revisionInput,
      });
      setHfBranchInput(revisionInput);
      if (!res?.success) {
        throw new Error(res?.error || 'Lookup failed');
      }
      setHfRepo(res.repo);
      setHfBranch(res.revision || revisionInput);
      setHfInfo(res);
      setHfFiles(res.files || []);
    } catch (err) {
      console.error('Failed to fetch HuggingFace repo:', err);
      setHfError(err.message || String(err));
    } finally {
      setHfLoading(false);
    }
  };

  const handleCustomDownload = async () => {
    setCustomError(null);
    setCustomStatus(null);
    if (!customUrl.trim()) {
      setCustomError('Enter a valid download URL');
      return;
    }
    await startDownload({
      type: 'url',
      url: customUrl.trim(),
      fileName: customFileName.trim() || undefined,
      checksum: customChecksum.trim() || undefined,
      checksumAlgorithm: customChecksum.trim() ? 'sha256' : undefined,
    });
  };

  const filteredModels = remoteModels.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (m.name || '').toLowerCase();
    const details = (m.details || '').toLowerCase();
    return name.includes(q) || details.includes(q);
  });

  const getOllamaDownload = (name) =>
    downloads.find((d) => d.name === name && d.type === 'ollama' && d.status !== 'completed');

  const getHfDownload = (repo, file, revision) =>
    downloads.find(
      (d) =>
        d.type === 'huggingface' &&
        d.metadata?.repo === repo &&
        d.metadata?.file === file &&
        (revision ? d.metadata?.revision === revision : true) &&
        d.status !== 'completed',
    );

  const getCustomDownload = (url) =>
    downloads.find(
      (d) => d.type === 'url' && d.metadata?.url === url && d.status !== 'completed',
    );

  const filteredHfFiles = useMemo(() => {
    if (!hfFiles || hfFiles.length === 0) return [];
    return hfFiles.filter((file) => {
      const name = (file.rfilename || '').toLowerCase();
      return HF_EXTENSIONS.some((ext) => name.endsWith(ext));
    });
  }, [hfFiles]);

  if (!isOpen) return null;

  const renderDownloadState = (record) => {
    if (!record) return null;
    if (record.status === 'downloading') {
      return (
        <div className="flex items-center gap-2 text-xs">
          <Loader className="w-4 h-4 animate-spin text-workspace-casual" />
          <span className="text-text-secondary">
            Downloading… {record.progress != null ? `${record.progress}%` : ''}
          </span>
          <button
            type="button"
            onClick={() => cancelDownload(record.id)}
            className="text-xs text-text-muted hover:text-text-secondary flex items-center gap-1"
          >
            <PauseCircle className="w-4 h-4" />
            Cancel
          </button>
        </div>
      );
    }
    if (record.status === 'completed') {
      return (
        <div className="flex items-center gap-2 text-xs text-status-success">
          <CheckCircle2 className="w-4 h-4" />
          <span>Installed</span>
        </div>
      );
    }
    if (record.status === 'error') {
      return <span className="text-xs text-status-error">Error: {record.error}</span>;
    }
    if (record.status === 'cancelled') {
      return <span className="text-xs text-text-muted">Cancelled</span>;
    }
    return null;
  };

  const renderOllamaContent = () => (
    <>
      <div className="p-4 border-b border-forge-border flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models by name or description…"
            className="input pl-9 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={loadModels}
          disabled={loading}
          className="btn btn-secondary text-xs"
        >
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Refresh'}
        </button>
      </div>

      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-status-error/10 border border-status-error/40 text-xs text-status-error">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>
              <div className="font-medium mb-1">Unable to reach Ollama</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-6 h-6 animate-spin text-workspace-casual" />
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="text-center py-12 text-sm text-text-muted">
            No models found. Make sure your Ollama server is running and reachable.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredModels.map((m) => {
              const active = getOllamaDownload(m.name);
              return (
                <div
                  key={m.name}
                  className="flex items-center justify-between p-3 border border-forge-border rounded-lg bg-forge-bg"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{m.name}</span>
                      {m.size && (
                        <span className="text-xs text-text-muted">
                          {Math.round((m.size / (1024 * 1024)) * 10) / 10} MB
                        </span>
                      )}
                    </div>
                    {m.details && (
                      <p className="text-xs text-text-muted mt-1 line-clamp-2">{m.details}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {active ? (
                      renderDownloadState(active)
                    ) : (
                      <button
                        type="button"
                        onClick={() => startDownload({ type: 'ollama', name: m.name })}
                        className="btn btn-primary text-xs"
                      >
                        <Download className="w-4 h-4" />
                        Install
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  const renderHuggingFaceContent = () => (
    <div className="space-y-4">
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-end sm:gap-3">
        <div className="flex-1">
          <label className="text-xs text-text-muted mb-1 inline-block">Repository or URL</label>
          <div className="relative">
            <Globe className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={hfRepoInput}
              onChange={(e) => setHfRepoInput(e.target.value)}
              placeholder="e.g. TheBloke/Llama-2-7B-GGUF or full HF URL"
              className="input pl-9"
            />
          </div>
        </div>
        <div className="w-full sm:w-auto">
          <label className="text-xs text-text-muted mb-1 inline-block">Branch / Revision</label>
          <input
            type="text"
            value={hfBranchInput}
            onChange={(e) => setHfBranchInput(e.target.value)}
            placeholder="main"
            className="input"
          />
        </div>
        <button
          type="button"
          onClick={handleHfLookup}
          disabled={hfLoading}
          className="btn btn-secondary text-xs whitespace-nowrap"
        >
          {hfLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Lookup'}
        </button>
      </div>

      {hfError && (
        <div className="flex items-start gap-2 p-3 rounded bg-status-error/10 border border-status-error/40 text-xs text-status-error">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <div>{hfError}</div>
        </div>
      )}

      {hfInfo && (
        <div className="p-3 rounded border border-forge-border text-xs text-text-muted flex flex-wrap gap-3">
          <span>Repo: {hfInfo.repo}</span>
          <span>Branch: {hfBranch}</span>
          {hfInfo.pipeline && <span>Pipeline: {hfInfo.pipeline}</span>}
          {hfInfo.downloads != null && <span>Downloads: {hfInfo.downloads}</span>}
          {hfInfo.likes != null && <span>Likes: {hfInfo.likes}</span>}
        </div>
      )}

      {hfLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader className="w-6 h-6 animate-spin text-workspace-casual" />
        </div>
      ) : hfFiles.length === 0 ? (
        <div className="text-center py-10 text-sm text-text-muted">
          Enter a HuggingFace repository to list downloadable files.
        </div>
      ) : filteredHfFiles.length === 0 ? (
        <div className="text-center py-10 text-sm text-text-muted">
          No supported model files found in this repo. Try another branch or repo.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHfFiles.map((file) => {
            const active = getHfDownload(hfRepo, file.rfilename, hfBranch);
            return (
              <div
                key={file.rfilename}
                className="p-3 border border-forge-border rounded-lg bg-forge-bg flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm text-text-primary truncate">{file.rfilename}</div>
                  <div className="text-xs text-text-muted">
                    {formatBytes(file.size)} {file.sha ? `• ${file.sha.slice(0, 8)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {active ? (
                    renderDownloadState(active)
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        startDownload({
                          type: 'huggingface',
                          repo: hfRepo,
                          file: file.rfilename,
                          revision: hfBranch,
                        })
                      }
                      className="btn btn-primary text-xs"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderCustomContent = () => {
    const active = customUrl ? getCustomDownload(customUrl.trim()) : null;
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs text-text-muted">Direct download URL</label>
          <div className="relative">
            <LinkIcon className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://example.com/path/to/model.gguf"
              className="input pl-9"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs text-text-muted">File name (optional)</label>
            <input
              type="text"
              value={customFileName}
              onChange={(e) => setCustomFileName(e.target.value)}
              placeholder="model.gguf"
              className="input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-text-muted">
              Expected SHA256 checksum (optional)
            </label>
            <input
              type="text"
              value={customChecksum}
              onChange={(e) => setCustomChecksum(e.target.value)}
              placeholder="abcdef1234..."
              className="input font-mono text-xs"
            />
          </div>
        </div>
        <button type="button" onClick={handleCustomDownload} className="btn btn-primary text-xs">
          <Download className="w-4 h-4" />
          Download to library
        </button>
        {customError && (
          <div className="text-xs text-status-error bg-status-error/10 border border-status-error/30 rounded p-2">
            {customError}
          </div>
        )}
        {customStatus && (
          <div className="text-xs text-status-success bg-status-success/10 border border-status-success/30 rounded p-2">
            {customStatus}
          </div>
        )}
        {active && renderDownloadState(active)}
      </div>
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-3xl max-h-[80vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-workspace-casual/20">
                <Download className="w-5 h-5 text-workspace-casual" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Model Browser</h2>
                <p className="text-xs text-text-muted">
                  Discover models from Ollama, HuggingFace, or any direct URL.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Source tabs */}
          <div className="px-4 pt-3 border-b border-forge-border flex items-center gap-2">
            {SOURCE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-workspace-casual text-white'
                    : 'bg-forge-elevated text-text-muted hover:text-text-secondary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'ollama' && renderOllamaContent()}
            {activeTab === 'huggingface' && renderHuggingFaceContent()}
            {activeTab === 'custom' && renderCustomContent()}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default ModelBrowser;
