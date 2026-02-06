import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './startup.css';

/**
 * StartupScreen - Premium, cinematic boot sequence.
 *
 * Design principles:
 * 1. ONE coordinated entrance — no layered flashing
 * 2. Clean, minimal UI — let the visuals breathe
 * 3. Smooth ring progress indicator instead of a bar
 * 4. Logo reveals with a staggered letter animation
 * 5. Status messages are professional, not sci-fi
 * 6. Exit is a satisfying scale+fade, not just opacity
 */

function WindowControls() {
  const handleMinimize = () => window.electronAPI?.minimizeWindow?.();
  const handleMaximize = () => window.electronAPI?.maximizeWindow?.();
  const handleClose = () => window.electronAPI?.closeWindow?.();
  if (!window.electronAPI) return null;

  return (
    <div className="su-controls">
      <button className="su-ctrl-btn" onClick={handleMinimize} title="Minimize">
        <svg width="10" height="1"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button className="su-ctrl-btn" onClick={handleMaximize} title="Maximize">
        <svg width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button className="su-ctrl-btn su-ctrl-close" onClick={handleClose} title="Close">
        <svg width="10" height="10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </div>
  );
}

// Ring progress indicator
function ProgressRing({ progress, size = 120, strokeWidth = 2.5 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - progress * circumference;

  return (
    <svg className="su-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.06)"
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      <circle
        className="su-ring-progress"
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke="url(#ring-gradient)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* Glow on the leading edge */}
      <circle
        className="su-ring-glow"
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke="url(#ring-gradient)"
        strokeWidth={strokeWidth + 4}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        opacity="0.3"
        style={{ filter: 'blur(4px)' }}
      />
      <defs>
        <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="50%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function StartupScreen({ onComplete }) {
  const [bootProgress, setBootProgress] = useState(0);
  const [status, setStatus] = useState('Starting up...');
  const [isExiting, setIsExiting] = useState(false);
  const [entered, setEntered] = useState(false);
  const [hardware, setHardware] = useState(null);

  const targetProgressRef = useRef(0);
  const rafRef = useRef(null);
  const completedRef = useRef(false);

  // Coordinated entrance: delay slightly so everything paints on first frame
  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Hardware detection
  useEffect(() => {
    const fetchHardware = async () => {
      await new Promise(r => setTimeout(r, 300));
      if (!window.electronAPI?.hardwareGetInfo) {
        setHardware({ gpu: 'GPU Detected', ram: '16 GB', cpu: 'CPU Detected', npu: null });
        return;
      }
      try {
        const hw = await window.electronAPI.hardwareGetInfo(true);
        if (!hw) return;
        const gpuName = hw.gpus?.devices?.[0]?.name || 'GPU';
        const vramGB = hw.gpus?.totalVramGB || 0;
        const gpu = vramGB > 0 ? `${gpuName} · ${vramGB}GB` : gpuName;
        const ram = hw.memory?.totalGB ? `${hw.memory.totalGB} GB RAM` : null;
        const cpu = hw.cpu?.model || null;
        const npu = hw.npu?.detected ? (hw.npu.type === 'intel-npu' ? 'Intel NPU' : 'NPU') : null;
        setHardware({ gpu, ram, cpu, npu });
      } catch {
        setHardware({ gpu: 'GPU', ram: 'RAM', cpu: 'CPU', npu: null });
      }
    };
    fetchHardware();
  }, []);

  // IPC or synthetic progress
  useEffect(() => {
    const isElectron = !!window.electronAPI?.onStartupProgress;

    if (!isElectron) {
      // Browser fallback: smooth synthetic timeline
      const start = performance.now();
      const duration = 6000;
      let cancelled = false;
      const statusMessages = [
        [0, 'Starting up...'],
        [0.15, 'Checking dependencies...'],
        [0.30, 'Connecting to database...'],
        [0.45, 'Starting Ollama...'],
        [0.60, 'Detecting hardware...'],
        [0.75, 'Loading services...'],
        [0.90, 'Almost ready...'],
        [0.98, 'Ready'],
      ];
      const tick = (now) => {
        if (cancelled) return;
        const t = Math.min((now - start) / duration, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        targetProgressRef.current = Math.max(targetProgressRef.current, eased);
        // Update status
        for (let i = statusMessages.length - 1; i >= 0; i--) {
          if (t >= statusMessages[i][0]) { setStatus(statusMessages[i][1]); break; }
        }
        if (t < 1) requestAnimationFrame(tick);
        else setTimeout(() => handleFinish(), 400);
      };
      requestAnimationFrame(tick);
      return () => { cancelled = true; };
    }

    // IPC-driven progress
    const stepOrder = { init: 0, dependencies: 1, database: 2, ollama: 3, npu: 4, imageBackend: 5, healthMonitor: 6, complete: 7 };
    const maxOrder = 7;
    const stepLabels = {
      init: 'Initializing...',
      dependencies: 'Checking dependencies...',
      database: 'Connecting to database...',
      ollama: 'Starting Ollama...',
      npu: 'Checking NPU...',
      imageBackend: 'Checking image backend...',
      healthMonitor: 'Starting health monitor...',
      complete: 'Ready',
    };

    const unsubscribe = window.electronAPI.onStartupProgress?.((evt) => {
      if (!evt || evt.type === 'log') return;
      const order = stepOrder[evt.step] ?? 0;
      const pct = typeof evt.percent === 'number' ? evt.percent / 100 : Math.min(1, order / maxOrder);
      targetProgressRef.current = Math.max(targetProgressRef.current, pct);

      if (evt.step === 'complete' && evt.status === 'success') {
        targetProgressRef.current = 1;
      }

      setStatus(evt.message || stepLabels[evt.step] || 'Loading...');
    });

    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smooth animation loop
  useEffect(() => {
    let last = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setBootProgress((prev) => {
        const target = targetProgressRef.current;
        const alpha = 1 - Math.exp(-dt / 400);
        const next = prev + (target - prev) * alpha;
        const val = Math.max(prev, next);
        if (target >= 0.999 && val >= 0.99) return 1;
        if (Math.abs(val - target) < 0.001) return target;
        return val;
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const handleFinish = useCallback(() => {
    if (isExiting || completedRef.current) return;
    completedRef.current = true;
    setIsExiting(true);
    if (onComplete) setTimeout(() => onComplete(), 600);
  }, [isExiting, onComplete]);

  const handleSkip = useCallback(() => {
    targetProgressRef.current = 1;
    setStatus('Ready');
    handleFinish();
  }, [handleFinish]);

  // Auto-finish when progress completes
  useEffect(() => {
    if (!completedRef.current && bootProgress >= 0.995) {
      // Small delay so the user sees "Ready" state
      const t = setTimeout(() => handleFinish(), 500);
      return () => clearTimeout(t);
    }
  }, [bootProgress, handleFinish]);

  const pct = Math.round(bootProgress * 100);

  // Hardware spec chips
  const specs = useMemo(() => {
    if (!hardware) return [];
    return [hardware.gpu, hardware.ram, hardware.cpu, hardware.npu].filter(Boolean);
  }, [hardware]);

  return (
    <div className={`su ${entered ? 'su--entered' : ''} ${isExiting ? 'su--exit' : ''}`}>
      {/* Drag region */}
      <div className="su-titlebar" />
      <WindowControls />

      {/* Ambient background */}
      <div className="su-bg">
        <div className="su-bg-orb su-bg-orb--1" />
        <div className="su-bg-orb su-bg-orb--2" />
        <div className="su-bg-orb su-bg-orb--3" />
      </div>

      {/* Center content */}
      <div className="su-center">
        {/* Progress ring + percentage */}
        <div className="su-ring-wrap">
          <ProgressRing progress={bootProgress} size={140} strokeWidth={2} />
          <div className="su-ring-inner">
            <span className="su-pct">{pct}</span>
          </div>
        </div>

        {/* Logo */}
        <h1 className="su-logo">
          {'DEVFORGE'.split('').map((char, i) => (
            <span key={i} className="su-logo-char" style={{ animationDelay: `${0.6 + i * 0.06}s` }}>
              {char}
            </span>
          ))}
        </h1>

        {/* Status */}
        <p className="su-status" key={status}>{status}</p>
      </div>

      {/* Hardware specs - bottom center */}
      {specs.length > 0 && (
        <div className="su-specs">
          {specs.map((spec, i) => (
            <span key={i} className="su-spec" style={{ animationDelay: `${1.2 + i * 0.1}s` }}>
              {spec}
            </span>
          ))}
        </div>
      )}

      {/* Skip */}
      <button className="su-skip" onClick={handleSkip}>
        Skip
        <kbd className="su-skip-key">Esc</kbd>
      </button>

      {/* Escape to skip */}
      <EscapeListener onSkip={handleSkip} />
    </div>
  );
}

function EscapeListener({ onSkip }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onSkip(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSkip]);
  return null;
}

export default StartupScreen;
