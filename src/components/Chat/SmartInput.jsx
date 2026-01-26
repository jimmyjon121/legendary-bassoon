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
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { useModelExperience } from '../../services/modelExperience';

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

// Get file type category
function getFileType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return 'document';
  return 'default';
}

export function SmartInput({ onSubmit, disabled = false, onImageGenerate }) {
  const [input, setInput] = useState('');
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [isComposing, setIsComposing] = useState(false);
  const [attachments, setAttachments] = useState([]);
  
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
  
  // Use selective subscriptions for optimal re-render performance
  const isGenerating = useAppStore(s => s.isGenerating);
  const stopGeneration = useAppStore(s => s.stopGeneration);
  const currentModel = useAppStore(s => s.currentModel);
  const modelFamily = useModelExperience(s => s.modelFamily);

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
        
        // If this is a final result, append to input
        if (event.results[event.results.length - 1].isFinal) {
          setInput(prev => prev + (prev ? ' ' : '') + transcript);
          setVoiceTranscript('');
        }
      };
      
      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };
      
      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
      
      setVoiceSupported(true);
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Auto-resize input
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // Generate suggestions as user types
  useEffect(() => {
    if (input.length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      generateSuggestions(input);
    }, 300);

    return () => clearTimeout(timer);
  }, [input, modelFamily]);

  const generateSuggestions = useCallback((text) => {
    const newSuggestions = [];
    
    // Context-aware completions
    if (text.endsWith('how ')) {
      newSuggestions.push(
        'how does this work?',
        'how can I improve this?',
        'how would you approach this?'
      );
    } else if (text.endsWith('what ')) {
      newSuggestions.push(
        'what do you think about this?',
        'what are the alternatives?',
        'what would happen if...'
      );
    } else if (text.endsWith('why ')) {
      newSuggestions.push(
        'why is this important?',
        'why does this happen?',
        'why should I consider this?'
      );
    } else if (text.includes('help')) {
      newSuggestions.push(
        'help me understand this concept',
        'help me solve this problem',
        'help me brainstorm solutions'
      );
    }
    
    // Add model-aware suggestions
    if (modelFamily === 'code' && text.length > 5) {
      newSuggestions.push(
        'write a function that...',
        'explain this code:',
        'fix the bug in...'
      );
    } else if (modelFamily === 'creative' && text.length > 5) {
      newSuggestions.push(
        'write a story about...',
        'describe a scene where...',
        'create a character that...'
      );
    }
    
    setSuggestions(newSuggestions.slice(0, 5));
  }, [modelFamily]);

  // ==================== VOICE INPUT ====================
  const toggleVoiceInput = useCallback(() => {
    if (!voiceSupported) {
      alert('Voice input is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    
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

  // ==================== FILE ATTACHMENT ====================
  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
      // Read file and create attachment object
      const reader = new FileReader();
      reader.onload = () => {
        const attachment = {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
          preview: file.type.startsWith('image/') ? reader.result : null
        };
        setAttachments(prev => [...prev, attachment]);
      };
      
      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsArrayBuffer(file);
        // For non-images, create attachment without preview
        const attachment = {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          data: null,
          preview: null
        };
        setAttachments(prev => [...prev, attachment]);
      }
    });
    
    // Reset input
    e.target.value = '';
  }, []);

  const handleImageSelect = useCallback((e) => {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      
      const reader = new FileReader();
      reader.onload = () => {
        const attachment = {
          id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
          preview: reader.result,
          isImage: true
        };
        setAttachments(prev => [...prev, attachment]);
      };
      reader.readAsDataURL(file);
    });
    
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // ==================== SCREENSHOT CAPTURE ====================
  const handleScreenshotCapture = useCallback(async () => {
    if (!window.electronAPI?.captureScreenshot) {
      // Fallback to browser screenshot API if available
      try {
        setIsCapturing(true);
        
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { mediaSource: 'screen' }
        });
        
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        
        const dataUrl = canvas.toDataURL('image/png');
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        const attachment = {
          id: `screenshot-${Date.now()}`,
          name: `Screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`,
          type: 'image/png',
          data: dataUrl,
          preview: dataUrl,
          isImage: true,
          isScreenshot: true
        };
        
        setAttachments(prev => [...prev, attachment]);
        setIsCapturing(false);
      } catch (e) {
        console.error('Screenshot capture failed:', e);
        setIsCapturing(false);
        alert('Screenshot capture was cancelled or failed.');
      }
    } else {
      // Use Electron's native screenshot
      try {
        setIsCapturing(true);
        const screenshot = await window.electronAPI.captureScreenshot();
        
        if (screenshot) {
          const attachment = {
            id: `screenshot-${Date.now()}`,
            name: `Screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`,
            type: 'image/png',
            data: screenshot,
            preview: screenshot,
            isImage: true,
            isScreenshot: true
          };
          setAttachments(prev => [...prev, attachment]);
        }
        setIsCapturing(false);
      } catch (e) {
        console.error('Screenshot capture failed:', e);
        setIsCapturing(false);
      }
    }
  }, []);

  // ==================== IMAGE GENERATION ====================
  const handleImageGenerate = useCallback(() => {
    setShowImagePrompt(true);
  }, []);

  const submitImageGeneration = useCallback(() => {
    if (!imagePrompt.trim()) return;
    
    // Call the image generation handler
    if (onImageGenerate) {
      onImageGenerate(imagePrompt.trim());
    } else {
      // If no handler, add as a prompt to generate image
      setInput(`Generate an image: ${imagePrompt.trim()}`);
    }
    
    setShowImagePrompt(false);
    setImagePrompt('');
  }, [imagePrompt, onImageGenerate]);

  // ==================== SUBMIT HANDLER ====================
  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!input.trim() || disabled || isGenerating || isComposing) return;
    
    const finalInput = input.trim();
    
    setInput('');
    setSuggestions([]);
    setSelectedSuggestion(-1);
    
    // Include attachments with submission
    onSubmit(finalInput, { 
      attachments: attachments.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        size: a.size,
        data: a.data,
        isImage: a.isImage,
        isScreenshot: a.isScreenshot
      }))
    });
    setAttachments([]);
  };

  const handleStop = useCallback(async (e) => {
    e?.preventDefault();
    try {
      await stopGeneration?.();
    } catch (err) {
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
      setSelectedSuggestion(prev => 
        prev <= 0 ? suggestions.length - 1 : prev - 1
      );
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setSelectedSuggestion(prev => 
        prev >= suggestions.length - 1 ? 0 : prev + 1
      );
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

  // Format file size
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="relative">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
        accept=".txt,.pdf,.doc,.docx,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.java,.c,.cpp,.h,.hpp,.rb,.go,.rs,.swift,.kt"
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleImageSelect}
      />

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 bg-forge-surface border border-forge-border rounded-lg shadow-xl overflow-hidden z-20"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                onClick={() => {
                  setInput(suggestion);
                  setSuggestions([]);
                  setSelectedSuggestion(-1);
                  inputRef.current?.focus();
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  index === selectedSuggestion
                    ? 'bg-workspace-casual/20 text-workspace-casual'
                    : 'text-text-secondary hover:bg-forge-hover hover:text-text-primary'
                }`}
              >
                {suggestion}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice transcript indicator */}
      <AnimatePresence>
        {isListening && voiceTranscript && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg"
          >
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
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 p-4 bg-forge-surface border border-forge-border rounded-xl shadow-xl z-30"
          >
            <div className="flex items-center gap-2 mb-3">
              <ImagePlus size={18} className="text-[var(--ws-primary)]" />
              <span className="font-medium text-white">Generate Image</span>
              <button 
                onClick={() => setShowImagePrompt(false)}
                className="ml-auto p-1 hover:bg-white/10 rounded"
              >
                <X size={16} className="text-white/50" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitImageGeneration()}
                placeholder="Describe the image you want to generate..."
                className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/40 outline-none focus:border-[var(--ws-primary)]/50"
                autoFocus
              />
              <button
                onClick={submitImageGeneration}
                disabled={!imagePrompt.trim()}
                className="px-4 py-2 bg-[var(--ws-primary)] disabled:opacity-50 rounded-lg text-white font-medium"
              >
                Generate
              </button>
            </div>
            <p className="mt-2 text-xs text-white/40">
              Uses Stable Diffusion or ComfyUI if configured
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment previews */}
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex gap-2 flex-wrap"
          >
            {attachments.map((attachment) => {
              const FileIcon = FILE_ICONS[getFileType(attachment.type)] || FILE_ICONS.default;
              
              return (
                <motion.div
                  key={attachment.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="relative group"
                >
                  {attachment.preview ? (
                    <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-white/10">
                      <img 
                        src={attachment.preview} 
                        alt={attachment.name}
                        className="w-full h-full object-cover"
                      />
                      {attachment.isScreenshot && (
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-white/80">
                          <ScreenShare size={10} className="inline mr-1" />
                          Screenshot
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-forge-elevated border border-forge-border rounded-lg">
                      <FileIcon size={16} className="text-[var(--ws-primary)]" />
                      <div className="max-w-[120px]">
                        <p className="text-xs text-white truncate">{attachment.name}</p>
                        <p className="text-[10px] text-white/40">{formatSize(attachment.size)}</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Remove button */}
                  <button
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} className="text-white" />
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main input container */}
      <div className="relative rounded-xl bg-forge-bg border border-forge-border focus-within:border-[var(--ws-primary)]/50 transition-colors">
        {/* Textarea */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={isListening ? "Listening... speak now" : "Type your message..."}
          disabled={disabled}
          rows={1}
          className={`w-full pl-4 pr-4 py-3 bg-transparent text-text-primary placeholder-text-muted resize-none focus:outline-none scrollbar-hide ${
            isListening ? 'placeholder-red-400' : ''
          }`}
          style={{ maxHeight: '200px' }}
        />

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-1 px-2 py-2 border-t border-forge-border/50">
          {/* Quick actions */}
          <div className="relative">
            <motion.button
              onClick={() => setShowQuickActions(!showQuickActions)}
              className={`p-2 rounded-lg transition-colors ${
                showQuickActions 
                  ? 'bg-[var(--ws-primary)]/20 text-[var(--ws-primary)]' 
                  : 'text-text-muted hover:text-text-secondary hover:bg-forge-hover'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Quick actions (AI prompts)"
            >
              <Wand2 size={18} />
            </motion.button>

            <AnimatePresence>
              {showQuickActions && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowQuickActions(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="absolute bottom-full left-0 mb-2 bg-forge-surface border border-forge-border rounded-lg shadow-xl p-2 min-w-[180px] z-50"
                  >
                    <div className="text-xs text-white/40 px-2 py-1 mb-1">Quick Actions</div>
                    {QUICK_ACTIONS.map((action) => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={action.id}
                          onClick={() => handleQuickAction(action)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-forge-hover text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <Icon size={14} />
                          <span className="text-sm">{action.label}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Voice input */}
          <motion.button
            onClick={toggleVoiceInput}
            className={`p-2 rounded-lg transition-colors ${
              isListening 
                ? 'bg-red-500/20 text-red-400 ring-2 ring-red-500/50' 
                : voiceSupported 
                  ? 'text-text-muted hover:text-text-secondary hover:bg-forge-hover'
                  : 'text-text-muted/30 cursor-not-allowed'
            }`}
            whileHover={voiceSupported ? { scale: 1.05 } : {}}
            whileTap={voiceSupported ? { scale: 0.95 } : {}}
            title={isListening ? "Stop listening" : voiceSupported ? "Voice input" : "Voice not supported"}
            disabled={!voiceSupported}
          >
            {isListening ? (
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
              >
                <MicOff size={18} />
              </motion.div>
            ) : (
              <Mic size={18} />
            )}
          </motion.button>

          {/* File attachment */}
          <motion.button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Attach file (documents, code, text)"
          >
            <Paperclip size={18} />
          </motion.button>

          {/* Image upload/attachment */}
          <motion.button
            onClick={() => imageInputRef.current?.click()}
            className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Attach image"
          >
            <Image size={18} />
          </motion.button>

          {/* Screenshot capture */}
          <motion.button
            onClick={handleScreenshotCapture}
            disabled={isCapturing}
            className={`p-2 rounded-lg transition-colors ${
              isCapturing 
                ? 'bg-[var(--ws-primary)]/20 text-[var(--ws-primary)]' 
                : 'text-text-muted hover:text-text-secondary hover:bg-forge-hover'
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Capture screenshot"
          >
            {isCapturing ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Camera size={18} />
            )}
          </motion.button>

          {/* Send button */}
          <motion.button
            onClick={isGenerating ? handleStop : handleSubmit}
            disabled={isGenerating ? false : ((!input.trim() && attachments.length === 0) || disabled)}
            className={`
              p-2 rounded-lg transition-colors ml-2
              ${(isGenerating || (input.trim() || attachments.length > 0)) && !disabled
                ? 'bg-[var(--ws-primary)] hover:bg-[var(--ws-primary)]/90 text-white'
                : 'bg-forge-elevated text-text-muted cursor-not-allowed'
              }
            `}
            whileHover={(isGenerating || (input.trim() || attachments.length > 0)) && !disabled ? { scale: 1.05 } : {}}
            whileTap={(isGenerating || (input.trim() || attachments.length > 0)) && !disabled ? { scale: 0.95 } : {}}
            title={isGenerating ? "Stop generation" : "Send message"}
          >
            {isGenerating ? (
              <Square size={18} />
            ) : (
              <Send size={18} />
            )}
          </motion.button>
        </div>
      </div>

      {/* Input info bar */}
      <div className="flex items-center justify-between mt-2 px-1">
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {input.length > 0 && (
            <span>{input.length} chars</span>
          )}
          {attachments.length > 0 && (
            <span className="flex items-center gap-1 text-[var(--ws-primary)]">
              <Paperclip size={10} />
              {attachments.length} attachment{attachments.length > 1 ? 's' : ''}
            </span>
          )}
          {currentModel && (
            <span className="flex items-center gap-1">
              <Zap size={12} className="text-[var(--ws-primary)]" />
              Ready
            </span>
          )}
          {isListening && (
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Listening...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>Shift+Enter for new line</span>
        </div>
      </div>
    </div>
  );
}

export default SmartInput;
