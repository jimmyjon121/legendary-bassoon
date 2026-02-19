import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Terminal,
  GitBranch,
  CheckCircle,
  XCircle,
  AlertCircle,
  Search,
  Wrench,
  FolderTree,
  FileText,
  Hash,
  ArrowDown,
  Lightbulb,
  Play,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useEditorStore } from '../../stores/editorStore';
import { safeCall, isElectron } from '../../utils/electronAPI';
import { FileMentionInput, parseMentions } from './FileMentionInput';
import { ToolEnabledLLM } from '../../services/toolEnabledLLM';

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Context Bar - Shows what project/file the AI currently sees
 */
function ContextBar({ rootPath, currentFile, openFilesList, selectedCode, selectionStartLine }) {
  const [expanded, setExpanded] = useState(false);
  const projectName = rootPath ? rootPath.split(/[/\\]/).pop() : null;
  
  if (!rootPath && !currentFile) return null;

  return (
    <div className="border-b border-forge-border/20 bg-forge-surface/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-text-muted hover:text-text-primary transition-colors"
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {projectName && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-workspace-code/10 text-workspace-code border border-workspace-code/20">
              <FolderTree size={9} />
              {projectName}
            </span>
          )}
          {currentFile && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 truncate">
              <FileText size={9} />
              {currentFile.split(/[/\\]/).pop()}
            </span>
          )}
          {selectedCode && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Hash size={9} />
              {selectedCode.split('\n').length} lines selected
            </span>
          )}
        </div>
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>
      
      {expanded && (
        <div className="px-3 pb-2 space-y-1 text-[10px] text-text-muted">
          {rootPath && (
            <div className="flex items-center gap-1">
              <FolderTree size={9} className="text-workspace-code" />
              <span className="truncate">{rootPath}</span>
            </div>
          )}
          {currentFile && (
            <div className="flex items-center gap-1">
              <FileCode size={9} className="text-emerald-400" />
              <span className="truncate">{currentFile}</span>
              <span className="text-text-muted/50 ml-1">(active — AI can see full content)</span>
            </div>
          )}
          {openFilesList && openFilesList.length > 1 && (
            <div className="flex items-center gap-1">
              <Eye size={9} className="text-blue-400" />
              <span>{openFilesList.length} open file{openFilesList.length > 1 ? 's' : ''}</span>
            </div>
          )}
          {selectedCode && (
            <div className="flex items-center gap-1">
              <Hash size={9} className="text-amber-400" />
              <span>Selection from line {selectionStartLine}: {selectedCode.split('\n').length} lines</span>
            </div>
          )}
          <div className="mt-1 pt-1 border-t border-forge-border/10 text-text-muted/50 italic">
            The AI can see your project tree, open file contents, and any selected code.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tool Call Indicator - Shows what tool the AI is currently using
 */
function ToolCallIndicator({ toolCall }) {
  if (!toolCall) return null;
  
  const iconMap = {
    read_file: FileCode,
    search_code: Search,
    list_directory: FileSearch,
    propose_edit: GitBranch,
    run_command: Terminal,
    run_lint: Wrench,
    run_tests: CheckCircle,
  };
  
  const Icon = iconMap[toolCall.function?.name] || Wrench;
  
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-workspace-code/10 border border-workspace-code/30 rounded-lg animate-pulse">
      <Loader2 size={14} className="animate-spin text-workspace-code" />
      <Icon size={14} className="text-workspace-code" />
      <span className="text-xs text-text-primary">
        {toolCall.function?.name?.replace(/_/g, ' ')}...
      </span>
      {toolCall.function?.arguments?.path && (
        <span className="text-[10px] text-text-muted truncate max-w-[150px]">
          {toolCall.function.arguments.path}
        </span>
      )}
    </div>
  );
}

/**
 * Patch Card - Shows a proposed change with diff view
 */
function PatchCard({ patch, onApprove, onReject, isApplying }) {
  const [expanded, setExpanded] = useState(true);
  
  const riskColors = {
    low: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    high: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  
  const riskLevel = patch.blastRadius?.riskLevel || 'low';
  
  return (
    <div className="border border-forge-border/50 rounded-lg overflow-hidden bg-forge-bg/40">
      <div 
        className="flex items-center justify-between px-3 py-2 bg-forge-surface/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <GitBranch size={12} className="text-workspace-code" />
          <span className="text-xs font-mono text-text-primary">{patch.path}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${riskColors[riskLevel]}`}>
            {riskLevel}
          </span>
          <span className="text-[10px] text-text-muted">{patch.operation}</span>
        </div>
      </div>
      
      {expanded && (
        <>
          {patch.rationale && (
            <div className="px-3 py-2 border-t border-forge-border/30">
              <p className="text-[11px] text-text-muted">{patch.rationale}</p>
            </div>
          )}
          
          {patch.diff && (
            <div className="border-t border-forge-border/30 max-h-48 overflow-auto">
              <pre className="p-2 text-[10px] font-mono">
                {patch.diff.hunks?.map((hunk, i) => (
                  <div key={i}>
                    {hunk.lines?.map((line, j) => (
                      <div 
                        key={j} 
                        className={
                          line.type === 'added' ? 'bg-green-500/10 text-green-400' :
                          line.type === 'removed' ? 'bg-red-500/10 text-red-400' :
                          'text-text-muted'
                        }
                      >
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                        {line.content}
                      </div>
                    ))}
                  </div>
                ))}
              </pre>
            </div>
          )}
          
          <div className="flex items-center gap-2 px-3 py-2 border-t border-forge-border/30 bg-forge-surface/30">
            <button
              onClick={() => onApprove(patch.id)}
              disabled={isApplying}
              className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 text-[11px] transition-colors disabled:opacity-50"
            >
              {isApplying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
              Apply
            </button>
            <button
              onClick={() => onReject(patch.id)}
              disabled={isApplying}
              className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-[11px] transition-colors disabled:opacity-50"
            >
              <XCircle size={12} />
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Code Block - Rendered code with copy and apply-to-file buttons
 */
function CodeBlock({ code, language, messageIdx, blockIdx, activeFilePath }) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleApplyToFile = async () => {
    if (!activeFilePath) return;
    // Apply code to the active file in the editor
    const editorStore = useEditorStore.getState();
    editorStore.updateActiveFileContent(code);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg overflow-hidden border border-forge-border/30">
      <div className="flex items-center justify-between px-2 py-1 bg-forge-surface/60 border-b border-forge-border/20 text-[10px] text-text-muted">
        <span className="font-mono">{language || 'code'}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {activeFilePath && (
            <button
              onClick={handleApplyToFile}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30 transition-colors"
              title="Replace active file content"
            >
              {applied ? <Check size={10} className="text-green-400" /> : <Play size={10} />}
              <span>Apply</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-forge-bg/60 transition-colors"
            title="Copy code"
          >
            {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          </button>
        </div>
      </div>
      <pre className="p-2.5 bg-forge-bg/60 overflow-x-auto text-[11px] font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Session Stats - Shows AI session statistics
 */
function SessionStats({ stats }) {
  if (!stats.sessionId) return null;
  
  return (
    <div className="flex items-center gap-3 px-2 py-1 text-[10px] text-text-muted border-b border-forge-border/20">
      <span className="flex items-center gap-1">
        <Eye size={10} />
        {stats.filesRead} files
      </span>
      <span className="flex items-center gap-1">
        <Wrench size={10} />
        {stats.toolCalls} tools
      </span>
      {stats.pendingPatches > 0 && (
        <span className="flex items-center gap-1 text-amber-400">
          <AlertCircle size={10} />
          {stats.pendingPatches} pending
        </span>
      )}
      {stats.appliedPatches > 0 && (
        <span className="flex items-center gap-1 text-green-400">
          <CheckCircle size={10} />
          {stats.appliedPatches} applied
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CodeChatPanel({ 
  currentFile, 
  currentFileContent,
  selectedCode,
  selectionStartLine,
  rootPath,
  projectFiles,
  openFilesList,
  onExtractPlan 
}) {
  const [input, setInput] = useState('');
  const [applyingPatch, setApplyingPatch] = useState(null);
  const [agentMode, setAgentMode] = useState(false); // Tool-enabled agentic mode
  const [agentThinking, setAgentThinking] = useState(null); // Current agent status message
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const toolLLMRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  
  // App store
  const { 
    messages, 
    sendMessage, 
    isGenerating, 
    streamingContent,
    currentModel,
    listPromotedResearchContext
  } = useAppStore((state) => ({
    messages: state.messages,
    sendMessage: state.sendMessage,
    isGenerating: state.isGenerating,
    streamingContent: state.streamingContent,
    currentModel: state.currentModel,
    listPromotedResearchContext: state.listPromotedResearchContext,
  }));
  
  // Editor store - AI session
  const {
    aiSession,
    startAISession,
    approvePatch,
    rejectPatch,
    getAISessionStats
  } = useEditorStore((state) => ({
    aiSession: state.aiSession,
    startAISession: state.startAISession,
    approvePatch: state.approvePatch,
    rejectPatch: state.rejectPatch,
    getAISessionStats: state.getAISessionStats
  }));
  
  const sessionStats = getAISessionStats();

  const sendWithCodeContext = useCallback((promptText, extra = {}) => {
    const codeContext = {
      rootPath: rootPath || null,
      currentFile: currentFile || null,
      openFilesList: Array.isArray(openFilesList) ? openFilesList : [],
      projectFileCount: Array.isArray(projectFiles) ? projectFiles.length : 0,
    };
    return sendMessage(promptText, { ...extra, codeContext });
  }, [sendMessage, rootPath, currentFile, openFilesList, projectFiles]);

  // Scroll management
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    // Auto-scroll during streaming
    if (isGenerating) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingContent, isGenerating]);

  useEffect(() => {
    // Scroll on new messages
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Track scroll position for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  // Start session on mount if not started
  useEffect(() => {
    if (!aiSession.sessionId) {
      startAISession();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Read @mentioned files and inject their contents into the prompt
  const resolveMentions = useCallback(async (text) => {
    const mentions = parseMentions(text);
    if (mentions.length === 0) return text;

    const mentionContents = [];
    for (const mention of mentions) {
      try {
        // Try reading via IPC
        const fullPath = mention.path.includes(rootPath) 
          ? mention.path 
          : `${rootPath}/${mention.path}`.replace(/\\/g, '/');
        const content = await safeCall('readFile', [fullPath], null) 
          || await safeCall('toolReadFile', [rootPath, mention.path], null);
        
        if (content?.content || (typeof content === 'string' && content)) {
          const fileContent = content?.content || content;
          const lines = fileContent.split('\n');
          const truncated = lines.length > 500
            ? lines.slice(0, 400).join('\n') + `\n// ... ${lines.length - 400} more lines ...`
            : fileContent;
          mentionContents.push(`\n\n--- File: ${mention.path} (${lines.length} lines) ---\n\`\`\`\n${truncated}\n\`\`\``);
        }
      } catch (err) {
        mentionContents.push(`\n\n--- File: ${mention.path} (failed to read) ---`);
      }
    }

    // Remove @mentions from the visible text and append file contents
    let cleanText = text;
    for (const m of mentions) {
      cleanText = cleanText.replace(m.fullMatch, '').trim();
    }
    return cleanText + mentionContents.join('');
  }, [rootPath]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;
    
    let prompt = input;
    
    // Resolve @file mentions - read referenced files and inject contents
    prompt = await resolveMentions(prompt);
    
    // Include selected code directly in the user message
    if (selectedCode) {
      const lineInfo = selectionStartLine ? ` (starting at line ${selectionStartLine})` : '';
      prompt = `${prompt}\n\nSelected code${lineInfo}:\n\`\`\`\n${selectedCode}\n\`\`\``;
    }
    
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Agent mode: use ToolEnabledLLM for autonomous file reading/searching
    if (agentMode && rootPath && currentModel && isElectron()) {
      await handleAgentSend(prompt);
    } else {
      await sendWithCodeContext(prompt);
    }
  };

  // Agent mode send - uses ToolEnabledLLM with tool calling loop
  const handleAgentSend = useCallback(async (prompt) => {
    const editorStore = useEditorStore.getState();
    const promotedContext = typeof listPromotedResearchContext === 'function'
      ? listPromotedResearchContext('code').slice(0, 3)
      : [];
    const contextBlock = promotedContext.length > 0
      ? `Promoted research context:\n${promotedContext.map((item, idx) => (
        `${idx + 1}. ${item.title || 'Research context'}\n${item.summary || ''}\nCitations: ${(item.citations || []).slice(0, 5).join(', ') || 'n/a'}`
      )).join('\n\n')}\n\n`
      : '';
    const promptWithContext = contextBlock ? `${contextBlock}Task:\n${prompt}` : prompt;
    
    // Create or reuse the tool-enabled LLM instance
    if (!toolLLMRef.current || toolLLMRef.current.model !== currentModel || toolLLMRef.current.projectRoot !== rootPath) {
      toolLLMRef.current = new ToolEnabledLLM({
        model: currentModel,
        projectRoot: rootPath,
        maxIterations: 10,
        maxToolSteps: 24,
        networkPolicy: 'offline',
        autoRollbackOnFailure: true,
        onToolCall: (toolCall) => {
          editorStore.recordToolCall(toolCall);
          setAgentThinking(`Using ${toolCall.function?.name?.replace(/_/g, ' ')}...`);
        },
        onToolResult: (toolCall, result) => {
          editorStore.completeToolCall(toolCall.id, result);
          if (result.type === 'file_read' && result.success) {
            editorStore.recordFileRead(result.path, result.content);
          }
          if (result.type === 'proposed_edit' && result.success) {
            editorStore.addProposedPatch(result.patch);
          }
        },
        onThinking: (status) => {
          setAgentThinking(status);
        },
      });
    }

    // Add user message to UI
    const userMsg = { id: `user_${Date.now()}`, role: 'user', content: prompt };
    useAppStore.getState().set?.((s) => ({
      messages: [...s.messages, userMsg],
      isGenerating: true,
    })) || useAppStore.setState((s) => ({
      messages: [...s.messages, userMsg],
      isGenerating: true,
    }));

    try {
      setAgentThinking('Analyzing your request...');
      
      // Build conversation history from existing messages
      const history = messages.slice(-20).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const result = await toolLLMRef.current.chat(promptWithContext, history);

      // Add the assistant response
      const assistantMsg = { 
        id: `assistant_${Date.now()}`, 
        role: 'assistant', 
        content: result.content,
        meta: {
          filesRead: result.filesRead,
          toolCalls: result.toolCalls.length,
          iterations: result.iterations,
        }
      };

      useAppStore.setState((s) => ({
        messages: [...s.messages, assistantMsg],
        isGenerating: false,
        streamingContent: '',
      }));

    } catch (error) {
      const errorMsg = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `I encountered an error while processing your request: ${error.message}\n\nThis might be because the current model doesn't support tool calling. Try turning off Agent mode, or switch to a model that supports tools (like Llama 3.1+, Mistral, or Qwen 2.5).`,
      };
      useAppStore.setState((s) => ({
        messages: [...s.messages, errorMsg],
        isGenerating: false,
        streamingContent: '',
      }));
    } finally {
      setAgentThinking(null);
    }
  }, [currentModel, rootPath, messages, listPromotedResearchContext]);

  const handleKeyDown = (e) => {
    // Don't intercept if FileMentionInput is handling it (dropdown open)
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Smart quick actions that use actual context
  const quickActions = useMemo(() => {
    const hasFile = !!currentFile;
    const hasSelection = !!selectedCode;
    const fileName = currentFile?.split(/[/\\]/).pop() || 'this code';
    
    return [
      { 
        icon: Bug, 
        label: 'Find Bugs', 
        prompt: hasSelection 
          ? 'Review the selected code and identify any bugs, issues, or potential problems. Explain each issue and show fixes.'
          : hasFile
            ? `Review ${fileName} and identify any bugs, issues, or potential problems. Explain each issue and show fixes.`
            : 'What bugs or issues should I look out for in this project?',
        color: 'text-red-400'
      },
      { 
        icon: Zap, 
        label: 'Optimize', 
        prompt: hasSelection
          ? 'Optimize the selected code for better performance and readability. Show the improved version.'
          : hasFile
            ? `Optimize ${fileName} for better performance and readability. Show key improvements.`
            : 'What are the main optimization opportunities in this project?',
        color: 'text-amber-400'
      },
      { 
        icon: Lightbulb, 
        label: 'Explain', 
        prompt: hasSelection
          ? 'Explain what the selected code does. Break it down step by step with clear annotations.'
          : hasFile
            ? `Explain what ${fileName} does. Walk through the main logic and data flow.`
            : 'Give me an overview of this project structure and architecture.',
        color: 'text-blue-400'
      },
      { 
        icon: RefreshCw, 
        label: 'Refactor', 
        prompt: hasSelection
          ? 'Refactor the selected code following best practices. Apply clean code principles and modern patterns. Show the complete refactored version.'
          : hasFile
            ? `Refactor ${fileName} following best practices and modern patterns. Show key improvements.`
            : 'Suggest refactoring opportunities across the project.',
        color: 'text-purple-400'
      },
      {
        icon: Terminal,
        label: 'Write Tests',
        prompt: hasSelection
          ? 'Write comprehensive unit tests for the selected code. Use appropriate testing library conventions.'
          : hasFile
            ? `Write comprehensive unit tests for ${fileName}. Cover edge cases and key functionality.`
            : 'Help me set up a testing framework for this project.',
        color: 'text-emerald-400'
      },
      {
        icon: FileSearch,
        label: 'Document',
        prompt: hasSelection
          ? 'Add clear JSDoc/documentation comments to the selected code. Explain parameters, return values, and purpose.'
          : hasFile
            ? `Add documentation to ${fileName}. Include function docs, module description, and inline comments for complex logic.`
            : 'Help me create documentation for this project.',
        color: 'text-cyan-400'
      }
    ];
  }, [currentFile, selectedCode]);

  const handleQuickAction = (prompt) => {
    sendWithCodeContext(prompt);
  };

  const extractCodeBlocks = useCallback((content) => {
    if (!content) return [{ type: 'text', content: '' }];
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
  }, []);

  const handleApprovePatch = useCallback(async (patchId) => {
    const patch = aiSession.proposedPatches.find(p => p.id === patchId);
    if (!patch) return;

    setApplyingPatch(patchId);
    try {
      // Actually apply the patch via IPC
      // toolApplyPatch expects (projectRoot, patch) per preload signature
      const result = await safeCall('toolApplyPatch', [
        rootPath,
        {
          path: patch.path,
          operation: patch.operation || 'update',
          newContent: patch.content || patch.newContent,
          oldContent: patch.oldContent,
          startLine: patch.startLine,
          endLine: patch.endLine,
        }
      ]);

      if (result?.success) {
        approvePatch(patchId);
        // Refresh the file in the editor if it's open
        const editorStore = useEditorStore.getState();
        const fullPath = patch.path.includes(rootPath) ? patch.path : `${rootPath}/${patch.path}`;
        if (editorStore.openFiles[fullPath] || editorStore.openFiles[patch.path]) {
          // Force re-read from disk
          const filePath = editorStore.openFiles[fullPath] ? fullPath : patch.path;
          // Remove cached content and re-open
          editorStore.closeFileTab(filePath);
          await editorStore.openFile(filePath);
        }
      } else {
        console.error('Patch apply failed:', result?.error);
      }
    } catch (error) {
      console.error('Failed to apply patch:', error);
    } finally {
      setApplyingPatch(null);
    }
  }, [approvePatch, aiSession.proposedPatches, rootPath]);

  const handleRejectPatch = useCallback((patchId) => {
    rejectPatch(patchId, 'User rejected');
  }, [rejectPatch]);

  // Determine project name for display
  const projectName = rootPath ? rootPath.split(/[/\\]/).pop() : null;

  return (
    <div className="flex flex-col h-full border border-forge-border/50 rounded-lg bg-forge-surface/30 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border/30 bg-forge-surface/50">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-workspace-code" />
          <span className="text-sm font-medium text-text-primary">Code Assistant</span>
          {currentModel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-workspace-code/20 text-workspace-code">
              {currentModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAgentMode(!agentMode)}
            title={agentMode ? 'Agent Mode: AI can search & read files autonomously' : 'Chat Mode: AI sees open files only'}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all ${
              agentMode
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-forge-bg/60 text-text-muted border border-forge-border/30 hover:text-text-primary'
            }`}
          >
            <Wrench size={10} />
            {agentMode ? 'Agent' : 'Chat'}
          </button>
        </div>
      </div>
      
      {/* Context Bar - Shows what the AI can see */}
      <ContextBar 
        rootPath={rootPath}
        currentFile={currentFile}
        openFilesList={openFilesList}
        selectedCode={selectedCode}
        selectionStartLine={selectionStartLine}
      />
      
      {/* Session Stats */}
      <SessionStats stats={sessionStats} />

      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 relative"
      >
        {messages.length === 0 && !isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-xl bg-workspace-code/20 flex items-center justify-center mb-3">
              <Code2 size={24} className="text-workspace-code" />
            </div>
            <h3 className="text-sm font-medium text-text-primary mb-1">
              {projectName ? `Working on ${projectName}` : 'Code Assistant'}
            </h3>
            <p className="text-xs text-text-muted mb-4 max-w-[220px]">
              {currentFile 
                ? `I can see ${currentFile.split(/[/\\]/).pop()} and your project structure. Ask me anything.`
                : rootPath
                  ? 'I can see your project structure. Open a file or ask me about the codebase.'
                  : 'Open a project folder to get started, then ask me about your code.'
              }
            </p>
            
            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-1.5 w-full max-w-[260px]">
              {quickActions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-forge-bg/60 border border-forge-border/30 text-text-muted hover:text-text-primary hover:border-workspace-code/40 transition-all text-[11px] group"
                >
                  <action.icon size={12} className={`${action.color} group-hover:scale-110 transition-transform`} />
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
                  className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-workspace-code/15 text-text-primary border border-workspace-code/25'
                      : 'bg-forge-bg/80 text-text-primary border border-forge-border/30'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="space-y-2">
                      {extractCodeBlocks(msg.content).map((part, partIdx) => (
                        part.type === 'code' ? (
                          <CodeBlock 
                            key={partIdx}
                            code={part.content}
                            language={part.language}
                            messageIdx={idx}
                            blockIdx={partIdx}
                            activeFilePath={currentFile}
                          />
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
            
            {/* Tool Call Indicator */}
            {aiSession.currentToolCall && (
              <ToolCallIndicator toolCall={aiSession.currentToolCall} />
            )}
            
            {/* Proposed Patches */}
            {aiSession.proposedPatches.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] text-text-muted font-medium">Proposed Changes</div>
                {aiSession.proposedPatches.map(patch => (
                  <PatchCard 
                    key={patch.id} 
                    patch={patch}
                    onApprove={handleApprovePatch}
                    onReject={handleRejectPatch}
                    isApplying={applyingPatch === patch.id}
                  />
                ))}
              </div>
            )}
            
            {/* Streaming response */}
            {isGenerating && streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[92%] rounded-lg px-3 py-2 bg-forge-bg/80 text-text-primary border border-forge-border/30 text-sm">
                  <div className="space-y-2">
                    {extractCodeBlocks(streamingContent).map((part, partIdx) => (
                      part.type === 'code' ? (
                        <CodeBlock
                          key={partIdx}
                          code={part.content}
                          language={part.language}
                          messageIdx={-1}
                          blockIdx={partIdx}
                          activeFilePath={currentFile}
                        />
                      ) : (
                        <p key={partIdx} className="whitespace-pre-wrap text-[13px] leading-relaxed">
                          {part.content}
                        </p>
                      )
                    ))}
                  </div>
                  <div className="flex items-center gap-1 mt-2 text-workspace-code">
                    <Loader2 size={10} className="animate-spin" />
                    <span className="text-[10px]">Generating...</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Loading indicator (no content yet) */}
            {isGenerating && !streamingContent && !aiSession.currentToolCall && (
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 bg-forge-bg/80 border border-forge-border/30">
                  <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-xs">
                      {agentThinking || 'Analyzing your code...'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
        
        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 p-1.5 rounded-full bg-forge-surface border border-forge-border/50 text-text-muted hover:text-text-primary shadow-lg transition-all"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>

      {/* Selected code indicator */}
      {selectedCode && (
        <div className="px-3 py-1.5 border-t border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <div className="flex items-center gap-1.5 text-amber-400 min-w-0">
              <Hash size={10} />
              <span className="truncate">
                {selectedCode.split('\n').length} lines selected from {currentFile?.split(/[/\\]/).pop() || 'editor'}
              </span>
            </div>
            <span className="text-text-muted/50 flex-shrink-0">Will be sent with your message</span>
          </div>
        </div>
      )}

      {/* Agent mode indicator */}
      {agentMode && (
        <div className="px-3 py-1 border-t border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
            <Wrench size={9} />
            <span>Agent mode — AI will autonomously search code, read files, and propose changes. Type <code className="px-1 py-0.5 rounded bg-amber-500/10">@</code> to reference specific files.</span>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 border-t border-forge-border/30 bg-forge-surface/40">
        <div className="flex items-end gap-2">
          <FileMentionInput
            inputRef={inputRef}
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedCode 
                ? 'Ask about selected code... (@ to mention files)'
                : currentFile 
                  ? `Ask about ${currentFile.split(/[/\\]/).pop()}... (@ to mention files)`
                  : rootPath
                    ? 'Ask about your project... (@ to mention files)'
                    : 'Open a project to get started...'
            }
            disabled={isGenerating || !currentModel}
            projectFiles={projectFiles}
            className="w-full px-3 py-3 text-sm bg-forge-bg/60 border border-forge-border/30 rounded-lg resize-none focus:outline-none focus:border-workspace-code/50 text-text-primary placeholder-text-muted disabled:opacity-50 min-h-[52px] max-h-[180px]"
          />
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
