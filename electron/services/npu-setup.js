const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Run the OpenVINO setup PowerShell script from the packaged app.
 *
 * This wraps scripts/setup-openvino.ps1 so the user can just press a
 * button in the UI instead of typing commands.
 */
function runOpenVinoSetup(appPath) {
  return new Promise((resolve) => {
    try {
      const scriptPath = path.join(appPath, 'scripts', 'setup-openvino.ps1');
      if (!fs.existsSync(scriptPath)) {
        resolve({
          success: false,
          error: `Setup script not found at ${scriptPath}`,
        });
        return;
      }

      // Windows‑only helper
      if (process.platform !== 'win32') {
        resolve({
          success: false,
          error: 'OpenVINO helper script is only available on Windows builds.',
        });
        return;
      }

      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        {
          cwd: appPath,
          windowsHide: true,
        },
      );

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
          error: error.message,
          stdout,
          stderr,
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
    } catch (error) {
      resolve({
        success: false,
        error: error.message,
      });
    }
  });
}

module.exports = {
  runOpenVinoSetup,
};


