/**
 * FormatConverter - Model format conversion service
 * 
 * Features:
 * - GGUF re-quantization (e.g., Q8 → Q4_K_M)
 * - Safetensors → GGUF conversion (via llama.cpp)
 * - ONNX model optimization
 * - OpenVINO IR conversion
 * - Conversion queue with progress tracking
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const os = require('os');

// Conversion job statuses
const ConversionStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

// Supported conversions
const ConversionType = {
  GGUF_REQUANT: 'gguf-requant',
  SAFETENSORS_TO_GGUF: 'safetensors-to-gguf',
  PYTORCH_TO_GGUF: 'pytorch-to-gguf',
  ONNX_OPTIMIZE: 'onnx-optimize',
  TO_OPENVINO: 'to-openvino',
};

// Quantization types for GGUF
const GGUF_QUANT_TYPES = [
  'Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q3_K_L',
  'Q4_0', 'Q4_1', 'Q4_K_S', 'Q4_K_M',
  'Q5_0', 'Q5_1', 'Q5_K_S', 'Q5_K_M',
  'Q6_K', 'Q8_0',
  'IQ2_XXS', 'IQ2_XS', 'IQ3_XXS', 'IQ3_XS',
  'IQ4_NL', 'IQ4_XS',
];

/**
 * Conversion job
 */
class ConversionJob {
  constructor(data) {
    this.id = data.id || `conv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.type = data.type;
    this.sourcePath = data.sourcePath;
    this.outputPath = data.outputPath;
    this.options = data.options || {};
    this.status = data.status || ConversionStatus.QUEUED;
    this.progress = data.progress || 0;
    this.error = data.error || null;
    this.startedAt = data.startedAt || null;
    this.completedAt = data.completedAt || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.logs = data.logs || [];
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      sourcePath: this.sourcePath,
      outputPath: this.outputPath,
      options: this.options,
      status: this.status,
      progress: this.progress,
      error: this.error,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      createdAt: this.createdAt,
      logs: this.logs.slice(-100), // Last 100 log lines
    };
  }
}

/**
 * FormatConverter class
 */
class FormatConverter extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.activeJobs = new Map();
    this.maxConcurrent = 1; // Conversions are CPU-intensive
    this.llamaCppPath = null;
    this.pythonPath = null;
    this.processing = false;
  }

  /**
   * Initialize the converter
   */
  async initialize(options = {}) {
    // Find llama.cpp quantize tool
    this.llamaCppPath = options.llamaCppPath || await this._findLlamaCpp();
    
    // Find Python for safetensors conversion
    this.pythonPath = options.pythonPath || await this._findPython();
    
    console.log('[FormatConverter] Initialized:', {
      llamaCpp: this.llamaCppPath ? 'found' : 'not found',
      python: this.pythonPath ? 'found' : 'not found',
    });
  }

  /**
   * Find llama.cpp quantize tool
   */
  async _findLlamaCpp() {
    const possiblePaths = [
      path.join(process.cwd(), 'llama.cpp', 'quantize'),
      path.join(process.cwd(), 'llama.cpp', 'quantize.exe'),
      path.join(os.homedir(), 'llama.cpp', 'quantize'),
      path.join(os.homedir(), 'llama.cpp', 'quantize.exe'),
      'C:\\llama.cpp\\quantize.exe',
      '/usr/local/bin/llama-quantize',
      '/opt/llama.cpp/quantize',
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    
    // Try to find in PATH
    return new Promise((resolve) => {
      exec('which llama-quantize || where quantize.exe', (error, stdout) => {
        if (!error && stdout.trim()) {
          resolve(stdout.trim().split('\n')[0]);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Find Python interpreter
   */
  async _findPython() {
    const possiblePaths = [
      'python3',
      'python',
      path.join(process.cwd(), 'venv', 'bin', 'python'),
      path.join(process.cwd(), 'venv', 'Scripts', 'python.exe'),
      path.join(os.homedir(), '.pyenv', 'shims', 'python'),
    ];
    
    for (const p of possiblePaths) {
      try {
        const result = await new Promise((resolve) => {
          exec(`${p} --version`, (error) => {
            resolve(!error);
          });
        });
        if (result) return p;
      } catch (e) {
        continue;
      }
    }
    
    return null;
  }

  /**
   * Get supported conversion types for a file
   */
  getSupportedConversions(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const conversions = [];
    
    if (ext === '.gguf') {
      conversions.push({
        type: ConversionType.GGUF_REQUANT,
        name: 'Re-quantize GGUF',
        description: 'Change quantization level (e.g., Q8 → Q4_K_M)',
        available: !!this.llamaCppPath,
        options: {
          quantTypes: GGUF_QUANT_TYPES,
        },
      });
    }
    
    if (ext === '.safetensors' || ext === '.bin' || ext === '.pt' || ext === '.pth') {
      conversions.push({
        type: ConversionType.SAFETENSORS_TO_GGUF,
        name: 'Convert to GGUF',
        description: 'Convert safetensors/PyTorch model to GGUF format',
        available: !!this.pythonPath,
        options: {
          quantTypes: GGUF_QUANT_TYPES,
        },
      });
    }
    
    if (ext === '.onnx') {
      conversions.push({
        type: ConversionType.ONNX_OPTIMIZE,
        name: 'Optimize ONNX',
        description: 'Optimize ONNX model for inference',
        available: !!this.pythonPath,
      });
    }
    
    // OpenVINO conversion
    conversions.push({
      type: ConversionType.TO_OPENVINO,
      name: 'Convert to OpenVINO',
      description: 'Convert model to OpenVINO IR format for NPU acceleration',
      available: !!this.pythonPath,
      options: {
        precisions: ['FP32', 'FP16', 'INT8'],
      },
    });
    
    return conversions;
  }

  /**
   * Create a conversion job
   */
  async createJob(type, sourcePath, options = {}) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Source file not found');
    }
    
    // Determine output path
    const sourceDir = path.dirname(sourcePath);
    const sourceName = path.basename(sourcePath, path.extname(sourcePath));
    let outputExt = '.gguf';
    let outputSuffix = '';
    
    switch (type) {
      case ConversionType.GGUF_REQUANT:
        outputSuffix = `-${options.quantType || 'Q4_K_M'}`;
        break;
      case ConversionType.SAFETENSORS_TO_GGUF:
      case ConversionType.PYTORCH_TO_GGUF:
        outputSuffix = `-${options.quantType || 'F16'}`;
        break;
      case ConversionType.ONNX_OPTIMIZE:
        outputExt = '.onnx';
        outputSuffix = '-optimized';
        break;
      case ConversionType.TO_OPENVINO:
        outputExt = '.xml';
        outputSuffix = `-${options.precision || 'FP16'}`;
        break;
    }
    
    const outputPath = options.outputPath || path.join(
      options.outputDir || sourceDir,
      `${sourceName}${outputSuffix}${outputExt}`
    );
    
    const job = new ConversionJob({
      type,
      sourcePath,
      outputPath,
      options,
    });
    
    this.queue.push(job);
    this.emit('job:created', job.toJSON());
    
    // Start processing
    this._processQueue();
    
    return job.id;
  }

  /**
   * Process the conversion queue
   */
  async _processQueue() {
    if (this.processing) return;
    this.processing = true;
    
    try {
      while (this.activeJobs.size < this.maxConcurrent) {
        const job = this.queue.find(j => j.status === ConversionStatus.QUEUED);
        if (!job) break;
        
        job.status = ConversionStatus.RUNNING;
        job.startedAt = new Date().toISOString();
        this.activeJobs.set(job.id, job);
        
        this.emit('job:started', job.toJSON());
        
        try {
          await this._runConversion(job);
          
          job.status = ConversionStatus.COMPLETED;
          job.progress = 100;
          job.completedAt = new Date().toISOString();
          
          this.emit('job:completed', job.toJSON());
        } catch (error) {
          job.status = ConversionStatus.ERROR;
          job.error = error.message;
          job.completedAt = new Date().toISOString();
          
          this.emit('job:error', job.toJSON());
        } finally {
          this.activeJobs.delete(job.id);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Run a conversion job
   */
  async _runConversion(job) {
    switch (job.type) {
      case ConversionType.GGUF_REQUANT:
        return this._runGgufRequant(job);
      case ConversionType.SAFETENSORS_TO_GGUF:
      case ConversionType.PYTORCH_TO_GGUF:
        return this._runToGguf(job);
      case ConversionType.ONNX_OPTIMIZE:
        return this._runOnnxOptimize(job);
      case ConversionType.TO_OPENVINO:
        return this._runToOpenvino(job);
      default:
        throw new Error(`Unknown conversion type: ${job.type}`);
    }
  }

  /**
   * Re-quantize GGUF model
   */
  async _runGgufRequant(job) {
    if (!this.llamaCppPath) {
      throw new Error('llama.cpp quantize tool not found');
    }
    
    const quantType = job.options.quantType || 'Q4_K_M';
    
    return new Promise((resolve, reject) => {
      const args = [
        job.sourcePath,
        job.outputPath,
        quantType,
      ];
      
      if (job.options.threads) {
        args.push('--threads', job.options.threads.toString());
      }
      
      const proc = spawn(this.llamaCppPath, args, { windowsHide: true });
      
      proc.stdout.on('data', (data) => {
        const line = data.toString();
        job.logs.push(line);
        
        // Parse progress
        const progressMatch = line.match(/(\d+)%|(\d+)\/(\d+)/);
        if (progressMatch) {
          if (progressMatch[1]) {
            job.progress = parseInt(progressMatch[1], 10);
          } else if (progressMatch[2] && progressMatch[3]) {
            job.progress = Math.round((parseInt(progressMatch[2], 10) / parseInt(progressMatch[3], 10)) * 100);
          }
          this.emit('job:progress', job.toJSON());
        }
      });
      
      proc.stderr.on('data', (data) => {
        job.logs.push(`[stderr] ${data.toString()}`);
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Quantization failed with code ${code}`));
        }
      });
      
      proc.on('error', reject);
    });
  }

  /**
   * Convert to GGUF format
   */
  async _runToGguf(job) {
    if (!this.pythonPath) {
      throw new Error('Python not found');
    }
    
    // Use llama.cpp's convert.py script
    const convertScript = path.join(
      path.dirname(this.llamaCppPath || ''),
      'convert.py'
    );
    
    if (!fs.existsSync(convertScript)) {
      throw new Error('llama.cpp convert.py script not found. Please install llama.cpp.');
    }
    
    const quantType = job.options.quantType || 'f16';
    
    return new Promise((resolve, reject) => {
      const args = [
        convertScript,
        job.sourcePath,
        '--outfile', job.outputPath,
        '--outtype', quantType.toLowerCase(),
      ];
      
      const proc = spawn(this.pythonPath, args, { windowsHide: true });
      
      proc.stdout.on('data', (data) => {
        const line = data.toString();
        job.logs.push(line);
        
        // Try to parse progress
        if (line.includes('Loading')) {
          job.progress = 10;
        } else if (line.includes('Converting')) {
          job.progress = 50;
        } else if (line.includes('Writing')) {
          job.progress = 90;
        }
        
        this.emit('job:progress', job.toJSON());
      });
      
      proc.stderr.on('data', (data) => {
        job.logs.push(`[stderr] ${data.toString()}`);
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Conversion failed with code ${code}`));
        }
      });
      
      proc.on('error', reject);
    });
  }

  /**
   * Optimize ONNX model
   */
  async _runOnnxOptimize(job) {
    if (!this.pythonPath) {
      throw new Error('Python not found');
    }
    
    const script = `
import onnx
from onnxruntime.transformers import optimizer
import sys

model = onnx.load("${job.sourcePath.replace(/\\/g, '/')}")
optimized = optimizer.optimize_model(
    "${job.sourcePath.replace(/\\/g, '/')}",
    model_type='bert',
    num_heads=12,
    hidden_size=768
)
optimized.save_model_to_file("${job.outputPath.replace(/\\/g, '/')}")
print("Optimization complete")
`;
    
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, ['-c', script], { windowsHide: true });
      
      proc.stdout.on('data', (data) => {
        job.logs.push(data.toString());
        if (data.toString().includes('complete')) {
          job.progress = 100;
          this.emit('job:progress', job.toJSON());
        }
      });
      
      proc.stderr.on('data', (data) => {
        job.logs.push(`[stderr] ${data.toString()}`);
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ONNX optimization failed with code ${code}`));
        }
      });
      
      proc.on('error', reject);
    });
  }

  /**
   * Convert to OpenVINO IR format
   */
  async _runToOpenvino(job) {
    if (!this.pythonPath) {
      throw new Error('Python not found');
    }
    
    const precision = job.options.precision || 'FP16';
    
    const script = `
from openvino.tools import mo
import sys

model = mo.convert_model(
    "${job.sourcePath.replace(/\\/g, '/')}",
    compress_to_fp16=${precision === 'FP16' ? 'True' : 'False'}
)

from openvino.runtime import serialize
serialize(model, "${job.outputPath.replace(/\\/g, '/')}")
print("Conversion complete")
`;
    
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, ['-c', script], { windowsHide: true });
      
      proc.stdout.on('data', (data) => {
        job.logs.push(data.toString());
        if (data.toString().includes('complete')) {
          job.progress = 100;
          this.emit('job:progress', job.toJSON());
        }
      });
      
      proc.stderr.on('data', (data) => {
        job.logs.push(`[stderr] ${data.toString()}`);
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`OpenVINO conversion failed with code ${code}`));
        }
      });
      
      proc.on('error', reject);
    });
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return false;
    
    if (job.status === ConversionStatus.QUEUED) {
      job.status = ConversionStatus.CANCELLED;
      this.emit('job:cancelled', job.toJSON());
      return true;
    }
    
    // Can't cancel running jobs easily without process management
    return false;
  }

  /**
   * Get all jobs
   */
  getAllJobs() {
    return this.queue.map(j => j.toJSON());
  }

  /**
   * Get a specific job
   */
  getJob(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    return job ? job.toJSON() : null;
  }

  /**
   * Clear completed jobs
   */
  clearCompleted() {
    this.queue = this.queue.filter(j => 
      j.status !== ConversionStatus.COMPLETED && 
      j.status !== ConversionStatus.ERROR &&
      j.status !== ConversionStatus.CANCELLED
    );
    return true;
  }

  /**
   * Get available quantization types
   */
  getQuantTypes() {
    return GGUF_QUANT_TYPES;
  }

  /**
   * Estimate conversion time
   */
  estimateConversionTime(sourcePath, type, options = {}) {
    // Get file size
    let size = 0;
    try {
      const stats = fs.statSync(sourcePath);
      size = stats.size;
    } catch (e) {
      return null;
    }
    
    const sizeGB = size / (1024 * 1024 * 1024);
    
    // Rough estimates based on file size and type
    switch (type) {
      case ConversionType.GGUF_REQUANT:
        return Math.round(sizeGB * 2 * 60); // ~2 min per GB
      case ConversionType.SAFETENSORS_TO_GGUF:
        return Math.round(sizeGB * 5 * 60); // ~5 min per GB
      case ConversionType.ONNX_OPTIMIZE:
        return Math.round(sizeGB * 1 * 60); // ~1 min per GB
      case ConversionType.TO_OPENVINO:
        return Math.round(sizeGB * 10 * 60); // ~10 min per GB
      default:
        return null;
    }
  }
}

// Singleton
let converterInstance = null;

function getFormatConverter() {
  if (!converterInstance) {
    converterInstance = new FormatConverter();
  }
  return converterInstance;
}

module.exports = {
  FormatConverter,
  getFormatConverter,
  ConversionType,
  ConversionStatus,
  GGUF_QUANT_TYPES,
};



