import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  ReactFlow, 
  MiniMap, 
  Controls, 
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { 
  MessageSquare, 
  Brain, 
  Lightbulb, 
  Zap, 
  Plus,
  Search,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
  Eye,
  EyeOff,
  X,
  Layout,
  GitBranch,
  Tag,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { useCasualStore } from '../../../stores/casualStore';
import conversationEngine from '../../../services/conversationEngine';
import { SmartInput } from '../SmartInput';

const CANVAS_MODES = [
  { id: 'conversation', label: 'Conversation Flow', icon: GitBranch, desc: 'Q&A pairs as connected nodes' },
  { id: 'topic', label: 'Topic Map', icon: Tag, desc: 'Cluster messages by topic' },
  { id: 'hybrid', label: 'Hybrid', icon: Layout, desc: 'Both conversation and topics' },
];

/**
 * Canvas View - Visual conversation mapping with nodes and connections
 * Think mind-mapping meets conversation flow
 */
export function CanvasView() {
  const messages = useAppStore(s => s.messages);
  const conversations = useAppStore(s => s.conversations);
  const sendMessage = useAppStore(s => s.sendMessage);
  const { 
    canvasNodes: storedNodes, 
    canvasEdges: storedEdges, 
    canvasViewport,
    updateCanvasNodes,
    updateCanvasEdges,
    setCanvasViewport 
  } = useCasualStore();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [canvasMode, setCanvasMode] = useState('conversation');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModeMenu, setShowModeMenu] = useState(false);

  const reactFlowWrapper = useRef(null);
  const reactFlowInstance = useRef(null);

  // Define node types
  const nodeTypes = useMemo(() => ({
    conversation_cluster: ConversationClusterNode,
    topicNode: TopicNode,
    insightNode: InsightNode,
    questionNode: QuestionNode,
  }), []);

  // Build nodes based on canvas mode
  const graphData = useMemo(() => {
    if (!messages || messages.length === 0) return { nodes: [], edges: [] };

    if (canvasMode === 'conversation') {
      return buildConversationFlow(messages);
    } else if (canvasMode === 'topic') {
      return buildTopicMap(messages);
    } else {
      // Hybrid: conversation flow + topic clusters
      const conv = buildConversationFlow(messages);
      const topics = buildTopicMap(messages);
      // Offset topic nodes to the right
      const offsetTopics = topics.nodes.map(n => ({
        ...n,
        id: `topic-${n.id}`,
        position: { x: n.position.x + 800, y: n.position.y },
      }));
      return {
        nodes: [...conv.nodes, ...offsetTopics],
        edges: [...conv.edges, ...topics.edges.map(e => ({
          ...e,
          id: `topic-${e.id}`,
          source: `topic-${e.source}`,
          target: `topic-${e.target}`,
        }))],
      };
    }
  }, [messages, canvasMode]);

  // Initialize canvas
  useEffect(() => {
    if (graphData.nodes.length > 0) {
      const sanitizedNodes = graphData.nodes.map((node) => ({
        ...node,
        draggable: true,
      }));

      const nodeIdSet = new Set(sanitizedNodes.map((n) => n.id));
      const sanitizedEdges = graphData.edges
        .filter((edge) => edge.source && edge.target && nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
        .map((edge, idx) => ({
          id: edge.id || `edge-${idx}`,
          source: edge.source,
          target: edge.target,
          type: undefined,
          animated: true,
          style: { stroke: 'rgb(99 102 241 / 0.4)', strokeWidth: 2 },
        }));

      setNodes(sanitizedNodes);
      setEdges(sanitizedEdges);

      // Fit view after a short delay
      setTimeout(() => {
        reactFlowInstance.current?.fitView?.({ padding: 0.2 });
      }, 100);
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [graphData, setNodes, setEdges]);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'rgb(99 102 241 / 0.5)', strokeWidth: 2 },
    }, eds));
  }, [setEdges]);

  // Add new topic node manually
  const addTopicNode = useCallback(() => {
    const viewport = reactFlowInstance.current?.getViewport?.() || { x: 0, y: 0, zoom: 1 };
    const newNode = {
      id: `custom-topic-${Date.now()}`,
      type: 'topicNode',
      position: { 
        x: (-viewport.x + 400) / (viewport.zoom || 1), 
        y: (-viewport.y + 300) / (viewport.zoom || 1) 
      },
      data: {
        label: 'New Topic',
        type: 'topic',
        connections: 0,
        editable: true,
      },
      draggable: true,
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  // Generate AI insight node
  const generateInsightNode = useCallback(() => {
    if (!messages || messages.length === 0) return;

    try {
      const topics = conversationEngine.extractTopics(messages, { maxTopics: 3 });
      const insightText = topics.length > 0 
        ? `Key themes: ${topics.map(t => t.name || t).join(', ')}. The conversation covers ${messages.length} messages across these areas.`
        : `This conversation has ${messages.length} messages and shows an evolving discussion.`;

      const viewport = reactFlowInstance.current?.getViewport?.() || { x: 0, y: 0, zoom: 1 };
      const newNode = {
        id: `insight-${Date.now()}`,
        type: 'insightNode',
        position: { 
          x: (-viewport.x + 350) / (viewport.zoom || 1), 
          y: (-viewport.y + 200) / (viewport.zoom || 1) 
        },
        data: {
          label: 'AI Insight',
          insight: insightText,
          confidence: 0.85,
        },
        draggable: true,
      };
      setNodes((nds) => [...nds, newNode]);
    } catch (err) {
      console.warn('Could not generate insight:', err);
    }
  }, [messages, setNodes]);

  // Save canvas state
  const saveCanvas = useCallback(() => {
    updateCanvasNodes(nodes);
    updateCanvasEdges(edges);
    const vp = reactFlowInstance.current?.getViewport?.();
    if (vp) setCanvasViewport(vp);
  }, [nodes, edges, updateCanvasNodes, updateCanvasEdges, setCanvasViewport]);

  // Filter nodes based on search
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;
    const query = searchQuery.toLowerCase();
    return nodes.filter(node => 
      node.data?.label?.toLowerCase().includes(query) ||
      node.data?.question?.toLowerCase().includes(query) ||
      node.data?.insight?.toLowerCase().includes(query)
    );
  }, [nodes, searchQuery]);

  const handleSubmit = async (message, options = {}) => {
    try {
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const currentModeConfig = CANVAS_MODES.find(m => m.id === canvasMode) || CANVAS_MODES[0];
  const CurrentModeIcon = currentModeConfig.icon;

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50 bg-forge-bg' : ''}`}>
      {/* Canvas area */}
      <div className="flex-1 relative min-h-0">
        {messages.length === 0 ? (
          <CanvasEmptyState onSendMessage={handleSubmit} />
        ) : (
          <>
            {/* Top Controls */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-surface-1/90 border border-border-subtle rounded-xl backdrop-blur-sm shadow-lg">
                {/* Search */}
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search nodes..."
                    className="pl-7 pr-2 py-1.5 w-36 bg-surface-2 border border-border-subtle rounded-lg text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary/50 transition-colors"
                  />
                </div>

                {/* Canvas mode selector */}
                <div className="relative">
                  <button
                    onClick={() => setShowModeMenu(!showModeMenu)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border border-border-subtle rounded-lg text-xs text-text-primary hover:bg-surface-3 transition-colors"
                  >
                    <CurrentModeIcon size={14} className="text-accent-primary" />
                    <span>{currentModeConfig.label}</span>
                  </button>
                  
                  <AnimatePresence>
                    {showModeMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute top-full left-0 mt-1 w-56 bg-surface-1 border border-border-subtle rounded-xl shadow-xl z-50 overflow-hidden"
                      >
                        {CANVAS_MODES.map((mode) => {
                          const ModeIcon = mode.icon;
                          return (
                            <button
                              key={mode.id}
                              onClick={() => { setCanvasMode(mode.id); setShowModeMenu(false); }}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                canvasMode === mode.id ? 'bg-accent-primary/10 text-accent-primary' : 'hover:bg-surface-2 text-text-primary'
                              }`}
                            >
                              <ModeIcon size={16} className={canvasMode === mode.id ? 'text-accent-primary' : 'text-text-muted'} />
                              <div>
                                <p className="text-xs font-medium">{mode.label}</p>
                                <p className="text-[10px] text-text-muted">{mode.desc}</p>
                              </div>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="w-px h-5 bg-border-subtle" />

                {/* Quick actions */}
                <button onClick={generateInsightNode} className="p-1.5 rounded-lg text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors" title="Generate AI insight">
                  <Brain size={15} />
                </button>
                <button onClick={addTopicNode} className="p-1.5 rounded-lg text-text-muted hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="Add topic node">
                  <Plus size={15} />
                </button>
                <button onClick={() => setShowMiniMap(!showMiniMap)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors" title="Toggle minimap">
                  {showMiniMap ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors" title="Toggle fullscreen">
                  {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
            </div>

            {/* Right-side tools */}
            <div className="absolute top-3 right-3 z-10">
              <div className="flex flex-col gap-1.5 px-2 py-2 bg-surface-1/90 border border-border-subtle rounded-xl backdrop-blur-sm shadow-lg">
                <button onClick={saveCanvas} className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors" title="Save canvas layout">
                  <Save size={13} />
                  <span>Save</span>
                </button>
                <button onClick={() => reactFlowInstance.current?.fitView?.({ padding: 0.2 })} className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors" title="Fit to view">
                  <RotateCcw size={13} />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {/* Node count indicator */}
            <div className="absolute bottom-20 left-3 z-10">
              <div className="px-3 py-1.5 bg-surface-1/80 border border-border-subtle rounded-lg backdrop-blur-sm text-xs text-text-muted">
                {filteredNodes.length} nodes • {edges.length} connections
              </div>
            </div>

            {/* React Flow Canvas */}
            <div ref={reactFlowWrapper} className="h-full">
              <ReactFlow
                nodes={filteredNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onInit={(instance) => {
                  reactFlowInstance.current = instance;
                  if (canvasViewport.zoom !== 1) {
                    instance.setViewport(canvasViewport);
                  }
                }}
                onPaneClick={() => { setSelectedNode(null); setShowModeMenu(false); }}
                nodeTypes={nodeTypes}
                fitView
                attributionPosition="bottom-left"
                className="conversation-canvas"
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#374151" gap={24} size={1} />
                
                <Controls 
                  className="bg-surface-1/80 border border-border-subtle rounded-lg"
                  showZoom={true}
                  showFitView={true}
                  showInteractive={true}
                />
                
                {showMiniMap && (
                  <MiniMap
                    className="bg-surface-1/80 border border-border-subtle rounded-lg"
                    nodeColor={(node) => {
                      switch (node.type) {
                        case 'conversation_cluster': return '#6366f1';
                        case 'topicNode': return '#10b981';
                        case 'insightNode': return '#f59e0b';
                        case 'questionNode': return '#ec4899';
                        default: return '#6b7280';
                      }
                    }}
                    maskColor="rgba(0,0,0,0.6)"
                  />
                )}
              </ReactFlow>
            </div>
          </>
        )}

        {/* Selected Node Details */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="absolute top-0 right-0 w-80 h-full bg-surface-1/95 border-l border-border-subtle backdrop-blur-sm overflow-y-auto z-20"
            >
              <NodeDetailsPanel 
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
                onSendMessage={sendMessage}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Smart input at the bottom */}
      <div className="border-t border-border-subtle bg-surface-0/80 backdrop-blur-sm relative z-30">
        <div className="max-w-4xl mx-auto p-3">
          <SmartInput onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}

/**
 * Build conversation flow nodes (Q&A pairs connected in sequence)
 */
function buildConversationFlow(messages) {
  const nodes = [];
  const edges = [];
  let currentCluster = [];
  let clusterIndex = 0;

  messages.forEach((message) => {
    if (message.role === 'user' && currentCluster.length > 0) {
      const node = createFlowNode(currentCluster, clusterIndex);
      if (node) nodes.push(node);
      currentCluster = [message];
      clusterIndex++;
    } else {
      currentCluster.push(message);
    }
  });

  if (currentCluster.length > 0) {
    const node = createFlowNode(currentCluster, clusterIndex);
    if (node) nodes.push(node);
  }

  // Create sequential edges
  for (let i = 1; i < nodes.length; i++) {
    edges.push({
      id: `flow-edge-${i}`,
      source: nodes[i - 1].id,
      target: nodes[i].id,
    });
  }

  return { nodes, edges };
}

function createFlowNode(cluster, index) {
  const userMsg = cluster.find(m => m.role === 'user');
  const assistantMsgs = cluster.filter(m => m.role === 'assistant');
  if (!userMsg) return null;

  const col = index % 3;
  const row = Math.floor(index / 3);

  return {
    id: `cluster-${index}`,
    type: 'conversation_cluster',
    data: {
      label: userMsg.content.length > 60 ? userMsg.content.substring(0, 60) + '...' : userMsg.content,
      question: userMsg.content,
      responses: assistantMsgs.map(m => m.content),
      messageCount: cluster.length,
      timestamp: userMsg.created_at,
    },
    position: { x: col * 350, y: row * 200 },
  };
}

/**
 * Build topic map nodes (grouped by extracted themes)
 */
function buildTopicMap(messages) {
  const nodes = [];
  const edges = [];

  try {
    const topics = conversationEngine.extractTopics(messages, { maxTopics: 8 });
    
    if (topics.length === 0) {
      // Fallback: create a single node with all messages
      nodes.push({
        id: 'all-messages',
        type: 'topicNode',
        data: { label: 'All Messages', connections: messages.length },
        position: { x: 200, y: 200 },
      });
      return { nodes, edges };
    }

    // Create topic nodes in a circle layout
    const radius = 250;
    const centerX = 400;
    const centerY = 300;

    topics.forEach((topic, idx) => {
      const angle = (idx / topics.length) * 2 * Math.PI - Math.PI / 2;
      const topicName = topic.name || topic;
      nodes.push({
        id: `topic-${idx}`,
        type: 'topicNode',
        data: { 
          label: typeof topicName === 'string' ? topicName.charAt(0).toUpperCase() + topicName.slice(1) : `Topic ${idx + 1}`,
          connections: topic.count || Math.ceil(messages.length / topics.length),
        },
        position: { 
          x: centerX + Math.cos(angle) * radius, 
          y: centerY + Math.sin(angle) * radius 
        },
      });
    });

    // Connect nearby topics
    for (let i = 0; i < nodes.length; i++) {
      const next = (i + 1) % nodes.length;
      edges.push({
        id: `topic-edge-${i}`,
        source: nodes[i].id,
        target: nodes[next].id,
      });
    }
  } catch (err) {
    console.warn('Topic extraction failed:', err);
  }

  return { nodes, edges };
}

/**
 * Empty state for canvas
 */
function CanvasEmptyState({ onSendMessage }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-md"
      >
        <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
          <Layout size={32} className="text-emerald-400" />
        </div>
        <h3 className="text-xl font-semibold text-text-primary mb-3">Visual Canvas</h3>
        <p className="text-sm text-text-muted mb-6 leading-relaxed">
          Start a conversation to see it visualized as an interactive mind map.
          Each Q&A becomes a node you can explore, connect, and rearrange.
        </p>
        <div className="flex flex-col gap-2">
          {[
            'Compare REST vs GraphQL APIs',
            'Explain the solar system',
            'Design a mobile app architecture',
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSendMessage(prompt)}
              className="flex items-center gap-3 px-4 py-3 bg-surface-1 border border-border-subtle hover:border-emerald-500/30 rounded-xl text-sm text-text-secondary hover:text-text-primary transition-all group"
            >
              <ArrowRight size={14} className="text-text-muted group-hover:text-emerald-400 transition-colors" />
              {prompt}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Custom node component for conversation clusters
 */
function ConversationClusterNode({ data, selected }) {
  return (
    <motion.div
      className={`px-4 py-3 rounded-xl border-2 bg-surface-1 shadow-lg cursor-pointer transition-all max-w-[280px] ${
        selected 
          ? 'border-indigo-400 shadow-indigo-400/20' 
          : 'border-border-subtle hover:border-indigo-400/50'
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <MessageSquare size={14} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-text-primary mb-1 line-clamp-2 leading-relaxed">
            {data.label}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            <span>{data.messageCount} msgs</span>
            {data.responses?.length > 0 && (
              <>
                <span className="text-border-emphasis">•</span>
                <span>{data.responses.length} response{data.responses.length !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Custom node for topics
 */
function TopicNode({ data, selected }) {
  return (
    <motion.div
      className={`px-4 py-2.5 rounded-full border-2 bg-emerald-500/10 cursor-pointer transition-all ${
        selected 
          ? 'border-emerald-400 shadow-emerald-400/20 shadow-lg' 
          : 'border-emerald-500/30 hover:border-emerald-400/50'
      }`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <div className="flex items-center gap-2">
        <Lightbulb size={14} className="text-emerald-400" />
        <span className="text-sm font-medium text-text-primary">{data.label}</span>
        {data.connections > 0 && (
          <span className="text-[10px] text-text-muted bg-surface-2 rounded-full px-1.5 py-0.5">
            {data.connections}
          </span>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Custom node for AI insights
 */
function InsightNode({ data, selected }) {
  return (
    <motion.div
      className={`px-4 py-3 rounded-xl border-2 bg-amber-500/10 cursor-pointer transition-all max-w-[260px] ${
        selected 
          ? 'border-amber-400 shadow-amber-400/20 shadow-lg' 
          : 'border-amber-500/30 hover:border-amber-400/50'
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-2">
        <Brain size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-semibold text-amber-300 mb-1">{data.label}</h4>
          <p className="text-[11px] text-text-muted line-clamp-3 leading-relaxed">{data.insight}</p>
          <div className="mt-1.5 flex items-center gap-1">
            <div className="h-1 flex-1 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-amber-400/60 rounded-full" style={{ width: `${(data.confidence || 0) * 100}%` }} />
            </div>
            <span className="text-[9px] text-amber-400">{Math.round((data.confidence || 0) * 100)}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Custom node for questions/prompts
 */
function QuestionNode({ data, selected }) {
  return (
    <motion.div
      className={`px-3 py-2 rounded-xl border-2 bg-pink-500/10 cursor-pointer transition-all max-w-[220px] ${
        selected 
          ? 'border-pink-400 shadow-pink-400/20 shadow-lg' 
          : 'border-pink-500/30 hover:border-pink-400/50'
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-2">
        <MessageSquare size={14} className="text-pink-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-text-primary line-clamp-3 leading-relaxed">
          {data.question || data.label}
        </p>
      </div>
    </motion.div>
  );
}

/**
 * Node details panel
 */
function NodeDetailsPanel({ node, onClose, onSendMessage }) {
  const handleExplore = () => {
    let prompt = '';
    switch (node.type) {
      case 'conversation_cluster':
        prompt = `Let's explore the topic we discussed: "${node.data.question}"`;
        break;
      case 'topicNode':
        prompt = `Tell me more about ${node.data.label}. What are some interesting aspects or questions we could explore?`;
        break;
      case 'insightNode':
        prompt = `I'd like to explore this insight further: "${node.data.insight}"`;
        break;
      case 'questionNode':
        prompt = node.data.question || node.data.label;
        break;
      default:
        prompt = `Let's discuss ${node.data.label}`;
    }
    onSendMessage(prompt);
    onClose();
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">Node Details</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {/* Node type badge */}
        <div className="flex items-center gap-2">
          {node.type === 'conversation_cluster' && <div className="px-2 py-1 rounded-md bg-indigo-500/20 text-indigo-400 text-xs font-medium">Conversation</div>}
          {node.type === 'topicNode' && <div className="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 text-xs font-medium">Topic</div>}
          {node.type === 'insightNode' && <div className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-400 text-xs font-medium">AI Insight</div>}
          {node.type === 'questionNode' && <div className="px-2 py-1 rounded-md bg-pink-500/20 text-pink-400 text-xs font-medium">Question</div>}
        </div>

        {/* Node content */}
        <div className="p-3 bg-surface-2/50 rounded-xl space-y-3">
          <h4 className="text-sm font-medium text-text-primary">{node.data.label}</h4>
          
          {node.data.question && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Question</p>
              <p className="text-sm text-text-secondary leading-relaxed">{node.data.question}</p>
            </div>
          )}
          
          {node.data.insight && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Insight</p>
              <p className="text-sm text-text-secondary leading-relaxed">{node.data.insight}</p>
            </div>
          )}
          
          {node.data.responses && node.data.responses.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                Responses ({node.data.responses.length})
              </p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {node.data.responses.map((response, index) => (
                  <p key={index} className="text-xs text-text-secondary line-clamp-4 p-2 bg-surface-1 rounded-lg leading-relaxed">
                    {response}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={handleExplore}
            className="w-full px-4 py-2.5 bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Search size={14} />
            Explore This Topic
          </button>
          
          {node.type === 'conversation_cluster' && (
            <button
              onClick={() => {
                onSendMessage(`Can you provide alternative perspectives on: "${node.data.question}"`);
                onClose();
              }}
              className="w-full px-4 py-2.5 bg-surface-2 hover:bg-surface-3 text-text-primary rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Zap size={14} />
              Alternative Views
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CanvasView;
