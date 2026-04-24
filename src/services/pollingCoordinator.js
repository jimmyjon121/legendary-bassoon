class PollingCoordinator {
  constructor() {
    this.tasks = new Map();
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  subscribe(key, config = {}) {
    if (!key || typeof config.run !== 'function') {
      return () => {};
    }

    const existing = this.tasks.get(key);
    const task = existing || {
      key,
      subscribers: 0,
      timer: null,
      isRunning: false,
      run: config.run,
      intervalMs: Math.max(500, Number(config.intervalMs) || 5000),
      hiddenIntervalMs: Math.max(
        1000,
        Number(config.hiddenIntervalMs) || Math.max(5000, (Number(config.intervalMs) || 5000) * 4)
      ),
      runWhenHidden: Boolean(config.runWhenHidden),
    };

    task.run = config.run;
    task.intervalMs = Math.max(500, Number(config.intervalMs) || task.intervalMs);
    task.hiddenIntervalMs = Math.max(
      1000,
      Number(config.hiddenIntervalMs) || Math.max(5000, task.intervalMs * 4)
    );
    task.runWhenHidden = Boolean(config.runWhenHidden);
    task.subscribers += 1;

    this.tasks.set(key, task);
    this.schedule(task);

    if (config.immediate) {
      this.execute(task).catch(() => {});
    }

    return () => this.unsubscribe(key);
  }

  unsubscribe(key) {
    const task = this.tasks.get(key);
    if (!task) return;

    task.subscribers = Math.max(0, task.subscribers - 1);
    if (task.subscribers > 0) return;

    if (task.timer) {
      clearInterval(task.timer);
      task.timer = null;
    }
    this.tasks.delete(key);
  }

  handleVisibilityChange() {
    for (const task of this.tasks.values()) {
      this.schedule(task);
    }
  }

  isVisible() {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  }

  schedule(task) {
    if (!task) return;
    if (task.timer) {
      clearInterval(task.timer);
      task.timer = null;
    }

    const intervalMs = this.isVisible() ? task.intervalMs : task.hiddenIntervalMs;
    task.timer = setInterval(() => {
      if (!task.runWhenHidden && !this.isVisible()) return;
      this.execute(task).catch(() => {});
    }, intervalMs);
  }

  async execute(task) {
    if (!task || task.isRunning) return;
    task.isRunning = true;
    try {
      await task.run();
    } finally {
      task.isRunning = false;
    }
  }
}

export const pollingCoordinator = new PollingCoordinator();

