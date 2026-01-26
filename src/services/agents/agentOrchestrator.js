import { safetyProtocol } from './safetyProtocol';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import agentService from '../agentService';
import { getCodeIndexSummary } from '../codeIndexer';

/**
 * AgentOrchestrator - The "Manager" of the Autonomous Team
 * 
 * Coordinates the multi-agent loop:
 * 1. Product Owner (defines requirements)
 * 2. Architect (plans structure)
 * 3. Engineer (writes code)
 * 4. QA (tests and reviews)
 */

const AGENT_PERSONAS = {
  PRODUCT_OWNER: {
    id: 'po',
    name: 'Product Owner',
    role: 'Requirements & Scope',
    color: 'text-blue-400',
    systemPrompt: "You are a strict Product Owner. Your job is to define clear, testable requirements. Reject ambiguity.",
  },
  ARCHITECT: {
    id: 'architect',
    name: 'System Architect',
    role: 'Structure & Design',
    color: 'text-purple-400',
    systemPrompt: "You are a Senior Architect. Plan the file structure and data flow. Focus on scalability and patterns.",
  },
  ENGINEER: {
    id: 'engineer',
    name: 'Senior Engineer',
    role: 'Implementation',
    color: 'text-green-400',
    systemPrompt: "You are a Senior Engineer. Write clean, efficient code. Follow the Architect's plan exactly.",
  },
  QA: {
    id: 'qa',
    name: 'QA Lead',
    role: 'Testing & Review',
    color: 'text-red-400',
    systemPrompt: "You are a QA Lead. Find bugs, security flaws, and logic errors. Be critical.",
  }
};

class AgentOrchestrator {
  constructor() {
    this.isActive = false;
    this.task = null;
    this.discussion = []; // The chat log of the agents
    this.currentPhase = 'idle'; // idle, planning, implementing, reviewing
    this.subscribers = new Set();
    this.loopInterval = null;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    this.subscribers.forEach(callback => callback({
      isActive: this.isActive,
      task: this.task,
      discussion: [...this.discussion],
      phase: this.currentPhase,
      activeAgent: this.getActiveAgentForPhase(),
    }));
  }

  getActiveAgentForPhase() {
    switch (this.currentPhase) {
      case 'planning': return AGENT_PERSONAS.ARCHITECT;
      case 'implementing': return AGENT_PERSONAS.ENGINEER;
      case 'reviewing': return AGENT_PERSONAS.QA;
      case 'defining': return AGENT_PERSONAS.PRODUCT_OWNER;
      default: return null;
    }
  }

  /**
   * Start the "Night Shift" - Autonomous Mode
   */
  async startNightShift(taskDescription) {
    if (this.isActive) return;

    const agentStore = useAgentStore.getState();
    const appStore = useAppStore.getState();

    console.log('🌙 Starting Night Shift...');
    this.isActive = true;
    this.task = taskDescription;
    this.discussion = [];
    this.currentPhase = 'defining';
    this.notify();

    // Create a plan from agentService
    const plan = agentService.generateAutonomousPlan(taskDescription, {
      filePath: appStore?.activeFilePath,
      mode: 'autonomous',
    });
    agentStore.startTask(taskDescription, plan);

    // 1. Engage Safety Protocol (best effort)
    const safetyResult = await safetyProtocol.engageSafetyProtocol(taskDescription);
    if (!safetyResult.success) {
      this.addSystemMessage('❌ Failed to engage Safety Protocol. Aborting.', 'error');
      this.isActive = false;
      agentStore.stopAgent();
      this.notify();
      return;
    }
    this.addSystemMessage(`🛡️ Safety Protocol Engaged. Sandbox: ${safetyResult.session.sandboxBranch}`, 'system');
    agentStore.addLog(`Safety protocol engaged in ${safetyResult.session.sandboxBranch}`);

    // 2. Start the Loop
    this.runLoop();
  }

  async runLoop() {
    try {
      const agentStore = useAgentStore.getState();

      // Phase 1: Product Owner defines scope
      await this.agentSpeak(AGENT_PERSONAS.PRODUCT_OWNER, `I've received the task: "${this.task}". I'm analyzing requirements...`);
      agentStore.updateStepStatus(agentStore.plan.steps?.[0]?.id, 'running');
      await this.simulateThinking(2000);
      await this.agentSpeak(AGENT_PERSONAS.PRODUCT_OWNER, `Here are the requirements:\n1. Implement the core logic.\n2. Ensure error handling.\n3. Add unit tests.`);
      agentStore.updateStepStatus(agentStore.plan.steps?.[0]?.id, 'complete');
      
      // Phase 2: Architect plans
      this.currentPhase = 'planning';
      this.notify();
      agentStore.updateStepStatus(agentStore.plan.steps?.[1]?.id, 'running');
      await this.agentSpeak(AGENT_PERSONAS.ARCHITECT, "Understood. I'm reviewing the codebase to plan the implementation.");
      // Provide lightweight context (code index summary)
      const indexSummary = getCodeIndexSummary();
      if (indexSummary?.files?.length) {
        agentStore.addLog(`Indexed ${indexSummary.files.length} files for context.`);
      }
      await this.simulateThinking(2500);
      await this.agentSpeak(AGENT_PERSONAS.ARCHITECT, "Plan:\n- Create service X\n- Update component Y\n- Add utility Z");
      agentStore.updateStepStatus(agentStore.plan.steps?.[1]?.id, 'complete');

      // Phase 3: Engineer implements (Simulation for now)
      this.currentPhase = 'implementing';
      this.notify();
      agentStore.updateStepStatus(agentStore.plan.steps?.[2]?.id, 'running');
      await this.agentSpeak(AGENT_PERSONAS.ENGINEER, "On it. Starting implementation in the sandbox branch.");
      
      // Create a checkpoint
      await safetyProtocol.createCheckpoint('Start Implementation');
      
      await this.simulateThinking(4000);
      await this.agentSpeak(AGENT_PERSONAS.ENGINEER, "Core logic implemented. Files updated.");
      agentStore.updateStepStatus(agentStore.plan.steps?.[2]?.id, 'complete');
      
      // Phase 4: QA Reviews
      this.currentPhase = 'reviewing';
      this.notify();
      agentStore.updateStepStatus(agentStore.plan.steps?.[3]?.id, 'running');
      await this.agentSpeak(AGENT_PERSONAS.QA, "Running analysis...");
      await this.simulateThinking(3000);
      
      // Simulate a finding
      if (Math.random() > 0.5) {
        await this.agentSpeak(AGENT_PERSONAS.QA, "⚠️ I found a potential edge case in the error handling. Engineer, please fix.");
        this.currentPhase = 'implementing';
        this.notify();
        await this.agentSpeak(AGENT_PERSONAS.ENGINEER, "Good catch. Fixing it now...");
        await this.simulateThinking(2000);
        await this.agentSpeak(AGENT_PERSONAS.ENGINEER, "Fix applied.");
      } else {
        await this.agentSpeak(AGENT_PERSONAS.QA, "✅ Code looks solid. Tests passed.");
      }
      agentStore.updateStepStatus(agentStore.plan.steps?.[3]?.id, 'complete');

      // Completion
      await this.agentSpeak(AGENT_PERSONAS.PRODUCT_OWNER, "Excellent work team. The task is complete and ready for user review.");
      this.addSystemMessage('🎉 Night Shift Complete. Branch ready for review.', 'success');
      agentStore.addLog('Night shift complete.');
      agentStore.stopAgent();
      
      this.isActive = false;
      this.currentPhase = 'complete';
      this.notify();

    } catch (error) {
      console.error('Night Shift Error:', error);
      this.addSystemMessage(`❌ Critical Error: ${error.message}`, 'error');
      this.isActive = false;
      this.notify();
    }
  }

  async agentSpeak(persona, message) {
    this.discussion.push({
      id: Date.now(),
      sender: persona,
      content: message,
      timestamp: Date.now(),
      type: 'message'
    });
    this.notify();

    // Push to agent store log for UI
    const agentStore = useAgentStore.getState();
    agentStore.addLog(`${persona.name}: ${message}`);

    // Optionally relay to LLM (best effort, non-blocking)
    try {
      const appStore = useAppStore.getState();
      if (appStore?.sendMessage) {
        const personaPrompt = `${persona.systemPrompt}\n\nTask: ${this.task}\n\n${message}`;
        // Fire-and-forget; do not await to avoid blocking
        appStore.sendMessage(personaPrompt, { channel: 'agent' });
      }
    } catch (error) {
      console.error('Agent LLM relay failed:', error);
    }
  }

  addSystemMessage(content, type = 'info') {
    this.discussion.push({
      id: Date.now(),
      sender: { name: 'System', id: 'system', color: 'text-gray-400' },
      content,
      timestamp: Date.now(),
      type
    });
    this.notify();
  }

  async simulateThinking(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isActive = false;
    this.notify();
  }
}

export const agentOrchestrator = new AgentOrchestrator();
export default agentOrchestrator;












