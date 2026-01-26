import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Sparkles, 
  Code2, 
  Bug, 
  Zap, 
  FileCode,
  Loader2,
  Copy,
  Check,
  RefreshCw
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function CodeChatPanel({ currentFile, selectedCode }) {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  
  const { 
    messages, 
    sendMessage, 
    isGenerating, 
    streamingContent,
    currentModel
  } = useAppStore((state) => ({
    messages: state.messages,
    sendMessage: state.sendMessage,
    isGenerating: state.isGenerating,
    streamingContent: state.streamingContent,
    currentModel: state.currentModel
  }));

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;
    
    let prompt = input;
    
    // Add file context if available
    if (currentFile) {
      prompt = `[Context: Working on file "${currentFile}"]\n\n${prompt}`;
    }
    
    // Add selected code context
    if (selectedCode) {
      prompt = `${prompt}\n\nSelected code:\n\`\`\`\n${selectedCode}\n\`\`\``;
    }
    
    setInput('');
    await sendMessage(prompt);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickActions = [
    { 
      icon: Bug, 
      label: 'Find bugs', 
      prompt: 'Review this code and identify any bugs, issues, or potential problems. Explain each issue and how to fix it.'
    },
    { 
      icon: Zap, 
      label: 'Optimize', 
      prompt: 'Optimize this code for better performance and readability. Show the improved version with explanations.'
    },
    { 
      icon: FileCode, 
      label: 'Explain', 
      prompt: 'Explain what this code does in simple terms. Break it down step by step.'
    },
    { 
      icon: RefreshCw, 
      label: 'Refactor', 
      prompt: 'Refactor this code following best practices. Apply clean code principles and modern patterns.'
    }
  ];

  const handleQuickAction = (prompt) => {
    const context = selectedCode 
      ? `\n\nCode:\n\`\`\`\n${selectedCode}\n\`\`\``
      : currentFile 
        ? `\n\n[Current file: ${currentFile}]`
        : '';
    sendMessage(prompt + context);
  };

  const copyToClipboard = async (text, id) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const extractCodeBlocks = (content) => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', language: match[1] || 'plaintext', content: match[2] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.slice(lastIndex) });
    }

    return parts.length > 0 ? parts : [{ type: 'text', content }];
  };

  return (
    <div className="flex flex-col h-full border border-forge-border/50 rounded-lg bg-forge-surface/30 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border/30 bg-forge-surface/50">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-workspace-code" />
          <span className="text-sm font-medium text-text-primary">AI Assistant</span>
          {currentModel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-workspace-code/20 text-workspace-code">
              {currentModel}
            </span>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && !isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-xl bg-workspace-code/20 flex items-center justify-center mb-3">
              <Code2 size={24} className="text-workspace-code" />
            </div>
            <h3 className="text-sm font-medium text-text-primary mb-1">Code Assistant</h3>
            <p className="text-xs text-text-muted mb-4 max-w-[200px]">
              Ask questions about your code, get help debugging, or request improvements.
            </p>
            
            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-[240px]">
              {quickActions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-forge-bg/60 border border-forge-border/30 text-text-muted hover:text-text-primary hover:border-workspace-code/50 transition-all text-[11px]"
                >
                  <action.icon size={12} />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div
                key={msg.id || idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-workspace-code/20 text-text-primary border border-workspace-code/30'
                      : 'bg-forge-bg/80 text-text-primary border border-forge-border/30'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="space-y-2">
                      {extractCodeBlocks(msg.content).map((part, partIdx) => (
                        part.type === 'code' ? (
                          <div key={partIdx} className="relative group">
                            <div className="flex items-center justify-between px-2 py-1 bg-forge-surface/50 rounded-t border-b border-forge-border/30 text-[10px] text-text-muted">
                              <span>{part.language}</span>
                              <button
                                onClick={() => copyToClipboard(part.content, `${idx}-${partIdx}`)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                {copied === `${idx}-${partIdx}` ? (
                                  <Check size={12} className="text-green-400" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            </div>
                            <pre className="p-2 bg-forge-bg/60 rounded-b overflow-x-auto text-[11px] font-mono">
                              <code>{part.content}</code>
                            </pre>
                          </div>
                        ) : (
                          <p key={partIdx} className="whitespace-pre-wrap text-[13px] leading-relaxed">
                            {part.content}
                          </p>
                        )
                      ))}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-[13px]">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            
            {/* Streaming response */}
            {isGenerating && streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-lg px-3 py-2 bg-forge-bg/80 text-text-primary border border-forge-border/30 text-sm">
                  <div className="space-y-2">
                    {extractCodeBlocks(streamingContent).map((part, partIdx) => (
                      part.type === 'code' ? (
                        <div key={partIdx} className="relative">
                          <div className="flex items-center justify-between px-2 py-1 bg-forge-surface/50 rounded-t border-b border-forge-border/30 text-[10px] text-text-muted">
                            <span>{part.language}</span>
                          </div>
                          <pre className="p-2 bg-forge-bg/60 rounded-b overflow-x-auto text-[11px] font-mono">
                            <code>{part.content}</code>
                          </pre>
                        </div>
                      ) : (
                        <p key={partIdx} className="whitespace-pre-wrap text-[13px] leading-relaxed">
                          {part.content}
                        </p>
                      )
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {/* Loading indicator */}
            {isGenerating && !streamingContent && (
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 bg-forge-bg/80 border border-forge-border/30">
                  <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-xs">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context indicator */}
      {(currentFile || selectedCode) && (
        <div className="px-3 py-1.5 border-t border-forge-border/20 bg-forge-surface/30">
          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            <FileCode size={10} />
            {currentFile && <span className="truncate">{currentFile}</span>}
            {selectedCode && (
              <span className="px-1.5 py-0.5 rounded bg-workspace-code/20 text-workspace-code">
                {selectedCode.split('\n').length} lines selected
              </span>
            )}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-2 border-t border-forge-border/30 bg-forge-surface/40">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your code..."
              disabled={isGenerating || !currentModel}
              rows={1}
              className="w-full px-3 py-2 text-sm bg-forge-bg/60 border border-forge-border/30 rounded-lg resize-none focus:outline-none focus:border-workspace-code/50 text-text-primary placeholder-text-muted disabled:opacity-50 min-h-[38px] max-h-[120px]"
              style={{ 
                height: 'auto',
                minHeight: '38px'
              }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating || !currentModel}
            className="p-2 rounded-lg bg-workspace-code text-white hover:bg-workspace-code/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        {!currentModel && (
          <p className="text-[10px] text-amber-400/80 mt-1 px-1">
            Select a model from the bottom left to start chatting
          </p>
        )}
      </div>
    </div>
  );
}

export default CodeChatPanel;

