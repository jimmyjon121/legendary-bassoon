#!/usr/bin/env node
/* eslint-disable no-console */

const { probeRuntime } = require('../electron/services/mosaic-coordinator');

const runnerPath = process.argv[2] || process.env.DEVFORGE_MOSAIC_RUNNER || null;
const result = probeRuntime({
  runnerPath,
  requireCombinedBackends: process.env.MOSAIC_PROBE_REQUIRE_COMBINED !== '0',
});

console.log(JSON.stringify(result, null, 2));
if (!result.available) process.exit(1);
