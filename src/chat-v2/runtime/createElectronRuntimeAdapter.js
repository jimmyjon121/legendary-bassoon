/**
 * Electron runtime adapter for Chat V2.
 * Keeps IPC/data access in one boundary so engine stays app-agnostic.
 */
import { v4 as uuidv4 } from 'uuid';
import { cleanInferenceOptions } from './inferenceOptionsUtil';

export function createElectronRuntimeAdapter(deps = {}) {
  const raw = deps.api || window.electronAPI;
  const data = deps.dataApi || raw?.data;
  const listAttachmentsByMessage = deps.attachmentsListByMessage || data?.attachmentsListByMessage;
  const resolveWorkspace = () => {
    if (typeof deps.getWorkspace === 'function') {
      const value = deps.getWorkspace();
      const normalized = String(value || '').trim();
      return normalized || 'casual';
    }
    const fallback = String(deps.workspace || '').trim();
    return fallback || 'casual';
  };
  const resolvePrivatePassword = () => {
    if (typeof deps.getPrivatePassword === 'function') {
      const value = String(deps.getPrivatePassword() || '').trim();
      return value || null;
    }
    const fallback = String(deps.privatePassword || '').trim();
    return fallback || null;
  };
  const isPrivateWorkspace = (workspace = resolveWorkspace()) => String(workspace || '').trim() === 'nsfw';
  const requirePrivatePassword = () => {
    const password = resolvePrivatePassword();
    if (!password) {
      throw new Error('Vault is locked');
    }
    return password;
  };

  if (!raw || !data) {
    throw new Error('Electron API not available for Chat V2 runtime.');
  }

  const resolveInferenceOptions = async (request = {}) => {
    let options = {};

    if (typeof deps.getInferenceOptions === 'function') {
      try {
        const fromDeps = await deps.getInferenceOptions(request);
        if (fromDeps && typeof fromDeps === 'object') {
          options = { ...options, ...fromDeps };
        }
      } catch (_) {
        // Non-blocking.
      }
    } else if (typeof raw?.getModelInferenceParams === 'function') {
      try {
        const fromRuntime = await raw.getModelInferenceParams();
        if (fromRuntime && typeof fromRuntime === 'object') {
          options = { ...options, ...fromRuntime };
        }
      } catch (_) {
        // Non-blocking.
      }
    }

    if (request?.options && typeof request.options === 'object') {
      options = { ...options, ...request.options };
    }

    return cleanInferenceOptions(options);
  };

  const normalizeBranchId = (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
  };
  const parseEncryptedPayload = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || !text.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.encrypted && parsed?.iv && parsed?.salt && parsed?.authTag) {
        return parsed;
      }
    } catch (_) {
      // Non-blocking.
    }
    return null;
  };
  const maybeEncryptText = async (value, password) => {
    const text = String(value ?? '');
    if (!password) return text;
    if (typeof raw?.encrypt !== 'function') {
      throw new Error('Vault encryption is unavailable');
    }
    try {
      const encrypted = await raw.encrypt(text, password);
      if (!encrypted || typeof encrypted !== 'object') {
        throw new Error('Invalid encryption payload');
      }
      return JSON.stringify(encrypted);
    } catch (error) {
      throw new Error(error?.message || 'Failed to encrypt private content');
    }
  };
  const maybeDecryptText = async (value, password) => {
    const text = String(value ?? '');
    const payload = parseEncryptedPayload(text);
    if (!payload) return text;
    if (!password) {
      throw new Error('Vault is locked');
    }
    if (typeof raw?.decrypt !== 'function') {
      throw new Error('Vault decryption is unavailable');
    }
    try {
      const decrypted = await raw.decrypt(payload, password);
      return typeof decrypted === 'string' ? decrypted : String(decrypted ?? '');
    } catch (error) {
      throw new Error(error?.message || 'Failed to decrypt private content');
    }
  };

  const normalizeAttachmentRow = (row = {}) => {
    const mime = row.mime_type || '';
    const isImage = mime.startsWith('image/') || String(row.type || '').startsWith('image');
    return {
      id: row.id,
      name: row.original_name || row.file_path || 'file',
      kind: isImage ? 'image' : 'file',
      mimeType: mime,
      size: Number(row.size) || 0,
      originalPath: row.file_path || null,
      encrypted: Boolean(row.encrypted),
    };
  };

  const hydrateAttachments = async (messages = []) => {
    const rows = Array.isArray(messages) ? messages : [];
    if (rows.length === 0 || typeof listAttachmentsByMessage !== 'function') {
      return rows.map((message) => ({
        ...message,
        attachments: Array.isArray(message.attachments) ? message.attachments : [],
      }));
    }

    const attachmentsByMessage = await Promise.all(
      rows.map((message) =>
        Promise.resolve(listAttachmentsByMessage({ messageId: message.id })).catch(() => [])
      )
    );

    return rows.map((message, index) => ({
      ...message,
      attachments: Array.isArray(attachmentsByMessage[index])
        ? attachmentsByMessage[index].map((row) => normalizeAttachmentRow(row))
        : (Array.isArray(message.attachments) ? message.attachments : []),
    }));
  };
  const hydrateConversationMessages = async (messages = [], options = {}) => {
    const rows = Array.isArray(messages) ? messages : [];
    const password = options.privatePassword || null;
    const normalized = await Promise.all(
      rows.map(async (message) => ({
        id: message.id,
        role: message.role,
        content: password
          ? await maybeDecryptText(message.content || '', password)
          : String(message.content || ''),
        created_at: message.created_at || message.createdAt || new Date().toISOString(),
        branch_id: message.branch_id || message.branchId || options.branchId || 'main',
        parent_message_id: message.parent_message_id || message.parentMessageId || null,
        attachments: Array.isArray(message.attachments) ? message.attachments : [],
        model: message.model || null,
      }))
    );
    return hydrateAttachments(normalized);
  };

  return {
    async createConversation(seedTitle = 'New Chat') {
      const create = deps.createConversation || data.conversationsCreate;
      if (!create) throw new Error('Missing conversationsCreate adapter.');
      const conversationId = uuidv4();
      const ws = resolveWorkspace();
      const isPrivate = ws === 'nsfw';
      const privatePassword = isPrivate ? requirePrivatePassword() : null;
      const safeTitle = isPrivate ? 'Vault note' : seedTitle;
      const storedTitle = isPrivate
        ? await maybeEncryptText(safeTitle, privatePassword)
        : safeTitle;
      const result = await create({
        id: conversationId,
        title: storedTitle,
        workspace: ws,
        encrypted: isPrivate ? 1 : 0,
      });
      return result?.id || result?.conversationId || result;
    },

    async appendMessage(payload) {
      const append = deps.appendMessage || data.messagesAppend;
      if (!append) throw new Error('Missing messagesAppend adapter.');
      const privatePassword = isPrivateWorkspace() ? requirePrivatePassword() : null;
      const content = privatePassword
        ? await maybeEncryptText(payload.content, privatePassword)
        : payload.content;
      await append({
        id: payload.id,
        conversationId: payload.conversationId,
        role: payload.role,
        content,
        model: payload.model || null,
        createdAt: payload.createdAt || payload.created_at || null,
        branchId: payload.branchId || null,
        parentMessageId: payload.parentMessageId || null,
      });
    },

    async updateMessage(payload = {}) {
      const update = deps.updateMessage || data.messagesUpdate;
      if (!update) return;
      const privatePassword = isPrivateWorkspace() ? requirePrivatePassword() : null;
      const content = privatePassword
        ? await maybeEncryptText(payload.content, privatePassword)
        : payload.content;
      await update({
        id: payload.id,
        content,
        conversationId: payload.conversationId || null,
      });
    },

    async updateConversationMeta(payload = {}) {
      const updateMeta = deps.updateConversationMeta || data.conversationsUpdateMeta;
      if (!updateMeta) return;
      const privatePassword = isPrivateWorkspace() ? requirePrivatePassword() : null;
      const request = {
        id: payload.conversationId,
      };
      if (payload.title !== undefined && !privatePassword) {
        request.title = payload.title;
      }
      if (payload.model !== undefined) request.model = payload.model;
      if (payload.preview !== undefined) {
        request.preview = privatePassword
          ? await maybeEncryptText('', privatePassword)
          : payload.preview;
      }
      if (payload.messageCount !== undefined) request.messageCount = payload.messageCount;
      if (payload.encrypted !== undefined) {
        request.encrypted = payload.encrypted;
      } else if (privatePassword) {
        request.encrypted = true;
      }
      await updateMeta(request);
    },

    async generateTitle(prompt, answer, model) {
      if (!raw?.sendToLLM) return null;
      try {
        const titlePrompt = `Generate a concise title (max 6 words) for this conversation. Return ONLY the title, nothing else.\n\nUser: ${prompt.substring(0, 200)}\nAssistant: ${answer.substring(0, 200)}`;
        const res = await raw.sendToLLM({
          model,
          prompt: titlePrompt,
          system: 'You are a conversation title generator. Respond with ONLY a short title, no quotes, no explanation.',
          options: { temperature: 0.3, num_predict: 20 },
        });
        let title = res?.response?.trim();
        if (title && title.length > 2 && title.length < 80) {
          title = title.replace(/^["']|["']$/g, '').trim();
          return title;
        }
      } catch (err) {
        console.warn('[ChatV2 RuntimeAdapter] generateTitle failed:', err);
      }
      return null;
    },

    async deleteMessage(payload = {}) {
      const remove = deps.deleteMessage || data.messagesDelete;
      if (!remove) return;
      await remove({
        id: payload.id,
        conversationId: payload.conversationId || null,
      });
    },

    async deleteMessagesMany(payload = {}) {
      const removeMany = deps.deleteMessagesMany || data.messagesDeleteMany;
      if (!removeMany) return;
      await removeMany({
        ids: Array.isArray(payload.ids) ? payload.ids : [],
        conversationId: payload.conversationId || null,
      });
    },

    async listBranches(payload = {}) {
      const list = deps.listBranches || data.branchesList;
      if (!list) return [];
      return list({ conversationId: payload.conversationId });
    },

    async createBranch(payload = {}) {
      const create = deps.createBranch || data.branchesCreate;
      if (!create) return null;
      return create({
        id: payload.id,
        conversationId: payload.conversationId,
        parentBranchId: payload.parentBranchId || null,
        name: payload.name || null,
      });
    },

    async switchBranch(payload = {}) {
      const switchBranch = deps.switchBranch || data.branchesSwitch;
      if (!switchBranch) return { messages: [] };
      const requestedBranchId = normalizeBranchId(payload.branchId) || 'main';
      const privatePassword = isPrivateWorkspace() ? requirePrivatePassword() : null;
      const result = await switchBranch({
        conversationId: payload.conversationId,
        branchId: requestedBranchId,
      });
      return {
        ...result,
        branchId: normalizeBranchId(result?.branchId) || requestedBranchId,
        messages: await hydrateConversationMessages(Array.isArray(result?.messages) ? result.messages : [], {
          branchId: requestedBranchId,
          privatePassword,
        }),
      };
    },

    async saveAttachments(payload = {}) {
      const save = deps.saveAttachments || data.attachmentsSave;
      if (!save) return { success: false, saved: [] };
      const privatePassword = isPrivateWorkspace() ? requirePrivatePassword() : null;
      return save({
        conversationId: payload.conversationId || null,
        messageId: payload.messageId,
        files: Array.isArray(payload.files) ? payload.files : [],
        ...(privatePassword ? { password: privatePassword } : {}),
      });
    },

    async loadConversation(payload = {}) {
      const conversationId = payload.conversationId || payload.id || null;
      if (!conversationId) return null;

      const getConversation = deps.getConversation || data.conversationsGetById;
      const listMessages = deps.listMessages || data.messagesListByConversation;
      const listBranches = deps.listBranches || data.branchesList;

      const [conversation, branchesRaw] = await Promise.all([
        typeof getConversation === 'function'
          ? getConversation({ id: conversationId })
          : Promise.resolve(null),
        typeof listBranches === 'function'
          ? listBranches({ conversationId })
          : Promise.resolve([]),
      ]);

      const branches = Array.isArray(branchesRaw)
        ? branchesRaw.map((b, index) => ({
            id: b.id,
            name: b.name || `Branch ${index + 1}`,
            parentBranchId: b.parent_branch_id || b.parentBranchId || null,
            sourceMessageId: b.source_message_id || b.sourceMessageId || null,
            created_at: b.created_at || b.createdAt || null,
          }))
        : [];

      const effectiveBranchId = normalizeBranchId(
        payload.branchId
        || conversation?.current_branch_id
        || conversation?.currentBranchId
        || branches[0]?.id
      ) || 'main';
      const requiresPrivatePassword = isPrivateWorkspace(conversation?.workspace || resolveWorkspace())
        || Boolean(conversation?.encrypted);
      const privatePassword = requiresPrivatePassword ? requirePrivatePassword() : null;

      const messagesRaw = typeof listMessages === 'function'
        ? await listMessages({
            conversationId,
            branchId: effectiveBranchId,
          })
        : [];

      const normalizedMessages = await hydrateConversationMessages(messagesRaw, {
        branchId: effectiveBranchId,
        privatePassword,
      });
      const normalizedConversation = conversation
        ? {
            ...conversation,
            title: privatePassword
              ? await maybeDecryptText(conversation.title, privatePassword)
              : conversation.title,
            preview: privatePassword
              ? await maybeDecryptText(conversation.preview, privatePassword)
              : conversation.preview,
          }
        : null;

      return {
        conversationId,
        conversation: normalizedConversation,
        branches,
        currentBranchId: effectiveBranchId,
        messages: normalizedMessages,
      };
    },

    async getRuntimeState() {
      const getRuntimeState = deps.getRuntimeState || raw?.getLlmRuntimeState;
      if (typeof getRuntimeState !== 'function') return null;
      return getRuntimeState();
    },

    async warmupModel(modelName, options = {}) {
      const warmup = deps.warmupModel || raw?.warmupModel;
      const name = String(modelName || '').trim();
      if (!name || typeof warmup !== 'function') return null;
      return warmup(name, options);
    },

    async getInferenceOptions(request = {}) {
      return resolveInferenceOptions(request || {});
    },

    async generateChat(request = {}) {
      const send = deps.generateChat || raw?.sendToLLM;
      if (typeof send !== 'function') {
        throw new Error('Missing sendToLLM adapter.');
      }
      const options = await resolveInferenceOptions(request);
      const result = await send({
        model: request.model,
        messages: request.messages,
        prompt: request.prompt,
        system: request.system,
        options,
        workspace: request.workspace || resolveWorkspace(),
        lane: request.lane || 'lane_interactive',
        workloadType: request.workloadType || 'chat',
        allowFallback: request.allowFallback !== false,
        preferNativeChat: request.preferNativeChat !== false,
        forceCompatMode: request.forceCompatMode === true,
        forceModelFallback: request.forceModelFallback === true,
        priority: Number.isFinite(Number(request.priority)) ? Number(request.priority) : -20,
      });
      return result;
    },

    async streamChat(request, onEvent) {
      const stream = deps.streamChat || raw?.streamFromLLM;
      if (!stream) throw new Error('Missing streamFromLLM adapter.');
      const options = await resolveInferenceOptions(request);

      const safeOnEvent = (event) => {
        try { onEvent?.(event); } catch (err) {
          console.error('[ChatV2 RuntimeAdapter] onEvent handler threw:', err);
        }
      };

      const cleanup = stream(
        {
          model: request.model,
          messages: request.messages,
          system: request.system,
          options,
          workspace: request.workspace || resolveWorkspace(),
          lane: request.lane || 'lane_interactive',
          workloadType: request.workloadType || 'chat',
          allowFallback: request.allowFallback !== false,
          preferNativeChat: request.preferNativeChat !== false,
          forceCompatMode: request.forceCompatMode === true,
          forceModelFallback: request.forceModelFallback === true,
          priority: Number.isFinite(Number(request.priority)) ? Number(request.priority) : -20,
        },
        (chunk) => {
          if (chunk?.error || chunk?.status === 'error') {
            safeOnEvent({ error: chunk?.error || chunk?.message || 'Stream error' });
            return;
          }
          if (chunk?.cancelled || chunk?.aborted) {
            safeOnEvent({ cancelled: true });
            return;
          }

          const delta =
            chunk?.response
            ?? chunk?.delta
            ?? chunk?.content
            ?? chunk?.text
            ?? chunk?.message?.content;
          if (delta != null && String(delta).length > 0) {
            safeOnEvent({ delta: String(delta) });
          }

          if (chunk?.meta && typeof chunk.meta === 'object') {
            safeOnEvent({ meta: chunk.meta });
          }

          // Forward provider-reported token stats so the engine can compute
          // accurate tokens/sec instead of falling back to char/4 estimates.
          const providerStats = (chunk && (
            chunk.eval_count != null
            || chunk.eval_duration != null
            || chunk.prompt_eval_count != null
            || chunk.prompt_eval_duration != null
          )) ? {
            eval_count: chunk.eval_count,
            eval_duration: chunk.eval_duration,
            prompt_eval_count: chunk.prompt_eval_count,
            prompt_eval_duration: chunk.prompt_eval_duration,
            total_duration: chunk.total_duration,
          } : null;
          if (providerStats) {
            safeOnEvent({ providerStats });
          }

          if (chunk?.done || chunk?.complete || chunk?.finished) {
            safeOnEvent({ done: true });
          }
        }
      );

      return () => {
        try {
          cleanup?.();
        } catch (_) {
          // noop
        }
      };
    },

    async recordStreamEvent(payload = {}) {
      const record = deps.recordStreamEvent || raw?.recordStreamEvent;
      if (typeof record !== 'function') return { success: false, skipped: true };
      return record(payload || {});
    },
  };
}
