// Message sending slice
// Handles the core sendMessage logic with streaming
// PHILOSOPHY: Give the AI EVERYTHING it needs. Use the full context window!

import { v4 as uuidv4 } from 'uuid';
import { isElectron, safeCall } from '../../utils/electronAPI';
import { useAdaptiveGeneration } from '../../services/adaptiveGeneration';
import { buildOptimizedOllamaOptions, buildOptimizedOllamaOptionsWithInfo, parseModelName, MODEL_FAMILIES } from '../../services/modelOptimizer';
import { useEditorStore } from '../editorStore';
import { buildFullContext } from '../../services/fullContextBuilder';
import { WEB_SEARCH_TOOL_PROMPT, isWebSearchAvailable, processSearchCalls, hasSearchCalls } from '../../services/webSearchTool';

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
    /<\|im_end\|>.*$/s,
    /<\|eot_id\|>.*$/s,
    /<\|end\|>.*$/s,
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

  setImageGenSettings: (settings) => set(state => ({
    imageGenSettings: { ...state.imageGenSettings, ...settings }
  })),

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
      await window.electronAPI?.dbRun(
        'DELETE FROM messages WHERE id = ?',
        [lastAssistant.id]
      );
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
        await window.electronAPI?.dbRun('DELETE FROM messages WHERE id = ?', [m.id]);
      } catch (e) {
        console.error('Failed to delete message during edit:', e);
      }
    }

    // Update the user message in DB
    try {
      await window.electronAPI?.dbRun(
        'UPDATE messages SET content = ? WHERE id = ?',
        [newContent.trim(), messageId]
      );
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
      await window.electronAPI?.dbRun('DELETE FROM messages WHERE id = ?', [messageId]);
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
    const { currentConversationId, currentModel, currentWorkspace, workspaceSettings } = get();
    
    if (!currentModel) {
      set({ error: 'No model selected' });
      return;
    }
    
    // Create conversation if needed
    let conversationId = currentConversationId;
    if (!conversationId) {
      conversationId = await get().createConversation(content.substring(0, 50));
      if (!conversationId) return;
    }
    
    // Add user message
    const userMessageId = uuidv4();
    const isNsfw = currentWorkspace === 'nsfw';
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
    
    await window.electronAPI?.dbRun(
      'INSERT INTO messages (id, conversation_id, role, content, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?)',
      [userMessageId, conversationId, 'user', messageContent, branchId, parentId]
    );

    // Persist attachments
    if (attachments.length > 0 && isElectron()) {
      try {
        const encryptionPassword = isNsfw && nsfwPassword ? nsfwPassword : null;
        await safeCall('saveMessageAttachments', [userMessageId, attachments, encryptionPassword], null);
      } catch (error) {
        console.error('Failed to save message attachments:', error);
      }
    }
    
    // Mark conversation as encrypted if NSFW
    if (isNsfw) {
      await window.electronAPI?.dbRun(
        'UPDATE conversations SET encrypted = 1 WHERE id = ?',
        [conversationId]
      );
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

      await window.electronAPI?.dbRun(
        'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [assistantMessageId, conversationId, 'assistant', specContent, currentModel, bId, pId]
      );

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

      await window.electronAPI?.dbRun(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [conversationId]
      );

      return;
    }
    
    // Proceed to generate
    await get()._generateResponse(content, conversationId, { webSearchEnabled: !!extra.webSearchEnabled });
  },

  /**
   * Internal: generate an assistant response for the current conversation.
   * Used by sendMessage, regenerateLastResponse, and editMessageAndRegenerate.
   */
  _generateResponse: async (userContent, conversationId, genOptions = {}) => {
    const { currentModel, currentWorkspace, workspaceSettings } = get();
    const isNsfw = currentWorkspace === 'nsfw';
    const nsfwPassword = get().nsfwPassword;

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
    // NOTE: Soul personalization overlay intentionally disabled.
    // We want a "raw model" conversation (plus useful context like memory/RAG/project),
    // without any personality injection.
    
    // Add web search tool capability to system prompt (only if user enabled it)
    if (genOptions.webSearchEnabled && isWebSearchAvailable()) {
      systemPrompt = systemPrompt + '\n\n' + WEB_SEARCH_TOOL_PROMPT;
    }

    // === FULL CONTEXT BUILDING ===
    // Use the model's ACTUAL context window, not a conservative default
    const actualContextSize = getActualContextSize(currentModel);
    let chatMessages = []; // Structured messages for /api/chat
    let messagesIncluded = 0;
    
    // Try full context builder first (includes memories, soul, project, RAG, etc.)
    if (isElectron()) {
      try {
        const editorState = currentWorkspace === 'code' ? useEditorStore.getState() : null;
        
        const fullContext = await buildFullContext({
          modelName: currentModel,
          workspace: currentWorkspace,
          conversationId,
          messages,
          systemPromptBase: systemPrompt,
          projectContext: editorState ? {
            rootPath: editorState.rootPath,
            activeFilePath: editorState.activeFilePath,
            openFiles: editorState.openFiles,
            files: editorState.files,
            projectAnalysis: editorState.projectContext,
          } : null,
          ragQuery: userContent,
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
      if (isElectron() && messages.length > 15) {
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
      
      // Build messages array from recent conversation
      const maxMessages = Math.min(messages.length, Math.floor(actualContextSize * 0.5 / 500));
      const recentMessages = messages.slice(-maxMessages);
      
      chatMessages = recentMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));
      messagesIncluded = recentMessages.length;

      // Fallback: inject minimal code context even if fullContextBuilder failed
      if (currentWorkspace === 'code') {
        try {
          const editorState = useEditorStore.getState();
          if (editorState.activeFilePath && editorState.openFiles[editorState.activeFilePath]) {
            const fileContent = editorState.openFiles[editorState.activeFilePath].content || '';
            const lines = fileContent.split('\n');
            const truncated = lines.length > 300 
              ? lines.slice(0, 200).join('\n') + `\n// ... ${lines.length - 200} more lines ...`
              : fileContent;
            systemPrompt += `\n\n## Active File: ${editorState.activeFilePath}\n\`\`\`\n${truncated}\n\`\`\``;
          }
        } catch (_) { /* ignore */ }
      }
    }
    
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
    const currentModelInfo = get().currentModelInfo || null;
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
      
      // GPU layers: auto-tuner determines if we can fit the full model
      if (typeof autoTuneResult.gpuLayers === 'number') {
        options.num_gpu = autoTuneResult.gpuLayers;
      }
      
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
              // Read as base64 via dedicated IPC call for vision models (LLaVA, bakllava, etc.)
              const b64 = await window.electronAPI?.readFileBase64(img.originalPath);
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
    let repetitionCheckBuffer = '';
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
    
    // Also detect if model starts generating conversation turns
    const detectLeakedTurns = (text) => {
      const turnPatterns = ['\nHuman:', '\nUser:', '\n\nHuman:', '\n\nUser:', '\n### User\n', '\n### User'];
      for (const pattern of turnPatterns) {
        const idx = text.indexOf(pattern);
        if (idx > 0) return idx;
      }
      return -1;
    };
    
    // Track whether we've already checked for prompt leak (only need to check early on)
    let promptLeakChecked = false;
    
    // Attach vision images to the last user message (for /api/chat)
    if (visionImages && chatMessages.length > 0) {
      const lastUserIdx = chatMessages.length - 1;
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
    
    console.log(`[LLM] Sending to Ollama (${modelSource}):`, {
      model: currentModel,
      num_ctx: cleanOptions.num_ctx,
      num_batch: cleanOptions.num_batch,
      num_gpu: cleanOptions.num_gpu,
      temperature: cleanOptions.temperature,
      repeat_penalty: cleanOptions.repeat_penalty,
      flash_attn: cleanOptions.flash_attn,
      kv_cache_type: cleanOptions.kv_cache_type,
      messagesCount: chatMessages.length,
    });
    
    const cleanup = window.electronAPI.streamFromLLM(
      {
        model: currentModel,
        messages: chatMessages,
        system: systemPrompt,
        options: cleanOptions,
      },
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

          set({
            isGenerating: false,
            currentStreamChannel: null,
            generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
          });

          // === WEB SEARCH EXECUTION ===
          // Check if the AI output contains [SEARCH: ...] calls and process them
          if (hasSearchCalls(fullResponse)) {
            (async () => {
              try {
                const { content: processedContent } = await processSearchCalls(fullResponse);
                fullResponse = processedContent;
                // Update the streaming content immediately so user sees results
                set({ streamingContent: fullResponse });
              } catch (e) {
                console.warn('[WebSearch] Failed to process search calls:', e);
              }
              // Continue with saving (done below via finalizeAssistantMessage)
              finalizeAssistantMessage();
            })();
            return; // Let the async handler finish
          }

          // === RESPONSE CLEANUP: Strip any leaked prompt artifacts ===
          fullResponse = cleanupResponse(fullResponse);
          
          // If cleanup stripped everything (entire response was leaked reasoning), 
          // provide a fallback so the user doesn't see an empty bubble
          if (!fullResponse || fullResponse.length < 5) {
            fullResponse = 'Hello! How can I help you today?';
          }

          finalizeAssistantMessage();

          function finalizeAssistantMessage() {
            const assistantMessageId = uuidv4();
            const stateNow = get();
            const branchId = stateNow.currentBranchId || null;
            const prev = stateNow.messages.length > 0 ? stateNow.messages[stateNow.messages.length - 1] : null;
            const parentId = prev ? prev.id : null;

            // FIX: Properly await encryption before DB write
            const saveToDb = async (dbContent) => {
              await window.electronAPI?.dbRun(
                'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [assistantMessageId, conversationId, 'assistant', dbContent, currentModel, branchId, parentId]
              );
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
              },
            };
            
            // === AUTO-TITLE with LLM ===
            const currentMsgs = get().messages;
            if (currentMsgs.length === 1) {
              // First exchange: generate a smart title
              _autoTitleConversation(conversationId, userContent, fullResponse, currentModel);
            } else {
              window.electronAPI?.dbRun(
                'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [conversationId]
              );
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
          }
          
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
          // Check aggressively: start at 40 chars, keep checking up to 800 chars.
          // Abort as soon as leak is detected and we have enough to strip.
          if (!promptLeakChecked && fullResponse.length >= 40) {
            if (detectPromptLeak(fullResponse)) {
              console.warn('[LLM] Detected prompt leak / meta-reasoning at', fullResponse.length, 'chars');
              
              // If we're past 150 chars, abort immediately -- the model is clearly leaking
              if (fullResponse.length > 150) {
                promptLeakChecked = true;
                fullResponse = stripPromptLeak(fullResponse);
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
              shouldAbort = true;
            }
          }
          
          if (shouldAbort) {
            // Clean the response and abort the stream
            fullResponse = cleanupResponse(fullResponse);
            try { cleanup?.(); } catch {}
            // If cleanup stripped everything, provide a simple helpful fallback
            if (!fullResponse || fullResponse.length < 10) {
              fullResponse = 'Hello! How can I help you today?';
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

      window.electronAPI?.dbRun(
        'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [partialId, convId, 'assistant', content, model, bId, pId]
      );

      const partialMessage = {
        id: partialId,
        conversation_id: convId,
        role: 'assistant',
        content,
        model,
        created_at: new Date().toISOString(),
        branch_id: bId,
        parent_message_id: pId,
        meta: { partial: true },
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

        await window.electronAPI?.dbRun(
          'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [title, convId]
        );
        get().loadConversations().then(convs => set({ conversations: convs }));
      } catch (e) {
        // Fallback: use first 50 chars
        console.warn('[AutoTitle] LLM title generation failed, using fallback:', e);
        await window.electronAPI?.dbRun(
          'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [question.substring(0, 50), convId]
        );
        get().loadConversations().then(convs => set({ conversations: convs }));
      }
    }
  },
});
