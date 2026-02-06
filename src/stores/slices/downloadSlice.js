/**
 * Download Slice - Manages download queue state
 * Integrates with DownloadManagerV2 backend
 */

export const JobStatus = {
  QUEUED: 'queued',
  SCHEDULED: 'scheduled',
  PREFLIGHT: 'preflight',
  DOWNLOADING: 'downloading',
  VERIFYING: 'verifying',
  INSTALLING: 'installing',
  COMPLETED: 'completed',
  PAUSED: 'paused',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

export const createDownloadSlice = (set, get) => ({
  // State
  downloads: [],
  downloadsLoading: false,
  downloadsInitialized: false,
  downloadsListenersInitialized: false,
  _downloadsListenerUnsubs: [],
  
  // Actions
  initializeDownloads: async () => {
    if (get().downloadsInitialized) return;
    
    set({ downloadsLoading: true });
    
    try {
      // Load existing downloads from backend
      const jobs = await window.electronAPI?.downloadsGetAllV2?.() || [];
      set({ 
        downloads: jobs,
        downloadsInitialized: true,
        downloadsLoading: false,
      });
      
      // Set up event listeners
      get().setupDownloadListeners();
    } catch (error) {
      console.error('[DownloadSlice] Failed to initialize:', error);
      set({ downloadsLoading: false });
    }
  },
  
  setupDownloadListeners: () => {
    const api = window.electronAPI;
    if (!api) return;
    if (get().downloadsListenersInitialized) return;
    
    const unsubs = [];
    
    // Job created
    unsubs.push(api.onDownloadsJobCreated?.((job) => {
      set((state) => ({
        downloads: [job, ...state.downloads],
      }));
    }));
    
    // Job started
    unsubs.push(api.onDownloadsJobStarted?.((job) => {
      set((state) => ({
        downloads: state.downloads.map(d => d.id === job.id ? job : d),
      }));
    }));
    
    // Job progress
    unsubs.push(api.onDownloadsJobProgress?.((job) => {
      set((state) => ({
        downloads: state.downloads.map(d => d.id === job.id ? job : d),
      }));
    }));
    
    // Job completed
    unsubs.push(api.onDownloadsJobCompleted?.((job) => {
      set((state) => ({
        downloads: state.downloads.map(d => d.id === job.id ? job : d),
      }));
    }));
    
    // Job error
    unsubs.push(api.onDownloadsJobError?.((job) => {
      set((state) => ({
        downloads: state.downloads.map(d => d.id === job.id ? job : d),
      }));
    }));
    
    // Job paused
    unsubs.push(api.onDownloadsJobPaused?.((job) => {
      set((state) => ({
        downloads: state.downloads.map(d => d.id === job.id ? job : d),
      }));
    }));
    
    // Job cancelled
    unsubs.push(api.onDownloadsJobCancelled?.((job) => {
      set((state) => ({
        downloads: state.downloads.map(d => d.id === job.id ? job : d),
      }));
    }));
    
    // Persist unsubs so we can tear down if needed
    set({
      downloadsListenersInitialized: true,
      _downloadsListenerUnsubs: unsubs.filter(Boolean),
    });
  },

  teardownDownloadListeners: () => {
    const unsubs = get()._downloadsListenerUnsubs || [];
    unsubs.forEach(fn => {
      try { fn?.(); } catch {}
    });
    set({
      downloadsListenersInitialized: false,
      _downloadsListenerUnsubs: [],
    });
  },
  
  // Create a new download
  createDownload: async (options) => {
    try {
      const result = await window.electronAPI?.downloadsCreate?.(options);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to create download');
      }
      return result.id;
    } catch (error) {
      console.error('[DownloadSlice] Create failed:', error);
      throw error;
    }
  },
  
  // Pause a download
  pauseDownload: async (id) => {
    try {
      const result = await window.electronAPI?.downloadsPause?.(id);
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Pause failed:', error);
      return false;
    }
  },
  
  // Resume a download
  resumeDownload: async (id) => {
    try {
      const result = await window.electronAPI?.downloadsResume?.(id);
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Resume failed:', error);
      return false;
    }
  },
  
  // Retry a failed download
  retryDownload: async (id) => {
    try {
      const result = await window.electronAPI?.downloadsRetry?.(id);
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Retry failed:', error);
      return false;
    }
  },
  
  // Cancel a download
  cancelDownload: async (id) => {
    try {
      const result = await window.electronAPI?.downloadsCancel?.(id);
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Cancel failed:', error);
      return false;
    }
  },
  
  // Delete a download
  deleteDownload: async (id, deleteFiles = false) => {
    try {
      const result = await window.electronAPI?.downloadsDelete?.(id, deleteFiles);
      if (result?.success) {
        set((state) => ({
          downloads: state.downloads.filter(d => d.id !== id),
        }));
      }
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Delete failed:', error);
      return false;
    }
  },
  
  // Set priority
  setDownloadPriority: async (id, priority) => {
    try {
      const result = await window.electronAPI?.downloadsSetPriority?.(id, priority);
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Set priority failed:', error);
      return false;
    }
  },
  
  // Schedule download
  scheduleDownload: async (id, scheduleTime) => {
    try {
      const result = await window.electronAPI?.downloadsSchedule?.(id, scheduleTime);
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Schedule failed:', error);
      return false;
    }
  },
  
  // Clear completed downloads
  clearCompletedDownloads: async () => {
    try {
      const result = await window.electronAPI?.downloadsClearCompleted?.();
      if (result?.success) {
        set((state) => ({
          downloads: state.downloads.filter(d => d.status !== JobStatus.COMPLETED),
        }));
      }
      return result?.success;
    } catch (error) {
      console.error('[DownloadSlice] Clear completed failed:', error);
      return false;
    }
  },
  
  // Selectors
  getActiveDownloads: () => {
    const { downloads } = get();
    return downloads.filter(d => 
      [JobStatus.QUEUED, JobStatus.DOWNLOADING, JobStatus.PREFLIGHT, JobStatus.VERIFYING].includes(d.status)
    );
  },
  
  getPausedDownloads: () => {
    const { downloads } = get();
    return downloads.filter(d => d.status === JobStatus.PAUSED);
  },
  
  getCompletedDownloads: () => {
    const { downloads } = get();
    return downloads.filter(d => d.status === JobStatus.COMPLETED);
  },
  
  getFailedDownloads: () => {
    const { downloads } = get();
    return downloads.filter(d => d.status === JobStatus.ERROR);
  },
  
  getDownloadById: (id) => {
    const { downloads } = get();
    return downloads.find(d => d.id === id);
  },
  
  getDownloadStats: () => {
    const { downloads } = get();
    const active = downloads.filter(d => d.status === JobStatus.DOWNLOADING);
    const totalSpeed = active.reduce((sum, d) => sum + (d.speed || 0), 0);
    
    return {
      total: downloads.length,
      active: active.length,
      paused: downloads.filter(d => d.status === JobStatus.PAUSED).length,
      completed: downloads.filter(d => d.status === JobStatus.COMPLETED).length,
      failed: downloads.filter(d => d.status === JobStatus.ERROR).length,
      queued: downloads.filter(d => d.status === JobStatus.QUEUED).length,
      totalSpeed,
    };
  },
});



