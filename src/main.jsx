import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// Optimized CSS - only essential styles for best performance
import './styles/design-system.css';
import './styles/globals.css';
import { initializeTheme } from './stores/themeStore';
import { initWorkspaceWatcher } from './services/workspaceIntelligence';

// Render a visible fallback if React bootstrap fails. Without this the
// window stays blank forever because ready-to-show never fires, and the
// user has no visible way to see what went wrong. This also makes global
// unhandled errors and promise rejections surface in the main terminal
// via the Electron console-message forwarder.
function renderBootstrapError(error) {
  const stack = (error && (error.stack || error.message)) || String(error);
  console.error('[DevForge] Renderer bootstrap failed:', error);
  try {
    const root = document.getElementById('root');
    if (root) {
      root.innerHTML = `
        <div style="
          min-height: 100vh;
          padding: 40px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          color: #f8f8fc;
          background: #000;
          line-height: 1.5;
          overflow: auto;
        ">
          <h1 style="color:#f87171; margin:0 0 16px; font-size:20px;">DevForge failed to start</h1>
          <p style="color:#a0a0b0; margin:0 0 24px;">
            The UI crashed during startup. The error is below. Copy it and share with the assistant
            or paste into the console (F12) for more detail.
          </p>
          <pre style="
            background: #0f0f16;
            border: 1px solid #2a2a35;
            border-radius: 8px;
            padding: 16px;
            white-space: pre-wrap;
            word-break: break-word;
            color: #fca5a5;
            font-size: 12px;
            max-height: 60vh;
            overflow: auto;
          ">${stack.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>
          <p style="color:#6b6b7b; margin-top:20px; font-size:12px;">
            Use the Restart button once you've fixed the error, or close this window and relaunch.
          </p>
        </div>
      `;
    }
  } catch (fallbackErr) {
    console.error('[DevForge] Even the fallback failed:', fallbackErr);
  }
}

window.addEventListener('error', (event) => {
  console.error('[DevForge] Uncaught renderer error:', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[DevForge] Unhandled promise rejection:', event.reason);
});

try {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30000,
      },
    },
  });

  initializeTheme();
  initWorkspaceWatcher();

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
} catch (error) {
  renderBootstrapError(error);
}
