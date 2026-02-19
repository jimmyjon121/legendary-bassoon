import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Send, 
  Wand2,
  MessageSquare,
  ArrowUp,
  Mic,
  MicOff,
  Paperclip,
  Image,
  Camera,
  Lightbulb,
  Brain,
  X,
  Zap,
  FileText,
  File,
  Film,
  Music,
  Loader2,
  Check,
  ImagePlus,
  ScreenShare,
  Square,
  Globe,
  Cpu,
  Timer,
  ChevronUp,
  Sparkles,
  Settings,
  RefreshCw,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { useModelExperience } from '../../services/modelExperience';

const WEB_SEARCH_PREF_KEY = 'researchWebSearchEnabled';

const QUICK_ACTIONS = [
  { id: 'explain', label: 'Explain this', icon: MessageSquare, prompt: 'Can you explain' },
  { id: 'summarize', label: 'Summarize', icon: ArrowUp, prompt: 'Please summarize' },
  { id: 'brainstorm', label: 'Brainstorm', icon: Lightbulb, prompt: 'Let\'s brainstorm ideas about' },
  { id: 'analyze', label: 'Analyze', icon: Brain, prompt: 'Help me analyze' },
  { id: 'create', label: 'Create', icon: Wand2, prompt: 'Help me create' },
  { id: 'code', label: 'Write code', icon: FileText, prompt: 'Write code that' },
  { id: 'improve', label: 'Improve', icon: Zap, prompt: 'Help me improve' },
];

// File type icons
const FILE_ICONS = {
  image: Image,
  video: Film,
  audio: Music,
  document: FileText,
  default: File
};

function getFileType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return 'document';
  return 'default';
}

export function SmartInput({ onSubmit, disabled = false, onImageGenerate, minimal = false, placeholder }) {
  const [input, setInput] = useState('');
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [isComposing, setIsComposing] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  
  // Voice input state
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef(null);
  
  // Screenshot state
  const [isCapturing, setIsCapturing] = useState(false);
  
  // Image generation state
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  
  // Store subscriptions
  const isGenerating = useAppStore(s => s.isGenerating);
  const stopGeneration = useAppStore(s => s.stopGeneration);
  const currentModel = useAppStore(s => s.currentModel);
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const generationMetadata = useAppStore(s => s.generationMetadata);
  const contextUtilization = useAppStore(s => s.contextUtilization);
  const lastGenerationProfile = useAppStore(s => s.lastGenerationProfile);
  const modelHealthByModel = useAppStore(s => s.modelHealthByModel);
  const stabilityModeByModel = useAppStore(s => s.stabilityModeByModel);
  const runtimeNotice = useAppStore(s => s.runtimeNotice);
  const dismissRuntimeNotice = useAppStore(s => s.dismissRuntimeNotice);
  const recalibration = useAppStore(s => s.recalibration);
  const recalibrateCurrentModel = useAppStore(s => s.recalibrateCurrentModel);
  const modelFamily = useModelExperience(s => s.modelFamily);
  const canUseWebSearch = currentWorkspace === 'research';

  const activeProfile = currentModel && lastGenerationProfile?.model === currentModel
    ? lastGenerationProfile
    : null;
  const modelHealth = currentModel ? modelHealthByModel?.[currentModel] : null;
  const stabilityModeActive = currentModel ? !!stabilityModeByModel?.[currentModel]?.enabled : false;

  // Persist web search preference
  useEffect(() => {
    const saved = localStorage.getItem(WEB_SEARCH_PREF_KEY);
    if (saved === 'true') setWebSearchEnabled(true);
  }, []);

  useEffect(() => {
    if (canUseWebSearch) {
      localStorage.setItem(WEB_SEARCH_PREF_KEY, webSearchEnabled.toString());
    }
  }, [webSearchEnabled, canUseWebSearch]);

  useEffect(() => {
    if (!canUseWebSearch && webSearchEnabled) {
      setWebSearchEnabled(false);
    }
  }, [canUseWebSearch, webSearchEnabled]);

  // Initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';
      
      recognitionRef.current.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setVoiceTranscript(transcript);
        if (event.results[event.results.length - 1].isFinal) {
          setInput(prev => prev + (prev ? ' ' : '') + transcript);
          setVoiceTranscript('');
        }
      };
      
      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
      setVoiceSupported(true);
    }
    
    return () => recognitionRef.current?.stop();
  }, []);

  // Auto-resize input
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // Generate suggestions
  useEffect(() => {
    if (input.length < 3) { setSuggestions([]); return; }
    const timer = setTimeout(() => generateSuggestions(input), 300);
    return () => clearTimeout(timer);
  }, [input, modelFamily]);

  const generateSuggestions = useCallback((text) => {
    const newSuggestions = [];
    if (text.endsWith('how ')) {
      newSuggestions.push('how does this work?', 'how can I improve this?', 'how would you approach this?');
    } else if (text.endsWith('what ')) {
      newSuggestions.push('what do you think about this?', 'what are the alternatives?', 'what would happen if...');
    } else if (text.endsWith('why ')) {
      newSuggestions.push('why is this important?', 'why does this happen?');
    }
    setSuggestions(newSuggestions.slice(0, 4));
  }, [modelFamily]);

  // Voice input
  const toggleVoiceInput = useCallback(() => {
    if (!voiceSupported) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
        setVoiceTranscript('');
      } catch (e) {
        console.error('Could not start voice recognition:', e);
      }
    }
  }, [isListening, voiceSupported]);

  // File attachment
  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
          preview: file.type.startsWith('image/') ? reader.result : null
        }]);
      };
      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsArrayBuffer(file);
        setAttachments(prev => [...prev, {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name, type: file.type, size: file.size, data: null, preview: null
        }]);
      }
    });
    e.target.value = '';
  }, []);

  const handleImageSelect = useCallback((e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, {
          id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name, type: file.type, size: file.size,
          data: reader.result, preview: reader.result, isImage: true
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // Screenshot capture
  const handleScreenshotCapture = useCallback(async () => {
    if (!window.electronAPI?.captureScreenshot) {
      try {
        setIsCapturing(true);
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { mediaSource: 'screen' } });
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        stream.getTracks().forEach(track => track.stop());
        setAttachments(prev => [...prev, {
          id: `screenshot-${Date.now()}`,
          name: `Screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`,
          type: 'image/png', data: dataUrl, preview: dataUrl, isImage: true, isScreenshot: true
        }]);
        setIsCapturing(false);
      } catch (e) {
        setIsCapturing(false);
      }
    } else {
      try {
        setIsCapturing(true);
        const screenshot = await window.electronAPI.captureScreenshot();
        if (screenshot) {
          setAttachments(prev => [...prev, {
            id: `screenshot-${Date.now()}`,
            name: `Screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`,
            type: 'image/png', data: screenshot, preview: screenshot, isImage: true, isScreenshot: true
          }]);
        }
        setIsCapturing(false);
      } catch (e) {
        setIsCapturing(false);
      }
    }
  }, []);

  // Image generation
  const handleImageGenerate = useCallback(() => setShowImagePrompt(true), []);
  const submitImageGeneration = useCallback(() => {
    if (!imagePrompt.trim()) return;
    if (onImageGenerate) {
      onImageGenerate(imagePrompt.trim());
    } else {
      setInput(`Generate an image: ${imagePrompt.trim()}`);
    }
    setShowImagePrompt(false);
    setImagePrompt('');
  }, [imagePrompt, onImageGenerate]);

  // Submit handler
  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!input.trim() || disabled || isGenerating || isComposing) return;
    const finalInput = input.trim();
    setInput('');
    setSuggestions([]);
    setSelectedSuggestion(-1);
    
    onSubmit(finalInput, { 
      attachments: attachments.map(a => ({
        id: a.id, name: a.name, type: a.type, size: a.size,
        data: a.data, isImage: a.isImage, isScreenshot: a.isScreenshot
      })),
      webSearchEnabled: canUseWebSearch ? webSearchEnabled : false,
    });
    setAttachments([]);
  };

  const handleStop = useCallback(async (e) => {
    e?.preventDefault();
    try { await stopGeneration?.(); } catch (err) {
      console.error('Failed to stop generation:', err);
    }
  }, [stopGeneration]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        setInput(suggestions[selectedSuggestion]);
        setSelectedSuggestion(-1);
        setSuggestions([]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setSelectedSuggestion(prev => prev <= 0 ? suggestions.length - 1 : prev - 1);
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setSelectedSuggestion(prev => prev >= suggestions.length - 1 ? 0 : prev + 1);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setSelectedSuggestion(-1);
    }
  };

  const handleQuickAction = (action) => {
    const newInput = input ? `${action.prompt} ${input}` : action.prompt + ' ';
    setInput(newInput);
    setShowQuickActions(false);
    inputRef.current?.focus();
  };

  const handleRecalibrate = useCallback(async () => {
    if (!currentModel || recalibration?.running || isGenerating) return;
    await recalibrateCurrentModel?.();
  }, [currentModel, recalibration?.running, isGenerating, recalibrateCurrentModel]);

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Compute generation stats for display
  const genStats = isGenerating && generationMetadata?.stage === 'generating' ? {
    tokens: generationMetadata.tokensEstimated || 0,
    speed: generationMetadata.tokensPerSecond || 0,
    elapsed: generationMetadata.startedAt 
      ? Math.round((Date.now() - generationMetadata.startedAt) / 1000)
      : 0,
  } : null;

  if (minimal) {
    return (
      <div className="relative">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={placeholder || "Type your message..."}
          disabled={disabled}
          rows={1}
          className="w-full px-4 py-2.5 bg-transparent text-text-primary placeholder-text-muted resize-none focus:outline-none scrollbar-hide"
          style={{ maxHeight: '150px' }}
        />
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect}
        accept=".txt,.pdf,.doc,.docx,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.java,.c,.cpp,.h,.hpp,.rb,.go,.rs,.swift,.kt" />
      <input ref={imageInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleImageSelect} />

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 bg-surface-1 border border-border-subtle rounded-xl shadow-xl overflow-hidden z-20">
            {suggestions.map((suggestion, index) => (
              <button key={suggestion}
                onClick={() => { setInput(suggestion); setSuggestions([]); setSelectedSuggestion(-1); inputRef.current?.focus(); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  index === selectedSuggestion ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                }`}>
                {suggestion}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice transcript indicator */}
      <AnimatePresence>
        {isListening && voiceTranscript && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm text-red-400 italic">{voiceTranscript}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image generation prompt modal */}
      <AnimatePresence>
        {showImagePrompt && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 p-4 bg-surface-1 border border-border-subtle rounded-xl shadow-xl z-30">
            <div className="flex items-center gap-2 mb-3">
              <ImagePlus size={18} className="text-accent-primary" />
              <span className="font-medium text-text-primary">Generate Image</span>
              <button onClick={() => setShowImagePrompt(false)} className="ml-auto p-1 hover:bg-surface-2 rounded-lg">
                <X size={16} className="text-text-muted" />
              </button>
            </div>
            <div className="flex gap-2">
              <input type="text" value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitImageGeneration()}
                placeholder="Describe the image you want to generate..."
                className="flex-1 px-3 py-2 bg-surface-2 border border-border-subtle rounded-lg text-text-primary placeholder-text-muted outline-none focus:border-accent-primary/50" autoFocus />
              <button onClick={submitImageGeneration} disabled={!imagePrompt.trim()}
                className="px-4 py-2 bg-accent-primary disabled:opacity-50 rounded-lg text-white font-medium">
                Generate
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Actions popup */}
      <AnimatePresence>
        {showQuickActions && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowQuickActions(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute bottom-full left-0 mb-2 bg-surface-1 border border-border-subtle rounded-xl shadow-xl p-2 min-w-[200px] z-50">
              <div className="text-[10px] text-text-muted px-3 py-1 mb-1 uppercase tracking-wider">Quick Actions</div>
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button key={action.id} onClick={() => handleQuickAction(action)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors">
                    <Icon size={14} className="text-text-muted" />
                    <span className="text-sm">{action.label}</span>
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Generation stats bar (visible during generation) */}
      <AnimatePresence>
        {genStats && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mb-2 overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-2 bg-accent-primary/8 border border-accent-primary/15 rounded-xl">
              <div className="flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin text-accent-primary" />
                <span className="text-xs font-medium text-accent-primary">Generating</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1"><Sparkles size={11} />{genStats.tokens} tokens</span>
                <span className="flex items-center gap-1"><Zap size={11} className="text-amber-400" />{genStats.speed} tok/s</span>
                <span className="flex items-center gap-1"><Timer size={11} />{genStats.elapsed}s</span>
              </div>
              <button onClick={handleStop}
                className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium transition-colors">
                <Square size={11} />
                Stop
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Runtime notice (auto stability / recalibration updates) */}
      <AnimatePresence>
        {runtimeNotice && runtimeNotice.model === currentModel && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="mb-2"
          >
            <div className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border ${
              runtimeNotice.type === 'warning'
                ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
            }`}>
              {runtimeNotice.type === 'warning'
                ? <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
                : <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{runtimeNotice.title}</div>
                <div className="text-[11px] opacity-90">{runtimeNotice.message}</div>
              </div>
              <button
                type="button"
                onClick={dismissRuntimeNotice}
                className="p-1 rounded-md hover:bg-black/20 transition-colors"
                title="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment previews */}
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex gap-2 flex-wrap">
            {attachments.map((attachment) => {
              const FileIcon = FILE_ICONS[getFileType(attachment.type)] || FILE_ICONS.default;
              return (
                <motion.div key={attachment.id} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
                  className="relative group">
                  {attachment.preview ? (
                    <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border-subtle">
                      <img src={attachment.preview} alt={attachment.name} className="w-full h-full object-cover" />
                      {attachment.isScreenshot && (
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-white/80">
                          <ScreenShare size={10} className="inline mr-1" />SS
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-border-subtle rounded-lg">
                      <FileIcon size={16} className="text-accent-primary" />
                      <div className="max-w-[120px]">
                        <p className="text-xs text-text-primary truncate">{attachment.name}</p>
                        <p className="text-[10px] text-text-muted">{formatSize(attachment.size)}</p>
                      </div>
                    </div>
                  )}
                  <button onClick={() => removeAttachment(attachment.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={12} className="text-white" />
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main input container */}
      <div className="relative rounded-xl bg-surface-1 border border-border-subtle focus-within:border-accent-primary/40 transition-colors shadow-sm">
        {/* Textarea */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={isListening ? "Listening... speak now" : placeholder || "Type your message..."}
          disabled={disabled}
          rows={1}
          className={`w-full pl-4 pr-4 py-3 bg-transparent text-text-primary placeholder-text-muted resize-none focus:outline-none scrollbar-hide ${
            isListening ? 'placeholder-red-400' : ''
          }`}
          style={{ maxHeight: '200px' }}
        />

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border-subtle/50">
          {/* Left side: feature toggles */}
          <div className="flex items-center gap-0.5">
            {/* Web Search Toggle */}
            {canUseWebSearch && (
              <motion.button
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  webSearchEnabled 
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25' 
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-2 border border-transparent'
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                title={webSearchEnabled ? "Web search enabled - click to disable" : "Enable web search"}
              >
                <Globe size={14} />
                <span className="hidden sm:inline">Search</span>
              </motion.button>
            )}

            {/* Quick actions */}
            <motion.button
              onClick={() => setShowQuickActions(!showQuickActions)}
              className={`p-1.5 rounded-lg transition-colors ${
                showQuickActions ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Quick actions"
            >
              <Wand2 size={16} />
            </motion.button>

            <div className="w-px h-4 bg-border-subtle mx-0.5" />

            {/* Voice input */}
            <motion.button
              onClick={toggleVoiceInput}
              className={`p-1.5 rounded-lg transition-colors ${
                isListening ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40' 
                : voiceSupported ? 'text-text-muted hover:text-text-secondary hover:bg-surface-2' : 'text-text-muted/30 cursor-not-allowed'
              }`}
              whileHover={voiceSupported ? { scale: 1.05 } : {}}
              whileTap={voiceSupported ? { scale: 0.95 } : {}}
              title={isListening ? "Stop listening" : "Voice input"}
              disabled={!voiceSupported}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </motion.button>

            {/* File attachment */}
            <motion.button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Attach file"
            >
              <Paperclip size={16} />
            </motion.button>

            {/* Image upload */}
            <motion.button
              onClick={() => imageInputRef.current?.click()}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Attach image"
            >
              <Image size={16} />
            </motion.button>

            {/* Screenshot capture */}
            <motion.button
              onClick={handleScreenshotCapture}
              disabled={isCapturing}
              className={`p-1.5 rounded-lg transition-colors ${
                isCapturing ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Capture screenshot"
            >
              {isCapturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            </motion.button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right side: send/stop */}
          <motion.button
            onClick={isGenerating ? handleStop : handleSubmit}
            disabled={isGenerating ? false : ((!input.trim() && attachments.length === 0) || disabled)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-sm font-medium
              ${isGenerating 
                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
                : (input.trim() || attachments.length > 0) && !disabled
                  ? 'bg-accent-primary hover:bg-accent-primary/90 text-white shadow-sm shadow-accent-primary/20'
                  : 'bg-surface-2 text-text-muted cursor-not-allowed'
              }
            `}
            whileHover={(isGenerating || (input.trim() || attachments.length > 0)) && !disabled ? { scale: 1.02 } : {}}
            whileTap={(isGenerating || (input.trim() || attachments.length > 0)) && !disabled ? { scale: 0.98 } : {}}
          >
            {isGenerating ? (
              <><Square size={14} /><span>Stop</span></>
            ) : (
              <><Send size={14} /><span className="hidden sm:inline">Send</span></>
            )}
          </motion.button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-1.5 px-1">
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          {currentModel && (
            <span className="flex items-center gap-1.5">
              <Cpu size={11} className="text-accent-primary" />
              <span className="text-text-secondary truncate max-w-[180px]">{currentModel}</span>
            </span>
          )}
          {activeProfile && (
            <span
              className="flex items-center gap-1 text-sky-400"
              title={`Auto profile: ${activeProfile.mode} | ctx ${activeProfile.num_ctx ?? 'auto'} | predict ${activeProfile.num_predict ?? 'auto'} | temp ${activeProfile.temperature ?? 'auto'} | repeat ${activeProfile.repeat_penalty ?? 'auto'}`}
            >
              <Settings size={10} />
              Auto {activeProfile.mode === 'compat-generate' ? 'compat' : 'chat'}
            </span>
          )}
          {modelHealth?.status && (
            <span className={`flex items-center gap-1 ${
              modelHealth.status === 'stable'
                ? 'text-emerald-400'
                : modelHealth.status === 'warning'
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                modelHealth.status === 'stable'
                  ? 'bg-emerald-400'
                  : modelHealth.status === 'warning'
                    ? 'bg-amber-400'
                    : 'bg-red-400'
              }`} />
              {modelHealth.status === 'stable' ? 'Stable' : modelHealth.status === 'warning' ? 'Guarded' : 'Unstable'}
            </span>
          )}
          {stabilityModeActive && (
            <span className="flex items-center gap-1 text-amber-400">
              <ShieldAlert size={10} />
              Stability mode
            </span>
          )}
          {contextUtilization?.utilizationPercent > 0 && (
            <span className="flex items-center gap-1">
              <span className="text-text-muted">Context:</span>
              <span className={`font-medium ${
                contextUtilization.utilizationPercent > 80 ? 'text-red-400' :
                contextUtilization.utilizationPercent > 50 ? 'text-amber-400' : 'text-emerald-400'
              }`}>
                {contextUtilization.utilizationPercent}%
              </span>
            </span>
          )}
          {canUseWebSearch && webSearchEnabled && (
            <span className="flex items-center gap-1 text-blue-400">
              <Globe size={10} />
              Web search on
            </span>
          )}
          {attachments.length > 0 && (
            <span className="flex items-center gap-1 text-accent-primary">
              <Paperclip size={10} />
              {attachments.length} file{attachments.length > 1 ? 's' : ''}
            </span>
          )}
          {isListening && (
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              Listening
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRecalibrate}
            disabled={!currentModel || recalibration?.running || isGenerating}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border transition-colors ${
              !currentModel || recalibration?.running || isGenerating
                ? 'text-text-muted/40 border-border-subtle/40 cursor-not-allowed'
                : 'text-text-muted hover:text-text-secondary border-border-subtle hover:border-border-muted hover:bg-surface-2'
            }`}
            title={currentModel ? 'Run quick model stability probe' : 'Select a model first'}
          >
            {recalibration?.running
              ? <Loader2 size={10} className="animate-spin" />
              : <RefreshCw size={10} />}
            <span>{recalibration?.running ? 'Calibrating' : 'Recalibrate'}</span>
          </button>
          <span className="text-[10px] text-text-muted/60">
            Shift+Enter new line
          </span>
        </div>
      </div>
    </div>
  );
}

export default SmartInput;
