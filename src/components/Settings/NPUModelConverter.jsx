import React from 'react';
import { Zap, Loader } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../utils/electronAPI';

// NPU Model Converter Component
// Recommended models that work well on NPU
// preConverted = already in OpenVINO format on HuggingFace, downloads instantly without conversion step
const NPU_RECOMMENDED_MODELS = [
  {
    id: 'OpenVINO/Qwen2.5-1.5B-Instruct-fp16-ov',
    name: 'Qwen 2.5 1.5B',
    size: '3 GB',
    badge: '⚡ Pre-converted',
    badgeColor: 'text-status-success',
    description: 'Best for everyday chat. Already in NPU format — loads in seconds, no conversion needed.',
    preConverted: true,
  },
  {
    id: 'OpenVINO/phi-2-fp16-ov',
    name: 'Phi-2 2.7B',
    size: '5.4 GB',
    badge: '⚡ Pre-converted',
    badgeColor: 'text-status-success',
    description: 'Microsoft\'s fast general-purpose model. Great for coding help and Q&A.',
    preConverted: true,
  },
  {
    id: 'microsoft/phi-2',
    name: 'Phi-2 (convert)',
    size: '~5 GB',
    badge: 'Needs conversion',
    badgeColor: 'text-amber-400',
    description: 'Converts from HuggingFace to OpenVINO format. Takes 10–20 min on first run.',
    preConverted: false,
  },
  {
    id: 'Qwen/Qwen2.5-1.5B-Instruct',
    name: 'Qwen 2.5 1.5B (convert)',
    size: '~3 GB',
    badge: 'Needs conversion',
    badgeColor: 'text-amber-400',
    description: 'Strong multilingual chat model. Converts from HuggingFace — takes 5–15 min.',
    preConverted: false,
  },
];

// Conversion steps for progress
const CONVERSION_STEPS = [
  { id: 'init', label: 'Initializing', desc: 'Setting up environment' },
  { id: 'download', label: 'Downloading', desc: 'Fetching from HuggingFace' },
  { id: 'convert', label: 'Converting', desc: 'OpenVINO transformation' },
  { id: 'quantize', label: 'Quantizing', desc: 'Compressing weights' },
  { id: 'save', label: 'Saving', desc: 'Writing to disk' },
  { id: 'done', label: 'Complete', desc: 'Ready for NPU' },
];

export function NPUModelConverter() {
  const { setModel, setPreferredBackend } = useAppStore((state) => ({
    setModel: state.setModel,
    setPreferredBackend: state.setPreferredBackend,
  }), shallow);

  const llmRuntimeSpark = useAppStore((state) =>
    Boolean(
      state.llmRuntimeState?.hardware?.spark?.isSpark
      || state.llmRuntimeState?.deviceUtilization?.spark?.isSpark,
    ));
  const [probeSparkHost, setProbeSparkHost] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api.sparkProbe({ force: false }).then((r) => {
      if (!cancelled && r?.profile?.isSpark) setProbeSparkHost(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const [modelInput, setModelInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionResult, setActionResult] = React.useState(null);
  const [precision, setPrecision] = React.useState('int4');
  const [showRecommended, setShowRecommended] = React.useState(true);
  const [step, setStep] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const [activeModelId, setActiveModelId] = React.useState(null);
  const timerRef = React.useRef(null);

  // Check which model is currently configured for the NPU
  React.useEffect(() => {
    const check = async () => {
      const status = await window.electronAPI?.getNpuStatus?.();
      const configuredModel = status?.model || status?.modelPath;
      if (configuredModel) setActiveModelId(configuredModel);
    };
    check();
  }, []);

  const syncAppSelection = React.useCallback(async (modelId) => {
    const backendResult = await setPreferredBackend?.('openvino-npu');
    if (backendResult?.success === false) {
      throw new Error(backendResult.error || 'Failed to switch backend to OpenVINO NPU');
    }

    const modelResult = await setModel?.(`npu:${modelId}`);
    if (modelResult?.success === false) {
      throw new Error(modelResult.error || `Failed to activate ${modelId}`);
    }
  }, [setModel, setPreferredBackend]);

  const activateNpuModel = React.useCallback(async (modelId, options = {}) => {
    const targetPrecision = options.precision || 'fp16';
    const showProgress = options.showProgress !== false;

    if (showProgress) setStep(1);
    const configResult = await window.electronAPI?.configureNpuModel?.({
      modelPath: modelId,
      device: 'NPU',
      precision: targetPrecision,
      enableAutoStart: true,
    });
    if (!configResult?.configured && configResult?.error && !/already configured/i.test(configResult.error)) {
      throw new Error(`Config failed: ${configResult.error}`);
    }

    if (showProgress) setStep(2);
    const status = await window.electronAPI?.getNpuStatus?.();
    if (status?.serverRunning) {
      const serverStatus = await window.electronAPI?.getNpuServerStatus?.();
      const alreadyLoaded = serverStatus?.model_loaded && serverStatus?.model_path === modelId;
      if (alreadyLoaded) {
        setActiveModelId(modelId);
        await syncAppSelection(modelId);
        return { message: `${modelId.split(/[\\/]/).pop()} is already loaded on the NPU.` };
      }

      const loadResult = await window.electronAPI?.loadNpuModel?.({
        modelPath: modelId,
        precision: targetPrecision,
      });
      if (loadResult?.success) {
        setActiveModelId(modelId);
        await syncAppSelection(modelId);
        return { message: `${modelId.split(/[\\/]/).pop()} loaded on the NPU and ready to use.` };
      }
      // Fall through to a clean restart if hot-load fails.
    }

    if (showProgress) setStep(3);
    if (status?.serverRunning) {
      await window.electronAPI?.stopNpuServer?.();
      await new Promise(r => setTimeout(r, 1000));
    }
    const startResult = await window.electronAPI?.startNpuServer?.({ device: 'NPU' });
    if (!startResult?.success) {
      throw new Error(startResult?.error || 'Server failed to start');
    }

    setActiveModelId(modelId);
    await syncAppSelection(modelId);
    return { message: `${modelId.split(/[\\/]/).pop()} is now loaded on the NPU and ready to use.` };
  }, [syncAppSelection]);

  React.useEffect(() => {
    if (busy) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - start) / 1000);
        setElapsed(secs);
        if (secs < 3) setStep(0);
        else if (secs < 15) setStep(1);
        else if (secs < 60) setStep(2);
        else if (secs < 90) setStep(3);
        else setStep(4);
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [busy]);

  // Intel/OpenVINO NPU path is not offered on NVIDIA DGX Spark.
  if (probeSparkHost || llmRuntimeSpark) {
    return null;
  }

  // Load a pre-converted OpenVINO model — configure the path then hot-load or restart
  const loadPreConverted = async (modelId) => {
    setBusy(true);
    setActionResult(null);
    setElapsed(0);
    setStep(0);
    try {
      if (window.electronAPI?.configureNpuModel) {
        const result = await activateNpuModel(modelId, { precision: 'fp16', showProgress: true });
        setActionResult({ success: true, message: result.message });
        return;
      }

      // Step 1: Write model path to openvino-model.json
      setStep(1);
      const configResult = await window.electronAPI?.configureNpuModel?.({
        modelPath: modelId,
        device: 'NPU',
        precision: 'fp16',
        enableAutoStart: true,
      });
      if (!configResult?.configured && configResult?.error && !/already configured/i.test(configResult.error)) {
        setActionResult({ success: false, error: `Config failed: ${configResult.error}` });
        return;
      }

      // Step 2: Check if server is already running — if so, hot-swap or skip if already loaded
      setStep(2);
      const status = await window.electronAPI?.getNpuStatus?.();
      if (status?.serverRunning) {
        const serverStatus = await window.electronAPI?.getNpuServerStatus?.();
        const alreadyLoaded = serverStatus?.model_loaded && serverStatus?.model_path === modelId;
        if (alreadyLoaded) {
          setActiveModelId(modelId);
          await syncAppSelection(modelId);
          setActionResult({ success: true, message: `${modelId.split('/').pop()} is already loaded on the NPU.` });
          return;
        }
        const loadResult = await window.electronAPI?.loadNpuModel?.({ modelPath: modelId });
        if (loadResult?.success) {
          setActiveModelId(modelId);
          await syncAppSelection(modelId);
          setActionResult({ success: true, message: `${modelId.split('/').pop()} loaded on the NPU and ready to use.` });
          return;
        }
        // Hot-load failed — fall through to restart
      }

      // Step 3: Start (or restart) the server — it reads the config we just wrote
      setStep(3);
      if (status?.serverRunning) {
        await window.electronAPI?.stopNpuServer?.();
        await new Promise(r => setTimeout(r, 1000));
      }
      const startResult = await window.electronAPI?.startNpuServer?.({ device: 'NPU' });
      if (!startResult?.success) {
        setActionResult({ success: false, error: startResult?.error || 'Server failed to start' });
        return;
      }

      setActiveModelId(modelId);
      await syncAppSelection(modelId);
      setActionResult({ success: true, message: `${modelId.split('/').pop()} is now loaded on the NPU and ready to use.` });
    } catch (err) {
      setActionResult({ success: false, error: err.message });
    } finally {
      setBusy(false);
      clearInterval(timerRef.current);
    }
  };

  // Convert a HuggingFace model to OpenVINO format
  const convertToNPU = async (modelId = modelInput) => {
    if (!modelId) return;
    setBusy(true);
    setActionResult(null);
    setStep(0);
    setElapsed(0);
    try {
      if (window.electronAPI?.convertModelToNPU && window.electronAPI?.configureNpuModel) {
        const result = await window.electronAPI.convertModelToNPU({ inputPath: modelId, precision });
        if (!result?.success) {
          setStep(5);
          setActionResult(result);
          return;
        }

        const resolvedModelId = result.outputPath || modelId;
        const activation = await activateNpuModel(resolvedModelId, {
          precision,
          showProgress: false,
        });
        setStep(5);
        setModelInput(resolvedModelId);
        setActionResult({
          success: true,
          outputPath: result.outputPath,
          message: activation.message.replace('loaded on the NPU', 'converted and loaded on the NPU'),
        });
        return;
      }

      const result = await window.electronAPI?.convertModelToNPU({ inputPath: modelId, precision });
      setStep(5);
      setActionResult(result);
      if (result?.success) setActiveModelId(modelId);
    } catch (error) {
      setActionResult({ success: false, error: error.message });
    } finally {
      setBusy(false);
      clearInterval(timerRef.current);
    }
  };

  const handleModelCard = (model) => {
    setModelInput(model.id);
    setActionResult(null);
    if (model.preConverted) {
      loadPreConverted(model.id);
    } else {
      convertToNPU(model.id);
    }
  };

  // For the manual input field — detect if it looks like a pre-converted OV repo
  const isPreConverted = (id) => /^OpenVINO\//i.test(id) || /-ov$/.test(id) || /openvino/i.test(id);
  const loading = busy && isPreConverted(modelInput);

  return (
    <div className="p-4 rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5 space-y-3">
      <div>
        <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Zap size={16} className="text-amber-400" /> NPU Model Converter
        </h4>
        <p className="text-xs text-text-muted">
          Convert HuggingFace models to OpenVINO format for Intel NPU acceleration
        </p>
      </div>

      {/* Info about GGUF */}
      <div className="bg-forge-bg border border-forge-border rounded p-2 text-[11px] text-text-muted">
        <strong className="text-amber-400">Note:</strong> GGUF files cannot be directly converted. 
        Use the original HuggingFace model ID instead (e.g., &quot;microsoft/phi-2&quot;).
      </div>

      {/* Progress */}
      {busy && (() => {
        const steps = loading
          ? [
              { id: 'cfg',   label: 'Configuring',   desc: 'Writing model path' },
              { id: 'check', label: 'Checking server', desc: 'Is NPU server running?' },
              { id: 'load',  label: 'Loading model',  desc: 'Sending model to NPU' },
            ]
          : CONVERSION_STEPS;
        const color = loading ? 'text-status-success' : 'text-amber-400';
        const barColor = loading ? 'from-status-success to-emerald-500' : 'from-amber-500 to-orange-500';
        return (
          <div className="bg-forge-bg border border-forge-border rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Loader size={14} className={`animate-spin ${color}`} />
                {loading ? `Loading: ${modelInput.split('/').pop()}` : `Converting: ${modelInput.split('/').pop()}`}
              </span>
              <span className="text-xs text-text-muted font-mono">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </span>
            </div>
            {loading && step >= 2 && (
              <p className="text-[11px] text-amber-400/90">
                First-time load can take 5–15 min for a 3GB model. The server is downloading from HuggingFace — not stuck.
              </p>
            )}
            <div className="space-y-1">
              {steps.map((s, i) => (
                <div key={s.id} className={`flex items-center gap-2 p-1.5 rounded text-xs transition-all ${
                  i === step ? `bg-forge-elevated ${color}` :
                  i < step ? 'text-status-success' : 'text-text-muted opacity-40'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    i < step ? 'bg-status-success text-white' :
                    i === step ? 'bg-forge-elevated border border-current animate-pulse' : 'bg-forge-elevated'
                  }`}>
                    {i < step ? '✓' : i + 1}
                  </span>
                  <span className="font-medium">{s.label}</span>
                  <span className="text-[10px] text-text-muted">{s.desc}</span>
                  {i === step && <Loader size={10} className="ml-auto animate-spin" />}
                </div>
              ))}
            </div>
            <div className="w-full h-1.5 bg-forge-elevated rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                style={{ width: `${Math.min(100, ((step + 1) / steps.length) * 100)}%` }}
              />
            </div>
          </div>
        );
      })()}

      {/* Recommended models */}
      {showRecommended && !busy && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary font-medium">Recommended NPU Models</span>
            <button
              onClick={() => setShowRecommended(false)}
              className="text-[10px] text-text-muted hover:text-text-secondary"
            >
              Hide
            </button>
          </div>
          <p className="text-[11px] text-text-muted">
            <span className="text-status-success font-medium">⚡ Pre-converted</span> models are already in NPU format — just click to load, no conversion wait.
            <span className="text-amber-400 font-medium"> Needs conversion</span> models get downloaded &amp; converted automatically (takes 5–20 min once).
          </p>
          <div className="grid grid-cols-1 gap-2">
            {NPU_RECOMMENDED_MODELS.map((model) => {
              // Exact match OR the stored path ends with the repo name — avoid cross-matching similar names
              const modelBasename = model.id.split('/').pop();
              const activeBasename = activeModelId ? activeModelId.split('/').pop() : '';
              const isActive = activeModelId && (
                activeModelId === model.id ||
                activeBasename === modelBasename
              );
              const actionLabel = model.preConverted ? 'Load on NPU' : 'Convert + Load';
              return (
                <button
                  key={model.id}
                  onClick={() => handleModelCard(model)}
                  disabled={busy}
                  className={`p-3 rounded-lg border text-left transition-colors group ${
                    isActive
                      ? 'bg-status-success/10 border-status-success/40'
                      : 'bg-forge-elevated hover:bg-forge-hover border-forge-border'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium text-text-primary flex items-center gap-1.5">
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-status-success inline-block" />}
                      {model.name}
                      {isActive && <span className="text-[10px] text-status-success">(active)</span>}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-text-muted">{model.size}</span>
                      <span className={`text-[10px] font-medium ${model.badgeColor}`}>{model.badge}</span>
                      {!isActive && (
                        <span className="text-[10px] text-workspace-casual opacity-0 group-hover:opacity-100 transition-opacity">
                          {actionLabel} →
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-text-muted">{model.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!busy && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">HuggingFace Model ID</label>
            <input
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              placeholder="e.g., microsoft/phi-2"
              className="input text-sm font-mono"
            />
          </div>

          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Precision</label>
              <select
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
                className="input text-sm"
              >
                <option value="int4">INT4 (Best for NPU)</option>
                <option value="int8">INT8 (Balanced)</option>
                <option value="fp16">FP16 (Higher quality)</option>
                <option value="fp32">FP32 (Full precision)</option>
              </select>
            </div>
            
            <div className="flex-1" />
            
            <button
              onClick={() => {
                if (isPreConverted(modelInput)) {
                  loadPreConverted(modelInput);
                } else {
                  convertToNPU();
                }
              }}
              disabled={!modelInput || busy}
              className="btn btn-primary flex items-center gap-2"
            >
              <Zap size={14} />
              {isPreConverted(modelInput) ? 'Load on NPU' : 'Convert to NPU'}
            </button>
          </div>
        </div>
      )}

      {actionResult && (
        <div className={`p-3 rounded text-xs ${
            actionResult.success
              ? 'bg-status-success/20 border border-status-success/30'
              : actionResult.needsSetup
              ? 'bg-amber-500/20 border border-amber-500/30'
              : 'bg-status-error/20 border border-status-error/30'
          }`}>
            {actionResult.success ? (
              <div>
                <div className="font-medium text-status-success mb-1">
                  {actionResult.message ? '✓ ' + actionResult.message : 'Success!'}
                </div>
                {actionResult.outputPath && (
                  <div className="text-text-muted">
                    Saved to: <code className="bg-forge-bg px-1 rounded">{actionResult.outputPath}</code>
                  </div>
                )}
                <p className="text-[10px] mt-2 text-text-muted">
                  Model is ready. Your next chat will run on the NPU.
                </p>
              </div>
            ) : actionResult.needsSetup ? (
              <div>
                <div className="font-medium text-amber-400 mb-1">OpenVINO Setup Required</div>
                <div className="text-text-muted mb-2">
                  {actionResult.error}
                </div>
                <button
                  onClick={async () => {
                    try {
                      await window.electronAPI?.runTerminalCommand('powershell -ExecutionPolicy Bypass -File scripts/setup-openvino.ps1');
                    } catch (e) {
                      console.error('Failed to run setup:', e);
                    }
                  }}
                  className="btn btn-secondary text-xs"
                >
                  Run OpenVINO Setup
                </button>
              </div>
            ) : (
              <div>
                <div className="font-medium text-status-error mb-1">Failed</div>
                <div className="text-text-muted whitespace-pre-wrap">{actionResult.error}</div>
                {actionResult.stderr && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-text-muted hover:text-text-secondary">
                      Show details
                    </summary>
                    <pre className="mt-1 text-[9px] bg-forge-bg p-2 rounded overflow-x-auto max-h-32">
                      {actionResult.stderr}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        <div className="text-[10px] text-text-muted bg-forge-bg rounded p-2">
          <strong>Note:</strong> NPU conversion requires OpenVINO to be installed. 
          Run <code className="bg-forge-elevated px-1 rounded">scripts/setup-openvino.ps1</code> to set up the environment.
          Converted models will work with Intel Core Ultra processors.
        </div>
    </div>
  );
}

export default NPUModelConverter;
