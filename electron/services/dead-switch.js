/**
 * Dead Switch Service
 *
 * User-controlled nuclear option for the vault workspace. Purges encrypted
 * conversation data, attachments, models/nsfw downloads, encryption keys,
 * and stored vault password hash. Leaves the rest of the application intact.
 *
 * Flow:
 *   1. Renderer calls `vault:deadSwitchPrepare` -> gets a random confirmation code.
 *   2. User types that code into the UI.
 *   3. Renderer calls `vault:deadSwitchExecute` with the code.
 *   4. Service verifies the code, performs a multi-pass overwrite of files, then unlinks,
 *      clears the vault tables in SQLite, and wipes related settings.
 *
 * This service is explicitly framed as the USER's escape hatch, never used
 * autonomously by the application or by any persona. The safeword/aftercare
 * path never invokes it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OVERWRITE_PASSES = 3;
const CODE_LENGTH = 12;
const CODE_TTL_MS = 5 * 60 * 1000;

let pendingConfirmation = null;

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function prepareDeadSwitch() {
  const code = generateCode();
  pendingConfirmation = {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
  };
  return { code, expiresAt: pendingConfirmation.expiresAt };
}

function validateCode(candidate) {
  if (!pendingConfirmation) return false;
  if (Date.now() > pendingConfirmation.expiresAt) {
    pendingConfirmation = null;
    return false;
  }
  const expected = pendingConfirmation.code;
  if (typeof candidate !== 'string' || candidate.length !== expected.length) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  return crypto.timingSafeEqual(a, b);
}

/**
 * Securely overwrite a file: OVERWRITE_PASSES of random bytes + fsync, then unlink.
 * Falls back to simple unlink on unsupported platforms (e.g. locked DB files).
 */
async function secureWipeFile(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return { path: filePath, ok: false, reason: 'not-a-file' };
    const size = stat.size;
    let handle = null;
    try {
      handle = await fs.promises.open(filePath, 'r+');
      for (let pass = 0; pass < OVERWRITE_PASSES; pass += 1) {
        const chunk = crypto.randomBytes(Math.min(size, 64 * 1024));
        let written = 0;
        while (written < size) {
          const toWrite = Math.min(chunk.length, size - written);
          await handle.write(chunk, 0, toWrite, written);
          written += toWrite;
        }
        try { await handle.sync(); } catch (_) { /* best effort */ }
      }
    } finally {
      if (handle) await handle.close();
    }
    await fs.promises.unlink(filePath);
    return { path: filePath, ok: true };
  } catch (err) {
    try { await fs.promises.unlink(filePath); return { path: filePath, ok: true, note: 'fallback-unlink' }; } catch (_) {
      return { path: filePath, ok: false, reason: err.message };
    }
  }
}

async function wipeDirectory(dirPath) {
  try {
    const stat = await fs.promises.stat(dirPath);
    if (!stat.isDirectory()) return [];
  } catch (_) {
    return [];
  }
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await wipeDirectory(full)));
      try { await fs.promises.rmdir(full); } catch (_) { /* non-blocking */ }
    } else {
      results.push(await secureWipeFile(full));
    }
  }
  return results;
}

/**
 * Execute the dead switch. Requires:
 *   - `code`: the confirmation code previously returned by prepareDeadSwitch
 *   - `userDataPath`: absolute path to Electron user data directory (for DB, etc.)
 *   - `deps`: { getDb, saveDatabase, store }
 */
async function executeDeadSwitch({ code, userDataPath, deps = {} } = {}) {
  if (!validateCode(code)) {
    return { success: false, error: 'Invalid or expired confirmation code' };
  }
  pendingConfirmation = null;

  const report = { wiped: [], errors: [], dbTablesCleared: [] };

  // 1. Clear vault tables in SQLite (nsfw_auth, encrypted conversations/messages)
  try {
    const db = typeof deps.getDb === 'function' ? deps.getDb() : null;
    if (db) {
      try {
        db.run("DELETE FROM nsfw_auth WHERE id = 'nsfw'");
        report.dbTablesCleared.push('nsfw_auth');
      } catch (err) { report.errors.push({ step: 'nsfw_auth', error: err.message }); }

      try {
        db.run("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE workspace = 'nsfw')");
        db.run("DELETE FROM conversations WHERE workspace = 'nsfw'");
        report.dbTablesCleared.push('conversations/messages(workspace=nsfw)');
      } catch (err) { report.errors.push({ step: 'conversations', error: err.message }); }

      try {
        db.run("DELETE FROM branches WHERE conversation_id NOT IN (SELECT id FROM conversations)");
        report.dbTablesCleared.push('orphaned branches');
      } catch (_) { /* table may not exist */ }

      if (typeof deps.saveDatabase === 'function') {
        try { await deps.saveDatabase({ reason: 'dead-switch', priority: 'high', sync: true }); } catch (err) {
          report.errors.push({ step: 'saveDatabase', error: err.message });
        }
      }
    }
  } catch (err) {
    report.errors.push({ step: 'db', error: err.message });
  }

  // 2. Secure-wipe filesystem artifacts under userData
  const candidateDirs = [
    path.join(userDataPath, 'models', 'nsfw'),
    path.join(userDataPath, 'vault'),
    path.join(userDataPath, 'attachments', 'nsfw'),
    path.join(userDataPath, 'nsfw-images'),
  ];
  for (const dir of candidateDirs) {
    try {
      const results = await wipeDirectory(dir);
      report.wiped.push(...results.filter((r) => r.ok).map((r) => r.path));
      report.errors.push(...results.filter((r) => !r.ok).map((r) => ({ step: 'wipe', path: r.path, error: r.reason })));
      try { await fs.promises.rmdir(dir); } catch (_) { /* non-blocking */ }
    } catch (err) {
      report.errors.push({ step: 'wipeDir', path: dir, error: err.message });
    }
  }

  // 3. Clear vault-scoped settings in electron-store
  if (deps.store && typeof deps.store.delete === 'function') {
    const keysToClear = [
      'nsfwPassword',
      'vaultSafety',
      'vaultDeadSwitchHistory',
      'presets.*.nsfw',
    ];
    for (const key of keysToClear) {
      try { deps.store.delete(key); } catch (_) { /* non-blocking */ }
    }
  }

  report.timestamp = new Date().toISOString();
  return { success: true, report };
}

function cancelPending() {
  pendingConfirmation = null;
  return { success: true };
}

module.exports = {
  prepareDeadSwitch,
  executeDeadSwitch,
  cancelPending,
};
