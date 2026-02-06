/**
 * Night Worker Queue Service (Renderer)
 * 
 * Manages the queue of tasks for overnight autonomous AI execution.
 * Coordinates with the main process night worker scheduler.
 */

// Task types
const TASK_TYPES = {
  CODE_REVIEW: {
    id: 'code_review',
    name: 'Code Review',
    description: 'Review recent commits for issues and improvements',
    icon: '👀',
    autonomous: true,
    maxDuration: 3600000, // 1 hour
    priority: 1
  },
  TEST_GENERATION: {
    id: 'test_generation',
    name: 'Generate Tests',
    description: 'Create tests for uncovered code paths',
    icon: '🧪',
    autonomous: true,
    maxDuration: 7200000, // 2 hours
    priority: 2
  },
  DOCUMENTATION: {
    id: 'documentation',
    name: 'Update Documentation',
    description: 'Generate and update code documentation',
    icon: '📝',
    autonomous: true,
    maxDuration: 1800000, // 30 min
    priority: 3
  },
  DEPENDENCY_AUDIT: {
    id: 'dependency_audit',
    name: 'Audit Dependencies',
    description: 'Check for outdated or vulnerable dependencies',
    icon: '🔍',
    autonomous: true,
    maxDuration: 1200000, // 20 min
    priority: 1
  },
  CODE_CLEANUP: {
    id: 'code_cleanup',
    name: 'Code Cleanup',
    description: 'Fix lint issues, format code, remove dead code',
    icon: '🧹',
    autonomous: true,
    maxDuration: 2400000, // 40 min
    priority: 4
  },
  REFACTORING: {
    id: 'refactoring',
    name: 'Safe Refactoring',
    description: 'Apply low-risk refactoring suggestions',
    icon: '🔧',
    autonomous: false, // Requires approval
    maxDuration: 3600000,
    priority: 5
  },
  PERFORMANCE_ANALYSIS: {
    id: 'performance_analysis',
    name: 'Performance Analysis',
    description: 'Analyze code for performance improvements',
    icon: '⚡',
    autonomous: true,
    maxDuration: 2400000,
    priority: 3
  },
  SECURITY_SCAN: {
    id: 'security_scan',
    name: 'Security Scan',
    description: 'Scan for security vulnerabilities',
    icon: '🔒',
    autonomous: true,
    maxDuration: 1800000,
    priority: 1
  }
};

// Task status
const TASK_STATUS = {
  QUEUED: 'queued',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  PENDING_APPROVAL: 'pending_approval'
};

// Night schedule presets
const SCHEDULE_PRESETS = {
  OVERNIGHT: {
    name: 'Overnight',
    start: '22:00',
    end: '06:00',
    timezone: 'local'
  },
  EARLY_MORNING: {
    name: 'Early Morning',
    start: '04:00',
    end: '07:00',
    timezone: 'local'
  },
  WEEKEND: {
    name: 'Weekend Only',
    start: '00:00',
    end: '23:59',
    days: [0, 6], // Sunday, Saturday
    timezone: 'local'
  }
};

class NightWorkerQueue {
  constructor() {
    this.tasks = [];
    this.completedTasks = [];
    this.schedule = SCHEDULE_PRESETS.OVERNIGHT;
    this.isEnabled = false;
    this.isRunning = false;
    this.currentTask = null;
    this.listeners = new Set();
    this.reports = [];
    this.settings = {
      requireIdleComputer: true,
      idleMinutes: 5,
      maxTasksPerNight: 10,
      notifyOnComplete: true,
      createMorningReport: true
    };
  }

  /**
   * Add a task to the queue
   */
  addTask(taskType, options = {}) {
    const typeConfig = TASK_TYPES[taskType];
    if (!typeConfig) {
      throw new Error(`Unknown task type: ${taskType}`);
    }

    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: taskType,
      typeConfig,
      status: TASK_STATUS.QUEUED,
      priority: options.priority ?? typeConfig.priority,
      options: {
        files: options.files || [],
        scope: options.scope || 'all',
        ...options
      },
      createdAt: Date.now(),
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    };

    this.tasks.push(task);
    this.sortTasks();
    this.notifyListeners();

    return task;
  }

  /**
   * Remove a task from queue
   */
  removeTask(taskId) {
    const index = this.tasks.findIndex(t => t.id === taskId);
    if (index >= 0) {
      this.tasks.splice(index, 1);
      this.notifyListeners();
      return true;
    }
    return false;
  }

  /**
   * Update task priority
   */
  updatePriority(taskId, priority) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.priority = priority;
      this.sortTasks();
      this.notifyListeners();
    }
  }

  /**
   * Sort tasks by priority
   */
  sortTasks() {
    this.tasks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get queued tasks
   */
  getQueue() {
    return [...this.tasks];
  }

  /**
   * Get task by ID
   */
  getTask(taskId) {
    return this.tasks.find(t => t.id === taskId);
  }

  /**
   * Set schedule
   */
  setSchedule(schedule) {
    if (typeof schedule === 'string') {
      this.schedule = SCHEDULE_PRESETS[schedule] || SCHEDULE_PRESETS.OVERNIGHT;
    } else {
      this.schedule = schedule;
    }
    this.notifyListeners();
  }

  /**
   * Enable/disable night worker
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.notifyListeners();
  }

  /**
   * Check if currently in scheduled window
   */
  isInScheduledWindow() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMin] = this.schedule.start.split(':').map(Number);
    const [endHour, endMin] = this.schedule.end.split(':').map(Number);
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    // Check day restrictions
    if (this.schedule.days) {
      const currentDay = now.getDay();
      if (!this.schedule.days.includes(currentDay)) {
        return false;
      }
    }

    // Handle overnight schedules (start > end)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    }

    return currentTime >= startTime && currentTime <= endTime;
  }

  /**
   * Get time until next scheduled window
   */
  getTimeUntilNextWindow() {
    if (this.isInScheduledWindow()) return 0;

    const now = new Date();
    const [startHour, startMin] = this.schedule.start.split(':').map(Number);
    
    const next = new Date(now);
    next.setHours(startHour, startMin, 0, 0);
    
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next.getTime() - now.getTime();
  }

  /**
   * Start processing queue (called by main process)
   */
  async startProcessing() {
    if (this.isRunning || this.tasks.length === 0) return;

    this.isRunning = true;
    this.notifyListeners();

    let tasksCompleted = 0;
    const maxTasks = this.settings.maxTasksPerNight;

    while (this.tasks.length > 0 && tasksCompleted < maxTasks) {
      const task = this.tasks[0];
      
      // Skip non-autonomous tasks
      if (!task.typeConfig.autonomous && task.status !== TASK_STATUS.PENDING_APPROVAL) {
        task.status = TASK_STATUS.PENDING_APPROVAL;
        this.notifyListeners();
        // Move to next task
        this.tasks.push(this.tasks.shift());
        continue;
      }

      this.currentTask = task;
      task.status = TASK_STATUS.RUNNING;
      task.startedAt = Date.now();
      this.notifyListeners();

      try {
        // Simulate task execution
        const result = await this.executeTask(task);
        
        task.status = TASK_STATUS.COMPLETED;
        task.completedAt = Date.now();
        task.result = result;
        
        // Move to completed
        this.tasks.shift();
        this.completedTasks.push(task);
        tasksCompleted++;
        
      } catch (error) {
        task.status = TASK_STATUS.FAILED;
        task.completedAt = Date.now();
        task.error = error.message;
        
        // Move to completed even if failed
        this.tasks.shift();
        this.completedTasks.push(task);
      }

      this.currentTask = null;
      this.notifyListeners();
    }

    this.isRunning = false;
    
    // Generate morning report
    if (this.settings.createMorningReport && tasksCompleted > 0) {
      this.generateMorningReport();
    }

    this.notifyListeners();
  }

  /**
   * Execute a task (mock implementation)
   */
  async executeTask(task) {
    // Simulate task duration
    const duration = Math.min(task.typeConfig.maxDuration, 5000); // Cap at 5s for demo
    await new Promise(resolve => setTimeout(resolve, duration));

    // Generate mock result based on task type
    const results = {
      [TASK_TYPES.CODE_REVIEW.id]: {
        filesReviewed: 12,
        issuesFound: 5,
        suggestions: ['Consider extracting duplicate logic', 'Add error handling']
      },
      [TASK_TYPES.TEST_GENERATION.id]: {
        testsGenerated: 8,
        coverageIncrease: 12,
        files: ['userService.test.js', 'orderService.test.js']
      },
      [TASK_TYPES.DOCUMENTATION.id]: {
        filesUpdated: 5,
        docBlocksAdded: 23,
        readmeUpdated: true
      },
      [TASK_TYPES.DEPENDENCY_AUDIT.id]: {
        outdated: 3,
        vulnerable: 1,
        recommendations: ['Update lodash to 4.17.21', 'Replace moment with date-fns']
      },
      [TASK_TYPES.CODE_CLEANUP.id]: {
        lintFixed: 45,
        deadCodeRemoved: 120,
        formattedFiles: 8
      },
      [TASK_TYPES.SECURITY_SCAN.id]: {
        issuesFound: 2,
        severity: { high: 1, medium: 1 },
        details: ['Potential XSS in renderHTML', 'Hardcoded credential detected']
      }
    };

    return results[task.type] || { completed: true };
  }

  /**
   * Approve a pending task
   */
  approveTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task && task.status === TASK_STATUS.PENDING_APPROVAL) {
      task.status = TASK_STATUS.QUEUED;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = TASK_STATUS.CANCELLED;
      task.completedAt = Date.now();
      this.tasks = this.tasks.filter(t => t.id !== taskId);
      this.completedTasks.push(task);
      this.notifyListeners();
      return true;
    }
    return false;
  }

  /**
   * Generate morning report
   */
  generateMorningReport() {
    const lastNight = this.completedTasks.filter(t => {
      const completedTime = t.completedAt;
      const yesterday = Date.now() - 24 * 60 * 60 * 1000;
      return completedTime > yesterday;
    });

    const report = {
      id: `report_${Date.now()}`,
      generatedAt: Date.now(),
      tasksCompleted: lastNight.filter(t => t.status === TASK_STATUS.COMPLETED).length,
      tasksFailed: lastNight.filter(t => t.status === TASK_STATUS.FAILED).length,
      tasksPendingApproval: this.tasks.filter(t => t.status === TASK_STATUS.PENDING_APPROVAL).length,
      summary: [],
      changes: []
    };

    // Build summary
    for (const task of lastNight) {
      if (task.status === TASK_STATUS.COMPLETED && task.result) {
        report.summary.push({
          task: task.typeConfig.name,
          icon: task.typeConfig.icon,
          result: this.summarizeResult(task)
        });
      }
    }

    this.reports.push(report);
    return report;
  }

  /**
   * Summarize task result for report
   */
  summarizeResult(task) {
    const r = task.result;
    switch (task.type) {
      case TASK_TYPES.CODE_REVIEW.id:
        return `Reviewed ${r.filesReviewed} files, found ${r.issuesFound} issues`;
      case TASK_TYPES.TEST_GENERATION.id:
        return `Generated ${r.testsGenerated} tests, +${r.coverageIncrease}% coverage`;
      case TASK_TYPES.DOCUMENTATION.id:
        return `Updated ${r.filesUpdated} files, added ${r.docBlocksAdded} doc blocks`;
      case TASK_TYPES.DEPENDENCY_AUDIT.id:
        return `Found ${r.outdated} outdated, ${r.vulnerable} vulnerable packages`;
      case TASK_TYPES.CODE_CLEANUP.id:
        return `Fixed ${r.lintFixed} lint issues, removed ${r.deadCodeRemoved} lines`;
      case TASK_TYPES.SECURITY_SCAN.id:
        return `Found ${r.issuesFound} security issues (${r.severity.high} high)`;
      default:
        return 'Completed';
    }
  }

  /**
   * Get latest report
   */
  getLatestReport() {
    return this.reports[this.reports.length - 1] || null;
  }

  /**
   * Get all reports
   */
  getReports() {
    return [...this.reports];
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      queuedTasks: this.tasks.length,
      completedTasks: this.completedTasks.length,
      pendingApproval: this.tasks.filter(t => t.status === TASK_STATUS.PENDING_APPROVAL).length,
      isEnabled: this.isEnabled,
      isRunning: this.isRunning,
      inScheduledWindow: this.isInScheduledWindow(),
      nextWindow: this.getTimeUntilNextWindow(),
      schedule: this.schedule
    };
  }

  /**
   * Update settings
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.notifyListeners();
  }

  /**
   * Clear completed tasks
   */
  clearCompleted() {
    this.completedTasks = [];
    this.notifyListeners();
  }

  /**
   * Add listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners() {
    const state = {
      tasks: this.tasks,
      currentTask: this.currentTask,
      statistics: this.getStatistics(),
      settings: this.settings,
      latestReport: this.getLatestReport()
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Night worker queue listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getNightWorkerQueue() {
  if (!instance) {
    instance = new NightWorkerQueue();
  }
  return instance;
}

export { TASK_TYPES, TASK_STATUS, SCHEDULE_PRESETS };
export default NightWorkerQueue;
