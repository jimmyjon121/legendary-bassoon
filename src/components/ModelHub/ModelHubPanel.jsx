/**
 * ModelHubPanel - Complete model discovery, download, and management center
 * 
 * Tabs:
 * 1. Discover - Browse Ollama & HuggingFace models with hardware-aware recommendations
 * 2. Downloads - Real-time download progress with pause/resume/retry
 * 3. Library - Manage installed models with disk usage
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, Search, Download, HardDrive, Globe, Cpu, MemoryStick, Wifi, WifiOff,
  Play, Pause, RotateCcw, Trash2, ChevronDown, ChevronUp, ChevronRight,
  Star, Heart, Check, AlertTriangle, Loader, RefreshCw, FolderOpen, Zap,
  Filter, ArrowDownAZ, ArrowUpDown, Eye, Package, Database, Layers,
  Monitor, Clock, ExternalLink, Copy, XCircle, CheckCircle, Info,
  BarChart3, Code, MessageSquare, Image, Bot, Sparkles, Shield,
  ThumbsUp, ThumbsDown, BookOpen, Lightbulb, Brain, Gauge, ArrowLeft,
  FileCode, PenTool, Languages, Target, CircleDot,
  Flame, Settings,
  ArrowUp, ArrowDown, HardDriveDownload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { safeCall, isElectron } from '../../utils/electronAPI';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const OLLAMA_CATEGORIES = [
  { id: 'all', label: 'All', icon: Globe },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'vision', label: 'Vision', icon: Eye },
  { id: 'embedding', label: 'Embedding', icon: Database },
  { id: 'small', label: 'Small (<4GB)', icon: Zap },
];

const SORT_OPTIONS = [
  { id: 'popular', label: 'Popular' },
  { id: 'newest', label: 'Newest' },
  { id: 'size_asc', label: 'Size (smallest)' },
  { id: 'name', label: 'A-Z' },
];

const LIBRARY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'gguf', label: 'GGUF' },
  { id: 'onnx', label: 'ONNX' },
  { id: 'openvino', label: 'OpenVINO' },
];

const FORMAT_COLORS = {
  ollama: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  gguf: 'bg-green-500/20 text-green-400 border-green-500/30',
  onnx: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  openvino: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  safetensors: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const FAMILY_COLORS = {
  llama: 'bg-blue-500/20 text-blue-300',
  mistral: 'bg-orange-500/20 text-orange-300',
  mixtral: 'bg-orange-500/20 text-orange-300',
  qwen: 'bg-purple-500/20 text-purple-300',
  deepseek: 'bg-cyan-500/20 text-cyan-300',
  gemma: 'bg-emerald-500/20 text-emerald-300',
  phi: 'bg-amber-500/20 text-amber-300',
  codellama: 'bg-indigo-500/20 text-indigo-300',
  starcoder: 'bg-indigo-500/20 text-indigo-300',
  vicuna: 'bg-red-500/20 text-red-300',
  llava: 'bg-pink-500/20 text-pink-300',
  moondream: 'bg-violet-500/20 text-violet-300',
  openchat: 'bg-teal-500/20 text-teal-300',
  dolphin: 'bg-sky-500/20 text-sky-300',
  neural: 'bg-rose-500/20 text-rose-300',
  zephyr: 'bg-lime-500/20 text-lime-300',
};

// ─────────────────────────────────────────────────────────────────────────────
// ENRICHED MODEL PROFILES - Curated detailed profiles for popular models
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_PROFILES = {
  'llama3.2': {
    longDescription: "Llama 3.2 represents Meta's push toward efficient, deployable AI. The 1B and 3B variants are specifically designed for on-device inference, making them perfect for local AI applications. Despite their small size, they maintain impressive instruction-following and reasoning capabilities.",
    strengths: ['Extremely fast inference', 'Low memory requirements', 'Great instruction following', 'Efficient for edge deployment', 'Multilingual support'],
    considerations: ['Smaller context window than larger models', 'May struggle with very complex reasoning', 'Knowledge limited to training cutoff'],
    benchmarks: [
      { name: 'MMLU (Knowledge)', score: 63.4, description: 'General knowledge across subjects' },
      { name: 'HumanEval (Code)', score: 48.2, description: 'Code generation accuracy' },
      { name: 'GSM8K (Math)', score: 57.5, description: 'Grade school math problems' },
      { name: 'HellaSwag', score: 78.9, description: 'Common sense reasoning' },
    ],
    useCases: [
      { icon: 'chat', title: 'Quick Assistant', description: 'Fast responses for everyday questions and tasks' },
      { icon: 'code', title: 'Code Snippets', description: 'Generate and explain small code segments' },
      { icon: 'creative', title: 'Writing Help', description: 'Draft emails, messages, and short content' },
    ],
    contextLength: 131072,
    architecture: 'Llama 3.2 Transformer',
    dataCutoff: 'December 2023',
    license: 'Llama 3.2 Community License',
  },
  'llama3.1': {
    longDescription: "Llama 3.1 is Meta's most capable open model family. The 8B variant offers excellent performance for most tasks, while the 70B and 405B models compete with closed-source alternatives. Features extended context length and improved reasoning.",
    strengths: ['State-of-the-art reasoning', 'Extended 128K context window', 'Excellent code generation', 'Strong multilingual support', 'Tool use capabilities'],
    considerations: ['Larger variants need significant VRAM', '405B requires enterprise hardware', 'Longer generation times for complex tasks'],
    benchmarks: [
      { name: 'MMLU (Knowledge)', score: 73.8, description: 'General knowledge (8B variant)' },
      { name: 'HumanEval (Code)', score: 72.6, description: 'Code generation accuracy' },
      { name: 'GSM8K (Math)', score: 84.5, description: 'Mathematical reasoning' },
      { name: 'MATH', score: 51.9, description: 'Advanced mathematics' },
    ],
    useCases: [
      { icon: 'reasoning', title: 'Complex Analysis', description: 'Research, analysis, and detailed explanations' },
      { icon: 'code', title: 'Software Development', description: 'Full-featured code assistance and generation' },
      { icon: 'creative', title: 'Long-form Content', description: 'Articles, stories, and detailed documents' },
      { icon: 'chat', title: 'Expert Assistant', description: 'In-depth conversations on any topic' },
    ],
    contextLength: 131072,
    architecture: 'Llama 3.1 Transformer',
    dataCutoff: 'December 2023',
    license: 'Llama 3.1 Community License',
  },
  'qwen2.5': {
    longDescription: "Qwen 2.5 offers a complete range from tiny 0.5B to massive 72B. Known for strong multilingual capabilities (especially Chinese), good reasoning, and competitive performance with Western models.",
    strengths: ['Excellent multilingual support', 'Strong Chinese language performance', 'Wide range of model sizes', 'Good code understanding', 'Competitive benchmarks'],
    considerations: ['May have cultural biases toward Chinese content', 'Some English idioms may be less natural'],
    benchmarks: [
      { name: 'MMLU (Knowledge)', score: 74.2, description: 'General knowledge (7B variant)' },
      { name: 'HumanEval (Code)', score: 61.6, description: 'Code generation' },
      { name: 'C-Eval', score: 81.8, description: 'Chinese knowledge benchmark' },
      { name: 'GSM8K (Math)', score: 79.6, description: 'Mathematical reasoning' },
    ],
    useCases: [
      { icon: 'multilingual', title: 'Multilingual Tasks', description: 'Translation and cross-lingual understanding' },
      { icon: 'chat', title: 'General Assistant', description: 'Everyday questions and conversations' },
      { icon: 'code', title: 'Code Help', description: 'Programming assistance in multiple languages' },
    ],
    contextLength: 32768,
    architecture: 'Qwen2 Transformer',
    dataCutoff: 'September 2024',
    license: 'Apache 2.0 / Qwen License',
  },
  'qwen2.5-coder': {
    longDescription: "Qwen 2.5 Coder is Alibaba's dedicated coding model, fine-tuned from the Qwen 2.5 base. It excels at code generation, completion, refactoring, and explanation across dozens of programming languages.",
    strengths: ['Strong code generation', 'Multiple programming languages', 'Code explanation and review', 'Debugging assistance', 'Competitive with larger models'],
    considerations: ['Less capable for general chat', 'Training data may favor certain languages'],
    benchmarks: [
      { name: 'HumanEval', score: 65.9, description: 'Python code generation' },
      { name: 'MBPP', score: 72.3, description: 'Basic programming tasks' },
      { name: 'MultiPL-E', score: 60.1, description: 'Multi-language coding' },
    ],
    useCases: [
      { icon: 'code', title: 'Code Generation', description: 'Write functions and complete programs' },
      { icon: 'reasoning', title: 'Code Review', description: 'Find bugs and suggest improvements' },
      { icon: 'chat', title: 'Dev Q&A', description: 'Answer programming questions' },
    ],
    contextLength: 32768,
    architecture: 'Qwen2 Transformer (Code fine-tuned)',
    dataCutoff: 'September 2024',
    license: 'Apache 2.0',
  },
  'mistral': {
    longDescription: "Mistral 7B was a breakthrough model that showed 7B parameters could compete with much larger models. Known for fast inference, low resource requirements, and solid all-around performance.",
    strengths: ['Excellent speed/quality ratio', 'Low VRAM requirements', 'Strong reasoning for size', 'Good instruction following'],
    considerations: ['Limited context window (8K)', 'Smaller than newer models', 'Less capable on complex tasks'],
    benchmarks: [
      { name: 'MMLU', score: 62.5, description: 'General knowledge' },
      { name: 'HellaSwag', score: 81.3, description: 'Common sense' },
      { name: 'TruthfulQA', score: 42.2, description: 'Factual accuracy' },
    ],
    contextLength: 8192,
    architecture: 'Mistral Transformer + Sliding Window',
    dataCutoff: '2023',
    license: 'Apache 2.0',
  },
  'mixtral': {
    longDescription: "Mixtral uses a Mixture of Experts (MoE) architecture to deliver high quality while only activating a fraction of parameters per token. This gives near-GPT-3.5 performance at much lower computational cost.",
    strengths: ['MoE architecture for efficiency', 'High quality outputs', 'Good multilingual', 'Strong reasoning', 'Handles complex tasks well'],
    considerations: ['Large download size', 'High VRAM for full model', 'MoE routing can be unpredictable'],
    benchmarks: [
      { name: 'MMLU', score: 70.6, description: 'General knowledge (8x7B)' },
      { name: 'HellaSwag', score: 84.4, description: 'Common sense' },
      { name: 'HumanEval', score: 40.2, description: 'Code generation' },
      { name: 'GSM8K', score: 74.4, description: 'Math reasoning' },
    ],
    contextLength: 32768,
    architecture: 'Mixture of Experts (MoE)',
    dataCutoff: '2023',
    license: 'Apache 2.0',
  },
  'deepseek-coder-v2': {
    longDescription: "DeepSeek Coder V2 uses a Mixture of Experts architecture to deliver exceptional coding performance while remaining efficient. It excels at code generation, completion, and understanding across many programming languages.",
    strengths: ['Excellent code generation', 'MoE for efficient inference', 'Strong across many languages', 'Good at code explanation', 'Competitive with GPT-4 on coding'],
    considerations: ['Specialized for code (less general)', 'May need more context for complex projects'],
    benchmarks: [
      { name: 'HumanEval', score: 90.2, description: 'Python code generation' },
      { name: 'MBPP', score: 80.4, description: 'Basic programming tasks' },
      { name: 'MultiPL-E', score: 75.8, description: 'Multi-language coding' },
    ],
    useCases: [
      { icon: 'code', title: 'Code Generation', description: 'Write functions, classes, and complete programs' },
      { icon: 'reasoning', title: 'Code Review', description: 'Analyze code for bugs and improvements' },
      { icon: 'chat', title: 'Programming Q&A', description: 'Answer questions about code and concepts' },
    ],
    contextLength: 128000,
    architecture: 'DeepSeek MoE Transformer',
    dataCutoff: '2024',
    license: 'DeepSeek License',
  },
  'codellama': {
    longDescription: "Code Llama is Meta's dedicated programming model, fine-tuned from Llama 2. It supports infilling, large context windows, and zero-shot instruction following for programming tasks.",
    strengths: ['Purpose-built for coding', 'Infill capability (fill-in-the-middle)', 'Large context for code (100K)', 'Multiple size options', 'Strong Python performance'],
    considerations: ['Older generation (Llama 2 base)', 'Newer code models may outperform', 'Less capable at general chat'],
    benchmarks: [
      { name: 'HumanEval', score: 53.7, description: 'Python code generation (34B)' },
      { name: 'MBPP', score: 56.2, description: 'Basic programming' },
    ],
    useCases: [
      { icon: 'code', title: 'Code Completion', description: 'Complete code as you type' },
      { icon: 'creative', title: 'Code Infill', description: 'Fill in missing code segments' },
    ],
    contextLength: 100000,
    architecture: 'Llama 2 (Code fine-tuned)',
    dataCutoff: '2023',
    license: 'Llama 2 Community License',
  },
  'gemma2': {
    longDescription: "Gemma 2 is Google's open-weight model designed to be both capable and efficient. It brings some of the technology from Google's larger models into an accessible package for developers and researchers.",
    strengths: ['Google research backing', 'Good efficiency', 'Strong for its size', 'Well-documented'],
    considerations: ['Relatively new model', 'Smaller community than Llama'],
    benchmarks: [
      { name: 'MMLU', score: 71.3, description: 'General knowledge (9B)' },
      { name: 'HellaSwag', score: 81.2, description: 'Common sense' },
      { name: 'HumanEval', score: 54.5, description: 'Code generation' },
    ],
    contextLength: 8192,
    architecture: 'Gemma Transformer',
    dataCutoff: '2024',
    license: 'Gemma License',
  },
  'phi3': {
    longDescription: "Phi-3 demonstrates that small models trained on high-quality data can achieve impressive results. It's particularly good for reasoning and structured tasks despite its compact size.",
    strengths: ['Excellent for its size', 'Strong reasoning', 'Very efficient', 'Good at structured output'],
    considerations: ['Limited world knowledge', 'Smaller context window', 'May struggle with nuance'],
    benchmarks: [
      { name: 'MMLU', score: 69.0, description: 'General knowledge (3.8B)' },
      { name: 'GSM8K', score: 82.5, description: 'Math reasoning' },
      { name: 'HumanEval', score: 58.5, description: 'Code generation' },
    ],
    contextLength: 4096,
    architecture: 'Phi Transformer',
    dataCutoff: '2024',
    license: 'MIT',
  },
  'starcoder2': {
    longDescription: "StarCoder 2 is trained on The Stack v2, one of the largest open code datasets. It supports over 600 programming languages and excels at code completion, generation, and understanding.",
    strengths: ['600+ programming languages', 'Trained on The Stack v2', 'Strong completion', 'Open source friendly'],
    considerations: ['Focused on code only', 'Less capable at general chat', 'May lag behind newer models'],
    benchmarks: [
      { name: 'HumanEval', score: 46.3, description: 'Python code generation (15B)' },
      { name: 'MBPP', score: 53.1, description: 'Basic programming' },
    ],
    contextLength: 16384,
    architecture: 'StarCoder Transformer',
    dataCutoff: '2024',
    license: 'BigCode Open RAIL-M',
  },
  'dolphin-mixtral': {
    longDescription: "Dolphin Mixtral is an uncensored fine-tune of the Mixtral MoE model by Cognitive Computations. It removes typical alignment restrictions, making it useful for research and creative applications.",
    strengths: ['Uncensored responses', 'MoE efficiency', 'Strong at creative tasks', 'Good for roleplay/fiction'],
    considerations: ['May produce unsafe content', 'Large model size', 'Use responsibly'],
    benchmarks: [
      { name: 'MMLU', score: 68.2, description: 'General knowledge' },
    ],
    contextLength: 32768,
    architecture: 'Mixture of Experts (uncensored)',
    license: 'Apache 2.0',
  },
  'llava': {
    longDescription: "LLaVA (Large Language and Vision Assistant) can understand both text and images. Upload an image and ask questions about it - describe scenes, read text, analyze charts, and more.",
    strengths: ['Understands images + text', 'Scene description', 'Chart/diagram reading', 'Visual question answering', 'OCR capability'],
    considerations: ['Larger than text-only models', 'Image processing adds latency', 'May hallucinate visual details'],
    benchmarks: [
      { name: 'VQAv2', score: 80.0, description: 'Visual question answering' },
      { name: 'GQA', score: 63.3, description: 'Compositional reasoning' },
    ],
    useCases: [
      { icon: 'vision', title: 'Image Description', description: 'Describe what you see in photos' },
      { icon: 'reasoning', title: 'Visual Analysis', description: 'Analyze charts, diagrams, screenshots' },
      { icon: 'creative', title: 'Creative Vision', description: 'Get creative ideas from images' },
    ],
    contextLength: 4096,
    architecture: 'LLaVA Vision-Language Model',
    license: 'Apache 2.0',
  },
  'wizard-vicuna-uncensored': {
    longDescription: "Wizard Vicuna Uncensored combines the instruction-following of WizardLM with uncensored training. It provides unrestricted responses, making it suitable for research, creative writing, and roleplay.",
    strengths: ['Uncensored responses', 'Good instruction following', 'Creative writing', 'Roleplay capable'],
    considerations: ['May produce unsafe content', 'Older model architecture', 'Use responsibly'],
    contextLength: 4096,
    architecture: 'Vicuna (Llama fine-tune)',
    license: 'Non-commercial',
  },
  'moondream': {
    longDescription: "Moondream is a tiny but surprisingly capable vision model at only 1.6B parameters. It can understand images, answer visual questions, and describe scenes while being incredibly lightweight.",
    strengths: ['Extremely small (1.6B)', 'Runs on almost any hardware', 'Fast inference', 'Decent visual understanding'],
    considerations: ['Limited compared to larger vision models', 'Simple reasoning only', 'May miss details'],
    useCases: [
      { icon: 'vision', title: 'Quick Image Q&A', description: 'Fast answers about images' },
      { icon: 'code', title: 'Screenshot Reading', description: 'Read text from screenshots' },
    ],
    contextLength: 2048,
    architecture: 'Moondream Vision',
    license: 'Apache 2.0',
  },
};

// Icon mapping for use cases
const USE_CASE_ICONS = {
  chat: MessageSquare,
  code: Code,
  creative: PenTool,
  reasoning: Brain,
  multilingual: Languages,
  vision: Eye,
};

// ─────────────────────────────────────────────────────────────────────────────
// HUGGINGFACE CURATED DATA - Shows instantly while API loads in background
// ─────────────────────────────────────────────────────────────────────────────

const HF_FEATURED_MODELS = [
  {
    id: 'recommended',
    name: 'Recommended',
    description: 'Hand-picked models optimized for local inference',
    models: [
      { id: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF', modelId: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF', displayName: 'Mistral 7B Instruct v0.2', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 2800000, description: 'Fast, efficient 7B model with great instruction following. The go-to for general chat.', tags: ['gguf', 'chat', 'fast'] },
      { id: 'TheBloke/Llama-2-13B-chat-GGUF', modelId: 'TheBloke/Llama-2-13B-chat-GGUF', displayName: 'Llama 2 13B Chat', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'chat', downloads: 3100000, description: 'Meta\'s conversational model. Great balance of quality and speed for dialogue.', tags: ['gguf', 'chat'] },
      { id: 'TheBloke/CodeLlama-13B-Instruct-GGUF', modelId: 'TheBloke/CodeLlama-13B-Instruct-GGUF', displayName: 'Code Llama 13B Instruct', author: 'TheBloke', family: 'CodeLlama', params: '13B', capability: 'code', downloads: 1500000, description: 'Purpose-built for code generation. Excels at Python, JavaScript, and 20+ languages.', tags: ['gguf', 'code'] },
      { id: 'TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF', modelId: 'TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF', displayName: 'Mixtral 8x7B Instruct', author: 'TheBloke', family: 'Mixtral', params: '46.7B MoE', capability: 'chat', downloads: 1200000, description: 'Mixture of Experts - near GPT-3.5 quality. Best open model for complex reasoning.', tags: ['gguf', 'chat', 'moe'] },
      { id: 'TheBloke/OpenHermes-2.5-Mistral-7B-GGUF', modelId: 'TheBloke/OpenHermes-2.5-Mistral-7B-GGUF', displayName: 'OpenHermes 2.5 Mistral 7B', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 950000, description: 'One of the highest-rated 7B chat models. Exceptional instruction following.', tags: ['gguf', 'chat', 'quality'] },
      { id: 'TheBloke/neural-chat-7B-v3-1-GGUF', modelId: 'TheBloke/neural-chat-7B-v3-1-GGUF', displayName: 'Neural Chat 7B v3.1', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 720000, description: 'Intel-optimized for natural conversations. Warm, helpful personality.', tags: ['gguf', 'chat'] },
      { id: 'TheBloke/dolphin-2.6-mistral-7B-GGUF', modelId: 'TheBloke/dolphin-2.6-mistral-7B-GGUF', displayName: 'Dolphin 2.6 Mistral 7B', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 680000, description: 'Uncensored Mistral fine-tune. Great for creative writing and unrestricted chat.', tags: ['gguf', 'chat', 'uncensored'] },
      { id: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF', modelId: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF', displayName: 'TinyLlama 1.1B Chat', author: 'TheBloke', family: 'Llama', params: '1.1B', capability: 'chat', downloads: 1100000, description: 'Ultra-lightweight. Runs on almost anything. Great for testing and basic tasks.', tags: ['gguf', 'chat', 'tiny', 'fast'] },
      { id: 'bartowski/gemma-2-9b-it-GGUF', modelId: 'bartowski/gemma-2-9b-it-GGUF', displayName: 'Gemma 2 9B Instruct', author: 'bartowski', family: 'Gemma', params: '9B', capability: 'chat', downloads: 450000, description: 'Google\'s latest open model. Excellent quality/size ratio with modern architecture.', tags: ['gguf', 'chat', 'google'] },
      { id: 'bartowski/Qwen2.5-7B-Instruct-GGUF', modelId: 'bartowski/Qwen2.5-7B-Instruct-GGUF', displayName: 'Qwen 2.5 7B Instruct', author: 'bartowski', family: 'Qwen', params: '7B', capability: 'chat', downloads: 380000, description: 'Alibaba\'s latest. Strong multilingual + code. Competitive with Mistral.', tags: ['gguf', 'chat', 'multilingual'] },
    ],
  },
  {
    id: 'code',
    name: 'Code',
    description: 'Models specialized for programming tasks',
    models: [
      { id: 'TheBloke/CodeLlama-34B-Instruct-GGUF', modelId: 'TheBloke/CodeLlama-34B-Instruct-GGUF', displayName: 'Code Llama 34B Instruct', author: 'TheBloke', family: 'CodeLlama', params: '34B', capability: 'code', downloads: 920000, description: 'The most capable Code Llama. Needs 24GB+ VRAM but delivers near-GPT-4 coding.', tags: ['gguf', 'code'] },
      { id: 'TheBloke/CodeLlama-13B-Instruct-GGUF', modelId: 'TheBloke/CodeLlama-13B-Instruct-GGUF', displayName: 'Code Llama 13B Instruct', author: 'TheBloke', family: 'CodeLlama', params: '13B', capability: 'code', downloads: 1500000, description: 'Great balance for code. Handles most programming tasks well at moderate VRAM.', tags: ['gguf', 'code'] },
      { id: 'TheBloke/CodeLlama-7B-Instruct-GGUF', modelId: 'TheBloke/CodeLlama-7B-Instruct-GGUF', displayName: 'Code Llama 7B Instruct', author: 'TheBloke', family: 'CodeLlama', params: '7B', capability: 'code', downloads: 1200000, description: 'Lightweight code model. Fast completions and explanations.', tags: ['gguf', 'code', 'fast'] },
      { id: 'TheBloke/WizardCoder-Python-34B-V1.0-GGUF', modelId: 'TheBloke/WizardCoder-Python-34B-V1.0-GGUF', displayName: 'WizardCoder Python 34B', author: 'TheBloke', family: 'CodeLlama', params: '34B', capability: 'code', downloads: 650000, description: 'Python specialist. Excels at complex Python generation and debugging.', tags: ['gguf', 'code', 'python'] },
      { id: 'TheBloke/Phind-CodeLlama-34B-v2-GGUF', modelId: 'TheBloke/Phind-CodeLlama-34B-v2-GGUF', displayName: 'Phind CodeLlama 34B v2', author: 'TheBloke', family: 'CodeLlama', params: '34B', capability: 'code', downloads: 580000, description: 'Trained on real programming tasks from Phind. Excellent problem-solving.', tags: ['gguf', 'code'] },
      { id: 'TheBloke/deepseek-coder-6.7B-instruct-GGUF', modelId: 'TheBloke/deepseek-coder-6.7B-instruct-GGUF', displayName: 'DeepSeek Coder 6.7B', author: 'TheBloke', family: 'DeepSeek', params: '6.7B', capability: 'code', downloads: 420000, description: 'Efficient code model from DeepSeek. Great for its size.', tags: ['gguf', 'code', 'efficient'] },
      { id: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', modelId: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', displayName: 'Qwen 2.5 Coder 7B', author: 'bartowski', family: 'Qwen', params: '7B', capability: 'code', downloads: 210000, description: 'Latest generation code model from Alibaba. Strong multi-language coding.', tags: ['gguf', 'code', 'new'] },
      { id: 'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF', modelId: 'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF', displayName: 'Qwen 2.5 Coder 32B', author: 'bartowski', family: 'Qwen', params: '32B', capability: 'code', downloads: 180000, description: 'Top-tier code model. Competes with GPT-4 on coding benchmarks.', tags: ['gguf', 'code', 'flagship'] },
    ],
  },
  {
    id: 'chat',
    name: 'Chat',
    description: 'Best models for natural dialogue',
    models: [
      { id: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF', modelId: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF', displayName: 'Mistral 7B Instruct v0.2', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 2800000, description: 'The benchmark for 7B chat. Fast, accurate, well-rounded.', tags: ['gguf', 'chat'] },
      { id: 'TheBloke/neural-chat-7B-v3-1-GGUF', modelId: 'TheBloke/neural-chat-7B-v3-1-GGUF', displayName: 'Neural Chat 7B v3.1', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 720000, description: 'Conversational specialist. Natural, flowing dialogue.', tags: ['gguf', 'chat'] },
      { id: 'TheBloke/OpenHermes-2.5-Mistral-7B-GGUF', modelId: 'TheBloke/OpenHermes-2.5-Mistral-7B-GGUF', displayName: 'OpenHermes 2.5 Mistral 7B', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 950000, description: 'Top-rated 7B chat model. Excellent instruction following.', tags: ['gguf', 'chat', 'quality'] },
      { id: 'TheBloke/zephyr-7B-beta-GGUF', modelId: 'TheBloke/zephyr-7B-beta-GGUF', displayName: 'Zephyr 7B Beta', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 890000, description: 'HuggingFace\'s own model. Helpful, aligned, and articulate.', tags: ['gguf', 'chat', 'aligned'] },
      { id: 'TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-GGUF', modelId: 'TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-GGUF', displayName: 'Nous Hermes 2 Mixtral 8x7B', author: 'TheBloke', family: 'Mixtral', params: '46.7B MoE', capability: 'chat', downloads: 520000, description: 'Premium MoE chat model. Human-preference optimized (DPO).', tags: ['gguf', 'chat', 'moe', 'premium'] },
      { id: 'bartowski/Llama-3.2-3B-Instruct-GGUF', modelId: 'bartowski/Llama-3.2-3B-Instruct-GGUF', displayName: 'Llama 3.2 3B Instruct', author: 'bartowski', family: 'Llama', params: '3B', capability: 'chat', downloads: 350000, description: 'Meta\'s latest small model. Surprisingly capable for its size.', tags: ['gguf', 'chat', 'small', 'new'] },
      { id: 'bartowski/gemma-2-9b-it-GGUF', modelId: 'bartowski/gemma-2-9b-it-GGUF', displayName: 'Gemma 2 9B Instruct', author: 'bartowski', family: 'Gemma', params: '9B', capability: 'chat', downloads: 450000, description: 'Google\'s latest. Strong reasoning and knowledge.', tags: ['gguf', 'chat', 'google'] },
    ],
  },
  {
    id: 'creative',
    name: 'Creative',
    description: 'Models tuned for storytelling and creative content',
    models: [
      { id: 'TheBloke/MythoMax-L2-13B-GGUF', modelId: 'TheBloke/MythoMax-L2-13B-GGUF', displayName: 'MythoMax L2 13B', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'creative', downloads: 1400000, description: 'The king of creative writing. Vivid, expressive, great for stories and roleplay.', tags: ['gguf', 'creative', 'storytelling'] },
      { id: 'TheBloke/Nous-Hermes-Llama2-13B-GGUF', modelId: 'TheBloke/Nous-Hermes-Llama2-13B-GGUF', displayName: 'Nous Hermes Llama2 13B', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'chat', downloads: 780000, description: 'Versatile model that excels at both creative and instructional tasks.', tags: ['gguf', 'creative', 'versatile'] },
      { id: 'TheBloke/airoboros-l2-13B-2.2.1-GGUF', modelId: 'TheBloke/airoboros-l2-13B-2.2.1-GGUF', displayName: 'Airoboros L2 13B', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'chat', downloads: 520000, description: 'Trained on diverse creative tasks. Great imagination and worldbuilding.', tags: ['gguf', 'creative'] },
      { id: 'TheBloke/Mythalion-13B-GGUF', modelId: 'TheBloke/Mythalion-13B-GGUF', displayName: 'Mythalion 13B', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'creative', downloads: 340000, description: 'Roleplay and fiction specialist. Rich narrative style.', tags: ['gguf', 'creative', 'roleplay'] },
      { id: 'TheBloke/Chronos-13B-v2-GGUF', modelId: 'TheBloke/Chronos-13B-v2-GGUF', displayName: 'Chronos 13B v2', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'creative', downloads: 290000, description: 'Long-form narrative model. Excellent at maintaining story coherence.', tags: ['gguf', 'creative', 'narrative'] },
    ],
  },
  {
    id: 'small',
    name: 'Lightweight',
    description: 'Fast models that run on modest hardware',
    models: [
      { id: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF', modelId: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF', displayName: 'TinyLlama 1.1B Chat', author: 'TheBloke', family: 'Llama', params: '1.1B', capability: 'chat', downloads: 1100000, description: 'Ultra tiny. Runs on 2GB RAM. Great for basic tasks and testing.', tags: ['gguf', 'chat', 'tiny'] },
      { id: 'TheBloke/phi-2-GGUF', modelId: 'TheBloke/phi-2-GGUF', displayName: 'Phi-2', author: 'TheBloke', family: 'Phi', params: '2.7B', capability: 'chat', downloads: 890000, description: 'Microsoft\'s small model. Punches way above its weight class.', tags: ['gguf', 'chat', 'efficient'] },
      { id: 'TheBloke/stablelm-zephyr-3b-GGUF', modelId: 'TheBloke/stablelm-zephyr-3b-GGUF', displayName: 'StableLM Zephyr 3B', author: 'TheBloke', family: 'StableLM', params: '3B', capability: 'chat', downloads: 450000, description: 'Stability AI\'s compact model. Good quality at low resource cost.', tags: ['gguf', 'chat', 'small'] },
      { id: 'bartowski/Llama-3.2-1B-Instruct-GGUF', modelId: 'bartowski/Llama-3.2-1B-Instruct-GGUF', displayName: 'Llama 3.2 1B Instruct', author: 'bartowski', family: 'Llama', params: '1B', capability: 'chat', downloads: 280000, description: 'Meta\'s tiniest Llama 3.2. Instant responses, minimal resources.', tags: ['gguf', 'chat', 'tiny', 'new'] },
      { id: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF', modelId: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF', displayName: 'Qwen 2.5 1.5B Instruct', author: 'bartowski', family: 'Qwen', params: '1.5B', capability: 'chat', downloads: 190000, description: 'Alibaba\'s smallest. Surprisingly good for basic conversations.', tags: ['gguf', 'chat', 'small', 'new'] },
      { id: 'TheBloke/Orca-2-7B-GGUF', modelId: 'TheBloke/Orca-2-7B-GGUF', displayName: 'Orca 2 7B', author: 'TheBloke', family: 'Mistral', params: '7B', capability: 'chat', downloads: 560000, description: 'Microsoft\'s reasoning-focused model. Great at step-by-step thinking.', tags: ['gguf', 'chat', 'reasoning'] },
    ],
  },
  {
    id: 'uncensored',
    name: 'Uncensored',
    description: 'Models with fewer content restrictions',
    models: [
      { id: 'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF', modelId: 'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF', displayName: 'Wizard Vicuna 13B Uncensored', author: 'TheBloke', family: 'Vicuna', params: '13B', capability: 'chat', downloads: 1800000, description: 'The classic uncensored model. Good instruction following without restrictions.', tags: ['gguf', 'chat', 'uncensored'] },
      { id: 'TheBloke/WizardLM-13B-V1.2-GGUF', modelId: 'TheBloke/WizardLM-13B-V1.2-GGUF', displayName: 'WizardLM 13B v1.2', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'chat', downloads: 980000, description: 'Evolved instruction model. Fewer restrictions, great task solving.', tags: ['gguf', 'chat'] },
      { id: 'TheBloke/Luna-AI-Llama2-Uncensored-GGUF', modelId: 'TheBloke/Luna-AI-Llama2-Uncensored-GGUF', displayName: 'Luna AI Llama2 Uncensored', author: 'TheBloke', family: 'Llama', params: '7B', capability: 'chat', downloads: 620000, description: 'Uncensored Llama 2 for research and creative exploration.', tags: ['gguf', 'chat', 'uncensored'] },
      { id: 'TheBloke/guanaco-13B-GGUF', modelId: 'TheBloke/guanaco-13B-GGUF', displayName: 'Guanaco 13B', author: 'TheBloke', family: 'Llama', params: '13B', capability: 'chat', downloads: 540000, description: 'QLoRA fine-tuned chat model. Open and helpful responses.', tags: ['gguf', 'chat'] },
    ],
  },
];

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond) return '';
  return formatBytes(bytesPerSecond) + '/s';
}

function formatETA(seconds) {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function getModelFamily(name) {
  const lower = (name || '').toLowerCase();
  for (const family of Object.keys(FAMILY_COLORS)) {
    if (lower.includes(family)) return family;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function StatusChip({ label, ok, detail }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium border ${
      ok ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`} />
      {label}
      {detail && <span className="text-text-muted ml-0.5">{detail}</span>}
    </div>
  );
}

function BenchmarkBar({ label, value, max = 100, color = 'bg-blue-500' }) {
  if (!value && value !== 0) return null;
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-16 text-text-muted truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-text-secondary">{typeof value === 'number' ? value.toFixed(1) : value}</span>
    </div>
  );
}

function TagBadge({ children, color = 'bg-neutral-800 text-text-muted' }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${color}`}>
      {children}
    </span>
  );
}

function ProgressBar({ percent, className = '' }) {
  return (
    <div className={`h-2 bg-neutral-800 rounded-full overflow-hidden ${className}`}>
      <motion.div
        className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percent || 0, 100)}%` }}
        transition={{ duration: 0.3 }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OLLAMA MODEL CARD
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// MODEL PROFILE MODAL - Full detailed profile view
// ─────────────────────────────────────────────────────────────────────────────

function OllamaProfileModal({ model, profile, hardware, pullingModels, installedModels, onPull, onClose }) {
  if (!model) return null;

  const modelId = model.id || model.name;
  const modelName = model.name || model.id;
  const family = model.family || '';
  const familyLower = family.toLowerCase();
  const description = model.description || '';
  const author = model.author || '';
  const capability = model.capability || 'chat';
  const variants = profile?.variants || model.variants || [];
  const pulls = model.pulls || 0;
  const tags = model.tags || [];
  const vramGB = hardware?.gpu?.vram ? hardware.gpu.vram / 1024 : 0;

  const isInstalled = installedModels?.some(m =>
    m.name === modelId || m.name?.startsWith(modelId + ':')
  );

  // Merge profile enrichments
  const longDesc = profile?.longDescription || description;
  const strengths = profile?.strengths || [];
  const considerations = profile?.considerations || [];
  const benchmarks = profile?.benchmarks || [];
  const useCases = profile?.useCases || [];
  const contextLength = profile?.contextLength || model.contextLength;
  const architecture = profile?.architecture || model.architecture;
  const dataCutoff = profile?.dataCutoff;
  const license = profile?.license || model.license;

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-neutral-950 border border-neutral-800 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="relative p-6 pb-4 border-b border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-neutral-800 text-text-muted hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
          <button onClick={onClose} className="absolute top-4 left-4 p-1.5 rounded-lg hover:bg-neutral-800 text-text-muted hover:text-text-primary transition-colors flex items-center gap-1 text-xs">
            <ArrowLeft size={14} /> Back
          </button>

          <div className="mt-6">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <h2 className="text-2xl font-bold text-text-primary">{modelName}</h2>
              {family && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${FAMILY_COLORS[familyLower] || 'bg-neutral-800 text-text-muted'}`}>
                  {family}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                capability === 'code' ? 'bg-green-500/15 text-green-400' :
                capability === 'vision' ? 'bg-purple-500/15 text-purple-400' :
                'bg-blue-500/15 text-blue-400'
              }`}>
                {capability}
              </span>
              {isInstalled && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/20 text-green-400 flex items-center gap-1">
                  <Check size={10} /> Installed
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary leading-relaxed max-w-xl">{description}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
              {author && <span className="flex items-center gap-1"><Bot size={12} /> {author}</span>}
              {pulls > 0 && <span className="flex items-center gap-1"><Download size={12} /> {pulls >= 1000000 ? `${(pulls/1000000).toFixed(1)}M` : pulls >= 1000 ? `${(pulls/1000).toFixed(0)}K` : pulls} pulls</span>}
              {contextLength && <span className="flex items-center gap-1"><BookOpen size={12} /> {contextLength.toLocaleString()} ctx</span>}
              {license && <span className="flex items-center gap-1"><Shield size={12} /> {license}</span>}
            </div>
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Long description */}
          {longDesc !== description && (
            <div>
              <p className="text-sm text-text-secondary leading-relaxed">{longDesc}</p>
            </div>
          )}

          {/* ── Benchmarks ── */}
          {benchmarks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Gauge size={16} className="text-blue-400" /> Benchmarks
              </h3>
              <div className="grid gap-2">
                {benchmarks.map(b => (
                  <div key={b.name} className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="text-xs font-medium text-text-primary">{b.name}</span>
                        <span className="text-[10px] text-text-muted ml-2">{b.description}</span>
                      </div>
                      <span className={`text-sm font-bold ${
                        b.score >= 80 ? 'text-green-400' :
                        b.score >= 60 ? 'text-blue-400' :
                        b.score >= 40 ? 'text-amber-400' :
                        'text-red-400'
                      }`}>{b.score}%</span>
                    </div>
                    <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${
                          b.score >= 80 ? 'bg-gradient-to-r from-green-600 to-green-400' :
                          b.score >= 60 ? 'bg-gradient-to-r from-blue-600 to-blue-400' :
                          b.score >= 40 ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
                          'bg-gradient-to-r from-red-600 to-red-400'
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(b.score, 100)}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Strengths & Considerations ── */}
          {(strengths.length > 0 || considerations.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {strengths.length > 0 && (
                <div className="bg-green-500/5 border border-green-500/15 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
                    <ThumbsUp size={14} /> Strengths
                  </h3>
                  <ul className="space-y-1.5">
                    {strengths.map((s, i) => (
                      <li key={i} className="text-xs text-text-secondary flex items-start gap-2">
                        <Check size={12} className="text-green-500 flex-shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {considerations.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2">
                    <AlertTriangle size={14} /> Considerations
                  </h3>
                  <ul className="space-y-1.5">
                    {considerations.map((c, i) => (
                      <li key={i} className="text-xs text-text-secondary flex items-start gap-2">
                        <Info size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Use Cases ── */}
          {useCases.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Target size={16} className="text-purple-400" /> Best For
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {useCases.map((uc, i) => {
                  const IconComp = USE_CASE_ICONS[uc.icon] || Lightbulb;
                  const colorMap = {
                    chat: 'border-blue-500/20 bg-blue-500/5',
                    code: 'border-green-500/20 bg-green-500/5',
                    creative: 'border-purple-500/20 bg-purple-500/5',
                    reasoning: 'border-amber-500/20 bg-amber-500/5',
                    multilingual: 'border-cyan-500/20 bg-cyan-500/5',
                    vision: 'border-pink-500/20 bg-pink-500/5',
                  };
                  const iconColorMap = {
                    chat: 'text-blue-400',
                    code: 'text-green-400',
                    creative: 'text-purple-400',
                    reasoning: 'text-amber-400',
                    multilingual: 'text-cyan-400',
                    vision: 'text-pink-400',
                  };
                  return (
                    <div key={i} className={`border rounded-lg p-3 ${colorMap[uc.icon] || 'border-neutral-800 bg-neutral-900/40'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <IconComp size={14} className={iconColorMap[uc.icon] || 'text-text-muted'} />
                        <span className="text-xs font-medium text-text-primary">{uc.title}</span>
                      </div>
                      <p className="text-[10px] text-text-muted leading-relaxed">{uc.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Available Sizes / Variants ── */}
          {variants.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Layers size={16} className="text-cyan-400" /> Available Sizes
                {vramGB > 0 && (
                  <span className="text-[10px] text-text-muted font-normal ml-2">
                    Your GPU: {Math.round(vramGB)}GB VRAM
                  </span>
                )}
              </h3>
              <div className="space-y-2">
                {variants.map(v => {
                  const fitsGpu = vramGB > 0 ? (v.vram || 0) <= vramGB * 0.9 : true;
                  const isRecommended = v.recommended;
                  const isVariantPulling = pullingModels?.[`${modelId}:${v.tag}`];
                  const isVariantInstalled = installedModels?.some(m => m.name === `${modelId}:${v.tag}`);
                  
                  return (
                    <div key={v.tag} className={`flex items-center justify-between rounded-lg px-4 py-3 border transition-colors ${
                      isRecommended ? 'border-blue-500/30 bg-blue-500/5' :
                      !fitsGpu ? 'border-red-500/15 bg-red-500/5' :
                      'border-neutral-800 bg-neutral-900/40'
                    }`}>
                      <div className="flex items-center gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-text-primary">{modelId}:{v.tag}</span>
                            {isRecommended && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">RECOMMENDED</span>
                            )}
                          </div>
                          <span className="text-xs text-text-muted">{v.params} parameters</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {v.size && (
                          <div className="text-right">
                            <p className="text-xs font-medium text-text-secondary">{v.size}GB</p>
                            <p className="text-[10px] text-text-muted">download</p>
                          </div>
                        )}
                        {v.vram && (
                          <div className="text-right">
                            <p className={`text-xs font-medium ${fitsGpu ? 'text-green-400' : 'text-red-400'}`}>~{v.vram}GB</p>
                            <p className="text-[10px] text-text-muted">VRAM</p>
                          </div>
                        )}
                        {isVariantPulling ? (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 rounded-lg text-xs text-blue-400 min-w-[80px] justify-center">
                            <Loader size={12} className="animate-spin" />
                            Pulling...
                          </div>
                        ) : isVariantInstalled ? (
                          <div className="flex items-center gap-1 px-3 py-1.5 bg-green-500/10 rounded-lg text-xs text-green-400 min-w-[80px] justify-center">
                            <Check size={12} /> Ready
                          </div>
                        ) : (
                          <button
                            onClick={() => onPull?.(`${modelId}:${v.tag}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded-lg text-xs transition-colors min-w-[80px] justify-center font-medium"
                          >
                            <Download size={12} /> Pull
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Technical Details ── */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Cpu size={16} className="text-neutral-400" /> Technical Details
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {architecture && (
                <div className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">Architecture</p>
                  <p className="text-xs text-text-secondary font-medium">{architecture}</p>
                </div>
              )}
              {contextLength && (
                <div className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">Context Length</p>
                  <p className="text-xs text-text-secondary font-medium">{contextLength.toLocaleString()} tokens</p>
                </div>
              )}
              {dataCutoff && (
                <div className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">Training Data</p>
                  <p className="text-xs text-text-secondary font-medium">Up to {dataCutoff}</p>
                </div>
              )}
              {license && (
                <div className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">License</p>
                  <p className="text-xs text-text-secondary font-medium">{license}</p>
                </div>
              )}
              {variants.length > 0 && (
                <div className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">Available Sizes</p>
                  <p className="text-xs text-text-secondary font-medium">{variants.map(v => v.params).join(', ')}</p>
                </div>
              )}
              {tags.length > 0 && (
                <div className="bg-neutral-900/60 border border-neutral-800/50 rounded-lg p-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">Tags</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tags.map(t => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-text-muted">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OLLAMA MODEL CARD
// ─────────────────────────────────────────────────────────────────────────────

function OllamaModelCard({ model, hardware, pullingModels, onPull, onCompare, compareSet, installedModels, onSelect }) {
  // Handle both catalog shape (id, name, family, variants) and installed shape (name, details)
  const modelId = model.id || model.name;
  const modelName = model.name || model.id;
  const family = model.family || getModelFamily(modelName);
  const familyLower = family?.toLowerCase();
  const description = model.description || model.details?.family || '';
  const author = model.author || '';
  const capability = model.capability || '';
  const variants = model.variants || [];
  const tags = model.tags || [];
  const pulls = model.pulls || 0;
  const updated = model.updated || model.modified_at;

  // Check installed status
  const isInstalled = installedModels?.some(m => 
    m.name === modelId || 
    m.name?.startsWith(modelId + ':') ||
    m.name === modelName ||
    m.name?.startsWith(modelName + ':')
  );
  
  // Check pulling status (check both id and name forms)
  const isPulling = pullingModels?.[modelId] || pullingModels?.[modelName];
  const pullProgress = isPulling;

  // Find smallest variant for VRAM check
  const smallestVariant = variants.length > 0 
    ? variants.reduce((a, b) => (a.vram || 999) < (b.vram || 999) ? a : b)
    : null;
  const vramGB = hardware?.gpu?.vram ? hardware.gpu.vram / 1024 : 0;
  const bestFit = smallestVariant && vramGB > 0 
    ? variants.filter(v => (v.vram || 0) <= vramGB * 0.9).sort((a, b) => (b.vram || 0) - (a.vram || 0))[0]
    : null;

  return (
    <div className="bg-neutral-900/80 border border-neutral-800 hover:border-blue-500/30 rounded-lg overflow-hidden transition-all hover:shadow-lg hover:shadow-blue-500/5 group">
      <div className="p-3 cursor-pointer" onClick={() => onSelect?.(model)}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-medium text-text-primary text-sm">{modelName}</h4>
              {family && (
                <TagBadge color={FAMILY_COLORS[familyLower] || 'bg-neutral-800 text-text-muted'}>
                  {family}
                </TagBadge>
              )}
              {capability && (
                <TagBadge color={
                  capability === 'code' ? 'bg-green-500/15 text-green-400' :
                  capability === 'vision' ? 'bg-purple-500/15 text-purple-400' :
                  capability === 'embedding' ? 'bg-amber-500/15 text-amber-400' :
                  'bg-blue-500/15 text-blue-400'
                }>
                  {capability}
                </TagBadge>
              )}
              {isInstalled && (
                <TagBadge color="bg-green-500/20 text-green-400">Installed</TagBadge>
              )}
            </div>
            <p className="text-xs text-text-muted mt-1 line-clamp-2">{description}</p>
            {/* Quick stats row */}
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted">
              {author && <span className="text-text-secondary">{author}</span>}
              {pulls > 0 && <span><Download size={9} className="inline mr-0.5" />{pulls >= 1000000 ? `${(pulls/1000000).toFixed(1)}M` : pulls >= 1000 ? `${(pulls/1000).toFixed(0)}K` : pulls}</span>}
              {variants.length > 0 && <span>{variants.length} variant{variants.length > 1 ? 's' : ''}</span>}
              {bestFit && vramGB > 0 && (
                <span className="text-green-400"><Check size={9} className="inline" /> {bestFit.params || bestFit.tag} fits your GPU</span>
              )}
              {updated && <span>{new Date(updated).toLocaleDateString()}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onCompare?.(model); }}
              className={`p-1 rounded transition-colors ${
                compareSet?.has(modelId) || compareSet?.has(modelName) ? 'text-blue-400 bg-blue-500/20' : 'text-neutral-600 hover:text-text-muted'
              }`}
              title="Compare"
            >
              <BarChart3 size={14} />
            </button>
            {isPulling ? (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 rounded text-xs text-blue-400">
                <Loader size={12} className="animate-spin" />
                {pullProgress?.percent ? `${pullProgress.percent}%` : 'Pulling...'}
              </div>
            ) : isInstalled ? (
              <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-400">
                <Check size={12} /> Ready
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onPull?.(modelId); }}
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded text-xs transition-colors"
              >
                <Download size={12} /> Pull
              </button>
            )}
          </div>
        </div>

        {/* Pull progress inline */}
        {isPulling && pullProgress && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
              <span>{pullProgress.status || 'Downloading...'}</span>
              {pullProgress.percent > 0 && <span>{pullProgress.percent}%</span>}
            </div>
            <ProgressBar percent={pullProgress.percent || 0} />
          </div>
        )}
      </div>

      {/* Quick variant preview bar */}
      {variants.length > 0 && (
        <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
          {variants.slice(0, 5).map(v => {
            const fitsGpu = vramGB > 0 ? (v.vram || 0) <= vramGB * 0.9 : true;
            return (
              <span key={v.tag} className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                fitsGpu ? 'bg-neutral-800/60 text-text-muted' : 'bg-red-500/10 text-red-400/60'
              }`}>
                {v.params || v.tag}{v.vram ? ` (${v.vram}GB)` : ''}
              </span>
            );
          })}
          {variants.length > 5 && (
            <span className="text-[9px] text-text-muted">+{variants.length - 5} more</span>
          )}
          <span className="text-[9px] text-blue-400/70 ml-auto flex items-center gap-0.5">
            View Profile <ChevronRight size={9} />
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HUGGINGFACE MODEL CARD
// ─────────────────────────────────────────────────────────────────────────────

function HfModelCard({ model, onSelect }) {
  const displayName = model.displayName || (model.modelId || model.id || '').split('/').pop();
  const author = model.author || (model.modelId || model.id || '').split('/')[0];
  const family = model.family || model.enriched?.family || '';
  const familyLower = family.toLowerCase();
  const params = model.params || model.enriched?.params || '';
  const capability = model.capability || model.enriched?.capability || model.pipeline_tag || '';
  const downloads = model.downloads || model.downloadCount || model.enriched?.downloadCount || 0;
  const description = model.description || '';

  return (
    <div
      className="bg-neutral-900/80 border border-neutral-800 hover:border-blue-500/30 rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-500/5 group"
      onClick={() => onSelect?.(model)}
    >
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-text-primary text-sm leading-tight">{displayName}</h4>
            <p className="text-[10px] text-text-muted mt-0.5">{author}</p>
          </div>
          {/* GGUF badge */}
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium flex-shrink-0">
            GGUF
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-[11px] text-text-secondary mt-1.5 line-clamp-2 leading-relaxed">{description}</p>
        )}

        {/* Tags/badges row */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {family && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${FAMILY_COLORS[familyLower] || 'bg-neutral-800 text-text-muted'}`}>
              {family}
            </span>
          )}
          {params && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-text-muted font-mono">
              {params}
            </span>
          )}
          {capability && capability !== 'chat' && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
              capability === 'code' ? 'bg-green-500/15 text-green-400' :
              capability === 'creative' ? 'bg-purple-500/15 text-purple-400' :
              'bg-blue-500/15 text-blue-400'
            }`}>
              {capability}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
          {downloads > 0 && (
            <span className="flex items-center gap-1">
              <Download size={10} />
              {downloads >= 1000000 ? `${(downloads/1000000).toFixed(1)}M` : downloads >= 1000 ? `${(downloads/1000).toFixed(0)}K` : downloads}
            </span>
          )}
          {model.likes > 0 && (
            <span className="flex items-center gap-1">
              <Heart size={10} /> {model.likes}
            </span>
          )}
          {model.lastModified && (
            <span className="flex items-center gap-1">
              <Clock size={10} /> {new Date(model.lastModified).toLocaleDateString()}
            </span>
          )}
          <span className="text-blue-400/70 ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            View Files <ChevronRight size={9} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD CARD
// ─────────────────────────────────────────────────────────────────────────────

function DownloadCard({ job, onPause, onResume, onRetry, onCancel, onDelete, onSetActive, onOpenFolder, onPriorityUp, onPriorityDown }) {
  const isActive = job.status === 'downloading' || job.status === 'active';
  const isPaused = job.status === 'paused';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed' || job.status === 'error';
  const isQueued = job.status === 'queued' || job.status === 'pending';

  const statusColors = {
    downloading: 'text-blue-400', active: 'text-blue-400',
    paused: 'text-amber-400',
    completed: 'text-green-400',
    failed: 'text-red-400', error: 'text-red-400',
    queued: 'text-neutral-400', pending: 'text-neutral-400',
    cancelled: 'text-neutral-500',
  };

  const statusLabels = {
    downloading: 'Downloading', active: 'Downloading',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed', error: 'Failed',
    queued: 'Queued', pending: 'Queued',
    cancelled: 'Cancelled',
  };

  return (
    <div className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-text-primary text-sm truncate">{job.name || job.fileName || 'Unknown'}</h4>
            <span className={`text-[10px] font-medium ${statusColors[job.status] || 'text-neutral-400'}`}>
              {statusLabels[job.status] || job.status}
            </span>
          </div>
          {/* Progress detail */}
          {(isActive || isPaused) && (
            <div className="mt-2">
              <ProgressBar percent={job.progress || 0} />
              <div className="flex items-center justify-between mt-1 text-[10px] text-text-muted">
                <span>
                  {job.downloadedBytes ? formatBytes(job.downloadedBytes) : '0 B'}
                  {job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ''}
                </span>
                <div className="flex items-center gap-3">
                  {isActive && job.speed && <span>{formatSpeed(job.speed)}</span>}
                  {isActive && job.eta && <span>ETA: {formatETA(job.eta)}</span>}
                  {job.progress !== undefined && <span>{Math.round(job.progress)}%</span>}
                </div>
              </div>
            </div>
          )}
          {/* Ollama pull stages */}
          {job.ollamaPull && job.stages && (
            <div className="mt-2 flex items-center gap-1 text-[10px]">
              {job.stages.map((stage, i) => (
                <React.Fragment key={i}>
                  <span className={stage.done ? 'text-green-400' : stage.active ? 'text-blue-400' : 'text-neutral-600'}>
                    {stage.done ? <Check size={10} /> : stage.active ? <Loader size={10} className="animate-spin" /> : <span className="w-2.5 h-2.5 rounded-full border border-neutral-600 inline-block" />}
                  </span>
                  <span className={stage.active ? 'text-blue-400' : stage.done ? 'text-green-400' : 'text-neutral-600'}>
                    {stage.label}
                  </span>
                  {i < job.stages.length - 1 && <ChevronRight size={10} className="text-neutral-700" />}
                </React.Fragment>
              ))}
            </div>
          )}
          {/* Error message */}
          {isFailed && job.error && (
            <p className="text-xs text-red-400 mt-1">{job.error}</p>
          )}
          {/* Completed info */}
          {isCompleted && (
            <div className="flex items-center gap-3 mt-1 text-[10px] text-text-muted">
              {job.totalBytes && <span>{formatBytes(job.totalBytes)}</span>}
              {job.completedAt && <span>{new Date(job.completedAt).toLocaleString()}</span>}
            </div>
          )}
          {/* Destination */}
          {job.destPath && (
            <button
              onClick={() => onOpenFolder?.(job.destPath)}
              className="text-[10px] text-text-muted hover:text-text-secondary mt-1 truncate max-w-full block text-left"
              title={job.destPath}
            >
              <FolderOpen size={10} className="inline mr-1" />
              {job.destPath}
            </button>
          )}
          {/* Retry count */}
          {isFailed && job.retries > 0 && (
            <span className="text-[10px] text-text-muted mt-1 block">Retries: {job.retries}/{job.maxRetries || 5}</span>
          )}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Priority reorder for queued items */}
          {(isQueued || isPaused) && (
            <div className="flex flex-col mr-1">
              <button onClick={() => onPriorityUp?.(job.id)} className="p-0.5 text-neutral-600 hover:text-blue-400 rounded" title="Move up"><ArrowUp size={11} /></button>
              <button onClick={() => onPriorityDown?.(job.id)} className="p-0.5 text-neutral-600 hover:text-blue-400 rounded" title="Move down"><ArrowDown size={11} /></button>
            </div>
          )}
          {isActive && (
            <button onClick={() => onPause?.(job.id)} className="p-1.5 text-text-muted hover:text-amber-400 rounded hover:bg-neutral-800" title="Pause">
              <Pause size={14} />
            </button>
          )}
          {isPaused && (
            <button onClick={() => onResume?.(job.id)} className="p-1.5 text-text-muted hover:text-blue-400 rounded hover:bg-neutral-800" title="Resume">
              <Play size={14} />
            </button>
          )}
          {isFailed && (
            <button onClick={() => onRetry?.(job.id)} className="p-1.5 text-text-muted hover:text-blue-400 rounded hover:bg-neutral-800" title="Retry">
              <RotateCcw size={14} />
            </button>
          )}
          {isCompleted && (
            <button onClick={() => onSetActive?.(job)} className="p-1.5 text-text-muted hover:text-green-400 rounded hover:bg-neutral-800" title="Set as active model">
              <Play size={14} />
            </button>
          )}
          {(isActive || isPaused || isQueued) && (
            <button onClick={() => onCancel?.(job.id)} className="p-1.5 text-text-muted hover:text-red-400 rounded hover:bg-neutral-800" title="Cancel">
              <XCircle size={14} />
            </button>
          )}
          <button onClick={() => onDelete?.(job.id)} className="p-1.5 text-text-muted hover:text-red-400 rounded hover:bg-neutral-800" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIBRARY MODEL CARD
// ─────────────────────────────────────────────────────────────────────────────

function LibraryModelCard({ model, currentModel, onSetActive, onDelete, onToggleFavorite, favorites, expanded, onToggleExpand }) {
  const isActive = currentModel === model.name || currentModel === model.id;
  const isFav = favorites?.has(model.name || model.id);
  const format = model.format || (model.name?.includes(':') ? 'ollama' : 'unknown');
  const colorClass = FORMAT_COLORS[format] || FORMAT_COLORS.ollama;

  return (
    <div className={`bg-neutral-900/80 border rounded-lg overflow-hidden transition-colors ${
      isActive ? 'border-green-500/40 bg-green-500/5' : 'border-neutral-800 hover:border-neutral-700'
    }`}>
      <div className="p-3 flex items-center gap-3">
        {/* Favorite */}
        <button
          onClick={() => onToggleFavorite?.(model.name || model.id)}
          className={`p-0.5 transition-colors ${isFav ? 'text-red-400' : 'text-neutral-700 hover:text-neutral-500'}`}
        >
          <Heart size={14} fill={isFav ? 'currentColor' : 'none'} />
        </button>
        {/* Info */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onToggleExpand?.(model.name || model.id)}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{model.name || model.id}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colorClass}`}>{format.toUpperCase()}</span>
            {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Active</span>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-text-muted">
            {model.size && <span>{formatBytes(model.size)}</span>}
            {model.details?.parameter_size && <span>{model.details.parameter_size}</span>}
            {model.details?.quantization_level && <span>{model.details.quantization_level}</span>}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isActive && (
            <button
              onClick={() => onSetActive?.(model.name || model.id)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded transition-colors"
            >
              <Play size={11} /> Use
            </button>
          )}
          <button
            onClick={() => onDelete?.(model)}
            className="p-1.5 text-neutral-600 hover:text-red-400 rounded hover:bg-neutral-800 transition-colors"
            title="Delete model"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-neutral-800 text-[10px] text-text-muted space-y-1">
              {model.path && <p>Path: <span className="text-text-secondary font-mono">{model.path}</span></p>}
              {model.details?.family && <p>Family: <span className="text-text-secondary">{model.details.family}</span></p>}
              {model.modified_at && <p>Modified: <span className="text-text-secondary">{new Date(model.modified_at).toLocaleString()}</span></p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE PANEL
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RADAR CHART SVG - For model comparison
// ─────────────────────────────────────────────────────────────────────────────

const RADAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b'];

function RadarChart({ models, size = 200 }) {
  const benchmarkKeys = ['mmlu', 'humaneval', 'gsm8k', 'hellaswag', 'arc'];
  const benchmarkLabels = ['MMLU', 'Code', 'Math', 'Sense', 'ARC'];
  const cx = size / 2, cy = size / 2, r = size * 0.38;

  // Get benchmark values from profile or model
  const getVal = (m, key) => {
    const profile = MODEL_PROFILES[m.id || m.name];
    if (profile?.benchmarks) {
      const b = profile.benchmarks.find(x => x.name?.toLowerCase().includes(key === 'humaneval' ? 'humaneval' : key === 'gsm8k' ? 'gsm8k' : key === 'hellaswag' ? 'hellaswag' : key === 'arc' ? 'arc' : key));
      if (b) return b.score;
    }
    return m.benchmarks?.[key] || 0;
  };

  const points = (m) => benchmarkKeys.map((key, i) => {
    const angle = (Math.PI * 2 * i / benchmarkKeys.length) - Math.PI / 2;
    const val = Math.min(getVal(m, key) / 100, 1);
    return `${cx + r * val * Math.cos(angle)},${cy + r * val * Math.sin(angle)}`;
  }).join(' ');

  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <svg width={size} height={size} className="mx-auto">
      {/* Grid */}
      {gridLevels.map(level => (
        <polygon key={level} points={benchmarkKeys.map((_, i) => {
          const angle = (Math.PI * 2 * i / benchmarkKeys.length) - Math.PI / 2;
          return `${cx + r * level * Math.cos(angle)},${cy + r * level * Math.sin(angle)}`;
        }).join(' ')} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}
      {/* Axes */}
      {benchmarkKeys.map((_, i) => {
        const angle = (Math.PI * 2 * i / benchmarkKeys.length) - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="rgba(255,255,255,0.08)" />;
      })}
      {/* Data polygons */}
      {models.map((m, mi) => (
        <polygon key={mi} points={points(m)} fill={RADAR_COLORS[mi] + '20'} stroke={RADAR_COLORS[mi]} strokeWidth="2" />
      ))}
      {/* Labels */}
      {benchmarkLabels.map((label, i) => {
        const angle = (Math.PI * 2 * i / benchmarkKeys.length) - Math.PI / 2;
        const lx = cx + (r + 16) * Math.cos(angle);
        const ly = cy + (r + 16) * Math.sin(angle);
        return <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-neutral-400 text-[9px]">{label}</text>;
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE PANEL - Upgraded with radar chart + winners
// ─────────────────────────────────────────────────────────────────────────────

function ComparePanel({ models, hardware, onClose, onRemove }) {
  if (!models || models.length < 2) return null;

  const vramGB = hardware?.gpu?.vram ? hardware.gpu.vram / 1024 : 0;
  const benchmarkKeys = ['mmlu', 'humaneval', 'gsm8k'];
  const benchmarkLabels = { mmlu: 'MMLU (Knowledge)', humaneval: 'HumanEval (Code)', gsm8k: 'GSM8K (Math)' };

  const getVal = (m, key) => {
    const profile = MODEL_PROFILES[m.id || m.name];
    if (profile?.benchmarks) {
      const b = profile.benchmarks.find(x => x.name?.toLowerCase().includes(key === 'humaneval' ? 'humaneval' : key === 'gsm8k' ? 'gsm8k' : key));
      if (b) return b.score;
    }
    return m.benchmarks?.[key] || 0;
  };

  // Determine winners per benchmark
  const winners = {};
  benchmarkKeys.forEach(key => {
    let best = -1, bestIdx = -1;
    models.forEach((m, i) => { const v = getVal(m, key); if (v > best) { best = v; bestIdx = i; } });
    if (best > 0) winners[key] = bestIdx;
  });

  // Best overall (average of available benchmarks)
  const overallScores = models.map(m => {
    const vals = benchmarkKeys.map(k => getVal(m, k)).filter(v => v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  const bestOverallIdx = overallScores.indexOf(Math.max(...overallScores));

  // Best for hardware (smallest VRAM that fits)
  const bestHwIdx = vramGB > 0 ? models.reduce((best, m, i) => {
    const v = m.variants?.[0]?.vram || 999;
    const fits = v <= vramGB * 0.9;
    if (!fits) return best;
    const score = overallScores[i];
    return score > (best.score || 0) ? { idx: i, score } : best;
  }, { idx: -1, score: 0 }).idx : -1;

  return (
    <motion.div
      initial={{ y: 300, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 300, opacity: 0 }}
      className="absolute bottom-0 left-0 right-0 bg-neutral-950 border-t border-neutral-700 rounded-t-xl p-4 max-h-[55%] overflow-y-auto z-10"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <BarChart3 size={16} /> Comparing {models.length} Models
        </h3>
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded"><X size={16} /></button>
      </div>

      <div className="flex gap-4">
        {/* Radar chart */}
        <div className="flex-shrink-0">
          <RadarChart models={models} size={180} />
          <div className="flex items-center justify-center gap-3 mt-1">
            {models.map((m, i) => (
              <span key={i} className="text-[9px] flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: RADAR_COLORS[i] }} />
                {(m.name || m.id || '').slice(0, 12)}
              </span>
            ))}
          </div>
        </div>

        {/* Details grid */}
        <div className="flex-1 min-w-0">
          {/* Recommendation badges */}
          <div className="flex gap-2 mb-3">
            {bestOverallIdx >= 0 && overallScores[bestOverallIdx] > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px]">
                <Star size={11} className="text-amber-400" />
                <span className="text-amber-400 font-medium">Best Overall:</span>
                <span className="text-text-secondary">{models[bestOverallIdx]?.name || models[bestOverallIdx]?.id}</span>
              </div>
            )}
            {bestHwIdx >= 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-[10px]">
                <Cpu size={11} className="text-green-400" />
                <span className="text-green-400 font-medium">Best for Your GPU:</span>
                <span className="text-text-secondary">{models[bestHwIdx]?.name || models[bestHwIdx]?.id}</span>
              </div>
            )}
          </div>

          {/* Benchmark comparison rows */}
          <div className="space-y-2">
            {benchmarkKeys.map(key => {
              const vals = models.map(m => getVal(m, key));
              if (vals.every(v => v === 0)) return null;
              return (
                <div key={key} className="bg-neutral-900/60 rounded-lg p-2">
                  <p className="text-[10px] text-text-muted mb-1">{benchmarkLabels[key] || key}</p>
                  <div className="flex gap-2">
                    {models.map((m, i) => (
                      <div key={i} className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[9px] text-text-muted truncate">{(m.name || m.id || '').slice(0, 15)}</span>
                          <span className={`text-[10px] font-bold ${winners[key] === i ? 'text-green-400' : 'text-text-secondary'}`}>
                            {vals[i] > 0 ? `${vals[i]}%` : '-'}
                            {winners[key] === i && vals[i] > 0 && <Star size={9} className="inline ml-0.5 text-amber-400" />}
                          </span>
                        </div>
                        <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${vals[i]}%`, background: RADAR_COLORS[i] }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick stats */}
          <div className="grid gap-1 mt-2" style={{ gridTemplateColumns: `auto repeat(${models.length}, 1fr)` }}>
            {[
              { label: 'Params', get: m => m.variants?.[0]?.params || m.details?.parameter_size || '-' },
              { label: 'Context', get: m => { const p = MODEL_PROFILES[m.id || m.name]; return p?.contextLength ? `${(p.contextLength/1000).toFixed(0)}K` : '-'; } },
              { label: 'License', get: m => MODEL_PROFILES[m.id || m.name]?.license || m.license || '-' },
            ].map(row => (
              <React.Fragment key={row.label}>
                <span className="text-[9px] text-text-muted pr-2">{row.label}</span>
                {models.map((m, i) => (
                  <span key={i} className="text-[9px] text-text-secondary truncate">{row.get(m)}</span>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Model remove buttons */}
      <div className="flex gap-2 mt-3 border-t border-neutral-800 pt-2">
        {models.map((m, i) => (
          <button key={i} onClick={() => onRemove?.(m)} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-red-400 transition-colors">
            <X size={10} /> Remove {(m.name || m.id || '').slice(0, 20)}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ModelHubPanel({ isOpen, onClose }) {
  // ── Tab State ──
  const [activeTab, setActiveTab] = useState('discover');
  const [discoverSource, setDiscoverSource] = useState('ollama'); // 'ollama' | 'huggingface'

  // ── Hardware ──
  const [hardware, setHardware] = useState(null);

  // ── Connection ──
  const [ollamaOnline, setOllamaOnline] = useState(false);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  // ── Discover: Ollama ──
  const [ollamaModels, setOllamaModels] = useState([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaCategory, setOllamaCategory] = useState('all');
  const [ollamaSort, setOllamaSort] = useState('popular');
  const [pullingModels, setPullingModels] = useState({});
  const [installedModels, setInstalledModels] = useState([]);

  // ── Model Profile ──
  const [selectedOllamaModel, setSelectedOllamaModel] = useState(null);

  // ── Discover: HuggingFace ──
  const [hfCollections, setHfCollections] = useState([]);
  const [hfModels, setHfModels] = useState([]);
  const [hfLoading, setHfLoading] = useState(false);
  const [hfActiveCollection, setHfActiveCollection] = useState(null);
  const [hfSearchResults, setHfSearchResults] = useState(null);
  const [selectedHfModel, setSelectedHfModel] = useState(null);

  // ── Compare ──
  const [compareModels, setCompareModels] = useState([]);

  // ── Downloads ──
  const [downloads, setDownloads] = useState([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);

  // ── Library ──
  const [libraryModels, setLibraryModels] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState('all');
  const [librarySort, setLibrarySort] = useState('name');
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('devforge-model-favorites') || '[]')); }
    catch { return new Set(); }
  });
  const [expandedLibrary, setExpandedLibrary] = useState(null);
  const [diskUsage, setDiskUsage] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // ── Recommendations ──
  const [recommendations, setRecommendations] = useState([]);
  const [hfRecommendations, setHfRecommendations] = useState([]);

  // ── Universal Search ──
  const [universalResults, setUniversalResults] = useState(null); // { ollama: [], huggingface: [] }

  // ── Import/Scan ──
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);

  // ── Model Stats ──
  const [modelStats, setModelStats] = useState(null);

  // ── Library Settings ──
  const [showLibrarySettings, setShowLibrarySettings] = useState(false);
  const [modelsDirectory, setModelsDirectory] = useState(null);

  // ── Global ──
  const currentModel = useAppStore(s => s.currentModel);
  const setModel = useAppStore(s => s.setModel);
  const searchTimeout = useRef(null);

  const compareSet = useMemo(() => new Set(compareModels.map(m => m.name || m.modelId || m.id)), [compareModels]);

  // ── Persist favorites ──
  useEffect(() => {
    try { localStorage.setItem('devforge-model-favorites', JSON.stringify([...favorites])); }
    catch {}
  }, [favorites]);

  // ── Close dropdowns on click outside ──
  useEffect(() => {
    const handler = () => { setShowImportMenu(false); setShowLibrarySettings(false); };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // ── Debounced search ──
  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearchDebounced(searchQuery), 300);
    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery]);

  // ── Initial load ──
  useEffect(() => {
    if (!isOpen) return;
    loadHardware();
    checkOllamaStatus();
    loadInstalledModels();
    loadModelStats();
  }, [isOpen]);

  // ── Load recommendations after hardware is detected ──
  useEffect(() => {
    if (!hardware?.gpu?.vram) return;
    const vram = Math.round(hardware.gpu.vram / 1024);
    const ram = hardware.ram?.total ? Math.round(hardware.ram.total / (1024 * 1024 * 1024)) : 16;
    loadRecommendations(vram, ram);
  }, [hardware]);

  // ── Load data on tab switch ──
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'discover') {
      if (discoverSource === 'ollama') loadOllamaModels();
      else loadHfCollections();
    } else if (activeTab === 'downloads') {
      loadDownloads();
    } else if (activeTab === 'library') {
      loadLibrary();
    }
  }, [activeTab, discoverSource, isOpen]);

  // ── Search effect - universal cross-provider ──
  useEffect(() => {
    if (!searchDebounced) {
      setHfSearchResults(null);
      setUniversalResults(null);
      return;
    }
    if (activeTab === 'discover') {
      universalSearch(searchDebounced);
    }
  }, [searchDebounced, activeTab]);

  // ── Download event listeners ──
  useEffect(() => {
    if (!isElectron()) return;
    const unsubs = [];

    const updateJob = (updatedJob) => {
      setDownloads(prev => {
        const idx = prev.findIndex(j => j.id === updatedJob.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updatedJob };
          return next;
        }
        return [updatedJob, ...prev];
      });
    };

    unsubs.push(window.electronAPI?.onDownloadsJobCreated?.(updateJob));
    unsubs.push(window.electronAPI?.onDownloadsJobStarted?.(updateJob));
    unsubs.push(window.electronAPI?.onDownloadsJobProgress?.(updateJob));
    unsubs.push(window.electronAPI?.onDownloadsJobCompleted?.((job) => {
      updateJob({ ...job, status: 'completed' });
      loadInstalledModels(); // Refresh installed list
    }));
    unsubs.push(window.electronAPI?.onDownloadsJobError?.((job) => updateJob({ ...job, status: 'failed' })));
    unsubs.push(window.electronAPI?.onDownloadsJobPaused?.((job) => updateJob({ ...job, status: 'paused' })));
    unsubs.push(window.electronAPI?.onDownloadsJobCancelled?.((job) => updateJob({ ...job, status: 'cancelled' })));

    // Ollama pull progress
    unsubs.push(window.electronAPI?.onProvidersPullProgress?.((progress) => {
      setPullingModels(prev => {
        const modelName = progress.model || progress.name;
        if (!modelName) return prev;
        if (progress.status === 'success' || progress.completed) {
          const next = { ...prev };
          delete next[modelName];
          loadInstalledModels();
          return next;
        }
        return {
          ...prev,
          [modelName]: {
            status: progress.status || 'downloading',
            percent: progress.completed && progress.total
              ? Math.round((progress.completed / progress.total) * 100)
              : progress.percent || 0,
          }
        };
      });
    }));

    return () => unsubs.forEach(fn => fn?.());
  }, []);

  // ── Data loaders ──

  const loadHardware = async () => {
    const hw = await safeCall('detectHardware', [], null);
    setHardware(hw);
  };

  const checkOllamaStatus = async () => {
    try {
      const models = await safeCall('getModels', [], []);
      setOllamaOnline(Array.isArray(models));
    } catch {
      setOllamaOnline(false);
    }
  };

  const loadInstalledModels = async () => {
    const models = await safeCall('getModels', [], []);
    setInstalledModels(Array.isArray(models) ? models : []);
  };

  const loadOllamaModels = async () => {
    setOllamaLoading(true);
    try {
      // Load rich catalog from model-providers (curated models with descriptions, variants, sizes)
      // NOT browseRemoteModels which only returns locally installed models
      // Fetch all model categories in parallel for a complete catalog
      const [catalogModels, visionModels, codeModels, chatModels] = await Promise.all([
        safeCall('providersGetOllamaModels', ['popular'], []),
        safeCall('providersGetVisionModels', [], []),
        safeCall('providersGetOllamaModels', ['code'], []),
        safeCall('providersGetOllamaModels', ['chat'], []),
      ]);
      
      // Merge all categories, dedup by id
      const seen = new Set();
      const allModels = [
        ...(Array.isArray(catalogModels) ? catalogModels : []),
        ...(Array.isArray(codeModels) ? codeModels : []),
        ...(Array.isArray(chatModels) ? chatModels : []),
        ...(Array.isArray(visionModels) ? visionModels : []),
      ].filter(m => {
        const id = m.id || m.name;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      setOllamaModels(allModels);
    } catch (err) {
      console.error('[ModelHub] Ollama catalog error:', err);
      // Fallback: try to at least show installed models
      try {
        const result = await safeCall('browseRemoteModels', [], []);
        setOllamaModels(Array.isArray(result) ? result : result?.models || []);
      } catch {}
    }
    setOllamaLoading(false);
  };

  const loadHfCollections = async () => {
    setHfLoading(true);
    try {
      // Backend returns an object: { recommended: { name, models }, code: { name, models }, ... }
      // Convert to array of { id, name, description, models }
      const raw = await safeCall('hfGetCollections', [], {});
      const asArray = Object.entries(raw || {}).map(([id, col]) => ({
        id,
        name: col.name || id,
        description: col.description || '',
        modelIds: col.models || [],
      }));
      setHfCollections(asArray);

      // Auto-load first collection (recommended)
      if (asArray.length > 0 && !hfActiveCollection) {
        loadHfCollection(asArray[0].id);
      }
    } catch (err) {
      console.error('[ModelHub] HF collections error:', err);
      // Provide fallback static collections
      const fallback = HF_FEATURED_MODELS.map(cat => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        modelIds: cat.models.map(m => m.id),
      }));
      setHfCollections(fallback);
      if (fallback.length > 0) {
        setHfActiveCollection(fallback[0].id);
        setHfModels(HF_FEATURED_MODELS[0]?.models || []);
      }
    }
    setHfLoading(false);
  };

  const loadHfCollection = async (collectionId) => {
    setHfActiveCollection(collectionId);
    setHfLoading(true);

    // Show curated static data immediately while API loads
    const staticCollection = HF_FEATURED_MODELS.find(c => c.id === collectionId);
    if (staticCollection) {
      setHfModels(staticCollection.models);
    }

    try {
      // Backend returns { name, description, models: [...] } - extract the models array
      const result = await safeCall('hfGetCollectionModels', [collectionId], null);
      if (result?.models && Array.isArray(result.models) && result.models.length > 0) {
        // Enrich API results - they have ggufFiles, downloads, etc
        setHfModels(result.models);
      }
      // If API fails or returns empty, the static data above stays
    } catch (err) {
      console.error('[ModelHub] HF collection models error:', err);
      // Static data already set above, so we're good
    }
    setHfLoading(false);
  };

  const searchHf = async (query) => {
    if (!query?.trim()) {
      setHfSearchResults(null);
      return;
    }
    setHfLoading(true);
    try {
      const results = await safeCall('hfSearch', [query, { limit: 30 }], []);
      setHfSearchResults(Array.isArray(results) ? results : []);
    } catch (err) {
      console.error('[ModelHub] HF search error:', err);
      setHfSearchResults([]);
    }
    setHfLoading(false);
  };

  // ── Recommendations ──
  const loadRecommendations = async (vram, ram) => {
    try {
      const [ollamaRecs, hfRecs] = await Promise.all([
        safeCall('providersGetRecommendations', [vram, ram], []),
        safeCall('hfRecommendForHardware', [vram, ram], { recommendations: [] }),
      ]);
      setRecommendations(Array.isArray(ollamaRecs) ? ollamaRecs : []);
      setHfRecommendations(hfRecs?.recommendations || (Array.isArray(hfRecs) ? hfRecs : []));
    } catch (err) {
      console.error('[ModelHub] Recommendations error:', err);
    }
  };

  // ── Universal Search ──
  const universalSearch = async (query) => {
    try {
      const [searchAll, hfResults] = await Promise.all([
        safeCall('providersSearchAll', [query, {}], { ollama: [], huggingface: [] }),
        safeCall('hfSearch', [query, { limit: 20 }], []),
      ]);
      setUniversalResults({
        ollama: searchAll?.ollama || [],
        huggingface: hfResults || searchAll?.huggingface || [],
      });
      setHfSearchResults(hfResults || searchAll?.huggingface || []);
    } catch (err) {
      console.error('[ModelHub] Universal search error:', err);
    }
  };

  // ── Model Stats ──
  const loadModelStats = async () => {
    const stats = await safeCall('getModelStats', [], null);
    setModelStats(stats);
  };

  // ── Import / Scan ──
  const handleScanSystem = async () => {
    setScanning(true);
    try {
      const results = await safeCall('scanSystemForModels', [{}], []);
      setScanResults(Array.isArray(results) ? results : []);
    } catch (err) {
      console.error('[ModelHub] Scan error:', err);
    }
    setScanning(false);
  };

  const handleBrowseFiles = async () => {
    const result = await safeCall('browseForModelFiles', [], { canceled: true });
    if (!result?.canceled && result?.filePaths?.length) {
      setImporting(true);
      await safeCall('bulkImportModels', [result.filePaths, {}], null);
      setImporting(false);
      loadLibrary();
    }
  };

  const handleImportSelected = async (paths) => {
    setImporting(true);
    await safeCall('bulkImportModels', [paths, {}], null);
    setImporting(false);
    setScanResults(null);
    loadLibrary();
  };

  const handleChangeModelsDir = async () => {
    const result = await safeCall('browseForModelsDirectory', [], { canceled: true });
    if (result?.success && result?.directory) {
      setModelsDirectory(result.directory);
      loadLibrary();
    }
  };

  const handleClearCache = async () => {
    await Promise.all([
      safeCall('hfClearCache', [], null),
      safeCall('catalogClearCache', [null], null),
    ]);
  };

  // ── Trending / Recent (HuggingFace) ──
  const loadHfTrending = async () => {
    setHfLoading(true);
    try {
      const result = await safeCall('hfGetTrending', [20], []);
      setHfModels(Array.isArray(result) ? result : result?.models || []);
    } catch { setHfModels([]); }
    setHfLoading(false);
  };

  const loadHfRecent = async () => {
    setHfLoading(true);
    try {
      const result = await safeCall('hfGetRecent', [20], []);
      setHfModels(Array.isArray(result) ? result : result?.models || []);
    } catch { setHfModels([]); }
    setHfLoading(false);
  };

  const loadDownloads = async () => {
    setDownloadsLoading(true);
    try {
      const result = await safeCall('downloadsGetAllV2', [], []);
      setDownloads(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error('[ModelHub] Downloads error:', err);
    }
    setDownloadsLoading(false);
  };

  const loadLibrary = async () => {
    setLibraryLoading(true);
    try {
      const [ollama, scanned, disk] = await Promise.all([
        safeCall('getModels', [], []),
        safeCall('scanModels', [], []),
        safeCall('getModelsDiskSpace', [], null),
      ]);
      const ollamaList = (Array.isArray(ollama) ? ollama : []).map(m => ({ ...m, format: 'ollama' }));
      const scannedList = (Array.isArray(scanned) ? scanned : []).map(m => ({
        ...m,
        format: m.format || (m.path?.endsWith('.gguf') ? 'gguf' : m.path?.endsWith('.onnx') ? 'onnx' : 'unknown'),
      }));
      // Deduplicate
      const seen = new Set();
      const combined = [];
      for (const m of [...ollamaList, ...scannedList]) {
        const key = m.name || m.id || m.path;
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(m);
        }
      }
      setLibraryModels(combined);
      setDiskUsage(disk);
    } catch (err) {
      console.error('[ModelHub] Library error:', err);
    }
    setLibraryLoading(false);
  };

  // ── Actions ──

  const handlePull = useCallback(async (modelName) => {
    setPullingModels(prev => ({ ...prev, [modelName]: { status: 'Starting...', percent: 0 } }));
    try {
      await safeCall('providersPullOllamaModel', [modelName], { success: false });
    } catch (err) {
      console.error('[ModelHub] Pull error:', err);
      setPullingModels(prev => {
        const next = { ...prev };
        delete next[modelName];
        return next;
      });
    }
  }, []);

  const handleCompareToggle = useCallback((model) => {
    const id = model.name || model.modelId || model.id;
    setCompareModels(prev => {
      const exists = prev.find(m => (m.name || m.modelId || m.id) === id);
      if (exists) return prev.filter(m => (m.name || m.modelId || m.id) !== id);
      if (prev.length >= 3) return prev; // Max 3
      return [...prev, model];
    });
  }, []);

  const handleSetActive = useCallback((nameOrModel) => {
    const name = typeof nameOrModel === 'string' ? nameOrModel : (nameOrModel?.name || nameOrModel?.fileName);
    if (name) setModel(name);
  }, [setModel]);

  const handleDeleteModel = useCallback(async (model) => {
    if (!deleteConfirm || deleteConfirm !== (model.name || model.id)) {
      setDeleteConfirm(model.name || model.id);
      setTimeout(() => setDeleteConfirm(null), 3000); // Reset after 3s
      return;
    }
    setDeleteConfirm(null);
    await safeCall('deleteModel', [model.digest || model.id || model.name], null);
    loadLibrary();
    loadInstalledModels();
  }, [deleteConfirm]);

  const handleDownloadPriority = useCallback(async (id, direction) => {
    const idx = downloads.findIndex(d => d.id === id);
    if (idx < 0) return;
    const newPriority = direction === 'up' ? (downloads[idx].priority || 0) + 1 : Math.max((downloads[idx].priority || 0) - 1, 0);
    await safeCall('downloadsSetPriority', [id, newPriority], null);
    setDownloads(prev => prev.map(d => d.id === id ? { ...d, priority: newPriority } : d));
  }, [downloads]);

  const handleClearCompleted = useCallback(async () => {
    await safeCall('downloadsClearCompleted', [], null);
    setDownloads(prev => prev.filter(d => d.status !== 'completed'));
  }, []);

  const handleDownloadAction = useCallback(async (action, id) => {
    const actionMap = {
      pause: 'downloadsPause',
      resume: 'downloadsResume',
      retry: 'downloadsRetry',
      cancel: 'downloadsCancel',
      delete: 'downloadsDelete',
    };
    await safeCall(actionMap[action], action === 'delete' ? [id, true] : [id], null);
    if (action === 'delete' || action === 'cancel') {
      setDownloads(prev => prev.filter(j => j.id !== id));
    }
  }, []);

  const handleOpenFolder = useCallback((path) => {
    window.electronAPI?.openPath?.(path);
  }, []);

  // ── Filtered / Sorted data ──

  const filteredOllamaModels = useMemo(() => {
    let list = [...ollamaModels];

    // Search
    if (searchDebounced) {
      const q = searchDebounced.toLowerCase();
      list = list.filter(m =>
        (m.name || m.id || '').toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.family?.toLowerCase().includes(q) ||
        m.author?.toLowerCase().includes(q) ||
        m.tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    // Category
    if (ollamaCategory !== 'all') {
      list = list.filter(m => {
        const cap = m.capability?.toLowerCase() || '';
        const tags = (m.tags || []).map(t => t.toLowerCase());
        const name = (m.name || m.id || '').toLowerCase();
        switch (ollamaCategory) {
          case 'chat': return cap === 'chat' || tags.includes('chat');
          case 'code': return cap === 'code' || tags.includes('code') || tags.includes('programming') || name.includes('code') || name.includes('coder');
          case 'vision': return cap === 'vision' || tags.includes('vision') || tags.includes('multimodal');
          case 'embedding': return cap === 'embedding' || tags.includes('embedding');
          case 'small': {
            // Has a variant <= 4GB VRAM
            const variants = m.variants || [];
            return variants.some(v => (v.vram || 999) <= 4) || (m.size && m.size < 4);
          }
          default: return true;
        }
      });
    }

    // Sort
    switch (ollamaSort) {
      case 'newest':
        list.sort((a, b) => new Date(b.updated || b.modified_at || 0) - new Date(a.updated || a.modified_at || 0));
        break;
      case 'size_asc': {
        // Sort by smallest variant size
        const getMin = m => {
          const variants = m.variants || [];
          if (variants.length > 0) return Math.min(...variants.map(v => v.size || 999));
          return m.size || 999;
        };
        list.sort((a, b) => getMin(a) - getMin(b));
        break;
      }
      case 'name':
        list.sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || ''));
        break;
      default: // popular - sort by pulls/downloads
        list.sort((a, b) => (b.pulls || 0) - (a.pulls || 0));
        break;
    }

    return list;
  }, [ollamaModels, searchDebounced, ollamaCategory, ollamaSort]);

  const filteredLibrary = useMemo(() => {
    let list = [...libraryModels];

    // Search
    if (searchDebounced) {
      const q = searchDebounced.toLowerCase();
      list = list.filter(m => (m.name || m.id || '').toLowerCase().includes(q));
    }

    // Format filter
    if (libraryFilter !== 'all') {
      list = list.filter(m => m.format === libraryFilter);
    }

    // Sort
    switch (librarySort) {
      case 'size':
        list.sort((a, b) => (b.size || 0) - (a.size || 0));
        break;
      case 'favorites':
        list.sort((a, b) => {
          const aFav = favorites.has(a.name || a.id) ? 1 : 0;
          const bFav = favorites.has(b.name || b.id) ? 1 : 0;
          return bFav - aFav;
        });
        break;
      default: // name
        list.sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || ''));
        break;
    }

    return list;
  }, [libraryModels, searchDebounced, libraryFilter, librarySort, favorites]);

  const downloadStats = useMemo(() => {
    const active = downloads.filter(d => d.status === 'downloading' || d.status === 'active');
    const totalSpeed = active.reduce((sum, d) => sum + (d.speed || 0), 0);
    return {
      activeCount: active.length,
      totalSpeed,
      completedCount: downloads.filter(d => d.status === 'completed').length,
      failedCount: downloads.filter(d => d.status === 'failed' || d.status === 'error').length,
    };
  }, [downloads]);

  // GPU info string
  const gpuInfo = useMemo(() => {
    if (!hardware) return null;
    const gpu = hardware.gpu || hardware.controllers?.[0];
    const ram = hardware.memLayout?.[0]?.size || hardware.totalMemory;
    const parts = [];
    if (gpu?.model || gpu?.name) parts.push(gpu.model || gpu.name);
    if (gpu?.vram) parts.push(`${Math.round(gpu.vram / 1024)}GB VRAM`);
    else if (gpu?.memoryTotal) parts.push(`${Math.round(gpu.memoryTotal / 1024)}GB VRAM`);
    if (ram) parts.push(`${Math.round(ram / (1024 * 1024 * 1024))}GB RAM`);
    return parts.join(' / ') || null;
  }, [hardware]);

  // ── Keyboard ──
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!isOpen) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const TABS = [
    { id: 'discover', label: 'Discover', icon: Globe },
    { id: 'downloads', label: 'Downloads', icon: Download, badge: downloadStats.activeCount || null },
    { id: 'library', label: 'Library', icon: HardDrive, badge: libraryModels.length || null },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-4xl h-[85vh] bg-neutral-950 rounded-2xl shadow-2xl border border-neutral-800 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── HEADER ── */}
        <div className="px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                <Package size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-text-primary">Model Hub</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusChip label="Ollama" ok={ollamaOnline} />
                  {gpuInfo && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-text-muted bg-neutral-800/50 border border-neutral-700/50">
                      <Cpu size={10} />
                      {gpuInfo}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-neutral-800 transition-colors" title="Close (Esc)">
              <X size={18} />
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'discover'
                ? 'Search all models (Ollama + HuggingFace)...'
                : activeTab === 'library' ? 'Search installed models...' : 'Search...'}
              className="w-full pl-9 pr-4 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm text-text-primary placeholder-text-muted focus:border-blue-500/50 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mt-3">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-500/20 text-blue-400 font-medium'
                    : 'text-text-muted hover:text-text-secondary hover:bg-neutral-800/50'
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
                {tab.badge && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-text-muted">{tab.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div className="flex-1 overflow-hidden relative">
          {/* DISCOVER TAB */}
          {activeTab === 'discover' && (
            <div className="h-full flex flex-col">
              {/* Source toggle */}
              <div className="px-4 py-2 border-b border-neutral-800/50 flex items-center justify-between">
                <div className="flex items-center gap-1 bg-neutral-900 rounded-lg p-0.5">
                  {['ollama', 'huggingface'].map(src => (
                    <button
                      key={src}
                      onClick={() => setDiscoverSource(src)}
                      className={`px-3 py-1 rounded text-xs transition-colors ${
                        discoverSource === src
                          ? 'bg-blue-500/20 text-blue-400 font-medium'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {src === 'ollama' ? 'Ollama' : 'HuggingFace'}
                    </button>
                  ))}
                </div>

                {discoverSource === 'ollama' && (
                  <div className="flex items-center gap-2">
                    {/* Category pills */}
                    <div className="flex items-center gap-1">
                      {OLLAMA_CATEGORIES.map(cat => (
                        <button
                          key={cat.id}
                          onClick={() => setOllamaCategory(cat.id)}
                          className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                            ollamaCategory === cat.id
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'text-text-muted hover:text-text-secondary hover:bg-neutral-800'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    {/* Sort */}
                    <select
                      value={ollamaSort}
                      onChange={(e) => setOllamaSort(e.target.value)}
                      className="bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-text-muted"
                    >
                      {SORT_OPTIONS.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {discoverSource === 'huggingface' && (
                  <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
                    {/* Trending + Recent special tabs */}
                    <button
                      onClick={() => { setHfActiveCollection('__trending'); loadHfTrending(); }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                        hfActiveCollection === '__trending' ? 'bg-orange-500/20 text-orange-400 font-medium' : 'text-text-muted hover:text-text-secondary hover:bg-neutral-800'
                      }`}>
                      <Flame size={10} /> Trending
                    </button>
                    <button
                      onClick={() => { setHfActiveCollection('__recent'); loadHfRecent(); }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                        hfActiveCollection === '__recent' ? 'bg-cyan-500/20 text-cyan-400 font-medium' : 'text-text-muted hover:text-text-secondary hover:bg-neutral-800'
                      }`}>
                      <Clock size={10} /> New
                    </button>
                    <span className="w-px h-4 bg-neutral-700 mx-1" />
                    {hfCollections.map(col => {
                      const iconMap = { recommended: Sparkles, code: Code, chat: MessageSquare, creative: PenTool, small: Zap, uncensored: Shield };
                      const ColIcon = iconMap[col.id] || Globe;
                      return (
                        <button
                          key={col.id}
                          onClick={() => loadHfCollection(col.id)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                            hfActiveCollection === col.id
                              ? 'bg-purple-500/20 text-purple-400 font-medium'
                              : 'text-text-muted hover:text-text-secondary hover:bg-neutral-800'
                          }`}
                        >
                          <ColIcon size={10} />
                          {col.name || col.id}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Model list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {/* Loading - only show full spinner when no data is available */}
                {ollamaLoading && discoverSource === 'ollama' && ollamaModels.length === 0 && (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="animate-spin text-blue-400" size={24} />
                  </div>
                )}

                {/* Universal search results */}
                {searchDebounced && universalResults && (
                  <>
                    {universalResults.ollama?.length > 0 && (
                      <div className="mb-4">
                        <h3 className="text-xs font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                          <Globe size={12} className="text-blue-400" /> Ollama Results ({universalResults.ollama.length})
                        </h3>
                        <div className="space-y-2">
                          {universalResults.ollama.slice(0, 8).map(model => (
                            <OllamaModelCard key={model.id || model.name} model={model} hardware={hardware} pullingModels={pullingModels}
                              onPull={handlePull} onCompare={handleCompareToggle} compareSet={compareSet}
                              installedModels={installedModels} onSelect={setSelectedOllamaModel} />
                          ))}
                        </div>
                      </div>
                    )}
                    {universalResults.huggingface?.length > 0 && (
                      <div className="mb-4">
                        <h3 className="text-xs font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                          <Package size={12} className="text-purple-400" /> HuggingFace Results ({universalResults.huggingface.length})
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {universalResults.huggingface.slice(0, 8).map((model, i) => (
                            <HfModelCard key={model.modelId || model.id || i} model={model} onSelect={setSelectedHfModel} />
                          ))}
                        </div>
                      </div>
                    )}
                    {(universalResults.ollama?.length === 0 && universalResults.huggingface?.length === 0) && (
                      <div className="flex flex-col items-center py-12 text-center">
                        <Search size={32} className="text-neutral-600 mb-3" />
                        <p className="text-text-muted text-sm">No models found for "{searchDebounced}"</p>
                      </div>
                    )}
                  </>
                )}

                {/* Ollama models */}
                {!searchDebounced && discoverSource === 'ollama' && (ollamaModels.length > 0 || !ollamaLoading) && (
                  <>
                    {/* Recommended for You */}
                    {recommendations.length > 0 && ollamaCategory === 'all' && (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                            <Sparkles size={12} className="text-blue-400" />
                          </div>
                          <div>
                            <h3 className="text-xs font-semibold text-text-primary">Recommended for Your Hardware</h3>
                            <p className="text-[9px] text-text-muted">{hardware?.gpu?.model || 'GPU'} - {Math.round((hardware?.gpu?.vram || 0) / 1024)}GB VRAM</p>
                          </div>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                          {recommendations.slice(0, 6).map((rec, i) => {
                            const m = rec.model || rec;
                            const name = m.name || m.id || rec.name || '';
                            const recVariant = rec.recommendedVariant || rec.variant || m.variants?.[0];
                            return (
                              <div key={i} className="flex-shrink-0 w-52 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 border border-blue-500/15 rounded-lg p-3 cursor-pointer hover:border-blue-500/30 transition-colors"
                                onClick={() => setSelectedOllamaModel(m)}>
                                <p className="text-xs font-medium text-text-primary truncate">{name}</p>
                                <p className="text-[10px] text-text-muted mt-0.5">{m.description?.slice(0, 60) || m.family || ''}</p>
                                <div className="flex items-center gap-2 mt-2">
                                  {recVariant && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">{recVariant.params || recVariant.tag} - {recVariant.vram}GB VRAM</span>}
                                  <button onClick={(e) => { e.stopPropagation(); handlePull(recVariant ? `${name}:${recVariant.tag}` : name); }}
                                    className="ml-auto text-[9px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30">
                                    Pull
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!ollamaOnline && (
                      <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2">
                        <WifiOff size={14} className="text-amber-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-amber-300 font-medium">Ollama is not running</p>
                          <p className="text-[10px] text-text-muted">You can browse the catalog, but start Ollama to pull/download models</p>
                        </div>
                      </div>
                    )}

                    {filteredOllamaModels.length === 0 && !ollamaLoading && (
                      <div className="flex flex-col items-center py-12 text-center">
                        <Search size={32} className="text-neutral-600 mb-3" />
                        <p className="text-text-muted text-sm">No models found</p>
                        <p className="text-xs text-neutral-600 mt-1">Try a different search or category</p>
                      </div>
                    )}

                    {filteredOllamaModels.map(model => (
                      <OllamaModelCard
                        key={model.id || model.name}
                        model={model}
                        hardware={hardware}
                        pullingModels={pullingModels}
                        onPull={handlePull}
                        onCompare={handleCompareToggle}
                        compareSet={compareSet}
                        installedModels={installedModels}
                        onSelect={setSelectedOllamaModel}
                      />
                    ))}
                  </>
                )}

                {/* HuggingFace models */}
                {!searchDebounced && discoverSource === 'huggingface' && (
                  <>
                    {/* HF Recommendations row */}
                    {hfRecommendations.length > 0 && !hfActiveCollection?.startsWith('__') && (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="p-1.5 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                            <Sparkles size={12} className="text-purple-400" />
                          </div>
                          <div>
                            <h3 className="text-xs font-semibold text-text-primary">Recommended GGUF for You</h3>
                            <p className="text-[9px] text-text-muted">Based on {Math.round((hardware?.gpu?.vram || 0) / 1024)}GB VRAM</p>
                          </div>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                          {hfRecommendations.slice(0, 6).map((rec, i) => (
                            <div key={i} className="flex-shrink-0 w-52 bg-gradient-to-br from-purple-500/5 to-pink-500/5 border border-purple-500/15 rounded-lg p-3 cursor-pointer hover:border-purple-500/30 transition-colors"
                              onClick={() => setSelectedHfModel(rec)}>
                              <p className="text-xs font-medium text-text-primary truncate">{rec.displayName || (rec.modelId || rec.id || '').split('/').pop()}</p>
                              <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{rec.description || rec.reason || ''}</p>
                              <div className="flex items-center gap-1 mt-2">
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">GGUF</span>
                                {rec.recommendedQuant && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">{rec.recommendedQuant}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Info banner */}
                    {hfActiveCollection && !hfActiveCollection.startsWith('__') && (
                      <div className="mb-3 p-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg">
                        <p className="text-xs text-purple-300 font-medium flex items-center gap-1.5">
                          <Package size={14} />
                          {hfCollections.find(c => c.id === hfActiveCollection)?.name || 'Collection'}
                        </p>
                        <p className="text-[10px] text-text-muted mt-0.5">
                          {hfCollections.find(c => c.id === hfActiveCollection)?.description || 
                           'GGUF models ready for local inference. Click any model to see available quantization options and download.'}
                        </p>
                      </div>
                    )}

                    {hfActiveCollection === '__trending' && (
                      <div className="mb-3 p-3 bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg">
                        <p className="text-xs text-orange-300 font-medium flex items-center gap-1.5">
                          <Flame size={14} /> Trending on HuggingFace
                        </p>
                        <p className="text-[10px] text-text-muted mt-0.5">Most popular GGUF models this week</p>
                      </div>
                    )}

                    {hfActiveCollection === '__recent' && (
                      <div className="mb-3 p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
                        <p className="text-xs text-cyan-300 font-medium flex items-center gap-1.5">
                          <Clock size={14} /> Recently Updated
                        </p>
                        <p className="text-[10px] text-text-muted mt-0.5">Latest GGUF model uploads and updates</p>
                      </div>
                    )}

                    {searchDebounced && hfSearchResults && (
                      <div className="mb-2 text-xs text-text-muted">
                        {hfSearchResults.length} GGUF models found for "{searchDebounced}"
                      </div>
                    )}

                    {hfLoading && (hfSearchResults || hfModels).length === 0 && (
                      <div className="flex items-center justify-center py-12">
                        <Loader className="animate-spin text-purple-400" size={24} />
                      </div>
                    )}

                    {!hfLoading && (hfSearchResults || hfModels).length === 0 && (
                      <div className="flex flex-col items-center py-12 text-center">
                        <Search size={32} className="text-neutral-600 mb-3" />
                        <p className="text-text-muted text-sm">
                          {searchDebounced ? 'No GGUF models found for this search' : 'Select a collection above or search for models'}
                        </p>
                        <p className="text-xs text-neutral-600 mt-1">
                          Try searching for "llama", "mistral", "codellama", or any model name
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(hfSearchResults || hfModels).map((model, i) => (
                        <HfModelCard
                          key={model.modelId || model.id || i}
                          model={model}
                          onSelect={setSelectedHfModel}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* DOWNLOADS TAB */}
          {activeTab === 'downloads' && (
            <div className="h-full flex flex-col">
              {/* Stats bar */}
              <div className="px-4 py-2 border-b border-neutral-800/50 flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-text-muted">
                  <span className="flex items-center gap-1">
                    <Download size={12} className="text-blue-400" />
                    {downloadStats.activeCount} active
                  </span>
                  {downloadStats.totalSpeed > 0 && (
                    <span className="flex items-center gap-1">
                      <Zap size={12} className="text-amber-400" />
                      {formatSpeed(downloadStats.totalSpeed)}
                    </span>
                  )}
                  {downloadStats.completedCount > 0 && (
                    <span className="flex items-center gap-1">
                      <CheckCircle size={12} className="text-green-400" />
                      {downloadStats.completedCount} completed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {downloadStats.completedCount > 0 && (
                    <button
                      onClick={handleClearCompleted}
                      className="text-[10px] text-text-muted hover:text-text-secondary px-2 py-1 rounded hover:bg-neutral-800"
                    >
                      Clear completed
                    </button>
                  )}
                  <button
                    onClick={loadDownloads}
                    className="p-1.5 text-text-muted hover:text-text-secondary rounded hover:bg-neutral-800"
                    title="Refresh"
                  >
                    <RefreshCw size={14} className={downloadsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {downloadsLoading && downloads.length === 0 && (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="animate-spin text-blue-400" size={24} />
                  </div>
                )}

                {!downloadsLoading && downloads.length === 0 && (
                  <div className="flex flex-col items-center py-12 text-center">
                    <Download size={32} className="text-neutral-600 mb-3" />
                    <p className="text-text-muted text-sm">No downloads</p>
                    <p className="text-xs text-neutral-600 mt-1">Pull models from the Discover tab to see them here</p>
                  </div>
                )}

                {/* Active + Queued */}
                {downloads.filter(d => ['downloading', 'active', 'paused', 'queued', 'pending'].includes(d.status)).map(job => (
                  <DownloadCard
                    key={job.id}
                    job={job}
                    onPause={(id) => handleDownloadAction('pause', id)}
                    onResume={(id) => handleDownloadAction('resume', id)}
                    onRetry={(id) => handleDownloadAction('retry', id)}
                    onCancel={(id) => handleDownloadAction('cancel', id)}
                    onDelete={(id) => handleDownloadAction('delete', id)}
                    onSetActive={handleSetActive}
                    onOpenFolder={handleOpenFolder}
                    onPriorityUp={(id) => handleDownloadPriority(id, 'up')}
                    onPriorityDown={(id) => handleDownloadPriority(id, 'down')}
                  />
                ))}

                {/* Failed */}
                {downloads.filter(d => d.status === 'failed' || d.status === 'error').length > 0 && (
                  <>
                    <p className="text-[10px] text-red-400 font-medium uppercase tracking-wide pt-2">Failed</p>
                    {downloads.filter(d => d.status === 'failed' || d.status === 'error').map(job => (
                      <DownloadCard
                        key={job.id}
                        job={job}
                        onRetry={(id) => handleDownloadAction('retry', id)}
                        onDelete={(id) => handleDownloadAction('delete', id)}
                        onOpenFolder={handleOpenFolder}
                      />
                    ))}
                  </>
                )}

                {/* Completed */}
                {downloads.filter(d => d.status === 'completed').length > 0 && (
                  <>
                    <p className="text-[10px] text-green-400 font-medium uppercase tracking-wide pt-2">Completed</p>
                    {downloads.filter(d => d.status === 'completed').map(job => (
                      <DownloadCard
                        key={job.id}
                        job={job}
                        onDelete={(id) => handleDownloadAction('delete', id)}
                        onSetActive={handleSetActive}
                        onOpenFolder={handleOpenFolder}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* LIBRARY TAB */}
          {activeTab === 'library' && (
            <div className="h-full flex flex-col">
              {/* Stats + Disk usage bar */}
              <div className="px-4 py-2 border-b border-neutral-800/50">
                {/* Model statistics dashboard */}
                {modelStats && (
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <BarChart3 size={11} className="text-blue-400" />
                      <span className="text-text-muted">{modelStats.totalModels || libraryModels.length} models</span>
                    </div>
                    {/* Format breakdown as colored segments */}
                    <div className="flex-1 flex items-center gap-1 h-2 rounded-full overflow-hidden bg-neutral-800">
                      {(modelStats.byFormat || [
                        { format: 'ollama', count: libraryModels.filter(m => m.format === 'ollama').length },
                        { format: 'gguf', count: libraryModels.filter(m => m.format === 'gguf').length },
                        { format: 'onnx', count: libraryModels.filter(m => m.format === 'onnx').length },
                      ]).filter(f => f.count > 0).map((f, i) => {
                        const total = modelStats?.totalModels || libraryModels.length || 1;
                        const colors = { ollama: 'bg-blue-500', gguf: 'bg-green-500', onnx: 'bg-amber-500', unknown: 'bg-neutral-500' };
                        return <div key={i} className={`h-full ${colors[f.format] || colors.unknown}`} style={{ width: `${(f.count / total) * 100}%` }} />;
                      })}
                    </div>
                    <div className="flex items-center gap-2 text-[9px]">
                      {[
                        { label: 'Ollama', color: 'bg-blue-500', count: modelStats?.byFormat?.find(f => f.format === 'ollama')?.count || libraryModels.filter(m => m.format === 'ollama').length },
                        { label: 'GGUF', color: 'bg-green-500', count: modelStats?.byFormat?.find(f => f.format === 'gguf')?.count || libraryModels.filter(m => m.format === 'gguf').length },
                        { label: 'ONNX', color: 'bg-amber-500', count: modelStats?.byFormat?.find(f => f.format === 'onnx')?.count || libraryModels.filter(m => m.format === 'onnx').length },
                      ].filter(s => s.count > 0).map(s => (
                        <span key={s.label} className="flex items-center gap-0.5 text-text-muted">
                          <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} /> {s.count} {s.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Disk usage */}
                {diskUsage && (
                  <>
                    <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                      <span className="flex items-center gap-1"><Database size={10} /> Disk Usage</span>
                      <span>
                        {diskUsage.used ? formatBytes(diskUsage.used) : '?'} used
                        {diskUsage.free ? ` / ${formatBytes(diskUsage.free)} free` : ''}
                      </span>
                    </div>
                    {diskUsage.used && diskUsage.total && (
                      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full" style={{ width: `${Math.min((diskUsage.used / diskUsage.total) * 100, 100)}%` }} />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Filter/Sort + Import + Settings */}
              <div className="px-4 py-2 border-b border-neutral-800/50 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {LIBRARY_FILTERS.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setLibraryFilter(f.id)}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        libraryFilter === f.id
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'text-text-muted hover:text-text-secondary hover:bg-neutral-800'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Import button with dropdown */}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowImportMenu(!showImportMenu); setShowLibrarySettings(false); }}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-blue-400 hover:bg-blue-500/10 rounded border border-blue-500/20 transition-colors"
                    >
                      <Download size={11} /> Import
                    </button>
                    {showImportMenu && (
                      <div className="absolute right-0 top-full mt-1 w-52 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-20 overflow-hidden">
                        <button onClick={() => { setShowImportMenu(false); handleScanSystem(); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-neutral-800 transition-colors text-left">
                          <Search size={13} className="text-blue-400" />
                          <div>
                            <p className="font-medium">Scan System</p>
                            <p className="text-[9px] text-text-muted">Find models in LM Studio, GPT4All, etc.</p>
                          </div>
                        </button>
                        <button onClick={() => { setShowImportMenu(false); handleBrowseFiles(); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-neutral-800 transition-colors text-left border-t border-neutral-800">
                          <FolderOpen size={13} className="text-green-400" />
                          <div>
                            <p className="font-medium">Browse Files</p>
                            <p className="text-[9px] text-text-muted">Select GGUF/ONNX files to import</p>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Settings gear */}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowLibrarySettings(!showLibrarySettings); setShowImportMenu(false); }}
                      className="p-1.5 text-text-muted hover:text-text-secondary rounded hover:bg-neutral-800"
                      title="Library settings"
                    >
                      <Settings size={14} />
                    </button>
                    {showLibrarySettings && (
                      <div className="absolute right-0 top-full mt-1 w-56 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-20 overflow-hidden">
                        <div className="px-3 py-2 border-b border-neutral-800">
                          <p className="text-[10px] text-text-muted">Models Directory</p>
                          <p className="text-[9px] text-neutral-500 truncate mt-0.5">{modelsDirectory || 'Default location'}</p>
                        </div>
                        <button onClick={() => { setShowLibrarySettings(false); handleChangeModelsDir(); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-neutral-800 transition-colors text-left">
                          <FolderOpen size={12} /> Change Directory
                        </button>
                        <button onClick={() => { setShowLibrarySettings(false); safeCall('openInExplorer', [modelsDirectory || ''], null); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-neutral-800 transition-colors text-left border-t border-neutral-800">
                          <ExternalLink size={12} /> Open in Explorer
                        </button>
                        <button onClick={() => { setShowLibrarySettings(false); handleClearCache(); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors text-left border-t border-neutral-800">
                          <Trash2 size={12} /> Clear Cache
                        </button>
                      </div>
                    )}
                  </div>
                  <select
                    value={librarySort}
                    onChange={(e) => setLibrarySort(e.target.value)}
                    className="bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-[10px] text-text-muted"
                  >
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                    <option value="favorites">Favorites</option>
                  </select>
                  <button
                    onClick={loadLibrary}
                    className="p-1.5 text-text-muted hover:text-text-secondary rounded hover:bg-neutral-800"
                    title="Refresh"
                  >
                    <RefreshCw size={14} className={libraryLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {/* Scanning status */}
                {scanning && (
                  <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg mb-3">
                    <Loader className="animate-spin text-blue-400" size={14} />
                    <p className="text-xs text-blue-300">Scanning system for models...</p>
                  </div>
                )}

                {/* Scan results */}
                {scanResults && scanResults.length > 0 && (
                  <div className="mb-3 bg-gradient-to-r from-green-500/5 to-blue-500/5 border border-green-500/20 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-medium text-green-400 flex items-center gap-1.5">
                        <Search size={12} /> Found {scanResults.length} models on your system
                      </h4>
                      <div className="flex gap-1.5">
                        <button onClick={() => handleImportSelected(scanResults.map(m => m.path).filter(Boolean))}
                          disabled={importing}
                          className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50">
                          {importing ? 'Importing...' : 'Import All'}
                        </button>
                        <button onClick={() => setScanResults(null)} className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-text-muted hover:text-text-secondary">
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {scanResults.map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                          <span className="text-text-secondary truncate flex-1">{m.name || m.path?.split(/[/\\]/).pop()}</span>
                          <span className="text-text-muted ml-2">{m.source || m.format || ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {scanResults && scanResults.length === 0 && (
                  <div className="mb-3 p-3 bg-neutral-900 border border-neutral-800 rounded-lg text-center">
                    <p className="text-xs text-text-muted">No additional models found on your system</p>
                    <button onClick={() => setScanResults(null)} className="text-[10px] text-blue-400 mt-1">Dismiss</button>
                  </div>
                )}

                {libraryLoading && libraryModels.length === 0 && (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="animate-spin text-blue-400" size={24} />
                  </div>
                )}

                {!libraryLoading && filteredLibrary.length === 0 && (
                  <div className="flex flex-col items-center py-12 text-center">
                    <HardDrive size={32} className="text-neutral-600 mb-3" />
                    <p className="text-text-muted text-sm">No models installed</p>
                    <p className="text-xs text-neutral-600 mt-1">Pull models from the Discover tab or use Import to add models</p>
                  </div>
                )}

                {filteredLibrary.map(model => (
                  <LibraryModelCard
                    key={model.name || model.id || model.path}
                    model={model}
                    currentModel={currentModel}
                    onSetActive={handleSetActive}
                    onDelete={handleDeleteModel}
                    onToggleFavorite={(id) => {
                      setFavorites(prev => {
                        const next = new Set(prev);
                        next.has(id) ? next.delete(id) : next.add(id);
                        return next;
                      });
                    }}
                    favorites={favorites}
                    expanded={expandedLibrary === (model.name || model.id)}
                    onToggleExpand={(id) => setExpandedLibrary(prev => prev === id ? null : id)}
                  />
                ))}

                {/* Active model indicator */}
                {currentModel && (
                  <div className="mt-4 p-3 bg-green-500/5 border border-green-500/20 rounded-lg text-xs text-green-400 flex items-center gap-2">
                    <CheckCircle size={14} />
                    Active model: <span className="font-medium">{currentModel}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COMPARE PANEL */}
          <AnimatePresence>
            {compareModels.length >= 2 && (
              <ComparePanel
                models={compareModels}
                hardware={hardware}
                onClose={() => setCompareModels([])}
                onRemove={(m) => handleCompareToggle(m)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Compare tray indicator */}
        {compareModels.length > 0 && compareModels.length < 2 && (
          <div className="px-4 py-2 border-t border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
            <span className="text-xs text-text-muted">
              <BarChart3 size={12} className="inline mr-1" />
              {compareModels.length}/2 models selected for comparison
            </span>
            <button
              onClick={() => setCompareModels([])}
              className="text-[10px] text-text-muted hover:text-red-400"
            >
              Clear
            </button>
          </div>
        )}
      </motion.div>

      {/* OLLAMA MODEL PROFILE MODAL */}
      <AnimatePresence>
        {selectedOllamaModel && (
          <OllamaProfileModal
            model={selectedOllamaModel}
            profile={MODEL_PROFILES[selectedOllamaModel.id || selectedOllamaModel.name]}
            hardware={hardware}
            pullingModels={pullingModels}
            installedModels={installedModels}
            onPull={handlePull}
            onClose={() => setSelectedOllamaModel(null)}
          />
        )}
      </AnimatePresence>

      {/* HF MODEL PROFILE MODAL */}
      <AnimatePresence>
        {selectedHfModel && (
          <HfProfileModal
            model={selectedHfModel}
            hardware={hardware}
            onClose={() => setSelectedHfModel(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HF PROFILE MODAL (inline for now, can extract later)
// ─────────────────────────────────────────────────────────────────────────────

function HfProfileModal({ model, hardware, onClose }) {
  const [details, setDetails] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('files');
  const [quantGuide, setQuantGuide] = useState(null);
  const [downloadingFile, setDownloadingFile] = useState(null);

  const modelId = model?.modelId || model?.id;
  const displayName = model?.displayName || modelId?.split('/')?.pop() || '';
  const author = model?.author || modelId?.split('/')?.[0] || '';
  const family = model?.family || model?.enriched?.family || '';
  const familyLower = family.toLowerCase();
  const params = model?.params || model?.enriched?.params || '';
  const description = model?.description || '';
  const downloads = model?.downloads || model?.downloadCount || model?.enriched?.downloadCount || 0;
  const vramGB = hardware?.gpu?.vram ? hardware.gpu.vram / 1024 : 0;

  useEffect(() => {
    if (!modelId) return;
    loadDetails();
  }, [modelId]);

  const loadDetails = async () => {
    setLoading(true);
    try {
      const [det, guide] = await Promise.all([
        safeCall('hfGetModelDetails', [modelId], null),
        safeCall('hfGetQuantizationGuide', [], null),
      ]);
      setDetails(det);
      // getModelDetails returns enriched data with ggufFiles already parsed
      const gguf = det?.ggufFiles || [];
      if (gguf.length > 0) {
        setFiles(gguf);
      } else {
        // Fallback: try separate files call
        const f = await safeCall('hfGetModelFiles', [modelId], []);
        setFiles(Array.isArray(f) ? f : []);
      }
      setQuantGuide(guide);
    } catch (err) {
      console.error('[ModelHub] HF detail error:', err);
    }
    setLoading(false);
  };

  const handleDownload = async (file) => {
    const downloadUrl = file.downloadUrl || file.url ||
      `https://huggingface.co/${modelId}/resolve/main/${file.filename || file.name || file.rfilename}`;

    setDownloadingFile(file.filename || file.name);
    try {
      await safeCall('downloadsCreate', [{
        url: downloadUrl,
        name: `${displayName} - ${file.filename || file.name || file.rfilename}`,
        fileName: file.filename || file.name || file.rfilename,
        destDir: null,
        source: 'huggingface',
        modelId,
      }], null);
    } catch {}
    setTimeout(() => setDownloadingFile(null), 1500);
  };

  // Sort files: recommended quants first, then by size
  const sortedFiles = useMemo(() => {
    const recommended = ['Q4_K_M', 'Q5_K_M', 'Q4_K_S', 'Q5_K_S', 'Q6_K'];
    return [...files].sort((a, b) => {
      const aRec = recommended.indexOf(a.quantization || '');
      const bRec = recommended.indexOf(b.quantization || '');
      if (aRec !== -1 && bRec === -1) return -1;
      if (aRec === -1 && bRec !== -1) return 1;
      if (aRec !== -1 && bRec !== -1) return aRec - bRec;
      return (a.sizeBytes || a.size || 0) - (b.sizeBytes || b.size || 0);
    });
  }, [files]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="w-full max-w-3xl max-h-[90vh] bg-neutral-950 rounded-xl shadow-2xl border border-neutral-800 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-6 pb-4 border-b border-neutral-800 bg-gradient-to-br from-purple-500/5 via-neutral-950 to-pink-500/5">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-neutral-800 text-text-muted hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
          <button onClick={onClose} className="absolute top-4 left-4 p-1.5 rounded-lg hover:bg-neutral-800 text-text-muted hover:text-text-primary transition-colors flex items-center gap-1 text-xs">
            <ArrowLeft size={14} /> Back
          </button>

          <div className="mt-6">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h2 className="text-xl font-bold text-text-primary">{displayName}</h2>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium">GGUF</span>
              {family && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${FAMILY_COLORS[familyLower] || 'bg-neutral-800 text-text-muted'}`}>
                  {family}
                </span>
              )}
              {params && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-text-muted font-mono">{params}</span>
              )}
            </div>
            {description && <p className="text-sm text-text-secondary leading-relaxed max-w-xl">{description}</p>}
            <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
              <span className="flex items-center gap-1"><Bot size={12} /> {author}</span>
              {downloads > 0 && <span className="flex items-center gap-1"><Download size={12} /> {downloads >= 1000000 ? `${(downloads/1000000).toFixed(1)}M` : downloads >= 1000 ? `${(downloads/1000).toFixed(0)}K` : downloads} downloads</span>}
              {details?.likes > 0 && <span className="flex items-center gap-1"><Heart size={12} /> {details.likes}</span>}
              {vramGB > 0 && <span className="flex items-center gap-1"><Cpu size={12} /> Your GPU: {Math.round(vramGB)}GB VRAM</span>}
              <a
                href={`https://huggingface.co/${modelId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 ml-auto"
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink size={12} /> HuggingFace
              </a>
            </div>
          </div>
        </div>

        {/* Section tabs */}
        <div className="px-4 py-2 border-b border-neutral-800/50 flex items-center gap-1">
          {[
            { id: 'files', label: `GGUF Files${files.length > 0 ? ` (${files.length})` : ''}`, icon: Layers },
            { id: 'readme', label: 'README', icon: BookOpen },
          ].map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
                activeSection === s.id ? 'bg-purple-500/20 text-purple-400 font-medium' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <s.icon size={12} /> {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader className="animate-spin text-purple-400 mb-3" size={24} />
              <p className="text-xs text-text-muted">Loading model details from HuggingFace...</p>
            </div>
          )}

          {!loading && activeSection === 'files' && (
            <div className="space-y-2">
              {/* Quantization guide - always show */}
              <div className="mb-4 p-3 bg-gradient-to-r from-blue-500/5 to-purple-500/5 border border-blue-500/15 rounded-lg">
                <p className="text-xs text-text-primary font-medium mb-1.5 flex items-center gap-1.5"><Lightbulb size={12} className="text-blue-400" /> Quantization Guide</p>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="text-text-muted">
                    <span className="text-amber-400 font-medium">Q4_K_M</span> - Best balance. Start here.
                  </div>
                  <div className="text-text-muted">
                    <span className="text-green-400 font-medium">Q5_K_M</span> - Higher quality, larger.
                  </div>
                  <div className="text-text-muted">
                    <span className="text-red-400 font-medium">Q8_0</span> - Near-perfect, very large.
                  </div>
                </div>
                <p className="text-[9px] text-text-muted mt-1.5">
                  Lower numbers = smaller file, faster, less accurate. Higher = larger, slower, more accurate.
                </p>
              </div>

              {sortedFiles.length === 0 && (
                <div className="flex flex-col items-center py-8 text-center">
                  <Package size={32} className="text-neutral-600 mb-3" />
                  <p className="text-sm text-text-muted">No GGUF files found</p>
                  <p className="text-xs text-neutral-600 mt-1">This model may not have GGUF quantizations available</p>
                </div>
              )}

              {sortedFiles.map((file, i) => {
                const sizeBytes = file.sizeBytes || file.size || 0;
                const sizeGB = file.sizeGB || (sizeBytes > 0 ? sizeBytes / (1024 * 1024 * 1024) : 0);
                const fitsGpu = vramGB > 0 ? sizeGB < vramGB * 0.85 : true;
                const quant = file.quantization || file.filename?.match(/(Q\d+_K_[A-Z]+|Q\d+_[A-Z]+|F16|F32)/i)?.[1] || '';
                const isRecommended = quant === 'Q4_K_M' || quant === 'Q4_K_S';
                const isDownloading = downloadingFile === (file.filename || file.name);
                const quantInfo = file.quantInfo;

                return (
                  <div key={i} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    isRecommended ? 'bg-blue-500/5 border-blue-500/20' :
                    !fitsGpu ? 'bg-red-500/5 border-red-500/15' :
                    'bg-neutral-900/60 border-neutral-800'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-text-primary font-mono truncate">{file.filename || file.name || file.rfilename}</p>
                        {isRecommended && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-semibold flex-shrink-0">RECOMMENDED</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 mt-1 text-[10px] text-text-muted flex-wrap">
                        {quant && (
                          <span className={`px-1.5 py-0.5 rounded font-medium ${
                            isRecommended ? 'bg-blue-500/15 text-blue-300' : 'bg-neutral-800 text-text-muted'
                          }`}>{quant}</span>
                        )}
                        {sizeGB > 0 && <span>{sizeGB.toFixed(1)}GB</span>}
                        {file.params && <span className="font-mono">{file.params}</span>}
                        {quantInfo?.description && <span className="text-neutral-500">- {quantInfo.description}</span>}
                        {vramGB > 0 && (
                          fitsGpu
                            ? <span className="text-green-400 flex items-center gap-0.5"><Check size={9} /> Fits GPU</span>
                            : <span className="text-red-400 flex items-center gap-0.5"><AlertTriangle size={9} /> Exceeds VRAM</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownload(file)}
                      disabled={isDownloading}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors flex-shrink-0 ml-3 font-medium ${
                        isDownloading
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30'
                      }`}
                    >
                      {isDownloading ? (
                        <><Check size={12} /> Queued</>
                      ) : (
                        <><Download size={12} /> Download</>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && activeSection === 'readme' && (
            <div className="prose prose-invert prose-sm max-w-none">
              {details?.readme ? (
                <div className="text-xs text-text-secondary whitespace-pre-wrap font-mono bg-neutral-900/60 p-4 rounded-lg border border-neutral-800 max-h-[60vh] overflow-y-auto leading-relaxed">
                  {details.readme}
                </div>
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  <BookOpen size={32} className="text-neutral-600 mb-3" />
                  <p className="text-sm text-text-muted">No README available</p>
                  <a
                    href={`https://huggingface.co/${modelId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 mt-1 flex items-center gap-1"
                  >
                    <ExternalLink size={10} /> View on HuggingFace
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ModelHubPanel;
