/**
 * Admin Helper
 *
 * Small wrapper around sudo-prompt to run commands with elevation
 * when absolutely necessary (e.g. system-level tweaks).
 *
 * All callers should be very conservative about what they run here.
 */

const sudo = require('sudo-prompt');

function runAsAdmin(command, options = {}) {
  const { name = 'DevForge' } = options;

  return new Promise((resolve, reject) => {
    sudo.exec(command, { name }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = {
  runAsAdmin,
};


