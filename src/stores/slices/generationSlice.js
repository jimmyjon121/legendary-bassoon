// Generation state management slice
// Handles streaming, generation metadata, and RAG context

export const createGenerationSlice = (set, get) => ({
  // State
  isGenerating: false,
  streamingContent: '',
  currentStreamChannel: null,
  ragInfluence: 0.5,
  ragContext: [],
  generationMetadata: {
    stage: 'idle',
    startedAt: null,
    chars: 0,
    tokensEstimated: 0,
    tokensPerSecond: 0,
  },

  // Actions
  setRagInfluence: async (value) => {
    const clamped = Math.min(1, Math.max(0, value));
    set({ ragInfluence: clamped });
    try {
      await window.electronAPI?.setSettings('ragInfluence', clamped);
    } catch (error) {
      console.error('Failed to persist RAG influence:', error);
    }
  },

  stopGeneration: async () => {
    const { currentStreamChannel } = get();
    if (currentStreamChannel) {
      await window.electronAPI?.cancelLLMStream(currentStreamChannel);
    }
    set({ 
      isGenerating: false, 
      streamingContent: '',
      currentStreamChannel: null 
    });
  },

  // Called internally during streaming - batched for performance
  updateStreamingContent: (content, metadata = null) => {
    const updates = { streamingContent: content };
    if (metadata) {
      updates.generationMetadata = metadata;
    }
    set(updates);
  },

  resetGeneration: () => {
    set({
      isGenerating: false,
      streamingContent: '',
      currentStreamChannel: null,
      generationMetadata: {
        stage: 'idle',
        startedAt: null,
        chars: 0,
        tokensEstimated: 0,
        tokensPerSecond: 0,
      },
    });
  },
});



