const fs = require('fs');

class DatabaseWriter {
  constructor({
    getDb,
    dbPath,
    coalesceMs = 500,
    logger = console,
  } = {}) {
    if (typeof getDb !== 'function') {
      throw new Error('DatabaseWriter requires getDb()');
    }
    if (!dbPath) {
      throw new Error('DatabaseWriter requires dbPath');
    }

    this.getDb = getDb;
    this.dbPath = dbPath;
    this.coalesceMs = Math.max(100, Number(coalesceMs) || 500);
    this.logger = logger || console;

    this.pending = false;
    this.inFlight = false;
    this.writeSequence = 0;
    this.waiters = [];
    this.timer = null;
    this.destroyed = false;

    this.metrics = {
      enqueued: 0,
      writes: 0,
      failedWrites: 0,
      lastReason: null,
      lastDurationMs: 0,
      lastError: null,
      lastWriteAt: 0,
    };
  }

  enqueueDbSave({ reason = 'unspecified', priority = 'normal' } = {}) {
    if (this.destroyed) {
      return Promise.resolve({
        success: false,
        skipped: true,
        reason: 'writer_shutdown',
      });
    }

    const targetSequence = this.writeSequence + (this.inFlight ? 2 : 1);
    const delayMs = priority === 'high' ? 0 : this.coalesceMs;

    this.metrics.enqueued += 1;
    this.metrics.lastReason = reason;
    this.pending = true;
    this._schedule(delayMs);

    return new Promise((resolve, reject) => {
      this.waiters.push({ targetSequence, resolve, reject });
    });
  }

  async flushDbSaves() {
    return this.enqueueDbSave({ reason: 'flush', priority: 'high' });
  }

  async shutdownDbWriter() {
    if (this.destroyed) {
      return { success: true, alreadyShutdown: true };
    }

    try {
      await this.flushDbSaves();
    } catch (error) {
      this.logger.error?.('[DatabaseWriter] flush during shutdown failed:', error.message);
    }

    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this._rejectAllWaiters(new Error('Database writer shutdown'));
    return { success: true };
  }

  getStats() {
    return {
      ...this.metrics,
      queue: {
        pending: this.pending,
        inFlight: this.inFlight,
        waiters: this.waiters.length,
        writeSequence: this.writeSequence,
      },
    };
  }

  _schedule(delayMs) {
    if (this.destroyed) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this._drain().catch((error) => {
        this.logger.error?.('[DatabaseWriter] drain failed:', error.message);
      });
    }, Math.max(0, delayMs));
  }

  async _drain() {
    if (this.destroyed || this.inFlight || !this.pending) {
      return;
    }

    this.pending = false;
    this.inFlight = true;
    const startedAt = Date.now();

    try {
      await this._writeSnapshot();
      this.writeSequence += 1;
      this.metrics.writes += 1;
      this.metrics.lastDurationMs = Date.now() - startedAt;
      this.metrics.lastWriteAt = Date.now();
      this.metrics.lastError = null;
      this._resolveWaiters();
    } catch (error) {
      this.metrics.failedWrites += 1;
      this.metrics.lastError = error.message;
      this._rejectAllWaiters(error);
      throw error;
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this._schedule(0);
      }
    }
  }

  async _writeSnapshot() {
    const db = this.getDb();
    if (!db) {
      throw new Error('Database not initialized');
    }

    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = `${this.dbPath}.tmp`;

    await fs.promises.writeFile(tmpPath, buffer);
    try {
      await fs.promises.rename(tmpPath, this.dbPath);
    } catch (error) {
      // Windows can reject rename-over-existing in some cases.
      if (error?.code === 'EPERM' || error?.code === 'EEXIST') {
        await fs.promises.copyFile(tmpPath, this.dbPath);
        await fs.promises.unlink(tmpPath).catch(() => {});
      } else {
        await fs.promises.unlink(tmpPath).catch(() => {});
        throw error;
      }
    }
  }

  _resolveWaiters() {
    if (!this.waiters.length) return;

    const remaining = [];
    for (const waiter of this.waiters) {
      if (waiter.targetSequence <= this.writeSequence) {
        waiter.resolve({
          success: true,
          writeSequence: this.writeSequence,
          durationMs: this.metrics.lastDurationMs,
        });
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }

  _rejectAllWaiters(error) {
    if (!this.waiters.length) return;
    const pendingWaiters = this.waiters.splice(0, this.waiters.length);
    for (const waiter of pendingWaiters) {
      waiter.reject(error);
    }
  }
}

module.exports = {
  DatabaseWriter,
};

