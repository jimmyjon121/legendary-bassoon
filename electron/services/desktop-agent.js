let robot = null;
try {
  // Optional dependency – degrade gracefully if not installed
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  robot = require('robotjs');
} catch (e) {
  console.warn('Desktop agent unavailable: robotjs not installed:', e.message);
}

function isAvailable() {
  return !!robot;
}

async function runTask(task) {
  if (!robot) {
    return {
      status: 'error',
      logs: [
        'Desktop automation backend (robotjs) is not installed.',
        'To enable desktop agents, install robotjs and restart DevForge.',
      ],
      output: '',
      error: 'robotjs not installed',
    };
  }

  // For safety, the MVP implementation only reports screen info.
  const logs = [];
  logs.push('Desktop agent connected.');
  const size = robot.getScreenSize();
  logs.push(`Screen size: ${size.width}x${size.height}`);

  return {
    status: 'completed',
    logs,
    output: `Desktop agent is connected. Screen size is ${size.width}x${size.height}.`,
    error: null,
  };
}

module.exports = {
  isAvailable,
  runTask,
};

















