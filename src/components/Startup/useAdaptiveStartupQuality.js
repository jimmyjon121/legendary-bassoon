// src/components/Startup/useAdaptiveStartupQuality.js
import { useEffect, useMemo, useRef, useState } from "react";
import {
  QUALITY_PRESETS,
  getClientGraphicsHints,
  nextHigherTier,
  nextLowerTier,
  pickInitialTier,
} from "./startupQuality";

export function useAdaptiveStartupQuality(hardware) {
  const hints = useMemo(() => getClientGraphicsHints(), []);
  const [tier, setTier] = useState(() => pickInitialTier({ hardware, hints }));

  // If hardware info arrives slightly later, re-pick tier (still optimistic).
  useEffect(() => {
    const next = pickInitialTier({ hardware, hints });
    setTier((prev) => {
      // Prefer the higher tier initially; governor can downshift safely.
      const order = ["REDUCED", "LOW", "MEDIUM", "HIGH", "ULTRA"];
      return order.indexOf(next) > order.indexOf(prev) ? next : prev;
    });
  }, [hardware, hints]);

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

    // Optional: step up if it's been stable & fast for a while
    if (veryFast) {
      if (now - s.stableSince > 2500 && tierRef.current !== "ULTRA") {
        s.lastAdjustAt = now;
        s.stableSince = now;
        setTier((prev) => nextHigherTier(prev));
      }
    } else {
      // Reset stability timer when not consistently fast
      s.stableSince = now;
    }
  };

  return { tier, quality, hints, reportFrameTime };
}
