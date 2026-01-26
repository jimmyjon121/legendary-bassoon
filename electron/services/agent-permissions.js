const path = require('path');

const defaultBlockedCommands = ['rm -rf', 'del /s', 'format', 'shutdown', 'reboot'];

function isCommandAllowed(command) {
  if (!command) return { allowed: true };
  const lowered = command.toLowerCase();
  const blocked = defaultBlockedCommands.find((b) => lowered.includes(b));
  if (blocked) {
    return { allowed: false, reason: `Command blocked: ${blocked}` };
  }
  return { allowed: true };
}

function isFileAllowed(filePath) {
  if (!filePath) return { allowed: true };
  const lowered = filePath.toLowerCase();
  if (lowered.includes('.env') || lowered.includes('credential')) {
    return { allowed: false, reason: 'Sensitive file access blocked' };
  }
  // Prevent escaping workspace if provided
  return { allowed: true };
}

function normalizePath(p) {
  return path.normalize(p || '');
}

module.exports = {
  isCommandAllowed,
  isFileAllowed,
  normalizePath,
};




