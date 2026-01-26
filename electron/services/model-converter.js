const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

function ensureExecutableExists(executablePath, friendlyName) {
  if (!executablePath) {
    throw new Error(`${friendlyName} path is not configured. Set it in Settings → LLM.`);
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`${friendlyName} not found at ${executablePath}`);
  }
}

function buildDestPath(sourcePath, suffix, extension) {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const safeSuffix = suffix ? `.${suffix}` : '';
  const safeExt = extension || path.extname(sourcePath) || '.bin';
  return path.join(dir, `${base}${safeSuffix}${safeExt}`);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      shell: process.platform === 'win32',
      ...options,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('error', (error) => {
      reject(error);
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(
          `Process exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

class ModelConverter {
  constructor(store, appPath) {
    this.store = store;
    this.appPath = appPath;
  }

  get modelsDirectory() {
    const dir = this.store.get('modelsDirectory');
    return dir;
  }

  getLlamaQuantizePath() {
    return this.store.get('tools.llamaQuantizePath');
  }

  getPythonPath() {
    return (
      this.store.get('tools.pythonPath') ||
      (process.platform === 'win32' ? 'py' : 'python3')
    );
  }

  async convert({ sourcePath, targetFormat, options = {} }) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error('Source file not found');
    }

    switch (targetFormat) {
      case 'gguf':
        return this.convertWithLlamaQuantize(sourcePath, options.quantization || 'q4_k_m');
      case 'openvino':
        return this.convertToOpenVino(sourcePath, options.precision || 'fp16');
      default:
        throw new Error(`Unsupported target format: ${targetFormat}`);
    }
  }

  async convertWithLlamaQuantize(sourcePath, quantization) {
    const quantizePath = this.getLlamaQuantizePath();
    ensureExecutableExists(quantizePath, 'llama-quantize');

    const destPath = buildDestPath(sourcePath, quantization, '.gguf');
    const args = [sourcePath, destPath, quantization];

    await runProcess(quantizePath, args, {
      cwd: path.dirname(quantizePath),
    });

    return {
      success: true,
      outputPath: destPath,
      message: `Converted to ${quantization.toUpperCase()} GGUF.`,
    };
  }

  async convertToOpenVino(sourcePath, precision) {
    const pythonPath = this.getPythonPath();
    const scriptPath = path.join(this.appPath, 'scripts', 'convert-to-openvino.py');
    ensureExecutableExists(scriptPath, 'OpenVINO conversion script');

    const ext = path.extname(sourcePath).toLowerCase();
    if (!['.onnx', '.xml', '.pb', '.pt', '.bin', '.pth', '.safetensors'].includes(ext)) {
      throw new Error('OpenVINO conversion currently supports ONNX / TF / PyTorch style models.');
    }

    const outputDir = path.join(path.dirname(sourcePath), `${path.parse(sourcePath).name}_ir`);
    await fs.promises.mkdir(outputDir, { recursive: true });

    const args = [
      scriptPath,
      '--input',
      sourcePath,
      '--output-dir',
      outputDir,
      '--precision',
      precision || 'fp16',
    ];

    await runProcess(pythonPath, args, {
      cwd: path.dirname(sourcePath),
    });

    const xmlPath = fs
      .readdirSync(outputDir)
      .find((file) => file.toLowerCase().endsWith('.xml'));

    if (!xmlPath) {
      throw new Error('OpenVINO conversion completed but no IR (.xml) file was produced.');
    }

    const fullXmlPath = path.join(outputDir, xmlPath);

    return {
      success: true,
      outputPath: fullXmlPath,
      message: `Converted to OpenVINO IR (${precision.toUpperCase()}).`,
    };
  }
}

function createModelConverter(store, appPath) {
  return new ModelConverter(store, appPath);
}

module.exports = {
  ModelConverter,
  createModelConverter,
};

