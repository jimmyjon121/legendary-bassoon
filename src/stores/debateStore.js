import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { isElectron } from '../utils/electronAPI';

/**
 * Debate Store - Manages model-on-model discussions
 * 
 * Features:
 * - Two or more models take turns responding to each other
 * - User can interject at any time to steer the conversation
 * - Auto-continue mode lets models chat without intervention
 * - Pause/resume controls for the autonomous discussion
 * - Full encryption support for Private workspace
 */

// Workspace-specific system prompts
const DEBATE_SYSTEM_PROMPTS = {
  default: `You are one participant in a multi-AI discussion. 

Your job is to provide ONLY your next message in the conversation, as if you were a single speaker. 

- Do NOT write out a full back-and-forth transcript. 
- Do NOT prefix your reply with names like "Assistant:" or your own model name. 
- Just write what you would say next, in plain prose, 2–3 paragraphs max. 
- Build on what others have said, respond to their points, and optionally address them by name inside your text.`,
  
  nsfw: `You are one participant in an unrestricted multi-AI roleplay/discussion. 

Your job is to provide ONLY your next message in the scene, as if you were a single character speaking now.

- Do NOT script full conversations for everyone. 
- Do NOT prefix with character names like "Alice:" or "Assistant:". 
- Just write your character's next lines and inner thoughts in plain text, keeping it engaging and appropriately detailed. 
- React naturally to what has already happened and to the other participants.`,
  
  code: `You are one participant in a technical multi-AI discussion. 

Provide ONLY your next message, focused on code quality, best practices, and architecture. 

- Do NOT write a whole debate transcript. 
- Do NOT prefix with names like "Assistant:" or your own name. 
- Reply as a single speaker in clear prose, including code examples when helpful, and challenge assumptions constructively.`,
  
  work: `You are one participant in a professional multi-AI discussion. 

Provide ONLY your next message, staying focused on productivity, efficiency, and practical solutions. 

- Do NOT write meeting minutes or a transcript for everyone. 
- Do NOT prefix with names like "Assistant:" or your own name. 
- Be concise and action‑oriented, offering structured recommendations where appropriate.`
};

export const useDebateStore = create((set, get) => ({
  // Debate state
  isDebateOpen: false,
  isDebating: false,
  isPaused: true,
  
  // Participating models (minimum 2)
  participants: [],
  currentSpeakerIndex: 0,
  
  // Debate configuration
  topic: '',
  turnCount: 0,
  maxTurns: 20, // Safety limit
  turnDelay: 1500, // ms between turns for readability
  
  // Workspace context (for encryption & theming)
  workspace: 'casual',
  isPrivate: false,
  
  // Messages in the debate
  messages: [],
  streamingContent: '',
  
  // Dynamic system prompt based on workspace
  getSystemPrompt: () => {
    const { workspace } = get();
    return DEBATE_SYSTEM_PROMPTS[workspace] || DEBATE_SYSTEM_PROMPTS.default;
  },
  
  // Actions
  openDebate: (workspace = 'casual') => set({ 
    isDebateOpen: true,
    workspace,
    isPrivate: workspace === 'nsfw'
  }),
  
  closeDebate: () => {
    get().stopDebate();
    set({ isDebateOpen: false });
  },
  
  setWorkspace: (workspace) => set({
    workspace,
    isPrivate: workspace === 'nsfw'
  }),
  
  setParticipants: (models) => {
    set({ participants: models.slice(0, 4) }); // Max 4 participants
  },
  
  addParticipant: (model) => {
    const { participants } = get();
    if (participants.length < 4 && !participants.includes(model)) {
      set({ participants: [...participants, model] });
    }
  },
  
  removeParticipant: (model) => {
    const { participants, isDebating } = get();
    if (!isDebating) {
      set({ participants: participants.filter(m => m !== model) });
    }
  },
  
  setTopic: (topic) => set({ topic }),
  setMaxTurns: (max) => set({ maxTurns: Math.min(50, Math.max(2, max)) }),
  setTurnDelay: (delay) => set({ turnDelay: Math.min(5000, Math.max(500, delay)) }),
  
  // Start the debate with initial topic
  startDebate: async () => {
    const { participants, topic, isPrivate } = get();
    
    if (participants.length < 2) {
      console.error('Need at least 2 participants to start a debate');
      return;
    }
    
    if (!topic.trim()) {
      console.error('Need a topic to start the debate');
      return;
    }
    
    // Initialize debate
    const initialMessage = {
      id: uuidv4(),
      role: 'system',
      speaker: isPrivate ? 'Scene' : 'Moderator',
      content: isPrivate 
        ? `**Scenario:** ${topic}\n\n*The scene unfolds...*`
        : `**Topic:** ${topic}\n\nThe discussion begins...`,
      timestamp: new Date().toISOString()
    };
    
    set({
      isDebating: true,
      isPaused: false,
      messages: [initialMessage],
      turnCount: 0,
      currentSpeakerIndex: 0,
      streamingContent: ''
    });
    
    // Start the first turn
    await get().nextTurn();
  },
  
  // Execute the next turn in the debate
  nextTurn: async () => {
    const { 
      participants, 
      currentSpeakerIndex, 
      messages, 
      turnCount, 
      maxTurns, 
      isPaused,
      isDebating,
      topic,
      turnDelay,
      isPrivate,
      getSystemPrompt
    } = get();
    
    if (!isDebating || isPaused || turnCount >= maxTurns) {
      return;
    }
    
    const currentModel = participants[currentSpeakerIndex];
    const systemPrompt = getSystemPrompt();
    
    // Build the conversation context
    const contextMessages = messages
      .filter(m => m.role !== 'system' || m.speaker === 'Moderator' || m.speaker === 'Scene')
      .map(m => {
        if (m.role === 'system') {
          return isPrivate ? `[Scene: ${m.content}]` : `Moderator: ${m.content}`;
        }
        return `${m.speaker}: ${m.content}`;
      })
      .join('\n\n');
    
    const prompt = contextMessages 
      ? `${contextMessages}\n\n${currentModel}:`
      : isPrivate
        ? `The scenario is: "${topic}"\n\nYou are ${currentModel}. Begin engaging with this scenario creatively.\n\n${currentModel}:`
        : `The topic is: "${topic}"\n\nYou are ${currentModel}. Please share your opening thoughts on this topic.\n\n${currentModel}:`;
    
    set({ streamingContent: '' });
    
    // Check if streaming is available
    if (!isElectron() || !window.electronAPI?.streamFromLLM) {
      console.error('LLM streaming not available');
      set({ isPaused: true });
      return;
    }
    
    try {
      // Use streaming for real-time response display
      let fullResponse = '';
      const channel = `debate:stream:${Date.now()}`;
      
      const cleanup = window.electronAPI.streamFromLLM(
        {
          model: currentModel,
          prompt,
          system: systemPrompt,
          options: { 
            temperature: isPrivate ? 0.9 : 0.8, 
            top_p: 0.95,
            // Stop sequences to prevent fake conversation turns
            stop: ['Human:', '\nHuman:', '\n\nHuman:', 'User:', '\nUser:']
          }
        },
        (chunk) => {
          if (chunk.done) {
            // Save the complete message
            const newMessage = {
              id: uuidv4(),
              role: 'assistant',
              speaker: currentModel,
              model: currentModel,
              content: fullResponse,
              timestamp: new Date().toISOString()
            };
            
            const nextIndex = (currentSpeakerIndex + 1) % participants.length;
            
            set(state => ({
              messages: [...state.messages, newMessage],
              streamingContent: '',
              currentSpeakerIndex: nextIndex,
              turnCount: state.turnCount + 1
            }));
            
            // Schedule next turn if not paused and within limits
            const state = get();
            if (!state.isPaused && state.turnCount < state.maxTurns && state.isDebating) {
              setTimeout(() => {
                get().nextTurn();
              }, turnDelay);
            }
          } else if (chunk.response) {
            fullResponse += chunk.response;
            set({ streamingContent: fullResponse });
          } else if (chunk.error) {
            console.error('Debate streaming error:', chunk.error);
            set({ 
              isPaused: true,
              streamingContent: ''
            });
          }
        }
      );
      
      // Store cleanup function (could be used for cancellation)
      set({ _cleanup: cleanup });
      
    } catch (error) {
      console.error('Failed to get response:', error);
      set({ isPaused: true, streamingContent: '' });
    }
  },
  
  // Pause the autonomous discussion
  pauseDebate: () => {
    set({ isPaused: true });
  },
  
  // Resume the autonomous discussion
  resumeDebate: async () => {
    const { isDebating, turnCount, maxTurns } = get();
    
    if (!isDebating) {
      console.warn('No active debate to resume');
      return;
    }
    
    if (turnCount >= maxTurns) {
      console.warn('Maximum turns reached');
      return;
    }
    
    set({ isPaused: false });
    await get().nextTurn();
  },
  
  // User interjects with their own message
  userInterject: async (content) => {
    const { isDebating, participants, messages } = get();
    
    if (!isDebating) {
      console.warn('No active debate to interject in');
      return;
    }
    
    // Pause the auto-continue while user speaks
    set({ isPaused: true });
    
    const userMessage = {
      id: uuidv4(),
      role: 'user',
      speaker: 'You',
      content,
      timestamp: new Date().toISOString(),
      isInterjection: true
    };
    
    set(state => ({
      messages: [...state.messages, userMessage]
    }));
    
    // The debate stays paused after interjection
    // User can resume when ready, and the next model will respond to their input
  },
  
  // Force a specific model to speak next
  setNextSpeaker: (model) => {
    const { participants, isDebating, isPaused } = get();
    const index = participants.indexOf(model);
    
    if (index !== -1 && isDebating && isPaused) {
      set({ currentSpeakerIndex: index });
    }
  },
  
  // Stop the debate entirely
  stopDebate: () => {
    const { _cleanup } = get();
    if (_cleanup) {
      _cleanup();
    }
    
    set({
      isDebating: false,
      isPaused: true,
      streamingContent: '',
      _cleanup: null
    });
  },
  
  // Reset everything for a new debate
  resetDebate: () => {
    get().stopDebate();
    set({
      messages: [],
      topic: '',
      turnCount: 0,
      currentSpeakerIndex: 0,
      participants: []
    });
  },
  
  // Export debate transcript
  exportTranscript: () => {
    const { messages, topic, participants, isPrivate, workspace } = get();
    
    const title = isPrivate ? 'Roleplay Transcript' : 'AI Debate Transcript';
    const topicLabel = isPrivate ? 'Scenario' : 'Topic';
    
    let transcript = `# ${title}\n\n`;
    transcript += `**${topicLabel}:** ${topic}\n`;
    transcript += `**Participants:** ${participants.join(', ')}\n`;
    transcript += `**Workspace:** ${workspace}\n`;
    transcript += `**Date:** ${new Date().toLocaleString()}\n\n`;
    transcript += `---\n\n`;
    
    messages.forEach(msg => {
      if (msg.role === 'system') {
        transcript += `*${msg.content}*\n\n`;
      } else if (msg.role === 'user') {
        transcript += `### You (interjection)\n${msg.content}\n\n`;
      } else {
        transcript += `### ${msg.speaker}\n${msg.content}\n\n`;
      }
    });
    
    return transcript;
  },
  
  // Get workspace-specific quick topics
  getQuickTopics: () => {
    const { workspace } = get();
    
    const topics = {
      casual: [
        "Best practices for clean code",
        "The future of AI development",
        "Tabs vs Spaces",
        "Monolith vs Microservices",
        "Static vs Dynamic typing"
      ],
      work: [
        "Remote vs in-office work",
        "Agile vs Waterfall methodology",
        "How to run effective meetings",
        "Work-life balance strategies",
        "Leadership styles comparison"
      ],
      code: [
        "React vs Vue vs Angular",
        "REST vs GraphQL",
        "SQL vs NoSQL databases",
        "Test-driven development",
        "Microservices architecture"
      ],
      nsfw: [
        "Two strangers meet at a mysterious bar...",
        "A fantasy adventure begins in a tavern...",
        "Roommates discover a shared secret...",
        "A chance encounter changes everything...",
        "An unexpected reunion after years apart..."
      ]
    };
    
    return topics[workspace] || topics.casual;
  }
}));

