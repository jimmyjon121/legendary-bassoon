const os = require('os');
const path = require('path');
const fs = require('fs');

let puppeteer = null;
try {
  // Optional dependency – degrade gracefully if not installed
  // eslint-disable-next-line global-require
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.warn('Browser agent unavailable: puppeteer-core not installed:', e.message);
}

function isAvailable() {
  return !!puppeteer;
}

function detectChromeExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const platform = process.platform;
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(
      'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\\\Chrome\\\\Application\\\\chrome.exe'),
      'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
      'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/microsoft-edge',
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function launchBrowser(logs, options = {}) {
  if (!puppeteer) {
    return { browser: null, error: 'puppeteer-core not installed' };
  }

  const executablePath = options.executablePath || detectChromeExecutable();
  if (!executablePath) {
    logs.push('No Chrome/Edge executable found. Set CHROME_PATH env or configure a path in settings.');
  }

  logs.push(`Launching browser (headless: ${options.headless ?? 'new'})…`);
  const browser = await puppeteer.launch({
    headless: options.headless ?? 'new',
    executablePath: executablePath || undefined,
    defaultViewport: options.viewport || { width: 1280, height: 720 },
    args: ['--no-sandbox', ...(options.args || [])],
  });
  return { browser, executablePath };
}

async function performActions(page, actions, logs) {
  for (const action of actions || []) {
    switch (action.type) {
      case 'goto': {
        logs.push(`Navigate: ${action.url}`);
        await page.goto(action.url, { waitUntil: action.waitUntil || 'domcontentloaded', timeout: action.timeout || 30000 });
        break;
      }
      case 'click': {
        logs.push(`Click: ${action.selector}`);
        await page.click(action.selector, { delay: action.delay || 0 });
        break;
      }
      case 'type': {
        logs.push(`Type into ${action.selector}`);
        await page.type(action.selector, action.text || '', { delay: action.delay || 30 });
        if (action.submit) {
          await page.keyboard.press('Enter');
        }
        break;
      }
      case 'waitForSelector': {
        logs.push(`Wait for selector: ${action.selector}`);
        await page.waitForSelector(action.selector, { timeout: action.timeout || 15000 });
        break;
      }
      case 'waitForTimeout': {
        logs.push(`Wait ${action.ms}ms`);
        await page.waitForTimeout(action.ms || 500);
        break;
      }
      case 'scroll': {
        const distance = action.distance || 500;
        logs.push(`Scroll by ${distance}`);
        await page.evaluate((d) => window.scrollBy(0, d), distance);
        break;
      }
      case 'screenshot': {
        logs.push(`Screenshot: ${action.path || 'buffer'}`);
        const buffer = await page.screenshot({ fullPage: !!action.fullPage });
        if (action.savePath) {
          fs.writeFileSync(action.savePath, buffer);
        }
        break;
      }
      default:
        logs.push(`Unknown action type: ${action.type}`);
    }
  }
}

async function runGoogleSearchTask(task) {
  if (!puppeteer) {
    return {
      status: 'error',
      logs: [
        'Browser automation backend (puppeteer-core) is not installed.',
        'To enable browser agents, install puppeteer-core and configure a Chromium/Chrome executable path.',
      ],
      output: '',
      error: 'puppeteer-core not installed',
    };
  }

  let browser;
  const logs = [];

  try {
    const { browser: launchedBrowser, executablePath } = await launchBrowser(logs, task.options || {});
    browser = launchedBrowser;
    if (!browser) {
      return {
        status: 'error',
        logs,
        output: '',
        error: 'Failed to launch browser',
      };
    }
    if (executablePath) {
      logs.push(`Using browser executable: ${executablePath}`);
    }

    const page = await browser.newPage();
    const query = encodeURIComponent(task.input || '');
    const url = `https://www.google.com/search?q=${query}`;

    logs.push(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    logs.push('Extracting top results…');
    const results = await page.$$eval('a', (links) =>
      links
        .map((a) => ({
          title: a.innerText || '',
          href: a.href || '',
        }))
        .filter((r) => r.title && r.href)
        .slice(0, 5),
    );

    const osName = `${os.type()} ${os.release()}`;
    const summaryLines = [
      `Agent: basic Google search on ${osName}`,
      '',
      `Query: ${task.input || ''}`,
      '',
      'Top results:',
      ...results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.href}`),
    ];

    logs.push(`Found ${results.length} result(s).`);

    return {
      status: 'completed',
      logs,
      output: summaryLines.join('\n'),
      error: null,
    };
  } catch (error) {
    logs.push(`Error: ${error.message}`);
    return {
      status: 'error',
      logs,
      output: '',
      error: error.message,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}

async function runBrowserScriptTask(task) {
  if (!puppeteer) {
    return {
      status: 'error',
      logs: ['puppeteer-core not installed'],
      output: '',
      error: 'puppeteer-core not installed',
    };
  }

  const logs = [];
  let browser;

  try {
    const { browser: launchedBrowser, executablePath } = await launchBrowser(logs, task.options || {});
    browser = launchedBrowser;
    if (!browser) {
      return { status: 'error', logs, output: '', error: 'Failed to launch browser' };
    }
    if (executablePath) {
      logs.push(`Using browser executable: ${executablePath}`);
    }

    const page = await browser.newPage();
    const startUrl = task.url || 'about:blank';
    logs.push(`Opening ${startUrl}`);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (Array.isArray(task.actions) && task.actions.length > 0) {
      await performActions(page, task.actions, logs);
    }

    let screenshotPath = null;
    if (task.captureScreenshot) {
      const buffer = await page.screenshot({ fullPage: true });
      const tempPath = path.join(os.tmpdir(), `browser-agent-${Date.now()}.png`);
      fs.writeFileSync(tempPath, buffer);
      screenshotPath = tempPath;
      logs.push(`Screenshot saved to ${tempPath}`);
    }

    const title = await page.title();
    const url = page.url();

    return {
      status: 'completed',
      logs,
      output: `Visited ${url}\nTitle: ${title}${screenshotPath ? `\nScreenshot: ${screenshotPath}` : ''}`,
      error: null,
    };
  } catch (error) {
    logs.push(`Error: ${error.message}`);
    return {
      status: 'error',
      logs,
      output: '',
      error: error.message,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}

async function runTask(task) {
  switch (task.type) {
    case 'browser_search':
      return runGoogleSearchTask(task);
    case 'browser_script':
    case 'browser_navigate':
      return runBrowserScriptTask(task);
    default:
      return {
        status: 'error',
        logs: [`Unknown browser agent task type: ${task.type}`],
        output: '',
        error: `Unknown browser agent task type: ${task.type}`,
      };
  }
}

module.exports = {
  isAvailable,
  runTask,
  detectChromeExecutable,
};













