// Conversation state management slice
// Handles conversations, messages, and branches

import { v4 as uuidv4 } from 'uuid';
import { api, isElectron } from '../../utils/electronAPI';

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
      const result = await api.data.conversationsList({
        workspace,
        limit: 1000,
      });
      
      // Decrypt titles for Private workspace
      if (workspace === 'nsfw' && nsfwPassword && result?.length > 0) {
        const decrypted = await Promise.all(
          result.map(async (conv) => {
            if (conv.encrypted) {
              const next = { ...conv };
              const maybeDecryptField = async (value) => {
                if (!value) return value;
                try {
                  const parsed = JSON.parse(value);
                  if (parsed.encrypted && parsed.iv && parsed.salt && parsed.authTag) {
                    return await window.electronAPI?.decrypt(parsed, nsfwPassword);
                  }
                } catch {
                  // Field might not be encrypted (legacy) or invalid JSON.
                }
                return value;
              };
              next.title = await maybeDecryptField(conv.title);
              next.preview = await maybeDecryptField(conv.preview);
              return next;
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
      
      await api.data.conversationsCreate({
        id,
        workspace,
        title: storedTitle,
        model,
        encrypted: isNsfw ? 1 : 0,
      });
      
      const conversations = await get().loadConversations();
      set({ conversations, currentConversationId: id, messages: [] });

      // Keep project conversations in sync when a project is active.
      if (get().activeProjectId) {
        get().linkConversationToActiveProject?.(id).catch((error) => {
          console.warn('[conversationSlice] Failed to link new chat to active project:', error?.message || error);
        });
      }
      
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
      const branches = await api.data.branchesList({ conversationId });

      // Load messages
      const messages = await api.data.messagesListByConversation({
        conversationId,
        branchId: activeBranchId,
        includeAllBranches: false,
        limit: 5000,
      });
      
      // Decrypt messages if encrypted
      let decryptedMessages = messages || [];
      if (workspace === 'nsfw' && get().nsfwPassword) {
        const conversation = await api.data.conversationsGetById({ id: conversationId });
        
        if (conversation?.encrypted) {
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
          const rowsByMessage = await Promise.all(
            decryptedMessages.map((msg) =>
              api.data.attachmentsListByMessage({ messageId: msg.id }).catch(() => [])
            )
          );

          messagesWithAttachments = decryptedMessages.map((m, idx) => {
            const rows = rowsByMessage[idx] || [];
            const attachments = rows.map((row) => {
              const mime = row.mime_type || '';
              const isImage =
                (row.type && String(row.type).startsWith('image')) ||
                mime.startsWith('image/');
              return {
                id: row.id,
                name: row.original_name || row.file_path,
                kind: isImage ? 'image' : 'file',
                mimeType: mime,
                size: row.size,
                originalPath: row.file_path,
                encrypted: Boolean(row.encrypted),
              };
            });

            return {
              ...m,
              attachments,
            };
          });
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

      await api.data.branchesCreate({
        id: branchId,
        conversationId,
        parentBranchId: get().currentBranchId,
        name: defaultName,
      });

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
      await api.data.conversationsDelete({ id: conversationId });
      
      const conversations = await get().loadConversations();
      
      if (get().currentConversationId === conversationId) {
        set({ currentConversationId: null, messages: [] });
      }
      
      set({ conversations });

      if (get().activeProjectId) {
        get().refreshActiveProjectLinks?.().catch(() => {});
      }
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
      await api.data.messagesAppend({
        id: assistantMessageId,
        conversationId,
        role: 'assistant',
        content,
        model,
        branchId,
        parentMessageId: parentId,
      });
    } catch (error) {
      console.error('Failed to append compare message:', error);
    }

    set((state) => ({
      messages: [...state.messages, assistantMessage],
      currentConversationId: conversationId,
    }));
  },
});



