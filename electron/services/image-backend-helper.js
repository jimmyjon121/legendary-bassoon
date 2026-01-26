const { exec } = require('child_process');

class ImageBackendHelper {
  constructor({ shell, makeRequest, store }) {
    this.shell = shell;
    this.makeRequest = makeRequest;
    this.store = store;
  }

  async getStatus(endpoint) {
    const status = {
      installed: Boolean(this.store?.get('imageBackendPath')),
      running: false,
    };
    if (this.makeRequest && endpoint) {
      try {
        const res = await this.makeRequest(`${endpoint}/system`, { timeout: 2000 });
        status.running = res.status === 200;
      } catch {
        status.running = false;
      }
    }
    return status;
  }

  async openInstallPage() {
    if (!this.shell) throw new Error('Shell integration unavailable');
    await this.shell.openExternal('https://github.com/comfyanonymous/ComfyUI');
    return { success: true };
  }

  async start(command) {
    if (!command) {
      throw new Error('Set an image backend start command in Settings first.');
    }
    exec(command);
    return { success: true };
  }

  async stop(stopCommand) {
    if (!stopCommand) {
      throw new Error('Set an image backend stop command in Settings first.');
    }
    exec(stopCommand);
    return { success: true };
  }
}

let helperInstance = null;

function getImageBackendHelper(deps) {
  if (!helperInstance) {
    helperInstance = new ImageBackendHelper(deps);
  }
  return helperInstance;
}

module.exports = {
  getImageBackendHelper,
};

