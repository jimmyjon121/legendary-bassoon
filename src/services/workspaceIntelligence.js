/**
 * Workspace Intelligence - REAL contextual awareness
 * 
 * This service provides genuine value by:
 * 1. Tracking what files you're working on
 * 2. Detecting errors and offering help
 * 3. Understanding your current task context
 * 4. Building a lightweight session memory
 * 
 * NO fake data. NO background intervals eating RAM.
 * Only activates when there's real data to process.
 */

import { create } from 'zustand';

// Lightweight store - no persistence needed for session data
export const useWorkspaceIntelligence = create((set, get) => ({
  // Current session context
  session: {
    startedAt: Date.now(),
    activeFile: null,
    recentFiles: [],
    recentErrors: [],
    clipboardHint: null,
    taskContext: null,
  },

  // Smart suggestions based on REAL context
  suggestions: [],

  // Actions
  setActiveFile: (filePath, content = null) => {
    const state = get();
    const fileInfo = {
      path: filePath,
      name: filePath?.split(/[\\/]/).pop() || 'unknown',
      language: detectLanguage(filePath),
      timestamp: Date.now(),
      snippet: content?.substring(0, 500) || null,
    };

    set({
      session: {
        ...state.session,
        activeFile: fileInfo,
        recentFiles: [fileInfo, ...state.session.recentFiles.filter(f => f.path !== filePath)].slice(0, 10),
      }
    });

    // Generate contextual suggestions
    get().generateSuggestions();
  },

  addError: (error) => {
    const state = get();
    const errorInfo = {
      message: error.message || String(error),
      file: error.file || state.session.activeFile?.path,
      line: error.line,
      timestamp: Date.now(),
    };

    set({
      session: {
        ...state.session,
        recentErrors: [errorInfo, ...state.session.recentErrors].slice(0, 5),
      }
    });

    // Proactive error assistance
    get().generateSuggestions();
  },

  clearErrors: () => set(state => ({
    session: { ...state.session, recentErrors: [] }
  })),

  setTaskContext: (context) => set(state => ({
    session: { ...state.session, taskContext: context }
  })),

  // Generate smart suggestions based on REAL context
  generateSuggestions: () => {
    const state = get();
    const suggestions = [];
    const { activeFile, recentErrors, recentFiles } = state.session;

    // Suggest help for recent errors
    if (recentErrors.length > 0) {
      const lastError = recentErrors[0];
      suggestions.push({
        id: 'fix-error',
        type: 'error',
        priority: 1,
        title: 'Fix Error',
        description: `Help me fix: ${lastError.message.substring(0, 100)}`,
        prompt: `I'm getting this error in ${lastError.file || 'my code'}:\n\n${lastError.message}\n\nCan you help me fix it?`,
      });
    }

    // Suggest based on file type
    if (activeFile) {
      const { language, name } = activeFile;
      
      if (language === 'javascript' || language === 'typescript') {
        if (name.includes('.test.') || name.includes('.spec.')) {
          suggestions.push({
            id: 'help-test',
            type: 'context',
            priority: 2,
            title: 'Help with Tests',
            description: 'Get help writing or fixing tests',
            prompt: `I'm working on tests in ${name}. Can you help me write better test cases?`,
          });
        }
        if (name.includes('component') || name.endsWith('.jsx') || name.endsWith('.tsx')) {
          suggestions.push({
            id: 'review-component',
            type: 'context',
            priority: 3,
            title: 'Review Component',
            description: 'Get feedback on your React component',
            prompt: `Review this React component for best practices and potential improvements.`,
          });
        }
      }

      if (language === 'python') {
        suggestions.push({
          id: 'optimize-python',
          type: 'context',
          priority: 3,
          title: 'Optimize Code',
          description: 'Get performance suggestions',
          prompt: `Can you review this Python code for performance optimizations?`,
        });
      }
    }

    // Suggest based on session patterns
    if (recentFiles.length >= 3) {
      const languages = [...new Set(recentFiles.map(f => f.language).filter(Boolean))];
      if (languages.length === 1) {
        suggestions.push({
          id: 'project-help',
          type: 'project',
          priority: 4,
          title: `${languages[0]} Project Help`,
          description: 'Get project-wide assistance',
          prompt: `I'm working on a ${languages[0]} project. What are some best practices I should follow?`,
        });
      }
    }

    set({ suggestions: suggestions.sort((a, b) => a.priority - b.priority).slice(0, 3) });
  },

  // Get context string for AI prompts
  getContextString: () => {
    const state = get();
    const { activeFile, recentFiles, recentErrors, taskContext } = state.session;
    
    let context = '';
    
    if (taskContext) {
      context += `Current task: ${taskContext}\n`;
    }
    
    if (activeFile) {
      context += `Currently editing: ${activeFile.name} (${activeFile.language || 'unknown'})\n`;
    }
    
    if (recentFiles.length > 1) {
      context += `Recent files: ${recentFiles.slice(0, 5).map(f => f.name).join(', ')}\n`;
    }
    
    if (recentErrors.length > 0) {
      context += `Recent error: ${recentErrors[0].message.substring(0, 200)}\n`;
    }
    
    return context.trim();
  },

  // Clear session (for privacy or reset)
  clearSession: () => set({
    session: {
      startedAt: Date.now(),
      activeFile: null,
      recentFiles: [],
      recentErrors: [],
      clipboardHint: null,
      taskContext: null,
    },
    suggestions: [],
  }),
}));

// Utility: Detect language from file path
function detectLanguage(filePath) {
  if (!filePath) return null;
  
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    ps1: 'powershell',
  };
  
  return langMap[ext] || ext;
}

// Hook into Electron's file system events if available
export function initWorkspaceWatcher() {
  if (typeof window !== 'undefined' && window.electronAPI) {
    // Listen for active editor changes
    window.electronAPI.onActiveFileChange?.((filePath, content) => {
      useWorkspaceIntelligence.getState().setActiveFile(filePath, content);
    });

    // Listen for errors from the IDE
    window.electronAPI.onError?.((error) => {
      useWorkspaceIntelligence.getState().addError(error);
    });
  }
}

export default useWorkspaceIntelligence;



