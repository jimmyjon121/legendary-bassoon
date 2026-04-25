#!/usr/bin/env node
/* eslint-disable no-console */

const {
  makeProfile,
  queryNvidiaSmi,
  writeProfile,
} = require('./mosaic-profile-utils');

function main() {
  const gpu = queryNvidiaSmi();
  const bandwidthGBps = Number(process.env.MOSAIC_REBAR_GBPS || 16);
  const profile = makeProfile({
    device: 'rebar',
    model: 'transfer',
    throughputTokensPerSecond: 0,
    latencyMs: 0,
    hardware: gpu,
    samples: [{ method: 'nvidia-smi-estimate', bandwidthGBps, gpu }],
    source: gpu.error ? 'fallback' : 'live',
    fallbackReason: gpu.error ? gpu.error : null,
    error: null,
  });
  profile.runMeta.bandwidthGBps = bandwidthGBps;
  profile.runMeta.method = 'nvidia-smi-estimate';
  const out = writeProfile('rebar', profile);
  console.log(`wrote ${out}`);
}

try {
  main();
} catch (error) {
  console.error(`mosaic-profile-rebar FAILED: ${error?.message || error}`);
  process.exit(1);
}
