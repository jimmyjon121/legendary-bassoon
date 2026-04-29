/**
 * StartupVisual.jsx
 *
 * Luxury, layered startup visual that stays smooth:
 * - Avoids expensive CSS filters/grain
 * - Animates transform/opacity only
 * - Limited element count with deterministic layout
 */

import React, { useMemo } from 'react';
import './StartupVisual.css';
import StartupVisualUltra from './StartupVisualUltra';
import { QUALITY_PRESETS } from './startupQuality';

class UltraErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    // If WebGL is unavailable or shader compilation fails, fall back gracefully.
    console.warn('StartupVisualUltra failed; falling back to CSS visual.', err);
  }
  render() {
    if (this.state.hasError) return this.props.fallback || null;
    return this.props.children;
  }
}

export function StartupVisual({
  bootProgress = 0,
  phase = 0,
  reducedMotion = false,
  qualityTier = 'HIGH',
  reportFrameTime,
}) {
  const intensity = 0.18 + bootProgress * 0.56;
  const phaseClass = phase >= 3 ? 'svlux--ready' : phase >= 2 ? 'svlux--alive' : phase >= 1 ? 'svlux--awakening' : 'svlux--dormant';
  const stageClass =
    bootProgress >= 0.8 ? 'svlux--stage4' :
    bootProgress >= 0.5 ? 'svlux--stage3' :
    bootProgress >= 0.2 ? 'svlux--stage2' :
    'svlux--stage1';

  const effectiveTier = reducedMotion ? 'REDUCED' : qualityTier;
  const qClass =
    effectiveTier === 'ULTRA'
      ? 'svlux--q-ultra'
      : effectiveTier === 'HIGH'
        ? 'svlux--q-high'
        : effectiveTier === 'MEDIUM'
          ? 'svlux--q-medium'
          : effectiveTier === 'LOW'
            ? 'svlux--q-low'
            : 'svlux--q-reduced';

  const shouldUseUltra =
    !reducedMotion &&
    (effectiveTier === 'ULTRA' || effectiveTier === 'HIGH' || effectiveTier === 'MEDIUM') &&
    typeof window !== 'undefined' &&
    typeof WebGLRenderingContext !== 'undefined';

  const config = useMemo(() => {
    switch (effectiveTier) {
      case 'ULTRA':
        return { orbs: 4, ribbons: 2, network: true, nodes: 12, particles: 18 };
      case 'HIGH':
        return { orbs: 4, ribbons: 2, network: true, nodes: 10, particles: 14 };
      case 'MEDIUM':
        return { orbs: 3, ribbons: 1, network: true, nodes: 8, particles: 10 };
      case 'LOW':
        return { orbs: 2, ribbons: 0, network: false, nodes: 0, particles: 6 };
      case 'REDUCED':
      default:
        return { orbs: 2, ribbons: 0, network: false, nodes: 0, particles: 4 };
    }
  }, [effectiveTier]);

  const particles = useMemo(() => {
    return Array.from({ length: config.particles }, (_, i) => ({
      id: i,
      x: 8 + ((i * 19) % 84),
      y: 10 + ((i * 27) % 80),
      s: 2 + (i % 4),
      d: i * 0.18,
      t: 10 + (i % 6) * 2,
    }));
  }, [config.particles]);

  const nodes = useMemo(() => {
    return Array.from({ length: config.nodes }, (_, i) => ({
      id: i,
      x: 18 + ((i * 29) % 64),
      y: 16 + ((i * 23) % 62),
      d: i * 0.22,
    }));
  }, [config.nodes]);

  const netOpacity = Math.max(0, Math.min(0.82, (bootProgress - 0.28) * 1.35));
  const focusRipple = bootProgress > 0.9;

  if (shouldUseUltra) {
    const quality = QUALITY_PRESETS[effectiveTier] || QUALITY_PRESETS.HIGH;
    return (
      <div className="svultra" aria-hidden="true">
        <UltraErrorBoundary
          fallback={
            <div
              className={`svlux ${phaseClass} ${stageClass} ${qClass} ${reducedMotion ? 'svlux--reduced' : ''}`}
              style={{ '--p': bootProgress, '--i': intensity, '--net': netOpacity }}
            >
              <div className="svlux-bg" />
              <div className="svlux-orb svlux-orb--1" />
              <div className="svlux-orb svlux-orb--2" />
              {config.orbs >= 3 && <div className="svlux-orb svlux-orb--3" />}
              {config.orbs >= 4 && <div className="svlux-orb svlux-orb--4" />}
              {config.ribbons >= 1 && <div className="svlux-ribbon svlux-ribbon--1" />}
              {config.ribbons >= 2 && <div className="svlux-ribbon svlux-ribbon--2" />}
              <div className="svlux-core">
                <div className="svlux-core__aura" />
                <div className="svlux-core__shell" />
                <div className="svlux-core__inner" />
                <div className="svlux-core__spark" />
                <div className="svlux-core__glint" />
                <div className="svlux-core__ring svlux-core__ring--1" />
                <div className="svlux-core__ring svlux-core__ring--2" />
                {focusRipple && <div className="svlux-core__focus" />}
              </div>
              <div className="svlux-vignette" />
            </div>
          }
        >
          {/* IMPORTANT: do NOT key on `effectiveTier` — the tier changing
              would force a full unmount/remount of the WebGL canvas, which
              produces a visible flash. Quality changes are picked up via
              the `quality` prop dependency inside the component. */}
          <StartupVisualUltra
            progress={bootProgress}
            quality={quality}
            reportFrameTime={reportFrameTime}
            className="svultra__stage"
          />
        </UltraErrorBoundary>
        <div className="svultra__overlay" />
      </div>
    );
  }

  return (
    <div
      className={`svlux ${phaseClass} ${stageClass} ${qClass} ${reducedMotion ? 'svlux--reduced' : ''}`}
      style={{ '--p': bootProgress, '--i': intensity, '--net': netOpacity }}
    >
      <div className="svlux-bg" />

      {/* Ambient orbs (pre-softened via gradients, no blur filter) */}
      <div className="svlux-orb svlux-orb--1" />
      <div className="svlux-orb svlux-orb--2" />
      {config.orbs >= 3 && <div className="svlux-orb svlux-orb--3" />}
      {config.orbs >= 4 && <div className="svlux-orb svlux-orb--4" />}

      {/* Light ribbons (very subtle parallax) */}
      {config.ribbons >= 1 && <div className="svlux-ribbon svlux-ribbon--1" />}
      {config.ribbons >= 2 && <div className="svlux-ribbon svlux-ribbon--2" />}

      {/* Constellation network (static lines, light node pulse) */}
      {config.network && bootProgress > 0.18 && (
        <svg className="svlux-net" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ opacity: netOpacity }}>
          <g className="svlux-net__lines">
            <line x1="18" y1="22" x2="50" y2="42" />
            <line x1="82" y1="26" x2="50" y2="42" />
            <line x1="30" y1="78" x2="50" y2="42" />
            <line x1="76" y1="70" x2="50" y2="42" />
            <line x1="22" y1="56" x2="30" y2="78" />
            <line x1="86" y1="52" x2="76" y2="70" />
            <line x1="18" y1="22" x2="30" y2="78" />
            <line x1="82" y1="26" x2="76" y2="70" />
          </g>
          <g className="svlux-net__nodes">
            {nodes.map((n) => (
              <circle key={n.id} cx={n.x} cy={n.y} r="0.85" style={{ animationDelay: `${n.d}s` }} />
            ))}
          </g>
        </svg>
      )}

      {/* Central core */}
      <div className="svlux-core">
        <div className="svlux-core__aura" />
        <div className="svlux-core__shell" />
        <div className="svlux-core__inner" />
        <div className="svlux-core__spark" />
        <div className="svlux-core__glint" />
        <div className="svlux-core__ring svlux-core__ring--1" />
        <div className="svlux-core__ring svlux-core__ring--2" />
        {focusRipple && <div className="svlux-core__focus" />}
      </div>

      {/* Particles */}
      <div className="svlux-particles" aria-hidden="true">
        {particles.map((p) => (
          <span
            key={p.id}
            className="svlux-p"
            style={{
              '--x': `${p.x}%`,
              '--y': `${p.y}%`,
              '--s': `${p.s}px`,
              '--d': `${p.d}s`,
              '--t': `${p.t}s`,
            }}
          />
        ))}
      </div>

      <div className="svlux-vignette" />
    </div>
  );
}

export default StartupVisual;
