const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Run the OpenVINO setup PowerShell script from the packaged app.
 *
 * This wraps scripts/setup-openvino.ps1 so the user can start setup from UI
 * without manual shell commands.
 */
function runOpenVinoSetup(appPath) {
  return new Promise((resolve) => {
    try {
      const resourcesPath = process.resourcesPath || null;
      const candidates = [
        appPath ? path.join(appPath, 'scripts', 'setup-openvino.ps1') : null,
        appPath && String(appPath).includes('app.asar')
          ? path.join(String(appPath).replace('app.asar', 'app.asar.unpacked'), 'scripts', 'setup-openvino.ps1')
          : null,
        resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'scripts', 'setup-openvino.ps1') : null,
        resourcesPath ? path.join(resourcesPath, 'scripts', 'setup-openvino.ps1') : null,
        path.join(process.cwd(), 'scripts', 'setup-openvino.ps1'),
        path.join(__dirname, '../../scripts/setup-openvino.ps1'),
      ].filter(Boolean);

      const scriptPath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!scriptPath) {
        resolve({
          success: false,
          error: `Setup script not found. Checked: ${candidates.join(', ')}`,
        });
        return;
      }

      if (process.platform !== 'win32') {
        resolve({
          success: false,
          error: 'OpenVINO helper script is only available on Windows builds.',
        });
        return;
      }

      const workingDir = path.dirname(path.dirname(scriptPath));
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        {
          cwd: workingDir,
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
          scriptPath,
          cwd: workingDir,
          stdout,
          stderr,
        });
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          code,
          scriptPath,
          cwd: workingDir,
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

const exported = {
  runOpenVinoSetup,
  runOpenVINOSetup: runOpenVinoSetup,
};

module.exports = exported;
module.exports.default = exported;
