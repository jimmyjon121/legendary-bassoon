# DevForge Performance & Resource Optimization Plan

**Goal:** Maximize bandwidth for LLM inference by minimizing app overhead

---

## Phase 1: CRITICAL - Memory Leak Prevention

### 1.1 Create Safe Timer Hooks

**Create `src/hooks/useInterval.js`:**
```javascript
import { useEffect, useRef } from 'react';

export function useInterval(callback, delay) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

export function useTimeout(callback, delay) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setTimeout(() => savedCallback.current(), delay);
    return () => clearTimeout(id);
  }, [delay]);
}
```

**Files to refactor (priority order):**
1. `HardwareMonitor.jsx` - 5 timers (polling hardware stats)
2. `ConversationPlayground.jsx` - 4 timers
3. `StartupScreen.jsx` - 7 timers (glitch effects)
4. `SettingsModal.jsx` - 3 timers

### 1.2 Fix React Key Anti-Pattern

**Files with array index keys (34 total):**
| File | Count | Fix Strategy |
|------|-------|--------------|
| HardwareMonitor.jsx | 5 | Use device.id or gpu.index |
| SmartSearch.jsx | 2 | Use result.id |
| ConversationDNA.jsx | 2 | Use topic.id |
| APITester.jsx | 2 | Use header.id or param.id |
| ModelExperienceIndicator.jsx | 2 | Use capability.name |
| Others | 21 | Generate stable IDs |

---

## Phase 2: Reduce Renderer Process Load

### 2.1 Implement Virtual Scrolling for Message Lists

Long conversations with 100+ messages cause lag. Use virtualization:

```javascript
// Install: npm install @tanstack/react-virtual
import { useVirtualizer } from '@tanstack/react-virtual';

function MessageList({ messages }) {
  const parentRef = useRef(null);
  
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // estimated message height
    overscan: 5,
  });
  
  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <MessageBubble 
            key={messages[virtualRow.index].id}
            message={messages[virtualRow.index]}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              height: virtualRow.size,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

### 2.2 Throttle Hardware Monitoring

Current: Polling every 2-5 seconds
Recommended: Poll every 10-30 seconds, or on-demand

```javascript
// src/components/HardwareMonitor/HardwareMonitor.jsx
const POLL_INTERVAL = 30000; // 30 seconds instead of 2-5 seconds
const POLL_INTERVAL_FOCUSED = 10000; // 10 seconds when panel is visible
```

### 2.3 Lazy Load Heavy Components

Already done for modals, but add more:

```javascript
// Lazy load these additional components
const ConversationDNA = lazy(() => import('./Chat/ConversationDNA'));
const ConversationAnalytics = lazy(() => import('./Chat/ConversationAnalytics'));
const AgentDashboard = lazy(() => import('./Agents/AgentDashboard'));
const DebateArena = lazy(() => import('./Chat/DebateArena'));
```

---

## Phase 3: Electron Main Process Optimization

### 3.1 Fix Missing IPC Handler

Add to `electron/ipc-handlers.js`:
```javascript
ipcMain.handle('sovereignty:getStatus', async () => {
  // Return local-only status
  const settings = store.get('settings') || {};
  return {
    localOnly: settings.localOnly !== false,
    networkEnabled: settings.allowNetwork === true,
    vpnDetected: false, // Could add VPN detection
  };
});
```

### 3.2 Optimize Database Queries

Add indexes for frequently queried columns:
```sql
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
```

### 3.3 Batch IPC Calls

Instead of multiple IPC calls, batch them:

```javascript
// Before (3 IPC calls)
const models = await api.getModels();
const health = await api.checkHealth();
const settings = await api.getSettings('theme');

// After (1 IPC call)
const { models, health, settings } = await api.batchGet([
  'models',
  'health',
  { type: 'settings', key: 'theme' }
]);
```

---

## Phase 4: Reduce Bundle Size

### 4.1 Tree-Shake Unused Icons

```javascript
// Before - imports entire icon library
import * as Icons from 'lucide-react';

// After - import only what's used
import { Send, Square, Paperclip } from 'lucide-react';
```

### 4.2 Code Split by Workspace

```javascript
// vite.config.js
rollupOptions: {
  output: {
    manualChunks: {
      'workspace-code': ['./src/components/Code/*'],
      'workspace-casual': ['./src/components/Chat/*'],
      'vendor-monaco': ['monaco-editor', '@monaco-editor/react'],
      'vendor-motion': ['framer-motion'],
    }
  }
}
```

---

## Phase 5: LLM Inference Bandwidth Optimization

### 5.1 Reduce Ollama Connection Overhead

```javascript
// Keep connection alive, don't recreate for each message
const ollamaClient = {
  baseUrl: 'http://127.0.0.1:11434',
  keepAlive: true,
  timeout: 0, // No timeout for streaming
};
```

### 5.2 Implement Request Queuing

Prevent multiple simultaneous LLM calls:

```javascript
class LLMQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }
  
  async add(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.process();
    });
  }
  
  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    
    const { request, resolve, reject } = this.queue.shift();
    try {
      const result = await this.execute(request);
      resolve(result);
    } catch (err) {
      reject(err);
    }
    
    this.processing = false;
    this.process(); // Process next in queue
  }
}
```

### 5.3 GPU Memory Management

Add to settings:
```javascript
// Allow user to configure VRAM allocation
{
  "ollama": {
    "gpu_memory_fraction": 0.8, // Use 80% of VRAM
    "num_gpu_layers": -1, // Auto-detect
    "num_threads": 0 // Auto-detect CPU threads
  }
}
```

---

## Phase 6: Monitoring & Profiling

### 6.1 Add Performance Metrics

```javascript
// src/utils/perfMonitor.js
class PerfMonitor {
  static metrics = {
    renderCount: 0,
    ipcCalls: 0,
    llmRequests: 0,
    avgResponseTime: 0,
  };
  
  static track(metric, value) {
    this.metrics[metric] = value;
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[Perf] ${metric}: ${value}`);
    }
  }
  
  static getReport() {
    return { ...this.metrics, timestamp: Date.now() };
  }
}
```

### 6.2 Memory Usage Dashboard

Add to HardwareMonitor:
- Electron process memory
- Renderer process memory
- GPU VRAM usage
- Ollama memory footprint

---

## Implementation Priority

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1.1 Timer hooks | 2h | HIGH | 🔴 P0 |
| 1.2 React keys | 1h | MEDIUM | 🟡 P1 |
| 2.1 Virtual scroll | 3h | HIGH | 🟡 P1 |
| 2.2 Throttle monitoring | 30m | MEDIUM | 🟡 P1 |
| 3.1 Fix IPC handler | 15m | LOW | 🟢 P2 |
| 3.2 DB indexes | 30m | MEDIUM | 🟢 P2 |
| 4.1 Tree-shake icons | 1h | MEDIUM | 🟢 P2 |
| 5.1-5.3 LLM optimization | 2h | HIGH | 🟡 P1 |

---

## Quick Wins (Do Now)

1. **Increase health monitor interval** from 120s to 300s
2. **Disable hardware polling** when app is minimized
3. **Add `will-change: transform`** to animated elements
4. **Use `React.memo`** on MessageBubble component
5. **Fix the missing getSovereigntyStatus handler**

---

## Functional Improvements

### Chat Experience
- [ ] Message search within conversations
- [ ] Pin important messages
- [ ] Conversation tagging/folders
- [ ] Quick reply templates

### Model Management
- [ ] Model performance benchmarks
- [ ] Recommended models by task
- [ ] One-click model switching
- [ ] Model memory estimation

### Code Workspace
- [ ] Git integration status bar
- [ ] Terminal integration
- [ ] Project templates
- [ ] Snippet library

### Privacy/Security
- [ ] Auto-lock after timeout
- [ ] Secure clipboard (auto-clear)
- [ ] Conversation export encryption
- [ ] Activity logging (optional)






