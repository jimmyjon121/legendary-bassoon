import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// Optimized CSS - only essential styles for best performance
import './styles/design-system.css';
import './styles/globals.css';
import { initializeTheme } from './stores/themeStore';
import { initWorkspaceWatcher } from './services/workspaceIntelligence';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
  },
});

// Initialize theme (non-blocking)
initializeTheme();

// Initialize workspace intelligence (hooks into Electron file events)
initWorkspaceWatcher();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
