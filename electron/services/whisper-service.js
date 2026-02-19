const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let whisperLib = null;

try {
  // Optional dependency, may not be installed
  // eslint-disable-next-line global-require
    whisperLib = require('whisper-node');
} catch (e) {
  // If not installed, we'll fall back to CLI or report unsupported
}

function isAvailable() {
  if (whisperLib) {
    return { available: true, backend: 'whisper-node' };
  }
  // Check for a `whisper` CLI in PATH as a fallback
  const hasCli = !!process.env.PATH && process.env.PATH.split(path.delimiter).some((p) => {
    try {
      return fs.existsSync(path.join(p, process.platform === 'win32' ? 'whisper.exe' : 'whisper'));
    } catch {
      return false;
    }
  });
  if (hasCli) {
    return { available: true, backend: 'cli' };
  }
  return {
    available: false,
    backend: null,
    reason:
      'Whisper backend not found. Install `whisper-node` or a `whisper` CLI and restart DevForge.',
  };
}

async function writeTempFile(buffer, extension = '.webm') {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'devforge-audio-'));
  const file = path.join(dir, `input${extension}`);
  await fsPromises.writeFile(file, buffer);
  return file;
}

async function transcribeBuffer(buffer) {
  const status = isAvailable();
  if (!status.available) {
    throw new Error(status.reason || 'Whisper backend not available');
  }

  const filePath = await writeTempFile(buffer);

  if (status.backend === 'whisper-node') {
    // Use whisper-node if present
    // This is a placeholder; actual API may differ based on library version.
    const result = await whisperLib.transcribe(filePath, {
      language: 'en',
      model: 'base',
    });
    return { text: result?.text || '', raw: result };
  }

  // Fallback: try to call `whisper` CLI
  return new Promise((resolve, reject) => {
    const exe = process.platform === 'win32' ? 'whisper.exe' : 'whisper';
    const child = spawn(exe, ['-f', filePath, '-otxt'], {
      cwd: path.dirname(filePath),
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('exit', async (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Whisper CLI exited with code ${code}: ${stderr || 'Unknown error. Is whisper installed?'}`,
          ),
        );
        return;
      }
      try {
        const outPath = filePath.replace(/\\.[^.]+$/, '.txt');
        const text = await fsPromises.readFile(outPath, 'utf-8');
        resolve({ text, raw: null });
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = {
  isAvailable,
  transcribeBuffer,
};



