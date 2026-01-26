const { v4: uuidv4 } = require('uuid');
const browserAgent = require('./browser-agent');
const desktopAgent = require('./desktop-agent');
const AutonomousAgent = require('./autonomous-agent');

/**
 * Simple in-memory agent task manager.
 * Tasks are also mirrored into the "agents" table for persistence/history.
 */
class AgentService {
  constructor(db) {
    this.db = db;
    this.tasks = new Map();
    this.autonomous = new AutonomousAgent({ rootPath: process.cwd() });

    // Propagate autonomous agent events into task logs
    this.autonomous.on('state', (state, task) => {
      if (!task) return;
      const existing = this.tasks.get(task.id);
      if (existing) {
        existing.logs.push(`Autonomous state: ${state}`);
        existing.updated_at = new Date().toISOString();
        this._persist(existing);
      }
    });

    this.autonomous.on('error', ({ task, error }) => {
      if (!task) return;
      const existing = this.tasks.get(task.id);
      if (existing) {
        existing.logs.push(`Autonomous error: ${error?.message || error}`);
        existing.error = error?.message || String(error);
        existing.status = 'error';
        existing.updated_at = new Date().toISOString();
        this._persist(existing);
      }
    });
  }

  listTasks() {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  /**
   * Create a new agent task and start it in the background.
   * payload: { type: 'browser_search' | 'desktop_probe' | 'code_analysis', input: string }
   */
  createTask(payload) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const task = {
      id,
      type: payload.type || 'code_analysis',
      status: 'pending',
      input: payload.input || '',
      output: '',
      error: null,
      logs: [],
      created_at: now,
      updated_at: now,
    };

    this.tasks.set(id, task);
    this._persist(task);

    // Start in background
    setImmediate(() => {
      this._runTask(task).catch((err) => {
        // Final safeguard
        task.status = 'error';
        task.error = err.message;
        task.updated_at = new Date().toISOString();
        this._persist(task);
      });
    });

    return task;
  }

  async _runTask(task) {
    task.status = 'running';
    task.updated_at = new Date().toISOString();
    task.logs.push('Agent task started.');
    this._persist(task);

    let result;

    if (task.type === 'browser_search') {
      result = await browserAgent.runTask(task);
    } else if (task.type === 'desktop_probe') {
      result = await desktopAgent.runTask(task);
    } else if (task.type === 'code_analysis') {
      const logs = [];
      logs.push('Code analysis task recorded by DevForge agent service.');
      logs.push(`Input: ${task.input || '(none)'}`);
      result = {
        status: 'completed',
        logs,
        output:
          'Code workspace agent recorded this analysis request. Use the in-app Agent panel for detailed suggestions.',
        error: null,
      };
    } else if (task.type === 'autonomous') {
      const goal = task.input || 'Run autonomous task';
      const autoTask = this.autonomous.enqueueTask(goal, task.context || {});
      result = {
        status: 'running',
        logs: [`Autonomous task enqueued: ${autoTask.id}`],
        output: '',
        error: null,
      };
    } else {
      result = {
        status: 'error',
        logs: [`Unknown agent task type: ${task.type}`],
        output: '',
        error: `Unknown agent task type: ${task.type}`,
      };
    }

    task.status = result.status || 'completed';
    task.output = result.output || '';
    task.error = result.error || null;
    task.logs.push(...(result.logs || []));
    task.updated_at = new Date().toISOString();

    this._persist(task);
  }

  cancelTask(id) {
    const task = this.tasks.get(id);
    if (!task) return { success: false, error: 'Task not found' };
    if (task.status === 'completed' || task.status === 'error') {
      return { success: false, error: 'Task already finished' };
    }

    task.status = 'cancelled';
    task.updated_at = new Date().toISOString();
    task.logs.push('Task cancelled by user.');
    this._persist(task);

    return { success: true };
  }

  _persist(task) {
    if (!this.db) return;
    try {
      this.db.run(
        `
          INSERT INTO agents (id, type, status, input, output, error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            status = excluded.status,
            input = excluded.input,
            output = excluded.output,
            error = excluded.error,
            updated_at = excluded.updated_at
        `,
        [
          task.id,
          task.type,
          task.status,
          task.input,
          task.output,
          task.error,
          task.created_at,
          task.updated_at,
        ],
      );
    } catch (error) {
      console.error('Failed to persist agent task:', error);
    }
  }
}

let agentService = null;

function getAgentService(db) {
  if (!agentService) {
    agentService = new AgentService(db);
  }
  return agentService;
}

module.exports = {
  getAgentService,
};


