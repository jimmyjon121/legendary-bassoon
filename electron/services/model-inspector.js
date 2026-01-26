/**
 * Model Inspector
 * Lightweight metadata inspection for local model files (especially GGUF)
 *
 * NOTE: This is a fast, heuristic-based inspector designed to avoid
 * loading full models into memory. For GGUF we primarily infer from the
 * filename plus file size; a full binary header parser can be added later.
 */

const fs = require('fs');
const path = require('path');

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return 'Unknown';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function parseGgufName(filename) {
  const info = {
    name: filename,
    quantization: null,
    parametersB: null,
  };

  // Common patterns: model-7b-q4_k_m.gguf, llama-2-13b-chat.Q4_K_M.gguf
  const quantMatch = filename.match(/[._-](q\d+[_a-z]*|Q\d+[_A-Z]*)/i);
  if (quantMatch) {
    info.quantization = quantMatch[1].toUpperCase();
  }

  const paramMatch = filename.match(/(\d+)[bB]/);
  if (paramMatch) {
    info.parametersB = parseInt(paramMatch[1], 10);
  }

  // Clean up name for display
  info.name = filename
    .replace(/\.gguf$/i, '')
    .replace(/[._-](q\d+[_a-z]*|Q\d+[_A-Z]*)/gi, '')
    .replace(/[._-](\d+)[bB]/g, ' $1B')
    .replace(/[._-]/g, ' ')
    .trim();

  return info;
}

function estimateVramBytes(parametersB, quantization) {
  if (!parametersB) return null;

  // Rough heuristic: ~1GB per 1B params in FP16, scaled by quantization
  let bytesPerParam = 2; // FP16

  if (quantization) {
    const q = quantization.toUpperCase();
    if (q.includes('Q2')) bytesPerParam = 0.3;
    else if (q.includes('Q3')) bytesPerParam = 0.4;
    else if (q.includes('Q4')) bytesPerParam = 0.5;
    else if (q.includes('Q5')) bytesPerParam = 0.6;
    else if (q.includes('Q6')) bytesPerParam = 0.75;
    else if (q.includes('Q8')) bytesPerParam = 1.0;
  }

  const params = parametersB * 1e9;
  return Math.round(params * bytesPerParam);
}

function guessArchitecture(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('llama-3') || lower.includes('llama3')) return 'llama-3';
  if (lower.includes('llama-2') || lower.includes('llama2')) return 'llama-2';
  if (lower.includes('llama')) return 'llama';
  if (lower.includes('mistral')) return 'mistral';
  if (lower.includes('mixtral')) return 'mixtral';
  if (lower.includes('phi-3') || lower.includes('phi3')) return 'phi-3';
  if (lower.includes('phi-2') || lower.includes('phi2')) return 'phi-2';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('dolphin')) return 'dolphin-family';
  return 'unknown';
}

/**
 * Inspect a model file and return best-effort metadata.
 * For now, GGUF is treated specially; other formats get basic stats.
 */
async function inspectModel(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Model file not found');
  }

  const stats = await fs.promises.stat(filePath);
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  const base = {
    path: filePath,
    filename,
    extension: ext,
    fileSize: stats.size,
    fileSizeFormatted: formatFileSize(stats.size),
  };

  if (ext === '.gguf') {
    const parsed = parseGgufName(filename);
    const vramBytes = estimateVramBytes(parsed.parametersB, parsed.quantization);

    return {
      ...base,
      format: 'gguf',
      architecture: guessArchitecture(filename),
      parameterCount: parsed.parametersB ? parsed.parametersB * 1e9 : null,
      parametersB: parsed.parametersB,
      quantization: parsed.quantization,
      // These are placeholders until a full header parser is implemented
      contextLength: 8192,
      layers: null,
      hiddenSize: null,
      attentionHeads: null,
      kvHeads: null,
      ropeScaling: null,
      estimatedVramBytes: vramBytes,
      estimatedVramFormatted: vramBytes ? formatFileSize(vramBytes) : null,
    };
  }

  // Non-GGUF formats: return basic info for now
  return {
    ...base,
    format: ext.replace('.', '') || 'unknown',
    architecture: guessArchitecture(filename),
    parameterCount: null,
    parametersB: null,
    quantization: null,
    contextLength: null,
    layers: null,
    hiddenSize: null,
    attentionHeads: null,
    kvHeads: null,
    ropeScaling: null,
    estimatedVramBytes: null,
    estimatedVramFormatted: null,
  };
}

module.exports = {
  inspectModel,
};

















