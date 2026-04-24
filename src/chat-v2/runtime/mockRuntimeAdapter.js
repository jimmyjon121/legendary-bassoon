import { v4 as uuidv4 } from 'uuid';

export function createMockRuntimeAdapter(options = {}) {
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 24;
  const memory = {
    conversations: new Map(),
    messagesByConversation: new Map(),
    branchesByConversation: new Map(),
  };

  return {
    async createConversation(seedTitle = 'New Chat') {
      const id = `mock-conv-${uuidv4()}`;
      memory.conversations.set(id, {
        id,
        title: seedTitle,
        createdAt: new Date().toISOString(),
      });
      memory.messagesByConversation.set(id, []);
      memory.branchesByConversation.set(id, [
        {
          id: 'main',
          conversation_id: id,
          parent_branch_id: null,
          name: 'Main',
          created_at: new Date().toISOString(),
        },
      ]);
      return id;
    },

    async appendMessage(payload) {
      if (!payload?.conversationId) return;
      const list = memory.messagesByConversation.get(payload.conversationId) || [];
      list.push({ ...payload });
      memory.messagesByConversation.set(payload.conversationId, list);
    },

    async updateMessage(payload = {}) {
      const { id, content } = payload;
      for (const [conversationId, list] of memory.messagesByConversation.entries()) {
        const idx = list.findIndex((m) => m.id === id);
        if (idx >= 0) {
          list[idx] = { ...list[idx], content };
          memory.messagesByConversation.set(conversationId, list);
          return;
        }
      }
    },

    async deleteMessage(payload = {}) {
      const { id } = payload;
      for (const [conversationId, list] of memory.messagesByConversation.entries()) {
        const next = list.filter((m) => m.id !== id);
        if (next.length !== list.length) {
          memory.messagesByConversation.set(conversationId, next);
          return;
        }
      }
    },

    async deleteMessagesMany(payload = {}) {
      const ids = new Set(Array.isArray(payload.ids) ? payload.ids : []);
      if (ids.size === 0) return;
      for (const [conversationId, list] of memory.messagesByConversation.entries()) {
        const next = list.filter((m) => !ids.has(m.id));
        memory.messagesByConversation.set(conversationId, next);
      }
    },

    async listBranches(payload = {}) {
      if (!payload?.conversationId) return [];
      return memory.branchesByConversation.get(payload.conversationId) || [];
    },

    async createBranch(payload = {}) {
      const { id, conversationId, parentBranchId = null, name = null } = payload;
      if (!id || !conversationId) return null;
      const existing = memory.branchesByConversation.get(conversationId) || [];
      const row = {
        id,
        conversation_id: conversationId,
        parent_branch_id: parentBranchId,
        name: name || 'Branch',
        created_at: new Date().toISOString(),
      };
      memory.branchesByConversation.set(conversationId, [...existing, row]);
      return row;
    },

    async switchBranch(payload = {}) {
      const { conversationId, branchId } = payload;
      const allMessages = memory.messagesByConversation.get(conversationId) || [];
      const filtered = allMessages.filter((m) => (m.branchId || m.branch_id || 'main') === (branchId || 'main'));
      return {
        conversationId,
        branchId,
        messages: filtered.map((m) => ({
          id: m.id,
          conversation_id: m.conversationId || conversationId,
          role: m.role,
          content: m.content,
          created_at: m.created_at || new Date().toISOString(),
          branch_id: m.branchId || m.branch_id || 'main',
          parent_message_id: m.parentMessageId || m.parent_message_id || null,
          attachments: Array.isArray(m.attachments) ? m.attachments : [],
        })),
      };
    },

    async saveAttachments(payload = {}) {
      const files = Array.isArray(payload.files) ? payload.files : [];
      const saved = files.map((f) => ({
        id: f.id || uuidv4(),
        original_name: f.name || 'file',
        mime_type: f.type || 'application/octet-stream',
        size: Number(f.size) || 0,
        file_path: f.originalPath || null,
      }));
      return { success: true, saved };
    },

    async getRuntimeState() {
      return {
        profile: 'balanced',
        preferredBackendId: 'auto',
        currentBackend: { id: 'mock-backend', name: 'Mock Backend', device: 'cpu' },
        queue: { active: 0, queued: 0, lanes: {} },
        offloadEvidence: [],
        deviceUtilization: {
          cpu: { usage: 12, temperature: null },
          memory: { usagePercent: 28, usedGB: 9, totalGB: 32 },
          gpus: [],
          npu: null,
        },
        timestamp: Date.now(),
      };
    },

    async warmupModel(modelName) {
      return {
        success: true,
        model: modelName,
        backend: 'mock-backend',
        offloadEvidence: null,
      };
    },

    async getInferenceOptions() {
      return {
        num_ctx: 4096,
        num_predict: 1024,
        num_batch: 256,
        temperature: 0.7,
      };
    },

    async streamChat(request, onEvent) {
      let cancelled = false;
      const safeOnEvent = (event) => {
        try { onEvent?.(event); } catch (err) {
          console.error('[MockRuntime] onEvent handler threw:', err);
        }
      };
      const prompt = request?.messages?.[request.messages.length - 1]?.content || '';
      const mockResponse = buildMockResponse(prompt);
      const chunks = mockResponse.split(/\s+/).filter(Boolean);

      const run = async () => {
        for (const token of chunks) {
          if (cancelled) return;
          safeOnEvent({ delta: `${token} ` });
          await wait(delayMs);
        }
        if (!cancelled) {
          safeOnEvent({ done: true });
        }
      };

      run().catch((error) => {
        if (!cancelled) {
          safeOnEvent({ error: error?.message || 'Mock stream failed' });
        }
      });

      return () => {
        cancelled = true;
        safeOnEvent({ cancelled: true });
      };
    },

    async recordStreamEvent() {
      return { success: true };
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMockResponse(prompt) {
  const raw = String(prompt || '').trim();
  if (!raw) return 'I am ready.';
  if (/^(hello|hi|hey)\b/i.test(raw)) {
    return 'Hey! Good to see you. What should we work on?';
  }
  return `Understood. Here is a direct answer to: ${raw}`;
}
