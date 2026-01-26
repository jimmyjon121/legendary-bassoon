const EventEmitter = require('events');
const agentTools = require('./agent-tools');
const checkpointManager = require('./checkpoint-manager');
const permissions = require('./agent-permissions');

/**
 * Minimal autonomous agent execution engine.
 * State machine: idle -> planning -> executing -> checkpoint -> executing -> complete/error
 */
class AutonomousAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rootPath = options.rootPath || process.cwd();
    this.state = 'idle';
    this.currentTask = null;
    this.queue = [];
    this.maxRetries = 3;
  }

  enqueueTask(goal, context = {}) {
    const task = {
      id: `task-${Date.now()}`,
      goal,
      context,
      status: 'queued',
      attempts: 0,
      steps: [],
    };
    this.queue.push(task);
    this._processNext();
    return task;
  }

  async _processNext() {
    if (this.state !== 'idle') return;
    const next = this.queue.shift();
    if (!next) return;
    this.currentTask = next;
    this.state = 'planning';
    this.emit('state', this.state, next);
    await this._runTask(next);
  }

  async _runTask(task) {
    try {
      task.status = 'running';
      this.state = 'planning';
      this.emit('state', this.state, task);

      const planSteps = this._plan(task);
      task.steps = planSteps;

      // Optional checkpoint before executing
      await checkpointManager.createCheckpoint(this.rootPath, `pre-${task.id}`);

      this.state = 'executing';
      this.emit('state', this.state, task);

      for (const step of planSteps) {
        this.emit('step', { taskId: task.id, step });
        await this._executeStep(step, task);
      }

      this.state = 'checkpoint';
      this.emit('state', this.state, task);
      await checkpointManager.createCheckpoint(this.rootPath, `post-${task.id}`);

      task.status = 'completed';
      this.state = 'complete';
      this.emit('state', this.state, task);
    } catch (error) {
      task.attempts += 1;
      const analysis = await agentTools.analyzeError(error?.stack || error?.message || String(error));
      this.emit('error', { task, error, analysis });
      task.lastError = analysis;
      if (task.attempts < this.maxRetries) {
        this.state = 'idle';
        this.queue.unshift(task);
        this._processNext();
        return;
      }
      task.status = 'error';
      task.error = error.message;
      this.state = 'error';
      this.emit('state', this.state, task);
    } finally {
      // move back to idle to process next queued task
      this.state = 'idle';
      this.currentTask = null;
      this._processNext();
    }
  }

  _plan(task) {
    // Very small initial planner: perceive + single execution step + summary
    return [
      { id: `perceive-${task.id}`, type: 'perceive', description: 'Read context and files' },
      { id: `execute-${task.id}`, type: 'execute', description: task.goal },
      { id: `summary-${task.id}`, type: 'summarize', description: 'Summarize changes' },
    ];
  }

  async _executeStep(step, task) {
    switch (step.type) {
      case 'perceive': {
        // placeholder: could index project or read target file
        step.result = { noted: true };
        break;
      }
      case 'execute': {
        await this._runGoal(task.goal, task.context);
        step.result = { done: true };
        break;
      }
      case 'summarize': {
        step.result = { summary: 'Execution complete' };
        break;
      }
      default:
        step.result = { skipped: true };
    }
  }

  async _runGoal(goal, context) {
    // Interpret goal; for now, just log and maybe run a command
    const allowed = permissions.isCommandAllowed(goal);
    if (!allowed.allowed) {
      throw new Error(allowed.reason || 'Command not allowed');
    }

    if (context?.runCommand) {
      return agentTools.runCommand(context.runCommand, this.rootPath);
    }
    // Future: map goal to tool invocations
    return { note: `Goal recorded: ${goal}` };
  }
}

module.exports = AutonomousAgent;

