/**
 * Intelligent Model Optimizer
 * 
 * Automatically detects optimal settings for each model based on:
 * - Model family (llama, mistral, qwen, deepseek, phi, etc.)
 * - Parameter size (7B, 13B, 70B)
 * - Quantization level (Q4, Q5, Q8, F16)
 * - Model purpose (code, chat, creative, instruct)
 * 
 * This mimics what power users manually configure in LM Studio.
 */

// Model family profiles with optimal defaults
// EXPORTED so other services can access model context capabilities
//
// NOTE: stopTokens have been intentionally REMOVED from all families.
// With Ollama's /api/chat endpoint, the model's chat template already
// handles stop tokens natively. Manually injecting stop tokens caused
// premature truncation, broken thinking models, and conflicting behavior.
// Only the /api/generate fallback path in ipc-handlers.js adds minimal
// turn-leak prevention tokens (Human:, User:).
export const MODEL_FAMILIES = {
  // ━━━ CODE MODELS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  codellama: {
    type: 'code', temperature: 0.3, top_p: 0.9, top_k: 40, repeat_penalty: 1.1,
    maxContext: 16384,
  },
  deepseek: {
    type: 'code', temperature: 0.2, top_p: 0.95, top_k: 50, repeat_penalty: 1.05,
    maxContext: 16384,
  },
  'deepseek-coder': {
    type: 'code', temperature: 0.1, top_p: 0.95, top_k: 40, repeat_penalty: 1.0,
    maxContext: 16384,
  },
  'deepseek-r1': {
    type: 'reasoning', temperature: 0.6, top_p: 0.95, top_k: 40, repeat_penalty: 1.0,
    maxContext: 131072,
  },
  'deepseek-v2': {
    type: 'chat', temperature: 0.6, top_p: 0.95, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'deepseek-v3': {
    type: 'chat', temperature: 0.6, top_p: 0.95, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  starcoder: {
    type: 'code', temperature: 0.2, top_p: 0.95, top_k: 50, repeat_penalty: 1.0,
    maxContext: 8192,
  },
  'starcoder2': {
    type: 'code', temperature: 0.2, top_p: 0.95, top_k: 50, repeat_penalty: 1.0,
    maxContext: 16384,
  },
  codegemma: {
    type: 'code', temperature: 0.2, top_p: 0.95, top_k: 40, repeat_penalty: 1.0,
    maxContext: 8192,
  },
  qwen2coder: {
    type: 'code', temperature: 0.2, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  
  // ━━━ CHAT MODELS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  llama: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.1,
    maxContext: 4096,
  },
  'llama2': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.1,
    maxContext: 4096,
  },
  'llama3': {
    type: 'chat', temperature: 0.6, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  'llama3.1': {
    type: 'chat', temperature: 0.6, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'llama3.2': {
    type: 'chat', temperature: 0.6, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'llama3.3': {
    type: 'chat', temperature: 0.6, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  mistral: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  'mistral-nemo': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'mistral-small': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  mixtral: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  qwen: {
    type: 'chat', temperature: 0.7, top_p: 0.8, top_k: 20, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  qwen2: {
    type: 'chat', temperature: 0.7, top_p: 0.8, top_k: 20, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'qwen2.5': {
    type: 'chat', temperature: 0.7, top_p: 0.8, top_k: 20, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'qwq': {
    type: 'reasoning', temperature: 0.6, top_p: 0.95, top_k: 40, repeat_penalty: 1.0,
    maxContext: 131072,
  },
  phi: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  'phi3': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'phi4': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 16384,
  },
  gemma: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  gemma2: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  'gemma3': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  yi: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  'yi-1.5': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  vicuna: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  solar: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  // New 2024-2025 model families
  'command-r': {
    type: 'instruct', temperature: 0.5, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  internlm: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  'internlm2': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  glm: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'chatglm': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  exaone: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  olmo: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  'olmo2': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 32768,
  },
  granite: {
    type: 'instruct', temperature: 0.5, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  'granite-code': {
    type: 'code', temperature: 0.2, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  smollm: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  'smollm2': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  pixtral: {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  'llava': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  'bakllava': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  'moondream': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  'gpt-oss': {
    type: 'chat', temperature: 0.2, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 131072,
  },
  // Catch-all for GPT-style / generic GGUF models
  'gpt': {
    type: 'chat', temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.1,
    maxContext: 4096,
  },
  
  // ━━━ CREATIVE/ROLEPLAY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  nous: {
    type: 'creative', temperature: 0.85, top_p: 0.95, top_k: 60, repeat_penalty: 1.1,
    maxContext: 4096,
  },
  'hermes': {
    type: 'creative', temperature: 0.8, top_p: 0.95, top_k: 50, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  openhermes: {
    type: 'creative', temperature: 0.8, top_p: 0.95, top_k: 50, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  'dolphin': {
    type: 'creative', temperature: 0.8, top_p: 0.95, top_k: 50, repeat_penalty: 1.05,
    maxContext: 16384,
  },
  neural: {
    type: 'creative', temperature: 0.8, top_p: 0.95, top_k: 50, repeat_penalty: 1.1,
    maxContext: 4096,
  },
  'mythomax': {
    type: 'creative', temperature: 0.85, top_p: 0.95, top_k: 60, repeat_penalty: 1.1,
    maxContext: 4096,
  },
  
  // ━━━ INSTRUCT/ASSISTANT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  zephyr: {
    type: 'instruct', temperature: 0.5, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  openchat: {
    type: 'instruct', temperature: 0.5, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 8192,
  },
  orca: {
    type: 'instruct', temperature: 0.5, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  wizard: {
    type: 'instruct', temperature: 0.5, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
  command: {
    type: 'instruct', temperature: 0.5, top_p: 0.9, top_k: 40, repeat_penalty: 1.05,
    maxContext: 4096,
  },
};

// Quantization affects memory and quality
const QUANTIZATION_PROFILES = {
  // Full precision
  'F32': { qualityMultiplier: 1.0, memoryMultiplier: 4.0, contextScale: 0.5 },
  'F16': { qualityMultiplier: 0.99, memoryMultiplier: 2.0, contextScale: 0.7 },
  'BF16': { qualityMultiplier: 0.99, memoryMultiplier: 2.0, contextScale: 0.7 },
  
  // MXFP (Microscaling Floating Point) - used by Intel/ONNX/OpenVINO
  'MXFP8': { qualityMultiplier: 0.96, memoryMultiplier: 1.0, contextScale: 1.0 },
  'MXFP4': { qualityMultiplier: 0.82, memoryMultiplier: 0.5, contextScale: 1.5 },
  'FP8': { qualityMultiplier: 0.96, memoryMultiplier: 1.0, contextScale: 1.0 },
  'FP4': { qualityMultiplier: 0.80, memoryMultiplier: 0.5, contextScale: 1.5 },
  
  // 8-bit
  'Q8_0': { qualityMultiplier: 0.95, memoryMultiplier: 1.0, contextScale: 1.0 },
  'Q8': { qualityMultiplier: 0.95, memoryMultiplier: 1.0, contextScale: 1.0 },
  
  // 6-bit
  'Q6_K': { qualityMultiplier: 0.92, memoryMultiplier: 0.75, contextScale: 1.2 },
  'Q6_K_L': { qualityMultiplier: 0.93, memoryMultiplier: 0.78, contextScale: 1.15 },
  
  // 5-bit
  'Q5_K_M': { qualityMultiplier: 0.90, memoryMultiplier: 0.65, contextScale: 1.3 },
  'Q5_K_S': { qualityMultiplier: 0.88, memoryMultiplier: 0.6, contextScale: 1.4 },
  'Q5_K_L': { qualityMultiplier: 0.91, memoryMultiplier: 0.68, contextScale: 1.25 },
  'Q5_1': { qualityMultiplier: 0.89, memoryMultiplier: 0.65, contextScale: 1.3 },
  'Q5_0': { qualityMultiplier: 0.87, memoryMultiplier: 0.6, contextScale: 1.4 },
  
  // 4-bit - most popular balance
  'Q4_K_M': { qualityMultiplier: 0.85, memoryMultiplier: 0.5, contextScale: 1.5 },
  'Q4_K_S': { qualityMultiplier: 0.82, memoryMultiplier: 0.45, contextScale: 1.6 },
  'Q4_K_L': { qualityMultiplier: 0.86, memoryMultiplier: 0.52, contextScale: 1.45 },
  'Q4_1': { qualityMultiplier: 0.83, memoryMultiplier: 0.5, contextScale: 1.5 },
  'Q4_0': { qualityMultiplier: 0.80, memoryMultiplier: 0.45, contextScale: 1.6 },
  
  // 3-bit
  'Q3_K_M': { qualityMultiplier: 0.75, memoryMultiplier: 0.4, contextScale: 1.8 },
  'Q3_K_S': { qualityMultiplier: 0.72, memoryMultiplier: 0.35, contextScale: 2.0 },
  'Q3_K_L': { qualityMultiplier: 0.77, memoryMultiplier: 0.42, contextScale: 1.7 },
  
  // 2-bit
  'Q2_K': { qualityMultiplier: 0.65, memoryMultiplier: 0.3, contextScale: 2.2 },
  
  // IQuants (importance-based quantization)
  'IQ4_XS': { qualityMultiplier: 0.84, memoryMultiplier: 0.45, contextScale: 1.6 },
  'IQ4_NL': { qualityMultiplier: 0.85, memoryMultiplier: 0.45, contextScale: 1.6 },
  'IQ3_M': { qualityMultiplier: 0.74, memoryMultiplier: 0.38, contextScale: 1.9 },
  'IQ3_S': { qualityMultiplier: 0.72, memoryMultiplier: 0.35, contextScale: 2.0 },
  'IQ3_XS': { qualityMultiplier: 0.70, memoryMultiplier: 0.33, contextScale: 2.1 },
  'IQ3_XXS': { qualityMultiplier: 0.68, memoryMultiplier: 0.31, contextScale: 2.15 },
  'IQ2_M': { qualityMultiplier: 0.60, memoryMultiplier: 0.28, contextScale: 2.3 },
  'IQ2_S': { qualityMultiplier: 0.55, memoryMultiplier: 0.25, contextScale: 2.5 },
  'IQ2_XS': { qualityMultiplier: 0.52, memoryMultiplier: 0.23, contextScale: 2.6 },
  'IQ2_XXS': { qualityMultiplier: 0.50, memoryMultiplier: 0.22, contextScale: 2.7 },
  'IQ1_M': { qualityMultiplier: 0.45, memoryMultiplier: 0.2, contextScale: 2.8 },
  'IQ1_S': { qualityMultiplier: 0.40, memoryMultiplier: 0.18, contextScale: 3.0 },
};

// Model size affects context and batch settings
// gpuLayers: -1 = all layers on GPU (small enough to fit)
// gpuLayers: N = partial offload (too big for most GPUs without quant)
// vramEstimateGB: approximate VRAM for Q4_K_M quantization (for smart GPU decisions)
const SIZE_PROFILES = {
  '0.5B': { contextDefault: 4096, batchSize: 512, gpuLayers: -1, vramEstimateGB: 0.5 },
  '1B':   { contextDefault: 4096, batchSize: 512, gpuLayers: -1, vramEstimateGB: 0.8 },
  '1.5B': { contextDefault: 4096, batchSize: 512, gpuLayers: -1, vramEstimateGB: 1.2 },
  '2B':   { contextDefault: 4096, batchSize: 512, gpuLayers: -1, vramEstimateGB: 1.5 },
  '3B':   { contextDefault: 4096, batchSize: 512, gpuLayers: -1, vramEstimateGB: 2.2 },
  '4B':   { contextDefault: 4096, batchSize: 256, gpuLayers: -1, vramEstimateGB: 3.0 },
  '7B':   { contextDefault: 8192, batchSize: 256, gpuLayers: -1, vramEstimateGB: 4.5 },
  '8B':   { contextDefault: 8192, batchSize: 256, gpuLayers: -1, vramEstimateGB: 5.0 },
  '9B':   { contextDefault: 8192, batchSize: 256, gpuLayers: -1, vramEstimateGB: 5.5 },
  '13B':  { contextDefault: 8192, batchSize: 128, gpuLayers: -1, vramEstimateGB: 8.0 },
  '14B':  { contextDefault: 8192, batchSize: 128, gpuLayers: -1, vramEstimateGB: 9.0 },
  '20B':  { contextDefault: 4096, batchSize: 64,  gpuLayers: -1, vramEstimateGB: 12.0 },
  '30B':  { contextDefault: 4096, batchSize: 64,  gpuLayers: -1, vramEstimateGB: 18.0 },
  '32B':  { contextDefault: 4096, batchSize: 64,  gpuLayers: -1, vramEstimateGB: 19.0 },
  '34B':  { contextDefault: 4096, batchSize: 64,  gpuLayers: -1, vramEstimateGB: 20.0 },
  '70B':  { contextDefault: 2048, batchSize: 32,  gpuLayers: -1, vramEstimateGB: 40.0 },
  '72B':  { contextDefault: 2048, batchSize: 32,  gpuLayers: -1, vramEstimateGB: 42.0 },
  '405B': { contextDefault: 1024, batchSize: 16,  gpuLayers: -1, vramEstimateGB: 230.0 },
};

/**
 * Parse model name to extract family, size, and quantization
 */
export function parseModelName(modelName) {
  if (!modelName) return { family: null, size: null, quantization: null };
  
  const name = modelName.toLowerCase();
  
  // Detect model family (check more specific patterns first, then generic)
  let family = null;
  const familyPatterns = [
    // ── Code models (most specific first) ──
    { pattern: /deepseek[-_]?coder/i, family: 'deepseek-coder' },
    { pattern: /qwen2[-_]?\.?5[-_]?coder/i, family: 'qwen2coder' },
    { pattern: /qwen[-_]?coder/i, family: 'qwen2coder' },
    { pattern: /code[-_]?llama/i, family: 'codellama' },
    { pattern: /codellama/i, family: 'codellama' },
    { pattern: /starcoder[-_]?2/i, family: 'starcoder2' },
    { pattern: /starcoder/i, family: 'starcoder' },
    { pattern: /code[-_]?gemma/i, family: 'codegemma' },
    { pattern: /granite[-_]?code/i, family: 'granite-code' },
    
    // ── DeepSeek variants (before generic deepseek) ──
    { pattern: /deepseek[-_]?r1/i, family: 'deepseek-r1' },
    { pattern: /deepseek[-_]?v3/i, family: 'deepseek-v3' },
    { pattern: /deepseek[-_]?v2/i, family: 'deepseek-v2' },
    
    // ── Versioned models (before generic) ──
    { pattern: /llama[-_]?3\.3/i, family: 'llama3.3' },
    { pattern: /llama[-_]?3\.2/i, family: 'llama3.2' },
    { pattern: /llama[-_]?3\.1/i, family: 'llama3.1' },
    { pattern: /llama[-_]?3/i, family: 'llama3' },
    { pattern: /llama[-_]?2/i, family: 'llama2' },
    { pattern: /phi[-_]?4/i, family: 'phi4' },
    { pattern: /phi[-_]?3/i, family: 'phi3' },
    { pattern: /gemma[-_]?3/i, family: 'gemma3' },
    { pattern: /gemma[-_]?2/i, family: 'gemma2' },
    { pattern: /qwen[-_]?2\.5/i, family: 'qwen2.5' },
    { pattern: /qwen[-_]?2/i, family: 'qwen2' },
    { pattern: /yi[-_]?1\.5/i, family: 'yi-1.5' },
    { pattern: /internlm[-_]?2/i, family: 'internlm2' },
    { pattern: /smollm[-_]?2/i, family: 'smollm2' },
    { pattern: /olmo[-_]?2/i, family: 'olmo2' },
    
    // ── New 2024-2025 families ──
    { pattern: /command[-_]?r/i, family: 'command-r' },
    { pattern: /mistral[-_]?nemo/i, family: 'mistral-nemo' },
    { pattern: /mistral[-_]?small/i, family: 'mistral-small' },
    { pattern: /chatglm/i, family: 'chatglm' },
    { pattern: /pixtral/i, family: 'pixtral' },
    { pattern: /exaone/i, family: 'exaone' },
    { pattern: /granite/i, family: 'granite' },
    { pattern: /mythomax/i, family: 'mythomax' },
    
    // ── Creative models ──
    { pattern: /open[-_]?hermes/i, family: 'openhermes' },
    { pattern: /hermes/i, family: 'hermes' },
    { pattern: /dolphin/i, family: 'dolphin' },
    { pattern: /nous/i, family: 'nous' },
    { pattern: /neural[-_]?chat/i, family: 'neural' },
    
    // ── Instruct models ──
    { pattern: /zephyr/i, family: 'zephyr' },
    { pattern: /open[-_]?chat/i, family: 'openchat' },
    { pattern: /orca/i, family: 'orca' },
    { pattern: /wizard/i, family: 'wizard' },
    { pattern: /command/i, family: 'command-r' },
    
    // ── Vision models ──
    { pattern: /bakllava/i, family: 'bakllava' },
    { pattern: /llava/i, family: 'llava' },
    { pattern: /moondream/i, family: 'moondream' },
    { pattern: /gpt[-_]?oss/i, family: 'gpt-oss' },
    
    // ── Generic models (check last) ──
    { pattern: /llama/i, family: 'llama' },
    { pattern: /mistral/i, family: 'mistral' },
    { pattern: /mixtral/i, family: 'mixtral' },
    { pattern: /qwen/i, family: 'qwen' },
    { pattern: /deepseek/i, family: 'deepseek' },
    { pattern: /phi/i, family: 'phi' },
    { pattern: /gemma/i, family: 'gemma' },
    { pattern: /yi\b/i, family: 'yi' },
    { pattern: /vicuna/i, family: 'vicuna' },
    { pattern: /solar/i, family: 'solar' },
    { pattern: /internlm/i, family: 'internlm' },
    { pattern: /glm/i, family: 'glm' },
    { pattern: /smollm/i, family: 'smollm' },
    { pattern: /olmo/i, family: 'olmo' },
    { pattern: /gpt/i, family: 'gpt' },
  ];
  
  for (const { pattern, family: f } of familyPatterns) {
    if (pattern.test(name)) {
      family = f;
      break;
    }
  }
  
  // Detect parameter size - supports: "7b", "7B", "7.5b", "20b", "1_5b", "0.5B", etc.
  let size = null;
  const sizeMatch = name.match(/[-_.]?(\d+(?:[._]\d+)?)\s*[bB](?![a-zA-Z])/);
  if (sizeMatch) {
    const num = parseFloat(sizeMatch[1].replace('_', '.'));
    // Normalize to standard sizes with wider ranges
    if (num <= 0.6) size = '0.5B';
    else if (num <= 1.2) size = '1B';
    else if (num <= 1.8) size = '1.5B';
    else if (num <= 2.5) size = '2B';
    else if (num <= 4.5) size = '3B';
    else if (num <= 5.5) size = '4B';
    else if (num <= 7.5) size = '7B';
    else if (num <= 8.5) size = '8B';
    else if (num <= 10) size = '9B';
    else if (num <= 13.5) size = '13B';
    else if (num <= 16) size = '14B';
    else if (num <= 25) size = '20B';
    else if (num <= 31) size = '30B';
    else if (num <= 35) size = '34B';
    else if (num <= 73) size = '70B';
    else size = '405B';
  }
  
  // Detect quantization - comprehensive pattern matching
  let quantization = null;
  const quantPatterns = [
    // MXFP / FP variants (Intel, ONNX, OpenVINO)
    /[._-](MXFP8|MXFP4|FP8|FP4)/i,
    // Full precision
    /[._-](F32|F16|BF16)/i,
    // Standard GGUF quants
    /[._-](Q8_0|Q8)/i,
    /[._-](Q6_K_L|Q6_K)/i,
    /[._-](Q5_K_[MSL]|Q5_[01])/i,
    /[._-](Q4_K_[MSL]|Q4_[01])/i,
    /[._-](Q3_K_[MSL])/i,
    /[._-](Q2_K)/i,
    // IQuants (importance quantization)
    /[._-](IQ4_XS|IQ4_NL)/i,
    /[._-](IQ3_XXS|IQ3_XS|IQ3_[MS])/i,
    /[._-](IQ2_XXS|IQ2_XS|IQ2_[MS])/i,
    /[._-](IQ1_[MS])/i,
  ];
  
  for (const pattern of quantPatterns) {
    const match = name.match(pattern);
    if (match) {
      quantization = match[1].toUpperCase();
      break;
    }
  }
  
  return { family, size, quantization };
}

/**
 * Get optimal settings for a model
 */
export function getOptimalSettings(modelName, workspaceType = 'casual') {
  const parsed = parseModelName(modelName);
  const { family, size, quantization } = parsed;
  
  // Start with solid defaults
  let settings = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 4096,
    num_batch: 256,
    num_gpu: -1, // Default: all layers on GPU
    num_predict: 4096,
    // NOTE: stop tokens are intentionally empty. With /api/chat, Ollama's
    // chat template handles stop tokens natively. Manual injection caused
    // premature truncation and broke thinking models.
    // Metadata for UI/debugging
    _detected: parsed,
    _source: 'default',
  };
  
  // Apply family-specific settings
  const familyProfile = family && MODEL_FAMILIES[family];
  if (familyProfile) {
    settings = {
      ...settings,
      temperature: familyProfile.temperature,
      top_p: familyProfile.top_p,
      top_k: familyProfile.top_k,
      repeat_penalty: familyProfile.repeat_penalty,
      // Use the family's full context capability (adaptive generation will cap it based on hardware)
      num_ctx: familyProfile.maxContext,
      _source: `family:${family}`,
      _modelType: familyProfile.type,
    };
  }
  
  // Apply size-specific settings
  const sizeProfile = size && SIZE_PROFILES[size];
  if (sizeProfile) {
    // Use the LARGER of size default and family context (family knows the model's actual capability)
    const familyMaxCtx = familyProfile?.maxContext || 4096;
    settings = {
      ...settings,
      num_ctx: Math.min(familyMaxCtx, Math.max(settings.num_ctx, sizeProfile.contextDefault)),
      num_batch: sizeProfile.batchSize,
      num_gpu: sizeProfile.gpuLayers,
      _source: `${settings._source}+size:${size}`,
    };
  }
  
  // Apply quantization adjustments
  const quantProfile = quantization && QUANTIZATION_PROFILES[quantization];
  if (quantProfile) {
    // Lower quant = less memory = can use more context
    const familyMax = familyProfile?.maxContext || 8192;
    const contextBoost = Math.floor(settings.num_ctx * quantProfile.contextScale);
    settings.num_ctx = Math.min(contextBoost, familyMax);
    
    // MXFP models often need different batch sizes
    if (quantization.startsWith('MXFP') || quantization.startsWith('FP')) {
      settings.num_batch = Math.max(settings.num_batch, 128);
    }
    
    settings._source += `+quant:${quantization}`;
  }
  
  // Workspace-specific adjustments
  if (workspaceType === 'code') {
    settings.temperature = Math.max(0.1, settings.temperature - 0.3);
    settings.top_p = Math.min(0.95, settings.top_p);
    settings._source += '+workspace:code';
  } else if (workspaceType === 'creative') {
    settings.temperature = Math.min(1.0, settings.temperature + 0.15);
    settings.top_k = Math.min(100, settings.top_k + 20);
    settings.repeat_penalty = Math.max(1.0, settings.repeat_penalty - 0.05);
    settings._source += '+workspace:creative';
  }
  
  return settings;
}

/**
 * Estimate VRAM usage for a model
 */
export function estimateVRAMUsage(modelName, contextLength = 4096) {
  const parsed = parseModelName(modelName);
  const { size, quantization } = parsed;
  
  // Base VRAM per billion parameters (rough estimates)
  const baseVRAMPerB = {
    '0.5B': 0.5, '1B': 1, '1.5B': 1.5, '2B': 2, '3B': 3,
    '4B': 4, '7B': 7, '8B': 8, '9B': 9, '13B': 13,
    '14B': 14, '20B': 20, '30B': 30, '32B': 32, '34B': 34,
    '70B': 70, '72B': 72, '405B': 405,
  };
  
  const baseGB = baseVRAMPerB[size] || 7; // Default to 7B
  const quantMultiplier = QUANTIZATION_PROFILES[quantization]?.memoryMultiplier || 0.5;
  
  // Model weights VRAM
  const weightsVRAM = baseGB * quantMultiplier;
  
  // KV cache VRAM (rough: 2 bytes per token per layer)
  // Assuming ~32 layers for 7B, scales with size
  const layers = Math.round(baseGB * 4);
  const kvCacheGB = (contextLength * layers * 2 * 2) / (1024 * 1024 * 1024);
  
  return {
    weightsGB: weightsVRAM.toFixed(1),
    kvCacheGB: kvCacheGB.toFixed(1),
    totalGB: (weightsVRAM + kvCacheGB).toFixed(1),
    recommendedVRAM: Math.ceil(weightsVRAM + kvCacheGB + 1), // +1GB headroom
  };
}

/**
 * Get a human-readable description of the optimal settings
 */
export function describeSettings(modelName) {
  const settings = getOptimalSettings(modelName);
  const parsed = settings._detected;
  const vram = estimateVRAMUsage(modelName, settings.num_ctx);
  
  const lines = [];
  
  if (parsed.family) {
    const familyProfile = MODEL_FAMILIES[parsed.family];
    if (familyProfile) {
      const typeNames = {
        code: 'Code Generation',
        chat: 'General Chat',
        creative: 'Creative/Roleplay',
        instruct: 'Instruction Following',
      };
      lines.push(`Model type: ${typeNames[familyProfile.type] || familyProfile.type}`);
    }
  }
  
  if (parsed.size) {
    lines.push(`Parameter size: ${parsed.size}`);
  }
  
  if (parsed.quantization) {
    const quant = QUANTIZATION_PROFILES[parsed.quantization];
    const qualityPct = quant ? `${Math.round(quant.qualityMultiplier * 100)}%` : 'Unknown';
    lines.push(`Quantization: ${parsed.quantization} (${qualityPct} quality)`);
  }
  
  lines.push(`Optimal temperature: ${settings.temperature}`);
  lines.push(`Context length: ${settings.num_ctx.toLocaleString()} tokens`);
  lines.push(`Estimated VRAM: ${vram.totalGB} GB`);
  
  return {
    summary: lines.join('\n'),
    settings,
    vram,
    parsed,
  };
}

/**
 * Build optimized Ollama options for a model
 */
export function buildOptimizedOllamaOptions(modelName, workspaceType = 'casual', overrides = {}) {
  const settings = getOptimalSettings(modelName, workspaceType);
  
  return {
    temperature: overrides.temperature ?? settings.temperature,
    top_p: overrides.top_p ?? settings.top_p,
    top_k: overrides.top_k ?? settings.top_k,
    repeat_penalty: overrides.repeat_penalty ?? settings.repeat_penalty,
    num_ctx: overrides.num_ctx ?? settings.num_ctx,
    num_batch: overrides.num_batch ?? settings.num_batch,
    num_gpu: overrides.num_gpu ?? settings.num_gpu,
    num_predict: overrides.num_predict ?? settings.num_predict,
    // Pass metadata for debugging
    _detected: settings._detected,
    _source: settings._source,
    _modelType: settings._modelType,
  };
}

/**
 * Build optimized Ollama options using REAL model metadata from /api/show.
 * 
 * When modelInfo is provided (from Ollama's /api/show endpoint), we use the
 * actual family, parameter_size, and quantization_level rather than guessing
 * from the filename. This means even custom-named models like
 * "my-custom-finetune.gguf" will be correctly identified.
 * 
 * Falls back to name-parsing if modelInfo is not available.
 * 
 * @param {string} modelName - The model name (used as fallback for parsing)
 * @param {string} workspaceType - 'casual' | 'code' | 'creative'
 * @param {object|null} modelInfo - Real metadata from /api/show (or null)
 * @param {object} overrides - User overrides (explicit settings always win)
 * @returns {object} Ollama options
 */
export function buildOptimizedOllamaOptionsWithInfo(modelName, workspaceType = 'casual', modelInfo = null, overrides = {}) {
  // If we have real metadata, build a synthetic "parsed" result from it
  // instead of guessing from the filename
  let parsed;
  
  if (modelInfo && modelInfo.success !== false) {
    // Map real family string from Ollama to our MODEL_FAMILIES keys
    const realFamily = resolveFamily(modelInfo.family, modelName);
    const realSize = normalizeParameterSize(modelInfo.parameterSize);
    const realQuant = normalizeQuantization(modelInfo.quantizationLevel);
    
    parsed = {
      family: realFamily,
      size: realSize,
      quantization: realQuant,
    };
  } else {
    // Fallback: parse from filename (original behavior)
    parsed = parseModelName(modelName);
  }
  
  const { family, size, quantization } = parsed;
  
  // Start with solid defaults
  let settings = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 4096,
    num_batch: 256,
    num_gpu: -1,
    num_predict: 4096,
    _detected: parsed,
    _source: modelInfo ? 'api/show' : 'default',
  };
  
  // Apply family-specific settings
  const familyProfile = family && MODEL_FAMILIES[family];
  if (familyProfile) {
    settings = {
      ...settings,
      temperature: familyProfile.temperature,
      top_p: familyProfile.top_p,
      top_k: familyProfile.top_k,
      repeat_penalty: familyProfile.repeat_penalty,
      num_ctx: familyProfile.maxContext,
      _source: `${settings._source}+family:${family}`,
      _modelType: familyProfile.type,
    };
  }
  
  // If /api/show gave us the real context length, trust it over family default
  if (modelInfo?.contextLength && modelInfo.contextLength > 0) {
    settings.num_ctx = modelInfo.contextLength;
    settings._source += `+ctx:real(${modelInfo.contextLength})`;
  }
  
  // Apply size-specific settings
  const sizeProfile = size && SIZE_PROFILES[size];
  if (sizeProfile) {
    const familyMaxCtx = familyProfile?.maxContext || settings.num_ctx;
    settings = {
      ...settings,
      num_ctx: Math.min(familyMaxCtx, Math.max(settings.num_ctx, sizeProfile.contextDefault)),
      num_batch: sizeProfile.batchSize,
      num_gpu: sizeProfile.gpuLayers,
      _source: `${settings._source}+size:${size}`,
    };
    
    // But if we had real context length from /api/show, re-apply it (it's authoritative)
    if (modelInfo?.contextLength && modelInfo.contextLength > 0) {
      settings.num_ctx = modelInfo.contextLength;
    }
  }
  
  // Apply quantization adjustments
  const quantProfile = quantization && QUANTIZATION_PROFILES[quantization];
  if (quantProfile) {
    const familyMax = modelInfo?.contextLength || familyProfile?.maxContext || 8192;
    const contextBoost = Math.floor(settings.num_ctx * quantProfile.contextScale);
    settings.num_ctx = Math.min(contextBoost, familyMax);
    
    if (quantization.startsWith('MXFP') || quantization.startsWith('FP')) {
      settings.num_batch = Math.max(settings.num_batch, 128);
    }
    
    settings._source += `+quant:${quantization}`;
  }
  
  // Workspace-specific adjustments
  if (workspaceType === 'code') {
    settings.temperature = Math.max(0.1, settings.temperature - 0.3);
    settings.top_p = Math.min(0.95, settings.top_p);
    settings._source += '+workspace:code';
  } else if (workspaceType === 'creative') {
    settings.temperature = Math.min(1.0, settings.temperature + 0.15);
    settings.top_k = Math.min(100, settings.top_k + 20);
    settings.repeat_penalty = Math.max(1.0, settings.repeat_penalty - 0.05);
    settings._source += '+workspace:creative';
  }
  
  // Detect thinking model (for UI and leak-detection bypass)
  const template = modelInfo?.template || null;
  const thinkingModel = isThinkingModel(family, modelName, template);
  
  // Apply user overrides last (explicit settings always win)
  return {
    temperature: overrides.temperature ?? settings.temperature,
    top_p: overrides.top_p ?? settings.top_p,
    top_k: overrides.top_k ?? settings.top_k,
    repeat_penalty: overrides.repeat_penalty ?? settings.repeat_penalty,
    num_ctx: overrides.num_ctx ?? settings.num_ctx,
    num_batch: overrides.num_batch ?? settings.num_batch,
    num_gpu: overrides.num_gpu ?? settings.num_gpu,
    num_predict: overrides.num_predict ?? settings.num_predict,
    _detected: settings._detected,
    _source: settings._source,
    _modelType: settings._modelType,
    _isThinkingModel: thinkingModel,
  };
}

/**
 * Map Ollama's family string to our MODEL_FAMILIES key.
 * Ollama returns families like "llama", "qwen2", etc.
 * We need to match to our specific keys.
 */
function resolveFamily(ollamaFamily, modelName) {
  if (!ollamaFamily) {
    // Fallback to name parsing
    return parseModelName(modelName).family;
  }
  
  const f = ollamaFamily.toLowerCase().trim();
  
  // Direct match
  if (MODEL_FAMILIES[f]) return f;
  
  // Common Ollama family → our key mappings
  const familyMap = {
    'llama': 'llama',
    'qwen2': 'qwen2',
    'qwen': 'qwen',
    'gemma': 'gemma',
    'gemma2': 'gemma2',
    'gemma3': 'gemma3',
    'phi3': 'phi3',
    'phi': 'phi',
    'mistral': 'mistral',
    'mixtral': 'mixtral',
    'command-r': 'command-r',
    'starcoder': 'starcoder',
    'starcoder2': 'starcoder2',
    'deepseek': 'deepseek',
    'deepseek2': 'deepseek-v2',
    'yi': 'yi',
    'internlm2': 'internlm2',
    'internlm': 'internlm',
    'chatglm': 'chatglm',
    'glm': 'glm',
    'granite': 'granite',
    'olmo': 'olmo',
    'olmo2': 'olmo2',
    'smollm': 'smollm',
    'smollm2': 'smollm2',
    'exaone': 'exaone',
    'pixtral': 'pixtral',
    'gpt-oss': 'gpt-oss',
    'gpt_oss': 'gpt-oss',
  };
  
  if (familyMap[f]) return familyMap[f];
  
  // Partial match — check if the Ollama family contains a known key
  for (const [key, value] of Object.entries(familyMap)) {
    if (f.includes(key)) return value;
  }
  
  // Try name parsing as ultimate fallback
  return parseModelName(modelName).family;
}

/**
 * Normalize Ollama's parameter_size string (e.g. "7.6B", "3B") to our SIZE_PROFILES keys.
 */
function normalizeParameterSize(parameterSize) {
  if (!parameterSize) return null;
  
  const sizeStr = parameterSize.toString().toUpperCase();
  const match = sizeStr.match(/([\d.]+)/);
  if (!match) return null;
  
  const num = parseFloat(match[1]);
  
  if (num <= 0.6) return '0.5B';
  if (num <= 1.2) return '1B';
  if (num <= 1.8) return '1.5B';
  if (num <= 2.5) return '2B';
  if (num <= 4.5) return '3B';
  if (num <= 5.5) return '4B';
  if (num <= 7.5) return '7B';
  if (num <= 8.5) return '8B';
  if (num <= 10) return '9B';
  if (num <= 13.5) return '13B';
  if (num <= 16) return '14B';
  if (num <= 25) return '20B';
  if (num <= 31) return '30B';
  if (num <= 35) return '34B';
  if (num <= 73) return '70B';
  return '405B';
}

/**
 * Normalize Ollama's quantization_level string to our QUANTIZATION_PROFILES keys.
 */
function normalizeQuantization(quantLevel) {
  if (!quantLevel) return null;
  
  const q = quantLevel.toUpperCase().trim();
  
  // Direct match
  if (QUANTIZATION_PROFILES[q]) return q;
  
  // Common patterns: Ollama returns things like "Q4_K_M", "Q4_0", "F16", etc.
  // Try partial matching
  for (const key of Object.keys(QUANTIZATION_PROFILES)) {
    if (q.includes(key)) return key;
  }
  
  return null;
}

/**
 * Determine if a model is a "thinking" / reasoning model.
 * 
 * Thinking models (DeepSeek-R1, QwQ, Gemma3 with thinking, etc.) emit
 * their chain-of-thought inside <think>...</think> tags. These should NOT
 * be caught by prompt-leak detection, and their output should be rendered
 * with the ThinkingBlock UI.
 * 
 * Detection is multi-layered:
 *  1. Known reasoning families (deepseek-r1, qwq)
 *  2. Model name heuristics (contains "thinking", "reason", "r1", "cot")
 *  3. Ollama template inspection (contains "<think>" tag)
 */
export function isThinkingModel(family, modelName, template) {
  // Layer 1: Known reasoning families
  const thinkingFamilies = ['deepseek-r1', 'qwq'];
  if (family && thinkingFamilies.includes(family.toLowerCase())) {
    return true;
  }
  
  // Layer 2: Name heuristics
  if (modelName) {
    const name = modelName.toLowerCase();
    if (
      name.includes('deepseek-r1') || name.includes('deepseek_r1') ||
      name.includes('qwq') ||
      name.includes('-thinking') || name.includes('_thinking') ||
      name.includes('-reason') || name.includes('_reason') ||
      name.includes('-cot') || name.includes('_cot') ||
      name.includes(':thinking')
    ) {
      return true;
    }
  }
  
  // Layer 3: Ollama template inspection
  // If the model's chat template includes <think>, it's a thinking model
  if (template && typeof template === 'string') {
    if (template.includes('<think>') || template.includes('{{- if .Think }}')) {
      return true;
    }
  }
  
  return false;
}

export default {
  parseModelName,
  getOptimalSettings,
  estimateVRAMUsage,
  describeSettings,
  buildOptimizedOllamaOptions,
  buildOptimizedOllamaOptionsWithInfo,
  isThinkingModel,
  MODEL_FAMILIES,
  QUANTIZATION_PROFILES,
  SIZE_PROFILES,
};
