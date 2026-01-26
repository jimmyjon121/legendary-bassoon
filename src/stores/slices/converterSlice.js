/**
 * Converter Slice - Zustand state slice for model format conversions
 * 
 * Manages:
 * - Conversion jobs queue
 * - Job progress tracking
 * - Available conversion types
 * - Quantization options
 */

export const createConverterSlice = (set, get) => ({
  // State
  conversionJobs: [],
  supportedConversions: {},
  quantTypes: [],
  isLoadingConversions: false,
  
  // Actions
  
  /**
   * Fetch all conversion jobs
   */
  fetchConversionJobs: async () => {
    try {
      const jobs = await window.electronAPI?.converterGetAllJobs?.();
      if (jobs && !jobs.error) {
        set({ conversionJobs: jobs });
      }
      return jobs;
    } catch (error) {
      console.error('[ConverterSlice] Failed to fetch jobs:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Get supported conversions for a file
   */
  getSupportedConversions: async (filePath) => {
    set({ isLoadingConversions: true });
    try {
      const conversions = await window.electronAPI?.converterGetSupportedConversions?.(filePath);
      if (conversions && !conversions.error) {
        set((state) => ({
          supportedConversions: {
            ...state.supportedConversions,
            [filePath]: conversions,
          },
        }));
      }
      return conversions;
    } catch (error) {
      console.error('[ConverterSlice] Failed to get supported conversions:', error);
      return { error: error.message };
    } finally {
      set({ isLoadingConversions: false });
    }
  },
  
  /**
   * Create a conversion job
   */
  createConversionJob: async (type, sourcePath, options = {}) => {
    try {
      const jobId = await window.electronAPI?.converterCreateJob?.(type, sourcePath, options);
      if (jobId && !jobId.error) {
        // Job will be added via event listener
        return { success: true, jobId };
      }
      return jobId;
    } catch (error) {
      console.error('[ConverterSlice] Failed to create job:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Cancel a conversion job
   */
  cancelConversionJob: async (jobId) => {
    try {
      const result = await window.electronAPI?.converterCancelJob?.(jobId);
      return result;
    } catch (error) {
      console.error('[ConverterSlice] Failed to cancel job:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Clear completed jobs
   */
  clearCompletedJobs: async () => {
    try {
      await window.electronAPI?.converterClearCompleted?.();
      // Refresh jobs list
      get().fetchConversionJobs();
      return { success: true };
    } catch (error) {
      console.error('[ConverterSlice] Failed to clear completed jobs:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Get available quantization types
   */
  fetchQuantTypes: async () => {
    try {
      const types = await window.electronAPI?.converterGetQuantTypes?.();
      if (types && !types.error) {
        set({ quantTypes: types });
      }
      return types;
    } catch (error) {
      console.error('[ConverterSlice] Failed to fetch quant types:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Estimate conversion time
   */
  estimateConversionTime: async (sourcePath, type, options = {}) => {
    try {
      const estimate = await window.electronAPI?.converterEstimateTime?.(sourcePath, type, options);
      return estimate;
    } catch (error) {
      console.error('[ConverterSlice] Failed to estimate time:', error);
      return null;
    }
  },
  
  /**
   * Handle job created event
   */
  handleJobCreated: (job) => {
    set((state) => ({
      conversionJobs: [job, ...state.conversionJobs],
    }));
  },
  
  /**
   * Handle job started event
   */
  handleJobStarted: (job) => {
    set((state) => ({
      conversionJobs: state.conversionJobs.map((j) =>
        j.id === job.id ? { ...j, ...job } : j
      ),
    }));
  },
  
  /**
   * Handle job progress event
   */
  handleJobProgress: (job) => {
    set((state) => ({
      conversionJobs: state.conversionJobs.map((j) =>
        j.id === job.id ? { ...j, progress: job.progress, logs: job.logs } : j
      ),
    }));
  },
  
  /**
   * Handle job completed event
   */
  handleJobCompleted: (job) => {
    set((state) => ({
      conversionJobs: state.conversionJobs.map((j) =>
        j.id === job.id ? { ...j, ...job } : j
      ),
    }));
  },
  
  /**
   * Handle job error event
   */
  handleJobError: (job) => {
    set((state) => ({
      conversionJobs: state.conversionJobs.map((j) =>
        j.id === job.id ? { ...j, ...job } : j
      ),
    }));
  },
  
  /**
   * Handle job cancelled event
   */
  handleJobCancelled: (job) => {
    set((state) => ({
      conversionJobs: state.conversionJobs.map((j) =>
        j.id === job.id ? { ...j, ...job } : j
      ),
    }));
  },
  
  /**
   * Setup event listeners for converter
   */
  setupConverterListeners: () => {
    const state = get();
    const cleanups = [];
    
    if (window.electronAPI?.onConverterJobCreated) {
      cleanups.push(window.electronAPI.onConverterJobCreated(state.handleJobCreated));
    }
    if (window.electronAPI?.onConverterJobStarted) {
      cleanups.push(window.electronAPI.onConverterJobStarted(state.handleJobStarted));
    }
    if (window.electronAPI?.onConverterJobProgress) {
      cleanups.push(window.electronAPI.onConverterJobProgress(state.handleJobProgress));
    }
    if (window.electronAPI?.onConverterJobCompleted) {
      cleanups.push(window.electronAPI.onConverterJobCompleted(state.handleJobCompleted));
    }
    if (window.electronAPI?.onConverterJobError) {
      cleanups.push(window.electronAPI.onConverterJobError(state.handleJobError));
    }
    if (window.electronAPI?.onConverterJobCancelled) {
      cleanups.push(window.electronAPI.onConverterJobCancelled(state.handleJobCancelled));
    }
    
    // Return cleanup function
    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  },
});

// Selectors
export const selectConversionJobs = (state) => state.conversionJobs;
export const selectActiveConversions = (state) => 
  state.conversionJobs.filter((j) => j.status === 'running' || j.status === 'queued');
export const selectCompletedConversions = (state) => 
  state.conversionJobs.filter((j) => j.status === 'completed');
export const selectFailedConversions = (state) => 
  state.conversionJobs.filter((j) => j.status === 'error');
export const selectQuantTypes = (state) => state.quantTypes;
export const selectSupportedConversions = (state) => state.supportedConversions;



