// src/components/Startup/startupQuality.js

export const QUALITY_PRESETS = {
  ULTRA: {
    tier: "ULTRA",
    maxDpr: 2.0,
    renderScale: 1.0,
    antialias: true,

    nodes: 300,  // Much fewer for cleaner look
    arcs: 60,    // Fewer arcs
    arcsSegments: 18,

    fbmOctaves: 3,
    grain: 0.02,  // Almost no grain
    glow: 0.3,    // Very subtle glow
  },

  HIGH: {
    tier: "HIGH",
    maxDpr: 1.75,
    renderScale: 0.95,
    antialias: true,

    nodes: 250,
    arcs: 50,
    arcsSegments: 16,

    fbmOctaves: 3,
    grain: 0.02,
    glow: 0.25,
  },

  MEDIUM: {
    tier: "MEDIUM",
    maxDpr: 1.5,
    renderScale: 0.85,
    antialias: false,

    nodes: 200,
    arcs: 40,
    arcsSegments: 14,

    fbmOctaves: 2,
    grain: 0.01,
    glow: 0.2,
  },

  LOW: {
    tier: "LOW",
    maxDpr: 1.25,
    renderScale: 0.72,
    antialias: false,

    nodes: 320,
    arcs: 90,
    arcsSegments: 10,

    fbmOctaves: 2,
    grain: 0.05,
    glow: 0.45,
  },

  REDUCED: {
    tier: "REDUCED",
    maxDpr: 1.0,
    renderScale: 0.65,
    antialias: false,

    nodes: 150,
    arcs: 50,
    arcsSegments: 8,

    fbmOctaves: 1,
    grain: 0.0,
    glow: 0.25,
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const parseGB = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;

  const m = v.trim().match(/([\d.]+)\s*(tb|tib|gb|gib|mb|mib)/i);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;

  const unit = m[2].toLowerCase();
  if (unit.startsWith("t")) return n * 1024;
  if (unit.startsWith("m")) return n / 1024;
  return n;
};

const looksIntegrated = (name = "") => {
  const s = String(name).toLowerCase();
  return (
    s.includes("uhd") ||
    s.includes("iris") ||
    (s.includes("intel") && !s.includes("arc")) ||
    s.includes("vega") ||
    s.includes("radeon graphics")
  );
};

export function getClientGraphicsHints() {
  const hints = {
    webgpu: typeof navigator !== "undefined" && !!navigator.gpu,
    webgl2: false,
    renderer: "",
    vendor: "",
    dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : null,
    deviceMemoryGB: typeof navigator !== "undefined" ? navigator.deviceMemory : null,
    reducedMotion: false,
  };

  if (typeof window !== "undefined" && window.matchMedia) {
    hints.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { powerPreference: "high-performance" }) ||
      canvas.getContext("webgl", { powerPreference: "high-performance" });

    if (gl) {
      hints.webgl2 = gl instanceof WebGL2RenderingContext;

      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        hints.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
        hints.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "";
      } else {
        hints.renderer = gl.getParameter(gl.RENDERER) || "";
        hints.vendor = gl.getParameter(gl.VENDOR) || "";
      }
    }
  } catch {
    // Ignore; fallback will still work.
  }

  return hints;
}

export function pickInitialTier({ hardware, hints }) {
  // Accessibility first.
  if (hints?.reducedMotion) return "REDUCED";

  // Start optimistic: HIGH by default
  let score = 3;

  // Use renderer hints as a quick signal.
  const gpuName = hardware?.gpu?.name || hints?.renderer || "";
  if (gpuName) {
    if (looksIntegrated(gpuName)) score -= 1;
    if (/rtx|rx\s?6|rx\s?7|rx\s?8|arc|radeon\s?rx|quadro|firepro/i.test(gpuName)) score += 2;
  }

  // RAM / CPU / VRAM
  const ramGB = parseGB(hardware?.ram?.total) ?? hints?.deviceMemoryGB ?? null;
  const vramGB = parseGB(hardware?.gpu?.vram) ?? null;
  const cores = hardware?.cpu?.cores ?? hints?.cores ?? null;

  if (ramGB != null) {
    if (ramGB >= 32) score += 2;
    else if (ramGB >= 16) score += 1;
    else if (ramGB < 8) score -= 1;
  }

  if (vramGB != null) {
    if (vramGB >= 16) score += 3;
    else if (vramGB >= 8) score += 2;
    else if (vramGB >= 4) score += 1;
    else score -= 1;
  }

  if (cores != null) {
    if (cores >= 16) score += 2;
    else if (cores >= 8) score += 1;
    else if (cores <= 4) score -= 1;
  }

  // WebGPU presence is a strong "modern GPU" hint
  if (hints?.webgpu) score += 1;

  // NPU detected = premium system hint
  if (hardware?.npu?.detected) score += 1;

  score = clamp(score, 0, 10);

  if (score >= 8) return "ULTRA";
  if (score >= 5) return "HIGH";
  if (score >= 3) return "MEDIUM";
  return "LOW";
}

export function nextLowerTier(tier) {
  if (tier === "ULTRA") return "HIGH";
  if (tier === "HIGH") return "MEDIUM";
  if (tier === "MEDIUM") return "LOW";
  return tier;
}

export function nextHigherTier(tier) {
  if (tier === "LOW") return "MEDIUM";
  if (tier === "MEDIUM") return "HIGH";
  if (tier === "HIGH") return "ULTRA";
  return tier;
}
