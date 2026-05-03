const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const CACHE_TTL_MS = 60_000;

let cachedProfile = null;
let cachedAt = 0;

function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      timeout: options.timeout || 5000,
      maxBuffer: options.maxBuffer || 1024 * 1024,
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

function readMemInfo() {
  const fallbackTotal = os.totalmem();
  const fallbackAvailable = os.freemem();
  try {
    const raw = fs.readFileSync('/proc/meminfo', 'utf8');
    const rows = {};
    for (const line of raw.split('\n')) {
      const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB/i.exec(line);
      if (match) rows[match[1]] = Number(match[2]) * 1024;
    }
    return {
      totalBytes: rows.MemTotal || fallbackTotal,
      availableBytes: rows.MemAvailable || fallbackAvailable,
      raw: rows,
    };
  } catch (_) {
    return {
      totalBytes: fallbackTotal,
      availableBytes: fallbackAvailable,
      raw: null,
    };
  }
}

function parseNvidiaSmiCsv(csv = '') {
  const line = String(csv || '').trim().split('\n').find(Boolean);
  if (!line) return null;
  const [nameRaw, memoryRaw, driverRaw] = line.split(',').map((part) => String(part || '').trim());
  const memoryTotalMiB = Number(String(memoryRaw || '').replace(/[^\d.]/g, ''));
  return {
    gpuName: nameRaw || '',
    memoryTotalMiB: Number.isFinite(memoryTotalMiB) ? memoryTotalMiB : 0,
    driver: driverRaw || '',
  };
}

function detectSparkFromStrings(...values) {
  const joined = values.map((value) => String(value || '')).join(' ').toLowerCase();
  return (
    joined.includes('gb10') ||
    joined.includes('dgx spark') ||
    joined.includes('nvidia spark') ||
    joined.includes('grace blackwell') ||
    joined.includes('grace-blackwell')
  );
}

async function queryNvidiaSmi() {
  const result = await runCommand('nvidia-smi', [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader,nounits',
  ], { timeout: 5000 });
  if (!result.success) return null;
  return parseNvidiaSmiCsv(result.stdout);
}

async function detectSparkProfile(options = {}) {
  const now = Date.now();
  if (!options.force && cachedProfile && now - cachedAt < CACHE_TTL_MS) {
    return cachedProfile;
  }

  const mem = readMemInfo();
  const nvidia = await queryNvidiaSmi();
  const envProfile = String(process.env.DEVFORGE_SPARK_PROFILE || '').trim();
  const totalGiB = mem.totalBytes / (1024 ** 3);
  const availableGiB = mem.availableBytes / (1024 ** 3);
  const gpuMemoryGiB = Number(nvidia?.memoryTotalMiB || 0) / 1024;
  const envSaysSpark = /spark|gb10|grace/i.test(envProfile);
  const stringsSaySpark = detectSparkFromStrings(envProfile, nvidia?.gpuName, os.hostname());
  const memoryLooksUnified = gpuMemoryGiB > 0 && totalGiB > 0 && Math.abs(gpuMemoryGiB - totalGiB) / totalGiB < 0.25;

  const isSpark = Boolean(envSaysSpark || stringsSaySpark || (memoryLooksUnified && /nvidia/i.test(nvidia?.gpuName || '')));

  cachedProfile = {
    isSpark,
    profile: isSpark ? 'spark' : 'standard',
    envProfile: envProfile || null,
    gpuName: nvidia?.gpuName || null,
    driver: nvidia?.driver || null,
    gpuMemoryGiB,
    unifiedMemoryGiB: isSpark ? totalGiB : null,
    memTotalGiB: totalGiB,
    memAvailableGiB: availableGiB,
    memoryLooksUnified,
    detectedAt: now,
  };
  cachedAt = now;
  return cachedProfile;
}

function getCachedSparkProfile() {
  return cachedProfile;
}

module.exports = {
  detectSparkProfile,
  getCachedSparkProfile,
  readMemInfo,
  queryNvidiaSmi,
};
