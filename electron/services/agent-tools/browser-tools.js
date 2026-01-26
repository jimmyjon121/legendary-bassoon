const browserAgent = require('../browser-agent');

async function browseWeb({ url, actions = [], captureScreenshot = false, options = {} }) {
  const task = {
    type: 'browser_script',
    url,
    actions,
    captureScreenshot,
    options,
  };
  return browserAgent.runTask(task);
}

async function googleSearch(query) {
  return browserAgent.runTask({ type: 'browser_search', input: query });
}

module.exports = {
  browseWeb,
  googleSearch,
};




