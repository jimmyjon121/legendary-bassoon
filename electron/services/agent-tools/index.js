const { exec } = require('child_process');
const util = require('util');
const fileTools = require('./file-tools');
const browserTools = require('./browser-tools');
const gitTools = require('./git-tools');

const execAsync = util.promisify(exec);

async function runCommand(cmd, cwd) {
  const result = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function searchCodebase(_query) {
  // Placeholder: wire to semantic search / ripgrep later
  return { results: [], note: 'semantic search not yet implemented' };
}

async function analyzeError(errorText) {
  // Minimal error parsing stub
  return {
    summary: errorText?.slice(0, 500) || 'No error provided',
    hints: ['Check stack trace', 'Verify dependencies', 'Re-run with verbose logs'],
  };
}

module.exports = {
  ...fileTools,
  ...browserTools,
  ...gitTools,
  runCommand,
  searchCodebase,
  analyzeError,
};




