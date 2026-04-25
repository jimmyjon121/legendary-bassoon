#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'docs/perf/mosaic');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function assignLayers({ model, profiles }) {
  const devices = ['rtx', 'arc', 'cpu']
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

function simulate({
  modelId = 'qwen2.5-coder:14b',
  profiles = null,
  thresholds = { capacityMultiplier: 1.3, minBaselineFraction: 0.5 },
  artifactDir = ARTIFACT_DIR,
} = {}) {
  const model = MODEL_PROFILES[modelId] || MODEL_PROFILES['qwen2.5-coder:14b'];
  const loaded = profiles || { ...defaultSyntheticProfiles(model.id), ...loadProfiles({ artifactDir }) };
  const normalized = Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, normalizeProfile(v)]));
  const assignment = assignLayers({ model, profiles: normalized });
  const estimates = estimateTps({ assignment, profiles: normalized });
  const rtx = normalized.rtx || defaultSyntheticProfiles(model.id).rtx;
  const rtxFitBytes = Number(rtx.memoryBytes || DEVICE_MEMORY.rtx);
  const rtxOnlyLayers = Math.floor(rtxFitBytes / model.bytesPerLayer);
  const rtxOnlyFootprintBytes = Math.min(model.footprintBytes, rtxOnlyLayers * model.bytesPerLayer);
  const assignedLayers = Object.entries(assignment)
    .filter(([device]) => device !== 'unplaced')
    .reduce((sum, [, layers]) => sum + Number(layers || 0), 0);
  const assignedFootprintBytes = assignedLayers * model.bytesPerLayer;
  const capacityMultiplier = rtxOnlyFootprintBytes > 0 ? assignedFootprintBytes / rtxOnlyFootprintBytes : 0;
  const baselineTps = Number(rtx.throughputTokensPerSecond || rtx.tps || 0);
  const speedFraction = baselineTps > 0 ? estimates.predictedTps / baselineTps : 0;
  const pass = capacityMultiplier >= thresholds.capacityMultiplier
    && speedFraction >= thresholds.minBaselineFraction
    && !assignment.unplaced;

  return {
    schemaVersion: 1,
    model: model.id,
    modelSpec: model,
    assignment,
    predictedTps: estimates.predictedTps,
    predictedFirstTokenMs: estimates.predictedFirstTokenMs,
    capacityMultiplier,
    speedFraction,
    baseline: {
      rtxOnlyLayers,
      rtxOnlyFootprintBytes,
      rtxOnlyTokensPerSecond: baselineTps,
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
      capacityMultiplier >= thresholds.capacityMultiplier ? null : `capacityMultiplier ${capacityMultiplier.toFixed(3)} < ${thresholds.capacityMultiplier}`,
      speedFraction >= thresholds.minBaselineFraction ? null : `speedFraction ${speedFraction.toFixed(3)} < ${thresholds.minBaselineFraction}`,
      assignment.unplaced ? `${assignment.unplaced} layer(s) unplaced` : null,
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
  simulate,
  loadProfiles,
  defaultSyntheticProfiles,
};
