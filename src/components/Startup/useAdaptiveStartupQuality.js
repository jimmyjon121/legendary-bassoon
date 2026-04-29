// src/components/Startup/useAdaptiveStartupQuality.js
import { useEffect, useMemo, useRef, useState } from "react";
import {
  QUALITY_PRESETS,
  getClientGraphicsHints,
  nextHigherTier,
  nextLowerTier,
  pickInitialTier,
} from "./startupQuality";

/**
 * Adaptive quality hook for startup-style visuals.
 *
 * `options.lockUpgrades` (default false) prevents the tier from being
 * UPGRADED after the first stable pick — only the safety-valve downgrade
 * from the frame-time governor is allowed. This is critical for short-lived
 * surfaces (like the boot screen) where a mid-flight upgrade would force
 * the underlying WebGL canvas to remount, producing a visible flash.
 */
export function useAdaptiveStartupQuality(hardware, options = {}) {
  const { lockUpgrades = false } = options;
  const hints = useMemo(() => getClientGraphicsHints(), []);
  const [tier, setTier] = useState(() => pickInitialTier({ hardware, hints }));
  const tierLockedRef = useRef(false);

  // If hardware info arrives slightly later, re-pick tier (still optimistic).
  // Once a tier has been "locked" (we've sampled a few frames or the caller
  // has explicitly locked upgrades), we stop reacting to later hardware
  // changes that would only push us higher.
  useEffect(() => {
    const next = pickInitialTier({ hardware, hints });
    setTier((prev) => {
      const order = ["REDUCED", "LOW", "MEDIUM", "HIGH", "ULTRA"];
      const isUpgrade = order.indexOf(next) > order.indexOf(prev);
      if (isUpgrade && (lockUpgrades || tierLockedRef.current)) return prev;
      return isUpgrade ? next : prev;
    });
  }, [hardware, hints, lockUpgrades]);

  const quality = useMemo(() => QUALITY_PRESETS[tier] || QUALITY_PRESETS.HIGH, [tier]);

  // Frame-time governor:
  // - If average dt gets too high, drop tier quickly.
  // - If stable and fast for a while, allow a step up (optional).
  const statsRef = useRef({
    startedAt: performance.now(),
    lastAdjustAt: 0,
    stableSince: performance.now(),
    samples: [],
  });

  const tierRef = useRef(tier);
  useEffect(() => {
    tierRef.current = tier;
  }, [tier]);

  const reportFrameTime = (dtMs) => {
    const s = statsRef.current;
    const now = performance.now();

    // Ignore the first few frames (initial layout/paint spikes).
    if (now - s.startedAt < 350) return;

    s.samples.push(dtMs);
    if (s.samples.length > 60) s.samples.shift();

    // After a brief warmup, lock the tier against further upgrades. The
    // safety-valve downgrade below still fires if the system can't keep up.
    if (!tierLockedRef.current && now - s.startedAt > 1200) {
      tierLockedRef.current = true;
    }

    // Don't adjust too frequently.
    if (now - s.lastAdjustAt < 900) return;

    const avg =
      s.samples.reduce((acc, v) => acc + v, 0) / Math.max(1, s.samples.length);

    // Thresholds (tuned for a 60Hz feel):
    const tooSlow = avg > 22;     // <~45 fps sustained
    const veryFast = avg < 16.8;  // ~60 fps sustained

    if (tooSlow && tierRef.current !== "LOW" && tierRef.current !== "REDUCED") {
      s.lastAdjustAt = now;
      s.stableSince = now;
      setTier((prev) => nextLowerTier(prev));
      return;
    }

    // Frame-governor upgrades are skipped when locked or when the caller
    // has explicitly disabled upgrades — these are the main source of
    // mid-flight WebGL canvas remounts during boot.
    if (veryFast && !lockUpgrades && !tierLockedRef.current) {
      if (now - s.stableSince > 2500 && tierRef.current !== "ULTRA") {
        s.lastAdjustAt = now;
        s.stableSince = now;
        setTier((prev) => nextHigherTier(prev));
      }
    } else if (!veryFast) {
      s.stableSince = now;
    }
  };

  return { tier, quality, hints, reportFrameTime };
}
