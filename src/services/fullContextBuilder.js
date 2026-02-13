/**
 * Full Context Builder - Give the AI EVERYTHING it needs
 * 
 * Philosophy: Don't be stingy with context. Modern models have huge context windows.
 * Use them! A model with 128K context should USE 128K context.
 * 
 * This service builds the most comprehensive context possible:
 * - Full conversation history (summarized for old messages)
 * - User memories and preferences (from Soul Engine)
 * - Pinned important messages
 * - Relevant documents (RAG)
 * - Project context (for code workspace)
 * - Session continuity (what we were just talking about)
 */

import { api } from '../utils/electronAPI';

// Token estimation (4 chars ≈ 1 token for English)
const estimateTokens = (text) => Math.ceil((text?.length || 0) / 4);

// Context budget allocation (percentage of total)
// Code workspace gets a more generous project context allocation
const CONTEXT_ALLOCATION = {
  systemPrompt: 0.05,      // 5% for base instructions
  // Soul "personality overlay" intentionally disabled (raw model mode)
  userProfile: 0.0,        // 0% reserved
  memories: 0.07,          // 7% for persistent memories
  pinnedMessages: 0.10,    // 10% for pinned important stuff
  conversationSummary: 0.10, // 10% for older conversation summary
  ragContext: 0.10,        // 10% for relevant documents
  projectContext: 0.25,    // 25% for code workspace (generous — code needs space)
  recentMessages: 0.33,    // 33% for recent conversation
};

/**
 * Get the model's actual context window size
 */
async function getModelContextSize(modelName) {
  // Try to get from model optimizer
  try {
    const { parseModelName, MODEL_FAMILIES } = await import('./modelOptimizer');
    const parsed = parseModelName(modelName);
    
    if (parsed.family && MODEL_FAMILIES[parsed.family]) {
      return MODEL_FAMILIES[parsed.family].maxContext;
    }
  } catch (e) {
    console.warn('[FullContext] Could not parse model:', e);
  }
  
  // Fallback: Query Ollama for model info
  try {
    const models = await api.getModels?.();
    // Future: Ollama API could return context size per model
  } catch (e) {}
  
  // Reasonable default matching messageSlice fallback
  return 16384;
}

/**
 * Build comprehensive system prompt with all context
 */
export async function buildFullContext(options) {
  const {
    modelName,
    workspace,
    conversationId,
    messages = [],
    systemPromptBase = '',
    projectContext = null,      // For code workspace
    projectContextMode = 'full', // 'full' | 'light' for code workspace
    ragQuery = null,            // Query for document search
    modelContextLength = null,  // Real context length from /api/show (overrides guessing)
  } = options;
  
  // Use real context length from Ollama when available, otherwise guess from name
  const maxContextTokens = modelContextLength && modelContextLength > 0
    ? modelContextLength
    : await getModelContextSize(modelName);
  
  // Reserve tokens for response (20%)
  const responseReserve = Math.floor(maxContextTokens * 0.20);
  const availableTokens = maxContextTokens - responseReserve;
  
  // Allocate budget
  const budget = {};
  for (const [key, percentage] of Object.entries(CONTEXT_ALLOCATION)) {
    budget[key] = Math.floor(availableTokens * percentage);
  }
  
  const contextParts = [];
  let totalTokensUsed = 0;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. USER PROFILE (Soul Engine) — DISABLED
  // ═══════════════════════════════════════════════════════════════════════════
  // Intentionally removed to prevent any personality overlay injection.
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. PERSISTENT MEMORIES
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const memories = await api.memoryGetMemories?.({ workspace });
    
    if (memories?.length > 0) {
      // Sort by importance and recency
      const sortedMemories = memories
        .sort((a, b) => (b.importance || 0) - (a.importance || 0))
        .slice(0, 20); // Top 20 memories
      
      const memoryText = `## Things I Remember\n${sortedMemories.map(m => `- ${m.content}`).join('\n')}\n`;
      const tokens = estimateTokens(memoryText);
      
      if (tokens <= budget.memories) {
        contextParts.push({ type: 'memories', content: memoryText, tokens });
        totalTokensUsed += tokens;
      }
    }
  } catch (e) {
    console.warn('[FullContext] Memories unavailable:', e);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PINNED MESSAGES (Always include - user explicitly marked these)
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const pinned = await api.memoryGetPinned?.({ conversationId });
    
    if (pinned?.length > 0) {
      const pinnedText = `## Important Context (Pinned by User)\n${pinned.map(p => 
        `[${p.role === 'user' ? 'You said' : 'I said'}]: "${p.content.substring(0, 1000)}${p.content.length > 1000 ? '...' : ''}"`
      ).join('\n\n')}\n`;
      const tokens = estimateTokens(pinnedText);
      
      // Always include pinned messages, even if over budget
      contextParts.push({ type: 'pinnedMessages', content: pinnedText, tokens, priority: 'high' });
      totalTokensUsed += tokens;
    }
  } catch (e) {
    console.warn('[FullContext] Pinned messages unavailable:', e);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. RAG CONTEXT (Relevant documents)
  // ═══════════════════════════════════════════════════════════════════════════
  if (ragQuery) {
    try {
      const ragResults = await api.searchDocuments?.(workspace, ragQuery, 5);
      
      if (ragResults?.length > 0) {
        const ragText = `## Relevant Documents\n${ragResults.map((r, i) => 
          `### Source ${i + 1}: ${r.filename || 'Document'}\n${r.content.substring(0, 2000)}`
        ).join('\n\n')}\n`;
        const tokens = estimateTokens(ragText);
        
        if (tokens <= budget.ragContext) {
          contextParts.push({ type: 'ragContext', content: ragText, tokens });
          totalTokensUsed += tokens;
        }
      }
    } catch (e) {
      console.warn('[FullContext] RAG unavailable:', e);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PROJECT CONTEXT (Code workspace)
  // ═══════════════════════════════════════════════════════════════════════════
  if (workspace === 'code' && projectContext) {
    const {
      rootPath,
      activeFilePath,
      openFiles,
      files,
      projectAnalysis,
      openFilesList: hintedOpenFilesList,
    } = projectContext;

    const contextMode = projectContextMode === 'light' ? 'light' : 'full';
    const knownOpenFiles = Array.isArray(hintedOpenFilesList) && hintedOpenFilesList.length > 0
      ? hintedOpenFilesList
      : Object.keys(openFiles || {});

    if (rootPath || activeFilePath) {
      const projectParts = [];

      projectParts.push(rootPath ? `## Current Project: ${rootPath}` : '## Current Project: (not loaded)');

      // Tech stack detection (put early so the model knows the stack upfront)
      if (projectAnalysis?.techStack?.length > 0) {
        projectParts.push(`### Tech Stack: ${projectAnalysis.techStack.join(', ')}`);
      }

      // Project structure (condensed)
      if (files?.length > 0) {
        const maxTreeLines = contextMode === 'light' ? 40 : 80;
        const fileTree = buildCondensedFileTree(files, maxTreeLines);
        projectParts.push(`### Project Structure\n\`\`\`\n${fileTree}\n\`\`\``);
      }

      // Active file context (light mode: metadata only, full mode: content)
      if (activeFilePath) {
        if (contextMode === 'light') {
          const activeContent = openFiles?.[activeFilePath]?.content || '';
          const activeLineCount = activeContent ? activeContent.split('\n').length : null;
          const activeSummary = [
            '### Active File',
            `- Path: ${activeFilePath}`,
            activeLineCount ? `- Lines: ${activeLineCount}` : null,
          ].filter(Boolean).join('\n');
          projectParts.push(activeSummary);
        } else if (openFiles?.[activeFilePath]) {
          const content = openFiles[activeFilePath].content || '';
          const lines = content.split('\n');

          // Include full file if under 800 lines, otherwise smart truncation
          let fileContent = content;
          if (lines.length > 800) {
            // Include first 200, last 200, and note about omission
            fileContent = [
              lines.slice(0, 200).join('\n'),
              `\n// ... ${lines.length - 400} lines omitted (file is ${lines.length} lines total) ...\n`,
              lines.slice(-200).join('\n'),
            ].join('\n');
          }

          projectParts.push(`### Currently Open: ${activeFilePath}\n\`\`\`\n${fileContent}\n\`\`\``);
        } else {
          projectParts.push(`### Active File\n${activeFilePath}`);
        }
      }

      // Other/open files context
      const otherFiles = knownOpenFiles.filter((p) => p && p !== activeFilePath);
      if (otherFiles.length > 0) {
        if (contextMode === 'light') {
          const list = otherFiles.slice(0, 20).map((p) => `- ${p}`).join('\n');
          const extra = otherFiles.length > 20 ? `\n- ...and ${otherFiles.length - 20} more open files` : '';
          projectParts.push(`### Open Files\n${list}${extra}`);
        } else {
          const otherFileParts = [];
          const maxOtherFiles = 5;
          const maxLinesPerFile = 50;

          for (const filePath of otherFiles.slice(0, maxOtherFiles)) {
            const content = openFiles[filePath]?.content || '';
            const lines = content.split('\n');
            const preview = lines.slice(0, maxLinesPerFile).join('\n');
            const truncated = lines.length > maxLinesPerFile ? `\n// ... ${lines.length - maxLinesPerFile} more lines ...` : '';
            otherFileParts.push(`#### ${filePath} (${lines.length} lines)\n\`\`\`\n${preview}${truncated}\n\`\`\``);
          }

          if (otherFiles.length > maxOtherFiles) {
            otherFileParts.push(`_...and ${otherFiles.length - maxOtherFiles} more open files_`);
          }

          projectParts.push(`### Other Open Files\n${otherFileParts.join('\n\n')}`);
        }
      }

      const projectText = projectParts.join('\n\n') + '\n';
      const tokens = estimateTokens(projectText);

      // Full mode can overrun budget for richer code context; light mode should stay tighter.
      const projectBudget = contextMode === 'light'
        ? budget.projectContext
        : budget.projectContext * 2; // Allow 100% overage for full code context

      if (tokens <= projectBudget) {
        contextParts.push({ type: 'projectContext', content: projectText, tokens, priority: 'high' });
        totalTokensUsed += tokens;
      } else {
        // If still too big, try with just active file and tree (no other files preview/list)
        const fallbackParts = projectParts.filter((p) => !p.startsWith('### Other Open Files') && !p.startsWith('### Open Files'));
        const fallbackText = fallbackParts.join('\n\n') + '\n';
        const fallbackTokens = estimateTokens(fallbackText);
        if (fallbackTokens <= projectBudget) {
          contextParts.push({ type: 'projectContext', content: fallbackText, tokens: fallbackTokens, priority: 'high' });
          totalTokensUsed += fallbackTokens;
        }
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. CONVERSATION SUMMARY (For older messages)
  // ═══════════════════════════════════════════════════════════════════════════
  if (messages.length > 30) {
    try {
      // Get or generate conversation summary
      let summary = await api.memoryGetStats?.({ conversationId });
      
      // If we have lots of messages but no summary, build one
      if (!summary?.summary && messages.length > 50) {
        // Generate summary from older messages
        const olderMessages = messages.slice(0, -30);
        const summaryText = buildConversationSummary(olderMessages);
        
        if (summaryText) {
          const summarySection = `## Earlier in This Conversation\n${summaryText}\n`;
          const tokens = estimateTokens(summarySection);
          
          if (tokens <= budget.conversationSummary) {
            contextParts.push({ type: 'conversationSummary', content: summarySection, tokens });
            totalTokensUsed += tokens;
          }
        }
      }
    } catch (e) {
      console.warn('[FullContext] Summary unavailable:', e);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 7. RECENT MESSAGES (Most important - what we're actually talking about)
  // ═══════════════════════════════════════════════════════════════════════════
  const remainingBudget = availableTokens - totalTokensUsed;
  
  // Build structured messages array for /api/chat
  const recentMsgs = buildRecentMessagesArray(messages, remainingBudget);
  
  if (recentMsgs.messages.length > 0) {
    contextParts.push({
      type: 'recentMessages',
      content: '', // Not used — chatMessages carries the data
      chatMessages: recentMsgs.messages,
      tokens: recentMsgs.tokens,
      messagesIncluded: recentMsgs.count,
      priority: 'critical'
    });
    totalTokensUsed += recentMsgs.tokens;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLE FINAL CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Sort by priority then by type order
  const priorityOrder = { critical: 0, high: 1, normal: 2 };
  const typeOrder = [
    'userProfile', 'memories', 'pinnedMessages', 
    'conversationSummary', 'projectContext', 'ragContext', 'recentMessages'
  ];
  
  contextParts.sort((a, b) => {
    const aPriority = priorityOrder[a.priority] ?? 2;
    const bPriority = priorityOrder[b.priority] ?? 2;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
  });
  
  // Build system prompt (everything except recent messages)
  const systemPromptParts = [systemPromptBase];
  
  for (const part of contextParts) {
    if (part.type !== 'recentMessages' && part.content) {
      systemPromptParts.push(part.content);
    }
  }
  
  const systemPrompt = systemPromptParts.join('\n\n');
  
  // Extract the structured chat messages
  const recentPart = contextParts.find(p => p.type === 'recentMessages');
  const chatMessages = recentPart?.chatMessages || [];
  
  // Also build legacy text prompt for fallback
  const conversationPrompt = chatMessages
    .map(m => m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`)
    .join('\n\n');
  
  return {
    systemPrompt,
    conversationPrompt,      // Legacy text fallback
    chatMessages,            // Structured messages for /api/chat
    totalTokensUsed,
    maxContextTokens,
    utilizationPercent: Math.round((totalTokensUsed / maxContextTokens) * 100),
    breakdown: contextParts.map(p => ({
      type: p.type,
      tokens: p.tokens,
      priority: p.priority || 'normal',
    })),
    messagesIncluded: recentPart?.messagesIncluded || 0,
  };
}

/**
 * Build condensed file tree
 */
function buildCondensedFileTree(files, maxLines) {
  const lines = [];
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.nuxt', 'vendor', '.venv', 'venv', 'coverage']);
  
  const walk = (nodes, prefix = '', depth = 0) => {
    if (depth > 4 || lines.length >= maxLines) return;
    
    // Sort: directories first, then files, alphabetically within each group
    const sorted = [...(nodes || [])].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    
    for (const node of sorted) {
      if (lines.length >= maxLines) break;
      if (node.name.startsWith('.') && !node.name.startsWith('.env') && node.name !== '.eslintrc.json' && node.name !== '.prettierrc') continue;
      if (SKIP_DIRS.has(node.name)) continue;
      
      const isDir = node.type === 'dir';
      const childCount = isDir && node.children ? ` (${node.children.length})` : '';
      lines.push(`${prefix}${isDir ? '📁' : '  '} ${node.name}${childCount}`);
      
      if (isDir && node.children && lines.length < maxLines) {
        walk(node.children, prefix + '  ', depth + 1);
      }
    }
  };
  
  walk(files);
  return lines.slice(0, maxLines).join('\n');
}

/**
 * Build conversation summary from older messages
 */
function buildConversationSummary(messages) {
  if (messages.length < 10) return null;
  
  const topics = [];
  const keyExchanges = [];
  
  // Extract topics from user messages
  for (const msg of messages) {
    if (msg.role === 'user' && msg.content.length > 30) {
      // Simple topic extraction
      const firstSentence = msg.content.split(/[.!?]/)[0].substring(0, 100);
      if (firstSentence.length > 20) {
        topics.push(firstSentence);
      }
    }
  }
  
  // Sample key exchanges
  const sampleInterval = Math.max(2, Math.floor(messages.length / 10));
  for (let i = 0; i < messages.length; i += sampleInterval) {
    const msg = messages[i];
    if (msg.content.length > 50) {
      const snippet = msg.content.substring(0, 150).replace(/\n/g, ' ');
      keyExchanges.push(`${msg.role === 'user' ? 'You asked' : 'I explained'}: ${snippet}...`);
    }
  }
  
  const summaryParts = [];
  
  if (topics.length > 0) {
    summaryParts.push(`Topics discussed: ${[...new Set(topics)].slice(0, 5).join('; ')}`);
  }
  
  if (keyExchanges.length > 0) {
    summaryParts.push(`Key exchanges:\n${keyExchanges.slice(0, 5).map(e => `- ${e}`).join('\n')}`);
  }
  
  return summaryParts.join('\n\n');
}

/**
 * Build recent messages as a structured array for /api/chat.
 * Returns { messages: [{role, content}], tokens, count }
 */
function buildRecentMessagesArray(messages, maxTokens) {
  const result = [];
  let tokens = 0;
  let count = 0;
  
  // Walk backwards, including as many messages as fit in the budget
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg.content);
    
    if (tokens + msgTokens > maxTokens) {
      break;
    }
    
    result.unshift({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
    tokens += msgTokens;
    count++;
  }
  
  return { messages: result, tokens, count };
}

/**
 * Build recent messages context as text (legacy fallback)
 */
function buildRecentMessagesContext(messages, maxTokens) {
  const parts = [];
  let tokens = 0;
  let count = 0;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const text = msg.role === 'user' 
      ? `User: ${msg.content}\n\n`
      : `Assistant: ${msg.content}\n\n`;
    const msgTokens = estimateTokens(text);
    
    if (tokens + msgTokens > maxTokens) {
      if (i > 0) {
        const skippedNote = `[... ${i + 1} earlier messages ...]\n\n`;
        parts.unshift(skippedNote);
      }
      break;
    }
    
    parts.unshift(text);
    tokens += msgTokens;
    count++;
  }
  
  return {
    text: parts.join(''),
    tokens,
    count,
  };
}

export default {
  buildFullContext,
  getModelContextSize,
};
