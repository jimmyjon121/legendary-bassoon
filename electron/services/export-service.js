const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

/**
 * Fetch a single conversation with messages.
 */
function getConversationWithMessages(db, conversationId) {
  if (!db) return null;

  try {
    const convResult = db.exec(
      'SELECT id, workspace, title, model, created_at, updated_at FROM conversations WHERE id = ?',
      [conversationId],
    );
    if (!convResult.length || !convResult[0].values.length) {
      return null;
    }

    const [id, workspace, title, model, createdAt, updatedAt] = convResult[0].values[0];

    const messagesResult = db.exec(
      'SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId],
    );

    const messages =
      messagesResult.length > 0
        ? messagesResult[0].values.map(([mid, role, content, msgModel, createdAtMsg]) => ({
            id: mid,
            role,
            content,
            model: msgModel,
            created_at: createdAtMsg,
          }))
        : [];

    return {
      id,
      workspace,
      title: title || 'Conversation',
      model,
      created_at: createdAt,
      updated_at: updatedAt,
      messages,
    };
  } catch (error) {
    console.error('Failed to load conversation for export:', error);
    return null;
  }
}

/**
 * Fetch all conversations with messages.
 */
function getAllConversationsWithMessages(db) {
  if (!db) return [];

  try {
    const convResult = db.exec(
      'SELECT id, workspace, title, model, created_at, updated_at FROM conversations ORDER BY created_at ASC',
    );
    if (!convResult.length) return [];

    const rows = convResult[0].values;

    return rows.map(([id, workspace, title, model, createdAt, updatedAt]) => {
      const msgResult = db.exec(
        'SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
        [id],
      );
      const messages =
        msgResult.length > 0
          ? msgResult[0].values.map(([mid, role, content, msgModel, createdAtMsg]) => ({
              id: mid,
              role,
              content,
              model: msgModel,
              created_at: createdAtMsg,
            }))
          : [];

      return {
        id,
        workspace,
        title: title || 'Conversation',
        model,
        created_at: createdAt,
        updated_at: updatedAt,
        messages,
      };
    });
  } catch (error) {
    console.error('Failed to load all conversations for export:', error);
    return [];
  }
}

function formatDateForFilename(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80) || 'conversation';
}

// --------- Formatters ----------

function toMarkdown(conversation, options = {}) {
  const lines = [];
  const date = formatDateForFilename(conversation.created_at);

  lines.push(`# ${conversation.title || 'Conversation'}`);
  lines.push('');
  lines.push('---');
  lines.push(`- ID: ${conversation.id}`);
  if (conversation.workspace) lines.push(`- Workspace: ${conversation.workspace}`);
  if (conversation.model) lines.push(`- Model: ${conversation.model}`);
  if (date) lines.push(`- Created: ${date}`);
  lines.push('---');
  lines.push('');

  for (const msg of conversation.messages) {
    const role = msg.role === 'user' ? 'You' : 'Assistant';
    lines.push(`**${role}** (${msg.created_at || ''})`);
    lines.push('');
    lines.push(msg.content || '');
    lines.push('');
  }

  return lines.join('\n');
}

function toPlainText(conversation) {
  const lines = [];
  const date = formatDateForFilename(conversation.created_at);
  lines.push(`Conversation: ${conversation.title || 'Conversation'}`);
  if (date) lines.push(`Created: ${date}`);
  if (conversation.model) lines.push(`Model: ${conversation.model}`);
  lines.push('');

  for (const msg of conversation.messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`[${msg.created_at || ''}] ${role}:`);
    lines.push(msg.content || '');
    lines.push('');
  }

  return lines.join('\n');
}

function toHtml(conversation) {
  const title = conversation.title || 'Conversation';
  const body = conversation.messages
    .map((msg) => {
      const roleClass = msg.role === 'user' ? 'user' : 'assistant';
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      const safeContent = (msg.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `
        <div class="message ${roleClass}">
          <div class="meta">
            <span class="role">${roleLabel}</span>
            <span class="time">${msg.created_at || ''}</span>
          </div>
          <div class="content"><pre>${safeContent}</pre></div>
        </div>
      `;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #050814; color: #e5e7eb; padding: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .meta-root { font-size: 0.8rem; color: #9ca3af; margin-bottom: 1.5rem; }
    .message { padding: 0.75rem 1rem; border-radius: 0.75rem; margin-bottom: 0.75rem; border: 1px solid #1f2933; background: #0b1020; }
    .message.user { border-color: #4f46e5; }
    .message.assistant { border-color: #0ea5e9; }
    .meta { display: flex; justify-content: space-between; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.25rem; }
    .content pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 0.9rem; margin: 0; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta-root">
    <div>ID: ${conversation.id}</div>
    ${conversation.model ? `<div>Model: ${conversation.model}</div>` : ''}
    ${conversation.workspace ? `<div>Workspace: ${conversation.workspace}</div>` : ''}
  </div>
  ${body}
</body>
</html>`;
}

// --------- Public API ----------

async function exportConversation(db, conversationId, format, targetPath) {
  const convo = getConversationWithMessages(db, conversationId);
  if (!convo) {
    throw new Error('Conversation not found');
  }

  const date = formatDateForFilename(convo.created_at);
  const baseName = sanitizeFilename(convo.title || 'conversation');

  let ext = '.txt';
  if (format === 'markdown') ext = '.md';
  else if (format === 'json') ext = '.json';
  else if (format === 'html') ext = '.html';

  const filename = `${baseName}${date ? `_${date}` : ''}${ext}`;

  const finalPath = targetPath && !targetPath.endsWith(path.sep)
    ? targetPath
    : targetPath
    ? path.join(targetPath, filename)
    : filename;

  let content;
  if (format === 'markdown') {
    content = toMarkdown(convo);
  } else if (format === 'json') {
    content = JSON.stringify(convo, null, 2);
  } else if (format === 'html') {
    content = toHtml(convo);
  } else {
    content = toPlainText(convo);
  }

  await fsPromises.writeFile(finalPath, content, 'utf-8');
  return finalPath;
}

async function exportAllConversations(db, format, directory) {
  const convos = getAllConversationsWithMessages(db);
  const dir = directory || process.cwd();
  if (!fs.existsSync(dir)) {
    await fsPromises.mkdir(dir, { recursive: true });
  }

  const results = [];
  for (const convo of convos) {
    const filePath = await exportConversation(db, convo.id, format, dir);
    results.push({ id: convo.id, path: filePath });
  }
  return results;
}

module.exports = {
  exportConversation,
  exportAllConversations,
};


