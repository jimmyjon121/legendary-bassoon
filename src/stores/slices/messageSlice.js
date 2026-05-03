// Message sending slice
// Handles the core sendMessage logic with streaming
// PHILOSOPHY: Give the AI EVERYTHING it needs. Use the full context window!

import { v4 as uuidv4 } from 'uuid';
import { api, isElectron, safeCall } from '../../utils/electronAPI';
import { useAdaptiveGeneration } from '../../services/adaptiveGeneration';
import { buildOptimizedOllamaOptionsWithInfo, parseModelName, MODEL_FAMILIES, isThinkingModel as detectThinkingModel } from '../../services/modelOptimizer';
import { useEditorStore } from '../editorStore';
import { buildFullContext } from '../../services/fullContextBuilder';
import { resolveChatProjectContext } from '../../services/chatProjectContext';
import { isVaultWorkspace } from '../../core/types';
import {
  WEB_SEARCH_TOOL_PROMPT,
  isWebSearchAvailable,
  processSearchCalls,
  hasSearchCalls,
  isDirectDateOrTimePrompt,
  buildSearchQueryFromPrompt,
  shouldForceWebSearch,
} from '../../services/webSearchTool';

function isSyntheticModelSelection(model = '') {
  return String(model || '').trim().toLowerCase().startsWith('npu:');
}

function formatModelLabel(model = '') {
  const raw = String(model || '').trim();
  if (!raw) return 'Model';
  if (isSyntheticModelSelection(raw)) {
    const target = raw.slice(4).trim();
    const parts = target.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || 'NPU model';
  }
  return raw.split(':')[0] || raw;
}

// Clean up response text: strip leaked prompt artifacts, conversation turn markers, etc.
function cleanupResponse(text) {
  if (!text) return text;
  let cleaned = text;
  
  // === 1. DETECT & STRIP PROMPT LEAK / META-REASONING ===
  // Some models dump their system prompt or reason about instructions instead of answering.
  // Patterns: "The user request...", "We need to produce a response following the instruction",
  //           "The instruction says", "I need to respond with", etc.
  cleaned = stripPromptLeak(cleaned);
  
  // === 2. TRIM CONVERSATION TURN MARKERS ===
  const turnPatterns = [
    /\n{1,3}Human:.*$/s,
    /\n{1,3}User:.*$/s,
    /\n{1,3}human:.*$/s,
    /\n{1,3}user:.*$/s,
    /\n{1,3}Assistant:$/,
    /<\|return\|>.*$/s,
    /<\|im_end\|>.*$/s,
    /<\|eot_id\|>.*$/s,
    /<\|end\|>.*$/s,
    /<\|start\|>user.*$/s,
  ];
  for (const pattern of turnPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // === 3. REMOVE LEADING ECHO ===
  cleaned = cleaned.replace(/^Assistant:\s*/i, '');
  
  return cleaned.trim();
}

/**
 * Detect and strip "prompt leak" / meta-reasoning from the response.
 * 
 * Many local models (especially quantized ones) break the fourth wall and
 * start reasoning about policies, instructions, or what the user wants
 * instead of actually responding. This function aggressively detects and
 * strips that meta-reasoning, keeping only the actual response.
 * 
 * Common patterns:
 *   "We have a user who says..." / "The user request..."
 *   "According to the policy, we should..."
 *   "We should respond with..." / "We can comply."
 *   "The instruction says: ..." / "We need to produce a response..."
 *   "There's no policy violation." / "We do not mention policies."
 */
function stripPromptLeak(text) {
  if (!text || text.length < 30) return text;
  
  // ── PHASE 1: Sentence-level scan ──
  // Split into sentences/lines and check each one.
  // If a line is meta-reasoning, remove it and everything after.
  // Keep everything BEFORE the first leak line as the actual response.
  
  const lines = text.split('\n');
  const leakLinePatterns = [
    // "We have a user who..." / "The user hasn't asked..." / "The user might want..."
    /^we have a user\b/i,
    /^the user (?:hasn't|hasn't|has not|didn't|did not|just|might|wants?|is asking|said|says|request)/i,
    // Policy / instruction reasoning
    /^according to (?:the |our )?polic/i,
    /^(?:the |our )?(?:policy|policies|instruction|guidelines?) (?:says?|tell|state|require|suggest|indicate)/i,
    /^there(?:'s| is) no policy (?:violation|conflict|issue)/i,
    /^we (?:should|can|must|need to|will|do not|don't|comply|are going|have to) (?:respond|mention|follow|do|produce|be|say|give|comply|not)/i,
    /^we (?:can |should |must |will )?comply/i,
    /^we do not mention/i,
    /^(?:so |thus |therefore |hence |now )?we (?:respond|can respond|should respond|will respond)/i,
    // "I need to..." reasoning
    /^(?:i |let me )(?:need to|should|must|will|can) (?:respond|produce|generate|create|think|reason|figure)/i,
    // Instruction meta-reasoning
    /^(?:the |our )?(?:system|initial) (?:prompt|instruction|message) (?:says|tells|asks)/i,
    /^(?:the )?instruction says/i,
    /^we need to produce a response/i,
    /^following the instruction/i,
    /^produce a (?:prompt|response) (?:in|with|following)/i,
    // "The user request" / "The user asked"
    /^the user request/i,
    // Generic meta patterns
    /^(?:we )?(?:also )?should be mindful/i,
    /^(?:we )?can say:/i,
    /^(?:we )?(?:also )?should (?:do|give|provide|make) a (?:friendly|short|brief|helpful|direct)/i,
    // Expert/role leaking
    /^you are an expert in/i,
  ];
  
  let firstLeakLineIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue; // skip blank lines
    
    for (const pattern of leakLinePatterns) {
      if (pattern.test(trimmed)) {
        firstLeakLineIndex = i;
        break;
      }
    }
    if (firstLeakLineIndex >= 0) break;
  }
  
  if (firstLeakLineIndex >= 0) {
    // Everything from the first leak line onward is reasoning -- strip it.
    const beforeLeak = lines.slice(0, firstLeakLineIndex).join('\n').trim();
    
    if (beforeLeak.length > 5) {
      // There was real content before the leak started. Keep it.
      return beforeLeak;
    }
    
    // The leak started right at the beginning or after only a trivial prefix.
    // Scan AFTER the leak for any actual answer the model might have produced.
    const afterLeakText = lines.slice(firstLeakLineIndex).join('\n');
    
    // Look for a final answer line that doesn't match leak patterns.
    // Often the model ends with "Thus we respond with a greeting." and
    // the ACTUAL greeting was the very first line.
    // In that case beforeLeak is empty and we should just return a fallback.
    
    // Try to find the actual answer embedded in the reasoning
    // e.g. 'We can say: "Hello! How can I help you today?"'
    const quotedAnswer = afterLeakText.match(/(?:We can (?:say|respond|reply):\s*"([^"]+)"|"([^"]{5,})")/i);
    if (quotedAnswer) {
      return (quotedAnswer[1] || quotedAnswer[2]).trim();
    }
    
    return '';
  }
  
  // ── PHASE 2: Full-text regex indicators (catch patterns that span lines) ──
  const fullTextLeakPatterns = [
    /We need to produce a response following the instruction/i,
    /The instruction says[:\s]/i,
    /following the instruction[:\s]/i,
    /produce a prompt (?:in|with) the following format/i,
    /The (?:system|initial) (?:prompt|instruction|message) (?:says|tells)/i,
    /You are an expert in generating prompts/i,
  ];
  
  for (const pattern of fullTextLeakPatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match.index > 30) {
        return text.slice(0, match.index).trim();
      }
      return '';
    }
  }
  
  return text;
}

/**
 * Detect prompt leak during streaming (lightweight check for real-time use).
 * Returns true if the model appears to be dumping meta-reasoning.
 */
function detectPromptLeak(text) {
  if (!text || text.length < 30) return false;
  
  const check = text.slice(0, 600).toLowerCase();
  
  const quickPatterns = [
    'we need to produce a response',
    'the instruction says',
    'following the instruction',
    'produce a prompt in the',
    'we need to respond',
    'the user request',
    'we must produce a',
    'the system prompt',
    'you are an expert in generating prompts',
    'i need to respond in the format',
    'we can interpret',
    'we need to interpret',
    // Policy-reasoning patterns from local-gpt-oss and similar models
    'we have a user who',
    'we have a user who says',
    'according to the policy',
    'according to our polic',
    'there\'s no policy violation',
    'there\'s no policy conflict',
    'there is no policy violation',
    'there is no policy conflict',
    'we should respond politely',
    'we should respond with a',
    'we should do a friendly',
    'we can comply',
    'we comply',
    'we do not mention polic',
    'we do not mention the polic',
    'we should be mindful of the polic',
    'the user might want a greeting',
    'the user hasn\'t asked',
    'the user didn\'t ask',
    'thus we respond with',
    'so we respond with',
  ];
  
  return quickPatterns.some(p => check.includes(p));
}

function detectDegenerateLoopText(text) {
  if (!text || text.length < 260) return false;

  const sample = text.slice(-700).toLowerCase();
  const words = sample.match(/[a-z']+/g) || [];
  if (words.length < 70) return false;

  const uniqueRatio = new Set(words).size / words.length;
  if (uniqueRatio < 0.26) return true;

  const lines = sample
    .split('\n')
    .map((line) => line.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 24);

  if (lines.length < 4) return false;

  const counts = new Map();
  for (const line of lines) {
    const key = line.slice(0, 90);
    counts.set(key, (counts.get(key) || 0) + 1);
    if ((counts.get(key) || 0) >= 3) {
      return true;
    }
  }

  return false;
}

// Get the actual context window size for a model (not the conservative default)
function getActualContextSize(modelName) {
  try {
    const parsed = parseModelName(modelName);
    if (parsed.family && MODEL_FAMILIES[parsed.family]) {
      return MODEL_FAMILIES[parsed.family].maxContext;
    }
  } catch (e) {}
  return 16384; // Reasonable default for unknown models
}

function isLikelyCodeRequest(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();
  const isGreetingOnly = /^(hi|hello|hey|yo|sup|how are you|good morning|good afternoon|good evening)[!.? ]*$/i.test(raw);
  if (isGreetingOnly) return false;

  const codeSignals = [
    /```/,
    /`[^`]+`/,
    /\b(error|exception|stack trace|traceback|bug|debug|refactor|compile|build|test|lint|runtime|syntax)\b/i,
    /\b(function|class|method|variable|array|object|sql|regex|api|endpoint|npm|yarn|pnpm|typescript|javascript|python|java|c\+\+|c#|rust|go|docker|kubernetes)\b/i,
    /\b(file|folder|module|import|export|component|hook|state|props|schema|migration)\b/i,
    /[{}()[\];]/,
  ];
  return codeSignals.some((pattern) => pattern.test(lower) || pattern.test(raw));
}

function isWorkspaceAwarenessQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  const signals = [
    'see the workspace',
    'see my workspace',
    'see the project',
    'see my project',
    'see my files',
    'access my files',
    'access the files',
    'working on',
    'what file',
    'current file',
    'open file',
    'open tab',
    'project structure',
    'do you see',
    'can you see',
    'do you have access',
    'can you access',
  ];
  return signals.some((s) => lower.includes(s));
}

function buildCodeWorkspaceContractPrompt(basePrompt, editorState, codeContextHints, projectContextMode) {
  const rootPath = codeContextHints?.rootPath || editorState?.rootPath || '';
  const activeFilePath = codeContextHints?.currentFile || editorState?.activeFilePath || '';
  const openFilesList = Array.isArray(codeContextHints?.openFilesList) && codeContextHints.openFilesList.length > 0
    ? codeContextHints.openFilesList
    : Object.keys(editorState?.openFiles || {});

  const activeFileName = activeFilePath ? activeFilePath.split(/[/\\]/).pop() : null;
  const projectName = rootPath ? rootPath.split(/[/\\]/).pop() : null;

  const contextModeLabel = projectContextMode === 'light'
    ? 'lightweight workspace context (paths/tree/open-tabs)'
    : 'full workspace context (including active file contents)';

  const contract = [
    '## IDE Context Contract',
    'You are operating inside DevForge Code workspace with IDE context attached.',
    `Context mode: ${contextModeLabel}.`,
    rootPath ? `Project root: ${rootPath}` : 'Project root: (not loaded yet)',
    activeFilePath ? `Active file path: ${activeFilePath}` : 'Active file path: (none)',
    activeFileName ? `Active file name: ${activeFileName}` : null,
    projectName ? `Project name: ${projectName}` : null,
    openFilesList.length > 0
      ? `Open files (${openFilesList.length}): ${openFilesList.map((p) => p.split(/[/\\]/).pop()).slice(0, 12).join(', ')}`
      : 'Open files: (none)',
    'Never claim you cannot access files/workspace when this context is present. Use this context directly.',
  ].filter(Boolean).join('\n');

  return `${basePrompt}\n\n${contract}`;
}

function isWorkspaceContextDenialResponse(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  const denialPatterns = [
    'i do not have physical presence',
    "i don't have physical presence",
    'i do not have access to your files',
    "i don't have access to your files",
    'i cannot access your files',
    "i can't access your files",
    'i cannot see your files',
    "i can't see your files",
    'please paste your code',
    'as an ai model developed by',
    'i do not have direct access to your workspace',
    "i don't have direct access to your workspace",
  ];
  return denialPatterns.some((pattern) => lower.includes(pattern));
}

function buildWorkspaceContextRecovery(editorState, codeContextHints) {
  const rootPath = codeContextHints?.rootPath || editorState?.rootPath || '';
  const activeFilePath = codeContextHints?.currentFile || editorState?.activeFilePath || '';
  const openFilesList = Array.isArray(codeContextHints?.openFilesList) && codeContextHints.openFilesList.length > 0
    ? codeContextHints.openFilesList
    : Object.keys(editorState?.openFiles || {});

  const projectName = rootPath ? rootPath.split(/[/\\]/).pop() : 'your project';
  const activeFileName = activeFilePath ? activeFilePath.split(/[/\\]/).pop() : null;

  const lines = [
    `I can see your DevForge workspace context for ${projectName}.`,
    activeFileName ? `Current active file: \`${activeFileName}\`.` : null,
    openFilesList.length > 0 ? `Open files visible: ${openFilesList.length}.` : null,
    'Ask me to inspect, refactor, debug, or explain this code and I will use the workspace context directly.',
  ].filter(Boolean);

  return lines.join(' ');
}

function normalizeChatMessages(messages = [], fallbackUserMessage = '') {
  const normalized = [];

  for (const msg of messages) {
    const role = msg?.role === 'assistant' ? 'assistant' : (msg?.role === 'user' ? 'user' : null);
    const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
    if (!role || !content) continue;

    const prev = normalized[normalized.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n\n${content}`;
    } else {
      normalized.push({ role, content });
    }
  }

  while (normalized.length > 0 && normalized[0].role === 'assistant') {
    normalized.shift();
  }

  const fallback = typeof fallbackUserMessage === 'string' ? fallbackUserMessage.trim() : '';
  if (fallback && (normalized.length === 0 || normalized[normalized.length - 1].role !== 'user')) {
    normalized.push({ role: 'user', content: fallback });
  }

  // If we have only user turns (common after cancelled generations), keep
  // just the latest user prompt to avoid confusing raw-template models.
  const hasAssistantTurn = normalized.some((msg) => msg.role === 'assistant');
  if (!hasAssistantTurn && normalized.length > 1) {
    const latestUser = [...normalized].reverse().find((msg) => msg.role === 'user');
    return latestUser ? [latestUser] : normalized;
  }

  return normalized;
}

function isSimpleGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const value = text.trim().toLowerCase();
  if (!value || value.length > 80) return false;
  return /^(hi|hello|hey|yo|sup)( there| again)?[!.? ]*$|^(how are you|good morning|good afternoon|good evening|what's up|whats up)[!.? ]*$/i
    .test(value);
}

function isShortCasualPrompt(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw || raw.length > 72) return false;

  if (/^(thanks|thank you|thx|ok|okay|cool|nice|great|sounds good|all good|appreciate it)[!.? ]*$/i.test(raw)) {
    return true;
  }

  return isSimpleGreeting(raw);
}

function isAcknowledgementPrompt(text) {
  if (!text || typeof text !== 'string') return false;
  return /^(thanks|thank you|thx|ok|okay|cool|nice|great|sounds good|all good|appreciate it)[!.? ]*$/i
    .test(text.trim());
}

function stripThinkBlocks(text) {
  const raw = String(text || '');
  if (!raw) return '';
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<think>[\s\S]*$/gi, ' ')
    .replace(/<\/think>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWebToolTranscript(content) {
  const text = String(content || '');
  if (!text) return '';

  const blocks = [];
  const patterns = [
    /\[Web Search Actions for "[^"]+"\][\s\S]*?\[End of Web Search Actions\]/gi,
    /\[Web Search Results for "[^"]+"\][\s\S]*?\[End of Search Results\]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      blocks.push({
        index: match.index,
        text: String(match[0] || '').trim(),
      });
    }
  }

  if (blocks.length === 0) return '';
  return blocks
    .sort((a, b) => a.index - b.index)
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function truncateWebFallbackText(value, maxLength = 180) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function buildClockFallbackAnswer(userPrompt = '') {
  const normalizedUserPrompt = String(userPrompt || '').trim();
  const asksTime = /\b(current time|what time|time is it|right now|now)\b/i.test(normalizedUserPrompt);
  const asksDate = /\b(today(?:'s)? date|current date|what(?:'s| is)\s+(?:the\s+)?date|what day is it)\b/i.test(normalizedUserPrompt);
  if (!asksDate && !asksTime) return '';

  const now = new Date();
  const localDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
  }).format(now);
  const localTime = new Intl.DateTimeFormat(undefined, {
    timeStyle: 'long',
  }).format(now);

  if (asksDate && asksTime) {
    return `Today is ${localDate}, and the current local time is ${localTime}.`;
  }
  if (asksDate) {
    return `Today is ${localDate}.`;
  }
  return `The current local time is ${localTime}.`;
}

function buildDeterministicWebFallbackAnswer({ userPrompt = '', searchResults = [] } = {}) {
  const parts = [];
  const clockAnswer = buildClockFallbackAnswer(userPrompt);
  if (clockAnswer) parts.push(clockAnswer);

  const primarySearch = Array.isArray(searchResults) && searchResults.length > 0 ? searchResults[0] : null;
  const results = Array.isArray(primarySearch?.results)
    ? primarySearch.results.filter((item) => item?.title && item?.url).slice(0, 4)
    : [];

  if (results.length > 0) {
    const isNewsPrompt = /\b(news|headline|headlines|updates?|happ\w*|develop\w*)\b/i.test(String(userPrompt || ''));
    const lines = [
      isNewsPrompt ? 'Latest relevant coverage:' : 'Relevant sources:',
      ...results.map((item, index) => {
        const title = truncateWebFallbackText(item?.title || 'Untitled result', 140);
        const snippet = truncateWebFallbackText(item?.snippet || '', 180);
        return `[${index + 1}] ${title}${snippet ? ` - ${snippet}` : ''}`;
      }),
      '',
      'Sources:',
      ...results.map((item, index) => `[${index + 1}] ${String(item?.url || '').trim()}`),
    ];
    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n').trim();
}

async function synthesizeWebSearchAnswer({
  model,
  systemPrompt,
  userPrompt,
  toolTranscript,
  synthesisContext,
  options = {},
}) {
  if (!isElectron() || typeof window?.electronAPI?.sendToLLM !== 'function') {
    return '';
  }

  const safeModel = String(model || '').trim();
  if (!safeModel) return '';

  const researchMaterial = [String(toolTranscript || '').trim(), String(synthesisContext || '').trim()]
    .filter(Boolean)
    .join('\n\n');
  if (!researchMaterial) return '';
  const now = new Date();
  const currentUtcIso = now.toISOString();
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const currentLocalDateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now);
  const normalizedUserPrompt = String(userPrompt || '').trim();
  const isRealtimeTimeQuery = /\b(current time|what time|time is it|right now|now)\b/i.test(normalizedUserPrompt);
  const isRealtimeDateQuery = /\b(today(?:'s)? date|current date|what(?:'s| is)\s+(?:the\s+)?date|what day is it)\b/i.test(normalizedUserPrompt);
  const isRealtimeNewsQuery = /\b(news|headline|headlines|updates?|happening|developments?)\b/i.test(normalizedUserPrompt);

  const synthesisSystemPrompt = [
    String(systemPrompt || '').trim(),
    'You are in FINAL ANSWER mode after web tool execution.',
    'Do not emit any tool calls like [SEARCH: ...] or JSON search payloads.',
    'Answer the user directly and cite supporting sources with [n] notation when relevant.',
    'Do not dump raw tool transcripts in the final answer body.',
    isRealtimeTimeQuery
      ? 'If the user asks for current time, compute from provided UTC timestamp and the target timezone. Do not copy stale snippet timestamps.'
      : '',
    isRealtimeDateQuery
      ? 'If the user asks for today\'s date, answer it directly from the provided clock context instead of inferring it from search snippets.'
      : '',
    isRealtimeNewsQuery
      ? 'If the user asks for news together with date or time, give the date/time first and then summarize the searched news.'
      : '',
  ].filter(Boolean).join('\n\n');

  const synthesisPrompt = [
    `User question: ${normalizedUserPrompt}`,
    `Current UTC timestamp: ${currentUtcIso}`,
    `Current local timezone: ${localTimeZone}`,
    `Current local date/time: ${currentLocalDateTime}`,
    '',
    'Web research material:',
    researchMaterial,
    '',
    'Now provide the final answer.',
    '- Start with the direct answer.',
    '- Keep it concise but complete.',
    '- If the user asked for today\'s date or the current time, state it directly before any news summary.',
    '- Cite searched sources using [1], [2], etc. when relevant.',
  ].join('\n');

  const baseTemperature = Number(options?.temperature);
  const basePredict = Number(options?.num_predict);
  const synthesisOptions = {
    ...options,
    temperature: Number.isFinite(baseTemperature)
      ? Math.min(Math.max(baseTemperature, 0.1), 0.5)
      : 0.3,
    num_predict: Number.isFinite(basePredict)
      ? Math.min(Math.max(basePredict, 192), 900)
      : 500,
  };

  try {
    const response = await window.electronAPI.sendToLLM({
      model: safeModel,
      messages: [{ role: 'user', content: synthesisPrompt }],
      system: synthesisSystemPrompt,
      options: synthesisOptions,
      lane: 'lane_interactive',
      workloadType: 'chat',
      allowFallback: true,
      priority: -10,
    });

    let content = String(response?.response || response?.message?.content || '').trim();
    if (!content) return '';
    if (hasSearchCalls(content)) {
      content = content.replace(/\[SEARCH:\s*[^\]]+\]/gi, '').trim();
    }
    content = content.replace(/<\|search_result\|>[\s\S]*?<\|end_search_result\|>/gi, '').trim();
    content = content
      .replace(/\[Web Search Actions for "[^"]+"\][\s\S]*?\[End of Web Search Actions\]\n*/gi, '')
      .replace(/\[Web Search Results for "[^"]+"\][\s\S]*?\[End of Search Results\]\n*/gi, '')
      .trim();
    return content;
  } catch (error) {
    console.warn('[WebSearch] Synthesis pass failed:', error);
    return '';
  }
}


export const createMessageSlice = (set, get) => ({
  // Image generation state
  generatedImages: [],
  imageGenSettings: {
    model: null,
    width: 1024,
    height: 1024,
    steps: 20,
    cfg: 7,
    sampler: 'euler_ancestral',
    negativePrompt: ''
  },
  
  // Follow-up suggestions shown after AI response
  suggestedFollowUps: [],
  
  // Context utilization tracking - shows how much of the model's context window is being used
  contextUtilization: {
    tokensUsed: 0,
    maxTokens: 0,
    utilizationPercent: 0,
    messagesIncluded: 0,
    totalMessages: 0,
    breakdown: [], // Array of {type, tokens, priority}
    lastUpdated: null,
  },
  lastUserSubmitGuard: {
    key: '',
    at: 0,
  },

  // Runtime visibility + stabilization state (per model)
  lastGenerationProfile: null,
  modelHealthByModel: {},
  stabilityModeByModel: {},
  runtimeNotice: null,
  recalibration: {
    running: false,
    model: null,
    startedAt: null,
    result: null,
    error: null,
  },
  guardrailMetrics: {
    casual: {
      totalEvents: 0,
      byReason: {},
      byType: {},
      lastEvent: null,
      recent: [],
    },
    coding: {
      totalEvents: 0,
      byReason: {},
      byType: {},
      lastEvent: null,
      recent: [],
    },
    research: {
      totalEvents: 0,
      byReason: {},
      byType: {},
      lastEvent: null,
      recent: [],
    },
  },

  dismissRuntimeNotice: () => set({ runtimeNotice: null }),

  recordGuardrailEvent: (event = {}) => {
    const scope = ['casual', 'coding', 'research'].includes(String(event.scope || '').toLowerCase())
      ? String(event.scope || '').toLowerCase()
      : 'casual';
    const reason = String(event.reason || 'unknown_reason').trim() || 'unknown_reason';
    const type = String(event.type || 'guardrail').trim() || 'guardrail';
    const model = String(event.model || '').trim() || null;
    const workspace = String(event.workspace || '').trim() || null;
    const now = new Date().toISOString();
    const entry = {
      id: `guardrail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      scope,
      type,
      reason,
      model,
      workspace,
      createdAt: now,
      ...((event.meta && typeof event.meta === 'object') ? { meta: event.meta } : {}),
    };

    set((state) => {
      const metrics = state.guardrailMetrics || {};
      const current = metrics[scope] || {
        totalEvents: 0,
        byReason: {},
        byType: {},
        lastEvent: null,
        recent: [],
      };

      return {
        guardrailMetrics: {
          ...metrics,
          [scope]: {
            totalEvents: Number(current.totalEvents || 0) + 1,
            byReason: {
              ...(current.byReason || {}),
              [reason]: Number(current.byReason?.[reason] || 0) + 1,
            },
            byType: {
              ...(current.byType || {}),
              [type]: Number(current.byType?.[type] || 0) + 1,
            },
            lastEvent: entry,
            recent: [entry, ...(current.recent || [])].slice(0, 60),
          },
        },
      };
    });
  },

  resetGuardrailMetrics: (scope = 'all') => {
    const normalized = String(scope || 'all').toLowerCase();
    const empty = {
      totalEvents: 0,
      byReason: {},
      byType: {},
      lastEvent: null,
      recent: [],
    };
    set((state) => {
      if (normalized === 'all') {
        return {
          guardrailMetrics: {
            casual: { ...empty },
            coding: { ...empty },
            research: { ...empty },
          },
        };
      }
      if (!['casual', 'coding', 'research'].includes(normalized)) return {};
      return {
        guardrailMetrics: {
          ...(state.guardrailMetrics || {}),
          [normalized]: { ...empty },
        },
      };
    });
  },

  setImageGenSettings: (settings) => set(state => ({
    imageGenSettings: { ...state.imageGenSettings, ...settings }
  })),

  recalibrateCurrentModel: async () => {
    const { currentModel } = get();
    if (!currentModel) {
      return { success: false, error: 'No model selected' };
    }
    if (!isElectron() || !window.electronAPI?.sendToLLM) {
      return { success: false, error: 'Recalibration requires Electron runtime' };
    }

    const startedAt = Date.now();
    set({
      recalibration: {
        running: true,
        model: currentModel,
        startedAt,
        result: null,
        error: null,
      },
      runtimeNotice: null,
    });

    const tests = [
      { id: 'greeting', prompt: 'hello' },
      { id: 'general', prompt: 'In one short sentence, what is binary search?' },
      { id: 'code', prompt: 'Write a tiny JavaScript function add(a, b) that returns the sum.' },
    ];

    const parsedModel = parseModelName(currentModel);
    const thinkingModel = detectThinkingModel(parsedModel?.family, currentModel, null);

    const probeOptions = {
      temperature: thinkingModel ? 0.4 : 0.2,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
      num_ctx: 4096,
      // Thinking models need more room to finish reasoning + final answer.
      num_predict: thinkingModel ? 420 : 180,
    };

    try {
      let failures = 0;
      const details = [];

      for (const test of tests) {
        const response = await window.electronAPI.sendToLLM({
          model: currentModel,
          messages: [{ role: 'user', content: test.prompt }],
          options: probeOptions,
        });

        const text = String(response?.response || response?.message?.content || '').trim();
        const textForChecks = thinkingModel ? stripThinkBlocks(text) : text;
        const hasThinkBlocks = /<think>/i.test(text) || /<\/think>/i.test(text);

        // Reuse runtime guardrails, but avoid prompt-leak false positives on reasoning models.
        const isLeak = thinkingModel ? false : detectPromptLeak(textForChecks);
        const isLoop = detectDegenerateLoopText(textForChecks);
        const tooLong = textForChecks.length > (thinkingModel ? 4200 : 2200);
        const empty = textForChecks.length < 2;
        const failed = isLeak || isLoop || tooLong || empty;

        if (failed) failures += 1;
        details.push({
          id: test.id,
          chars: text.length,
          charsChecked: textForChecks.length,
          thinking: hasThinkBlocks,
          failed,
          reasons: [isLeak && 'leak', isLoop && 'loop', tooLong && 'too_long', empty && 'empty'].filter(Boolean),
        });
      }

      const status = failures === 0 ? 'stable' : (failures === 1 ? 'warning' : 'unstable');
      const nowIso = new Date().toISOString();

      set((state) => ({
        modelHealthByModel: {
          ...state.modelHealthByModel,
          [currentModel]: {
            status,
            failures,
            total: tests.length,
            checkedAt: nowIso,
            source: 'recalibration',
            details,
          },
        },
        runtimeNotice: failures > 0
          ? {
              id: `runtime-${Date.now()}`,
              type: 'warning',
              model: currentModel,
              title: 'Model health check',
              message: `${formatModelLabel(currentModel)} failed ${failures}/${tests.length} probe checks.`,
              createdAt: nowIso,
            }
          : {
              id: `runtime-${Date.now()}`,
              type: 'success',
              model: currentModel,
              title: 'Model recalibrated',
              message: `${formatModelLabel(currentModel)} passed probe checks. Running in normal auto mode.`,
              createdAt: nowIso,
            },
        recalibration: {
          running: false,
          model: currentModel,
          startedAt: null,
          result: {
            status,
            failures,
            total: tests.length,
          },
          error: null,
        },
      }));

      return { success: true, status, failures, total: tests.length };
    } catch (error) {
      set({
        recalibration: {
          running: false,
          model: currentModel,
          startedAt: null,
          result: null,
          error: error.message,
        },
        runtimeNotice: {
          id: `runtime-${Date.now()}`,
          type: 'warning',
          model: currentModel,
          title: 'Recalibration failed',
          message: error.message || 'Failed to probe model stability',
          createdAt: new Date().toISOString(),
        },
      });
      return { success: false, error: error.message };
    }
  },

  /**
   * Regenerate the last assistant message.
   * Removes it from state/DB and re-sends the last user message.
   */
  regenerateLastResponse: async () => {
    const { messages, currentConversationId, isGenerating } = get();
    if (isGenerating || messages.length < 2) return;

    // Find the last assistant message and the user message before it
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx < 0) return;

    const lastAssistant = messages[lastAssistantIdx];
    // Find the user message that triggered this response
    let userMessage = null;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessage = messages[i];
        break;
      }
    }
    if (!userMessage) return;

    // Remove the assistant message from DB
    try {
      await api.data.messagesDelete({
        id: lastAssistant.id,
        conversationId: currentConversationId,
      });
    } catch (e) {
      console.error('Failed to delete assistant message for regeneration:', e);
    }

    // Remove it from state
    set(state => ({
      messages: state.messages.filter(m => m.id !== lastAssistant.id),
    }));

    // Re-send using the internal helper (skips adding user message since it exists)
    await get()._generateResponse(userMessage.content, currentConversationId);
  },

  /**
   * Edit a user message and regenerate from that point.
   * Removes all messages after the edited one, updates it, and regenerates.
   */
  editMessageAndRegenerate: async (messageId, newContent) => {
    const { messages, currentConversationId, isGenerating } = get();
    if (isGenerating || !newContent?.trim()) return;

    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex < 0) return;
    const msg = messages[msgIndex];
    if (msg.role !== 'user') return;

    // Delete all messages after this one from DB
    const messagesToDelete = messages.slice(msgIndex + 1);
    for (const m of messagesToDelete) {
      try {
        await api.data.messagesDelete({
          id: m.id,
          conversationId: currentConversationId,
        });
      } catch (e) {
        console.error('Failed to delete message during edit:', e);
      }
    }

    // Update the user message in DB
    try {
      await api.data.messagesUpdate({
        id: messageId,
        content: newContent.trim(),
        conversationId: currentConversationId,
      });
    } catch (e) {
      console.error('Failed to update edited message:', e);
    }

    // Update state: replace the message content and remove everything after
    const updatedMessages = messages.slice(0, msgIndex + 1);
    updatedMessages[msgIndex] = { ...msg, content: newContent.trim() };
    set({ messages: updatedMessages });

    // Regenerate from this point
    await get()._generateResponse(newContent.trim(), currentConversationId);
  },

  /**
   * Delete a single message.
   */
  deleteMessage: async (messageId) => {
    const { isGenerating } = get();
    if (isGenerating) return;

    try {
      await api.data.messagesDelete({ id: messageId });
    } catch (e) {
      console.error('Failed to delete message:', e);
    }

    set(state => ({
      messages: state.messages.filter(m => m.id !== messageId),
    }));
  },

  /**
   * Main send message entry point.
   */
  sendMessage: async (content, extra = {}) => {
    const state = get();
    let { currentConversationId, currentModel, currentWorkspace, workspaceSettings } = state;
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) return;
    content = normalizedContent;

    const availableModels = Array.isArray(state.availableModels) ? state.availableModels : [];
    const availableNames = new Set(availableModels.map((model) => String(model?.name || '').trim()).filter(Boolean));

    if (
      !currentModel
      || (
        !isSyntheticModelSelection(currentModel)
        && availableNames.size > 0
        && !availableNames.has(currentModel)
      )
    ) {
      try {
        const resolved = await state.resolveModelSelection?.(currentModel, { refresh: true });
        if (resolved?.modelName) {
          currentModel = resolved.modelName;
          if (currentModel !== state.currentModel) {
            await state.setModel?.(currentModel);
            currentModel = get().currentModel;
          }
        }
      } catch (resolveError) {
        console.warn('[sendMessage] Failed to resolve current model:', resolveError?.message || resolveError);
      }
    }

    if (!currentModel) {
      set({ error: 'No valid model selected' });
      return;
    }

    // Suppress accidental duplicate submit events (e.g. Enter + click firing together).
    const nowMs = Date.now();
    const guardWindowMs = 900;
    const dedupeConversationId = currentConversationId || 'new';
    const dedupeKey = `${dedupeConversationId}::${content.toLowerCase()}`;
    const lastGuard = state.lastUserSubmitGuard || { key: '', at: 0 };
    const guardAge = nowMs - Number(lastGuard.at || 0);
    if (lastGuard.key === dedupeKey && guardAge >= 0 && guardAge < guardWindowMs) {
      console.warn('[sendMessage] Duplicate user send suppressed');
      return;
    }
    const lastMessage = Array.isArray(state.messages) && state.messages.length > 0
      ? state.messages[state.messages.length - 1]
      : null;
    if (
      lastMessage?.role === 'user'
      && String(lastMessage.content || '').trim().toLowerCase() === content.toLowerCase()
      && lastMessage?.created_at
      && (nowMs - new Date(lastMessage.created_at).getTime()) < 1500
    ) {
      console.warn('[sendMessage] Duplicate adjacent user turn suppressed');
      return;
    }
    set({ lastUserSubmitGuard: { key: dedupeKey, at: nowMs } });
    
    // Create conversation if needed
    let conversationId = currentConversationId;
    if (!conversationId) {
      conversationId = await get().createConversation(content.substring(0, 50));
      if (!conversationId) return;
    }
    
    // Add user message
    const userMessageId = uuidv4();
    const isNsfw = isVaultWorkspace(currentWorkspace);
    const nsfwPassword = get().nsfwPassword;
    
    // Encrypt content if NSFW workspace
    let messageContent = content;
    if (isNsfw && nsfwPassword) {
      try {
        const encrypted = await window.electronAPI?.encrypt(content, nsfwPassword);
        messageContent = JSON.stringify(encrypted);
      } catch (error) {
        console.error('Failed to encrypt message:', error);
      }
    }
    
    const stateBefore = get();
    const branchId = stateBefore.currentBranchId || null;
    const parentMessage = stateBefore.messages.length > 0 ? stateBefore.messages[stateBefore.messages.length - 1] : null;
    const parentId = parentMessage ? parentMessage.id : null;
    const attachments = Array.isArray(extra.attachments) ? extra.attachments : [];

    const userMessage = {
      id: userMessageId,
      conversation_id: conversationId,
      role: 'user',
      content: isNsfw && nsfwPassword ? content : messageContent,
      created_at: new Date().toISOString(),
      branch_id: branchId,
      parent_message_id: parentId,
      attachments,
    };
    
    await api.data.messagesAppend({
      id: userMessageId,
      conversationId,
      role: 'user',
      content: messageContent,
      branchId,
      parentMessageId: parentId,
    });

    // Persist attachments
    if (attachments.length > 0 && isElectron()) {
      try {
        const encryptionPassword = isNsfw && nsfwPassword ? nsfwPassword : null;
        await api.data.attachmentsSave({
          messageId: userMessageId,
          files: attachments,
          password: encryptionPassword,
        });
      } catch (error) {
        console.error('Failed to save message attachments:', error);
      }
    }
    
    // Mark conversation as encrypted if NSFW
    if (isNsfw) {
      await api.data.conversationsUpdateMeta({
        id: conversationId,
        encrypted: true,
      });
    }
    
    set(state => ({ 
      messages: [...state.messages, userMessage],
      isGenerating: true,
      streamingContent: '',
      ragContext: [],
      suggestedFollowUps: [],
      generationMetadata: {
        stage: 'preparing',
        startedAt: Date.now(),
        chars: 0,
        tokensEstimated: 0,
        tokensPerSecond: 0,
      }
    }));
    
    // Record to ledger
    safeCall('ledger:recordMessage', [{
      role: 'user',
      workspace: currentWorkspace,
      model: currentModel,
      length: content.length,
      hasAttachments: attachments.length > 0,
      conversationId,
      messageId: userMessageId,
    }], null).catch(() => {});

    // Handle speculative response
    const speculativeResponse = extra.speculativeResponse;
    if (speculativeResponse) {
      const assistantMessageId = uuidv4();
      const bId = get().currentBranchId || null;
      const prev = get().messages[get().messages.length - 1];
      const pId = prev ? prev.id : null;

      let specContent = speculativeResponse;
      if (isNsfw && nsfwPassword) {
        try {
          const encrypted = await window.electronAPI?.encrypt(speculativeResponse, nsfwPassword);
          specContent = JSON.stringify(encrypted);
        } catch (error) {
          console.error('Failed to encrypt speculative response:', error);
        }
      }

      await api.data.messagesAppend({
        id: assistantMessageId,
        conversationId,
        role: 'assistant',
        content: specContent,
        model: currentModel,
        branchId: bId,
        parentMessageId: pId,
      });

      const assistantMessage = {
        id: assistantMessageId,
        conversation_id: conversationId,
        role: 'assistant',
        content: speculativeResponse,
        model: currentModel,
        created_at: new Date().toISOString(),
        branch_id: bId,
        parent_message_id: pId,
        meta: { speculative: true },
      };

      set(state => ({
        messages: [...state.messages, assistantMessage],
        isGenerating: false,
        generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
      }));

      await api.data.conversationsUpdateMeta({ id: conversationId });

      return;
    }
    
    const ws = get().currentWorkspace;
    const allowWebSearch = (ws === 'research' || ws === 'casual' || ws === 'work')
      ? Boolean(extra.webSearchEnabled)
      : false;
    await get()._generateResponse(content, conversationId, {
      webSearchEnabled: allowWebSearch,
      codeContext: extra.codeContext || null,
    });
  },

  /**
   * Internal: generate an assistant response for the current conversation.
   * Used by sendMessage, regenerateLastResponse, and editMessageAndRegenerate.
   */
  _generateResponse: async (userContent, conversationId, genOptions = {}) => {
    const stateAtStart = get();
    let { currentModel, currentWorkspace, workspaceSettings } = stateAtStart;

    const availableModels = Array.isArray(stateAtStart.availableModels) ? stateAtStart.availableModels : [];
    const availableNames = new Set(availableModels.map((model) => String(model?.name || '').trim()).filter(Boolean));

    if (
      !currentModel
      || (
        !isSyntheticModelSelection(currentModel)
        && availableNames.size > 0
        && !availableNames.has(currentModel)
      )
    ) {
      try {
        const resolved = await stateAtStart.resolveModelSelection?.(currentModel, { refresh: true });
        if (resolved?.modelName) {
          currentModel = resolved.modelName;
          if (currentModel !== stateAtStart.currentModel) {
            await stateAtStart.setModel?.(currentModel);
            currentModel = get().currentModel || currentModel;
          }
        }
      } catch (resolveError) {
        console.warn('[_generateResponse] Failed to resolve model:', resolveError?.message || resolveError);
      }
    }

    if (!currentModel) {
      set({
        isGenerating: false,
        streamingContent: '',
        currentStreamChannel: null,
        error: 'No valid model selected',
        generationMetadata: {
          stage: 'idle',
          startedAt: null,
          chars: 0,
          tokensEstimated: 0,
          tokensPerSecond: 0,
        },
      });
      return;
    }

    const isNsfw = isVaultWorkspace(currentWorkspace);
    const nsfwPassword = get().nsfwPassword;
    
    // Real model metadata from /api/show (populated on model switch in modelSlice)
    const currentModelInfo = get().currentModelInfo || null;

    // Ensure we're in generating state
    if (!get().isGenerating) {
      set({
        isGenerating: true,
        streamingContent: '',
        generationMetadata: {
          stage: 'preparing',
          startedAt: Date.now(),
          chars: 0, tokensEstimated: 0, tokensPerSecond: 0,
        }
      });
    }

    // === BUILD SYSTEM PROMPT ===
    // FIX: Read messages AFTER the user message was added to state (avoids stale data)
    const messages = get().messages;

    let systemPrompt = workspaceSettings[currentWorkspace]?.systemPrompt || '';
    const userAskedForCode = isLikelyCodeRequest(userContent);
    const userAskedForWorkspaceContext = isWorkspaceAwarenessQuery(userContent);
    const userWantsExpandedContext =
      userAskedForCode ||
      userAskedForWorkspaceContext ||
      /\?/.test(String(userContent || '')) ||
      String(userContent || '').trim().length >= 90;
    const allowContextAugmentation = currentWorkspace !== 'casual' || userWantsExpandedContext;
    const codeContextHints = genOptions.codeContext || null;
    const editorStateSnapshot = currentWorkspace === 'code' ? useEditorStore.getState() : null;
    const hasLoadedProject = currentWorkspace === 'code'
      ? Boolean(editorStateSnapshot?.rootPath || codeContextHints?.rootPath)
      : false;
    const shouldInjectProjectContext = currentWorkspace === 'code' ? hasLoadedProject : false;
    const projectContextMode = currentWorkspace === 'code'
      ? (userAskedForCode || userAskedForWorkspaceContext ? 'full' : 'light')
      : 'off';
    const guardrailScope = currentWorkspace === 'code'
      ? 'coding'
      : currentWorkspace === 'research'
        ? 'research'
        : 'casual';
    const guardrailReasonCodes = new Set();
    const recordGuardrailReason = (reason, type = 'guardrail', meta = {}) => {
      const reasonCode = String(reason || '').trim();
      if (!reasonCode) return;
      guardrailReasonCodes.add(reasonCode);
      get().recordGuardrailEvent?.({
        scope: guardrailScope,
        workspace: currentWorkspace,
        model: currentModel,
        type,
        reason: reasonCode,
        meta,
      });
    };

    if (currentWorkspace === 'code') {
      systemPrompt = buildCodeWorkspaceContractPrompt(
        systemPrompt,
        editorStateSnapshot,
        codeContextHints,
        projectContextMode
      );
    }

    const promotedContextTarget = currentWorkspace === 'code'
      ? 'code'
      : currentWorkspace === 'casual'
        ? 'casual'
        : null;
    if (allowContextAugmentation && promotedContextTarget && typeof get().listPromotedResearchContext === 'function') {
      const promotedEntries = get().listPromotedResearchContext(promotedContextTarget).slice(0, 4);
      if (promotedEntries.length > 0) {
        const contextLines = promotedEntries.map((entry, idx) => {
          const title = String(entry?.title || `Context ${idx + 1}`).trim();
          const summary = String(entry?.summary || '').trim();
          const citations = Array.isArray(entry?.citations) ? entry.citations.filter(Boolean).slice(0, 5) : [];
          return [
            `${idx + 1}. ${title}`,
            summary ? `Summary: ${summary}` : '',
            citations.length > 0 ? `Citations: ${citations.join(', ')}` : '',
          ].filter(Boolean).join('\n');
        }).join('\n\n');
        if (contextLines) {
          systemPrompt += `\n\n## Promoted Research Context (${promotedContextTarget})\n${contextLines}\nUse this context as user-approved prior research with provenance.`;
        }
      }
    }

    let chatProjectContext = null;
    if (allowContextAugmentation && !isVaultWorkspace(currentWorkspace) && get().activeProjectId) {
      chatProjectContext = await resolveChatProjectContext({
        workspace: currentWorkspace,
        activeProjectId: get().activeProjectId,
        currentConversationId: conversationId,
        prompt: userContent,
      });
    }
    // NOTE: Soul personalization overlay intentionally disabled.
    // We want a "raw model" conversation (plus useful context like memory/RAG/project),
    // without any personality injection.
    
    const canUseWebSearch = (currentWorkspace === 'research' || currentWorkspace === 'casual' || currentWorkspace === 'work')
      && Boolean(genOptions.webSearchEnabled)
      && isWebSearchAvailable();

    if (canUseWebSearch) {
      const now = new Date();
      const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
      const currentLocalDateTime = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
      systemPrompt = [
        systemPrompt,
        WEB_SEARCH_TOOL_PROMPT,
        '## Current Clock Context',
        `Current UTC timestamp: ${now.toISOString()}`,
        `Current local timezone: ${localTimeZone}`,
        `Current local date/time: ${currentLocalDateTime}`,
      ].filter(Boolean).join('\n\n');
    }

    // === FULL CONTEXT BUILDING ===
    // Use the model's ACTUAL context window, not a conservative default
    // Prefer real metadata from /api/show when available
    const actualContextSize = currentModelInfo?.contextLength || getActualContextSize(currentModel);
    let chatMessages = []; // Structured messages for /api/chat
    let messagesIncluded = 0;
    
    // Try full context builder first (includes memories, soul, project, RAG, etc.)
    if (isElectron() && allowContextAugmentation) {
      try {
        const editorState = currentWorkspace === 'code' && shouldInjectProjectContext
          ? (editorStateSnapshot || useEditorStore.getState())
          : null;

        const mergedProjectContext = editorState ? {
          rootPath: codeContextHints?.rootPath || editorState.rootPath,
          activeFilePath: codeContextHints?.currentFile || editorState.activeFilePath,
          openFiles: editorState.openFiles,
          files: editorState.files,
          projectAnalysis: editorState.projectContext,
          openFilesList: Array.isArray(codeContextHints?.openFilesList)
            ? codeContextHints.openFilesList
            : Object.keys(editorState.openFiles || {}),
        } : null;

        const fullContext = await buildFullContext({
          modelName: currentModel,
          workspace: currentWorkspace,
          conversationId,
          messages,
          systemPromptBase: systemPrompt,
          projectContext: mergedProjectContext,
          projectContextMode,
          chatProjectContext,
          ragQuery: userContent,
          // Pass real context length from /api/show so we don't have to guess
          modelContextLength: currentModelInfo?.contextLength || null,
        });
        
        if (fullContext) {
          systemPrompt = fullContext.systemPrompt;
          chatMessages = fullContext.chatMessages || [];
          messagesIncluded = fullContext.messagesIncluded;
          
          // Update context utilization state for UI display
          set({
            contextUtilization: {
              tokensUsed: fullContext.totalTokensUsed,
              maxTokens: fullContext.maxContextTokens,
              utilizationPercent: fullContext.utilizationPercent,
              messagesIncluded: fullContext.messagesIncluded,
              totalMessages: messages.length,
              breakdown: fullContext.breakdown || [],
              lastUpdated: new Date().toISOString(),
            }
          });
          
        }
      } catch (error) {
        console.warn('[Context] Full context builder failed, using fallback:', error);
      }
    }
    
    // Fallback: build messages array directly from conversation history
    if (chatMessages.length === 0) {
      // Memory engine for smart context
      if (allowContextAugmentation && isElectron() && messages.length > 15) {
        try {
          const memoryContext = await safeCall('memoryBuildContext', [{
            conversationId,
            workspace: currentWorkspace,
            messages,
            options: {
              maxTokens: actualContextSize * 0.6,
              includeMemories: true,
              includeSummary: true,
              includePinned: true,
            }
          }], null);

          if (memoryContext?.contextText) {
            // Memory context is text — enrich system prompt with it
            systemPrompt += '\n\n' + memoryContext.contextText;
          }
        } catch (error) {
          console.warn('[Memory] Failed to build smart context, falling back:', error);
        }
      }
      
      // Build messages array from recent conversation.
      const maxMessages = Math.min(messages.length, Math.floor(actualContextSize * 0.5 / 500));
      const recentMessages = messages.slice(-maxMessages);
      
      chatMessages = recentMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));
      messagesIncluded = recentMessages.length;

      // Fallback: inject minimal code context even if fullContextBuilder failed
      if (currentWorkspace === 'code' && shouldInjectProjectContext) {
        try {
          const editorState = editorStateSnapshot || useEditorStore.getState();
          const rootPath = codeContextHints?.rootPath || editorState?.rootPath || '';
          const activeFilePath = codeContextHints?.currentFile || editorState?.activeFilePath || '';
          const openFilesList = Array.isArray(codeContextHints?.openFilesList)
            ? codeContextHints.openFilesList
            : Object.keys(editorState?.openFiles || {});

          if (projectContextMode === 'full' && activeFilePath && editorState.openFiles[activeFilePath]) {
            const fileContent = editorState.openFiles[activeFilePath].content || '';
            const lines = fileContent.split('\n');
            const truncated = lines.length > 300
              ? lines.slice(0, 200).join('\n') + `\n// ... ${lines.length - 200} more lines ...`
              : fileContent;
            systemPrompt += `\n\n## Active File: ${activeFilePath}\n\`\`\`\n${truncated}\n\`\`\``;
          } else {
            const lightSummary = [
              '## Workspace Snapshot',
              rootPath ? `Project root: ${rootPath}` : 'Project root: (not loaded)',
              activeFilePath ? `Active file: ${activeFilePath}` : 'Active file: (none)',
              openFilesList.length > 0 ? `Open files (${openFilesList.length}): ${openFilesList.slice(0, 12).join(', ')}` : 'Open files: (none)',
            ].join('\n');
            systemPrompt += `\n\n${lightSummary}`;
          }
        } catch (_) { /* ignore */ }
      }

      if (chatProjectContext?.systemPromptBlock && !systemPrompt.includes('## Active Chat Project')) {
        systemPrompt += `\n\n${chatProjectContext.systemPromptBlock}`;
      }
    }

    // Normalize role alternation and trim malformed turns (common after cancelled streams).
    chatMessages = normalizeChatMessages(chatMessages, userContent);
    messagesIncluded = chatMessages.length;
    
    // Periodically update conversation summary and extract memories
    if (isElectron() && messages.length > 0 && messages.length % 15 === 0) {
      safeCall('memoryUpdateSummary', [{ conversationId, messages, workspace: currentWorkspace }], null).catch(() => {});
      safeCall('memoryExtractMemories', [{ conversationId, messages, workspace: currentWorkspace }], null).catch(() => {});
    }
    
    // ── BUILD OPTIONS: 4-layer merge ──
    // Priority: Model optimizer (model knowledge) → Auto-tuner (hardware vs model fit)
    //           → Adaptive (live pressure) → User presets (explicit overrides)
    const workspaceType = currentWorkspace === 'code' ? 'code' : 
                          currentWorkspace === 'creative' ? 'creative' : 'casual';
    
    // Layer 1: Model optimizer with real metadata from /api/show
    // If we have real model info from Ollama, use it; otherwise name-parsing fallback
    let options = buildOptimizedOllamaOptionsWithInfo(currentModel, workspaceType, currentModelInfo);
    
    // Use the actual model context size, but don't exceed what the optimizer determined
    options.num_ctx = Math.min(actualContextSize, options.num_ctx);
    
    // Preserve source metadata for debugging (will be stripped before sending)
    const modelSource = options._source;
    const modelDetected = options._detected;
    
    // Layer 2: Auto-tuner results (hardware vs model fit — context, batch, GPU layers, KV cache)
    const autoTuneResult = get().autoTuneResult || null;
    if (autoTuneResult) {
      // Context: use auto-tuner's recommended context if it's more constrained
      // (auto-tuner knows the hardware's actual VRAM capacity for this specific model)
      if (autoTuneResult.contextLength && autoTuneResult.contextLength > 0) {
        options.num_ctx = Math.min(options.num_ctx, autoTuneResult.contextLength);
      }
      
      // Batch size: auto-tuner's recommendation (hardware-aware)
      if (autoTuneResult.batchSize && autoTuneResult.batchSize > 0) {
        options.num_batch = autoTuneResult.batchSize;
      }
      
      // GPU layers: prefer numeric tuner outputs, but keep legacy string
      // compatibility while older auto-tuner payloads are still around.
      if (typeof autoTuneResult.gpuLayers === 'number') {
        options.num_gpu = autoTuneResult.gpuLayers;
      } else if (typeof autoTuneResult.gpuLayers === 'string') {
        const gpuMode = autoTuneResult.gpuLayers.toLowerCase();
        if (gpuMode === 'all' || gpuMode === 'most') {
          options.num_gpu = -1;
        } else if (gpuMode === 'partial') {
          options.num_gpu = 15;
        }
      }
      // The orchestrator may still promote Ollama requests to full GPU offload
      // on Electron-managed paths to avoid accidental CPU execution.
      
      // KV cache precision: q8_0 or q4_0 to fit larger contexts in VRAM
      if (autoTuneResult.kvCachePrecision) {
        options.kv_cache_type = autoTuneResult.kvCachePrecision;
      }
      
      // Flash attention: always enable if auto-tuner says so
      if (autoTuneResult.flashAttention) {
        options.flash_attn = true;
      }
      
      console.log(`[Options] Auto-tuner applied:`, {
        ctx: options.num_ctx, batch: options.num_batch, 
        gpu: options.num_gpu, kv: options.kv_cache_type,
      });
    }
    
    // Layer 3: Adaptive hardware-based adjustments (live GPU/NPU pressure)
    try {
      const adaptiveOptions = await useAdaptiveGeneration.getState().buildOllamaOptions();
      
      // Context: use the SMALLER of current and hardware-available
      if (adaptiveOptions.num_ctx) {
        options.num_ctx = Math.min(options.num_ctx, adaptiveOptions.num_ctx);
      }
      
      // Batch size: use the larger (model optimizer is conservative, adaptive knows hardware)
      options.num_batch = Math.max(adaptiveOptions.num_batch || options.num_batch, options.num_batch);
      
      // GPU layers: always use -1 (all) if adaptive says so and model didn't restrict it
      if (adaptiveOptions.num_gpu === -1) {
        options.num_gpu = -1;
      }
      
      // Threads: always use adaptive (it knows the actual CPU)
      if (adaptiveOptions.num_thread) {
        options.num_thread = adaptiveOptions.num_thread;
      }
      
      // Flash attention: dramatically faster inference for long contexts
      if (adaptiveOptions.flash_attn) {
        options.flash_attn = true;
      }
      // KV cache quantization: allows fitting much larger contexts in VRAM
      if (adaptiveOptions.kv_cache_type) {
        options.kv_cache_type = adaptiveOptions.kv_cache_type;
      }
      // Num predict: use adaptive if set
      if (adaptiveOptions.num_predict && !options.num_predict) {
        options.num_predict = adaptiveOptions.num_predict;
      }
    } catch (error) {
      console.warn('Failed to get adaptive options:', error);
    }
    
    // Apply user presets
    if (isElectron() && currentModel) {
      try {
        const presets = await safeCall('getModelPresets', [currentModel, currentWorkspace], []);
        const activePreset = presets?.find(p => p.is_default) || presets?.[0];
        if (activePreset) {
          options = {
            ...options,
            temperature: typeof activePreset.temperature === 'number' ? activePreset.temperature : options.temperature,
            top_p: typeof activePreset.top_p === 'number' ? activePreset.top_p : options.top_p,
            top_k: typeof activePreset.top_k === 'number' ? activePreset.top_k : options.top_k,
            num_ctx: activePreset.context_length || options.num_ctx,
          };
        }
      } catch (error) {
        console.error('Failed to load model preset:', error);
      }
    }
    
    // === VISION SUPPORT ===
    // If the latest user message has image attachments, convert them to base64 for vision models
    let visionImages = null;
    const latestMessages = get().messages;
    const latestUserMsg = latestMessages.length > 0 ? latestMessages[latestMessages.length - 1] : null;
    if (latestUserMsg?.role === 'user' && latestUserMsg?.attachments?.length > 0) {
      const imageAttachments = latestUserMsg.attachments.filter(a => 
        a.kind === 'image' || (a.mimeType && a.mimeType.startsWith('image/'))
      );
      if (imageAttachments.length > 0 && isElectron()) {
        try {
          const base64Images = [];
          for (const img of imageAttachments) {
            if (img.originalPath) {
              // Read as base64 via typed attachment API (supports encrypted private files).
              const result = await api.data.attachmentsRead({
                filePath: img.originalPath,
                password: isNsfw && nsfwPassword ? nsfwPassword : null,
                encoding: 'base64',
              });
              const b64 = result?.success ? result.data : null;
              if (b64) {
                base64Images.push(b64);
              }
            }
          }
          if (base64Images.length > 0) {
            visionImages = base64Images;
            console.log(`[Vision] Prepared ${base64Images.length} image(s) for multimodal analysis`);
          }
        } catch (error) {
          console.warn('[Vision] Failed to prepare images:', error);
        }
      }
    }

    // === THINKING MODEL DETECTION ===
    // Thinking models (DeepSeek-R1, QwQ, etc.) emit reasoning in <think> tags.
    // We must NOT apply prompt-leak detection to their output, because their
    // chain-of-thought looks exactly like "meta-reasoning" to our detectors.
    const _isThinkingModel = options._isThinkingModel || false;
    if (_isThinkingModel) {
      console.log(`[LLM] Thinking model detected — disabling prompt-leak detection, enabling <think> tag parsing`);
    }
    
    // === STREAM RESPONSE ===
    let fullResponse = '';
    const channel = `llm:stream:${Date.now()}`;
    set({ currentStreamChannel: channel });
    
    if (!isElectron() || !window.electronAPI?.streamFromLLM) {
      set({
        isGenerating: false,
        error: 'LLM streaming not available. Please ensure the app is running in Electron.',
      });
      return;
    }
    
    // Throttle state for UI updates (100ms batching for performance)
    let lastUiUpdate = 0;
    const UI_UPDATE_INTERVAL = 100;
    
    // === REPETITION LOOP DETECTION ===
    // Track recent output to detect when the model gets stuck in a loop
    const REPETITION_WINDOW = 200; // chars to check
    const REPETITION_THRESHOLD = 0.7; // 70% similarity = loop detected
    let loopDetected = false;
    
    const detectRepetitionLoop = (text) => {
      if (text.length < REPETITION_WINDOW * 2) return false;
      const recent = text.slice(-REPETITION_WINDOW);
      const previous = text.slice(-REPETITION_WINDOW * 2, -REPETITION_WINDOW);
      if (recent === previous) return true; // Exact repeat
      // Check for high similarity (shared character sequences)
      let matches = 0;
      for (let i = 0; i < recent.length; i++) {
        if (recent[i] === previous[i]) matches++;
      }
      return (matches / recent.length) > REPETITION_THRESHOLD;
    };

    const detectDegenerateLoop = (text) => detectDegenerateLoopText(text);
    
    // Also detect if model starts generating conversation turns
    const detectLeakedTurns = (text) => {
      const turnPatterns = [
        '\nHuman:',
        '\nUser:',
        '\n\nHuman:',
        '\n\nUser:',
        '\n### User\n',
        '\n### User',
        '<|start|>user',
        '<|start|>assistant',
        '<|return|>',
      ];
      for (const pattern of turnPatterns) {
        const idx = text.indexOf(pattern);
        if (idx > 0) return idx;
      }
      return -1;
    };
    
    let promptLeakChecked = false;
    
    // Attach vision images to the last user message (for /api/chat)
    if (visionImages && chatMessages.length > 0) {
      // Find the last user message to attach images
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        if (chatMessages[i].role === 'user') {
          chatMessages[i] = { ...chatMessages[i], images: visionImages };
          break;
        }
      }
    }
    
    // ── CLEAN OPTIONS: strip all internal _ prefixed keys before sending to Ollama ──
    // These are metadata for debugging only — Ollama doesn't know about them.
    const cleanOptions = {};
    for (const [key, value] of Object.entries(options)) {
      if (!key.startsWith('_')) {
        cleanOptions[key] = value;
      }
    }

    const runtimeProfile = {
      model: currentModel,
      mode: 'chat',
      num_ctx: cleanOptions.num_ctx ?? null,
      num_predict: cleanOptions.num_predict ?? null,
      temperature: cleanOptions.temperature ?? null,
      repeat_penalty: cleanOptions.repeat_penalty ?? null,
      num_gpu: typeof cleanOptions.num_gpu === 'number' ? cleanOptions.num_gpu : null,
      flash_attn: !!cleanOptions.flash_attn,
      kv_cache_type: cleanOptions.kv_cache_type || null,
      updatedAt: new Date().toISOString(),
    };
    
    console.log(`[LLM] Sending to Ollama (${modelSource}+chat):`, {
      model: currentModel,
      num_ctx: cleanOptions.num_ctx,
      num_predict: cleanOptions.num_predict,
      num_batch: cleanOptions.num_batch,
      num_gpu: cleanOptions.num_gpu,
      temperature: cleanOptions.temperature,
      repeat_penalty: cleanOptions.repeat_penalty,
      flash_attn: cleanOptions.flash_attn,
      kv_cache_type: cleanOptions.kv_cache_type,
      messagesCount: chatMessages.length,
      isThinkingModel: _isThinkingModel,
    });
    
    set(state => ({
      lastGenerationProfile: runtimeProfile,
      generationMetadata: {
        ...state.generationMetadata,
        isThinkingModel: _isThinkingModel,
      }
    }));
    
    const streamPayload = {
      model: currentModel,
      messages: chatMessages,
      system: systemPrompt,
      options: cleanOptions,
      lane: 'lane_interactive',
      workloadType: 'chat',
      allowFallback: true,
      priority: -20,
    };

    const cleanup = window.electronAPI.streamFromLLM(
      streamPayload,
      (chunk) => {
        if (chunk.done) {
          if (!get().isGenerating) return;
          
          const finalMeta = get().generationMetadata || {};
          const finishedAt = Date.now();
          const elapsedSec = finalMeta.startedAt != null
            ? Math.max(0.1, (finishedAt - finalMeta.startedAt) / 1000)
            : null;

          const estimatedTokens = Math.round(fullResponse.length / 4);
          const durationMs = elapsedSec ? elapsedSec * 1000 : 1000;
          try {
            useAdaptiveGeneration.getState().recordGeneration(estimatedTokens, durationMs);
          } catch (e) {
            // Ignore
          }

          set((state) => ({
            isGenerating: false,
            currentStreamChannel: null,
            generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
            modelHealthByModel: {
              ...state.modelHealthByModel,
              [currentModel]: {
                status: 'stable',
                reason: 'last_generation_ok',
                checkedAt: new Date().toISOString(),
                source: 'generation',
              },
            },
          }));

          const finalizeAssistantMessage = () => {
            const assistantMessageId = uuidv4();
            const stateNow = get();
            const branchId = stateNow.currentBranchId || null;
            const prev = stateNow.messages.length > 0 ? stateNow.messages[stateNow.messages.length - 1] : null;
            const parentId = prev ? prev.id : null;

            // FIX: Properly await encryption before DB write
            const saveToDb = async (dbContent) => {
              await api.data.messagesAppend({
                id: assistantMessageId,
                conversationId,
                role: 'assistant',
                content: dbContent,
                model: currentModel,
                branchId,
                parentMessageId: parentId,
              });
            };

            if (isNsfw && nsfwPassword) {
              window.electronAPI?.encrypt(fullResponse, nsfwPassword).then(encrypted => {
                return saveToDb(JSON.stringify(encrypted));
              }).catch(error => {
                console.error('Failed to encrypt assistant message:', error);
                saveToDb(fullResponse);
              });
            } else {
              saveToDb(fullResponse);
            }

            const assistantMessage = {
              id: assistantMessageId,
              conversation_id: conversationId,
              role: 'assistant',
              content: fullResponse,
              model: currentModel,
              created_at: new Date().toISOString(),
              branch_id: branchId,
              parent_message_id: parentId,
              meta: {
                tokensEstimated: finalMeta.tokensEstimated || Math.round(fullResponse.length / 4),
                tokensPerSecond: finalMeta.tokensPerSecond || null,
                chars: finalMeta.chars || fullResponse.length,
                startedAt: finalMeta.startedAt || null,
                durationSeconds: elapsedSec,
                guardrailReasons: Array.from(guardrailReasonCodes),
                guardrailReasonPrimary: Array.from(guardrailReasonCodes)[0] || null,
              },
            };

            // === AUTO-TITLE with LLM ===
            const currentMsgs = get().messages;
            if (currentMsgs.length === 1) {
              // First exchange: generate a smart title
              _autoTitleConversation(conversationId, userContent, fullResponse, currentModel);
            } else {
              api.data.conversationsUpdateMeta({ id: conversationId }).catch((error) => {
                console.warn('Failed to update conversation timestamp:', error);
              });
            }

            set(state => ({
              messages: [...state.messages, assistantMessage],
              streamingContent: ''
            }));

            // Record to ledger
            safeCall('ledger:recordMessage', [{
              role: 'assistant',
              workspace: currentWorkspace,
              model: currentModel,
              length: fullResponse.length,
              hasAttachments: false,
              conversationId,
              messageId: assistantMessageId,
            }], null).catch(() => {});

            safeCall('ledger:recordGenerationComplete', [{
              model: currentModel,
              workspace: currentWorkspace,
              responseLength: fullResponse.length,
              durationMs: elapsedSec != null ? elapsedSec * 1000 : 1000,
              tokensEstimated: finalMeta.tokensEstimated || Math.round(fullResponse.length / 4),
              conversationId,
            }], null).catch(() => {});

            // NOTE: Soul interaction recording intentionally disabled (raw model mode)

            // Generate follow-up suggestions (non-blocking)
            _generateFollowUps(userContent, fullResponse);
          };

          // === WEB SEARCH EXECUTION ===
          // Check if the AI output contains search calls and process them.
          // Then run a synthesis pass so the user gets an actual answer, not just raw results.
          if (canUseWebSearch && hasSearchCalls(fullResponse)) {
            (async () => {
              try {
                const {
                  content: processedContent,
                  searchResults = [],
                  synthesisContext = '',
                } = await processSearchCalls(fullResponse, {
                  maxResults: 8,
                  fetchTopResults: 2,
                  fetchTimeout: 7000,
                  fetchMaxLength: 2800,
                  excerptLength: 900,
                  userPrompt: userContent,
                });
                const toolTranscript = extractWebToolTranscript(processedContent) || processedContent;
                fullResponse = toolTranscript;

                // Update the streaming content immediately so user sees results
                set({ streamingContent: fullResponse });

                const synthesizedAnswer = await synthesizeWebSearchAnswer({
                  model: currentModel,
                  systemPrompt,
                  userPrompt: userContent,
                  toolTranscript,
                  synthesisContext,
                  options: cleanOptions,
                });
                const deterministicFallback = buildDeterministicWebFallbackAnswer({
                  userPrompt: userContent,
                  searchResults,
                });

                if (synthesizedAnswer) {
                  fullResponse = synthesizedAnswer.trim();
                  set({ streamingContent: fullResponse });
                } else if (deterministicFallback) {
                  fullResponse = deterministicFallback;
                  set({ streamingContent: fullResponse });
                }
              } catch (e) {
                console.warn('[WebSearch] Failed to process search calls:', e);
              }
              // Continue with saving (done below via finalizeAssistantMessage)
              finalizeAssistantMessage();
            })();
            return; // Let the async handler finish
          }

          const shouldAutoSearch = canUseWebSearch && !hasSearchCalls(fullResponse) && shouldForceWebSearch(userContent);
          const shouldClockSynthesize = canUseWebSearch && !hasSearchCalls(fullResponse) && isDirectDateOrTimePrompt(userContent);

          if (shouldAutoSearch || shouldClockSynthesize) {
            (async () => {
              try {
                let toolTranscript = '';
                let synthesisContext = '';
                let searchResults = [];

                if (shouldAutoSearch) {
                  const forcedQuery = buildSearchQueryFromPrompt(userContent);
                  if (forcedQuery) {
                    const {
                      content: processedContent,
                      searchResults: forcedSearchResults = [],
                      synthesisContext: forcedSynthesisContext = '',
                    } = await processSearchCalls(`[SEARCH: ${forcedQuery}]`, {
                      maxResults: 8,
                      fetchTopResults: 2,
                      fetchTimeout: 7000,
                      fetchMaxLength: 2800,
                      excerptLength: 900,
                      userPrompt: userContent,
                    });
                    toolTranscript = extractWebToolTranscript(processedContent) || processedContent;
                    searchResults = forcedSearchResults;
                    synthesisContext = forcedSynthesisContext;
                    fullResponse = toolTranscript;
                    set({ streamingContent: fullResponse });
                  }
                }

                const synthesizedAnswer = await synthesizeWebSearchAnswer({
                  model: currentModel,
                  systemPrompt,
                  userPrompt: userContent,
                  toolTranscript: toolTranscript || 'No web lookup was required. Use the provided clock context to answer directly.',
                  synthesisContext,
                  options: cleanOptions,
                });
                const deterministicFallback = buildDeterministicWebFallbackAnswer({
                  userPrompt: userContent,
                  searchResults,
                });

                if (synthesizedAnswer) {
                  fullResponse = synthesizedAnswer.trim();
                  set({ streamingContent: fullResponse });
                } else if (deterministicFallback) {
                  fullResponse = deterministicFallback;
                  set({ streamingContent: fullResponse });
                }
              } catch (e) {
                console.warn('[WebSearch] Fresh-info fallback failed:', e);
              }
              finalizeAssistantMessage();
            })();
            return;
          }

          if (!canUseWebSearch && hasSearchCalls(fullResponse)) {
            recordGuardrailReason('search_call_stripped_offline', 'policy_enforcement', {
              workspace: currentWorkspace,
            });
            fullResponse = fullResponse.replace(/\[SEARCH:\s*[^\]]+\]/gi, '').trim();
          }

          // === RESPONSE CLEANUP: Strip any leaked prompt artifacts ===
          // For thinking models, only do lightweight cleanup (turn markers, echo)
          // but skip the aggressive prompt-leak stripping which would destroy <think> content.
          if (_isThinkingModel) {
            // Just trim turn markers and echo, preserve <think> blocks
            const turnPatterns = [
              /\n{1,3}Human:.*$/s,
              /\n{1,3}User:.*$/s,
              /\n{1,3}human:.*$/s,
              /\n{1,3}user:.*$/s,
              /\n{1,3}Assistant:$/,
            ];
            for (const pattern of turnPatterns) {
              fullResponse = fullResponse.replace(pattern, '');
            }
            fullResponse = fullResponse.replace(/^Assistant:\s*/i, '').trim();
          } else {
            fullResponse = cleanupResponse(fullResponse);
          }

          // If cleanup stripped everything, provide a simple fallback
          if (!fullResponse || fullResponse.length < 5) {
            recordGuardrailReason('final_empty_fallback', 'fallback');
            fullResponse = "I couldn't generate a response. Please try again.";
          }

          // If a coding model denies workspace access despite IDE context, recover with
          // a deterministic workspace-aware response instead of surfacing the denial.
          if (currentWorkspace === 'code' && shouldInjectProjectContext && isWorkspaceContextDenialResponse(fullResponse)) {
            recordGuardrailReason('workspace_context_denial_recovered', 'context_recovery');
            fullResponse = buildWorkspaceContextRecovery(
              editorStateSnapshot || useEditorStore.getState(),
              codeContextHints
            );
          }

          finalizeAssistantMessage();
          
        } else if (chunk.cancelled) {
          // === STREAM RECOVERY: Save partial response if we have content ===
          if (fullResponse.length > 20) {
            _savePartialResponse(fullResponse, conversationId, currentModel);
          }
          set({ 
            isGenerating: false, 
            streamingContent: '',
            currentStreamChannel: null,
            generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
          });
        } else if (chunk.error) {
          // === STREAM RECOVERY: Save partial response on error ===
          if (fullResponse.length > 20) {
            _savePartialResponse(fullResponse + '\n\n[Generation interrupted: ' + chunk.error + ']', conversationId, currentModel);
          }
          set({ 
            isGenerating: false, 
            error: chunk.error,
            currentStreamChannel: null,
            generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
          });
        } else if (chunk.response) {
          fullResponse += chunk.response;
          
          // === LOOP & LEAK DETECTION (runs every chunk) ===
          let shouldAbort = false;
          
          // 0) Check for prompt leak / meta-reasoning
          // SKIP for thinking models: their reasoning output looks like meta-reasoning
          // to our detectors, but it's legitimate chain-of-thought content.
          if (!_isThinkingModel && !promptLeakChecked && fullResponse.length >= 40) {
            if (detectPromptLeak(fullResponse)) {
              console.warn('[LLM] Detected prompt leak / meta-reasoning at', fullResponse.length, 'chars');
              
              // If we're past 150 chars, abort immediately -- the model is clearly leaking
              if (fullResponse.length > 150) {
                promptLeakChecked = true;
                fullResponse = stripPromptLeak(fullResponse);
                recordGuardrailReason('stream_prompt_leak_abort', 'stream_guardrail');
                shouldAbort = true;
              }
              // Under 150 chars -- wait a bit more to see if there's a valid first line
            }
            // Stop scanning after 800 chars
            if (fullResponse.length > 800) {
              promptLeakChecked = true;
            }
          }
          
          // 1) Check if model leaked a conversation turn (Human:/User:)
          if (!shouldAbort) {
            const leakPos = detectLeakedTurns(fullResponse);
            if (leakPos > 0) {
              fullResponse = fullResponse.slice(0, leakPos).trimEnd();
              console.warn('[LLM] Detected leaked conversation turn, truncating response');
              recordGuardrailReason('stream_turn_leak_abort', 'stream_guardrail');
              shouldAbort = true;
            }
          }
          // 2) Check for repetition loop (every ~400 chars to avoid overhead)
          if (!shouldAbort && !loopDetected && fullResponse.length > 400 && fullResponse.length % 50 < (chunk.response.length + 1)) {
            if (detectRepetitionLoop(fullResponse)) {
              loopDetected = true;
              console.warn('[LLM] Detected repetition loop, aborting generation');
              const halfWindow = Math.floor(REPETITION_WINDOW / 2);
              fullResponse = fullResponse.slice(0, -halfWindow).trimEnd();
              recordGuardrailReason('stream_repetition_loop_abort', 'stream_guardrail');
              shouldAbort = true;
            }
          }
          // 3) Detect softer semantic loops with tiny vocabulary and repeated lines
          if (!shouldAbort && detectDegenerateLoop(fullResponse)) {
            console.warn('[LLM] Detected degenerate loop pattern, aborting generation');
            fullResponse = fullResponse.trimEnd();
            recordGuardrailReason('stream_degenerate_loop_abort', 'stream_guardrail');
            shouldAbort = true;
          }
          
          if (shouldAbort) {
            fullResponse = cleanupResponse(fullResponse);
            try { cleanup?.(); } catch {}
            if (!fullResponse || fullResponse.length < 10) {
              recordGuardrailReason('stream_abort_empty_fallback', 'fallback');
              fullResponse = "I couldn't generate a response. Please try again.";
            }
            _savePartialResponse(fullResponse, conversationId, currentModel);
            set({ 
              isGenerating: false, 
              streamingContent: '',
              currentStreamChannel: null,
              generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
            });
            return;
          }
          
          // Throttle UI updates to 100ms for smoother performance
          const now = Date.now();
          if (now - lastUiUpdate > UI_UPDATE_INTERVAL) {
            const meta = get().generationMetadata || {};
            const started = meta.startedAt || now;
            const elapsed = Math.max(0.1, (now - started) / 1000);
            const chars = fullResponse.length;
            const tokensEstimated = Math.round(chars / 4);
            const tokensPerSecond = Math.round((tokensEstimated / elapsed) * 10) / 10;

            set({
              streamingContent: fullResponse,
              generationMetadata: {
                stage: 'generating',
                startedAt: started,
                chars,
                tokensEstimated,
                tokensPerSecond,
              },
            });
            lastUiUpdate = now;
          }
        }
      }
    );
    
    return cleanup;

    // === Helper: save a partial response when stream is interrupted ===
    function _savePartialResponse(content, convId, model) {
      const partialId = uuidv4();
      const stateNow = get();
      const bId = stateNow.currentBranchId || null;
      const prev = stateNow.messages.length > 0 ? stateNow.messages[stateNow.messages.length - 1] : null;
      const pId = prev ? prev.id : null;

      api.data.messagesAppend({
        id: partialId,
        conversationId: convId,
        role: 'assistant',
        content,
        model,
        branchId: bId,
        parentMessageId: pId,
      }).catch((error) => {
        console.warn('Failed to save partial response:', error);
      });

      const partialMessage = {
        id: partialId,
        conversation_id: convId,
        role: 'assistant',
        content,
        model,
        created_at: new Date().toISOString(),
        branch_id: bId,
        parent_message_id: pId,
        meta: {
          partial: true,
          guardrailReasons: Array.from(guardrailReasonCodes),
          guardrailReasonPrimary: Array.from(guardrailReasonCodes)[0] || null,
        },
      };

      set(state => ({
        messages: [...state.messages, partialMessage],
        streamingContent: '',
      }));
    }

    // === Helper: auto-title a conversation using the LLM ===
    // Generate suggested follow-up questions after AI response
    function _generateFollowUps(question, answer) {
      // Simple heuristic follow-ups based on content analysis
      // (Using LLM would cause extra latency; local heuristics are instant)
      const followUps = [];
      const answerLower = answer.toLowerCase();
      const questionLower = question.toLowerCase();
      
      // Topic-based suggestions
      if (answerLower.includes('example') || answerLower.includes('for instance')) {
        followUps.push('Can you give me more examples?');
      }
      if (answerLower.includes('step') || answerLower.includes('first') || answerLower.includes('then')) {
        followUps.push('Can you walk me through this step by step?');
      }
      if (answerLower.includes('however') || answerLower.includes('but') || answerLower.includes('alternative')) {
        followUps.push('What are the trade-offs?');
      }
      if (answerLower.includes('code') || answerLower.includes('function') || answerLower.includes('```')) {
        followUps.push('Can you explain this code in more detail?');
        followUps.push('How would I modify this for my use case?');
      }
      
      // General follow-ups based on question type
      if (questionLower.startsWith('what') || questionLower.startsWith('explain')) {
        followUps.push('Why is this important?');
        followUps.push('How does this compare to alternatives?');
      } else if (questionLower.startsWith('how')) {
        followUps.push('What are common mistakes to avoid?');
        followUps.push('Can you simplify this further?');
      } else if (questionLower.startsWith('why')) {
        followUps.push('What evidence supports this?');
        followUps.push('Are there counter-arguments?');
      }
      
      // Always offer these
      if (answer.length > 500) {
        followUps.push('Can you summarize the key takeaways?');
      }
      followUps.push('Tell me more about this');
      
      // Deduplicate and limit to 3
      const unique = [...new Set(followUps)].slice(0, 3);
      set({ suggestedFollowUps: unique });
    }

    async function _autoTitleConversation(convId, question, answer, model) {
      try {
        // Try to use the LLM to generate a smart title
        const titlePrompt = `Generate a concise title (max 6 words) for this conversation. Return ONLY the title, nothing else.\n\nUser: ${question.substring(0, 200)}\nAssistant: ${answer.substring(0, 200)}`;
        
        const res = await window.electronAPI?.sendToLLM?.({
          model,
          prompt: titlePrompt,
          system: 'You are a conversation title generator. Respond with ONLY a short title, no quotes, no explanation.',
          options: { temperature: 0.3, num_predict: 20 },
        });

        let title = res?.response?.trim();
        // Validate: must be reasonable length and not empty
        if (title && title.length > 2 && title.length < 80) {
          // Strip quotes if the model wrapped them
          title = title.replace(/^["']|["']$/g, '').trim();
        } else {
          // Fallback to first 50 chars of user message
          title = question.substring(0, 50);
        }

        await api.data.conversationsUpdateMeta({
          id: convId,
          title,
        });
        get().loadConversations().then(convs => set({ conversations: convs }));
      } catch (e) {
        // Fallback: use first 50 chars
        console.warn('[AutoTitle] LLM title generation failed, using fallback:', e);
        await api.data.conversationsUpdateMeta({
          id: convId,
          title: question.substring(0, 50),
        });
        get().loadConversations().then(convs => set({ conversations: convs }));
      }
    }
  },
});
