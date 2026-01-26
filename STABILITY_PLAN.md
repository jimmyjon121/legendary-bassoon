# 🛡️ DEVFORGE STABILITY & DEBUGGING MASTER PLAN

## 📊 AUDIT FINDINGS

### Critical Stats
| Metric | Count | Issue |
|--------|-------|-------|
| **Click handlers** | 197 | Need validation |
| **Async operations** | 22 | Missing error handling |
| **Try/catch blocks** | 10 | Not enough coverage |
| **Window.electronAPI calls** | 243 | Need null checks |
| **.map() calls** | 121 | Some missing keys |
| **Key props** | 88 | Missing in 33 places |
| **Conditional animations** | 4 | Can cause iterationCount errors |

---

## 🔴 PHASE 1: CRITICAL FIXES (Do First)

### 1.1 Animation Safety Pattern
**Problem:** `animate={condition ? {...} : {}}` with `transition={{ repeat: Infinity }}` crashes when condition is false.

**Files to fix:**
- `src/components/Chat/AIMasterSwitch.jsx` ✅ Fixed
- Any other files with similar pattern

**Pattern:**
```jsx
// ❌ BAD - transition always repeats even on empty animate
animate={isActive ? { scale: [1, 1.2, 1] } : {}}
transition={{ duration: 2, repeat: Infinity }}

// ✅ GOOD - transition is conditional too
animate={isActive ? { scale: [1, 1.2, 1] } : {}}
transition={isActive ? { duration: 2, repeat: Infinity } : {}}
```

### 1.2 Export/Import Consistency
**Problem:** Named vs default exports causing "does not provide export" errors.

**Rule:** Every component should have BOTH exports:
```jsx
export function MyComponent() { ... }
export default MyComponent;
```

**Files verified:**
- `src/components/ErrorBoundary.jsx` ✅ Fixed

---

## 🟡 PHASE 2: ERROR HANDLING (High Priority)

### 2.1 Async Operation Safety
**Every async function needs try/catch:**

```jsx
// ❌ BAD - unhandled errors crash the app
const handleClick = async () => {
  const result = await someAsyncThing();
  setData(result);
};

// ✅ GOOD - errors are caught
const handleClick = async () => {
  try {
    const result = await someAsyncThing();
    setData(result);
  } catch (error) {
    console.error('Operation failed:', error);
    // Show user-friendly error
  }
};
```

**Files needing error handling:**
- `src/components/Chat/ParallelRealityViewer.jsx`
- `src/components/Chat/ConversationPlayground.jsx`
- `src/components/Chat/SmartSearch.jsx`
- `src/components/Chat/views/StreamView.jsx`
- `src/components/Chat/views/CanvasView.jsx`
- `src/components/Chat/AmbientIntelligence.jsx`
- `src/components/Chat/FluidMessageBubble.jsx`
- `src/components/Chat/CasualWorkspace.jsx`
- `src/components/Chat/ChatArea.jsx`
- `src/components/Chat/CompareMode.jsx`
- `src/components/Chat/MessageBubble.jsx`
- `src/components/Chat/CompareResults.jsx`
- `src/components/Chat/TemplateSelector.jsx`

### 2.2 Electron API Safety
**Every window.electronAPI call needs null check:**

```jsx
// ❌ BAD - crashes in browser/when API unavailable
const result = await window.electronAPI.someMethod();

// ✅ GOOD - safe with fallback
const result = await window.electronAPI?.someMethod?.() ?? defaultValue;
```

---

## 🟢 PHASE 3: CLICK HANDLER VALIDATION

### Testing Checklist
Before any release, manually test:

#### Views (5 total)
- [ ] Stream View - Click switches, no crash
- [ ] Canvas View - ReactFlow renders, nodes work
- [ ] Document View - Content loads
- [ ] Timeline View - Timeline renders
- [ ] Focus View - Minimal UI loads

#### AI Features (when enabled)
- [ ] 3rd Eye Toggle - Opens/closes
- [ ] 6th Sense Toggle - Works
- [ ] AI Master Switch - Enables/disables
- [ ] God Spark Panel - Expands/collapses
- [ ] Entanglement Visualizer - Shows metrics
- [ ] Bio Feedback Display - Shows heart rate
- [ ] Chrono Shifter Panel - Timeline loads
- [ ] Parallel Reality Viewer - Can spawn realities

#### Core Chat
- [ ] Send message - Works
- [ ] Model selector - Opens, lists models
- [ ] New conversation - Creates new
- [ ] Search - Opens, searches
- [ ] Settings - Opens modal

---

## 🔵 PHASE 4: DEFENSIVE CODING RULES

### Rule 1: Always Check Before Access
```jsx
// ❌ BAD
messages.map(m => m.content)

// ✅ GOOD
(messages || []).map(m => m?.content || '')
```

### Rule 2: Default Props
```jsx
// ❌ BAD
function MyComponent({ data, onAction }) {
  return <div onClick={onAction}>{data.name}</div>
}

// ✅ GOOD
function MyComponent({ data = {}, onAction = () => {} }) {
  return <div onClick={onAction}>{data?.name || 'Unknown'}</div>
}
```

### Rule 3: Key Props for Lists
```jsx
// ❌ BAD - React can't track items
items.map((item, idx) => <Item key={idx} />)

// ✅ GOOD - Stable keys
items.map(item => <Item key={item.id} />)
```

### Rule 4: Cleanup Effects
```jsx
// ❌ BAD - Memory leak
useEffect(() => {
  window.addEventListener('resize', handleResize);
}, []);

// ✅ GOOD - Cleanup on unmount
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

---

## 🛠️ AUTOMATED CHECKS

### Pre-commit Checklist
1. `npm run lint` - No errors
2. `npm run build` - Builds successfully
3. No `console.log` in production code
4. All imports resolve
5. No unused variables

### Runtime Checks
Add to `src/App.jsx`:
```jsx
// Global error handler
window.onerror = (message, source, lineno, colno, error) => {
  console.error('Global error:', { message, source, lineno, colno, error });
  // Could send to error tracking service
};

// Unhandled promise rejection handler
window.onunhandledrejection = (event) => {
  console.error('Unhandled promise rejection:', event.reason);
};
```

---

## 📋 IMPLEMENTATION ORDER

1. **Immediate (Today):**
   - Fix remaining animation issues
   - Add global error handlers
   - Test all view switches

2. **Short-term (This Week):**
   - Add try/catch to all async operations
   - Add null checks to Electron API calls
   - Fix missing key props

3. **Ongoing:**
   - Wrap new features in ErrorBoundary
   - Write tests for critical paths
   - Document all component props

---

## 🎯 SUCCESS CRITERIA

The app is stable when:
- [ ] All 5 views load without crash
- [ ] AI master switch works completely
- [ ] Model selector opens and works
- [ ] Messages send successfully
- [ ] No console errors on normal use
- [ ] App doesn't crash on edge cases
- [ ] Memory doesn't grow infinitely

---

*Generated: December 4, 2025*
*Lead Engineer: Claude (Opus 4.5)*

