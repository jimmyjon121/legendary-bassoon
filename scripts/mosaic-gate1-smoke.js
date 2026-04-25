#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { simulate, defaultSyntheticProfiles } = require('./mosaic-simulate');
const { decide } = require('./mosaic-gate1-decide');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function main() {
  const failures = [];
  const architecture = fs.readFileSync(path.join(ROOT, 'docs/mosaic-architecture.md'), 'utf8');
  const schema = fs.readFileSync(path.join(ROOT, 'docs/perf/mosaic/README.md'), 'utf8');
  const simSource = fs.readFileSync(path.join(ROOT, 'scripts/mosaic-simulate.js'), 'utf8');
  const decideSource = fs.readFileSync(path.join(ROOT, 'scripts/mosaic-gate1-decide.js'), 'utf8');

  assert(architecture.includes('Gate 1 Decision Rule'), 'mosaic architecture doc must define Gate 1 decision rule', failures);
  assert(schema.includes('Device Profile Schema'), 'mosaic profile README must document device profile schema', failures);
  assert(simSource.includes('function simulate('), 'mosaic-simulate must export simulate(...)', failures);
  assert(decideSource.includes('function decide('), 'mosaic-gate1-decide must export decide(...)', failures);

  const synthetic = defaultSyntheticProfiles('qwen2.5-coder:14b');
  const result = simulate({ modelId: 'qwen2.5-coder:14b', profiles: synthetic });
  assert(result.schemaVersion === 1, 'simulation result must include schemaVersion=1', failures);
  assert(result.model === 'qwen2.5-coder:14b', 'simulation result must include target model id', failures);
  assert(result.assignment && typeof result.assignment === 'object', 'simulation result must include layer assignment', failures);
  assert(Number.isFinite(result.predictedTps), 'simulation result must include predictedTps', failures);
  assert(Number.isFinite(result.predictedFirstTokenMs), 'simulation result must include predictedFirstTokenMs', failures);
  assert(Number.isFinite(result.capacityMultiplier), 'simulation result must include capacityMultiplier', failures);
  assert(result.baseline && typeof result.baseline === 'object', 'simulation result must include baseline', failures);
  assert(['pass', 'fail', 'pending'].includes(result.decision), 'simulation result must include a valid decision label', failures);

  const decision = decide({ simulationResult: result });
  assert(['pass', 'fail'].includes(decision.decision), 'decision script must emit pass/fail', failures);
  assert(decision.thresholds?.capacityMultiplier === 1.3, 'decision script must apply 1.3x capacity threshold by default', failures);
  assert(decision.thresholds?.minBaselineFraction === 0.5, 'decision script must apply 50% speed threshold by default', failures);
  assert(decision.simulation?.model === result.model, 'decision must embed source simulation', failures);

  if (failures.length) {
    console.error('mosaic-gate1-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('mosaic-gate1-smoke PASS');
}

main();
