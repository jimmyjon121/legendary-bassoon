class JobQueue {
  constructor() {
    this.queue = [];
    this.active = null;
  }

  enqueue(fn, options = {}) {
    return new Promise((resolve, reject) => {
      const job = {
        fn,
        resolve,
        reject,
        priority: options.priority ?? 0,
      };
      this.queue.push(job);
      this.queue.sort((a, b) => a.priority - b.priority);
      this._runNext();
    });
  }

  _runNext() {
    if (this.active || this.queue.length === 0) {
      return;
    }
    const job = this.queue.shift();
    this.active = job;

    Promise.resolve()
      .then(() => job.fn())
      .then((result) => {
        job.resolve(result);
      })
      .catch((error) => {
        job.reject(error);
      })
      .finally(() => {
        this.active = null;
        this._runNext();
      });
  }

  /**
   * Check if queue is empty (no active or pending jobs)
   */
  isEmpty() {
    return this.active === null && this.queue.length === 0;
  }

  /**
   * Get current queue size
   */
  size() {
    return this.queue.length + (this.active ? 1 : 0);
  }
}

module.exports = JobQueue;

