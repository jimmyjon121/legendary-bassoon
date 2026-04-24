/**
 * Runtime adapter contract for Chat V2.
 *
 * Required methods:
 * - createConversation(seedTitle: string) => Promise<string>
 * - appendMessage({ conversationId, id, role, content, created_at, meta? }) => Promise<void>
 * - streamChat(request, onEvent) => Promise<() => void> | () => void
 *
 * Optional methods:
 * - updateMessage({ id, content, conversationId? }) => Promise<void>
 * - deleteMessage({ id, conversationId? }) => Promise<void>
 * - deleteMessagesMany({ ids, conversationId? }) => Promise<void>
 * - listBranches({ conversationId }) => Promise<Array>
 * - createBranch({ id, conversationId, parentBranchId?, name? }) => Promise<object>
 * - switchBranch({ conversationId, branchId }) => Promise<{ messages?: Array }>
 * - saveAttachments({ conversationId, messageId, files }) => Promise<{ success: boolean }>
 * - loadConversation({ conversationId, branchId? }) => Promise<{ conversationId, branches?, currentBranchId?, messages? }>
 * - getRuntimeState() => Promise<object | null>
 * - warmupModel(modelName, options?) => Promise<object | null>
 * - getInferenceOptions(request?) => Promise<object>
 *
 * Stream event shape:
 * - { delta: string }
 * - { done: true }
 * - { cancelled: true }
 * - { error: string }
 */
export const CHAT_V2_RUNTIME_CONTRACT = Object.freeze({
  methods: ['createConversation', 'appendMessage', 'streamChat'],
  optionalMethods: [
    'updateMessage',
    'deleteMessage',
    'deleteMessagesMany',
    'listBranches',
    'createBranch',
    'switchBranch',
    'saveAttachments',
    'loadConversation',
    'getRuntimeState',
    'warmupModel',
    'getInferenceOptions',
  ],
});
