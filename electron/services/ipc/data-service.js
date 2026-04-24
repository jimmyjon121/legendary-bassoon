const path = require('path');
const { saveAttachmentForMessage, readAttachment } = require('../image-storage');

function normalizeTags(tagsValue) {
  if (Array.isArray(tagsValue)) return tagsValue;
  if (typeof tagsValue !== 'string' || !tagsValue.trim()) return [];
  try {
    const parsed = JSON.parse(tagsValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toBool(value) {
  return value === true || value === 1 || value === '1';
}

class DataService {
  constructor({ getDb, saveDatabase }) {
    this.getDb = getDb;
    this.saveDatabase = typeof saveDatabase === 'function' ? saveDatabase : () => {};
    this._attachmentsSchemaReady = false;
    this._coreIndexesReady = false;

    try {
      this.ensureCoreIndexes();
    } catch (error) {
      console.warn('[DataService] Failed to ensure core indexes:', error.message);
    }
  }

  _db() {
    const db = this.getDb?.();
    if (!db) {
      throw new Error('Database not initialized');
    }
    return db;
  }

  _query(sql, params = []) {
    const db = this._db();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  _queryOne(sql, params = []) {
    const rows = this._query(sql, params);
    return rows[0] || null;
  }

  _run(sql, params = [], { persist = true, reason = 'data-service:write' } = {}) {
    const db = this._db();
    db.run(sql, params);
    const changes = typeof db.getRowsModified === 'function' ? db.getRowsModified() : 0;
    if (persist) {
      this._persist(reason);
    }
    return { changes };
  }

  _persist(reason = 'data-service:write', priority = 'normal') {
    try {
      const result = this.saveDatabase({ reason, priority });
      if (result && typeof result.then === 'function') {
        result.catch((error) => {
          console.error('[DataService] Persist failed:', error?.message || error);
        });
      }
    } catch (error) {
      console.error('[DataService] Persist failed:', error?.message || error);
    }
  }

  ensureCoreIndexes() {
    if (this._coreIndexesReady) return;
    const db = this._db();
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_conversations_workspace_updated_at ON conversations(workspace, updated_at)');
    this._persist('data-service:indexes', 'low');
    this._coreIndexesReady = true;
  }

  _normalizeConversation(row) {
    if (!row) return null;
    return {
      ...row,
      pinned: toBool(row.pinned) ? 1 : 0,
      starred: toBool(row.starred) ? 1 : 0,
      encrypted: toBool(row.encrypted) ? 1 : 0,
      tags: normalizeTags(row.tags),
    };
  }

  _normalizeAttachment(row) {
    if (!row) return null;
    const mime = row.mime_type || '';
    return {
      id: row.id,
      message_id: row.message_id,
      original_name: row.original_name,
      file_path: row.file_path,
      mime_type: mime,
      type: row.type || (mime.startsWith('image/') ? 'image' : 'file'),
      size: row.size,
      encrypted: toBool(row.encrypted),
      created_at: row.created_at,
    };
  }

  ensureAttachmentsSchema() {
    if (this._attachmentsSchemaReady) return;
    const db = this._db();
    db.run(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        type TEXT,
        file_path TEXT NOT NULL,
        mime_type TEXT,
        original_name TEXT,
        size INTEGER,
        encrypted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id)');
    this._persist('data-service:attachments-schema', 'low');
    this._attachmentsSchemaReady = true;
  }

  conversationsList({ workspace, limit = 500, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const where = [];
    const params = [];
    if (workspace) {
      where.push('workspace = ?');
      params.push(workspace);
    } else {
      // When no workspace is specified, ALWAYS exclude nsfw conversations.
      // They must only be accessible via explicit workspace='nsfw' request.
      where.push("workspace != 'nsfw'");
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this._query(
      `SELECT * FROM conversations ${whereSql} ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
      [...params, safeLimit, safeOffset]
    );
    return rows.map((row) => this._normalizeConversation(row));
  }

  conversationsCreate(payload = {}) {
    const {
      id,
      workspace,
      title = 'New Chat',
      model = null,
      encrypted = 0,
      pinned = 0,
      starred = 0,
      tags = [],
      folder_id = null,
      message_count = 0,
      preview = null,
    } = payload;

    if (!id || !workspace) {
      throw new Error('id and workspace are required');
    }

    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);

    this._run(
      `INSERT INTO conversations
      (id, workspace, title, model, encrypted, pinned, starred, tags, folder_id, message_count, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspace,
        title,
        model,
        encrypted ? 1 : 0,
        pinned ? 1 : 0,
        starred ? 1 : 0,
        tagsJson,
        folder_id,
        Number(message_count) || 0,
        preview,
      ]
    );

    return this.conversationsGetById({ id });
  }

  conversationsGetById({ id }) {
    if (!id) return null;
    const row = this._queryOne('SELECT * FROM conversations WHERE id = ?', [id]);
    return this._normalizeConversation(row);
  }

  conversationsUpdateMeta(payload = {}) {
    const { id } = payload;
    if (!id) {
      throw new Error('Conversation id is required');
    }

    const updates = [];
    const params = [];

    if (payload.title !== undefined) {
      updates.push('title = ?');
      params.push(payload.title);
    }
    if (payload.model !== undefined) {
      updates.push('model = ?');
      params.push(payload.model);
    }
    if (payload.preview !== undefined) {
      updates.push('preview = ?');
      params.push(payload.preview);
    }
    if (payload.messageCount !== undefined) {
      updates.push('message_count = ?');
      params.push(Number(payload.messageCount) || 0);
    }
    if (payload.folderId !== undefined) {
      updates.push('folder_id = ?');
      params.push(payload.folderId || null);
    }
    if (payload.starred !== undefined) {
      updates.push('starred = ?');
      params.push(payload.starred ? 1 : 0);
    }
    if (payload.pinned !== undefined) {
      updates.push('pinned = ?');
      params.push(payload.pinned ? 1 : 0);
    }
    if (payload.tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []));
    }
    if (payload.encrypted !== undefined) {
      updates.push('encrypted = ?');
      params.push(payload.encrypted ? 1 : 0);
    }

    updates.push('updated_at = ?');
    params.push(payload.updatedAt || new Date().toISOString());

    params.push(id);
    this._run(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`, params);

    return this.conversationsGetById({ id });
  }

  conversationsDelete({ id }) {
    if (!id) {
      throw new Error('Conversation id is required');
    }
    const result = this._run('DELETE FROM conversations WHERE id = ?', [id]);
    return {
      success: true,
      ...result,
    };
  }

  messagesListByConversation({ conversationId, branchId = null, includeAllBranches = false, limit = 5000, offset = 0 } = {}) {
    if (!conversationId) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 10000));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const filters = ['conversation_id = ?'];
    const params = [conversationId];

    if (!includeAllBranches) {
      if (branchId) {
        filters.push('(branch_id IS NULL OR branch_id = ?)');
        params.push(branchId);
      } else {
        // Treat empty/null branch ids as the root branch and include the
        // virtual "main" branch used by Chat V2.
        filters.push("(branch_id IS NULL OR branch_id = '' OR branch_id = 'main')");
      }
    }

    const rows = this._query(
      `SELECT * FROM messages WHERE ${filters.join(' AND ')} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
      [...params, safeLimit, safeOffset]
    );

    return rows;
  }

  messagesAppend(payload = {}) {
    const {
      id,
      conversationId,
      role,
      content,
      model = null,
      tokensUsed = null,
      createdAt = null,
      branchId = null,
      parentMessageId = null,
    } = payload;

    if (!id || !conversationId || !role) {
      throw new Error('id, conversationId, and role are required');
    }

    const created = createdAt || new Date().toISOString();

    this._run(
      `INSERT INTO messages
      (id, conversation_id, role, content, model, tokens_used, created_at, branch_id, parent_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, conversationId, role, content || '', model, tokensUsed, created, branchId, parentMessageId],
      { persist: false }
    );

    this._run(
      'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [conversationId],
      { persist: true }
    );

    return this.messagesGetById({ id });
  }

  messagesGetById({ id }) {
    if (!id) return null;
    return this._queryOne('SELECT * FROM messages WHERE id = ?', [id]);
  }

  messagesUpdate(payload = {}) {
    const { id } = payload;
    if (!id) {
      throw new Error('Message id is required');
    }

    const updates = [];
    const params = [];

    if (payload.content !== undefined) {
      updates.push('content = ?');
      params.push(payload.content);
    }
    if (payload.model !== undefined) {
      updates.push('model = ?');
      params.push(payload.model);
    }
    if (payload.tokensUsed !== undefined) {
      updates.push('tokens_used = ?');
      params.push(payload.tokensUsed);
    }
    if (payload.branchId !== undefined) {
      updates.push('branch_id = ?');
      params.push(payload.branchId);
    }
    if (payload.parentMessageId !== undefined) {
      updates.push('parent_message_id = ?');
      params.push(payload.parentMessageId);
    }

    if (updates.length === 0) {
      return this.messagesGetById({ id });
    }

    params.push(id);
    this._run(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`, params);

    if (payload.conversationId) {
      this._run(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [payload.conversationId]
      );
    }

    return this.messagesGetById({ id });
  }

  messagesDelete({ id, conversationId = null } = {}) {
    if (!id) {
      throw new Error('Message id is required');
    }
    const result = this._run('DELETE FROM messages WHERE id = ?', [id]);

    if (conversationId) {
      this._run('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);
    }

    return {
      success: true,
      ...result,
    };
  }

  messagesDeleteMany({ ids = [], conversationId = null } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: true, changes: 0 };
    }

    const placeholders = ids.map(() => '?').join(', ');
    const result = this._run(`DELETE FROM messages WHERE id IN (${placeholders})`, ids);

    if (conversationId) {
      this._run('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);
    }

    return {
      success: true,
      ...result,
    };
  }

  messagesSearch({ query, workspace = null, conversationId = null, limit = 20 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];

    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    const filters = ['m.content LIKE ?'];
    const params = [`%${q}%`];

    if (workspace) {
      filters.push('c.workspace = ?');
      params.push(workspace);
    } else {
      filters.push("c.workspace != 'nsfw'");
    }
    if (conversationId) {
      filters.push('m.conversation_id = ?');
      params.push(conversationId);
    }

    return this._query(
      `SELECT
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        m.created_at,
        c.title AS conversation_title,
        c.workspace
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE ${filters.join(' AND ')}
      ORDER BY m.created_at DESC
      LIMIT ?`,
      [...params, safeLimit]
    );
  }

  conversationsSearch({ query, workspace = null, limit = 20 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];

    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    const filters = ['(title LIKE ? OR preview LIKE ? OR tags LIKE ?)'];
    const likeQ = `%${q}%`;
    const params = [likeQ, likeQ, likeQ];

    if (workspace) {
      filters.push('workspace = ?');
      params.push(workspace);
    } else {
      filters.push("workspace != 'nsfw'");
    }

    const rows = this._query(
      `SELECT * FROM conversations WHERE ${filters.join(' AND ')} ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => this._normalizeConversation(row));
  }

  branchesList({ conversationId } = {}) {
    if (!conversationId) return [];
    return this._query(
      'SELECT * FROM conversation_branches WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );
  }

  branchesCreate(payload = {}) {
    const { id, conversationId, parentBranchId = null, name = null } = payload;
    if (!id || !conversationId) {
      throw new Error('id and conversationId are required');
    }

    this._run(
      'INSERT INTO conversation_branches (id, conversation_id, parent_branch_id, name) VALUES (?, ?, ?, ?)',
      [id, conversationId, parentBranchId, name || null]
    );

    return this._queryOne('SELECT * FROM conversation_branches WHERE id = ?', [id]);
  }

  branchesSwitch({ conversationId, branchId = null } = {}) {
    return {
      conversationId,
      branchId: branchId || null,
      messages: this.messagesListByConversation({ conversationId, branchId, includeAllBranches: false }),
    };
  }

  attachmentsListByMessage({ messageId } = {}) {
    if (!messageId) return [];
    this.ensureAttachmentsSchema();
    const rows = this._query(
      'SELECT * FROM message_attachments WHERE message_id = ? ORDER BY created_at ASC',
      [messageId]
    );
    return rows.map((row) => this._normalizeAttachment(row));
  }

  attachmentsSave(payload = {}) {
    const { messageId, files = [], password = null } = payload;
    if (!messageId) {
      throw new Error('messageId is required');
    }
    if (!Array.isArray(files) || files.length === 0) {
      return { success: true, saved: [] };
    }

    this.ensureAttachmentsSchema();
    const saved = [];

    for (const file of files) {
      const attachment = saveAttachmentForMessage(messageId, file, password);
      saved.push(attachment);
    }

    return Promise.all(saved).then((rows) => {
      for (const row of rows) {
        this._run(
          `INSERT INTO message_attachments
          (id, message_id, type, file_path, mime_type, original_name, size, encrypted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.message_id,
            row.type,
            row.file_path,
            row.mime_type,
            row.original_name,
            row.size,
            row.encrypted ? 1 : 0,
          ],
          { persist: false }
        );
      }
      this._persist('data-service:attachments-save', 'high');

      return {
        success: true,
        saved: rows.map((row) => this._normalizeAttachment(row)),
      };
    });
  }

  async attachmentsRead({ filePath, password = null, encoding = 'base64' } = {}) {
    if (!filePath) {
      throw new Error('filePath is required');
    }

    const buffer = await readAttachment(filePath, password);
    let data;

    if (encoding === 'utf-8' || encoding === 'utf8') {
      data = buffer.toString('utf-8');
    } else if (encoding === 'buffer') {
      data = buffer;
    } else {
      data = buffer.toString('base64');
    }

    return {
      success: true,
      encoding,
      data,
      fileName: path.basename(filePath),
    };
  }
}

function registerDataHandlers(ipcMain, dataService) {
  const safeHandle = (channel, handler) => {
    try {
      ipcMain.handle(channel, handler);
    } catch (error) {
      if (String(error.message || '').includes('second handler')) {
        console.warn(`[DataService] Skipping already-registered channel: ${channel}`);
        return;
      }
      throw error;
    }
  };

  safeHandle('conversations:list', async (_, payload = {}) => dataService.conversationsList(payload));
  safeHandle('conversations:create', async (_, payload = {}) => dataService.conversationsCreate(payload));
  safeHandle('conversations:getById', async (_, payload = {}) => dataService.conversationsGetById(payload));
  safeHandle('conversations:updateMeta', async (_, payload = {}) => dataService.conversationsUpdateMeta(payload));
  safeHandle('conversations:delete', async (_, payload = {}) => dataService.conversationsDelete(payload));

  safeHandle('messages:listByConversation', async (_, payload = {}) => dataService.messagesListByConversation(payload));
  safeHandle('messages:append', async (_, payload = {}) => dataService.messagesAppend(payload));
  safeHandle('messages:update', async (_, payload = {}) => dataService.messagesUpdate(payload));
  safeHandle('messages:delete', async (_, payload = {}) => dataService.messagesDelete(payload));
  safeHandle('messages:deleteMany', async (_, payload = {}) => dataService.messagesDeleteMany(payload));
  safeHandle('messages:search', async (_, payload = {}) => dataService.messagesSearch(payload));

  safeHandle('attachments:listByMessage', async (_, payload = {}) => dataService.attachmentsListByMessage(payload));
  safeHandle('attachments:save', async (_, payload = {}) => dataService.attachmentsSave(payload));
  safeHandle('attachments:read', async (_, payload = {}) => dataService.attachmentsRead(payload));

  safeHandle('branches:list', async (_, payload = {}) => dataService.branchesList(payload));
  safeHandle('branches:create', async (_, payload = {}) => dataService.branchesCreate(payload));
  safeHandle('branches:switch', async (_, payload = {}) => dataService.branchesSwitch(payload));

  safeHandle('search:conversations', async (_, payload = {}, legacyOptions = {}) => {
    const normalized = typeof payload === 'string'
      ? { query: payload, ...(legacyOptions || {}) }
      : (payload || {});
    return dataService.conversationsSearch(normalized);
  });
  safeHandle('search:messages', async (_, payload = {}, legacyOptions = {}) => {
    const normalized = typeof payload === 'string'
      ? { query: payload, ...(legacyOptions || {}) }
      : (payload || {});
    return dataService.messagesSearch(normalized);
  });
}

module.exports = {
  DataService,
  registerDataHandlers,
};
