const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { validatePath, isWithinDirectory } = require('../../utils/pathValidator');

const DEFAULT_STORE_KEY = 'fsGrantedRootsV1';

function normalizePath(input) {
  const resolved = path.resolve(String(input || ''));
  const normalized = path.normalize(resolved).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function toEntry(rootPath, meta = {}) {
  return {
    path: rootPath,
    createdAt: meta.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    label: meta.label || null,
  };
}

class FsAccessService {
  constructor({ store, storeKey = DEFAULT_STORE_KEY } = {}) {
    this.store = store;
    this.storeKey = storeKey;
    this.grants = new Map();
    this._loadFromStore();
  }

  _loadFromStore() {
    if (!this.store?.get) return;
    const saved = this.store.get(this.storeKey, []);
    if (!Array.isArray(saved)) return;

    for (const entry of saved) {
      const rootPath = String(entry?.path || '').trim();
      if (!rootPath) continue;
      this.grants.set(normalizePath(rootPath), toEntry(rootPath, entry));
    }
  }

  _saveToStore() {
    if (!this.store?.set) return;
    this.store.set(this.storeKey, this.listGrantedRoots());
  }

  _validateRoot(rootPath) {
    if (!rootPath || typeof rootPath !== 'string') {
      throw new Error('rootPath must be a non-empty string');
    }

    const validation = validatePath(rootPath, {
      allowAbsolute: true,
      isWrite: false,
      allowOutsideAllowedBases: false,
    });

    if (!validation.valid) {
      throw new Error(`Invalid root path: ${validation.reason}`);
    }

    return validation.normalizedPath;
  }

  _resolveScopedPath(targetPath, { isWrite = false, mustExist = false } = {}) {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('path must be a non-empty string');
    }

    const validation = validatePath(targetPath, {
      allowAbsolute: true,
      isWrite,
      allowOutsideAllowedBases: true,
    });

    if (!validation.valid) {
      throw new Error(`Invalid path: ${validation.reason}`);
    }

    const normalizedPath = validation.normalizedPath;
    const matchedRoot = this._matchGrantedRoot(normalizedPath);

    if (!matchedRoot) {
      throw new Error('Path is outside granted roots. Grant access with fs:grantRoot first.');
    }

    if (mustExist && !fs.existsSync(normalizedPath)) {
      throw new Error(`Path does not exist: ${normalizedPath}`);
    }

    return {
      normalizedPath,
      root: matchedRoot,
    };
  }

  _matchGrantedRoot(targetPath) {
    let winner = null;
    let winnerLen = -1;

    for (const entry of this.grants.values()) {
      if (isWithinDirectory(targetPath, entry.path)) {
        const len = entry.path.length;
        if (len > winnerLen) {
          winner = entry;
          winnerLen = len;
        }
      }
    }

    return winner;
  }

  grantRoot({ rootPath, label = null } = {}) {
    const normalizedRoot = this._validateRoot(rootPath);
    const key = normalizePath(normalizedRoot);
    const existing = this.grants.get(key);

    const next = toEntry(normalizedRoot, {
      ...(existing || {}),
      label: label || existing?.label || null,
    });

    this.grants.set(key, next);
    this._saveToStore();

    return {
      success: true,
      root: next,
    };
  }

  listGrantedRoots() {
    return [...this.grants.values()]
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  revokeRoot({ rootPath } = {}) {
    const normalizedRoot = this._validateRoot(rootPath);
    const key = normalizePath(normalizedRoot);
    const removed = this.grants.delete(key);
    this._saveToStore();

    return {
      success: true,
      removed,
      rootPath: normalizedRoot,
    };
  }

  async readScoped({ path: targetPath, encoding = 'utf-8' } = {}) {
    const { normalizedPath, root } = this._resolveScopedPath(targetPath, {
      isWrite: false,
      mustExist: true,
    });

    const data = await fsPromises.readFile(normalizedPath, encoding === 'buffer' ? undefined : encoding);

    return {
      success: true,
      path: normalizedPath,
      root: root.path,
      content: encoding === 'buffer' ? data : String(data),
    };
  }

  async writeScoped({ path: targetPath, content = '', encoding = 'utf-8' } = {}) {
    const { normalizedPath, root } = this._resolveScopedPath(targetPath, { isWrite: true });
    await fsPromises.mkdir(path.dirname(normalizedPath), { recursive: true });
    await fsPromises.writeFile(normalizedPath, content, encoding);

    return {
      success: true,
      path: normalizedPath,
      root: root.path,
    };
  }

  async mkdirScoped({ path: targetPath, recursive = true } = {}) {
    const { normalizedPath, root } = this._resolveScopedPath(targetPath, { isWrite: true });
    await fsPromises.mkdir(normalizedPath, { recursive: recursive !== false });

    return {
      success: true,
      path: normalizedPath,
      root: root.path,
    };
  }

  async listScoped({ path: targetPath, includeHidden = false } = {}) {
    const { normalizedPath, root } = this._resolveScopedPath(targetPath, {
      isWrite: false,
      mustExist: true,
    });

    const entries = await fsPromises.readdir(normalizedPath, { withFileTypes: true });
    const rows = [];

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;
      const fullPath = path.join(normalizedPath, entry.name);
      const stat = await fsPromises.stat(fullPath);
      rows.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'dir' : 'file',
        size: entry.isDirectory() ? null : stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }

    return {
      success: true,
      path: normalizedPath,
      root: root.path,
      entries: rows,
    };
  }
}

function registerFsScopedHandlers(ipcMain, fsService) {
  ipcMain.handle('fs:grantRoot', async (_, payload = {}) => fsService.grantRoot(payload));
  ipcMain.handle('fs:listGrantedRoots', async () => fsService.listGrantedRoots());
  ipcMain.handle('fs:revokeRoot', async (_, payload = {}) => fsService.revokeRoot(payload));

  ipcMain.handle('fs:readScoped', async (_, payload = {}) => fsService.readScoped(payload));
  ipcMain.handle('fs:writeScoped', async (_, payload = {}) => fsService.writeScoped(payload));
  ipcMain.handle('fs:listScoped', async (_, payload = {}) => fsService.listScoped(payload));
  ipcMain.handle('fs:mkdirScoped', async (_, payload = {}) => fsService.mkdirScoped(payload));
}

module.exports = {
  FsAccessService,
  registerFsScopedHandlers,
};
