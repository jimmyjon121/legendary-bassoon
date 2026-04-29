/**
 * Mosaic coordinator facade.
 *
 * Phase 3 keeps Mosaic as hidden R&D. This module defines the stable
 * control-plane API the Electron app uses while attempting to load the
 * future Rust napi-rs native addon when it exists. Until then, the JS
 * implementation returns deterministic plans and explicit blocked states
 * instead of touching the normal chat runtime.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MOSAIC_DIR = path.join(ROOT, 'docs', 'perf', 'mosaic');
const DEFAULT_GATE2_MODEL = 'deepseek-coder:33b';
const GATE2_SPEEDUP_THRESHOLD = 1.5;

function isMosaicRuntimeEnabled(env = process.env) {
  return env.DEVFORGE_MOSAIC_DEV === '1' && env.DEVFORGE_MOSAIC_ENABLE === '1';
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function loadMosaicProfiles(artifactDir = MOSAIC_DIR) {
  const profiles = {};
  for (const id of ['rtx', 'arc', 'npu', 'cpu', 'rebar']) {
    profiles[id] = readJson(path.join(artifactDir, `profile-${id}.json`));
  }
  return profiles;
}

function tryLoadNative() {
  const candidates = [
    path.join(ROOT, 'native', 'mosaic-coordinator', 'index.node'),
    path.join(ROOT, 'native', 'mosaic-coordinator', 'mosaic_coordinator.node'),
    path.join(ROOT, 'electron', 'native', 'mosaic-coordinator.node'),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const native = require(candidate);
      const probe = native?.probeRuntime || native?.probe_runtime;
      if (typeof probe === 'function') {
        return {
          native: {
            probeRuntime: (options) => probe(options),
          },
          path: candidate,
        };
      }
    } catch {
      // Keep trying; missing native builds are expected in the JS fallback path.
    }
  }
  return { native: null, path: null };
}

function commandLooksLikePath(command) {
  return /[\\/]/.test(command) || /^[a-zA-Z]:/.test(command) || /\.(exe|cmd|bat)$/i.test(command);
}

function runProbeCommand(command, args) {
  try {
    return spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 512 * 1024,
    });
  } catch (error) {
    return { error };
  }
}

function discoverWingetLlamaCli() {
  const packagesDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  const candidates = [];
  try {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith('ggml.llamacpp_')) continue;
      candidates.push(path.join(packagesDir, entry.name, 'llama-cli.exe'));
    }
  } catch {
    // Winget is optional; PATH/configured runners are checked separately.
  }
  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function listRunnerDevices(command) {
  const result = runProbeCommand(command, ['--list-devices']);
  if (result.error) return [];
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(CUDA|Vulkan|Metal|SYCL|RPC)(\d+):\s+(.+?)(?:\s+\(|$)/i);
      if (!match) return null;
      return {
        id: `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}${match[2]}`,
        backend: match[1],
        index: Number(match[2]),
        name: match[3].trim(),
      };
    })
    .filter(Boolean);
}

function inferRunnerKind(command, helpText) {
  const base = path.basename(String(command || '')).toLowerCase();
  const text = String(helpText || '').toLowerCase();
  if (base.includes('server') || text.includes('llama-server')) return 'server';
  if (base.includes('bench') || text.includes('llama-bench')) return 'bench';
  if (base.includes('cli') || text.includes('llama-cli')) return 'cli';
  if (base === 'main' || base.includes('llama-main')) return 'cli';
  return 'unknown';
}

function probeRunnerCandidate(command, source) {
  const version = runProbeCommand(command, ['--version']);
  if (version.error) return null;
  const help = runProbeCommand(command, ['--help']);
  const fallbackHelp = help.error ? runProbeCommand(command, ['-h']) : null;
  const helpText = `${version.stdout || ''}\n${version.stderr || ''}\n${help.stdout || ''}\n${help.stderr || ''}\n${fallbackHelp?.stdout || ''}\n${fallbackHelp?.stderr || ''}`;
  const capabilities = {
    prompt: /(^|\s)(-p|--prompt)\b/i.test(helpText),
    context: /(^|\s)(-c|--ctx-size|--context-size)\b/i.test(helpText),
    gpuLayers: /(-ngl|--n-gpu-layers|--gpu-layers)\b/i.test(helpText),
    splitMode: /--split-mode\b/i.test(helpText),
    tensorSplit: /--tensor-split\b/i.test(helpText),
    device: /--device\b/i.test(helpText),
    temperature: /--temp(?:erature)?\b/i.test(helpText),
  };
  const required = ['prompt', 'context', 'gpuLayers', 'splitMode', 'tensorSplit', 'temperature'];
  const missingCapabilities = required.filter((name) => !capabilities[name]);
  const kind = inferRunnerKind(command, helpText);
  const compatible = kind === 'cli' && missingCapabilities.length === 0;
  const devices = compatible ? listRunnerDevices(command) : [];
  return {
    available: true,
    compatible,
    path: command,
    source,
    kind,
    version: String(version.stdout || version.stderr || '').trim().slice(0, 240) || null,
    capabilities,
    devices,
    missingCapabilities,
  };
}

function detectRunner(runnerPath = null) {
  const configured = [
    runnerPath || process.env.DEVFORGE_MOSAIC_RUNNER,
    process.env.LLAMA_CPP_CLI_PATH,
    process.env.LLAMA_CPP_SERVER_PATH,
    process.env.LLAMA_CPP_BENCH_PATH,
    ...discoverWingetLlamaCli(),
  ].filter(Boolean);

  const configuredResults = [];
  for (const candidate of configured) {
    if (commandLooksLikePath(candidate) && !fs.existsSync(candidate)) {
      configuredResults.push({
        available: false,
        compatible: false,
        path: candidate,
        source: 'configured',
        blockedReason: 'configured_runner_path_missing',
      });
      continue;
    }
    const result = probeRunnerCandidate(candidate, 'configured');
    if (result?.compatible) return result;
    if (result) configuredResults.push(result);
  }
  if (configuredResults.length > 0) {
    return configuredResults.find((result) => result.available) || configuredResults[0];
  }

  const discovered = [];
  for (const command of ['llama-cli', 'llama-cli.exe', 'main', 'llama-main', 'llama-server', 'llama-bench']) {
    const result = probeRunnerCandidate(command, 'path');
    if (result?.compatible) return result;
    if (result) discovered.push(result);
  }

  return discovered[0] || {
    available: false,
    compatible: false,
    path: null,
    source: null,
    blockedReason: 'runner_unavailable',
  };
}

function probeRuntime(options = {}) {
  const { native, path: nativePath } = tryLoadNative();
  if (native) {
    try {
      return {
        ...native.probeRuntime({ artifactDir: MOSAIC_DIR, ...(options || {}) }),
        native: true,
        nativePath,
      };
    } catch (error) {
      return {
        available: false,
        native: true,
        nativePath,
        blockedReason: 'native_probe_failed',
        error: error?.message || String(error),
      };
    }
  }

  const runner = detectRunner(options.runnerPath);
  const profiles = loadMosaicProfiles(options.artifactDir);
  const arcLive = profiles.arc?.runMeta?.source === 'live';
  const rtxLive = profiles.rtx?.runMeta?.source === 'live';
  const cpuLive = profiles.cpu?.runMeta?.source === 'live';
  const requireCombinedBackends = options.requireCombinedBackends !== false;

  const blockers = [];
  if (!runner.available) blockers.push('runner_unavailable');
  if (runner.available && !runner.compatible) blockers.push('runner_incompatible');
  if (requireCombinedBackends && runner.available && runner.compatible && !runner.capabilities?.device) {
    blockers.push('runner_missing_device_assignment');
  }
  if (requireCombinedBackends && !arcLive) blockers.push('blocked_arc_not_live');
  if (!rtxLive) blockers.push('rtx_profile_not_live');
  if (!cpuLive) blockers.push('cpu_profile_not_live');

  return {
    available: blockers.length === 0,
    native: false,
    backend: 'js-fallback',
    runner,
    host: {
      platform: process.platform,
      arch: process.arch,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
    },
    devices: {
      cuda: Boolean(profiles.rtx),
      vulkanArc: Boolean(profiles.arc),
      cpu: Boolean(profiles.cpu),
      npu: Boolean(profiles.npu),
      rebar: Boolean(profiles.rebar),
    },
    profiles: {
      rtx: profiles.rtx?.runMeta?.source || null,
      arc: profiles.arc?.runMeta?.source || null,
      cpu: profiles.cpu?.runMeta?.source || null,
      npu: profiles.npu?.runMeta?.source || null,
      rebar: profiles.rebar?.runMeta?.source || null,
    },
    blockedReason: blockers[0] || null,
    blockers,
    note: 'Rust napi-rs addon not built; JS fallback can plan and gate but cannot execute custom kernels.',
  };
}

function profileMemoryBytes(profile, fallback = 0) {
  return Number(profile?.hardware?.memoryBytes || fallback) || fallback;
}

function pickRuntimeDevices(runtime = null) {
  const devices = Array.isArray(runtime?.runner?.devices) ? runtime.runner.devices : [];
  const primary = devices.find((device) => /nvidia|rtx|geforce/i.test(`${device.id} ${device.name}`))
    || devices.find((device) => /cuda|vulkan|metal|sycl/i.test(device.backend || device.id))
    || { id: 'CUDA0', name: 'Primary GPU' };
  const secondary = devices.find((device) => device.id !== primary.id && /intel|arc/i.test(`${device.id} ${device.name}`))
    || devices.find((device) => device.id !== primary.id)
    || { id: 'Vulkan0', name: 'Secondary GPU' };
  return {
    primaryGpu: primary.id,
    arcGpu: secondary.id,
    runnerDevices: devices,
  };
}

function planPlacement({
  modelPath,
  modelId = DEFAULT_GATE2_MODEL,
  profiles = null,
  contextSize = 4096,
  target = 'gate2',
  runtime = null,
} = {}) {
  const loadedProfiles = profiles || loadMosaicProfiles();
  const rtxBytes = profileMemoryBytes(loadedProfiles.rtx, 7.5 * 1024 ** 3);
  const arcBytes = profileMemoryBytes(loadedProfiles.arc, 10 * 1024 ** 3);
  const cpuBytes = profileMemoryBytes(loadedProfiles.cpu, Math.max(1, os.totalmem() - 8 * 1024 ** 3));
  const total = Math.max(1, rtxBytes + arcBytes + cpuBytes);
  const rtxWeight = rtxBytes / total;
  const arcWeight = arcBytes / total;
  const cpuWeight = cpuBytes / total;
  const runtimeDevices = pickRuntimeDevices(runtime);
  const envTensorSplit = process.env.MOSAIC_TENSOR_SPLIT;
  const baselineGpuLayers = Number(process.env.MOSAIC_BASELINE_GPU_LAYERS || 20);
  const mosaicGpuLayers = Number(process.env.MOSAIC_MOSAIC_GPU_LAYERS || 24);

  return {
    schemaVersion: 1,
    target,
    modelId,
    modelPath: modelPath || null,
    contextSize: Number(contextSize) || 4096,
    threshold: {
      speedup: GATE2_SPEEDUP_THRESHOLD,
    },
    assignment: {
      rtxWeight,
      arcWeight,
      cpuWeight,
      devices: [runtimeDevices.primaryGpu, runtimeDevices.arcGpu, 'CPU'],
      runnerDevices: runtimeDevices.runnerDevices,
    },
    baseline: {
      mode: 'baseline',
      devices: [runtimeDevices.primaryGpu],
      gpuLayers: Number.isFinite(baselineGpuLayers) ? baselineGpuLayers : 20,
      splitMode: 'layer',
      tensorSplit: '1',
      fit: 'on',
    },
    mosaic: {
      mode: 'mosaic',
      devices: [runtimeDevices.primaryGpu, runtimeDevices.arcGpu],
      gpuLayers: Number.isFinite(mosaicGpuLayers) ? mosaicGpuLayers : 99,
      splitMode: 'layer',
      tensorSplit: envTensorSplit || '0.750,0.250',
      fit: 'on',
    },
  };
}

function buildLaunchArgs({ plan, mode = 'mosaic' } = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Mosaic launch plan is required');
  }
  const selected = (mode === 'baseline' ? plan.baseline : plan.mosaic) || plan;
  const modelPath = selected.modelPath || plan.modelPath;
  if (!modelPath) {
    throw new Error('Mosaic launch plan is missing modelPath');
  }
  const args = [];
  const pushArg = (flag, value) => {
    if (value === null || value === undefined || value === '') return;
    args.push(flag, String(value));
  };
  pushArg('-m', modelPath);
  pushArg('-c', selected.contextSize || plan.contextSize || 4096);
  pushArg('-ngl', selected.gpuLayers || plan.gpuLayers || 99);
  pushArg('--split-mode', selected.splitMode || 'layer');
  pushArg('--tensor-split', selected.tensorSplit || '1');
  pushArg('--device', (selected.devices || []).join(','));
  pushArg('--fit', selected.fit || plan.fit || 'on');
  args.push('--single-turn', '--simple-io');
  return args;
}

function buildGate2Decision({
  status = 'blocked',
  model = DEFAULT_GATE2_MODEL,
  baseline = null,
  mosaic = null,
  reason = null,
  plan = null,
} = {}) {
  const baselineTps = Number(baseline?.avgTokensPerSecond || baseline?.tokensPerSecond || 0);
  const mosaicTps = Number(mosaic?.avgTokensPerSecond || mosaic?.tokensPerSecond || 0);
  const speedup = baselineTps > 0 ? mosaicTps / baselineTps : 0;
  const pass = status === 'pass' || (status !== 'blocked' && speedup >= GATE2_SPEEDUP_THRESHOLD);
  const finalStatus = status === 'blocked' ? 'blocked' : (pass ? 'pass' : 'fail');
  return {
    schemaVersion: 1,
    gate: 'mosaic-gate2',
    status: finalStatus,
    decision: finalStatus,
    model,
    threshold: { speedup: GATE2_SPEEDUP_THRESHOLD },
    baseline,
    mosaic,
    speedup,
    reason: finalStatus === 'blocked' ? reason : (pass ? null : (reason || `speedup ${speedup.toFixed(3)} < ${GATE2_SPEEDUP_THRESHOLD}`)),
    plan,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_GATE2_MODEL,
  GATE2_SPEEDUP_THRESHOLD,
  MOSAIC_DIR,
  buildGate2Decision,
  buildLaunchArgs,
  isMosaicRuntimeEnabled,
  loadMosaicProfiles,
  planPlacement,
  probeRuntime,
};
