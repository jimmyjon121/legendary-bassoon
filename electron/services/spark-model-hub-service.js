/**
 * DevForge Spark Model Hub Service
 *
 * Main-process control layer for the OEM-style Models / Runtime Center.
 * Renderer code must call this through fixed IPC handlers only.
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');
const { estimateSparkRequirement, buildFitVerdict } = require('./spark-memory-estimator');
const { resolveSparkMoeProfile } = require('./families/spark-moe-profiles');

const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODELHUB_DIR = path.join(os.homedir(), '.devforge', 'modelhub');
const MODELFILES_DIR = path.join(MODELHUB_DIR, 'modelfiles');
const CONTINUE_CONFIG = path.join(os.homedir(), '.continue', 'config.yaml');
const OPEN_WEBUI_URL = process.env.DEVFORGE_OPEN_WEBUI_URL || 'http://127.0.0.1:12000';
const LMSTUDIO_MODEL_DIRS = [
  path.join(os.homedir(), '.lmstudio', 'models'),
  path.join(os.homedir(), '.lmstudio', 'hub', 'models'),
  path.join(os.homedir(), '.cache', 'lm-studio', 'models'),
  path.join(os.homedir(), 'Library', 'Application Support', 'LM Studio', 'models'),
  path.join(os.homedir(), 'AppData', 'Local', 'LM Studio', 'models'),
].filter(Boolean);

const RECOMMENDED_MODELS = [
  {
    id: 'gemma4-31b-q8',
    source: 'local-import',
    provider: 'ollama',
    category: 'daily',
    title: 'Gemma 4 31B Q8',
    model: 'gemma4-31b-q8:latest',
    aliases: ['gemma4-31b-q8'],
    command: null,
    bestFor: ['daily assistant', 'writing', 'reasoning', 'coding support'],
    expectedRamGiB: 40,
    memoryImpact: 'medium-heavy',
    notes: 'Strong default daily assistant while the Spark runtime is stabilizing.',
  },
  {
    id: 'qwen2.5-coder-32b',
    source: 'ollama',
    provider: 'ollama',
    category: 'coding',
    title: 'Qwen 2.5 Coder 32B',
    model: 'qwen2.5-coder:32b',
    command: 'ollama pull qwen2.5-coder:32b',
    bestFor: ['coding', 'debugging', 'refactors', 'project explanation'],
    expectedRamGiB: 26,
    memoryImpact: 'medium',
    notes: 'Best next coding-specific download. Usually more practical for coding than a giant general model.',
  },
  {
    id: 'deepseek-r1-32b',
    source: 'ollama',
    provider: 'ollama',
    category: 'reasoning',
    title: 'DeepSeek R1 Distill 32B',
    model: 'deepseek-r1:32b',
    command: 'ollama pull deepseek-r1:32b',
    bestFor: ['reasoning', 'planning', 'debug thinking'],
    expectedRamGiB: 26,
    memoryImpact: 'medium',
    notes: 'Good reasoning model without jumping straight to 70B+ memory pressure.',
  },
  {
    id: 'deepseek-r1-70b',
    source: 'ollama',
    provider: 'ollama',
    category: 'heavy',
    title: 'DeepSeek R1 Distill 70B',
    model: 'deepseek-r1:70b',
    command: 'ollama pull deepseek-r1:70b',
    bestFor: ['heavier reasoning', 'complex analysis'],
    expectedRamGiB: 55,
    memoryImpact: 'heavy',
    notes: 'Run clean: stop other loaded models first.',
  },
  {
    id: 'mistral-medium-3.5',
    source: 'ollama',
    provider: 'ollama',
    category: 'heavy',
    title: 'Mistral Medium 3.5',
    model: 'mistral-medium-3.5:latest',
    aliases: ['mistral-medium-3.5'],
    command: 'ollama pull mistral-medium-3.5',
    bestFor: ['high-quality chat', 'reasoning', 'writing'],
    expectedRamGiB: 99.2,
    memoryImpact: 'clean-state required',
    notes: 'Ollama reported about 99.2 GiB required. Stop other models and free memory before launch.',
  },
  {
    id: 'gpt-oss-120b-mxfp4',
    source: 'local-import-or-ollama',
    provider: 'ollama',
    category: 'heavy',
    title: 'GPT-OSS 120B MXFP4',
    model: 'gpt-oss:120b',
    aliases: ['gpt-oss-120b-mxfp4', 'gpt-oss:120b'],
    command: 'ollama pull gpt-oss:120b',
    bestFor: ['serious local testing', 'heavy reasoning', 'agent experiments'],
    expectedRamGiB: 75,
    memoryImpact: 'heavy',
    notes: 'Use as serious mode, not the default coding model.',
  },
  {
    id: 'nomic-embed-text',
    source: 'ollama',
    provider: 'ollama',
    category: 'embedding',
    title: 'Nomic Embed Text',
    model: 'nomic-embed-text:latest',
    command: 'ollama pull nomic-embed-text',
    bestFor: ['RAG', 'document search', 'knowledge base indexing'],
    expectedRamGiB: 2,
    memoryImpact: 'light',
    notes: 'Useful for the DevForge knowledge/RAG layer.',
  },
  {
    id: 'embeddinggemma',
    source: 'ollama',
    provider: 'ollama',
    category: 'embedding',
    title: 'EmbeddingGemma',
    model: 'embeddinggemma:latest',
    command: 'ollama pull embeddinggemma',
    bestFor: ['RAG', 'semantic search'],
    expectedRamGiB: 2,
    memoryImpact: 'light',
    notes: 'Modern embedding option for local RAG experiments.',
  },
];

function clampNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bytesToGiB(bytes) {
  return Number(bytes || 0) / (1024 ** 3);
}

function formatGiB(bytesOrGiB, isBytes = true) {
  const gib = isBytes ? bytesToGiB(bytesOrGiB) : Number(bytesOrGiB || 0);
  return `${gib.toFixed(gib >= 10 ? 1 : 2)} GiB`;
}

function normalizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[:/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function detectFamily(name = '') {
  const n = String(name || '').toLowerCase();
  if (n.includes('qwen') && n.includes('coder')) return 'qwen-coder';
  if (n.includes('qwen')) return 'qwen';
  if (n.includes('deepseek')) return 'deepseek';
  if (n.includes('gemma')) return 'gemma';
  if (n.includes('mistral')) return 'mistral';
  if (n.includes('llama')) return 'llama';
  if (n.includes('gpt-oss')) return 'gpt-oss';
  if (n.includes('embed')) return 'embedding';
  return 'unknown';
}

function parseParamsFromName(name = '') {
  const match = String(name || '').match(/(\d+(?:\.\d+)?)\s*b/i);
  return match ? Number(match[1]) : null;
}

function parseQuantFromName(name = '') {
  const match = String(name || '').match(/(?:^|[-_.])((?:Q\d(?:_[A-Z0-9]+)*)|MXFP\d|FP\d|BF16|F16|Q8_0|Q4_K_M|Q5_K_M)(?:$|[-_.])/i);
  return match ? match[1].toUpperCase() : null;
}

function estimateRequiredGiB(model = {}) {
  const sparkRequirement = estimateSparkRequirement(model);
  if (Number.isFinite(Number(sparkRequirement?.totalGiB)) && sparkRequirement.totalGiB > 0) {
    return Number(sparkRequirement.totalGiB);
  }
  if (Number.isFinite(Number(model.expectedRamGiB))) return Number(model.expectedRamGiB);
  if (Number.isFinite(Number(model.requiredGiB))) return Number(model.requiredGiB);

  const sizeGiB = Number.isFinite(Number(model.sizeBytes)) ? bytesToGiB(model.sizeBytes) : null;
  const name = String(model.name || model.model || model.title || '');
  const lower = name.toLowerCase();
  const params = parseParamsFromName(name);
  const quant = parseQuantFromName(name);

  if (lower.includes('mistral-medium-3.5')) return 99.2;
  if (lower.includes('gpt-oss') && lower.includes('120')) return 75;
  if (lower.includes('70b')) return 55;
  if (lower.includes('32b') || lower.includes('31b')) return quant?.includes('Q8') ? 40 : 28;
  if (lower.includes('26b')) return quant?.includes('Q8') ? 34 : 24;
  if (sizeGiB) return Math.ceil(sizeGiB * 1.25 + 4);
  if (params) return Math.ceil(params * 1.25 + 4);
  return null;
}

function getFit(requiredGiB, availableGiB) {
  const sparkVerdict = buildFitVerdict({ totalGiB: requiredGiB }, availableGiB);
  if (sparkVerdict?.label !== 'unknown') return sparkVerdict;

  if (!Number.isFinite(Number(requiredGiB))) {
    return {
      label: 'unknown',
      score: 50,
      canRunNow: null,
      message: 'No memory estimate is available yet.',
      guidance: 'Open details to inspect the model size and source.',
    };
  }
  if (!Number.isFinite(Number(availableGiB))) {
    return {
      label: 'unknown',
      score: 50,
      canRunNow: null,
      message: `Estimated requirement: about ${Number(requiredGiB).toFixed(1)} GiB.`,
      guidance: 'Memory availability could not be read on this system.',
    };
  }

  const margin = Number(availableGiB) - Number(requiredGiB);
  if (margin >= 25) {
    return {
      label: 'excellent',
      score: 95,
      canRunNow: true,
      message: `This should run comfortably. You have about ${margin.toFixed(1)} GiB of headroom.`,
      guidance: 'Safe to launch for normal use.',
    };
  }
  if (margin >= 10) {
    return {
      label: 'good',
      score: 82,
      canRunNow: true,
      message: `This should run with about ${margin.toFixed(1)} GiB of memory headroom.`,
      guidance: 'Safe to launch, but avoid loading another heavy model beside it.',
    };
  }
  if (margin >= 0) {
    return {
      label: 'tight',
      score: 62,
      canRunNow: true,
      message: `This can launch, but it will be tight. Estimated remaining headroom: ${margin.toFixed(1)} GiB.`,
      guidance: 'Close extra apps before long runs.',
    };
  }

  return {
    label: 'blocked',
    score: 20,
    canRunNow: false,
    message: `This model needs about ${Number(requiredGiB).toFixed(1)} GiB available. You currently have ${Number(availableGiB).toFixed(1)} GiB.`,
    guidance: 'Stop a loaded model, close LM Studio, or restart Ollama before launching this.',
  };
}

function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      timeout: options.timeout || 20000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 8,
    }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        code: error?.code ?? 0,
        error: error?.message || null,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

function httpJson(url, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            success: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: data ? JSON.parse(data) : null,
            raw: data,
          });
        } catch (error) {
          resolve({ success: false, status: res.statusCode, error: error.message, raw: data });
        }
      });
    });
    req.on('error', (error) => resolve({ success: false, error: error.message }));
    req.setTimeout(options.timeout || 8000, () => {
      req.destroy();
      resolve({ success: false, error: 'Request timed out' });
    });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function exists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkForGguf(root, maxDepth = 5) {
  const results = [];
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        try {
          const stat = await fsp.stat(full);
          results.push({ path: full, name: entry.name, sizeBytes: stat.size, modifiedAt: stat.mtimeMs });
        } catch {
          // Ignore files that disappear during scan.
        }
      }
    }
  }
  if (await exists(root)) await walk(root, 0);
  return results;
}

function cryptoSafeId(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 12);
}

function groupGgufFiles(files) {
  const byDir = new Map();
  for (const file of files) {
    const dir = path.dirname(file.path);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
  }
  const groups = [];
  for (const [dir, rawItems] of byDir.entries()) {
    const items = [...rawItems].sort((a, b) => a.name.localeCompare(b.name));
    const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    const primary = items.find((item) => /00001-of-\d+\.gguf$/i.test(item.name))
      || [...items].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
    const folderName = path.basename(dir);
    groups.push({
      id: cryptoSafeId(dir),
      source: 'lmstudio-gguf',
      name: folderName,
      primaryPath: primary.path,
      directory: dir,
      files: items,
      shardCount: items.length,
      isSharded: items.length > 1,
      sizeBytes: totalBytes,
      sizeLabel: formatGiB(totalBytes),
      family: detectFamily(folderName),
      quantization: parseQuantFromName(primary.name) || parseQuantFromName(folderName),
      parametersB: parseParamsFromName(primary.name) || parseParamsFromName(folderName),
      requiredGiB: estimateRequiredGiB({ name: folderName, sizeBytes: totalBytes }),
      modifiedAt: Math.max(...items.map((item) => item.modifiedAt)),
    });
  }
  return groups.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

class SparkModelHubService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.ollamaHost = options.ollamaHost || DEFAULT_OLLAMA_HOST;
    this.store = options.store || null;
    this.jobs = new Map();
  }

  async ensureDirs() {
    await fsp.mkdir(MODELHUB_DIR, { recursive: true });
    await fsp.mkdir(MODELFILES_DIR, { recursive: true });
  }

  async ollamaHealth() {
    const res = await httpJson(`${this.ollamaHost}/api/version`, { timeout: 3000 });
    return {
      running: Boolean(res.success),
      version: res.data?.version || null,
      host: this.ollamaHost,
      error: res.success ? null : res.error || res.raw || `HTTP ${res.status}`,
    };
  }

  async getOllamaModels() {
    const res = await httpJson(`${this.ollamaHost}/api/tags`, { timeout: 5000 });
    if (!res.success) {
      return { success: false, models: [], error: res.error || res.raw || `HTTP ${res.status}` };
    }
    const models = (res.data?.models || []).map((model) => {
      const details = model.details || {};
      const family = details.family || detectFamily(model.name);
      const parameterSize = details.parameter_size || null;
      const parametersB = parseParamsFromName(parameterSize) || parseParamsFromName(model.name);
      const quantization = details.quantization_level || parseQuantFromName(model.name) || null;
      const requiredGiB = estimateRequiredGiB({ name: model.name, sizeBytes: model.size });
      return {
        id: model.name,
        provider: 'ollama',
        source: 'ollama',
        status: 'Downloaded',
        name: model.name,
        model: model.name,
        modifiedAt: model.modified_at || null,
        sizeBytes: model.size || 0,
        sizeLabel: model.size ? formatGiB(model.size) : 'unknown',
        digest: model.digest || null,
        details,
        family,
        parameterSize,
        parametersB,
        quantization,
        requiredGiB,
      };
    });
    return { success: true, models };
  }

  async getLoadedModels() {
    const res = await httpJson(`${this.ollamaHost}/api/ps`, { timeout: 5000 });
    if (!res.success) {
      return { success: false, models: [], error: res.error || res.raw || `HTTP ${res.status}` };
    }
    const models = (res.data?.models || []).map((model) => {
      const name = model.name || model.model;
      const details = model.details || {};
      const family = details.family || detectFamily(name);
      const parameterSize = details.parameter_size || null;
      const parametersB = parseParamsFromName(parameterSize) || parseParamsFromName(name);
      const quantization = details.quantization_level || parseQuantFromName(name) || null;
      return {
        id: name,
        provider: 'ollama',
        source: 'ollama',
        status: 'Loaded',
        name,
        model: model.model || model.name,
        sizeBytes: model.size || 0,
        sizeLabel: model.size ? formatGiB(model.size) : 'unknown',
        sizeVramBytes: model.size_vram || 0,
        sizeVramLabel: model.size_vram ? formatGiB(model.size_vram) : null,
        expiresAt: model.expires_at || null,
        details,
        family,
        parameterSize,
        parametersB,
        quantization,
        requiredGiB: estimateRequiredGiB({ name, sizeBytes: model.size }),
      };
    });
    return { success: true, models };
  }

  async getSystemStatus() {
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memAvailable = await this.getMemAvailableBytes(memFree);
    const disk = await this.getDiskStatus(os.homedir());
    const gpu = await this.getGpuStatus();
    const docker = await this.getDockerStatus();
    return {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      uptimeSec: os.uptime(),
      memory: {
        totalBytes: memTotal,
        freeBytes: memFree,
        availableBytes: memAvailable,
        totalGiB: bytesToGiB(memTotal),
        freeGiB: bytesToGiB(memFree),
        availableGiB: bytesToGiB(memAvailable),
        totalLabel: formatGiB(memTotal),
        freeLabel: formatGiB(memFree),
        availableLabel: formatGiB(memAvailable),
      },
      disk,
      gpu,
      docker,
    };
  }

  async getMemAvailableBytes(fallback) {
    if (process.platform !== 'linux') return fallback;
    try {
      const raw = await fsp.readFile('/proc/meminfo', 'utf8');
      const match = raw.match(/^MemAvailable:\s+(\d+)\s+kB/m);
      if (match) return Number(match[1]) * 1024;
    } catch {
      // Non-Linux or restricted process.
    }
    return fallback;
  }

  async getDiskStatus(targetPath) {
    const res = await runCommand('df', ['-B1', targetPath], { timeout: 5000 });
    if (!res.success) return { available: false, error: res.stderr || res.error };
    const lines = res.stdout.trim().split('\n');
    const row = lines[1]?.trim().split(/\s+/);
    if (!row || row.length < 6) return { available: false, raw: res.stdout };
    const size = Number(row[1]);
    const used = Number(row[2]);
    const available = Number(row[3]);
    return {
      available: true,
      filesystem: row[0],
      mount: row[5],
      totalBytes: size,
      usedBytes: used,
      availableBytes: available,
      totalLabel: formatGiB(size),
      usedLabel: formatGiB(used),
      availableLabel: formatGiB(available),
      usedPercent: size ? Math.round((used / size) * 100) : null,
    };
  }

  async getGpuStatus() {
    const args = [
      '--query-gpu=name,temperature.gpu,utilization.gpu,memory.total,memory.used,power.draw,power.limit',
      '--format=csv,noheader,nounits',
    ];
    const res = await runCommand('nvidia-smi', args, { timeout: 5000 });
    if (!res.success) return { available: false, error: res.stderr || res.error };
    const line = res.stdout.trim().split('\n')[0] || '';
    const [name, temp, util, memTotalMiB, memUsedMiB, powerDraw, powerLimit] = line.split(',').map((v) => v?.trim());
    const total = clampNumber(memTotalMiB, null);
    const used = clampNumber(memUsedMiB, null);
    return {
      available: true,
      name,
      temperatureC: clampNumber(temp, null),
      utilizationGpuPct: clampNumber(util, null),
      memoryTotalMiB: total,
      memoryUsedMiB: used,
      memoryUsedPct: Number.isFinite(total) && total > 0 && Number.isFinite(used)
        ? Math.round((used / total) * 100)
        : null,
      powerDrawW: clampNumber(powerDraw, null),
      powerLimitW: clampNumber(powerLimit, null),
      raw: line,
    };
  }

  async getDockerStatus() {
    const res = await runCommand('docker', ['ps', '--format', '{{json .}}'], { timeout: 5000, maxBuffer: 1024 * 1024 });
    if (!res.success) {
      return { available: false, error: res.stderr || res.error };
    }
    const containers = res.stdout.trim()
      ? res.stdout.trim().split('\n').map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      })
      : [];
    const openWebui = containers.find((container) => String(container.Names || '').includes('open-webui')) || null;
    return { available: true, containers, openWebui };
  }

  async scanLmStudio() {
    const all = [];
    for (const dir of LMSTUDIO_MODEL_DIRS) {
      const files = await walkForGguf(dir, 6);
      all.push(...files);
    }
    const dedup = new Map();
    for (const file of all) dedup.set(file.path, file);
    return { success: true, models: groupGgufFiles([...dedup.values()]) };
  }

  enrichModels(models, system) {
    const availableGiB = system?.memory?.availableGiB;
    return models.map((model) => {
      const memoryRequirement = estimateSparkRequirement(model);
      const requiredGiB = Number.isFinite(Number(memoryRequirement.totalGiB))
        ? memoryRequirement.totalGiB
        : estimateRequiredGiB(model);
      const fit = {
        ...getFit(requiredGiB, availableGiB),
        requirement: memoryRequirement,
      };
      const loaded = model.status === 'Loaded' || model.loaded === true;
      return {
        ...model,
        requiredGiB,
        fit,
        status: loaded
          ? 'Loaded'
          : fit.canRunNow === false
            ? 'Cannot run right now'
            : model.installed
              ? 'Downloaded'
              : model.status || 'Ready to pull',
      };
    });
  }

  async getDashboard() {
    const [system, health, ollama, loaded, lmstudio, openWebui] = await Promise.all([
      this.getSystemStatus(),
      this.ollamaHealth(),
      this.getOllamaModels(),
      this.getLoadedModels(),
      this.scanLmStudio(),
      this.openWebUiStatus(),
    ]);
    const installedModels = this.enrichModels(ollama.models || [], system);
    const lmStudioModels = this.enrichModels(lmstudio.models || [], system);
    const installedNames = new Set(installedModels.flatMap((model) => [
      model.name,
      model.model,
      String(model.name || '').replace(':latest', ''),
      String(model.model || '').replace(':latest', ''),
    ]));
    const loadedNames = new Set((loaded.models || []).flatMap((model) => [
      model.name,
      model.model,
      String(model.name || '').replace(':latest', ''),
      String(model.model || '').replace(':latest', ''),
    ]));
    const recommendations = this.enrichModels(RECOMMENDED_MODELS.map((model) => ({
      ...model,
      installed: installedNames.has(model.model)
        || installedNames.has(String(model.model).replace(':latest', ''))
        || model.aliases?.some((alias) => installedNames.has(alias)),
      loaded: loadedNames.has(model.model)
        || loadedNames.has(String(model.model).replace(':latest', ''))
        || model.aliases?.some((alias) => loadedNames.has(alias)),
    })), system);
    const continueConfig = await this.getContinueConfigStatus();
    const topLoaded = this.enrichModels(loaded.models || [], system)
      .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))[0] || null;

    return {
      success: true,
      generatedAt: new Date().toISOString(),
      system,
      runtimeSummary: {
        ollamaRunning: health.running,
        openWebuiRunning: openWebui.running,
        activeCodingModel: continueConfig.currentModel,
        loadedModelCount: (loaded.models || []).length,
        topLoadedModel: topLoaded,
      },
      ollama: {
        health,
        installed: installedModels,
        loaded: this.enrichModels(loaded.models || [], system),
        error: ollama.error || loaded.error || null,
      },
      lmstudio: { models: lmStudioModels },
      recommendations,
      continue: continueConfig,
      openWebui,
      jobs: this.getJobs(),
    };
  }

  getJobs() {
    return [...this.jobs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async pullModel(modelName) {
    if (!modelName) return { success: false, error: 'Missing modelName' };
    return this.spawnJob({
      type: 'pull',
      command: 'ollama',
      args: ['pull', modelName],
      label: `Pull ${modelName}`,
    });
  }

  async runModel(modelName) {
    if (!modelName) return { success: false, error: 'Missing modelName' };
    const loaded = await this.getLoadedModels();
    if ((loaded.models || []).some((model) => model.name === modelName || model.model === modelName)) {
      return { success: true, alreadyLoaded: true, modelName };
    }
    const res = await httpJson(`${this.ollamaHost}/api/generate`, {
      method: 'POST',
      timeout: 120000,
      body: {
        model: modelName,
        prompt: 'Reply with OK.',
        stream: false,
        keep_alive: '30m',
        think: false,
        options: { num_predict: 4 },
      },
    });
    return {
      success: res.success,
      modelName,
      error: res.error || res.raw || res.data?.error || null,
      response: res.data?.response || res.data?.message?.content || null,
    };
  }

  async stopModel(modelName) {
    if (!modelName) return { success: false, error: 'Missing modelName' };
    const res = await runCommand('ollama', ['stop', modelName], { timeout: 30000 });
    return { success: res.success, modelName, error: res.stderr || res.error || null, stdout: res.stdout };
  }

  async deleteModel(modelName) {
    if (!modelName) return { success: false, error: 'Missing modelName' };
    const res = await runCommand('ollama', ['rm', modelName], { timeout: 120000 });
    return { success: res.success, modelName, error: res.stderr || res.error || null, stdout: res.stdout };
  }

  spawnJob({ type, command, args, label }) {
    const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job = {
      id,
      type,
      label,
      command,
      args,
      status: 'running',
      progressPct: null,
      log: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(id, job);
    const child = spawn(command, args, { shell: false, env: process.env });
    const push = (chunk, stream) => {
      const text = String(chunk || '');
      job.updatedAt = Date.now();
      job.log.push({ t: job.updatedAt, stream, text });
      if (job.log.length > 200) job.log.shift();
      const pctMatches = [...text.matchAll(/(\d{1,3})%/g)];
      if (pctMatches.length) {
        const pct = Number(pctMatches[pctMatches.length - 1][1]);
        if (pct >= 0 && pct <= 100) job.progressPct = pct;
      }
      this.emit('job', { ...job });
    };
    child.stdout.on('data', (data) => push(data, 'stdout'));
    child.stderr.on('data', (data) => push(data, 'stderr'));
    child.on('error', (error) => {
      job.status = 'error';
      job.error = error.message;
      job.updatedAt = Date.now();
      this.emit('job', { ...job });
    });
    child.on('close', (code) => {
      job.status = code === 0 ? 'completed' : 'error';
      job.exitCode = code;
      job.progressPct = code === 0 ? 100 : job.progressPct;
      job.updatedAt = Date.now();
      this.emit('job', { ...job });
    });
    return { success: true, jobId: id, job };
  }

  async restartOllama() {
    const res = await runCommand('systemctl', ['restart', 'ollama'], { timeout: 30000 });
    if (res.success) return { success: true, message: 'Ollama restarted.' };

    return {
      success: false,
      error: 'DevForge could not restart Ollama without elevated permissions.',
      guidance: 'Run `sudo systemctl restart ollama` in a terminal, or stop loaded models from this panel to free memory.',
      rawError: res.stderr || res.error,
    };
  }

  async openWebUiStatus() {
    const health = await httpJson(OPEN_WEBUI_URL, { timeout: 3000 });
    return {
      running: Boolean(health.status),
      reachable: Boolean(health.status),
      status: health.status || null,
      url: OPEN_WEBUI_URL,
      error: health.error || null,
    };
  }

  async importGgufToOllama({ filePath, modelName, contextLength = 8192, temperature = 0.2 }) {
    if (!filePath) return { success: false, error: 'Missing filePath' };
    if (!(await exists(filePath))) return { success: false, error: `File does not exist: ${filePath}` };
    await this.ensureDirs();
    const inferred = normalizeName(modelName || path.basename(path.dirname(filePath)) || path.basename(filePath, '.gguf'));
    const safeName = inferred || `imported-${Date.now()}`;
    const sparkProfile = resolveSparkMoeProfile(safeName, { level: 'recommended' });
    const finalCtx = Number(contextLength) || sparkProfile?.num_ctx || 8192;
    const finalBatch = sparkProfile?.num_batch || 128;
    const finalKv = sparkProfile?.kv_cache_type || 'q4_0';
    const modelfilePath = path.join(MODELFILES_DIR, `${safeName}.Modelfile`);
    const body = [
      `FROM ${filePath}`,
      '',
      `PARAMETER num_ctx ${finalCtx}`,
      `PARAMETER num_batch ${finalBatch}`,
      'PARAMETER num_gpu -1',
      `PARAMETER kv_cache_type ${finalKv}`,
      `PARAMETER temperature ${Number(temperature) || 0.2}`,
      'PARAMETER repeat_penalty 1.1',
      '',
    ].join('\n');
    await fsp.writeFile(modelfilePath, body, 'utf8');
    const res = await runCommand('ollama', ['create', safeName, '-f', modelfilePath], {
      timeout: 1000 * 60 * 20,
      maxBuffer: 1024 * 1024 * 16,
    });
    return {
      success: res.success,
      modelName: safeName,
      modelfilePath,
      error: res.stderr || res.error || null,
      stdout: res.stdout,
    };
  }

  async registerLocalGguf({ filePath, displayName = null }) {
    if (!filePath) return { success: false, error: 'Missing filePath' };
    const resolvedPath = path.resolve(filePath);
    if (!(await exists(resolvedPath))) return { success: false, error: `File does not exist: ${resolvedPath}` };
    const stat = await fsp.stat(resolvedPath);
    const name = displayName || path.basename(resolvedPath, '.gguf');
    const id = `gguf:${resolvedPath}`;
    const catalog = Array.isArray(this.store?.get?.('localGgufCatalog'))
      ? this.store.get('localGgufCatalog')
      : [];
    const entry = {
      id,
      name,
      path: resolvedPath,
      sizeBytes: stat.size,
      registeredAt: new Date().toISOString(),
      source: 'spark-model-hub',
    };
    const existingIndex = catalog.findIndex((item) => item?.id === id || item?.path === resolvedPath);
    if (existingIndex >= 0) catalog[existingIndex] = { ...catalog[existingIndex], ...entry };
    else catalog.push(entry);
    this.store?.set?.('localGgufCatalog', catalog);
    return { success: true, ...entry };
  }

  async setContinueModel({
    model,
    title,
    apiBase = 'http://localhost:11434',
    contextLength = 8192,
    temperature = 0.2,
    autocomplete = true,
  }) {
    if (!model) return { success: false, error: 'Missing model' };
    await fsp.mkdir(path.dirname(CONTINUE_CONFIG), { recursive: true });
    const label = title || model;
    const roles = autocomplete ? ['chat', 'edit', 'autocomplete'] : ['chat', 'edit'];
    const yaml = [
      'name: Spark Local AI',
      'version: 0.0.1',
      'schema: v1',
      '',
      'models:',
      `  - name: ${JSON.stringify(label)}`,
      '    provider: ollama',
      `    model: ${JSON.stringify(model)}`,
      `    apiBase: ${JSON.stringify(apiBase)}`,
      '    roles:',
      ...roles.map((role) => `      - ${role}`),
      '    defaultCompletionOptions:',
      `      contextLength: ${Number(contextLength) || 8192}`,
      `      temperature: ${Number(temperature) || 0.2}`,
      '',
      'context:',
      '  - provider: code',
      '  - provider: docs',
      '  - provider: diff',
      '  - provider: terminal',
      '  - provider: problems',
      '  - provider: folder',
      '',
    ].join('\n');
    const backupPath = `${CONTINUE_CONFIG}.bak-${Date.now()}`;
    if (await exists(CONTINUE_CONFIG)) {
      try {
        await fsp.copyFile(CONTINUE_CONFIG, backupPath);
      } catch {
        // Keep going; the write below is the requested action.
      }
    }
    await fsp.writeFile(CONTINUE_CONFIG, yaml, 'utf8');
    return {
      success: true,
      configPath: CONTINUE_CONFIG,
      backupPath: await exists(backupPath) ? backupPath : null,
      model,
      title: label,
      message: `Continue now points at ${label}. A backup was created when an existing config was present.`,
    };
  }

  async getContinueConfigStatus() {
    const existsConfig = await exists(CONTINUE_CONFIG);
    if (!existsConfig) return { exists: false, path: CONTINUE_CONFIG, currentModel: null };
    const raw = await fsp.readFile(CONTINUE_CONFIG, 'utf8').catch(() => '');
    const modelMatch = raw.match(/^\s*model:\s*["']?([^"'\n]+)["']?/m);
    const apiMatch = raw.match(/^\s*apiBase:\s*["']?([^"'\n]+)["']?/m);
    return {
      exists: true,
      path: CONTINUE_CONFIG,
      currentModel: modelMatch?.[1]?.trim() || null,
      apiBase: apiMatch?.[1]?.trim() || null,
      preview: raw.slice(0, 1200),
    };
  }

  async getRecommendations() {
    const system = await this.getSystemStatus();
    const ollama = await this.getOllamaModels();
    const installedNames = new Set((ollama.models || []).flatMap((model) => [
      model.name,
      String(model.name || '').replace(':latest', ''),
    ]));
    return this.enrichModels(RECOMMENDED_MODELS.map((model) => ({
      ...model,
      installed: installedNames.has(model.model) || installedNames.has(String(model.model).replace(':latest', '')),
    })), system);
  }
}

module.exports = {
  SparkModelHubService,
  RECOMMENDED_MODELS,
  estimateRequiredGiB,
  getFit,
};
