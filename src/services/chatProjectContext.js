import { api } from '../utils/electronAPI';

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value = '', maxChars = 280) {
  const normalized = cleanText(value);
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

function takeRecentRoleTurns(messages = [], maxTurns = 5) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const normalized = messages
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(message?.content || ''),
    }))
    .filter((message) => message.content.length > 0);
  return normalized.slice(-maxTurns);
}

async function buildConversationDigest(conversationId, fallbackPreview = '') {
  const preview = clipText(fallbackPreview, 260);
  if (preview) return preview;

  try {
    const recent = await api.data.messagesListByConversation({
      conversationId,
      includeAllBranches: false,
      limit: 10,
    });
    const turns = takeRecentRoleTurns(recent, 5);
    if (turns.length === 0) return '';
    return turns
      .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${clipText(turn.content, 190)}`)
      .join(' | ');
  } catch (error) {
    console.warn('[chatProjectContext] Failed to load linked conversation digest:', error?.message || error);
    return '';
  }
}

function buildProjectPromptBlock(context = {}) {
  const projectName = cleanText(context.projectName);
  const description = cleanText(context.projectDescription);
  const permanentInstructions = cleanText(context.permanentInstructions);
  const conversationDigest = cleanText(context.conversationDigest);
  const documentDigest = cleanText(context.documentDigest);
  const linkedConversationCount = Number(context.linkedConversationIds?.length || 0);
  const linkedDocumentCount = Number(context.linkedDocumentIds?.length || 0);

  if (!projectName) return '';

  const lines = [
    '## Active Chat Project',
    `Name: ${projectName}`,
    description ? `Description: ${description}` : '',
    `Linked chats: ${linkedConversationCount}`,
    `Linked documents: ${linkedDocumentCount}`,
    permanentInstructions ? `\n### Project Instructions (always apply)\n${permanentInstructions}` : '',
    conversationDigest ? `\n### Related Chat Context\n${conversationDigest}` : '',
    documentDigest ? `\n### Linked Document Context\n${documentDigest}` : '',
    '\nTreat this project context as first-class guidance for this conversation.',
  ].filter(Boolean);

  return lines.join('\n');
}

export async function resolveChatProjectContext({
  workspace = 'casual',
  activeProjectId = null,
  currentConversationId = null,
  prompt = '',
  maxLinkedConversations = 4,
  maxLinkedDocumentHits = 4,
} = {}) {
  const projectId = String(activeProjectId || '').trim();
  if (!projectId) return null;

  const normalizedWorkspace = String(workspace || 'casual').trim().toLowerCase();

  try {
    const [project, conversationsPayload, documentsPayload] = await Promise.all([
      api.research.getProject(projectId),
      api.research.listConversations(projectId, normalizedWorkspace),
      api.research.listDocuments(projectId, normalizedWorkspace),
    ]);

    if (!project?.id) return null;

    const linkedConversationsRaw = Array.isArray(conversationsPayload?.linked)
      ? conversationsPayload.linked
      : [];
    const linkedDocumentsRaw = Array.isArray(documentsPayload?.linked)
      ? documentsPayload.linked
      : [];

    const linkedConversationIds = linkedConversationsRaw
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
    const linkedDocumentIds = linkedDocumentsRaw
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);

    const targetConversations = linkedConversationsRaw
      .filter((item) => String(item?.id || '').trim() && String(item?.id || '').trim() !== String(currentConversationId || '').trim())
      .slice(0, Math.max(1, Number(maxLinkedConversations || 4)));

    const conversationDigests = [];
    for (const item of targetConversations) {
      const id = String(item.id || '').trim();
      const title = cleanText(item.title || `Conversation ${id.slice(0, 8)}`);
      const digest = await buildConversationDigest(id, item.preview || '');
      if (!digest) continue;
      conversationDigests.push(`- ${title}: ${digest}`);
    }

    let documentDigest = '';
    const trimmedPrompt = cleanText(prompt);
    if (trimmedPrompt && linkedDocumentIds.length > 0) {
      try {
        const ranked = await api.searchDocuments(normalizedWorkspace, trimmedPrompt, 18);
        const focused = Array.isArray(ranked)
          ? ranked
            .filter((item) => linkedDocumentIds.includes(String(item?.document_id || '').trim()))
            .slice(0, Math.max(1, Number(maxLinkedDocumentHits || 4)))
          : [];

        if (focused.length > 0) {
          documentDigest = focused
            .map((item, index) => {
              const source = cleanText(item.filename || `Document ${index + 1}`);
              const excerpt = clipText(item.content, 420);
              return excerpt ? `${index + 1}. ${source}: ${excerpt}` : `${index + 1}. ${source}`;
            })
            .join('\n');
        }
      } catch (error) {
        console.warn('[chatProjectContext] Failed to fetch document search hits:', error?.message || error);
      }
    }

    const fallbackDocumentDigest = linkedDocumentsRaw
      .slice(0, 5)
      .map((item) => cleanText(item?.filename || ''))
      .filter(Boolean)
      .map((name, index) => `${index + 1}. ${name}`)
      .join('\n');

    const context = {
      projectId: project.id,
      projectName: cleanText(project.name || ''),
      projectDescription: cleanText(project.description || ''),
      permanentInstructions: cleanText(project.permanent_instructions || ''),
      linkedConversationIds,
      linkedDocumentIds,
      conversationDigest: conversationDigests.join('\n'),
      documentDigest: documentDigest || fallbackDocumentDigest,
    };

    return {
      ...context,
      systemPromptBlock: buildProjectPromptBlock(context),
    };
  } catch (error) {
    console.warn('[chatProjectContext] Failed to resolve project context:', error?.message || error);
    return null;
  }
}

export default {
  resolveChatProjectContext,
};
