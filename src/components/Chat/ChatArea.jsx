import React, { useState, useRef, useEffect, memo, useCallback, useMemo, lazy, Suspense } from 'react';
import { Send, Square, Paperclip, Image, Sparkles, Users, Shield, Camera, Bot, User, Brain, ChevronDown, Globe } from 'lucide-react';
import { useAppStore, WORKSPACES } from '../../stores/appStore';
import { EnhancedMessageBubble, TypingBubble, WelcomeMessage } from './EnhancedMessageBubble';
import { VirtualizedMessageList } from './VirtualizedMessageList';
import { ModelSelector } from '../ModelSelector/ModelSelector';
import { TemplateSelector } from './TemplateSelector';
import { BranchSelector } from './BranchSelector';
import { BranchIndicator } from './BranchIndicator';
import { VoiceInput } from './VoiceInput';
import { DocumentContext } from './DocumentContext';
import { getWorkspaceColorClasses } from '../../utils/workspaceColors';
import { ImagePreview } from './ImagePreview';
import { useDragDrop } from '../../hooks/useDragDrop';
import { ModelExperienceIndicator } from './ModelExperienceIndicator';
import { ModelCapabilityWarning } from './ModelCapabilityWarning';
import { useModelAwareness } from '../../services/modelExperience';
import { useTypingAnalyzer } from '../../hooks/useTypingAnalyzer';
import { useSoulStore } from '../../stores/soulStore';
import { ContextUtilizationIndicator } from './ContextUtilizationIndicator';
import { ArtifactPanel } from './ArtifactPanel';
import { ChatErrorBanner, ConnectionStatusDot } from './ChatErrorBoundary';
import { MessageSkeleton } from './MessageSkeleton';
import { useChatKeyboard } from '../../hooks/useChatKeyboard';

// Lazy load heavy components
const CompareMode = lazy(() => import('./CompareMode').then(m => ({ default: m.CompareMode })));
const DebateArena = lazy(() => import('./DebateArena').then(m => ({ default: m.DebateArena })));
const CharacterStudio = lazy(() => import('../Characters/CharacterStudio').then(m => ({ default: m.CharacterStudio })));
const AgentDashboard = lazy(() => import('../Agents/AgentDashboard').then(m => ({ default: m.AgentDashboard })));
const CodeWorkbench = lazy(() => import('../Code/CodeWorkbench').then(m => ({ default: m.CodeWorkbench })));
const CasualWorkspace = lazy(() => import('./CasualWorkspace').then(m => ({ default: m.CasualWorkspace })));

export function ChatArea() {
  // === SELECTIVE SUBSCRIPTIONS for optimal re-render performance ===
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const messages = useAppStore(s => s.messages);
  const isGenerating = useAppStore(s => s.isGenerating);
  const streamingContent = useAppStore(s => s.streamingContent);
  const currentModel = useAppStore(s => s.currentModel);
  const modelStatus = useAppStore(s => s.modelStatus);
  const error = useAppStore(s => s.error);
  const showModelSelector = useAppStore(s => s.showModelSelector);
  
  // Actions - get from store only once
  const sendMessage = useAppStore(s => s.sendMessage);
  const stopGeneration = useAppStore(s => s.stopGeneration);
  const toggleModelSelector = useAppStore(s => s.toggleModelSelector);
  const openExportModal = useAppStore(s => s.openExportModal);
  const regenerateLastResponse = useAppStore(s => s.regenerateLastResponse);
  const editMessageAndRegenerate = useAppStore(s => s.editMessageAndRegenerate);
  const deleteMessage = useAppStore(s => s.deleteMessage);

  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const inputContainerRef = useRef(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const [showCompare, setShowCompare] = useState(false);
  const [showDebate, setShowDebate] = useState(false);
  const [showCharacters, setShowCharacters] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [showModelExperience, setShowModelExperience] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => localStorage.getItem('webSearchEnabled') === 'true');
  
  // Artifact panel state - for live preview of HTML/SVG/Mermaid/React
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactContent, setArtifactContent] = useState(null);
  
  // Keyboard shortcuts for chat
  const { copyToast } = useChatKeyboard({ textareaRef });
  
  // Handler for showing artifact preview
  const handleShowArtifact = useCallback((messageId, content) => {
    setArtifactContent(content);
    setArtifactPanelOpen(true);
  }, []);
  
  const workspace = WORKSPACES[currentWorkspace];
  
  // Typing analyzer for soul state inference
  const { handleKeyDown: handleTypingKeyDown } = useTypingAnalyzer(currentWorkspace);
  
  // Soul store for friction signal recording
  const { recordUserAction } = useSoulStore();
  
  // Regenerate: actually re-sends the last user message to get a new response
  const handleRegenerate = useCallback(async (messageId) => {
    recordUserAction('regenerate', { 
      messageId, 
      workspace: currentWorkspace,
      model: currentModel 
    });
    // Actually regenerate the response
    if (regenerateLastResponse) {
      await regenerateLastResponse();
    }
  }, [recordUserAction, currentWorkspace, currentModel, regenerateLastResponse]);
  
  // Edit: updates a user message and regenerates everything after it
  const handleMessageEdit = useCallback(async (messageId, originalContent, newContent) => {
    recordUserAction('edit', { 
      messageId, 
      workspace: currentWorkspace,
      metadata: {
        originalLength: originalContent?.length || 0,
        newLength: newContent?.length || 0,
      }
    });
    if (editMessageAndRegenerate && newContent?.trim()) {
      await editMessageAndRegenerate(messageId, newContent.trim());
    }
  }, [recordUserAction, currentWorkspace, editMessageAndRegenerate]);

  // Delete: removes a single message
  const handleDeleteMessage = useCallback(async (messageId) => {
    if (deleteMessage) {
      await deleteMessage(messageId);
    }
  }, [deleteMessage]);
  
  const handleFeedback = async (messageId, feedbackType) => {
    if (feedbackType === 'regenerate') {
      await handleRegenerate(messageId);
    } else if (feedbackType === 'negative') {
      await recordUserAction('negative_feedback', {
        messageId,
        workspace: currentWorkspace,
      });
    } else if (feedbackType === 'positive') {
      await recordUserAction('positive_feedback', {
        messageId,
        workspace: currentWorkspace,
      });
    }
  };
  
  // Model awareness for UI adaptation
  const { 
    isModelLoaded,
    modelFamily,
    canDoCode,
    canDoCreative,
    shouldShowCodeActions,
    getPromptSuggestions,
  } = useModelAwareness();

  const { isDragging } = useDragDrop({
    targetRef: inputContainerRef,
    onFiles: (files) => {
      if (!files || files.length === 0) return;
      setAttachments((prev) => {
        const next = [...prev];
        files.forEach((file) => {
          const isImage = file.type && file.type.startsWith('image/');
          const previewUrl =
            isImage && typeof URL !== 'undefined'
              ? URL.createObjectURL(file)
              : null;
          next.push({
            id: `${Date.now()}-${file.name}-${Math.random().toString(16).slice(2)}`,
            name: file.name,
            kind: isImage ? 'image' : 'file',
            mimeType: file.type,
            size: file.size,
            // Electron adds .path for local files; browser may not
            originalPath: file.path || null,
            previewUrl,
          });
        });
        return next;
      });
    },
  });

  // Check if user is near bottom (within 200px)
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 200;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Smooth scroll to bottom using scrollTop animation for buttery smooth feel
  const scrollToBottom = useCallback((instant = false) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    if (instant) {
      container.scrollTop = container.scrollHeight;
    } else {
      // Use native smooth scroll
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  // Auto-scroll during streaming - smooth, only if user hasn't scrolled away
  useEffect(() => {
    if (isGenerating && streamingContent && !isUserScrollingRef.current) {
      // During streaming: use requestAnimationFrame for 60fps smooth scroll
      const raf = requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (container && isNearBottom()) {
          container.scrollTop = container.scrollHeight;
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [streamingContent, isGenerating, isNearBottom]);

  // Auto-scroll when new messages arrive (not during streaming)
  useEffect(() => {
    if (!isGenerating && messages.length > 0) {
      if (isNearBottom() && !isUserScrollingRef.current) {
        requestAnimationFrame(() => scrollToBottom(false));
      }
    }
  }, [messages.length, isGenerating, isNearBottom, scrollToBottom]);

  // Instant scroll for user's own messages
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      isUserScrollingRef.current = false;
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }, [messages.length, scrollToBottom]);

  // Track user scrolling + show/hide "scroll to bottom" button
  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    
    const wasNearBottom = isNearBottom();
    setShowScrollButton(!wasNearBottom);
    
    if (!wasNearBottom) {
      isUserScrollingRef.current = true;
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      if (isNearBottom()) {
        isUserScrollingRef.current = false;
        setShowScrollButton(false);
      }
    }, 1500);
  }, [isNearBottom]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isGenerating || isComposing) return;
    
    // Reset scroll lock when user sends a message
    isUserScrollingRef.current = false;
    
    const message = input.trim();
    setInput('');
    const payloadAttachments = attachments.map((att) => ({
      originalPath: att.originalPath,
      type: att.kind,
      mimeType: att.mimeType,
      name: att.name,
      size: att.size,
    }));
    setAttachments((prev) => {
      prev.forEach((att) => {
        if (att.previewUrl && typeof URL !== 'undefined') {
          URL.revokeObjectURL(att.previewUrl);
        }
      });
      return [];
    });
    try {
      await sendMessage(message, { attachments: payloadAttachments, webSearchEnabled });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleKeyDown = (e) => {
    // Track typing for soul state inference
    handleTypingKeyDown(e);
    
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (currentWorkspace === 'code') {
    return (
      <div className="flex-1 flex flex-col h-full">
        {showModelSelector && <ModelSelector onClose={() => toggleModelSelector()} />}
        <Suspense fallback={null}>
          {showAgents && <AgentDashboard isOpen={showAgents} onClose={() => setShowAgents(false)} />}
        </Suspense>
        <div className="flex-1 min-h-0 px-4 py-4">
          <Suspense fallback={<div className="h-full flex items-center justify-center text-text-muted">Loading...</div>}>
            <CodeWorkbench />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          {showCompare && <CompareMode isOpen={showCompare} onClose={() => setShowCompare(false)} />}
          {showDebate && <DebateArena isOpen={showDebate} onClose={() => setShowDebate(false)} />}
          {showCharacters && currentWorkspace === 'nsfw' && (
            <CharacterStudio isOpen={showCharacters} onClose={() => setShowCharacters(false)} />
          )}
        </Suspense>
      </div>
    );
  }

  // Clean Casual Chat Experience
  if (currentWorkspace === 'casual') {
    return (
      <div className="flex-1 flex flex-col h-full">
        {showModelSelector && <ModelSelector onClose={() => toggleModelSelector()} />}
        <Suspense fallback={null}>
          {showAgents && <AgentDashboard isOpen={showAgents} onClose={() => setShowAgents(false)} />}
        </Suspense>
        <Suspense fallback={<div className="h-full flex items-center justify-center text-text-muted">Loading...</div>}>
          <CasualWorkspace />
        </Suspense>
        <Suspense fallback={null}>
          {showCompare && <CompareMode isOpen={showCompare} onClose={() => setShowCompare(false)} />}
          {showDebate && <DebateArena isOpen={showDebate} onClose={() => setShowDebate(false)} />}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {showModelSelector && <ModelSelector onClose={() => toggleModelSelector()} />}

      <Suspense fallback={null}>
        {showAgents && <AgentDashboard isOpen={showAgents} onClose={() => setShowAgents(false)} />}
      </Suspense>

      {/* Model Capability Warning - shows if model doesn't match workspace */}
      <ModelCapabilityWarning />

      {/* Error banner with guided recovery */}
      <ChatErrorBanner />

      {/* Copy toast notification */}
      {copyToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-emerald-500/90 text-white text-xs font-medium shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
          {copyToast}
        </div>
      )}

      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 relative"
        style={{ scrollBehavior: 'auto' }}
      >
        <div className="max-w-3xl mx-auto mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-xs text-text-muted">
              {workspace?.name} workspace
            </div>
            {/* Full context indicator - expandable */}
            {messages.length > 0 && (
              <ContextUtilizationIndicator className="max-w-xs" />
            )}
          </div>
          <div className="flex items-center gap-3">
            <BranchSelector />
            <button
              type="button"
              onClick={() => setShowAgents(true)}
              className="text-[11px] text-text-muted hover:text-text-secondary underline-offset-2 hover:underline flex items-center gap-1"
            >
              <Bot size={12} />
              Agents
            </button>
            <button
              type="button"
              onClick={() => setShowCompare(true)}
              className="text-[11px] text-text-muted hover:text-text-secondary underline-offset-2 hover:underline flex items-center gap-1"
            >
              <Sparkles size={12} />
              Compare
            </button>
            <button
              type="button"
              onClick={() => setShowDebate(true)}
              className={`text-[11px] underline-offset-2 hover:underline flex items-center gap-1 ${
                currentWorkspace === 'nsfw'
                  ? 'text-pink-400/70 hover:text-pink-400'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {currentWorkspace === 'nsfw' ? <Shield size={12} /> : <Users size={12} />}
              {currentWorkspace === 'nsfw' ? 'Private Arena' : 'Model Arena'}
            </button>
            {currentWorkspace === 'nsfw' && (
              <button
                type="button"
                onClick={() => setShowCharacters(true)}
                className="text-[11px] text-text-muted hover:text-text-secondary underline-offset-2 hover:underline flex items-center gap-1"
              >
                <User size={12} />
                Characters
              </button>
            )}
          </div>
        </div>
        {messages.length === 0 && !isGenerating ? (
          <EmptyState 
            workspace={workspace} 
            modelStatus={modelStatus} 
            error={error}
            modelAwareness={{ isModelLoaded, modelFamily, getPromptSuggestions }}
          />
        ) : messages.length > 20 ? (
          /* Use virtualized list for long conversations (20+ messages) */
          <div className="h-full">
            <VirtualizedMessageList
              messages={messages}
              streamingMessageId={isGenerating ? 'streaming' : null}
              streamingContent={streamingContent}
              showBranchIndicators={true}
              enableActions={true}
              variant="enhanced"
              className="max-w-3xl mx-auto"
            />
            {isGenerating && !streamingContent && (
              <div className="max-w-3xl mx-auto px-4">
                <TypingBubble model={currentModel} />
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-1 enhanced-chat-container">
            {messages.length === 0 && !isGenerating && (
              <WelcomeMessage modelName={currentModel} />
            )}
            {messages.map((message, idx) => (
              <div key={message.id}>
                <EnhancedMessageBubble 
                  message={message} 
                  showTimestamp={true}
                  enableActions={true}
                  onRegenerate={() => handleRegenerate(message.id)}
                  onEdit={(msgId, newContent) => handleMessageEdit(msgId, message.content, newContent)}
                  onDelete={() => handleDeleteMessage(message.id)}
                  onFeedback={(msgId, type) => handleFeedback(msgId, type)}
                  onShowArtifact={handleShowArtifact}
                />
                {message.role === 'assistant' && (
                  <BranchIndicator message={message} />
                )}
                {idx === messages.length - 1 && message.role === 'assistant' && (
                  <DocumentContext />
                )}
              </div>
            ))}
            {isGenerating && !streamingContent && (
              <TypingBubble model={currentModel} />
            )}
            {isGenerating && streamingContent && (
              <EnhancedMessageBubble 
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingContent,
                  model: currentModel
                }}
                isStreaming
              />
            )}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        )}

        {/* Scroll to bottom button - appears when user scrolls up */}
        {showScrollButton && (
          <button
            onClick={() => {
              isUserScrollingRef.current = false;
              scrollToBottom(false);
              setShowScrollButton(false);
            }}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 z-20 
              w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/20 
              flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20
              transition-all duration-200 shadow-lg hover:shadow-xl
              animate-in fade-in slide-in-from-bottom-2"
            title="Scroll to bottom"
          >
            <ChevronDown size={20} />
          </button>
        )}
      </div>

      {/* Lazy-loaded modals */}
      <Suspense fallback={null}>
        {showCompare && <CompareMode isOpen={showCompare} onClose={() => setShowCompare(false)} />}
        {showDebate && <DebateArena isOpen={showDebate} onClose={() => setShowDebate(false)} />}
        {showCharacters && currentWorkspace === 'nsfw' && (
          <CharacterStudio isOpen={showCharacters} onClose={() => setShowCharacters(false)} />
        )}
      </Suspense>

      {/* Input Area */}
      <div className="border-t border-forge-border bg-forge-surface/50 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <form onSubmit={handleSubmit} className="relative" ref={inputContainerRef}>
            <div
              className={`relative rounded-xl bg-forge-bg border transition-colors ${
                isDragging
                  ? 'border-workspace-casual/70 ring-2 ring-workspace-casual/40'
                  : 'border-forge-border focus-within:border-workspace-casual/50'
              }`}
            >
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder={`Message ${workspace?.name || 'DevForge'}...`}
                disabled={isGenerating}
                rows={1}
                className="w-full px-4 py-3 pr-32 bg-transparent text-text-primary placeholder-text-muted resize-none focus:outline-none scrollbar-hide"
                style={{ maxHeight: '200px' }}
              />

              {/* Attachments preview */}
              <ImagePreview
                attachments={attachments}
                onRemove={(id) => {
                  setAttachments((prev) => {
                    const target = prev.find((a) => a.id === id);
                    if (target?.previewUrl && typeof URL !== 'undefined') {
                      URL.revokeObjectURL(target.previewUrl);
                    }
                    return prev.filter((a) => a.id !== id);
                  });
                }}
              />

              {/* Action Buttons */}
              <div className="absolute right-2 bottom-2 flex items-center gap-1">
                {/* Web Search Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !webSearchEnabled;
                    setWebSearchEnabled(next);
                    localStorage.setItem('webSearchEnabled', next.toString());
                  }}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    webSearchEnabled 
                      ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25' 
                      : 'text-text-muted hover:text-text-secondary hover:bg-forge-hover border border-transparent'
                  }`}
                  title={webSearchEnabled ? "Web search enabled" : "Enable web search"}
                >
                  <Globe size={14} />
                </button>
                {/* Templates */}
                <TemplateSelector
                  onInsert={(text) =>
                    setInput((prev) => (prev ? `${prev}\n\n${text}` : text))
                  }
                />
                {/* Voice input */}
                <VoiceInput
                  onResult={(text) =>
                    setInput((prev) => (prev ? `${prev}\n${text}` : text))
                  }
                />
                {/* Attachment (opens file picker) */}
                <button
                  type="button"
                  className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
                  title="Attach file"
                  onClick={async () => {
                    try {
                      const result = await window.electronAPI?.selectFile?.({
                        properties: ['openFile', 'multiSelections'],
                      });
                      if (!result || !Array.isArray(result)) return;
                      setAttachments((prev) => {
                        const next = [...prev];
                        result.forEach((filePath) => {
                          const name = filePath.split(/[\\/]/).pop() || 'file';
                          next.push({
                            id: `${Date.now()}-${name}-${Math.random().toString(16).slice(2)}`,
                            name,
                            kind: 'file',
                            mimeType: '',
                            size: null,
                            originalPath: filePath,
                            previewUrl: null,
                          });
                        });
                        return next;
                      });
                    } catch (err) {
                      console.error('Failed to select attachment:', err);
                    }
                  }}
                >
                  <Paperclip size={18} />
                </button>

                {/* Screenshot capture (Electron only) */}
                <button
                  type="button"
                  className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
                  title="Capture screenshot"
                  onClick={async () => {
                    try {
                      if (!window.electronAPI?.captureScreenshot) return;
                      const result = await window.electronAPI.captureScreenshot();
                      if (!result?.success || !result.path) return;
                      const filePath = result.path;
                      const name = filePath.split(/[\\/]/).pop() || 'screenshot.png';
                      setAttachments((prev) => [
                        ...prev,
                        {
                          id: `${Date.now()}-${name}-${Math.random().toString(16).slice(2)}`,
                          name,
                          kind: 'image',
                          mimeType: 'image/png',
                          size: null,
                          originalPath: filePath,
                          previewUrl: typeof window !== 'undefined' ? `file://${filePath}` : null,
                        },
                      ]);
                    } catch (err) {
                      console.error('Failed to capture screenshot:', err);
                    }
                  }}
                >
                  <Camera size={18} />
                </button>

                {/* Image Gen shortcut */}
                <button
                  type="button"
                  onClick={() => useAppStore.getState().toggleImageGen()}
                  className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
                  title="Generate image"
                >
                  <Image size={18} />
                </button>

                {/* Send / Stop */}
                {isGenerating ? (
                  <button
                    type="button"
                    onClick={stopGeneration}
                    className="p-2 rounded-lg bg-status-error/20 text-status-error hover:bg-status-error/30 transition-colors"
                    title="Stop generation"
                  >
                    <Square size={18} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim() || !currentModel}
                    className={`
                      p-2 rounded-lg transition-colors
                      ${input.trim() && currentModel
                        ? `${getWorkspaceColorClasses(workspace?.color || 'workspace-casual').bg} text-white hover:opacity-90`
                        : 'bg-forge-elevated text-text-muted cursor-not-allowed'
                      }
                    `}
                    title="Send message"
                  >
                    <Send size={18} />
                  </button>
                )}
              </div>
            </div>

            {/* Model indicator + utilities */}
            <div className="flex items-center justify-between mt-2 px-1">
              <div className="flex items-center gap-3">
                <ConnectionStatusDot />
                <button
                  type="button"
                  onClick={toggleModelSelector}
                  className="text-xs text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1"
                >
                  <Sparkles size={12} />
                  {currentModel || 'Select a model'}
                </button>

                <button
                  type="button"
                  onClick={openExportModal}
                  className="text-[11px] text-text-muted hover:text-text-secondary transition-colors underline-offset-2 hover:underline"
                >
                  Export chat
                </button>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Context utilization indicator - shows how much of the context window is being used */}
                <ContextUtilizationIndicator compact />
                
                {isGenerating && (
                  <span className="text-[10px] text-white/30">Esc to stop</span>
                )}
                <span className="text-xs text-text-muted">
                  {input.length > 0 && `${input.length} chars`}
                </span>
              </div>
            </div>
          </form>
        </div>
      </div>
      
      {/* Artifact Preview Panel - Shows live preview of HTML/SVG/Mermaid/React */}
      <ArtifactPanel
        content={artifactContent}
        isOpen={artifactPanelOpen}
        onClose={() => setArtifactPanelOpen(false)}
        onToggle={() => setArtifactPanelOpen(!artifactPanelOpen)}
      />
    </div>
  );
}

// Empty state component - memoized for performance
const EmptyState = memo(function EmptyState({ workspace, modelStatus, error, modelAwareness }) {
  const colorClasses = getWorkspaceColorClasses(workspace?.color || 'workspace-casual');
  const { isModelLoaded, modelFamily, getPromptSuggestions } = modelAwareness || {};
  
  // Get model-aware prompts if available
  const prompts = isModelLoaded && getPromptSuggestions 
    ? getPromptSuggestions() 
    : getQuickPrompts(workspace?.id);
  
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <div className="w-full max-w-2xl anim-fade-in">
        {/* Logo / Icon */}
        <div className={`w-16 h-16 rounded-2xl ${colorClasses.bg20} border ${colorClasses.border30} flex items-center justify-center mx-auto mb-6`}>
          <Sparkles size={32} className={colorClasses.text} />
        </div>

        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          {workspace?.name} Workspace
        </h1>
        
        <p className="text-text-secondary max-w-md mx-auto mb-4">
          {workspace?.description || 'Start a conversation to begin'}
        </p>

        {/* Model Experience Indicator */}
        {isModelLoaded && (
          <div className="mb-6 max-w-md mx-auto">
            <ModelExperienceIndicator />
          </div>
        )}

        {/* Show connection error if Ollama is offline */}
        {modelStatus === 'offline' && error && (
          <div className="max-w-md mx-auto mb-6 p-4 bg-status-error/10 border border-status-error/30 rounded-lg">
            <p className="text-sm text-status-error font-medium mb-2">⚠️ Backend Not Connected</p>
            <p className="text-xs text-text-muted">{error}</p>
            <button
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.startOllama?.();
                  if (result?.success) {
                    // Refresh models after starting
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await useAppStore.getState().refreshModels();
                  }
                } catch (err) {
                  console.error('Failed to start Ollama:', err);
                }
              }}
              className="btn btn-secondary text-xs mt-3"
            >
              <Sparkles size={14} />
              Try Starting Ollama
            </button>
          </div>
        )}

        {/* Model-aware prompt suggestions */}
        <div className="space-y-3">
          {isModelLoaded && modelFamily && (
            <p className="text-xs text-text-muted mb-2 flex items-center justify-center gap-1.5">
              <Brain size={12} className="text-workspace-casual" />
              <span>Suggestions optimized for <span className="capitalize text-workspace-casual">{modelFamily}</span> model</span>
            </p>
          )}
          
          <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
            {prompts.map((prompt, i) => (
              <button
                key={i}
                onClick={() => useAppStore.getState().sendMessage(prompt)}
                className="text-left px-4 py-3 rounded-lg bg-forge-elevated border border-forge-border hover:border-forge-hover hover:bg-forge-hover transition-colors group"
              >
                <p className="text-sm text-text-secondary group-hover:text-text-primary line-clamp-2">
                  {prompt}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

function getQuickPrompts(workspaceId) {
  const prompts = {
    casual: [
      "What's something interesting you can tell me?",
      "Help me brainstorm ideas for...",
      "Explain this concept to me:",
      "Let's have a creative discussion about..."
    ],
    work: [
      "Help me draft a professional email",
      "Summarize this document for me",
      "Create an action plan for...",
      "Review and improve this text:"
    ],
    code: [
      "Help me debug this code:",
      "Explain this algorithm to me",
      "Write a function that...",
      "Review my code for best practices"
    ],
    nsfw: [
      "Let's roleplay a scenario...",
      "Write a story about...",
      "Continue this creative writing...",
      "Help me explore a fantasy..."
    ]
  };
  
  return prompts[workspaceId] || prompts.casual;
}
