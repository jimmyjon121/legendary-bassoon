// Message sending slice
// Handles the core sendMessage logic with streaming

import { v4 as uuidv4 } from 'uuid';
import { isElectron, safeCall } from '../../utils/electronAPI';
import { useAdaptiveGeneration } from '../../services/adaptiveGeneration';
import { buildOptimizedOllamaOptions, describeSettings } from '../../services/modelOptimizer';

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

  setImageGenSettings: (settings) => set(state => ({
    imageGenSettings: { ...state.imageGenSettings, ...settings }
  })),

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
    
    // Build prompt
    const messages = get().messages;
    let systemPrompt = workspaceSettings[currentWorkspace]?.systemPrompt || '';
    
    // Add Soul Engine personalization to system prompt
    if (isElectron()) {
      try {
        const personalizedContext = await safeCall('soulGetPersonalizedPrompt', [], '');
        if (personalizedContext) {
          systemPrompt = systemPrompt + personalizedContext;
        }
      } catch (error) {
        // Soul engine not critical, continue without it
      }
    }

    // RAG context
    let ragContext = [];
    const ragInfluence = get().ragInfluence ?? 0;
    if (ragInfluence > 0.05 && isElectron()) {
      const limit = Math.max(1, Math.round(ragInfluence * 6));
      try {
        ragContext = await safeCall('searchDocuments', [currentWorkspace, content, limit], []);
      } catch (error) {
        console.error('Failed to search documents:', error);
      }
    }

    let contextBlock = '';
    if (Array.isArray(ragContext) && ragContext.length > 0) {
      const confidence = Math.round((ragInfluence || 0) * 100);
      contextBlock = `You have access to the following context extracted from user documents (confidence ${confidence}%). Use it only if it directly answers the question.\n\n`;
      ragContext.forEach((c, idx) => {
        contextBlock += `Source ${idx + 1} (${c.filename}):\n${c.content}\n\n`;
      });
    }
    
    // === SMART CONTEXT BUILDING ===
    // Use memory engine for long conversations (instead of just last 10 messages)
    let prompt = '';
    let messagesIncluded = 0;
    
    if (isElectron() && messages.length > 15) {
      // Use memory engine for smart context building
      try {
        const memoryContext = await safeCall('memoryBuildContext', [{
          conversationId,
          workspace: currentWorkspace,
          messages,
          options: {
            maxTokens: options.num_ctx || 4096,
            includeMemories: true,
            includeSummary: true,
            includePinned: true,
          }
        }], null);

        if (memoryContext?.contextText) {
          prompt = memoryContext.contextText;
          messagesIncluded = memoryContext.messagesIncluded || messages.length;
          console.log(`[Memory] Smart context: ${messagesIncluded}/${messages.length} messages, ${memoryContext.totalTokens} est. tokens`);
        }
      } catch (error) {
        console.warn('[Memory] Failed to build smart context, falling back:', error);
      }
    }
    
    // Fallback: traditional approach for short conversations or if memory fails
    if (!prompt) {
      const recentMessages = messages.slice(-20); // Increased from 10 to 20
      prompt = recentMessages
        .map(m => m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`)
        .join('\n\n');
      messagesIncluded = recentMessages.length;
    }

    if (contextBlock) {
      prompt = `${contextBlock}\n---\n\n${prompt}`;
    }
    prompt += '\n\nAssistant:';
    
    // Periodically update conversation summary and extract memories (every ~15 messages)
    if (isElectron() && messages.length > 0 && messages.length % 15 === 0) {
      safeCall('memoryUpdateSummary', [{ conversationId, messages, workspace: currentWorkspace }], null).catch(() => {});
      safeCall('memoryExtractMemories', [{ conversationId, messages, workspace: currentWorkspace }], null).catch(() => {});
    }

    // Handle speculative response
    const speculativeResponse = extra.speculativeResponse;
    if (speculativeResponse) {
      console.log('⚡ Using speculative response (instant!)');
      const assistantMessageId = uuidv4();
      const branchId = get().currentBranchId || null;
      const prev = get().messages[get().messages.length - 1];
      const parentId = prev ? prev.id : null;

      let messageContent = speculativeResponse;
      if (isNsfw && nsfwPassword) {
        try {
          const encrypted = await window.electronAPI?.encrypt(speculativeResponse, nsfwPassword);
          messageContent = JSON.stringify(encrypted);
        } catch (error) {
          console.error('Failed to encrypt speculative response:', error);
        }
      }

      window.electronAPI?.dbRun(
        'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [assistantMessageId, conversationId, 'assistant', messageContent, currentModel, branchId, parentId]
      );

      const assistantMessage = {
        id: assistantMessageId,
        conversation_id: conversationId,
        role: 'assistant',
        content: speculativeResponse,
        model: currentModel,
        created_at: new Date().toISOString(),
        branch_id: branchId,
        parent_message_id: parentId,
        meta: { speculative: true },
      };

      set(state => ({
        messages: [...state.messages, assistantMessage],
        isGenerating: false,
        generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
      }));

      window.electronAPI?.dbRun(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [conversationId]
      );

      return;
    }
    
    // Build options with intelligent model-aware optimization
    // This automatically detects optimal settings based on model family, size, and quantization
    const workspaceType = currentWorkspace === 'code' ? 'code' : 
                          currentWorkspace === 'creative' ? 'creative' : 'casual';
    
    let options = buildOptimizedOllamaOptions(currentModel, workspaceType);
    
    // Log detected settings in development
    if (process.env.NODE_ENV === 'development') {
      const modelInfo = describeSettings(currentModel);
      console.log('[ModelOptimizer] Detected settings for', currentModel, ':', modelInfo.parsed);
      console.log('[ModelOptimizer] Optimal options:', options);
    }
    
    // Apply adaptive hardware-based adjustments
    try {
      const adaptiveOptions = await useAdaptiveGeneration.getState().buildOllamaOptions();
      // Merge adaptive options but preserve model-specific temperature and stop tokens
      options = { 
        ...options, 
        num_ctx: Math.min(options.num_ctx, adaptiveOptions.num_ctx || options.num_ctx),
        num_batch: adaptiveOptions.num_batch || options.num_batch,
        num_gpu: adaptiveOptions.num_gpu ?? options.num_gpu,
      };
    } catch (error) {
      console.warn('Failed to get adaptive options, using model-optimized defaults:', error);
    }
    
    // Apply user presets (override auto-detected settings if user has preferences)
    if (isElectron() && currentModel) {
      try {
        const presets = await safeCall('getModelPresets', [currentModel, currentWorkspace], []);
        const activePreset = presets?.find(p => p.is_default) || presets?.[0];
        if (activePreset) {
          // User presets take priority over auto-detected settings
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
    
    // Stream response
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
    
    const cleanup = window.electronAPI.streamFromLLM(
      {
        model: currentModel,
        prompt,
        system: systemPrompt,
        options,
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
            ragContext,
            generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
          });
          
          // Save assistant message
          const assistantMessageId = uuidv4();
          const stateAfterUser = get();
          const branchId = stateAfterUser.currentBranchId || null;
          const prev = stateAfterUser.messages.length > 0 ? stateAfterUser.messages[stateAfterUser.messages.length - 1] : null;
          const parentId = prev ? prev.id : null;
          
          let messageContent = fullResponse;
          if (isNsfw && nsfwPassword) {
            window.electronAPI?.encrypt(fullResponse, nsfwPassword).then(encrypted => {
              messageContent = JSON.stringify(encrypted);
              window.electronAPI?.dbRun(
                'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [assistantMessageId, conversationId, 'assistant', messageContent, currentModel, branchId, parentId]
              );
            }).catch(error => {
              console.error('Failed to encrypt assistant message:', error);
              window.electronAPI?.dbRun(
                'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [assistantMessageId, conversationId, 'assistant', fullResponse, currentModel, branchId, parentId]
              );
            });
          } else {
            window.electronAPI?.dbRun(
              'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [assistantMessageId, conversationId, 'assistant', fullResponse, currentModel, branchId, parentId]
            );
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
          
          const currentMessages = get().messages;
          if (currentMessages.length === 1) {
            window.electronAPI?.dbRun(
              'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [content.substring(0, 50), conversationId]
            );
            get().loadConversations().then(convs => set({ conversations: convs }));
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
            durationMs: elapsedSec * 1000,
            tokensEstimated: finalMeta.tokensEstimated || Math.round(fullResponse.length / 4),
            conversationId,
          }], null).catch(() => {});
          
          // Record interaction with Soul Engine for personality learning
          safeCall('soulRecordInteraction', [{
            userMessage: content,
            assistantResponse: fullResponse,
            responseTime: elapsedSec * 1000,
            tokensUsed: finalMeta.tokensEstimated || Math.round(fullResponse.length / 4),
            workspace: currentWorkspace,
            model: currentModel,
          }], null).catch(() => {});
          
        } else if (chunk.cancelled) {
          set({ 
            isGenerating: false, 
            streamingContent: '',
            currentStreamChannel: null,
            generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
          });
        } else if (chunk.error) {
          set({ 
            isGenerating: false, 
            error: chunk.error,
            currentStreamChannel: null,
            generationMetadata: { stage: 'idle', startedAt: null, chars: 0, tokensEstimated: 0, tokensPerSecond: 0 },
          });
        } else if (chunk.response) {
          fullResponse += chunk.response;
          
          // Throttle UI updates to 100ms for smoother performance
          const now = Date.now();
          if (now - lastUiUpdate > UI_UPDATE_INTERVAL) {
            const meta = get().generationMetadata || {};
            const started = meta.startedAt || now;
            const elapsedSec = Math.max(0.1, (now - started) / 1000);
            const chars = fullResponse.length;
            const tokensEstimated = Math.round(chars / 4);
            const tokensPerSecond = Math.round((tokensEstimated / elapsedSec) * 10) / 10;

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
  },
});


