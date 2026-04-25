/* eslint-disable no-console */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MOSAIC_DIR = path.join(ROOT, 'docs/perf/mosaic');
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
const OPENVINO_ENDPOINT = process.env.NPU_SERVER_URL || `http://127.0.0.1:${process.env.OPENVINO_SERVER_PORT || 8081}`;

const MODEL_SPECS = {
  'qwen2.5-coder:14b': { layers: 48, sizeGB: 9.0 },
  'qwen3-30b-abliterated:q4_k_m': { layers: 64, sizeGB: 18.0 },
  'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov': { layers: 28, sizeGB: 1.2 },
};

function ensureMosaicDir() {
  fs.mkdirSync(MOSAIC_DIR, { recursive: true });
}

function getModelSpec(model) {
  return MODEL_SPECS[model] || { layers: 48, sizeGB: 9.0 };
}

function freeRamGB() {
  return os.freemem() / 1024 ** 3;
}

function assertSafeToRun({ minFreeRamGB = 6 } = {}) {
  const free = freeRamGB();
  if (free < minFreeRamGB) {
    const err = new Error(`free RAM ${free.toFixed(2)}GB < ${minFreeRamGB}GB`);
    err.code = 'MOSAIC_PROFILE_UNSAFE';
    throw err;
  }
}

function requestJson(method, url, body = null, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(url, {
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: data ? JSON.parse(data) : {} });
        } catch (error) {
          resolve({ ok: false, status: res.statusCode, error: error?.message || data });
        }
      });
    });
    req.on('error', (error) => resolve({ ok: false, error: error.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms` });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function runOllamaGenerate({ model, numGpu = null, numPredict = 8, prompt = null, timeoutMs = 90000 }) {
  const body = {
    model,
    prompt: prompt || 'Write a compact function that checks whether a number is prime. Return only code.\n',
    stream: true,
    options: {
      num_predict: numPredict,
      temperature: 0,
      num_ctx: 1024,
      ...(numGpu != null ? { num_gpu: numGpu } : {}),
    },
  };
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, (res) => {
      let buffer = '';
      let text = '';
      let done = null;
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.response) text += event.response;
            if (event.done) done = event;
          } catch {
            // ignore malformed stream fragments
          }
        }
      });
      res.on('end', () => {
        const elapsedMs = Date.now() - startedAt;
        const evalCount = Number(done?.eval_count) || Math.max(1, Math.round(text.length / 4));
        const evalDurationNs = Number(done?.eval_duration) || 0;
        const promptEvalCount = Number(done?.prompt_eval_count) || 1;
        const promptEvalDurationNs = Number(done?.prompt_eval_duration) || 0;
        const tps = evalDurationNs > 0 ? evalCount / (evalDurationNs / 1e9) : evalCount / Math.max(0.001, elapsedMs / 1000);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300 && !done?.error,
          status: res.statusCode,
          elapsedMs,
          evalCount,
          evalDurationNs,
          promptEvalCount,
          promptEvalDurationNs,
          tokensPerSecond: tps,
          textPreview: text.slice(0, 80),
          error: done?.error || null,
        });
      });
    });
    req.on('error', (error) => resolve({ ok: false, error: error.message, elapsedMs: Date.now() - startedAt }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms`, elapsedMs: Date.now() - startedAt });
    });
    req.write(payload);
    req.end();
  });
}

async function runOpenVinoGenerate({ prompt = 'Hello', maxTokens = 8, timeoutMs = 90000 } = {}) {
  return requestJson('POST', `${OPENVINO_ENDPOINT}/generate`, {
    prompt,
    max_tokens: maxTokens,
    temperature: 0,
  }, timeoutMs);
}

function queryNvidiaSmi() {
  try {
    const raw = execFileSync('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used',
      '--format=csv,noheader,nounits',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const [name, total, used] = raw.split(',').map((s) => s.trim());
    return {
      name,
      memoryBytes: Number(total) * 1024 * 1024,
      usedBytes: Number(used) * 1024 * 1024,
    };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

function makeProfile({
  device,
  model,
  throughputTokensPerSecond,
  latencyMs = 0,
  hardware = {},
  samples = [],
  source = 'live',
  fallbackReason = null,
  error = null,
}) {
  const spec = getModelSpec(model);
  const layerCount = spec.layers;
  const footprintBytes = spec.sizeGB * 1024 ** 3;
  const perLayerBytes = footprintBytes / layerCount;
  const tps = Number(throughputTokensPerSecond) || 0.01;
  const decodeMsPerLayer = Array.from({ length: layerCount }, () => 1000 / Math.max(0.001, tps * layerCount));
  const prefillMsPerLayer = Array.from({ length: layerCount }, () => Math.max(0.01, Number(latencyMs || 0) / Math.max(1, layerCount)));
  const memBytes = Array.from({ length: layerCount }, () => perLayerBytes);
  return {
    schemaVersion: 1,
    device,
    model,
    createdAt: new Date().toISOString(),
    hardware,
    prefillMsPerLayer,
    decodeMsPerLayer,
    memBytes,
    throughputTokensPerSecond: tps,
    runMeta: {
      source,
      samples,
      fallbackReason,
      error,
      freeRamGB: freeRamGB(),
    },
  };
}

function writeProfile(name, profile) {
  ensureMosaicDir();
  const filePath = path.join(MOSAIC_DIR, `profile-${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
  return filePath;
}

module.exports = {
  ROOT,
  MOSAIC_DIR,
  OLLAMA_ENDPOINT,
  OPENVINO_ENDPOINT,
  assertSafeToRun,
  freeRamGB,
  getModelSpec,
  makeProfile,
  queryNvidiaSmi,
  requestJson,
  runOllamaGenerate,
  runOpenVinoGenerate,
  writeProfile,
};
