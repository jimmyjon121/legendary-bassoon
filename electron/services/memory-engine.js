/**
 * Memory Engine - Long-term conversation memory for DevForge
 * 
 * Makes the AI feel like a real friend who remembers:
 * - Automatic conversation summarization
 * - Key facts/preferences extraction
 * - Smart context management for long conversations
 * - Pinned important messages
 * 
 * The goal: Have coherent 100+ message conversations without losing context
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Memory types
const MEMORY_TYPES = {
  FACT: 'fact',           // User preference, personal info
  CONTEXT: 'context',     // Important context from conversation
  SUMMARY: 'summary',     // Conversation summary
  PINNED: 'pinned',       // User-pinned important message
};

class MemoryEngine {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize with database reference
   */
  init(db) {
    this.db = db;
    this.ensureMemoryTables();
    this.initialized = true;
    console.log('[MemoryEngine] Initialized');
  }

  /**
   * Create memory tables if they don't exist
   */
  ensureMemoryTables() {
    if (!this.db) return;

    // Memories table - stores extracted facts and summaries
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        conversation_id TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 0,
        metadata TEXT
      )
    `);

    // Conversation summaries - rolling summaries of conversations
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id TEXT PRIMARY KEY,
        conversation_id TEXT UNIQUE NOT NULL,
        workspace TEXT NOT NULL,
        summary TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        last_message_id TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    // Pinned messages - messages user wants to always include in context
    this.db.run(`
      CREATE TABLE IF NOT EXISTS pinned_messages (
        id TEXT PRIMARY KEY,
        message_id TEXT UNIQUE NOT NULL,
        conversation_id TEXT NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    this.db.run('CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_summaries_conv ON conversation_summaries(conversation_id)');
  }

  /**
   * Build optimized context for a conversation
   * This is the key function that makes long conversations work
   * 
   * PHILOSOPHY: Use the FULL context window. Modern models support 32K-128K tokens.
   * Don't artificially limit to 4K when we have 128K available!
   */
  async buildContext(conversationId, workspace, recentMessages, options = {}) {
    const {
      maxTokens = 32768,     // Default to 32K - most modern models support this
      includeMemories = true,
      includeSummary = true,
      includePinned = true,
    } = options;
    
    console.log(`[MemoryEngine] Building context with ${maxTokens} token budget for ${recentMessages.length} messages`);

    const parts = [];
    let estimatedTokens = 0;

    // 1. Get conversation summary (if exists and conversation is long)
    if (includeSummary) {
      const summary = await this.getConversationSummary(conversationId);
      if (summary && recentMessages.length > 15) {
        const summaryText = `[Previous conversation summary: ${summary.summary}]\n\n`;
        parts.push({ type: 'summary', content: summaryText, tokens: this.estimateTokens(summaryText) });
        estimatedTokens += this.estimateTokens(summaryText);
      }
    }

    // 2. Get relevant memories for this workspace
    if (includeMemories) {
      const memories = await this.getRelevantMemories(workspace, recentMessages);
      if (memories.length > 0) {
        const memoryText = `[Things I remember about you: ${memories.map(m => m.content).join('; ')}]\n\n`;
        parts.push({ type: 'memories', content: memoryText, tokens: this.estimateTokens(memoryText) });
        estimatedTokens += this.estimateTokens(memoryText);
      }
    }

    // 3. Get pinned messages
    if (includePinned) {
      const pinned = await this.getPinnedMessages(conversationId);
      if (pinned.length > 0) {
        const pinnedText = pinned.map(p => 
          `[Important: ${p.role === 'user' ? 'You said' : 'I said'}: "${p.content.substring(0, 500)}"]`
        ).join('\n') + '\n\n';
        parts.push({ type: 'pinned', content: pinnedText, tokens: this.estimateTokens(pinnedText) });
        estimatedTokens += this.estimateTokens(pinnedText);
      }
    }

    // 4. Calculate how many recent messages we can include
    // Reserve 20% for response (not just 500 tokens)
    const responseReserve = Math.max(1000, Math.floor(maxTokens * 0.20));
    const remainingTokens = maxTokens - estimatedTokens - responseReserve;
    const messagesContext = this.buildMessagesContext(recentMessages, remainingTokens);
    parts.push({ type: 'messages', content: messagesContext.text, tokens: messagesContext.tokens });
    
    console.log(`[MemoryEngine] Context built: ${messagesContext.count}/${recentMessages.length} messages, ~${parts.reduce((sum, p) => sum + p.tokens, 0)} tokens used of ${maxTokens}`);

    return {
      contextText: parts.map(p => p.content).join(''),
      parts,
      totalTokens: parts.reduce((sum, p) => sum + p.tokens, 0),
      messagesIncluded: messagesContext.count,
    };
  }

  /**
   * Build messages context, fitting as many as possible into token limit
   */
  buildMessagesContext(messages, maxTokens) {
    let text = '';
    let tokens = 0;
    let count = 0;

    // Start from most recent and work backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgText = msg.role === 'user' 
        ? `Human: ${msg.content}\n\n`
        : `Assistant: ${msg.content}\n\n`;
      const msgTokens = this.estimateTokens(msgText);

      if (tokens + msgTokens > maxTokens) break;

      text = msgText + text;
      tokens += msgTokens;
      count++;
    }

    return { text, tokens, count };
  }

  /**
   * Extract facts/memories from a conversation
   * Called periodically or after important exchanges
   */
  async extractMemories(conversationId, messages, workspace, model) {
    if (!this.db || messages.length < 5) return [];

    // Build a prompt to extract key facts
    const recentExchanges = messages.slice(-10).map(m => 
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n');

    const extractionPrompt = `Analyze this conversation and extract key facts about the user. 
Focus on: preferences, personal info, goals, opinions, recurring topics.
Only extract clear, factual statements. Be concise.

Conversation:
${recentExchanges}

List 0-3 key facts (one per line), or "NONE" if no new facts:`;

    // This would call the LLM - for now we do simple pattern extraction
    const facts = this.simpleFactExtraction(messages);
    
    // Store extracted facts
    for (const fact of facts) {
      await this.addMemory({
        workspace,
        conversationId,
        type: MEMORY_TYPES.FACT,
        content: fact,
        importance: 0.7,
      });
    }

    return facts;
  }

  /**
   * Simple fact extraction without LLM (fast fallback)
   */
  simpleFactExtraction(messages) {
    const facts = [];
    const patterns = [
      /(?:my name is|i'm called|call me)\s+(\w+)/i,
      /(?:i work as|i'm a|my job is)\s+(.+?)(?:\.|,|$)/i,
      /(?:i live in|i'm from|i'm based in)\s+(.+?)(?:\.|,|$)/i,
      /(?:i like|i love|i enjoy|i prefer)\s+(.+?)(?:\.|,|$)/i,
      /(?:i hate|i don't like|i dislike)\s+(.+?)(?:\.|,|$)/i,
      /(?:i always|i usually|i often)\s+(.+?)(?:\.|,|$)/i,
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      
      for (const pattern of patterns) {
        const match = msg.content.match(pattern);
        if (match) {
          const fact = match[0].trim();
          if (fact.length > 10 && fact.length < 200) {
            facts.push(fact);
          }
        }
      }
    }

    return [...new Set(facts)].slice(0, 5); // Dedupe and limit
  }

  /**
   * Update conversation summary
   * Called after every ~10 messages
   */
  async updateSummary(conversationId, messages, workspace) {
    if (!this.db || messages.length < 10) return null;

    // Get existing summary
    const existing = await this.getConversationSummary(conversationId);
    
    // Only update if we have significantly more messages
    if (existing && existing.message_count >= messages.length - 5) {
      return existing;
    }

    // Build summary from conversation
    // In a full implementation, this would use the LLM
    // For now, do a simple extraction
    const keyPoints = this.extractKeyPoints(messages);
    const summary = keyPoints.join(' ');

    // Store/update summary
    const id = `summary_${conversationId}`;
    this.db.run(`
      INSERT OR REPLACE INTO conversation_summaries 
      (id, conversation_id, workspace, summary, message_count, last_message_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [id, conversationId, workspace, summary, messages.length, messages[messages.length - 1]?.id]);

    return { summary, message_count: messages.length };
  }

  /**
   * Extract key points from conversation
   */
  extractKeyPoints(messages) {
    const points = [];
    
    // Get first message (usually sets the topic)
    if (messages.length > 0) {
      const first = messages[0];
      if (first.role === 'user' && first.content.length > 20) {
        points.push(`Started discussing: ${first.content.substring(0, 100)}...`);
      }
    }

    // Sample important-looking messages
    const sampleInterval = Math.max(1, Math.floor(messages.length / 5));
    for (let i = sampleInterval; i < messages.length; i += sampleInterval) {
      const msg = messages[i];
      if (msg.content.length > 50) {
        const snippet = msg.content.substring(0, 80).replace(/\n/g, ' ');
        points.push(`${msg.role === 'user' ? 'User asked about' : 'Discussed'}: ${snippet}...`);
      }
    }

    return points.slice(0, 5);
  }

  /**
   * Add a memory
   */
  async addMemory({ workspace, conversationId, type, content, importance = 0.5, metadata = {} }) {
    if (!this.db) return null;

    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    this.db.run(`
      INSERT INTO memories (id, workspace, conversation_id, type, content, importance, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, workspace, conversationId, type, content, importance, JSON.stringify(metadata)]);

    return id;
  }

  /**
   * Get relevant memories for context
   */
  async getRelevantMemories(workspace, recentMessages, limit = 10) {
    if (!this.db) return [];

    try {
      // Get high-importance memories for this workspace
      const stmt = this.db.prepare(`
        SELECT * FROM memories 
        WHERE workspace = ? AND type IN ('fact', 'context')
        ORDER BY importance DESC, last_accessed DESC
        LIMIT ?
      `);
      stmt.bind([workspace, limit]);

      const memories = [];
      while (stmt.step()) {
        memories.push(stmt.getAsObject());
      }
      stmt.free();

      // Update access time for retrieved memories
      for (const mem of memories) {
        this.db.run(`
          UPDATE memories 
          SET last_accessed = CURRENT_TIMESTAMP, access_count = access_count + 1 
          WHERE id = ?
        `, [mem.id]);
      }

      return memories;
    } catch (error) {
      console.error('[MemoryEngine] getRelevantMemories error:', error);
      return [];
    }
  }

  /**
   * Get conversation summary
   */
  async getConversationSummary(conversationId) {
    if (!this.db) return null;

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM conversation_summaries WHERE conversation_id = ?
      `);
      stmt.bind([conversationId]);
      
      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
      }
      stmt.free();
      return null;
    } catch (error) {
      console.error('[MemoryEngine] getConversationSummary error:', error);
      return null;
    }
  }

  /**
   * Pin a message
   */
  async pinMessage(messageId, conversationId, reason = '') {
    if (!this.db) return false;

    const id = `pin_${messageId}`;
    try {
      this.db.run(`
        INSERT OR REPLACE INTO pinned_messages (id, message_id, conversation_id, reason)
        VALUES (?, ?, ?, ?)
      `, [id, messageId, conversationId, reason]);
      return true;
    } catch (error) {
      console.error('[MemoryEngine] pinMessage error:', error);
      return false;
    }
  }

  /**
   * Unpin a message
   */
  async unpinMessage(messageId) {
    if (!this.db) return false;

    try {
      this.db.run('DELETE FROM pinned_messages WHERE message_id = ?', [messageId]);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get pinned messages for a conversation
   */
  async getPinnedMessages(conversationId) {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT m.*, p.reason as pin_reason
        FROM pinned_messages p
        JOIN messages m ON p.message_id = m.id
        WHERE p.conversation_id = ?
        ORDER BY m.created_at ASC
      `);
      stmt.bind([conversationId]);

      const pinned = [];
      while (stmt.step()) {
        pinned.push(stmt.getAsObject());
      }
      stmt.free();
      return pinned;
    } catch (error) {
      console.error('[MemoryEngine] getPinnedMessages error:', error);
      return [];
    }
  }

  /**
   * Check if a message is pinned
   */
  async isMessagePinned(messageId) {
    if (!this.db) return false;

    try {
      const stmt = this.db.prepare('SELECT 1 FROM pinned_messages WHERE message_id = ?');
      stmt.bind([messageId]);
      const isPinned = stmt.step();
      stmt.free();
      return isPinned;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get all memories for a workspace
   */
  async getWorkspaceMemories(workspace) {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM memories WHERE workspace = ?
        ORDER BY importance DESC, created_at DESC
      `);
      stmt.bind([workspace]);

      const memories = [];
      while (stmt.step()) {
        memories.push(stmt.getAsObject());
      }
      stmt.free();
      return memories;
    } catch (error) {
      return [];
    }
  }

  /**
   * Delete a memory
   */
  async deleteMemory(memoryId) {
    if (!this.db) return false;

    try {
      this.db.run('DELETE FROM memories WHERE id = ?', [memoryId]);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Estimate tokens (rough approximation)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get memory stats
   */
  async getStats(workspace) {
    if (!this.db) return null;

    try {
      const memoryCount = this.db.exec(`SELECT COUNT(*) as count FROM memories WHERE workspace = '${workspace}'`);
      const summaryCount = this.db.exec(`SELECT COUNT(*) as count FROM conversation_summaries WHERE workspace = '${workspace}'`);
      const pinnedCount = this.db.exec(`SELECT COUNT(*) as count FROM pinned_messages`);

      return {
        memories: memoryCount[0]?.values[0]?.[0] || 0,
        summaries: summaryCount[0]?.values[0]?.[0] || 0,
        pinned: pinnedCount[0]?.values[0]?.[0] || 0,
      };
    } catch (error) {
      return { memories: 0, summaries: 0, pinned: 0 };
    }
  }
}

// Singleton
let memoryEngineInstance = null;

function getMemoryEngine() {
  if (!memoryEngineInstance) {
    memoryEngineInstance = new MemoryEngine();
  }
  return memoryEngineInstance;
}

module.exports = {
  MemoryEngine,
  getMemoryEngine,
  MEMORY_TYPES,
};
