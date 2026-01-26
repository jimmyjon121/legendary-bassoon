import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Play, 
  Pause, 
  RotateCcw, 
  Send, 
  Users, 
  Sparkles,
  MessageSquare,
  Zap,
  Download,
  ChevronRight,
  Bot,
  User,
  Settings2,
  Shield,
  Heart
} from 'lucide-react';
import { useDebateStore } from '../../stores/debateStore';
import { useAppStore } from '../../stores/appStore';

export function DebateArena({ isOpen, onClose }) {
  const { availableModels, currentWorkspace } = useAppStore();
  
  const {
    isDebating,
    isPaused,
    participants,
    messages,
    streamingContent,
    currentSpeakerIndex,
    topic,
    turnCount,
    maxTurns,
    turnDelay,
    isPrivate,
    workspace,
    setWorkspace,
    setParticipants,
    addParticipant,
    removeParticipant,
    setTopic,
    setMaxTurns,
    setTurnDelay,
    startDebate,
    pauseDebate,
    resumeDebate,
    stopDebate,
    resetDebate,
    userInterject,
    setNextSpeaker,
    exportTranscript,
    getQuickTopics
  } = useDebateStore();
  
  // Sync workspace when opening
  useEffect(() => {
    if (isOpen) {
      setWorkspace(currentWorkspace);
    }
  }, [isOpen, currentWorkspace, setWorkspace]);

  const [interjection, setInterjection] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Handle interjection submission
  const handleInterject = () => {
    if (!interjection.trim()) return;
    userInterject(interjection.trim());
    setInterjection('');
  };

  // Handle export
  const handleExport = () => {
    const transcript = exportTranscript();
    const blob = new Blob([transcript], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debate-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Model colors for visual distinction - different palette for Private
  const modelColors = isPrivate ? [
    { bg: 'bg-pink-500/20', border: 'border-pink-500/40', text: 'text-pink-400', accent: 'pink' },
    { bg: 'bg-purple-500/20', border: 'border-purple-500/40', text: 'text-purple-400', accent: 'purple' },
    { bg: 'bg-rose-500/20', border: 'border-rose-500/40', text: 'text-rose-400', accent: 'rose' },
    { bg: 'bg-fuchsia-500/20', border: 'border-fuchsia-500/40', text: 'text-fuchsia-400', accent: 'fuchsia' }
  ] : [
    { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-400', accent: 'emerald' },
    { bg: 'bg-violet-500/20', border: 'border-violet-500/40', text: 'text-violet-400', accent: 'violet' },
    { bg: 'bg-amber-500/20', border: 'border-amber-500/40', text: 'text-amber-400', accent: 'amber' },
    { bg: 'bg-rose-500/20', border: 'border-rose-500/40', text: 'text-rose-400', accent: 'rose' }
  ];
  
  // Theme colors based on workspace
  const themeColors = isPrivate ? {
    primary: 'from-pink-500/20 to-purple-500/20',
    primaryBorder: 'border-pink-500/30',
    primaryText: 'text-pink-400',
    primaryBg: 'bg-pink-500/20',
    accent: 'pink',
    icon: Shield
  } : {
    primary: 'from-violet-500/20 to-emerald-500/20',
    primaryBorder: 'border-violet-500/30',
    primaryText: 'text-violet-400',
    primaryBg: 'bg-violet-500/20',
    accent: 'violet',
    icon: Users
  };
  
  const HeaderIcon = themeColors.icon;

  const getModelColor = (model) => {
    const index = participants.indexOf(model);
    return modelColors[index] || modelColors[0];
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
        onClick={(e) => e.target === e.currentTarget && !isDebating && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-5xl max-h-[90vh] bg-gradient-to-b from-forge-surface to-forge-bg border border-forge-border/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border/50 bg-forge-surface/50">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${themeColors.primary} border ${themeColors.primaryBorder}`}>
                  <HeaderIcon className={`w-5 h-5 ${themeColors.primaryText}`} />
                </div>
                {isDebating && !isPaused && (
                  <span className={`absolute -top-1 -right-1 w-3 h-3 ${isPrivate ? 'bg-pink-500' : 'bg-emerald-500'} rounded-full animate-pulse`} />
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  {isPrivate ? 'Private Arena' : 'Model Arena'}
                  {isDebating && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${themeColors.primaryBg} ${themeColors.primaryText} border ${themeColors.primaryBorder}`}>
                      {isPaused ? 'Paused' : 'Live'}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-text-muted">
                  {isPrivate 
                    ? 'Unrestricted multi-model roleplay & scenarios' 
                    : 'Watch AI models debate, interject when you want'
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isPrivate && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20">
                  <Shield className="w-3.5 h-3.5 text-pink-400" />
                  <span className="text-[10px] text-pink-400 font-medium">PRIVATE</span>
                </div>
              )}
              {isDebating && messages.length > 1 && (
                <button
                  type="button"
                  onClick={handleExport}
                  className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
                  title="Export transcript"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${
                  showSettings 
                    ? `${themeColors.primaryBg} ${themeColors.primaryText}` 
                    : 'text-text-muted hover:text-text-secondary hover:bg-forge-hover'
                }`}
                title="Settings"
              >
                <Settings2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isDebating) {
                    stopDebate();
                  }
                  onClose?.();
                }}
                className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Settings Panel (collapsible) */}
          <AnimatePresence>
            {showSettings && !isDebating && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-b border-forge-border/50"
              >
                <div className="p-4 bg-forge-elevated/30 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-text-muted mb-1.5 block">Max Turns</label>
                      <input
                        type="number"
                        min={2}
                        max={50}
                        value={maxTurns}
                        onChange={(e) => setMaxTurns(parseInt(e.target.value) || 10)}
                        className="input text-sm w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-muted mb-1.5 block">Turn Delay (ms)</label>
                      <input
                        type="number"
                        min={500}
                        max={5000}
                        step={100}
                        value={turnDelay}
                        onChange={(e) => setTurnDelay(parseInt(e.target.value) || 1500)}
                        className="input text-sm w-full"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!isDebating ? (
              /* Setup View */
              <div className="flex-1 p-6 overflow-y-auto">
                {/* Model Selection */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-text-primary flex items-center gap-2">
                      <Bot className="w-4 h-4 text-violet-400" />
                      Select Participants
                    </label>
                    <span className="text-xs text-text-muted">
                      {participants.length}/4 selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableModels && availableModels.length > 0 ? (
                      availableModels.map((m) => {
                        const name = typeof m === 'string' ? m : m.name || m.model || m.id;
                        const isSelected = participants.includes(name);
                        const colorSet = isSelected ? getModelColor(name) : null;
                        
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => isSelected ? removeParticipant(name) : addParticipant(name)}
                            disabled={!isSelected && participants.length >= 4}
                            className={`px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
                              isSelected
                                ? `${colorSet.bg} ${colorSet.border} ${colorSet.text}`
                                : 'border-forge-border text-text-secondary hover:bg-forge-hover hover:border-forge-hover disabled:opacity-40 disabled:cursor-not-allowed'
                            }`}
                          >
                            {name}
                          </button>
                        );
                      })
                    ) : (
                      <div className="text-sm text-text-muted py-4 text-center w-full">
                        No models available. Make sure your backend is running.
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected Participants Preview */}
                {participants.length > 0 && (
                  <div className="mb-6 p-4 rounded-xl bg-forge-elevated/50 border border-forge-border/50">
                    <div className="flex items-center gap-3 flex-wrap">
                      {participants.map((model, idx) => {
                        const color = modelColors[idx];
                        return (
                          <React.Fragment key={model}>
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${color.bg} ${color.border} border`}>
                              <Bot className={`w-4 h-4 ${color.text}`} />
                              <span className={`text-sm font-medium ${color.text}`}>{model}</span>
                            </div>
                            {idx < participants.length - 1 && (
                              <ChevronRight className="w-4 h-4 text-text-muted" />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Topic Input */}
                <div className="mb-6">
                  <label className="text-sm font-medium text-text-primary flex items-center gap-2 mb-3">
                    {isPrivate ? (
                      <Heart className="w-4 h-4 text-pink-400" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-amber-400" />
                    )}
                    {isPrivate ? 'Scenario / Scene Setup' : 'Discussion Topic'}
                  </label>
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder={isPrivate 
                      ? "Describe the scenario... e.g., 'Two characters meet for the first time at a mysterious location...'"
                      : "What should the models debate? e.g., 'Discuss the pros and cons of functional vs object-oriented programming...'"
                    }
                    className={`input text-sm min-h-[100px] resize-none w-full ${isPrivate ? 'focus:border-pink-500/50' : ''}`}
                  />
                </div>

                {/* Quick Topic Suggestions */}
                <div className="mb-6">
                  <div className="text-xs text-text-muted mb-2">
                    {isPrivate ? 'Quick scenarios:' : 'Quick topics:'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getQuickTopics().map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTopic(t)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          isPrivate 
                            ? 'bg-pink-500/10 text-pink-300/70 hover:text-pink-300 hover:bg-pink-500/20 border border-pink-500/20'
                            : 'bg-forge-hover/50 text-text-muted hover:text-text-secondary hover:bg-forge-hover'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Debate View */
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Turn indicator */}
                <div className="flex items-center justify-center gap-4 py-2">
                  <div className="text-xs text-text-muted">
                    {isPrivate ? 'Scene' : 'Turn'} {turnCount} / {maxTurns}
                  </div>
                  <div className="h-1.5 w-32 bg-forge-border rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        isPrivate 
                          ? 'bg-gradient-to-r from-pink-500 to-purple-500' 
                          : 'bg-gradient-to-r from-violet-500 to-emerald-500'
                      }`}
                      style={{ width: `${(turnCount / maxTurns) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Messages */}
                {messages.map((msg) => {
                  const isSystem = msg.role === 'system';
                  const isUser = msg.role === 'user';
                  const color = !isSystem && !isUser ? getModelColor(msg.speaker) : null;
                  
                  if (isSystem) {
                    return (
                      <div key={msg.id} className="text-center py-4">
                        <div className="inline-block px-4 py-2 rounded-xl bg-forge-elevated/50 border border-forge-border/50">
                          <p className="text-sm text-text-muted whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${color.bg} ${color.border} border flex items-center justify-center`}>
                          <Bot className={`w-4 h-4 ${color.text}`} />
                        </div>
                      )}
                      <div className={`max-w-[70%] ${isUser ? 'order-first' : ''}`}>
                        <div className={`text-xs mb-1 ${isUser ? 'text-right' : 'text-left'} ${isUser ? 'text-sky-400' : color.text}`}>
                          {msg.speaker}
                          {msg.isInterjection && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[10px]">
                              interjection
                            </span>
                          )}
                        </div>
                        <div className={`rounded-xl px-4 py-3 ${
                          isUser 
                            ? 'bg-sky-500/20 border border-sky-500/30' 
                            : `${color.bg} ${color.border} border`
                        }`}>
                          <p className="text-sm text-text-primary whitespace-pre-wrap">{msg.content}</p>
                        </div>
                        <div className="text-[10px] text-text-muted mt-1 px-1">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      {isUser && (
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
                          <User className="w-4 h-4 text-sky-400" />
                        </div>
                      )}
                    </motion.div>
                  );
                })}

                {/* Streaming response */}
                {streamingContent && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-3"
                  >
                    <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${modelColors[currentSpeakerIndex].bg} ${modelColors[currentSpeakerIndex].border} border flex items-center justify-center animate-pulse`}>
                      <Bot className={`w-4 h-4 ${modelColors[currentSpeakerIndex].text}`} />
                    </div>
                    <div className="max-w-[70%]">
                      <div className={`text-xs mb-1 ${modelColors[currentSpeakerIndex].text}`}>
                        {participants[currentSpeakerIndex]} <span className="opacity-60">typing...</span>
                      </div>
                      <div className={`rounded-xl px-4 py-3 ${modelColors[currentSpeakerIndex].bg} ${modelColors[currentSpeakerIndex].border} border`}>
                        <p className="text-sm text-text-primary whitespace-pre-wrap">{streamingContent}</p>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Footer / Controls */}
          <div className="border-t border-forge-border/50 bg-forge-surface/50 p-4">
            {!isDebating ? (
              /* Start Controls */
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    resetDebate();
                    onClose?.();
                  }}
                  className="btn btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={startDebate}
                  disabled={participants.length < 2 || !topic.trim()}
                  className={`btn text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isPrivate 
                      ? 'bg-pink-500 hover:bg-pink-600 text-white' 
                      : 'btn-primary'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  {isPrivate ? 'Begin Scene' : 'Start Debate'}
                </button>
              </div>
            ) : (
              /* Active Debate Controls */
              <div className="space-y-3">
                {/* Interjection input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={interjection}
                    onChange={(e) => setInterjection(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleInterject()}
                    placeholder="Interject with your thoughts... (pauses the debate)"
                    className="input text-sm flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleInterject}
                    disabled={!interjection.trim()}
                    className="btn btn-primary px-4 disabled:opacity-50"
                    title="Send interjection"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>

                {/* Playback controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isPaused ? (
                      <button
                        type="button"
                        onClick={resumeDebate}
                        disabled={turnCount >= maxTurns}
                        className="btn btn-primary text-sm flex items-center gap-2"
                      >
                        <Play className="w-4 h-4" />
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={pauseDebate}
                        className="btn btn-secondary text-sm flex items-center gap-2"
                      >
                        <Pause className="w-4 h-4" />
                        Pause
                      </button>
                    )}
                    
                    {isPaused && participants.length > 0 && (
                      <div className="flex items-center gap-1 ml-2">
                        <span className="text-xs text-text-muted">Next:</span>
                        {participants.map((model, idx) => {
                          const color = modelColors[idx];
                          const isNext = idx === currentSpeakerIndex;
                          return (
                            <button
                              key={model}
                              type="button"
                              onClick={() => setNextSpeaker(model)}
                              className={`px-2 py-1 text-xs rounded-lg transition-all ${
                                isNext 
                                  ? `${color.bg} ${color.border} border ${color.text}` 
                                  : 'text-text-muted hover:bg-forge-hover'
                              }`}
                              title={`Set ${model} as next speaker`}
                            >
                              {model.split(':')[0]}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={resetDebate}
                      className="btn btn-secondary text-sm flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      New Debate
                    </button>
                    <button
                      type="button"
                      onClick={stopDebate}
                      className="btn text-sm bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                    >
                      End
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default DebateArena;

