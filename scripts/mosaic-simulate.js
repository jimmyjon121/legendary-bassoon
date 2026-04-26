#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'docs/perf/mosaic');

// Reference targets used to project tps/first-token at a particular model
// size. The simulator's capacity decision is independent of which test
// model is asked about — capacity is a device-pool property — but tps/
// first-token estimates are per-target since per-layer cost scales with
// model layer count and bytes-per-layer.
const MODEL_PROFILES = {
  'qwen2.5-coder:14b': {
    id: 'qwen2.5-coder:14b',
    totalLayers: 48,
    footprintBytes: 9.0 * 1024 ** 3,
    bytesPerLayer: (9.0 * 1024 ** 3) / 48,
    kvBytesPerToken: 512 * 1024,
    nCtx: 4096,
  },
  'qwen3-30b-abliterated:q4_k_m': {
    id: 'qwen3-30b-abliterated:q4_k_m',
    totalLayers: 64,
    footprintBytes: 18.0 * 1024 ** 3,
    bytesPerLayer: (18.0 * 1024 ** 3) / 64,
    kvBytesPerToken: 768 * 1024,
    nCtx: 4096,
  },
};

const DEVICE_MEMORY = {
  rtx: 7.5 * 1024 ** 3,
  arc: 10 * 1024 ** 3,
  cpu: 18 * 1024 ** 3,
  npu: 1.5 * 1024 ** 3,
};

const ASSIGNABLE_DEVICES = ['rtx', 'arc', 'cpu'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function mean(values, fallback = 0) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (nums.length === 0) return fallback;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function normalizeProfile(profile) {
  const device = String(profile?.device || '').trim();
  const decodeMs = mean(profile?.decodeMsPerLayer, 100);
  const prefillMs = mean(profile?.prefillMsPerLayer, decodeMs * 2);
  const memBytes = mean(profile?.memBytes, 0);
  const memoryBytes = Number(profile?.hardware?.memoryBytes || DEVICE_MEMORY[device] || 0);
  const tps = Number(profile?.throughputTokensPerSecond) || (decodeMs > 0 ? 1000 / decodeMs : 0);
  return {
    ...profile,
    device,
    decodeMs,
    prefillMs,
    memBytes,
    memoryBytes,
    tps,
  };
}

function loadProfiles({ artifactDir = ARTIFACT_DIR } = {}) {
  const files = ['profile-rtx.json', 'profile-arc.json', 'profile-npu.json', 'profile-cpu.json', 'profile-rebar.json'];
  const profiles = {};
  for (const file of files) {
    const filePath = path.join(artifactDir, file);
    if (!fs.existsSync(filePath)) continue;
    const profile = normalizeProfile(readJson(filePath));
    profiles[profile.device] = profile;
  }
  return profiles;
}

function defaultSyntheticProfiles(modelId) {
  const model = MODEL_PROFILES[modelId] || MODEL_PROFILES['qwen2.5-coder:14b'];
  const layerBytes = model.bytesPerLayer;
  const mk = (device, decodeMs, prefillMs, memoryBytes, tps, source = 'synthetic') => normalizeProfile({
    schemaVersion: 1,
    device,
    model: model.id,
    createdAt: new Date().toISOString(),
    hardware: { memoryBytes },
    prefillMsPerLayer: [prefillMs],
    decodeMsPerLayer: [decodeMs],
    memBytes: [layerBytes],
    throughputTokensPerSecond: tps,
    runMeta: { source, samples: [], error: null },
  });
  return {
    rtx: mk('rtx', 0.7, 1.4, DEVICE_MEMORY.rtx, 32),
    arc: mk('arc', 1.6, 3.2, DEVICE_MEMORY.arc, 14),
    cpu: mk('cpu', 5.0, 10.0, DEVICE_MEMORY.cpu, 4),
    npu: mk('npu', 4.0, 8.0, DEVICE_MEMORY.npu, 5),
    rebar: normalizeProfile({
      schemaVersion: 1,
      device: 'rebar',
      model: 'transfer',
      createdAt: new Date().toISOString(),
      hardware: {},
      prefillMsPerLayer: [0],
      decodeMsPerLayer: [0],
      memBytes: [0],
      throughputTokensPerSecond: 0,
      runMeta: { source: 'synthetic', bandwidthGBps: 16, method: 'default' },
    }),
  };
}

function assignLayers({ model, profiles, allowedDevices = ASSIGNABLE_DEVICES }) {
  const devices = allowedDevices
    .map((id) => profiles[id])
    .filter(Boolean)
    .sort((a, b) => a.decodeMs - b.decodeMs);

  const assignment = {};
  const remainingMemory = {};
  for (const profile of devices) {
    assignment[profile.device] = 0;
    remainingMemory[profile.device] = Number(profile.memoryBytes || 0);
  }

  for (let layer = 0; layer < model.totalLayers; layer += 1) {
    let placed = false;
    for (const profile of devices) {
      if (remainingMemory[profile.device] >= model.bytesPerLayer) {
        assignment[profile.device] += 1;
        remainingMemory[profile.device] -= model.bytesPerLayer;
        placed = true;
        break;
      }
    }
    if (!placed) {
      assignment.unplaced = (assignment.unplaced || 0) + 1;
    }
  }
  return assignment;
}

function estimateTps({ assignment, profiles }) {
  let decodeMs = 0;
  let prefillMs = 0;
  for (const [device, layers] of Object.entries(assignment)) {
    if (device === 'unplaced') continue;
    const profile = profiles[device];
    if (!profile) continue;
    decodeMs += Number(layers) * profile.decodeMs;
    prefillMs += Number(layers) * profile.prefillMs;
  }
  const predictedTps = decodeMs > 0 ? 1000 / decodeMs : 0;
  return { predictedTps, predictedFirstTokenMs: prefillMs };
}

// Mosaic Gate 1 capacity is a *device pool* property: how much model
// footprint can be hosted across allowed devices vs how much fits on
// RTX alone. It is independent of any one test model's layer count.
function deviceCapacity(profiles, allowedDevices = ASSIGNABLE_DEVICES) {
  let total = 0;
  let rtx = 0;
  for (const id of allowedDevices) {
    const p = profiles[id];
    if (!p) continue;
    const bytes = Number(p.memoryBytes || 0);
    total += bytes;
    if (id === 'rtx') rtx = bytes;
  }
  return { totalCapacityBytes: total, rtxCapacityBytes: rtx };
}

function rtxOnlyEstimateTps(profiles, model) {
  const rtx = profiles.rtx;
  const cpu = profiles.cpu;
  if (!rtx) return { predictedTps: 0, rtxLayers: 0, cpuLayers: 0, predictedFirstTokenMs: 0 };
  const rtxLayers = Math.min(model.totalLayers, Math.floor((rtx.memoryBytes || 0) / model.bytesPerLayer));
  const cpuLayers = Math.max(0, model.totalLayers - rtxLayers);
  const decodeMs = rtxLayers * rtx.decodeMs + (cpu ? cpuLayers * cpu.decodeMs : 0);
  const prefillMs = rtxLayers * rtx.prefillMs + (cpu ? cpuLayers * cpu.prefillMs : 0);
  return {
    predictedTps: decodeMs > 0 ? 1000 / decodeMs : 0,
    rtxLayers,
    cpuLayers,
    predictedFirstTokenMs: prefillMs,
  };
}

function simulate({
  modelId = 'qwen2.5-coder:14b',
  profiles = null,
  thresholds = { capacityMultiplier: 1.3, minBaselineFraction: 0.5 },
  artifactDir = ARTIFACT_DIR,
} = {}) {
  const model = MODEL_PROFILES[modelId] || MODEL_PROFILES['qwen2.5-coder:14b'];
  const loaded = profiles || { ...defaultSyntheticProfiles(model.id), ...loadProfiles({ artifactDir }) };
  const normalized = Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, normalizeProfile(v)]));

  // Mosaic placement (RTX + Arc + CPU) for the requested test model.
  const assignment = assignLayers({ model, profiles: normalized });
  const estimates = estimateTps({ assignment, profiles: normalized });

  // Capacity is a device-pool property (Gate 1 spec).
  const { totalCapacityBytes, rtxCapacityBytes } = deviceCapacity(normalized);
  const capacityMultiplier = rtxCapacityBytes > 0 ? totalCapacityBytes / rtxCapacityBytes : 0;

  // Speed baseline: RTX-only partial offload of the same test model
  // (RTX as many layers as fit, remainder on CPU). This keeps the speed
  // gate honest even though capacity is computed pool-wide.
  const baseline = rtxOnlyEstimateTps(normalized, model);
  const baselineTps = baseline.predictedTps
    || Number(normalized.rtx?.throughputTokensPerSecond || normalized.rtx?.tps || 0);
  const speedFraction = baselineTps > 0 ? estimates.predictedTps / baselineTps : 0;

  const passCapacity = capacityMultiplier >= thresholds.capacityMultiplier;
  const passSpeed = speedFraction >= thresholds.minBaselineFraction;
  const passNoUnplaced = !assignment.unplaced;
  const pass = passCapacity && passSpeed && passNoUnplaced;

  return {
    schemaVersion: 2,
    model: model.id,
    modelSpec: model,
    assignment,
    predictedTps: estimates.predictedTps,
    predictedFirstTokenMs: estimates.predictedFirstTokenMs,
    capacityMultiplier,
    speedFraction,
    capacity: {
      totalCapacityBytes,
      rtxCapacityBytes,
      definition: 'pool-wide assignable memory ÷ RTX-only assignable memory',
    },
    baseline: {
      rtxLayers: baseline.rtxLayers,
      cpuLayers: baseline.cpuLayers,
      rtxOnlyTokensPerSecond: baselineTps,
      definition: 'RTX + CPU partial offload of same test model',
      thresholds,
    },
    profilesUsed: Object.fromEntries(Object.entries(normalized).map(([id, p]) => [id, {
      source: p.runMeta?.source || 'unknown',
      throughputTokensPerSecond: p.throughputTokensPerSecond || p.tps || 0,
      memoryBytes: p.memoryBytes || 0,
      error: p.runMeta?.error || null,
    }])),
    decision: pass ? 'pass' : 'fail',
    reasons: [
      passCapacity ? null : `capacityMultiplier ${capacityMultiplier.toFixed(3)} < ${thresholds.capacityMultiplier}`,
      passSpeed ? null : `speedFraction ${speedFraction.toFixed(3)} < ${thresholds.minBaselineFraction}`,
      passNoUnplaced ? null : `${assignment.unplaced} layer(s) unplaced`,
    ].filter(Boolean),
    generatedAt: new Date().toISOString(),
  };
}

function main() {
  const modelId = process.argv[2] || 'qwen2.5-coder:14b';
  const result = simulate({ modelId });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  MODEL_PROFILES,
  DEVICE_MEMORY,
  simulate,
  loadProfiles,
  defaultSyntheticProfiles,
  deviceCapacity,
  rtxOnlyEstimateTps,
  assignLayers,
};
