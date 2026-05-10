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
  Square,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useEditorStore } from '../../stores/editorStore';
import { api, safeCall, isElectron } from '../../utils/electronAPI';
import { FileMentionInput, parseMentions } from './FileMentionInput';
import { ToolEnabledLLM } from '../../services/toolEnabledLLM';
import { ChatV2Engine } from '../../chat-v2/engine/chatEngine';
import { createElectronRuntimeAdapter } from '../../chat-v2/runtime/createElectronRuntimeAdapter';
import { buildChatV2InferenceOptions } from '../../chat-v2/runtime/buildInferenceOptions';
import { shallow } from 'zustand/shallow';

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
              <span className="text-text-muted/50 ml-1">(active)</span>
            </div>
          )}
          {openFilesList && openFilesList.length > 1 && (
            <div className="flex items-center gap-1">
              <Eye size={9} className="text-blue-400" />
              <span>{openFilesList.length} open files</span>
            </div>
          )}
          {selectedCode && (
            <div className="flex items-center gap-1">
              <Hash size={9} className="text-amber-400" />
              <span>Selection from line {selectionStartLine}: {selectedCode.split('\n').length} lines</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

function CodeBlock({ code, language, activeFilePath }) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleApplyToFile = async () => {
    if (!activeFilePath) return;
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

function useCodeChatEngine(currentModel) {
  const engineRef = useRef(null);
  const [chatState, setChatState] = useState(null);

  const engine = useMemo(() => {
    if (engineRef.current) engineRef.current.destroy();
    const runtime = createElectronRuntimeAdapter({
      workspace: 'code',
      getWorkspace: () => 'code',
      getInferenceOptions: async (request = {}) => {
        const state = useAppStore.getState();
        return buildChatV2InferenceOptions({
          model: request.model || state.currentModel,
          workspace: 'code',
        });
      },
    });
    const eng = new ChatV2Engine(runtime, { workspace: 'code', model: currentModel || null });
    engineRef.current = eng;
    return eng;
    // Only re-create if the hook remounts, not on model change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = engine.subscribe(setChatState);
    return unsub;
  }, [engine]);

  useEffect(() => {
    if (currentModel) engine.setModel(currentModel);
  }, [engine, currentModel]);

  useEffect(() => {
    return () => engine.destroy();
  }, [engine]);

  return { engine, chatState: chatState || engine.getState() };
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
  onExtractPlan: _onExtractPlan,
}) {
  const [input, setInput] = useState('');
  const [applyingPatch, setApplyingPatch] = useState(null);
  const [agentMode, setAgentMode] = useState(false);
  const [agentThinking, setAgentThinking] = useState(null);
  const [agentMessages, setAgentMessages] = useState([]);
  const [agentGenerating, setAgentGenerating] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const toolLLMRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const currentModel = useAppStore((s) => s.currentModel);
  const listPromotedResearchContext = useAppStore((s) => s.listPromotedResearchContext);

  const { engine, chatState } = useCodeChatEngine(currentModel);

  const messages = agentMode ? agentMessages : chatState.messages;
  const isGenerating = agentMode ? agentGenerating : chatState.isGenerating;
  const streamingContent = agentMode ? '' : chatState.streamingContent;

  const {
    aiSession,
    startAISession,
    approvePatch,
    rejectPatch,
    getAISessionStats,
  } = useEditorStore((state) => ({
    aiSession: state.aiSession,
    startAISession: state.startAISession,
    approvePatch: state.approvePatch,
    rejectPatch: state.rejectPatch,
    getAISessionStats: state.getAISessionStats,
  }), shallow);

  const sessionStats = getAISessionStats();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isGenerating) scrollToBottom();
  }, [streamingContent, isGenerating, scrollToBottom]);

  useEffect(() => { scrollToBottom(); }, [messages.length, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  useEffect(() => {
    if (!aiSession.sessionId) startAISession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveMentions = useCallback(async (text) => {
    const mentions = parseMentions(text);
    if (mentions.length === 0) return text;

    const mentionContents = [];
    for (const mention of mentions) {
      try {
        const fullPath = mention.path.includes(rootPath)
          ? mention.path
          : `${rootPath}/${mention.path}`.replace(/\\/g, '/');
        const content = await api.readFileScoped(fullPath, rootPath)
          || await safeCall('toolReadFile', [rootPath, mention.path], null);

        if (content?.content || (typeof content === 'string' && content)) {
          const fileContent = content?.content || content;
          const lines = fileContent.split('\n');
          const truncated = lines.length > 500
            ? lines.slice(0, 400).join('\n') + `\n// ... ${lines.length - 400} more lines ...`
            : fileContent;
          mentionContents.push(`\n\n--- File: ${mention.path} (${lines.length} lines) ---\n\`\`\`\n${truncated}\n\`\`\``);
        }
      } catch {
        mentionContents.push(`\n\n--- File: ${mention.path} (failed to read) ---`);
      }
    }

    let cleanText = text;
    for (const m of mentions) {
      cleanText = cleanText.replace(m.fullMatch, '').trim();
    }
    return cleanText + mentionContents.join('');
  }, [rootPath]);

  const buildCodePrompt = useCallback((prompt) => {
    let enhanced = prompt;
    if (selectedCode) {
      const lineInfo = selectionStartLine ? ` (starting at line ${selectionStartLine})` : '';
      enhanced = `${enhanced}\n\nSelected code${lineInfo}:\n\`\`\`\n${selectedCode}\n\`\`\``;
    }
    if (currentFile && currentFileContent) {
      const lines = currentFileContent.split('\n');
      const truncated = lines.length > 300
        ? lines.slice(0, 250).join('\n') + `\n// ... ${lines.length - 250} more lines ...`
        : currentFileContent;
      enhanced = `${enhanced}\n\n[Active file: ${currentFile}]\n\`\`\`\n${truncated}\n\`\`\``;
    }
    return enhanced;
  }, [selectedCode, selectionStartLine, currentFile, currentFileContent]);

  const handleStop = useCallback(() => {
    if (agentMode) {
      if (toolLLMRef.current?.abort) toolLLMRef.current.abort();
      setAgentGenerating(false);
      setAgentThinking(null);
    } else {
      engine.stop();
    }
  }, [agentMode, engine]);

  const handleSend = async () => {
    if (!input.trim()) return;

    let prompt = await resolveMentions(input);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    if (isGenerating) {
      handleStop();
      await new Promise(r => setTimeout(r, 50));
    }

    if (agentMode && rootPath && currentModel && isElectron()) {
      await handleAgentSend(prompt);
    } else {
      const enhanced = buildCodePrompt(prompt);
      await engine.sendUserMessage(enhanced);
    }
  };

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
        onThinking: (status) => { setAgentThinking(status); },
      });
    }

    const userMsg = { id: `user_${Date.now()}`, role: 'user', content: prompt };
    setAgentMessages((prev) => [...prev, userMsg]);
    setAgentGenerating(true);

    try {
      setAgentThinking('Analyzing your request...');
      const history = agentMessages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
      const result = await toolLLMRef.current.chat(promptWithContext, history);

      const assistantMsg = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: result.content,
        meta: { filesRead: result.filesRead, toolCalls: result.toolCalls.length, iterations: result.iterations },
      };
      setAgentMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      const errorMsg = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${error.message}\n\nTry turning off Agent mode, or switch to a model that supports tools (Llama 3.1+, Mistral, Qwen 2.5).`,
      };
      setAgentMessages((prev) => [...prev, errorMsg]);
    } finally {
      setAgentGenerating(false);
      setAgentThinking(null);
    }
  }, [currentModel, rootPath, agentMessages, listPromotedResearchContext]);

  const handleKeyDown = (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) handleSend();
    }
    if (e.key === 'Escape' && isGenerating) {
      e.preventDefault();
      handleStop();
    }
  };

  const quickActions = useMemo(() => {
    const hasFile = !!currentFile;
    const hasSelection = !!selectedCode;
    const fileName = currentFile?.split(/[/\\]/).pop() || 'this code';

    return [
      {
        icon: Bug, label: 'Find Bugs', color: 'text-red-400',
        prompt: hasSelection
          ? 'Review the selected code and identify any bugs, issues, or potential problems.'
          : hasFile ? `Review ${fileName} and identify any bugs or issues.`
          : 'What bugs should I look out for in this project?',
      },
      {
        icon: Zap, label: 'Improve Ideas', color: 'text-amber-400',
        prompt: hasSelection
          ? 'Suggest safe improvements for the selected code without editing it.'
          : hasFile ? `Suggest safe improvements for ${fileName} without editing it.`
          : 'What are the main improvement opportunities in this project?',
      },
      {
        icon: Lightbulb, label: 'Explain', color: 'text-blue-400',
        prompt: hasSelection
          ? 'Explain what the selected code does step by step.'
          : hasFile ? `Explain what ${fileName} does.`
          : 'Give me an overview of this project.',
      },
      {
        icon: FileSearch, label: 'Project Map', color: 'text-cyan-400',
        prompt: hasSelection
          ? 'Explain where this selected code fits in the project.'
          : hasFile ? `Explain where ${fileName} fits in the project.`
          : 'Map the important files and folders in this project.',
      },
    ];
  }, [currentFile, selectedCode]);

  const handleQuickAction = async (prompt) => {
    const enhanced = buildCodePrompt(prompt);
    await engine.sendUserMessage(enhanced);
  };

  const extractCodeBlocks = useCallback((content) => {
    if (!content) return [{ type: 'text', content: '' }];
    const re = /```(\w+)?\n([\s\S]*?)```/g;
    const parts = [];
    let last = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      if (match.index > last) parts.push({ type: 'text', content: content.slice(last, match.index) });
      parts.push({ type: 'code', language: match[1] || 'plaintext', content: match[2] });
      last = match.index + match[0].length;
    }
    if (last < content.length) parts.push({ type: 'text', content: content.slice(last) });
    return parts.length > 0 ? parts : [{ type: 'text', content }];
  }, []);

  const handleApprovePatch = useCallback(async (patchId) => {
    const patch = aiSession.proposedPatches.find((p) => p.id === patchId);
    if (!patch) return;
    setApplyingPatch(patchId);
    try {
      const result = await safeCall('toolApplyPatch', [rootPath, {
        path: patch.path,
        operation: patch.operation || 'update',
        newContent: patch.content || patch.newContent,
        oldContent: patch.oldContent,
        startLine: patch.startLine,
        endLine: patch.endLine,
      }]);
      if (result?.success) {
        approvePatch(patchId);
        const editorStore = useEditorStore.getState();
        const fullPath = patch.path.includes(rootPath) ? patch.path : `${rootPath}/${patch.path}`;
        if (editorStore.openFiles[fullPath] || editorStore.openFiles[patch.path]) {
          const filePath = editorStore.openFiles[fullPath] ? fullPath : patch.path;
          editorStore.closeFileTab(filePath);
          await editorStore.openFile(filePath);
        }
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

      <ContextBar
        rootPath={rootPath}
        currentFile={currentFile}
        openFilesList={openFilesList}
        selectedCode={selectedCode}
        selectionStartLine={selectionStartLine}
      />

      {agentMode && sessionStats.sessionId && (
        <div className="flex items-center gap-3 px-2 py-1 text-[10px] text-text-muted border-b border-forge-border/20">
          <span className="flex items-center gap-1"><Eye size={10} />{sessionStats.filesRead} files</span>
          <span className="flex items-center gap-1"><Wrench size={10} />{sessionStats.toolCalls} tools</span>
          {sessionStats.pendingPatches > 0 && (
            <span className="flex items-center gap-1 text-amber-400"><AlertCircle size={10} />{sessionStats.pendingPatches} pending</span>
          )}
          {sessionStats.appliedPatches > 0 && (
            <span className="flex items-center gap-1 text-green-400"><CheckCircle size={10} />{sessionStats.appliedPatches} applied</span>
          )}
        </div>
      )}

      {/* Messages */}
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
                ? `I can see ${currentFile.split(/[/\\]/).pop()} and your project. Ask me anything.`
                : rootPath
                  ? 'I can see your project structure. Open a file or ask me about the codebase.'
                  : 'Open a project folder to get started.'}
            </p>
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
              <div key={msg.id || idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-workspace-code/15 text-text-primary border border-workspace-code/25'
                    : 'bg-forge-bg/80 text-text-primary border border-forge-border/30'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="space-y-2">
                      {extractCodeBlocks(msg.content).map((part, pi) => (
                        part.type === 'code' ? (
                          <CodeBlock key={pi} code={part.content} language={part.language} activeFilePath={currentFile} />
                        ) : (
                          <p key={pi} className="whitespace-pre-wrap text-[13px] leading-relaxed">{part.content}</p>
                        )
                      ))}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-[13px]">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {aiSession.currentToolCall && <ToolCallIndicator toolCall={aiSession.currentToolCall} />}

            {aiSession.proposedPatches.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] text-text-muted font-medium">Proposed Changes</div>
                {aiSession.proposedPatches.map((patch) => (
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

            {isGenerating && streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[92%] rounded-lg px-3 py-2 bg-forge-bg/80 text-text-primary border border-forge-border/30 text-sm">
                  <div className="space-y-2">
                    {extractCodeBlocks(streamingContent).map((part, pi) => (
                      part.type === 'code' ? (
                        <CodeBlock key={pi} code={part.content} language={part.language} activeFilePath={currentFile} />
                      ) : (
                        <p key={pi} className="whitespace-pre-wrap text-[13px] leading-relaxed">{part.content}</p>
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

            {isGenerating && !streamingContent && !aiSession.currentToolCall && (
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 bg-forge-bg/80 border border-forge-border/30">
                  <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-xs">{agentThinking || 'Thinking...'}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />

        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 p-1.5 rounded-full bg-forge-surface border border-forge-border/50 text-text-muted hover:text-text-primary shadow-lg transition-all"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>

      {selectedCode && (
        <div className="px-3 py-1.5 border-t border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <div className="flex items-center gap-1.5 text-amber-400 min-w-0">
              <Hash size={10} />
              <span className="truncate">
                {selectedCode.split('\n').length} lines selected from {currentFile?.split(/[/\\]/).pop() || 'editor'}
              </span>
            </div>
            <span className="text-text-muted/50 flex-shrink-0">Included with your message</span>
          </div>
        </div>
      )}

      {agentMode && (
        <div className="px-3 py-1 border-t border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
            <Wrench size={9} />
            <span>Agent mode — AI will search code, read files, and propose changes. Type <code className="px-1 py-0.5 rounded bg-amber-500/10">@</code> to reference files.</span>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-forge-border/30 bg-forge-surface/40">
        <div className="flex items-end gap-2">
          <FileMentionInput
            inputRef={inputRef}
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            placeholder={
              isGenerating
                ? 'Type to steer the AI... (Enter to redirect)'
                : selectedCode
                  ? 'Ask about selected code... (@ to mention files)'
                  : currentFile
                    ? `Ask about ${currentFile.split(/[/\\]/).pop()}... (@ to mention files)`
                    : rootPath
                      ? 'Ask about your project... (@ to mention files)'
                      : 'Open a project to get started...'
            }
            disabled={false}
            projectFiles={projectFiles}
            className="w-full px-3 py-3 text-sm bg-forge-bg/60 border border-forge-border/30 rounded-lg resize-none focus:outline-none focus:border-workspace-code/50 text-text-primary placeholder-text-muted min-h-[52px] max-h-[180px]"
          />
          {isGenerating && (
            <button
              onClick={handleStop}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
              title="Stop generation"
            >
              <Square size={18} />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() || !currentModel}
            className={`p-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              isGenerating && input.trim()
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-workspace-code hover:bg-workspace-code/80'
            }`}
            title={isGenerating && input.trim() ? 'Steer conversation' : 'Send message'}
          >
            <Send size={18} />
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
