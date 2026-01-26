/**
 * ModelPreview - Quick test and benchmark models
 * 
 * Features:
 * - Quick model test with sample prompts
 * - Post-install readiness checks
 * - Performance benchmarking
 * - Community benchmark display
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Play,
  Pause,
  Zap,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  BarChart2,
  Sparkles,
  Send,
  Loader2,
  RefreshCw,
  ChevronDown,
  Copy,
  Users,
  Gauge,
  Timer,
} from 'lucide-react';

// Readiness check badge
const ReadinessBadge = memo(({ check }) => {
  const Icon = check.passed ? CheckCircle : XCircle;
  const color = check.passed ? 'text-emerald-400' : 'text-red-400';
  const bg = check.passed ? 'bg-emerald-500/10' : 'bg-red-500/10';
  
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg ${bg}`}>
      <Icon className={`w-4 h-4 ${color}`} />
      <div className="flex-1">
        <div className="text-sm font-medium text-[var(--text-primary)]">{check.name}</div>
        <div className="text-xs text-[var(--text-muted)]">{check.message}</div>
      </div>
    </div>
  );
});

// Benchmark stat card
const BenchmarkStat = memo(({ icon: Icon, label, value, unit, color = 'var(--accent-primary)' }) => (
  <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg">
    <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}20` }}>
      <Icon className="w-5 h-5" style={{ color }} />
    </div>
    <div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="text-lg font-semibold text-[var(--text-primary)]">
        {value} <span className="text-sm text-[var(--text-muted)]">{unit}</span>
      </div>
    </div>
  </div>
));

// Test result card
const TestResultCard = memo(({ result }) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg overflow-hidden">
      <div 
        className="p-3 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {result.success ? (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-sm text-[var(--text-primary)] truncate max-w-[200px]">
            {result.prompt}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span>{result.tokensPerSec} tok/s</span>
          <span>{result.ttftMs}ms TTFT</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>
      
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 border-t border-[var(--border-dim)]">
              <div className="text-xs text-[var(--text-muted)] mb-1">Response:</div>
              <div className="p-2 bg-[var(--bg-tertiary)] rounded text-sm text-[var(--text-secondary)] whitespace-pre-wrap max-h-32 overflow-y-auto">
                {result.response || 'No response'}
              </div>
              {result.error && (
                <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-400">
                  {result.error}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// Main component
export const ModelPreview = memo(({ model, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('test');
  const [prompts, setPrompts] = useState([]);
  const [customPrompt, setCustomPrompt] = useState('');
  const [testResults, setTestResults] = useState([]);
  const [currentTest, setCurrentTest] = useState(null);
  const [readinessChecks, setReadinessChecks] = useState(null);
  const [benchmarks, setBenchmarks] = useState(null);
  const [communityBenchmarks, setCommunityBenchmarks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [streamingResponse, setStreamingResponse] = useState('');
  
  // Load prompts on mount
  useEffect(() => {
    if (isOpen && model) {
      loadPrompts();
      loadBenchmarks();
    }
  }, [isOpen, model]);
  
  // Setup event listeners
  useEffect(() => {
    const cleanups = [];
    
    if (window.electronAPI?.onTestingProgress) {
      cleanups.push(window.electronAPI.onTestingProgress((data) => {
        setStreamingResponse(data.response || '');
      }));
    }
    
    if (window.electronAPI?.onTestingCompleted) {
      cleanups.push(window.electronAPI.onTestingCompleted((data) => {
        setTestResults((prev) => [data, ...prev].slice(0, 10));
        setCurrentTest(null);
        setStreamingResponse('');
        setLoading(false);
      }));
    }
    
    if (window.electronAPI?.onTestingError) {
      cleanups.push(window.electronAPI.onTestingError((data) => {
        setTestResults((prev) => [data, ...prev].slice(0, 10));
        setCurrentTest(null);
        setStreamingResponse('');
        setLoading(false);
      }));
    }
    
    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, []);
  
  const loadPrompts = async () => {
    const modelType = model?.type || 'text-generation';
    const result = await window.electronAPI?.testingGetPrompts?.(modelType);
    if (result && !result.error) {
      setPrompts(result);
    }
  };
  
  const loadBenchmarks = async () => {
    if (!model) return;
    
    const [local, community] = await Promise.all([
      window.electronAPI?.testingGetLocalBenchmarks?.(model.id),
      window.electronAPI?.testingGetCommunityBenchmarks?.(model.id),
    ]);
    
    if (local && !local.error) {
      setBenchmarks(local[0] || null);
    }
    if (community && !community.error) {
      setCommunityBenchmarks(community);
    }
  };
  
  const runTest = useCallback(async (prompt) => {
    if (!model || loading) return;
    
    setLoading(true);
    setCurrentTest({ prompt });
    setStreamingResponse('');
    
    try {
      const result = await window.electronAPI?.testingRunQuickTest?.(
        model.id,
        model.provider || 'ollama',
        prompt
      );
      
      // Result handled by event listener
    } catch (error) {
      console.error('Test error:', error);
      setLoading(false);
      setCurrentTest(null);
    }
  }, [model, loading]);
  
  const checkReadiness = useCallback(async () => {
    if (!model) return;
    
    setLoading(true);
    try {
      const result = await window.electronAPI?.testingCheckReadiness?.(
        model.id,
        model.provider || 'ollama'
      );
      
      if (result && !result.error) {
        setReadinessChecks(result);
      }
    } catch (error) {
      console.error('Readiness check error:', error);
    } finally {
      setLoading(false);
    }
  }, [model]);
  
  const runBenchmark = useCallback(async () => {
    if (!model || loading) return;
    
    setLoading(true);
    try {
      const result = await window.electronAPI?.testingRunBenchmark?.(
        model.id,
        model.provider || 'ollama'
      );
      
      if (result && !result.error) {
        setBenchmarks(result);
      }
    } catch (error) {
      console.error('Benchmark error:', error);
    } finally {
      setLoading(false);
    }
  }, [model, loading]);
  
  if (!isOpen || !model) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-3xl max-h-[80vh] bg-[var(--bg-primary)] border border-[var(--border-dim)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--border-dim)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--accent-primary)]/10 rounded-lg">
              <Sparkles className="w-5 h-5 text-[var(--accent-primary)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                {model.name || model.id}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Test and benchmark this model
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="px-4 py-2 border-b border-[var(--border-dim)] flex gap-1">
          <button
            onClick={() => setActiveTab('test')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'test'
                ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Play className="w-4 h-4 inline-block mr-1" />
            Quick Test
          </button>
          <button
            onClick={() => setActiveTab('readiness')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'readiness'
                ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <CheckCircle className="w-4 h-4 inline-block mr-1" />
            Readiness
          </button>
          <button
            onClick={() => setActiveTab('benchmark')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'benchmark'
                ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <BarChart2 className="w-4 h-4 inline-block mr-1" />
            Benchmark
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Quick Test Tab */}
          {activeTab === 'test' && (
            <div className="space-y-4">
              {/* Sample prompts */}
              <div>
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Sample Prompts
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {prompts.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => runTest(p.prompt)}
                      disabled={loading}
                      className="p-3 text-left bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg hover:border-[var(--accent-primary)]/30 disabled:opacity-50 transition-all"
                    >
                      <div className="text-sm font-medium text-[var(--text-primary)]">{p.name}</div>
                      <div className="text-xs text-[var(--text-muted)] truncate">{p.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Custom prompt */}
              <div>
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Custom Prompt
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Enter your test prompt..."
                    className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
                    onKeyDown={(e) => e.key === 'Enter' && customPrompt && runTest(customPrompt)}
                  />
                  <button
                    onClick={() => customPrompt && runTest(customPrompt)}
                    disabled={!customPrompt || loading}
                    className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              {/* Current test */}
              {currentTest && (
                <div className="p-4 bg-[var(--bg-secondary)] border border-[var(--accent-primary)]/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Loader2 className="w-4 h-4 text-[var(--accent-primary)] animate-spin" />
                    <span className="text-sm font-medium text-[var(--text-primary)]">Testing...</span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mb-2">{currentTest.prompt}</div>
                  {streamingResponse && (
                    <div className="p-2 bg-[var(--bg-tertiary)] rounded text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                      {streamingResponse}
                      <span className="animate-pulse">▌</span>
                    </div>
                  )}
                </div>
              )}
              
              {/* Test results */}
              {testResults.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Recent Tests
                  </h3>
                  <div className="space-y-2">
                    {testResults.map((result) => (
                      <TestResultCard key={result.id} result={result} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Readiness Tab */}
          {activeTab === 'readiness' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-secondary)]">
                  Readiness Checks
                </h3>
                <button
                  onClick={checkReadiness}
                  disabled={loading}
                  className="px-3 py-1.5 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  {loading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Check Now
                </button>
              </div>
              
              {readinessChecks ? (
                <>
                  <div className={`p-4 rounded-lg ${
                    readinessChecks.ready 
                      ? 'bg-emerald-500/10 border border-emerald-500/20'
                      : 'bg-amber-500/10 border border-amber-500/20'
                  }`}>
                    <div className="flex items-center gap-2">
                      {readinessChecks.ready ? (
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-amber-400" />
                      )}
                      <span className={`font-medium ${
                        readinessChecks.ready ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {readinessChecks.ready ? 'Model is ready!' : 'Some checks failed'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {readinessChecks.checks.map((check, i) => (
                      <ReadinessBadge key={i} check={check} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
                  <p className="text-sm text-[var(--text-muted)]">
                    Run a readiness check to verify the model is working correctly.
                  </p>
                </div>
              )}
            </div>
          )}
          
          {/* Benchmark Tab */}
          {activeTab === 'benchmark' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-secondary)]">
                  Performance Benchmarks
                </h3>
                <button
                  onClick={runBenchmark}
                  disabled={loading}
                  className="px-3 py-1.5 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  {loading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  Run Benchmark
                </button>
              </div>
              
              {/* Local benchmarks */}
              {benchmarks && (
                <div>
                  <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2">Your Results</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <BenchmarkStat 
                      icon={Gauge} 
                      label="Avg Speed" 
                      value={benchmarks.avgSpeed?.toFixed(1)} 
                      unit="tok/s" 
                      color="#10b981"
                    />
                    <BenchmarkStat 
                      icon={Timer} 
                      label="Time to First Token" 
                      value={benchmarks.avgTtft} 
                      unit="ms"
                      color="#f59e0b" 
                    />
                    <BenchmarkStat 
                      icon={Zap} 
                      label="P99 Speed" 
                      value={benchmarks.p99Speed?.toFixed(1)} 
                      unit="tok/s"
                      color="#6366f1" 
                    />
                  </div>
                </div>
              )}
              
              {/* Community benchmarks */}
              {communityBenchmarks && (
                <div>
                  <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Community Average ({communityBenchmarks.samples} samples)
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <BenchmarkStat 
                      icon={Gauge} 
                      label="Avg Speed" 
                      value={communityBenchmarks.avgSpeed?.toFixed(1)} 
                      unit="tok/s" 
                      color="#10b981"
                    />
                    <BenchmarkStat 
                      icon={Timer} 
                      label="Time to First Token" 
                      value={communityBenchmarks.avgTtft} 
                      unit="ms"
                      color="#f59e0b" 
                    />
                    <BenchmarkStat 
                      icon={Zap} 
                      label="P99 Speed" 
                      value={communityBenchmarks.p99Speed?.toFixed(1)} 
                      unit="tok/s"
                      color="#6366f1" 
                    />
                  </div>
                  
                  {/* Ratings */}
                  <div className="mt-3 flex gap-4">
                    {Object.entries(communityBenchmarks.ratings || {}).map(([key, value]) => (
                      <div key={key} className="text-center">
                        <div className="text-lg font-semibold text-[var(--text-primary)]">{value}</div>
                        <div className="text-xs text-[var(--text-muted)] capitalize">{key}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {!benchmarks && !communityBenchmarks && (
                <div className="text-center py-8">
                  <BarChart2 className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
                  <p className="text-sm text-[var(--text-muted)]">
                    Run a benchmark to measure this model's performance on your hardware.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
});

export default ModelPreview;



