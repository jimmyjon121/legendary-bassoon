import { create } from 'zustand';

/**
 * Global progress store for tracking long-running operations
 * across the entire application.
 */
export const useProgressStore = create((set, get) => ({
  // Active operations: { [id]: { type, label, progress, message, startedAt, ... } }
  operations: {},

  // Start tracking a new operation
  startOperation: (id, { type = 'generic', label = 'Processing...', message = '' }) => {
    set((state) => ({
      operations: {
        ...state.operations,
        [id]: {
          id,
          type,
          label,
          message,
          progress: 0,
          startedAt: Date.now(),
          status: 'running',
        },
      },
    }));
  },

  // Update operation progress
  updateOperation: (id, { progress, message, status }) => {
    set((state) => {
      const op = state.operations[id];
      if (!op) return state;

      return {
        operations: {
          ...state.operations,
          [id]: {
            ...op,
            progress: progress ?? op.progress,
            message: message ?? op.message,
            status: status ?? op.status,
          },
        },
      };
    });
  },

  // Complete an operation
  completeOperation: (id, { message = 'Complete!', success = true } = {}) => {
    set((state) => {
      const op = state.operations[id];
      if (!op) return state;

      return {
        operations: {
          ...state.operations,
          [id]: {
            ...op,
            progress: 100,
            message,
            status: success ? 'complete' : 'error',
            completedAt: Date.now(),
          },
        },
      };
    });

    // Auto-remove after 5 seconds
    setTimeout(() => {
      get().removeOperation(id);
    }, 5000);
  },

  // Remove an operation from tracking
  removeOperation: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.operations;
      return { operations: rest };
    });
  },

  // Clear all operations
  clearAll: () => {
    set({ operations: {} });
  },

  // Get active operations count
  getActiveCount: () => {
    const ops = get().operations;
    return Object.values(ops).filter((op) => op.status === 'running').length;
  },

  // Check if any operation is running
  hasActiveOperations: () => {
    return get().getActiveCount() > 0;
  },
}));

export default useProgressStore;













