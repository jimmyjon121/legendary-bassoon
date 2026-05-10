const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const HANDOFF_SCHEMA_VERSION = 'devforge.handoff.v1';

function defaultSpawnDetached(command, args, options) {
  const child = spawn(command, args, options);
  child.unref();
  return { pid: child.pid };
}

function isExecutableCandidate(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  if (candidate.includes('\0')) return false;
  return true;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function createDevForgeHandoff(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const shell = options.shell || null;
  const spawnDetached = options.spawnDetached || defaultSpawnDetached;
  const now = options.now || (() => new Date());
  const sharedHome = env.DEVFORGE_SHARED_HOME || env.DEVFORGE_HOME || path.join(homeDir, '.devforge');
  const checkoutRoot = env.DEVFORGE_IDE_CHECKOUT || path.join(homeDir, 'Downloads', 'devforge-vscode', 'upstream');

  function ensureSharedHome() {
    fsImpl.mkdirSync(sharedHome, { recursive: true });
    fsImpl.mkdirSync(path.join(sharedHome, 'handoff'), { recursive: true });
    fsImpl.mkdirSync(path.join(sharedHome, 'loadouts'), { recursive: true });
    fsImpl.mkdirSync(path.join(sharedHome, 'ide-user-data'), { recursive: true });
    fsImpl.mkdirSync(path.join(sharedHome, 'ide-extensions'), { recursive: true });
    return sharedHome;
  }

  function validateProjectPath(projectPath) {
    const raw = String(projectPath || '').trim();
    if (!raw) {
      return {
        ok: false,
        code: 'PROJECT_REQUIRED',
        message: 'Choose a project folder in Anvil before opening DevForge.',
      };
    }

    if (!path.isAbsolute(raw)) {
      return {
        ok: false,
        code: 'PROJECT_PATH_NOT_ABSOLUTE',
        message: 'DevForge handoff requires an absolute project path.',
      };
    }

    const resolved = path.resolve(raw);
    try {
      const stat = fsImpl.statSync(resolved);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          code: 'PROJECT_NOT_DIRECTORY',
          message: 'DevForge handoff target must be a project directory.',
          projectPath: resolved,
        };
      }

      let realPath = resolved;
      try {
        realPath = fsImpl.realpathSync(resolved);
      } catch (_) {
        realPath = resolved;
      }

      return {
        ok: true,
        projectPath: realPath,
      };
    } catch (error) {
      return {
        ok: false,
        code: 'PROJECT_NOT_FOUND',
        message: `Project folder is not available: ${error.message}`,
        projectPath: resolved,
      };
    }
  }

  function buildHandoffUrl(projectPath, scheme = 'devforge') {
    const url = new URL(`${scheme}://open`);
    url.searchParams.set('project', projectPath);
    url.searchParams.set('source', 'anvil-hub');
    return url.toString();
  }

  function buildWorkspaceProtocolUrl(projectPath, scheme = 'anvil') {
    return `${scheme}:workspace?${pathToFileURL(projectPath).toString()}`;
  }

  function getLauncherCandidates() {
    return unique([
      env.DEVFORGE_IDE_BINARY,
      env.ANVIL_IDE_BINARY,
      process.platform === 'win32'
        ? path.join(checkoutRoot, '.build', 'electron', 'anvil.exe')
        : path.join(checkoutRoot, '.build', 'electron', 'anvil'),
      process.platform === 'darwin'
        ? path.join(checkoutRoot, '.build', 'electron', 'Anvil.app', 'Contents', 'MacOS', 'Anvil')
        : null,
      path.join(checkoutRoot, 'scripts', 'code.sh'),
    ]);
  }

  function resolveLauncher() {
    for (const candidate of getLauncherCandidates()) {
      if (!isExecutableCandidate(candidate)) continue;
      try {
        if (path.isAbsolute(candidate)) {
          const stat = fsImpl.statSync(candidate);
          if (!stat.isFile()) continue;
        }
        return candidate;
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  function readProductProtocol() {
    const productPath = path.join(checkoutRoot, 'product.json');
    try {
      const product = JSON.parse(fsImpl.readFileSync(productPath, 'utf8'));
      return {
        productPath,
        urlProtocol: product.urlProtocol || null,
        applicationName: product.applicationName || null,
        nameLong: product.nameLong || null,
      };
    } catch (error) {
      return {
        productPath,
        urlProtocol: null,
        error: error.message,
      };
    }
  }

  function isRawCodeOssElectronBinary(launcher) {
    const normalized = String(launcher || '').replace(/\\/g, '/');
    const name = path.basename(normalized).toLowerCase();
    return normalized.includes('/.build/electron/')
      || name === 'anvil'
      || name === 'anvil.exe'
      || name === 'code - oss'
      || name === 'code - oss.exe';
  }

  function buildLauncherArgs(projectPath, launcher) {
    ensureSharedHome();
    const ideUserDataDir = path.join(sharedHome, 'ide-user-data');
    const ideExtensionsDir = path.join(sharedHome, 'ide-extensions');
    const prefixArgs = isRawCodeOssElectronBinary(launcher) ? ['.'] : [];
    const linuxDevBuildArgs = process.platform === 'linux' ? ['--disable-gpu', '--no-sandbox'] : [];
    return {
      args: [
        ...prefixArgs,
        '--user-data-dir', ideUserDataDir,
        '--extensions-dir', ideExtensionsDir,
        '--disable-extension', 'GitHub.copilot-chat',
        ...linuxDevBuildArgs,
        projectPath,
      ],
      ideUserDataDir,
      ideExtensionsDir,
    };
  }

  function buildLauncherEnv() {
    const launcherEnv = { ...env };
    const sanitizedEnvRemoved = [];

    const removeEnvKey = (key) => {
      if (Object.prototype.hasOwnProperty.call(launcherEnv, key)) {
        delete launcherEnv[key];
        sanitizedEnvRemoved.push(key);
      }
    };

    removeEnvKey('ELECTRON_RUN_AS_NODE');
    for (const key of Object.keys(launcherEnv)) {
      if (key.startsWith('VSCODE_')) {
        removeEnvKey(key);
      }
    }

    const localNodeBin = path.join(homeDir, '.local', 'node-v22.14.0-linux-arm64', 'bin');
    launcherEnv.PATH = unique([localNodeBin, launcherEnv.PATH]).join(path.delimiter);
    launcherEnv.NODE_ENV = launcherEnv.NODE_ENV || 'development';
    launcherEnv.VSCODE_DEV = '1';
    launcherEnv.VSCODE_CLI = '1';
    launcherEnv.ELECTRON_ENABLE_LOGGING = launcherEnv.ELECTRON_ENABLE_LOGGING || '1';
    launcherEnv.DEVFORGE_SHARED_HOME = sharedHome;
    launcherEnv.DEVFORGE_HOME = sharedHome;

    return {
      env: launcherEnv,
      sanitizedEnvRemoved: sanitizedEnvRemoved.sort(),
    };
  }

  function writeLastHandoff(projectPath, metadata = {}) {
    ensureSharedHome();
    const pathHash = require('crypto').createHash('sha256').update(projectPath).digest('hex');
    const payload = {
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      sourceApp: 'anvil-hub',
      targetApp: 'devforge-ide',
      projectPath,
      projectPathHash: pathHash,
      sharedHome,
      createdAt: now().toISOString(),
      ...metadata,
    };
    const targetPath = path.join(sharedHome, 'handoff', 'last-open.json');
    const tmpPath = `${targetPath}.tmp`;
    fsImpl.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fsImpl.renameSync(tmpPath, targetPath);
    return {
      path: targetPath,
      pathHash,
    };
  }

  function writeLaunchRecord(record = {}) {
    ensureSharedHome();
    const targetPath = path.join(sharedHome, 'handoff', 'last-launch.json');
    const tmpPath = `${targetPath}.tmp`;
    const payload = {
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      sourceApp: 'anvil-hub',
      targetApp: 'devforge-ide',
      createdAt: now().toISOString(),
      ...record,
    };
    fsImpl.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fsImpl.renameSync(tmpPath, targetPath);
    return targetPath;
  }

  async function openProject(payload = {}) {
    const validation = validateProjectPath(payload.projectPath);
    if (!validation.ok) {
      return {
        success: false,
        error: validation.message,
        code: validation.code,
        projectPath: validation.projectPath || null,
      };
    }

    const projectPath = validation.projectPath;
    const devforgeUrl = buildHandoffUrl(projectPath, 'devforge');
    const anvilWorkspaceUrl = buildWorkspaceProtocolUrl(projectPath, 'anvil');
    const product = readProductProtocol();
    const handoff = writeLastHandoff(projectPath, {
      devforgeUrl,
      anvilWorkspaceUrl,
      detectedUrlProtocol: product.urlProtocol,
    });

    const protocolMatchesProduct = product.urlProtocol === 'devforge';
    const shouldTryProtocol = payload.forceProtocol === true
      || payload.protocolOnly === true
      || protocolMatchesProduct;
    const skippedProtocolReason = shouldTryProtocol
      ? null
      : `Skipping devforge:// because Code-OSS currently reports urlProtocol "${product.urlProtocol || 'unknown'}".`;

    if (payload.preferProtocol !== false && shouldTryProtocol && shell?.openExternal) {
      try {
        await shell.openExternal(devforgeUrl);
        return {
          success: true,
          launchedVia: 'protocol',
          protocolUrl: devforgeUrl,
          projectPath,
          sharedHome,
          handoff,
          detectedUrlProtocol: product.urlProtocol,
          warning: product.urlProtocol && product.urlProtocol !== 'devforge'
            ? `Code-OSS currently reports urlProtocol "${product.urlProtocol}"; direct launcher fallback is available if the OS has not registered devforge://.`
            : null,
        };
      } catch (error) {
        if (payload.protocolOnly === true) {
          return {
            success: false,
            code: 'DEVFORGE_PROTOCOL_UNAVAILABLE',
            error: error.message,
            protocolUrl: devforgeUrl,
            projectPath,
            sharedHome,
            handoff,
            detectedUrlProtocol: product.urlProtocol,
          };
        }
      }
    }

    const launcher = resolveLauncher();
    if (!launcher) {
      return {
        success: false,
        code: 'DEVFORGE_LAUNCHER_MISSING',
        error: 'DevForge IDE launcher was not found. Set DEVFORGE_IDE_BINARY or DEVFORGE_IDE_CHECKOUT.',
        protocolUrl: devforgeUrl,
        fallbackUrl: anvilWorkspaceUrl,
        projectPath,
        sharedHome,
        handoff,
        detectedUrlProtocol: product.urlProtocol,
      };
    }

    try {
      const launcherCwd = fsImpl.existsSync(checkoutRoot) ? checkoutRoot : undefined;
      const launcherInvocation = buildLauncherArgs(projectPath, launcher);
      const launcherEnv = buildLauncherEnv();
      const child = spawnDetached(launcher, launcherInvocation.args, {
        detached: true,
        stdio: 'ignore',
        cwd: launcherCwd,
        env: launcherEnv.env,
      });
      const launchRecordPath = writeLaunchRecord({
        status: 'spawned',
        launcher,
        launcherArgs: launcherInvocation.args,
        launcherCwd,
        pid: child?.pid || null,
        projectPath,
        sharedHome,
        ideUserDataDir: launcherInvocation.ideUserDataDir,
        ideExtensionsDir: launcherInvocation.ideExtensionsDir,
        detectedUrlProtocol: product.urlProtocol,
        skippedProtocolReason,
        sanitizedEnvRemoved: launcherEnv.sanitizedEnvRemoved,
      });
      return {
        success: true,
        launchedVia: 'launcher',
        launcher,
        launcherArgs: launcherInvocation.args,
        launcherCwd,
        pid: child?.pid || null,
        protocolUrl: devforgeUrl,
        fallbackUrl: anvilWorkspaceUrl,
        projectPath,
        sharedHome,
        ideUserDataDir: launcherInvocation.ideUserDataDir,
        ideExtensionsDir: launcherInvocation.ideExtensionsDir,
        handoff,
        launchRecordPath,
        detectedUrlProtocol: product.urlProtocol,
        skippedProtocolReason,
      };
    } catch (error) {
      let launchRecordPath = null;
      try {
        launchRecordPath = writeLaunchRecord({
          status: 'failed',
          launcher,
          projectPath,
          sharedHome,
          error: error.message,
          detectedUrlProtocol: product.urlProtocol,
        });
      } catch (_) {
        // non-blocking
      }
      return {
        success: false,
        code: 'DEVFORGE_LAUNCH_FAILED',
        error: error.message,
        launcher,
        protocolUrl: devforgeUrl,
        fallbackUrl: anvilWorkspaceUrl,
        projectPath,
        sharedHome,
        handoff,
        launchRecordPath,
        detectedUrlProtocol: product.urlProtocol,
      };
    }
  }

  function getStatus(projectPath = '') {
    const validation = projectPath ? validateProjectPath(projectPath) : { ok: false, code: 'PROJECT_REQUIRED' };
    const product = readProductProtocol();
    const launcher = resolveLauncher();
    const defaultLoadoutPath = path.join(sharedHome, 'loadouts', 'default.json');
    const ideUserDataDir = path.join(sharedHome, 'ide-user-data');
    const ideExtensionsDir = path.join(sharedHome, 'ide-extensions');
    return {
      success: true,
      sharedHome,
      checkoutRoot,
      detectedUrlProtocol: product.urlProtocol,
      detectedProduct: product,
      launcher,
      launcherAvailable: Boolean(launcher),
      project: validation.ok
        ? { valid: true, projectPath: validation.projectPath }
        : { valid: false, code: validation.code, projectPath: validation.projectPath || null },
      sharedState: {
        defaultLoadoutPath,
        defaultLoadoutExists: fsImpl.existsSync(defaultLoadoutPath),
        ideUserDataDir,
        ideExtensionsDir,
      },
      protocol: {
        preferred: 'devforge://open?project=...',
        codeOssWorkspace: product.urlProtocol ? `${product.urlProtocol}://workspace?...` : null,
      },
    };
  }

  return {
    buildHandoffUrl,
    buildWorkspaceProtocolUrl,
    ensureSharedHome,
    getStatus,
    openProject,
    resolveLauncher,
    validateProjectPath,
  };
}

module.exports = {
  createDevForgeHandoff,
  HANDOFF_SCHEMA_VERSION,
};
