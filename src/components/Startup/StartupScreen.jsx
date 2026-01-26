import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StartupVisual from './StartupVisual';
import './startup.css';
import { useAdaptiveStartupQuality } from './useAdaptiveStartupQuality';

function WindowControls() {
  const handleMinimize = () => window.electronAPI?.minimizeWindow?.();
  const handleMaximize = () => window.electronAPI?.maximizeWindow?.();
  const handleClose = () => window.electronAPI?.closeWindow?.();

  if (!window.electronAPI) return null;

  return (
    <div className="startup-window-controls" aria-label="window-controls">
      <button className="startup-window-btn" onClick={handleMinimize} title="Minimize">
        <span aria-hidden="true">–</span>
      </button>
      <button className="startup-window-btn" onClick={handleMaximize} title="Maximize">
        <span aria-hidden="true">▢</span>
      </button>
      <button className="startup-window-btn close" onClick={handleClose} title="Close">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function StartupScreen({ onComplete }) {
  const [phase, setPhase] = useState(0); // 0=dormant,1=awakening,2=alive,3=ready
  const [bootProgress, setBootProgress] = useState(0);
  const [status, setStatus] = useState('Initializing neural substrate');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const uiRef = useRef(null);
  const targetProgressRef = useRef(0);
  const rafRef = useRef(null);
  const completedRef = useRef(false);

  // Motion safety
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Hardware fetch with backoff
  const [hardware, setHardware] = useState({
    gpu: { name: 'Detecting GPU…', vram: '' },
    ram: { total: 'Detecting RAM…' },
    cpu: { name: 'Detecting CPU…', cores: null },
    npu: { detected: false, type: null }
  });

  const { tier: qualityTier, reportFrameTime } = useAdaptiveStartupQuality(hardware);

  useEffect(() => {
    const fetchHardware = async (retries = 0) => {
      await new Promise(r => setTimeout(r, 500));

      if (!window.electronAPI?.hardwareGetInfo) {
        setHardware({
          gpu: { name: 'NVIDIA RTX 4090', vram: '24 GB' },
          ram: { total: '64 GB' },
          cpu: { name: 'AMD Ryzen 9 7950X', cores: 16 },
          npu: { detected: true, type: 'Intel NPU' }
        });
        return;
      }

      try {
        const hw = await window.electronAPI.hardwareGetInfo(true);
        if (!hw) return;

        const gpuName = hw.gpus?.devices?.[0]?.name || 'GPU Detected';
        const vramGB = hw.gpus?.totalVramGB || 0;
        const vramStr = vramGB > 0 ? `${vramGB} GB` : '';

        const ramGB = hw.memory?.totalGB || 0;
        const ramStr = ramGB > 0 ? `${ramGB} GB` : 'Detected';

        const cpuName = hw.cpu?.model || 'CPU Detected';
        const cpuCores = hw.cpu?.cores || null;

        const npuDetected = hw.npu?.detected || false;
        let npuName = null;
        if (npuDetected) {
          if (hw.npu.type === 'intel-npu') npuName = 'Intel NPU';
          else if (hw.npu.type === 'apple-neural-engine') npuName = 'Apple Neural Engine';
          else npuName = 'NPU Detected';
        }

        setHardware({
          gpu: { name: gpuName, vram: vramStr },
          ram: { total: ramStr },
          cpu: { name: cpuName, cores: cpuCores },
          npu: { detected: npuDetected, type: npuName }
        });
      } catch (e) {
        console.error('Hardware fetch failed:', e);
        if (retries < 3) {
          await new Promise(r => setTimeout(r, 500 * (retries + 1)));
          fetchHardware(retries + 1);
        } else {
          setHardware({
            gpu: { name: 'GPU Offline', vram: '' },
            ram: { total: 'Unknown' },
            cpu: { name: 'CPU Offline', cores: null },
            npu: { detected: false, type: null }
          });
        }
      }
    };
    fetchHardware();
  }, []);

  // Boot timeline
  // Live progress (IPC) with smoothing fallback to synthetic if IPC unavailable
  useEffect(() => {
    const isElectron = !!window.electronAPI?.onStartupProgress;
    if (!isElectron) {
      // Simple synthetic timeline for browser fallback
      const start = performance.now();
      const duration = 9000;
      let cancelled = false;
      const tick = (now) => {
        if (cancelled) return;
        const t = Math.min((now - start) / duration, 1);
        const eased = t * t * (3 - 2 * t);
        targetProgressRef.current = Math.max(targetProgressRef.current, eased);
        if (t >= 0.3) setPhase(1);
        if (t >= 0.6) setPhase(2);
        if (t >= 0.95) setPhase(3);
        
        // Dynamic status messages
        if (t < 0.15) setStatus('Initializing neural substrate');
        else if (t < 0.30) setStatus('Spawning consciousness nodes');
        else if (t < 0.50) setStatus('Forming synaptic connections');
        else if (t < 0.70) setStatus('Activating thought pulses');
        else if (t < 0.85) setStatus('Calibrating awareness matrix');
        else if (t < 0.95) setStatus('Achieving coherence');
        else setStatus('Consciousness online');
        
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          setTimeout(() => handleFinish(), 250);
        }
      };
      requestAnimationFrame(tick);
      return () => { cancelled = true; };
    }

    // IPC-driven progress
    const stepOrder = {
      init: 0,
      dependencies: 1,
      database: 2,
      ollama: 3,
      npu: 4,
      imageBackend: 5,
      healthMonitor: 6,
      complete: 7,
    };
    const maxOrder = Math.max(...Object.values(stepOrder));

    const unsubscribe = window.electronAPI.onStartupProgress?.((evt) => {
      if (!evt || evt.type === 'log') return;
      const order = stepOrder[evt.step] ?? 0;
      const base = Math.max(0, Math.min(1, order / maxOrder));
      const pct = typeof evt.percent === 'number' ? evt.percent / 100 : base;
      const clamped = Math.max(targetProgressRef.current, Math.min(1, pct));
      targetProgressRef.current = clamped;

      if (evt.step === 'complete' && evt.status === 'success') {
        targetProgressRef.current = 1;
        setPhase(3);
      } else {
        // Phase mapping: early -> awakening, mid -> alive
        if (order >= 5) setPhase((p) => Math.max(p, 2));
        else if (order >= 1) setPhase((p) => Math.max(p, 1));
      }

      const nextStatus = evt.message || evt.stepName || 'Initializing...';
      setStatus(nextStatus);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smooth progress animation toward targetProgressRef
  useEffect(() => {
    let last = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // Feed frame-time governor (downshifts on weaker hardware)
      reportFrameTime(dt);

      setBootProgress((prev) => {
        const target = targetProgressRef.current;
        // Frame-rate independent smoothing (time constant ~500ms for buttery feel)
        const tau = 500;
        const alpha = 1 - Math.exp(-dt / tau);
        const next = prev + (target - prev) * alpha;
        // Never go backwards (IPC can be jumpy)
        const monotonic = Math.max(prev, next);
        // Snap at the end so we don't asymptotically stall at 99%
        if (target >= 0.999 && monotonic >= 0.992) return 1;
        if (Math.abs(monotonic - target) < 0.001) return target;
        return monotonic;
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reportFrameTime]);

  const handleFinish = useCallback(() => {
    if (isExiting || completedRef.current) return;
    completedRef.current = true;
    setIsExiting(true);
    if (uiRef.current) {
      uiRef.current.classList.add('startup-ui--fade');
    }
    if (onComplete) {
      setTimeout(() => onComplete(), 350);
    }
  }, [isExiting, onComplete]);

  const handleSkip = useCallback(() => {
    targetProgressRef.current = 1;
    setPhase(3);
    setStatus('Consciousness online');
    handleFinish();
  }, [handleFinish]);

  useEffect(() => {
    if (!completedRef.current && bootProgress >= 0.995 && phase >= 3) {
      handleFinish();
    }
  }, [bootProgress, phase, handleFinish]);

  const specs = useMemo(() => ([
    `RAM ${hardware.ram.total || '—'}`,
    `GPU ${hardware.gpu.name}${hardware.gpu.vram ? ` · ${hardware.gpu.vram}` : ''}`,
    `CPU ${hardware.cpu.name}${hardware.cpu.cores ? ` · ${hardware.cpu.cores} cores` : ''}`,
    hardware.npu.detected ? `NPU ${hardware.npu.type || 'Detected'}` : 'NPU Not detected'
  ]), [hardware]);

  const shouldUseUltra = !reducedMotion && (qualityTier === 'ULTRA' || qualityTier === 'HIGH' || qualityTier === 'MEDIUM');

  return (
    <div className={`startup ${shouldUseUltra ? 'startup--ultra' : ''} ${isExiting ? 'startup--exiting' : ''}`}>
      <div className="startup-titlebar" />
      <WindowControls />

      <StartupVisual
        bootProgress={bootProgress}
        phase={phase}
        reducedMotion={reducedMotion}
        qualityTier={qualityTier}
        reportFrameTime={reportFrameTime}
      />

      <div className="startup-overlay" ref={uiRef}>
        <div className="startup-logo">DEVFORGE</div>
        <div className="startup-status">
          <div className="startup-status-text">{status}</div>
          <div className="startup-progress">
            <div
              className="startup-progress-bar"
              style={{ width: `${Math.round(bootProgress * 100)}%` }}
            />
          </div>
          <div className="startup-progress-pct">{Math.round(bootProgress * 100)}%</div>
        </div>

        <div className="startup-specs">
          {specs.map((line, idx) => (
            <div key={idx} className="startup-spec-line">{line}</div>
          ))}
        </div>

      </div>

      <button className="startup-skip" onClick={handleSkip}>Skip</button>
    </div>
  );
}

export default StartupScreen;
