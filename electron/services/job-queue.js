const DEFAULT_LANE_CONFIG = {
  lane_interactive: { concurrency: 1, priorityBase: -100 },
  lane_agent: { concurrency: 1, priorityBase: 10 },
  lane_embedding: { concurrency: 1, priorityBase: 0 },
  lane_maintenance: { concurrency: 1, priorityBase: 30 },
  default: { concurrency: 1, priorityBase: 20 },
};

class JobQueue {
  constructor(config = {}) {
    this.queue = [];
    this.activeJobs = new Map();
    this.nextJobId = 1;

    this.maxConcurrent = Number.isFinite(config.maxConcurrent)
      ? Math.max(1, Number(config.maxConcurrent))
      : 2;

    this.laneConfig = {
      ...DEFAULT_LANE_CONFIG,
      ...(config.laneConfig || {}),
    };

    this.metrics = {
      enqueued: 0,
      completed: 0,
      failed: 0,
      lastUpdatedAt: Date.now(),
    };

    this.laneLastDispatchAt = new Map();
    this.laneDurationStats = new Map();
    this.globalAvgDurationMs = 1200;
    this.globalDurationSamples = 0;
  }

  setLaneConfig(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    this.laneConfig = {
      ...this.laneConfig,
      ...patch,
    };
    this._schedule();
  }

  setMaxConcurrent(value) {
    if (!Number.isFinite(value)) return;
    this.maxConcurrent = Math.max(1, Number(value));
    this._schedule();
  }

  enqueue(fn, options = {}) {
    return new Promise((resolve, reject) => {
      const lane = String(options.lane || 'default');
      const laneMeta = this.laneConfig[lane] || this.laneConfig.default;
      const priorityBase = Number.isFinite(options.priorityBase)
        ? Number(options.priorityBase)
        : Number(laneMeta?.priorityBase || 0);
      const priorityDelta = Number.isFinite(options.priority)
        ? Number(options.priority)
        : 0;

      const job = {
        id: `job-${Date.now()}-${this.nextJobId += 1}`,
        fn,
        resolve,
        reject,
        lane,
        priority: priorityBase + priorityDelta,
        createdAt: Date.now(),
        meta: options.meta || null,
      };

      this.queue.push(job);
      this.metrics.enqueued += 1;
      this.metrics.lastUpdatedAt = Date.now();
      this._schedule();
    });
  }

  _laneActiveCount(lane) {
    let count = 0;
    for (const job of this.activeJobs.values()) {
      if (job.lane === lane) count += 1;
    }
    return count;
  }

  _canRunJob(job) {
    if (this.activeJobs.size >= this.maxConcurrent) {
      return false;
    }
    const laneMeta = this.laneConfig[job.lane] || this.laneConfig.default;
    const laneConcurrency = Math.max(1, Number(laneMeta?.concurrency || 1));
    return this._laneActiveCount(job.lane) < laneConcurrency;
  }

  _sortQueue() {
    const now = Date.now();
    const effectivePriority = (job) => {
      // Age-based boost prevents low-priority lanes from starving forever.
      const ageMs = Math.max(0, now - job.createdAt);
      const ageBoost = Math.min(40, Math.floor(ageMs / 3000)); // -1 priority every 3s, capped
      return job.priority - ageBoost;
    };

    const laneRecencyScore = (job) => {
      const last = this.laneLastDispatchAt.get(job.lane);
      if (!last) return -1;
      return now - last;
    };

    this.queue.sort((a, b) => {
      const aPriority = effectivePriority(a);
      const bPriority = effectivePriority(b);
      if (aPriority !== bPriority) return aPriority - bPriority;

      // If priorities tie, prefer lane that has waited longer since last dispatch.
      const aRecency = laneRecencyScore(a);
      const bRecency = laneRecencyScore(b);
      if (aRecency !== bRecency) return bRecency - aRecency;

      return a.createdAt - b.createdAt;
    });
  }

  _schedule() {
    if (this.queue.length === 0) return;
    this._sortQueue();

    let scheduledAny = false;
    let didWork = true;

    // Keep dispatching while there is capacity and eligible work.
    while (didWork && this.activeJobs.size < this.maxConcurrent && this.queue.length > 0) {
      didWork = false;
      for (let i = 0; i < this.queue.length; i += 1) {
        const candidate = this.queue[i];
        if (!this._canRunJob(candidate)) continue;

        const [job] = this.queue.splice(i, 1);
        this._runJob(job);
        scheduledAny = true;
        didWork = true;
        break;
      }
    }

    if (scheduledAny) {
      this.metrics.lastUpdatedAt = Date.now();
    }
  }

  _runJob(job) {
    job.startedAt = Date.now();
    this.activeJobs.set(job.id, job);
    this.laneLastDispatchAt.set(job.lane, Date.now());

    Promise.resolve()
      .then(() => job.fn())
      .then((result) => {
        this.metrics.completed += 1;
        job.resolve(result);
      })
      .catch((error) => {
        this.metrics.failed += 1;
        job.reject(error);
      })
      .finally(() => {
        const durationMs = Math.max(1, Date.now() - (job.startedAt || job.createdAt));
        this._recordDuration(job.lane, durationMs);
        this.activeJobs.delete(job.id);
        this.metrics.lastUpdatedAt = Date.now();
        this._schedule();
      });
  }

  _recordDuration(lane, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const sample = Math.min(300000, Math.max(1, Number(durationMs)));

    const prev = this.laneDurationStats.get(lane) || {
      avgDurationMs: this.globalAvgDurationMs,
      samples: 0,
    };
    const alpha = prev.samples < 10 ? 0.35 : 0.18;
    const avgDurationMs = (prev.avgDurationMs * (1 - alpha)) + (sample * alpha);

    this.laneDurationStats.set(lane, {
      avgDurationMs,
      samples: prev.samples + 1,
      updatedAt: Date.now(),
    });

    const globalAlpha = this.globalDurationSamples < 20 ? 0.2 : 0.08;
    this.globalAvgDurationMs = (this.globalAvgDurationMs * (1 - globalAlpha)) + (sample * globalAlpha);
    this.globalDurationSamples += 1;
  }

  _estimateLaneEtaMs(lane, now = Date.now()) {
    const laneMeta = this.laneConfig[lane] || this.laneConfig.default;
    const concurrency = Math.max(1, Number(laneMeta?.concurrency || 1));
    const queuedJobs = this.queue.filter((job) => job.lane === lane);
    const activeJobs = Array.from(this.activeJobs.values()).filter((job) => job.lane === lane);

    const stats = this.laneDurationStats.get(lane);
    const avgDurationMs = Number(stats?.avgDurationMs || this.globalAvgDurationMs || 1200);

    let activeRemainingMs = 0;
    if (activeJobs.length > 0) {
      const remainings = activeJobs.map((job) => {
        const elapsed = Math.max(0, now - (job.startedAt || job.createdAt || now));
        return Math.max(50, avgDurationMs - elapsed);
      });
      activeRemainingMs = Math.max(...remainings);
    }

    const queuedDurationMs = (queuedJobs.length / concurrency) * avgDurationMs;
    return Math.round(Math.max(0, activeRemainingMs + queuedDurationMs));
  }

  isEmpty() {
    return this.activeJobs.size === 0 && this.queue.length === 0;
  }

  size() {
    return this.queue.length + this.activeJobs.size;
  }

  getState() {
    const lanes = {};
    const laneNames = new Set([
      ...Object.keys(this.laneConfig || {}),
      ...this.queue.map((j) => j.lane),
      ...Array.from(this.activeJobs.values()).map((j) => j.lane),
    ]);

    const now = Date.now();
    const laneEtas = [];

    for (const lane of laneNames) {
      const stats = this.laneDurationStats.get(lane);
      const avgDurationMs = Number(stats?.avgDurationMs || this.globalAvgDurationMs || 1200);
      const etaMs = this._estimateLaneEtaMs(lane, now);
      laneEtas.push(etaMs);
      lanes[lane] = {
        queued: this.queue.filter((job) => job.lane === lane).length,
        active: this._laneActiveCount(lane),
        concurrency: Math.max(1, Number((this.laneConfig[lane] || this.laneConfig.default)?.concurrency || 1)),
        avgDurationMs: Math.round(avgDurationMs),
        etaMs,
      };
    }

    return {
      queued: this.queue.length,
      active: this.activeJobs.size,
      maxConcurrent: this.maxConcurrent,
      overallEtaMs: laneEtas.length ? Math.max(...laneEtas) : 0,
      lanes,
      activeJobs: Array.from(this.activeJobs.values()).map((job) => ({
        id: job.id,
        lane: job.lane,
        priority: job.priority,
        ageMs: now - job.createdAt,
        runningMs: Math.max(0, now - (job.startedAt || job.createdAt)),
        meta: job.meta || null,
      })),
      metrics: { ...this.metrics },
    };
  }
}

module.exports = JobQueue;
