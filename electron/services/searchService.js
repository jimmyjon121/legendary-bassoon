/**
 * Search Service - Full-text search across conversations and messages
 * Implements indexing, search, and filtering capabilities
 */

const { ipcMain } = require('electron');

/**
 * Simple in-memory full-text search index
 * For larger datasets, consider SQLite FTS5 or a dedicated search library
 */
class SearchIndex {
  constructor() {
    this.documents = new Map(); // id -> document
    this.invertedIndex = new Map(); // term -> Set<docId>
    this.docStats = new Map(); // id -> { termCount, terms }
    this.totalDocs = 0;
  }

  /**
   * Tokenize text into searchable terms
   */
  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2)
      .map(term => term.trim());
  }

  /**
   * Add a document to the index
   */
  addDocument(id, doc) {
    // Remove existing document if present
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    // Create searchable text from document fields
    const searchableText = [
      doc.title || '',
      doc.content || '',
      doc.preview || '',
      (doc.tags || []).join(' '),
      doc.model || ''
    ].join(' ');

    const terms = this.tokenize(searchableText);
    const termSet = new Set(terms);

    // Store document
    this.documents.set(id, {
      ...doc,
      id,
      indexedAt: Date.now()
    });

    // Update inverted index
    for (const term of termSet) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set());
      }
      this.invertedIndex.get(term).add(id);
    }

    // Store document stats for ranking
    this.docStats.set(id, {
      termCount: terms.length,
      uniqueTerms: termSet.size,
      terms: termSet
    });

    this.totalDocs++;
  }

  /**
   * Remove a document from the index
   */
  removeDocument(id) {
    if (!this.documents.has(id)) return false;

    const stats = this.docStats.get(id);
    if (stats) {
      // Remove from inverted index
      for (const term of stats.terms) {
        const termDocs = this.invertedIndex.get(term);
        if (termDocs) {
          termDocs.delete(id);
          if (termDocs.size === 0) {
            this.invertedIndex.delete(term);
          }
        }
      }
    }

    this.documents.delete(id);
    this.docStats.delete(id);
    this.totalDocs--;
    return true;
  }

  /**
   * Search the index
   */
  search(query, options = {}) {
    const {
      limit = 50,
      offset = 0,
      filters = {},
      sortBy = 'relevance',
      sortOrder = 'desc'
    } = options;

    if (!query || typeof query !== 'string') {
      return { results: [], total: 0, query: '' };
    }

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) {
      return { results: [], total: 0, query };
    }

    // Find documents containing any query term
    const docScores = new Map();
    const matchedDocs = new Set();

    for (const term of queryTerms) {
      const docs = this.invertedIndex.get(term);
      if (docs) {
        for (const docId of docs) {
          matchedDocs.add(docId);
          
          // Calculate TF-IDF-like score
          const idf = Math.log(this.totalDocs / (docs.size + 1));
          const currentScore = docScores.get(docId) || 0;
          docScores.set(docId, currentScore + idf);
        }
      }

      // Also search for partial matches (prefix)
      for (const [indexTerm, docs] of this.invertedIndex) {
        if (indexTerm.startsWith(term) && indexTerm !== term) {
          for (const docId of docs) {
            matchedDocs.add(docId);
            const currentScore = docScores.get(docId) || 0;
            docScores.set(docId, currentScore + 0.5); // Lower weight for partial matches
          }
        }
      }
    }

    // Get matched documents
    let results = [];
    for (const docId of matchedDocs) {
      const doc = this.documents.get(docId);
      if (!doc) continue;

      // Apply filters
      if (!this.matchesFilters(doc, filters)) continue;

      // Calculate highlight snippets
      const highlights = this.getHighlights(doc, queryTerms);

      results.push({
        ...doc,
        score: docScores.get(docId) || 0,
        highlights
      });
    }

    // Sort results
    results.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'relevance':
          comparison = b.score - a.score;
          break;
        case 'date':
          comparison = new Date(b.updatedAt || b.createdAt || 0) - 
                       new Date(a.updatedAt || a.createdAt || 0);
          break;
        case 'title':
          comparison = (a.title || '').localeCompare(b.title || '');
          break;
        default:
          comparison = b.score - a.score;
      }

      return sortOrder === 'desc' ? comparison : -comparison;
    });

    const total = results.length;
    results = results.slice(offset, offset + limit);

    return {
      results,
      total,
      query,
      terms: queryTerms,
      took: Date.now()
    };
  }

  /**
   * Check if document matches filters
   */
  matchesFilters(doc, filters) {
    if (filters.workspace && doc.workspace !== filters.workspace) {
      return false;
    }
    if (filters.model && doc.model !== filters.model) {
      return false;
    }
    if (filters.dateFrom && new Date(doc.createdAt) < new Date(filters.dateFrom)) {
      return false;
    }
    if (filters.dateTo && new Date(doc.createdAt) > new Date(filters.dateTo)) {
      return false;
    }
    if (filters.pinned !== undefined && doc.pinned !== filters.pinned) {
      return false;
    }
    if (filters.starred !== undefined && doc.starred !== filters.starred) {
      return false;
    }
    return true;
  }

  /**
   * Get highlighted snippets
   */
  getHighlights(doc, queryTerms) {
    const highlights = {};
    const fields = ['title', 'content', 'preview'];

    for (const field of fields) {
      const text = doc[field];
      if (!text) continue;

      const lowerText = text.toLowerCase();
      const snippets = [];

      for (const term of queryTerms) {
        const index = lowerText.indexOf(term);
        if (index !== -1) {
          // Get surrounding context
          const start = Math.max(0, index - 40);
          const end = Math.min(text.length, index + term.length + 40);
          let snippet = text.slice(start, end);
          
          if (start > 0) snippet = '...' + snippet;
          if (end < text.length) snippet = snippet + '...';
          
          snippets.push(snippet);
        }
      }

      if (snippets.length > 0) {
        highlights[field] = snippets.slice(0, 2);
      }
    }

    return highlights;
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      totalDocuments: this.totalDocs,
      totalTerms: this.invertedIndex.size,
      avgTermsPerDoc: this.totalDocs > 0 
        ? Math.round([...this.docStats.values()].reduce((a, b) => a + b.uniqueTerms, 0) / this.totalDocs)
        : 0
    };
  }

  /**
   * Clear the index
   */
  clear() {
    this.documents.clear();
    this.invertedIndex.clear();
    this.docStats.clear();
    this.totalDocs = 0;
  }
}

/**
 * Search Service singleton
 */
class SearchService {
  constructor() {
    this.conversationIndex = new SearchIndex();
    this.messageIndex = new SearchIndex();
    this.isIndexing = false;
    this.lastIndexTime = null;
  }

  /**
   * Index a conversation
   */
  indexConversation(conversation) {
    this.conversationIndex.addDocument(conversation.id, {
      title: conversation.title,
      preview: conversation.preview,
      workspace: conversation.workspace,
      model: conversation.model,
      pinned: conversation.pinned,
      starred: conversation.starred,
      tags: conversation.tags,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messageCount
    });
  }

  /**
   * Index a message (includes workspace for isolation)
   */
  indexMessage(message, conversationId, workspace) {
    this.messageIndex.addDocument(message.id, {
      content: message.content,
      role: message.role,
      model: message.model,
      conversationId,
      workspace, // Required for workspace isolation (especially NSFW)
      createdAt: message.timestamp || message.createdAt
    });
  }

  /**
   * Remove a conversation from index
   */
  removeConversation(conversationId) {
    this.conversationIndex.removeDocument(conversationId);
    
    // Also remove all messages from this conversation
    for (const [id, doc] of this.messageIndex.documents) {
      if (doc.conversationId === conversationId) {
        this.messageIndex.removeDocument(id);
      }
    }
  }

  /**
   * Search conversations
   */
  searchConversations(query, options = {}) {
    return this.conversationIndex.search(query, options);
  }

  /**
   * Search messages
   */
  searchMessages(query, options = {}) {
    return this.messageIndex.search(query, options);
  }

  /**
   * Search everywhere
   */
  searchAll(query, options = {}) {
    const convResults = this.searchConversations(query, { ...options, limit: options.limit || 20 });
    const msgResults = this.searchMessages(query, { ...options, limit: options.limit || 30 });

    return {
      conversations: convResults,
      messages: msgResults,
      query,
      total: convResults.total + msgResults.total
    };
  }

  /**
   * Rebuild index from database
   */
  async rebuildIndex(database) {
    if (this.isIndexing) {
      return { success: false, reason: 'Indexing already in progress' };
    }

    this.isIndexing = true;
    const startTime = Date.now();

    try {
      // Clear existing indexes
      this.conversationIndex.clear();
      this.messageIndex.clear();

      // Index all conversations
      const conversations = await database.getConversations();
      for (const conv of conversations) {
        this.indexConversation(conv);
        
        // Index messages for this conversation (with workspace for isolation)
        const messages = await database.getMessages(conv.id);
        for (const msg of messages) {
          this.indexMessage(msg, conv.id, conv.workspace);
        }
      }

      this.lastIndexTime = Date.now();
      const duration = Date.now() - startTime;

      console.log(`[SearchService] Index rebuilt in ${duration}ms`);

      return {
        success: true,
        conversations: this.conversationIndex.totalDocs,
        messages: this.messageIndex.totalDocs,
        duration
      };
    } catch (error) {
      console.error('[SearchService] Index rebuild failed:', error);
      return { success: false, error: error.message };
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      conversations: this.conversationIndex.getStats(),
      messages: this.messageIndex.getStats(),
      lastIndexTime: this.lastIndexTime,
      isIndexing: this.isIndexing
    };
  }
}

// Singleton instance
const searchService = new SearchService();

/**
 * Setup IPC handlers for search
 * IMPORTANT: All search handlers enforce workspace filtering to prevent NSFW content leakage
 */
function setupSearchIPC() {
  // Search conversations - workspace filter is required
  ipcMain.handle('search:conversations', (_, query, options = {}) => {
    // Ensure workspace filter is present for isolation (especially NSFW)
    if (!options.filters?.workspace) {
      console.warn('[SearchService] search:conversations called without workspace filter');
      return { results: [], total: 0, query, error: 'workspace filter required' };
    }
    return searchService.searchConversations(query, options);
  });
  
  // Search messages - workspace filter is required
  ipcMain.handle('search:messages', (_, query, options = {}) => {
    // Ensure workspace filter is present for isolation (especially NSFW)
    if (!options.filters?.workspace) {
      console.warn('[SearchService] search:messages called without workspace filter');
      return { results: [], total: 0, query, error: 'workspace filter required' };
    }
    return searchService.searchMessages(query, options);
  });
  
  // Search all - workspace filter is required
  ipcMain.handle('search:all', (_, query, options = {}) => {
    // Ensure workspace filter is present for isolation (especially NSFW)
    if (!options.filters?.workspace) {
      console.warn('[SearchService] search:all called without workspace filter');
      return { 
        conversations: { results: [], total: 0 }, 
        messages: { results: [], total: 0 }, 
        query, 
        total: 0,
        error: 'workspace filter required' 
      };
    }
    return searchService.searchAll(query, options);
  });
  
  ipcMain.handle('search:getStats', () => 
    searchService.getStats()
  );
  
  ipcMain.handle('search:indexConversation', (_, conversation) => {
    searchService.indexConversation(conversation);
    return true;
  });
  
  // Index message with workspace for proper isolation
  ipcMain.handle('search:indexMessage', (_, message, conversationId, workspace) => {
    searchService.indexMessage(message, conversationId, workspace);
    return true;
  });
  
  ipcMain.handle('search:removeConversation', (_, conversationId) => {
    searchService.removeConversation(conversationId);
    return true;
  });
}

module.exports = {
  searchService,
  SearchService,
  SearchIndex,
  setupSearchIPC,
};




