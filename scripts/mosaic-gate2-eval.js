#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const {
  DEFAULT_GATE2_MODEL,
  MOSAIC_DIR,
  buildGate2Decision,
  buildLaunchArgs,
  isMosaicRuntimeEnabled,
  planPlacement,
  probeRuntime,
} = require('../electron/services/mosaic-coordinator');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'docs', 'perf', 'mosaic-gate2.md');
const DECISION_PATH = path.join(MOSAIC_DIR, 'gate2-decision.json');
// Canonical Gate 2 target: deepseek-coder:33b at a 1.5x Mosaic speedup threshold.
const CANONICAL_GATE2_MODEL = 'deepseek-coder:33b';
const MODEL = process.env.MOSAIC_GATE2_MODEL || DEFAULT_GATE2_MODEL || CANONICAL_GATE2_MODEL;
const CONTEXT_SIZE = Number(process.env.MOSAIC_GATE2_NUM_CTX) || 4096;
const TURN_TIMEOUT_MS = Number(process.env.MOSAIC_GATE2_TURN_TIMEOUT_MS) || 180000;
const RAM_WATCHDOG_MIN_FREE_BYTES = Number(process.env.MOSAIC_GATE2_MIN_FREE_GB || 2) * 1024 ** 3;
const GATE2_STATUSES = ['pass', 'fail', 'blocked'];

const PROMPTS = [
  'Write a compact TypeScript function that validates a JSON config object and returns a list of errors.',
  'Explain how to debug a memory leak in an Electron app in five concrete steps.',
  'Refactor this idea into a concise architecture note: local models, model picker, multi-device runtime, safe fallbacks.',
];

function ensureDir() {
  fs.mkdirSync(MOSAIC_DIR, { recursive: true });
}

function resolveOllamaBlobPath(model) {
  const result = spawnSync('ollama', ['show', model, '--modelfile'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  if (result.error) {
    return { success: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { success: false, error: (result.stderr || result.stdout || '').trim() || `ollama show exited ${result.status}` };
  }
  const text = String(result.stdout || '');
  const match = text.match(/^FROM\s+(.+)$/mi);
  if (!match) return { success: false, error: 'Modelfile did not contain FROM path' };
  const modelPath = match[1].trim().replace(/^"|"$/g, '');
  if (!fs.existsSync(modelPath)) {
    return { success: false, error: `Resolved model path does not exist: ${modelPath}`, modelPath };
  }
  return { success: true, modelPath };
}

function writeArtifacts(decision) {
  ensureDir();
  fs.writeFileSync(DECISION_PATH, JSON.stringify(decision, null, 2), 'utf8');
  fs.writeFileSync(REPORT_PATH, markdownFor(decision), 'utf8');
}

function markdownFor(decision) {
  const status = String(decision.status || decision.decision || 'blocked').toUpperCase();
  return [
    '# Mosaic Gate 2 Decision',
    '',
    `**Decision:** ${status}`,
    '',
    `- **Model:** ${decision.model}`,
    `- **Threshold:** ${decision.threshold?.speedup || 1.5}x baseline throughput`,
    `- **Speedup:** ${Number(decision.speedup || 0).toFixed(3)}x`,
    `- **Baseline TPS:** ${Number(decision.baseline?.avgTokensPerSecond || 0).toFixed(3)}`,
    `- **Mosaic TPS:** ${Number(decision.mosaic?.avgTokensPerSecond || 0).toFixed(3)}`,
    decision.reason ? `- **Reason:** ${decision.reason}` : null,
    '',
    '## Raw Decision JSON',
    '',
    '```json',
    JSON.stringify(decision, null, 2),
    '```',
    '',
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

function blocked(reason, extra = {}) {
  const decision = buildGate2Decision({
    status: 'blocked',
    model: MODEL,
    reason,
    ...extra,
  });
  writeArtifacts(decision);
  console.log(JSON.stringify(decision, null, 2));
  return decision;
}

function parseTokensPerSecond(output, elapsedMs) {
  const text = String(output || '');
  const matches = [
    text.match(/([\d.]+)\s*tokens?\s*per\s*second/i),
    text.match(/([\d.]+)\s*tok\/s/i),
    text.match(/Generation:\s*([\d.]+)\s*t\/s/i),
    text.match(/tg\s*=\s*[\d.]+\s*ms\s*\/\s*tok,\s*([\d.]+)\s*t\/s/i),
  ].filter(Boolean);
  if (matches.length > 0) {
    const value = Number(matches[0][1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const approxTokens = Math.max(1, Math.round(text.length / 4));
  return approxTokens / Math.max(0.001, elapsedMs / 1000);
}

function runRunner({ runnerPath, args, prompt }) {
  const startedAt = Date.now();
  const finalArgs = [...args];
  const pushMissing = (...items) => {
    if (!finalArgs.includes(items[0])) finalArgs.push(...items);
  };
  pushMissing('-n', String(Number(process.env.MOSAIC_GATE2_NUM_PREDICT) || 96));
  pushMissing('--temp', '0');
  pushMissing('--single-turn');
  pushMissing('--simple-io');
  finalArgs.push('-p', prompt);

  if (os.freemem() < RAM_WATCHDOG_MIN_FREE_BYTES) {
    return Promise.resolve({
      ok: false,
      error: `ram_watchdog_preflight_free_bytes_${os.freemem()}`,
      elapsedMs: 0,
      tokensPerSecond: 0,
    });
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let killedReason = null;
    let timeoutId = null;
    let ramWatchdogId = null;
    const child = spawn(runnerPath, finalArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const cleanup = () => {
      clearTimeout(timeoutId);
      clearInterval(ramWatchdogId);
      if (!child.killed && child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGTERM'); } catch {}
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const append = (current, chunk) => {
      const next = current + chunk.toString();
      return next.length > 8 * 1024 * 1024 ? next.slice(-8 * 1024 * 1024) : next;
    };

    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => {
      finish({ ok: false, error: error.message, elapsedMs: Date.now() - startedAt, tokensPerSecond: 0 });
    });
    child.on('close', (code, signal) => {
      const elapsedMs = Date.now() - startedAt;
      const combined = `${stdout}\n${stderr}`;
      if (killedReason) {
        finish({ ok: false, error: killedReason, elapsedMs, tokensPerSecond: 0 });
        return;
      }
      if (code !== 0) {
        finish({ ok: false, error: combined.trim() || `runner exited ${code || signal}`, elapsedMs, tokensPerSecond: 0 });
        return;
      }
      finish({
        ok: true,
        elapsedMs,
        tokensPerSecond: parseTokensPerSecond(combined, elapsedMs),
      });
    });

    timeoutId = setTimeout(() => {
      killedReason = `turn_timeout_${TURN_TIMEOUT_MS}ms`;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (!settled && child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }, 2500).unref?.();
    }, TURN_TIMEOUT_MS);

    ramWatchdogId = setInterval(() => {
      if (os.freemem() >= RAM_WATCHDOG_MIN_FREE_BYTES) return;
      killedReason = `ram_watchdog_free_bytes_${os.freemem()}`;
      try { child.kill('SIGTERM'); } catch {}
    }, 1000);

    timeoutId.unref?.();
    ramWatchdogId.unref?.();
  });
}

function summarizeRuns(runs) {
  const good = runs.filter((run) => run.ok && Number(run.tokensPerSecond) > 0);
  const avgTokensPerSecond = good.length
    ? good.reduce((sum, run) => sum + Number(run.tokensPerSecond || 0), 0) / good.length
    : 0;
  return {
    promptsTotal: runs.length,
    promptsMeasured: good.length,
    failures: runs.length - good.length,
    avgTokensPerSecond,
    runs,
  };
}

async function main() {
  if (!isMosaicRuntimeEnabled()) {
    blocked('mosaic_disabled_requires_DEVFORGE_MOSAIC_DEV_and_ENABLE');
    return;
  }

  const resolved = resolveOllamaBlobPath(MODEL);
  if (!resolved.success) {
    blocked('gate2_model_unavailable', { baseline: { error: resolved.error } });
    return;
  }

  const probe = probeRuntime({ requireCombinedBackends: true });
  if (!probe.available) {
    blocked(probe.blockedReason || 'mosaic_runtime_blocked', { baseline: { modelPath: resolved.modelPath }, mosaic: { probe } });
    return;
  }

  const runnerPath = probe.runner?.path || process.env.DEVFORGE_MOSAIC_RUNNER;
  if (!runnerPath) {
    blocked('runner_unavailable_after_probe', { baseline: { modelPath: resolved.modelPath }, mosaic: { probe } });
    return;
  }

  const plan = planPlacement({
    modelPath: resolved.modelPath,
    modelId: MODEL,
    contextSize: CONTEXT_SIZE,
    target: 'gate2',
    runtime: probe,
  });
  const baselineArgs = buildLaunchArgs({ plan, mode: 'baseline' });
  const mosaicArgs = buildLaunchArgs({ plan, mode: 'mosaic' });

  const baselineRuns = [];
  for (const prompt of PROMPTS) {
    baselineRuns.push(await runRunner({ runnerPath, args: baselineArgs, prompt }));
  }
  const mosaicRuns = [];
  for (const prompt of PROMPTS) {
    mosaicRuns.push(await runRunner({ runnerPath, args: mosaicArgs, prompt }));
  }
  const baseline = summarizeRuns(baselineRuns);
  const mosaic = summarizeRuns(mosaicRuns);
  const status = baseline.failures === 0 && mosaic.failures === 0 ? 'fail' : 'blocked';
  const reason = status === 'blocked' ? 'runner_failed_one_or_more_gate2_prompts' : null;
  const decision = buildGate2Decision({
    status,
    model: MODEL,
    baseline,
    mosaic,
    reason,
    plan,
  });
  writeArtifacts(decision);
  console.log(JSON.stringify(decision, null, 2));
  if (decision.status === 'fail') process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    blocked('gate2_eval_error', { mosaic: { error: error?.message || String(error) } });
    process.exit(1);
  });
}
