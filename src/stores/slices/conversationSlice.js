// Conversation state management slice
// Handles conversations, messages, and branches

import { v4 as uuidv4 } from 'uuid';
import { isElectron, safeCall } from '../../utils/electronAPI';

export const createConversationSlice = (set, get) => ({
  // State
  conversations: [],
  currentConversationId: null,
  messages: [],
  branches: [],
  currentBranchId: null,

  // Actions
  loadConversations: async () => {
    try {
      const workspace = get().currentWorkspace;
      const nsfwPassword = get().nsfwPassword;
      const result = await window.electronAPI?.dbQuery(
        'SELECT * FROM conversations WHERE workspace = ? ORDER BY updated_at DESC',
        [workspace]
      );
      
      // Decrypt titles for Private workspace
      if (workspace === 'nsfw' && nsfwPassword && result?.length > 0) {
        const decrypted = await Promise.all(
          result.map(async (conv) => {
            if (conv.encrypted && conv.title) {
              try {
                const parsed = JSON.parse(conv.title);
                if (parsed.encrypted && parsed.iv && parsed.salt && parsed.authTag) {
                  const decryptedTitle = await window.electronAPI?.decrypt(parsed, nsfwPassword);
                  return { ...conv, title: decryptedTitle };
                }
              } catch {
                // Title might not be encrypted (legacy) or invalid JSON
              }
            }
            return conv;
          })
        );
        return decrypted;
      }
      
      return result || [];
    } catch (error) {
      console.error('Failed to load conversations:', error);
      return [];
    }
  },

  createConversation: async (title = 'New Chat') => {
    const id = uuidv4();
    const workspace = get().currentWorkspace;
    const model = get().currentModel;
    const isNsfw = workspace === 'nsfw';
    const nsfwPassword = get().nsfwPassword;
    
    try {
      let storedTitle = title;
      if (isNsfw && nsfwPassword) {
        try {
          const encrypted = await window.electronAPI?.encrypt(title, nsfwPassword);
          storedTitle = JSON.stringify(encrypted);
        } catch (error) {
          console.error('Failed to encrypt title:', error);
        }
      }
      
      await window.electronAPI?.dbRun(
        'INSERT INTO conversations (id, workspace, title, model, encrypted) VALUES (?, ?, ?, ?, ?)',
        [id, workspace, storedTitle, model, isNsfw ? 1 : 0]
      );
      
      const conversations = await get().loadConversations();
      set({ conversations, currentConversationId: id, messages: [] });
      
      return id;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      return null;
    }
  },

  selectConversation: async (conversationId, branchId = null) => {
    try {
      const workspace = get().currentWorkspace;
      const activeBranchId = branchId || null;
      
      // Load branches
      const branches = await window.electronAPI?.dbQuery(
        'SELECT * FROM conversation_branches WHERE conversation_id = ? ORDER BY created_at ASC',
        [conversationId]
      );

      // Load messages
      let messages;
      if (activeBranchId) {
        messages = await window.electronAPI?.dbQuery(
          'SELECT * FROM messages WHERE conversation_id = ? AND (branch_id IS NULL OR branch_id = ?) ORDER BY created_at ASC',
          [conversationId, activeBranchId]
        );
      } else {
        messages = await window.electronAPI?.dbQuery(
          'SELECT * FROM messages WHERE conversation_id = ? AND (branch_id IS NULL OR branch_id = \'\') ORDER BY created_at ASC',
          [conversationId]
        );
      }
      
      // Decrypt messages if encrypted
      let decryptedMessages = messages || [];
      if (workspace === 'nsfw' && get().nsfwPassword) {
        const conversation = await window.electronAPI?.dbQuery(
          'SELECT encrypted FROM conversations WHERE id = ?',
          [conversationId]
        );
        
        if (conversation?.[0]?.encrypted) {
          decryptedMessages = await Promise.all(
            (messages || []).map(async (msg) => {
              try {
                if (msg.content && msg.content.startsWith('{') && msg.content.includes('"encrypted"')) {
                  const encryptedData = JSON.parse(msg.content);
                  const decrypted = await window.electronAPI?.decrypt(encryptedData, get().nsfwPassword);
                  return { ...msg, content: decrypted };
                }
                return msg;
              } catch (error) {
                console.error('Failed to decrypt message:', error);
                return { ...msg, content: '[Decryption failed]' };
              }
            })
          );
        }
      }

      // Load attachments
      let messagesWithAttachments = decryptedMessages;
      try {
        if (Array.isArray(decryptedMessages) && decryptedMessages.length > 0 && isElectron()) {
          const ids = decryptedMessages.map((m) => m.id);
          const placeholders = ids.map(() => '?').join(', ');
          const rows = await window.electronAPI?.dbQuery(
            `SELECT * FROM message_images WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
            ids
          );

          const byMessage = {};
          (rows || []).forEach((row) => {
            const list = byMessage[row.message_id] || (byMessage[row.message_id] = []);
            const isImage =
              (row.type && String(row.type).startsWith('image')) ||
              (row.mime_type && String(row.mime_type).startsWith('image/'));
            list.push({
              id: row.id,
              name: row.original_name || row.file_path,
              kind: isImage ? 'image' : 'file',
              mimeType: row.mime_type || '',
              size: row.size,
              originalPath: row.file_path,
            });
          });

          messagesWithAttachments = decryptedMessages.map((m) => ({
            ...m,
            attachments: byMessage[m.id] || [],
          }));
        }
      } catch (error) {
        console.error('Failed to load message attachments:', error);
      }
      
      set({ 
        currentConversationId: conversationId, 
        messages: messagesWithAttachments,
        branches: branches || [],
        currentBranchId: activeBranchId
      });
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  },

  createBranchFromMessage: async (conversationId, messageId, name) => {
    try {
      const branchId = uuidv4();
      const branches = get().branches || [];
      const defaultName = name || `Branch ${branches.length + 1}`;

      await window.electronAPI?.dbRun(
        'INSERT INTO conversation_branches (id, conversation_id, parent_branch_id, name) VALUES (?, ?, ?, ?)',
        [branchId, conversationId, get().currentBranchId, defaultName]
      );

      await get().selectConversation(conversationId, branchId);
    } catch (error) {
      console.error('Failed to create branch:', error);
    }
  },

  switchBranch: async (branchId) => {
    const conversationId = get().currentConversationId;
    if (!conversationId) return;
    await get().selectConversation(conversationId, branchId || null);
  },

  deleteConversation: async (conversationId) => {
    try {
      await window.electronAPI?.dbRun(
        'DELETE FROM conversations WHERE id = ?',
        [conversationId]
      );
      
      const conversations = await get().loadConversations();
      
      if (get().currentConversationId === conversationId) {
        set({ currentConversationId: null, messages: [] });
      }
      
      set({ conversations });
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  },

  appendFromCompare: async (content, model) => {
    const { currentConversationId, currentWorkspace } = get();
    let conversationId = currentConversationId;
    if (!conversationId) {
      conversationId = await get().createConversation(content.substring(0, 50));
      if (!conversationId) return;
    }
    
    const state = get();
    const branchId = state.currentBranchId || null;
    const parentMessage = state.messages.length > 0 ? state.messages[state.messages.length - 1] : null;
    const parentId = parentMessage ? parentMessage.id : null;

    const assistantMessageId = uuidv4();
    const assistantMessage = {
      id: assistantMessageId,
      conversation_id: conversationId,
      role: 'assistant',
      content,
      model,
      created_at: new Date().toISOString(),
      branch_id: branchId,
      parent_message_id: parentId
    };

    try {
      await window.electronAPI?.dbRun(
        'INSERT INTO messages (id, conversation_id, role, content, model, branch_id, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [assistantMessageId, conversationId, 'assistant', content, model, branchId, parentId]
      );
      await window.electronAPI?.dbRun(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [conversationId]
      );
    } catch (error) {
      console.error('Failed to append compare message:', error);
    }

    set((state) => ({
      messages: [...state.messages, assistantMessage],
      currentConversationId: conversationId,
    }));
  },
});



