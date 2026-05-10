import React from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      errorCount: 0
    };
  }

  isDynamicImportError = (error) => {
    const message = error?.message || '';
    return (
      message.includes('Failed to fetch dynamically imported module') ||
      message.includes('Importing a module script failed') ||
      message.includes('ChunkLoadError')
    );
  };

  tryRecoverChunkError = () => {
    try {
      const reloadKey = 'devforge:chunk-reload-once';
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, '1');
        window.location.reload();
        return true;
      }
    } catch (e) {
      // Ignore storage access failures and continue with normal fallback UI.
    }
    return false;
  };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState(prev => ({
      errorInfo,
      errorCount: prev.errorCount + 1
    }));

    // Log error to console and optionally to a file
    console.error('DevForge Error Boundary caught an error:', error, errorInfo);
    
    // Try to save error to electron for crash reporting
    if (window.electronAPI?.logError) {
      window.electronAPI.logError({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString()
      });
    }

    if (this.isDynamicImportError(error)) {
      this.tryRecoverChunkError();
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    if (this.isDynamicImportError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Reset to default state
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      const { level = 'page', scope } = this.props;
      const isChunkError = this.isDynamicImportError(this.state.error);
      
      // Compact error display for component-level errors
      if (level === 'component') {
        return (
          <div className="p-4 bg-status-error/10 border border-status-error/30 rounded-lg">
            <div className="flex items-center gap-2 text-status-error mb-2">
              <AlertTriangle size={16} />
              <span className="font-medium">{scope || 'Component'} Error</span>
            </div>
            <p className="text-sm text-text-muted mb-3">
              {isChunkError
                ? 'A UI module changed while the app was running. Reload to sync with the latest build.'
                : (this.state.error?.message || 'Something went wrong')}
            </p>
            <button
              onClick={this.handleReset}
              className="text-sm text-workspace-casual hover:underline"
            >
              {isChunkError ? 'Reload app' : 'Try again'}
            </button>
          </div>
        );
      }

      // Full page error display
      return (
        <div className="fixed inset-0 bg-forge-bg flex items-center justify-center p-8">
          <div className="max-w-lg w-full">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-status-error/20 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-status-error" />
              </div>
            </div>

            {/* Error Title */}
            <h1 className="text-2xl font-bold text-text-primary text-center mb-2">
              Something went wrong
            </h1>
            <p className="text-text-muted text-center mb-6">
              Anvil encountered an unexpected error. Your data is safe.
            </p>

            {/* Error Details (collapsible) */}
            <details className="mb-6 bg-forge-surface border border-forge-border rounded-lg overflow-hidden">
              <summary className="px-4 py-3 cursor-pointer text-sm text-text-secondary hover:bg-forge-hover flex items-center gap-2">
                <Bug size={14} />
                Technical Details
              </summary>
              <div className="px-4 py-3 border-t border-forge-border bg-forge-bg">
                <pre className="text-xs text-status-error overflow-auto max-h-40 font-mono">
                  {this.state.error?.message}
                  {'\n\n'}
                  {this.state.error?.stack}
                </pre>
              </div>
            </details>

            {/* Recovery Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={this.handleReset}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-workspace-casual text-white rounded-lg hover:bg-workspace-casual/90 transition-colors"
              >
                <RefreshCw size={18} />
                Try Again
              </button>
              
              <button
                onClick={this.handleReload}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-forge-elevated border border-forge-border text-text-primary rounded-lg hover:bg-forge-hover transition-colors"
              >
                <RefreshCw size={18} />
                Reload Application
              </button>

              <button
                onClick={this.handleGoHome}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-text-secondary hover:text-text-primary transition-colors"
              >
                <Home size={18} />
                Go to Home
              </button>
            </div>

            {/* Error Count Warning */}
            {this.state.errorCount > 2 && (
              <div className="mt-6 p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg">
                <p className="text-sm text-status-warning">
                  Multiple errors detected. If this keeps happening, try:
                </p>
                <ul className="text-sm text-text-muted mt-2 list-disc list-inside">
                  <li>Clearing the app cache (Settings → Privacy)</li>
                  <li>Restarting Ollama</li>
                  <li>Checking for app updates</li>
                </ul>
              </div>
            )}

            {/* Version Info */}
            <p className="text-center text-xs text-text-muted mt-6">
              Anvil • Report issues at github.com/anvilapp/issues
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
export default ErrorBoundary;
