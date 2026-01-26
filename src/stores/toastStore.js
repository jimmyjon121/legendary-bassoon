import { create } from 'zustand';

let toastId = 0;

export const useToastStore = create((set, get) => ({
  toasts: [],
  
  // Add a toast notification
  addToast: ({ 
    type = 'info', // 'success' | 'error' | 'warning' | 'info' | 'loading'
    title, 
    message, 
    duration = 4000,
    action = null, // { label: string, onClick: () => void }
    icon = null,
    persist = false, // Don't auto-dismiss
  }) => {
    const id = ++toastId;
    const toast = {
      id,
      type,
      title,
      message,
      action,
      icon,
      persist,
      createdAt: Date.now(),
    };
    
    set(state => ({ toasts: [...state.toasts, toast] }));
    
    // Auto-dismiss if not persistent
    if (!persist && type !== 'loading') {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
    
    return id;
  },
  
  // Convenience methods
  success: (title, message, options = {}) => 
    get().addToast({ type: 'success', title, message, ...options }),
    
  error: (title, message, options = {}) => 
    get().addToast({ type: 'error', title, message, duration: 6000, ...options }),
    
  warning: (title, message, options = {}) => 
    get().addToast({ type: 'warning', title, message, ...options }),
    
  info: (title, message, options = {}) => 
    get().addToast({ type: 'info', title, message, ...options }),
    
  loading: (title, message, options = {}) => 
    get().addToast({ type: 'loading', title, message, persist: true, ...options }),
  
  // Update an existing toast (useful for loading -> success flow)
  updateToast: (id, updates) => {
    set(state => ({
      toasts: state.toasts.map(t => 
        t.id === id ? { ...t, ...updates } : t
      )
    }));
    
    // If changing from loading to another type, auto-dismiss
    const toast = get().toasts.find(t => t.id === id);
    if (toast && updates.type && updates.type !== 'loading') {
      setTimeout(() => {
        get().removeToast(id);
      }, updates.duration || 4000);
    }
  },
  
  // Remove a toast
  removeToast: (id) => {
    set(state => ({
      toasts: state.toasts.filter(t => t.id !== id)
    }));
  },
  
  // Clear all toasts
  clearAll: () => set({ toasts: [] }),
}));

// Export a hook for easier usage
export const useToast = () => {
  const store = useToastStore();
  return {
    success: store.success,
    error: store.error,
    warning: store.warning,
    info: store.info,
    loading: store.loading,
    update: store.updateToast,
    dismiss: store.removeToast,
    dismissAll: store.clearAll,
  };
};






