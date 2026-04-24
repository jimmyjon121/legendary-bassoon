#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IPC_HANDLERS_FILE = path.join(ROOT, 'electron', 'ipc-handlers.js');
const DB_WRITER_FILE = path.join(ROOT, 'electron', 'services', 'database-writer.js');

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const sliced = source.slice(start);
  const end = sliced.indexOf(endMarker);
  if (end < 0) return sliced;
  return sliced.slice(0, end);
}

function main() {
  const ipcHandlers = fs.readFileSync(IPC_HANDLERS_FILE, 'utf-8');
  const dbWriterExists = fs.existsSync(DB_WRITER_FILE);
  const saveDatabaseSection = extractBetween(
    ipcHandlers,
    'function saveDatabase(options = {})',
    'function flushDbSaves()'
  );
  const saveDatabaseSyncSection = extractBetween(
    ipcHandlers,
    'function saveDatabaseSync(reason = \'manual-sync\')',
    'function saveDatabase(options = {})'
  );

  const saveUsesAsyncWriter =
    /dbWriter\s*\.\s*enqueueDbSave/.test(saveDatabaseSection) &&
    !/writeFileSync/.test(saveDatabaseSection);

  const syncFallbackIsIsolated = /writeFileSync/.test(saveDatabaseSyncSection);
  const autosaveUsesQueuedPath = /setInterval\(\(\)\s*=>\s*\{\s*void\s+saveDatabase\(\{[^}]*reason:\s*'autosave'/.test(ipcHandlers);
  const hasIndexes =
    /idx_messages_conversation_created_at/.test(ipcHandlers) &&
    /idx_conversations_workspace_updated_at/.test(ipcHandlers) &&
    /idx_messages_created_at/.test(ipcHandlers);

  const result = {
    ok: dbWriterExists && saveUsesAsyncWriter && syncFallbackIsIsolated && autosaveUsesQueuedPath && hasIndexes,
    checks: {
      dbWriterExists,
      saveUsesAsyncWriter,
      syncFallbackIsIsolated,
      autosaveUsesQueuedPath,
      hasIndexes,
    },
    files: {
      ipcHandlers: path.relative(ROOT, IPC_HANDLERS_FILE),
      dbWriter: path.relative(ROOT, DB_WRITER_FILE),
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main();
