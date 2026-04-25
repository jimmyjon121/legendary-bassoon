#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { simulate } = require('./mosaic-simulate');

const ROOT = path.resolve(__dirname, '..');
const MOSAIC_DIR = path.join(ROOT, 'docs/perf/mosaic');
const REPORT_PATH = path.join(ROOT, 'docs/perf/mosaic-gate1.md');
const DECISION_JSON_PATH = path.join(MOSAIC_DIR, 'decision.json');

function decide({
  simulationResult,
  thresholds = { capacityMultiplier: 1.3, minBaselineFraction: 0.5 },
} = {}) {
  const result = simulationResult || simulate({ thresholds });
  const pass = result.capacityMultiplier >= thresholds.capacityMultiplier
    && result.speedFraction >= thresholds.minBaselineFraction
    && !result.assignment?.unplaced;
  return {
    schemaVersion: 1,
    decision: pass ? 'pass' : 'fail',
    model: result.model,
    capacityMultiplier: result.capacityMultiplier,
    speedFraction: result.speedFraction,
    predictedTps: result.predictedTps,
    predictedFirstTokenMs: result.predictedFirstTokenMs,
    assignment: result.assignment,
    thresholds,
    reasons: pass ? [] : (result.reasons || []),
    simulation: result,
    decidedAt: new Date().toISOString(),
  };
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function decideGate({
  sim14b = null,
  sim30b = null,
  thresholds = { capacityMultiplier: 1.3, minBaselineFraction: 0.5 },
} = {}) {
  const mandatory = decide({
    simulationResult: sim14b || simulate({ modelId: 'qwen2.5-coder:14b', thresholds }),
    thresholds,
  });
  const bestEffort30b = sim30b ? decide({ simulationResult: sim30b, thresholds }) : null;
  const pass = mandatory.decision === 'pass';
  return {
    ...mandatory,
    decision: pass ? 'pass' : 'fail',
    gateBasis: 'mandatory-14b',
    mandatory14b: mandatory,
    bestEffort30b,
    reasons: pass
      ? []
      : [
        'mandatory qwen2.5-coder:14b simulation did not satisfy Gate 1 thresholds',
        ...(mandatory.reasons || []),
      ],
  };
}

function markdownFor(decision) {
  const titleDecision = decision.decision.toUpperCase();
  return [
    '# Mosaic Gate 1 Decision',
    '',
    `**Decision:** ${titleDecision}`,
    '',
    `- **Model:** ${decision.model}`,
    `- **Capacity multiplier:** ${decision.capacityMultiplier.toFixed(3)}x (threshold ${decision.thresholds.capacityMultiplier}x)`,
    `- **Speed fraction:** ${(decision.speedFraction * 100).toFixed(1)}% of RTX-only baseline (threshold ${(decision.thresholds.minBaselineFraction * 100).toFixed(0)}%)`,
    `- **Predicted throughput:** ${decision.predictedTps.toFixed(3)} tok/s`,
    `- **Predicted first-token latency:** ${decision.predictedFirstTokenMs.toFixed(0)} ms`,
    `- **Assignment:** ${Object.entries(decision.assignment || {}).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    decision.gateBasis ? `- **Gate basis:** ${decision.gateBasis}` : null,
    decision.reasons?.length ? `- **Reasons:** ${decision.reasons.join('; ')}` : '- **Reasons:** thresholds satisfied',
    decision.bestEffort30b ? `- **Best-effort 30B:** ${decision.bestEffort30b.decision.toUpperCase()} (${decision.bestEffort30b.capacityMultiplier.toFixed(3)}x capacity, ${(decision.bestEffort30b.speedFraction * 100).toFixed(1)}% speed)` : null,
    '',
    '## Raw Decision JSON',
    '',
    '```json',
    JSON.stringify(decision, null, 2),
    '```',
    '',
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

function main() {
  const modelId = process.argv[2] || null;
  const sim14b = readJsonIfExists(path.join(MOSAIC_DIR, 'sim-14b.json'));
  const sim30b = readJsonIfExists(path.join(MOSAIC_DIR, 'sim-30b.json'));
  const decision = modelId
    ? decide({ simulationResult: simulate({ modelId }) })
    : decideGate({ sim14b, sim30b });
  fs.mkdirSync(MOSAIC_DIR, { recursive: true });
  fs.writeFileSync(DECISION_JSON_PATH, JSON.stringify(decision, null, 2), 'utf8');
  fs.writeFileSync(REPORT_PATH, markdownFor(decision), 'utf8');
  console.log(JSON.stringify(decision, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  decide,
  decideGate,
  markdownFor,
};
