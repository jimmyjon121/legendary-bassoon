# IPC API Reference

This is the canonical IPC contract for DevForge as of February 19, 2026.

## Security Model

- Renderer data access is **typed** through `window.electronAPI.data.*`.
- Renderer filesystem access is **scope-granted** through `window.electronAPI.fsScoped.*`.
- Raw SQL and broad filesystem IPC remain available only during a **one-release deprecation window**.

## Typed Data API (`window.electronAPI.data`)

### Conversations

- `conversationsList(payload)`
  - Payload: `{ workspace?: string, limit?: number, offset?: number }`
- `conversationsCreate(payload)`
  - Payload: `{ id, workspace, title?, model?, encrypted?, pinned?, starred?, tags?, folder_id?, message_count?, preview? }`
- `conversationsGetById(idOrPayload)`
  - Input: conversation id string or `{ id }`
- `conversationsUpdateMeta(payload)`
  - Payload: `{ id, title?, model?, preview?, messageCount?, folderId?, starred?, pinned?, tags?, encrypted?, updatedAt? }`
- `conversationsDelete(idOrPayload)`
  - Input: conversation id string or `{ id }`

### Messages

- `messagesListByConversation(payload)`
  - Payload: `{ conversationId, branchId?, includeAllBranches?, limit?, offset? }`
- `messagesAppend(payload)`
  - Payload: `{ id, conversationId, role, content, model?, tokensUsed?, createdAt?, branchId?, parentMessageId? }`
- `messagesUpdate(payload)`
  - Payload: `{ id, content?, model?, tokensUsed?, branchId?, parentMessageId?, conversationId? }`
- `messagesDelete(idOrPayload)`
  - Input: message id string or `{ id, conversationId? }`
- `messagesDeleteMany(payload)`
  - Payload: `{ ids: string[], conversationId? }`
- `messagesSearch(payload)`
  - Payload: `{ query, workspace?, conversationId?, limit? }`

### Attachments

- `attachmentsListByMessage(messageIdOrPayload)`
  - Input: message id string or `{ messageId }`
- `attachmentsSave(payload)`
  - Payload: `{ messageId, files, password? }`
- `attachmentsRead(payload)`
  - Payload: `{ filePath, password?, encoding?: 'base64' | 'utf-8' | 'buffer' }`

### Branches

- `branchesList(conversationIdOrPayload)`
  - Input: conversation id string or `{ conversationId }`
- `branchesCreate(payload)`
  - Payload: `{ id, conversationId, parentBranchId?, name? }`
- `branchesSwitch(payload)`
  - Payload: `{ conversationId, branchId? }`

### Search

- `searchConversations(payload)`
  - Payload: `{ query, workspace?, limit? }`
- `searchMessages(payload)`
  - Payload: `{ query, workspace?, conversationId?, limit? }`

## Scoped Filesystem API (`window.electronAPI.fsScoped`)

### Grant lifecycle

- `grantRoot(rootPath, label?)`
- `listGrantedRoots()`
- `revokeRoot(rootPath)`

### Scoped operations

- `read(path, encoding?)`
- `write(path, content, encoding?)`
- `list(path, options?)`
- `mkdir(path, recursive?)`

All scoped operations require the target path to be within a granted root.

## Deprecated APIs (One-Release Compatibility)

These are deprecated and emit runtime warnings:

- Raw SQL: `dbQuery`, `dbRun` (`db:query`, `db:run`)
- Broad FS: `readFile`, `writeFile`, `createFolder`, `listModels` (`fs:readFile`, `fs:writeFile`, `fs:createFolder`, `fs:listModels`)
- Legacy attachment channels: `saveMessageAttachments`, `readAttachment`

Migration target:

- Replace SQL usage with `window.electronAPI.data.*`
- Replace broad FS usage with `window.electronAPI.fsScoped.*`

## Error Handling

All methods may throw. Handle with try/catch in renderer code.

```javascript
try {
  const rows = await window.electronAPI.data.messagesSearch({ query: 'rollback', limit: 20 });
} catch (error) {
  console.error(error.message);
}
```
