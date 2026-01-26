const { spawn } = require('child_process');
const os = require('os');

/**
 * Run a one-off shell command and capture its output.
 * This is intentionally simple (no persistent PTY) to avoid extra dependencies.
 */
async function runCommand({ cwd, command }) {
  if (!command || typeof command !== 'string') {
    throw new Error('Command is required');
  }

  const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || 'bash';
  const args =
    process.platform === 'win32'
      ? ['/c', command]
      : ['-lc', command];

  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd: cwd || process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        code: -1,
        stdout,
        stderr: stderr + os.EOL + error.message,
      });
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

module.exports = {
  runCommand,
};

















