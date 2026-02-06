import React, { memo, useMemo, useCallback } from 'react';
import {
  AlertTriangle, WifiOff, Server, RefreshCw, Download,
  ArrowRight, Cpu, HardDrive, Zap, ExternalLink
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/**
 * ChatErrorBanner - Contextual error banner with guided recovery actions.
 * 
 * Shows different messages and actions based on the error type:
 * - Ollama offline → offer to start Ollama, link to install guide
 * - No models → offer to pull a model
 * - Model load failure → offer reload/different model
 * - Network error → retry
 * - VRAM/OOM → suggest smaller model or quantization
 */
export const ChatErrorBanner = memo(function ChatErrorBanner() {
  const error = useAppStore(s => s.error);
  const modelStatus = useAppStore(s => s.modelStatus);
  const currentModel = useAppStore(s => s.currentModel);

  // Classify the error
  const errorInfo = useMemo(() => {
    if (!error && modelStatus !== 'offline') return null;

    const errLower = (error || '').toLowerCase();

    // Ollama is completely offline
    if (modelStatus === 'offline' || errLower.includes('econnrefused') || errLower.includes('connect')) {
      return {
        type: 'offline',
        icon: WifiOff,
        title: 'Cannot connect to Ollama',
        description: 'Ollama is not running or not reachable. DevForge needs Ollama to power the AI.',
        color: 'rose',
        actions: [
          { label: 'Start Ollama', action: 'start-ollama', primary: true },
          { label: 'Install Ollama', action: 'install-guide', primary: false },
          { label: 'Retry Connection', action: 'retry', primary: false },
        ],
      };
    }

    // No model selected
    if (errLower.includes('no model') || (!currentModel && !error)) {
      return {
        type: 'no-model',
        icon: Cpu,
        title: 'No model selected',
        description: 'Select an AI model to start chatting. If you don\'t have any models yet, download one first.',
        color: 'amber',
        actions: [
          { label: 'Select Model', action: 'select-model', primary: true },
          { label: 'Download Models', action: 'model-hub', primary: false },
        ],
      };
    }

    // Out of memory / VRAM
    if (errLower.includes('out of memory') || errLower.includes('oom') || errLower.includes('vram') || errLower.includes('cuda')) {
      return {
        type: 'oom',
        icon: HardDrive,
        title: 'Out of GPU memory',
        description: `The model "${currentModel}" is too large for your available GPU memory. Try a smaller model or lower quantization.`,
        color: 'orange',
        actions: [
          { label: 'Try Smaller Model', action: 'model-hub', primary: true },
          { label: 'Settings', action: 'settings', primary: false },
        ],
      };
    }

    // Timeout
    if (errLower.includes('timeout')) {
      return {
        type: 'timeout',
        icon: Server,
        title: 'Request timed out',
        description: 'The model took too long to respond. This can happen with large context windows or complex prompts.',
        color: 'amber',
        actions: [
          { label: 'Retry', action: 'retry', primary: true },
          { label: 'Adjust Settings', action: 'settings', primary: false },
        ],
      };
    }

    // Model not found
    if (errLower.includes('not found') || errLower.includes('model') && errLower.includes('pull')) {
      return {
        type: 'model-missing',
        icon: Download,
        title: 'Model not found',
        description: `The model "${currentModel}" isn't available locally. You may need to download it first.`,
        color: 'amber',
        actions: [
          { label: 'Download Model', action: 'model-hub', primary: true },
          { label: 'Switch Model', action: 'select-model', primary: false },
        ],
      };
    }

    // Generic error
    return {
      type: 'generic',
      icon: AlertTriangle,
      title: 'Something went wrong',
      description: error || 'An unexpected error occurred while generating a response.',
      color: 'rose',
      actions: [
        { label: 'Retry', action: 'retry', primary: true },
        { label: 'Report Bug', action: 'report', primary: false },
      ],
    };
  }, [error, modelStatus, currentModel]);

  const handleAction = useCallback(async (actionId) => {
    const store = useAppStore.getState();

    switch (actionId) {
      case 'start-ollama':
        try {
          const result = await window.electronAPI?.startOllama?.();
          if (result?.success) {
            // Wait for Ollama to be ready
            await new Promise(r => setTimeout(r, 3000));
            await store.refreshModels?.();
            store.checkModelStatus?.();
            useAppStore.setState({ error: null });
          }
        } catch (err) {
          console.error('Failed to start Ollama:', err);
        }
        break;

      case 'install-guide':
        window.open('https://ollama.com/download', '_blank');
        break;

      case 'retry':
        useAppStore.setState({ error: null });
        store.checkModelStatus?.();
        await store.refreshModels?.();
        break;

      case 'select-model':
        store.toggleModelSelector?.();
        useAppStore.setState({ error: null });
        break;

      case 'model-hub':
        store.toggleModelHub?.();
        useAppStore.setState({ error: null });
        break;

      case 'settings':
        store.toggleSettings?.();
        break;

      case 'report':
        window.open('https://github.com/your-repo/devforge/issues', '_blank');
        break;

      default:
        break;
    }
  }, []);

  if (!errorInfo) return null;

  const Icon = errorInfo.icon;
  const colorMap = {
    rose: {
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/30',
      text: 'text-rose-400',
      icon: 'text-rose-400',
      btnPrimary: 'bg-rose-500 hover:bg-rose-600 text-white',
      btnSecondary: 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300',
    },
    amber: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      text: 'text-amber-400',
      icon: 'text-amber-400',
      btnPrimary: 'bg-amber-500 hover:bg-amber-600 text-white',
      btnSecondary: 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300',
    },
    orange: {
      bg: 'bg-orange-500/10',
      border: 'border-orange-500/30',
      text: 'text-orange-400',
      icon: 'text-orange-400',
      btnPrimary: 'bg-orange-500 hover:bg-orange-600 text-white',
      btnSecondary: 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-300',
    },
  };
  const c = colorMap[errorInfo.color] || colorMap.rose;

  return (
    <div className={`mx-4 my-3 p-4 rounded-xl ${c.bg} border ${c.border} animate-in fade-in slide-in-from-top-2 duration-300`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${c.bg}`}>
          <Icon size={20} className={c.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-semibold ${c.text} mb-1`}>
            {errorInfo.title}
          </h4>
          <p className="text-xs text-white/60 leading-relaxed mb-3">
            {errorInfo.description}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {errorInfo.actions.map((action) => (
              <button
                key={action.action}
                onClick={() => handleAction(action.action)}
                className={`
                  px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  flex items-center gap-1.5
                  ${action.primary ? c.btnPrimary : c.btnSecondary}
                `}
              >
                {action.label}
                {action.action === 'install-guide' && <ExternalLink size={10} />}
              </button>
            ))}
            {/* Dismiss button */}
            <button
              onClick={() => useAppStore.setState({ error: null })}
              className="px-2 py-1.5 rounded-lg text-[10px] text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * ConnectionStatusDot - Tiny indicator in the input area showing Ollama connection state
 */
export const ConnectionStatusDot = memo(function ConnectionStatusDot() {
  const modelStatus = useAppStore(s => s.modelStatus);

  const statusConfig = {
    online: { color: 'bg-emerald-500', label: 'Connected' },
    loading: { color: 'bg-amber-500 animate-pulse', label: 'Loading model...' },
    offline: { color: 'bg-rose-500', label: 'Disconnected' },
  };

  const config = statusConfig[modelStatus] || statusConfig.offline;

  return (
    <div className="flex items-center gap-1.5" title={config.label}>
      <div className={`w-1.5 h-1.5 rounded-full ${config.color}`} />
      <span className="text-[10px] text-white/40">{config.label}</span>
    </div>
  );
});

export default ChatErrorBanner;
