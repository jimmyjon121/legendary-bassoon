import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './startup.css';
import { StartupVisual } from './StartupVisual';
import { useAdaptiveStartupQuality } from './useAdaptiveStartupQuality';

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

const STATUS_BADGES = {
  init: 'SYS',
  dependencies: 'PKG',
  database: 'DB',
  ollama: 'LLM',
  npu: 'NPU',
  imageBackend: 'IMG',
  healthMonitor: 'MON',
  complete: 'RDY',
};

// Cinematic visible phase ladder. The detailed IPC status remains intact
// below; this is intentionally simpler so the startup reads like a boot
// ritual instead of a technical checklist.
const PHASE_TRACK = [
  { id: 'wake', label: 'WAKE' },
  { id: 'scan', label: 'SCAN' },
  { id: 'forge', label: 'FORGE' },
  { id: 'ready', label: 'READY' },
];

const PHASE_INDEX = PHASE_TRACK.reduce((acc, p, i) => {
  acc[p.id] = i;
  return acc;
}, {});

function resolveVisiblePhase(statusStep, progress = 0) {
  if (statusStep === 'complete' || progress >= 0.95) return 'ready';
  if (statusStep === 'ollama' || statusStep === 'healthMonitor' || progress >= 0.58) return 'forge';
  if (statusStep === 'database' || statusStep === 'npu' || statusStep === 'imageBackend' || progress >= 0.25) return 'scan';
  return 'wake';
}

const SYSTEM_ONLINE_LABELS = {
  gpu: 'GPU ONLINE',
  ram: 'MEMORY READY',
  cpu: 'CPU LINKED',
  npu: 'NPU READY',
};

function inferStatusStep(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return 'init';
  if (value.includes('dependenc')) return 'dependencies';
  if (value.includes('database')) return 'database';
  if (value.includes('ollama') || value.includes('model')) return 'ollama';
  if (value.includes('npu') || value.includes('openvino')) return 'npu';
  if (value.includes('image')) return 'imageBackend';
  if (value.includes('health')) return 'healthMonitor';
  if (value.includes('ready') || value.includes('started')) return 'complete';
  if (value.includes('init') || value.includes('start')) return 'init';
  return 'init';
}

function WindowControls() {
  return null;
}

// Ring progress indicator
function ProgressRing({ progress, size = 120, strokeWidth = 2.5, celebrate = false, severity = 'normal', pulse = false, phase = 'wake' }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - progress * circumference;
  const gradientIdRef = useRef(`ring-gradient-${Math.random().toString(36).slice(2, 10)}`);
  const gradientId = gradientIdRef.current;

  const t = Math.max(0, Math.min(1, progress));
  const startHue = Math.round(248 + (226 - 248) * t);
  const midHue = Math.round(266 + (208 - 266) * t);
  const endHue = Math.round(286 + (188 - 286) * t);

  const shimmerLength = circumference * 0.18;
  const shimmerStart = offset + circumference * 0.12;
  const shimmerEnd = offset - circumference * 0.45;
  const apertureRadius = radius - 13;
  const apertureCircumference = 2 * Math.PI * apertureRadius;
  const apertureVisible = Math.max(0, Math.min(1, (t - 0.18) / 0.42));
  const apertureOffset = apertureCircumference * (1 - Math.max(0.08, t));
  const tickCount = 28;
  const tickOpacity = Math.max(0, Math.min(1, (t - 0.24) / 0.32));

  const particleCount = 6;
  const showParticles = progress > 0.05 && progress < 1;
  const particleAngles = Array.from({ length: particleCount }, (_, i) => {
    const trail = i * 0.018;
    return -Math.PI / 2 + (Math.max(0, t - trail) * Math.PI * 2);
  });

  const ringClass = [
    'su-ring-wrap',
    pulse ? 'is-pulse' : '',
    celebrate ? 'is-complete' : '',
    `is-phase-${phase}`,
    severity === 'error' ? 'is-error' : '',
    severity === 'warning' ? 'is-warning' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={ringClass}>
      <svg
        className="su-ring"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ '--aperture-visible': apertureVisible, '--tick-visible': tickOpacity }}
      >
        {/* Forging aperture ticks */}
        <g className="su-ring-ticks" transform={`translate(${size / 2} ${size / 2})`}>
          {Array.from({ length: tickCount }, (_, i) => {
            const angle = (360 / tickCount) * i;
            const longTick = i % 7 === 0;
            return (
              <line
                key={i}
                x1={0}
                y1={-(radius - (longTick ? 12 : 9))}
                x2={0}
                y2={-(radius - 4)}
                transform={`rotate(${angle})`}
              />
            );
          })}
        </g>
        {/* Inner aperture seal */}
        <circle
          className="su-ring-aperture su-ring-aperture--inner"
          cx={size / 2} cy={size / 2} r={apertureRadius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={1}
          strokeDasharray={`${apertureCircumference * 0.18} ${apertureCircumference * 0.08}`}
          strokeDashoffset={apertureOffset}
        />
        <circle
          className="su-ring-aperture su-ring-aperture--outer"
          cx={size / 2} cy={size / 2} r={radius + 6}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={0.8}
          strokeDasharray={`${circumference * 0.12} ${circumference * 0.14}`}
          strokeDashoffset={-offset * 0.35}
        />
        {/* DF reactor seal: intentionally geometric and quiet until completion. */}
        <g className={`su-ring-seal ${celebrate ? 'is-locked' : ''}`} transform={`translate(${size / 2} ${size / 2})`}>
          <circle className="su-ring-seal__halo" r={22} />
          <path className="su-ring-seal__stroke" d="M -13 -16 L -13 16 L -2 16 C 8 16 14 9 14 0 C 14 -9 8 -16 -2 -16 Z" />
          <path className="su-ring-seal__stroke" d="M -2 -16 L 15 -16 M -2 0 L 10 0 M -2 16 L -2 -16" />
          <path className="su-ring-seal__spark" d="M 0 -27 L 0 -21 M 0 21 L 0 27 M -27 0 L -21 0 M 21 0 L 27 0" />
        </g>
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
          stroke={`url(#${gradientId})`}
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
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth + 3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity="0.26"
        />
        {/* Completion shimmer */}
        <circle
          className={`su-ring-shimmer ${celebrate ? 'is-active' : ''}`}
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="#ffffff"
          strokeWidth={strokeWidth + 1.4}
          strokeLinecap="round"
          strokeDasharray={`${shimmerLength} ${circumference}`}
          strokeDashoffset={shimmerStart}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            '--shimmer-start': `${shimmerStart}`,
            '--shimmer-end': `${shimmerEnd}`,
          }}
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={`hsl(${startHue} 88% 70%)`} />
            <stop offset="52%" stopColor={`hsl(${midHue} 88% 72%)`} />
            <stop offset="100%" stopColor={`hsl(${endHue} 90% 76%)`} />
          </linearGradient>
        </defs>
      </svg>

      {showParticles && particleAngles.map((angle, i) => {
        const ringRadius = radius + 3 + i * 0.25;
        const x = size / 2 + Math.cos(angle) * ringRadius;
        const y = size / 2 + Math.sin(angle) * ringRadius;
        const opacity = Math.max(0.16, 0.64 - i * 0.1);
        const scale = Math.max(0.52, 1 - i * 0.1);
        return (
          <span
            key={i}
            className="su-ring-particle"
            style={{
              left: `${x}px`,
              top: `${y}px`,
              opacity,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }}
          />
        );
      })}
    </div>
  );
}

export function StartupScreen({ onComplete }) {
  const [bootProgress, setBootProgress] = useState(0);
  const [displayPct, setDisplayPct] = useState(0);
  const [status, setStatus] = useState('Starting up...');
  const [statusStep, setStatusStep] = useState('init');
  const [statusTransition, setStatusTransition] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [entered, setEntered] = useState(false);
  const [hardware, setHardware] = useState(null);
  const [hardwareRaw, setHardwareRaw] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [showSpecs, setShowSpecs] = useState(false);
  const [ringPulse, setRingPulse] = useState(false);
  const [ringCelebrate, setRingCelebrate] = useState(false);
  const [startupSeverity, setStartupSeverity] = useState('normal');
  const [startupIssue, setStartupIssue] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState(null);
  const [appVersion, setAppVersion] = useState('v0.1.0');
  // Lock tier upgrades during the boot screen — the surface only lives for
  // a few seconds, so any mid-flight upgrade would cost a visible WebGL
  // canvas remount (the source of the bright flash users were seeing).
  const { tier: qualityTier, reportFrameTime } = useAdaptiveStartupQuality(hardwareRaw, { lockUpgrades: true });

  const rootRef = useRef(null);
  const targetProgressRef = useRef(0);
  const rafRef = useRef(null);
  const startedAtRef = useRef(performance.now());
  const completedRef = useRef(false);
  const displayedPctRef = useRef(0);
  const highestSeverityRef = useRef('normal');
  const issueRef = useRef(null);
  const statusRef = useRef(status);
  const statusStepRef = useRef(statusStep);
  const pendingStatusRef = useRef(null);
  const statusTimerRef = useRef(null);
  const statusLastSetRef = useRef(0);
  const pulseTimerRef = useRef(null);
  const pulseRafRef = useRef(null);
  const celebrateTimeoutRef = useRef(null);
  const hasCelebratedRef = useRef(false);
  const milestonesTriggeredRef = useRef(new Set());
  const etaSmoothedRef = useRef(null);
  const motionReducedRef = useRef(false);
  const pointerTargetRef = useRef({ x: 0, y: 0 });
  const pointerCurrentRef = useRef({ x: 0, y: 0 });
  const parallaxRafRef = useRef(null);

  // Coordinated entrance: delay slightly so everything paints on first frame
  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    issueRef.current = startupIssue;
  }, [startupIssue]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    statusStepRef.current = statusStep;
  }, [statusStep]);

  useEffect(() => {
    setStatusTransition(true);
    const t = setTimeout(() => setStatusTransition(false), 220);
    return () => clearTimeout(t);
  }, [status]);

  const pushStatus = useCallback((nextStatus, force = false, stepHint = null) => {
    if (!nextStatus) return;
    const step = stepHint || inferStatusStep(nextStatus);
    const pending = pendingStatusRef.current;

    if (nextStatus === statusRef.current && step === statusStepRef.current) return;
    if (pending && pending.text === nextStatus && pending.step === step) return;

    const minGapMs = 420;
    const now = performance.now();
    const elapsed = now - statusLastSetRef.current;

    const applyNow = () => {
      statusLastSetRef.current = performance.now();
      pendingStatusRef.current = null;
      setStatus(nextStatus);
      setStatusStep(step);
    };

    if (force || elapsed >= minGapMs) {
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      applyNow();
      return;
    }

    pendingStatusRef.current = { text: nextStatus, step };
    if (!statusTimerRef.current) {
      statusTimerRef.current = setTimeout(() => {
        statusTimerRef.current = null;
        if (!pendingStatusRef.current) return;
        const next = pendingStatusRef.current;
        pendingStatusRef.current = null;
        statusLastSetRef.current = performance.now();
        setStatus(next.text);
        setStatusStep(next.step);
      }, Math.max(40, minGapMs - elapsed));
    }
  }, []);

  const triggerRingPulse = useCallback((durationMs = 340) => {
    if (pulseRafRef.current) cancelAnimationFrame(pulseRafRef.current);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    setRingPulse(false);
    pulseRafRef.current = requestAnimationFrame(() => {
      setRingPulse(true);
      pulseTimerRef.current = setTimeout(() => setRingPulse(false), durationMs);
    });
  }, []);

  // Hardware detection
  useEffect(() => {
    const fetchHardware = async () => {
      await new Promise(r => setTimeout(r, 300));
      if (!window.electronAPI?.hardwareGetInfo) {
        setHardware({
          specs: { gpu: 'GPU detected', ram: '16 GB RAM', cpu: 'CPU detected', npu: null },
          metrics: [],
        });
        return;
      }
      try {
        const hw = await window.electronAPI.hardwareGetInfo(true);
        if (!hw) return;
        const gpuName = hw.gpus?.devices?.[0]?.name || 'GPU';
        const vramGB = hw.gpus?.totalVramGB || 0;
        const gpu = vramGB > 0 ? `${gpuName} \u00b7 ${Math.round(vramGB)}GB` : gpuName;
        const ram = hw.memory?.totalGB ? `${hw.memory.totalGB} GB RAM` : null;
        const cpu = hw.cpu?.model || null;
        const npu = hw.npu?.detected ? (hw.npu.type === 'intel-npu' ? 'Intel NPU' : 'NPU') : null;
        const metrics = [];
        if (vramGB > 0) metrics.push(`${Math.round(vramGB)}GB VRAM`);
        if (hw.memory?.totalGB) metrics.push(`${Math.round(hw.memory.totalGB)}GB SYSTEM`);
        if (hw.cpu?.cores?.physical) metrics.push(`${hw.cpu.cores.physical}C CPU`);
        setHardware({
          specs: { gpu, ram, cpu, npu },
          metrics,
        });
        // Adapt the raw hardware shape to what useAdaptiveStartupQuality
        // expects (gpu.name + gpu.vram + ram.total + cpu.cores + npu.detected),
        // so the WebGL/CSS visual can pick a sensible quality tier early.
        setHardwareRaw({
          gpu: {
            name: gpuName,
            vram: vramGB > 0 ? `${vramGB}GB` : null,
          },
          ram: hw.memory?.totalGB ? { total: `${hw.memory.totalGB}GB` } : null,
          cpu: hw.cpu?.cores?.physical ? { cores: hw.cpu.cores.physical } : null,
          npu: hw.npu?.detected ? { detected: true } : null,
        });
      } catch {
        setHardware({
          specs: { gpu: 'GPU', ram: 'RAM', cpu: 'CPU', npu: null },
          metrics: [],
        });
      }
    };
    fetchHardware();
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchVersion = async () => {
      try {
        const version = await window.electronAPI?.getVersion?.();
        if (mounted && version) {
          setAppVersion(`v${version}`);
        }
      } catch {
        // Keep fallback app version
      }
    };
    fetchVersion();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (completedRef.current) return;
      const elapsed = Math.max(0, Math.floor((performance.now() - startedAtRef.current) / 1000));
      setElapsedSeconds((prev) => (prev === elapsed ? prev : elapsed));
    }, 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const applyMotionPreference = () => {
      const reduced = Boolean(media?.matches);
      motionReducedRef.current = reduced;
      setReducedMotion(reduced);
      if (reduced && rootRef.current) {
        rootRef.current.style.setProperty('--su-parallax-x', '0px');
        rootRef.current.style.setProperty('--su-parallax-y', '0px');
      }
    };
    applyMotionPreference();

    const onMediaChange = () => applyMotionPreference();
    if (media?.addEventListener) media.addEventListener('change', onMediaChange);
    else if (media?.addListener) media.addListener(onMediaChange);

    const tick = () => {
      parallaxRafRef.current = null;
      const current = pointerCurrentRef.current;
      const target = pointerTargetRef.current;
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;

      if (rootRef.current) {
        rootRef.current.style.setProperty('--su-parallax-x', `${current.x.toFixed(2)}px`);
        rootRef.current.style.setProperty('--su-parallax-y', `${current.y.toFixed(2)}px`);
      }

      const stillMoving = Math.abs(target.x - current.x) > 0.02 || Math.abs(target.y - current.y) > 0.02;
      if (stillMoving) {
        parallaxRafRef.current = requestAnimationFrame(tick);
      }
    };

    const requestParallaxTick = () => {
      if (!parallaxRafRef.current) parallaxRafRef.current = requestAnimationFrame(tick);
    };

    const onPointerMove = (evt) => {
      if (motionReducedRef.current) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const nx = evt.clientX / w - 0.5;
      const ny = evt.clientY / h - 0.5;
      pointerTargetRef.current = {
        x: nx * 18,
        y: ny * 14,
      };
      requestParallaxTick();
    };

    const resetParallax = () => {
      pointerTargetRef.current = { x: 0, y: 0 };
      requestParallaxTick();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mouseleave', resetParallax);
    window.addEventListener('blur', resetParallax);

    return () => {
      if (media?.removeEventListener) media.removeEventListener('change', onMediaChange);
      else if (media?.removeListener) media.removeListener(onMediaChange);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mouseleave', resetParallax);
      window.removeEventListener('blur', resetParallax);
      if (parallaxRafRef.current) cancelAnimationFrame(parallaxRafRef.current);
    };
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
        [0, 'Starting up...', 'init'],
        [0.15, 'Checking dependencies...', 'dependencies'],
        [0.30, 'Connecting to database...', 'database'],
        [0.45, 'Starting Ollama...', 'ollama'],
        [0.60, 'Detecting hardware...', 'npu'],
        [0.75, 'Loading services...', 'healthMonitor'],
        [0.90, 'Almost ready...', 'healthMonitor'],
        [0.98, 'Ready', 'complete'],
      ];
      const tick = (now) => {
        if (cancelled) return;
        const t = Math.min((now - start) / duration, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        targetProgressRef.current = Math.max(targetProgressRef.current, eased);
        // Update status
        for (let i = statusMessages.length - 1; i >= 0; i--) {
          if (t >= statusMessages[i][0]) {
            pushStatus(statusMessages[i][1], false, statusMessages[i][2]);
            break;
          }
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

    const severityRank = { normal: 0, warning: 1, error: 2 };
    const pushSeverity = (nextSeverity) => {
      if ((severityRank[nextSeverity] || 0) > (severityRank[highestSeverityRef.current] || 0)) {
        highestSeverityRef.current = nextSeverity;
        setStartupSeverity(nextSeverity);
      }
    };

    const unsubscribe = window.electronAPI.onStartupProgress?.((evt) => {
      if (!evt || evt.type === 'log') return;
      const order = stepOrder[evt.step] ?? 0;
      const pct = typeof evt.percent === 'number' ? evt.percent / 100 : Math.min(1, order / maxOrder);
      targetProgressRef.current = Math.max(targetProgressRef.current, pct);

      if (evt.status === 'warning') {
        pushSeverity('warning');
        if (!issueRef.current || issueRef.current.level !== 'error') {
          setStartupIssue({
            level: 'warning',
            step: evt.step,
            message: evt.message || `${stepLabels[evt.step] || 'Startup'} reported a warning.`,
          });
        }
      } else if (evt.status === 'error') {
        pushSeverity('error');
        setStartupIssue({
          level: 'error',
          step: evt.step,
          message: evt.message || `${stepLabels[evt.step] || 'Startup'} failed.`,
        });
      }

      if (evt.step === 'complete' && evt.status === 'success') {
        targetProgressRef.current = 1;
        if (highestSeverityRef.current === 'error') {
          pushStatus('Started with degraded services', true, 'complete');
        } else if (highestSeverityRef.current === 'warning') {
          pushStatus('Started with warnings', true, 'complete');
        }
      }

      if (!(evt.step === 'complete' && evt.status === 'success' && highestSeverityRef.current !== 'normal')) {
        pushStatus(evt.message || stepLabels[evt.step] || 'Loading...', false, evt.step || inferStatusStep(evt.message));
      }
    });

    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushStatus]);

  // Smooth animation loop
  useEffect(() => {
    let last = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      let nextProgress = 0;
      setBootProgress((prev) => {
        const target = targetProgressRef.current;
        const alpha = 1 - Math.exp(-dt / 320);
        const next = prev + (target - prev) * alpha;
        const val = Math.max(prev, next);
        if (target >= 0.999 && val >= 0.99) {
          nextProgress = 1;
          return 1;
        }
        if (Math.abs(val - target) < 0.001) {
          nextProgress = target;
          return target;
        }
        nextProgress = val;
        return val;
      });

      if (nextProgress >= 0.35 && !showSpecs) {
        setShowSpecs(true);
      }

      const pctTarget = Math.max(0, Math.min(100, nextProgress * 100));
      const currentPct = displayedPctRef.current;
      const pctAlpha = 1 - Math.exp(-dt / 240);
      const nextPct = currentPct + (pctTarget - currentPct) * pctAlpha;
      displayedPctRef.current = Math.max(currentPct, Math.min(pctTarget, nextPct));

      const integerPct = Math.max(0, Math.min(100, Math.round(displayedPctRef.current)));
      setDisplayPct((prev) => (prev === integerPct ? prev : integerPct));

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [showSpecs]);

  useEffect(() => {
    const milestones = [25, 50, 75];
    const crossed = milestones.filter((m) => displayPct >= m && !milestonesTriggeredRef.current.has(m));
    if (crossed.length) {
      crossed.forEach((m) => milestonesTriggeredRef.current.add(m));
      triggerRingPulse(320);
    }
  }, [displayPct, triggerRingPulse]);

  useEffect(() => {
    if (displayPct < 100 || hasCelebratedRef.current) return;
    hasCelebratedRef.current = true;
    setRingCelebrate(true);
    triggerRingPulse(920);
    if (celebrateTimeoutRef.current) clearTimeout(celebrateTimeoutRef.current);
    celebrateTimeoutRef.current = setTimeout(() => setRingCelebrate(false), 920);
  }, [displayPct, triggerRingPulse]);

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    if (pulseRafRef.current) cancelAnimationFrame(pulseRafRef.current);
    if (celebrateTimeoutRef.current) clearTimeout(celebrateTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (startupIssue?.level === 'error' || bootProgress >= 0.995 || bootProgress < 0.06 || elapsedSeconds < 2) {
      etaSmoothedRef.current = null;
      setEtaSeconds(null);
      return;
    }

    const projectedTotal = elapsedSeconds / Math.max(bootProgress, 0.06);
    const remaining = Math.max(1, Math.min(180, projectedTotal - elapsedSeconds));
    const previous = etaSmoothedRef.current;
    const smoothed = previous == null ? remaining : (previous * 0.72 + remaining * 0.28);
    etaSmoothedRef.current = smoothed;
    const rounded = Math.max(1, Math.round(smoothed));
    setEtaSeconds((prev) => (prev === rounded ? prev : rounded));
  }, [bootProgress, elapsedSeconds, startupIssue]);

  const handleFinish = useCallback(() => {
    if (isExiting || completedRef.current) return;
    completedRef.current = true;
    setIsExiting(true);
    if (onComplete) setTimeout(() => onComplete(), 700);
  }, [isExiting, onComplete]);

  const handleRetryStartup = useCallback(() => {
    window.location.reload();
  }, []);

  const handleContinueDegraded = useCallback(() => {
    pushStatus('Continuing with degraded services...', true, 'complete');
    handleFinish();
  }, [handleFinish, pushStatus]);

  const handleSkip = useCallback(() => {
    targetProgressRef.current = 1;
    pushStatus('Ready', true, 'complete');
    handleFinish();
  }, [handleFinish, pushStatus]);

  // Auto-finish when progress completes
  useEffect(() => {
    if (!completedRef.current && bootProgress >= 0.995 && startupIssue?.level !== 'error') {
      // Small delay so the user sees "Ready" state
      const t = setTimeout(() => handleFinish(), 420);
      return () => clearTimeout(t);
    }
  }, [bootProgress, handleFinish, startupIssue]);

  const pct = displayPct;
  const statusBadge = STATUS_BADGES[statusStep] || STATUS_BADGES.init;
  const elapsedLabel = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, [elapsedSeconds]);
  const etaLabel = useMemo(() => {
    if (!etaSeconds) return null;
    if (etaSeconds < 60) return `${etaSeconds}s`;
    const minutes = Math.floor(etaSeconds / 60);
    const seconds = etaSeconds % 60;
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }, [etaSeconds]);
  const showStatusDots = !isExiting && bootProgress < 0.995 && startupIssue?.level !== 'error';
  const showSlowStartupHint = !isExiting && startupIssue?.level !== 'error' && elapsedSeconds >= 9 && bootProgress < 0.94;
  const slowHintLabel = useMemo(() => {
    const labels = {
      init: 'Bootstrapping core services',
      dependencies: 'Validating local dependencies',
      database: 'Opening local databases',
      ollama: 'Warming local model runtime',
      npu: 'Checking NPU bridge',
      imageBackend: 'Probing image backend',
      healthMonitor: 'Synchronizing service health',
      complete: 'Final startup checks',
    };
    return labels[statusStep] || labels.init;
  }, [statusStep]);

  // Hardware spec chips
  const specs = useMemo(() => {
    if (!hardware) return [];
    const source = hardware.specs || {};
    return [
      { key: 'gpu', label: source.gpu, icon: 'GPU' },
      { key: 'ram', label: source.ram, icon: 'RAM' },
      { key: 'cpu', label: source.cpu, icon: 'CPU' },
      { key: 'npu', label: source.npu, icon: 'NPU' },
    ].filter((item) => Boolean(item.label));
  }, [hardware]);

  const miniMetrics = useMemo(() => {
    if (!hardware?.metrics?.length) return [];
    return hardware.metrics.slice(0, 3);
  }, [hardware]);

  const rootStyle = useMemo(() => {
    const t = Math.max(0, Math.min(1, bootProgress));
    const hue1 = Math.round(248 + (224 - 248) * t);
    const hue2 = Math.round(284 + (196 - 284) * t);
    return {
      '--su-accent-h1': `${hue1}`,
      '--su-accent-h2': `${hue2}`,
      '--su-progress': `${t}`,
      '--su-glow': `${0.18 + 0.42 * t}`,
    };
  }, [bootProgress]);

  const visiblePhase = useMemo(() => resolveVisiblePhase(statusStep, bootProgress), [statusStep, bootProgress]);

  // Drive the StartupVisual phase prop from progress + the active step.
  // 0 dormant, 1 awakening, 2 alive, 3 ready.
  const visualPhase = useMemo(() => {
    if (visiblePhase === 'ready') return 3;
    if (visiblePhase === 'forge') return 2;
    if (visiblePhase === 'scan') return 1;
    return 0;
  }, [visiblePhase]);

  const phaseProgress = useMemo(() => {
    const idx = PHASE_INDEX[visiblePhase] ?? 0;
    return PHASE_TRACK.map((step, i) => {
      const stepProgress = idx > i
        ? 1
        : (idx === i ? Math.max(0.15, Math.min(1, bootProgress)) : 0);
      return { ...step, active: i === idx, complete: i < idx, progress: stepProgress };
    });
  }, [visiblePhase, bootProgress]);

  const showSovereignLine = visiblePhase === 'ready' || bootProgress >= 0.92 || ringCelebrate;

  const severityClass = startupSeverity === 'error'
    ? 'su--error'
    : (startupSeverity === 'warning' ? 'su--warning' : '');

  const readyClass = showSovereignLine ? 'su--runtime-ready' : '';

  return (
    <div
      ref={rootRef}
      className={`su ${entered ? 'su--entered' : ''} ${isExiting ? 'su--exit' : ''} ${severityClass} ${readyClass}`}
      style={rootStyle}
      aria-busy={!isExiting && bootProgress < 1}
    >
      {/* Drag region */}
      <div className="su-titlebar" />
      <WindowControls />

      {/* Ambient background — rich layered visual with quality adaptation
          and reduced-motion fallback. The parallax wrapper still receives
          the pointer offset so the whole backdrop drifts gently. */}
      <div className="su-bg">
        <div className="su-bg-parallax">
          <StartupVisual
            bootProgress={bootProgress}
            phase={visualPhase}
            reducedMotion={reducedMotion}
            qualityTier={qualityTier}
            reportFrameTime={reportFrameTime}
          />
        </div>
      </div>

      {/* Center content */}
      <div className="su-center">
        {/* Progress ring + percentage. Soft backdrop disc keeps the ring
            readable against the layered WebGL backdrop without going opaque. */}
        <div
          className={`su-ring-shell ${ringCelebrate ? 'is-sealed' : ''}`}
          role="progressbar"
          aria-label="Application startup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct}%`}
        >
          <span className="su-ring-disc" aria-hidden="true" />
          <ProgressRing progress={bootProgress} size={140} strokeWidth={2} celebrate={ringCelebrate} severity={startupSeverity} pulse={ringPulse} phase={visiblePhase} />
          <div className="su-ring-inner">
            <span className={`su-pct ${ringCelebrate ? 'is-celebrating' : ''}`}>{pct}</span>
            <span className="su-pct-mark" aria-hidden="true">%</span>
          </div>
        </div>

        {/* Logo */}
        <h1 className="su-logo">
          {'DEVFORGE'.split('').map((char, i) => (
            <span key={i} className="su-logo-char" style={{ animationDelay: `${0.48 + i * 0.045}s` }}>
              {char}
            </span>
          ))}
        </h1>
        <p className="su-tagline">Own your AI. Control your costs.</p>

        {/* Status */}
        <div className={`su-status-row ${statusTransition ? 'su-status-row--shift' : ''}`}>
          <span className={`su-status-badge su-status-badge--${startupSeverity}`}>{statusBadge}</span>
          <p className={`su-status ${statusTransition ? 'su-status--shift' : ''}`} aria-live="polite" aria-atomic="true">
            {status}
          </p>
          {showStatusDots && (
            <span className="su-status-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
          {etaLabel && <span className="su-status-eta">ETA {etaLabel}</span>}
          <span className="su-status-time">{elapsedLabel}</span>
        </div>

        {/* Cinematic phase ladder. Aria-hidden because the spoken status line
            above already conveys real startup progress. */}
        <ol className="su-phase-track" aria-hidden="true">
          {phaseProgress.map((step) => (
            <li
              key={step.id}
              className={[
                'su-phase-step',
                step.complete ? 'is-complete' : '',
                step.active ? 'is-active' : '',
              ].filter(Boolean).join(' ')}
              style={{ '--phase-fill': step.progress }}
            >
              <span className="su-phase-dot" />
              <span className="su-phase-label">{step.label}</span>
            </li>
          ))}
        </ol>

        <div className={`su-sovereign-line ${showSovereignLine ? 'su-sovereign-line--visible' : ''}`} aria-hidden="true">
          <span className="su-sovereign-dot" />
          <span>Sovereign runtime initialized</span>
        </div>

        {startupIssue && (
          <div
            className={`su-issue su-issue--${startupIssue.level}`}
            role={startupIssue.level === 'error' ? 'alert' : 'status'}
            aria-live={startupIssue.level === 'error' ? 'assertive' : 'polite'}
          >
            <span className="su-issue-dot" aria-hidden="true" />
            <span className="su-issue-text">{startupIssue.message}</span>
            {startupIssue.level === 'error' && (
              <div className="su-issue-actions">
                <button className="su-issue-btn" onClick={handleRetryStartup}>Retry</button>
                <button className="su-issue-btn su-issue-btn--ghost" onClick={handleContinueDegraded}>Continue</button>
              </div>
            )}
          </div>
        )}

        {showSlowStartupHint && (
          <div className="su-slow-hint" role="status" aria-live="polite">
            <span className="su-slow-hint-pill">Optimizing</span>
            <span className="su-slow-hint-text">
              Startup is taking longer than usual. {slowHintLabel}
            </span>
          </div>
        )}
      </div>

      {/* Hardware specs - bottom center */}
      {specs.length > 0 && (
        <div className={`su-specs ${showSpecs ? 'su-specs--visible' : ''}`}>
          {specs.map((spec, i) => (
            <span key={spec.key} className="su-spec" style={{ animationDelay: `${i * 0.08}s` }}>
              <span className="su-spec-icon">{spec.icon}</span>
              <span className="su-spec-copy">
                <span className="su-spec-label">{SYSTEM_ONLINE_LABELS[spec.key] || spec.icon}</span>
                <span className="su-spec-detail">{spec.label}</span>
              </span>
            </span>
          ))}
          {miniMetrics.length > 0 && (
            <div className="su-mini-metrics">
              {miniMetrics.map((metric) => (
                <span key={metric} className="su-mini-metric">{metric}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quiet version stamp in the bottom-left, mirror of the Skip button.
          Replaces the old floating brand-meta above the ring so the ring
          can own the upper centerline. */}
      <div className="su-version-stamp" aria-hidden="true">
        <span className="su-version-mark">DEVFORGE</span>
        <span className="su-version-tag">{appVersion}</span>
      </div>

      {/* Skip */}
      <button className="su-skip" onClick={handleSkip}>
        Skip
        <kbd className="su-skip-key">Esc</kbd>
      </button>

      <span className="su-sr-only" aria-live="polite" aria-atomic="true">
        Startup progress {pct} percent
      </span>

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
