import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  ReactFlow, 
  MiniMap, 
  Controls, 
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import { 
  MessageSquare, 
  Brain, 
  Lightbulb, 
  Heart, 
  Zap, 
  Plus,
  Search,
  Filter,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
  Share,
  Eye,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { useCasualStore } from '../../../stores/casualStore';
import conversationEngine from '../../../services/conversationEngine';

/**
 * Canvas View - Visual conversation mapping with nodes and connections
 * Think mind-mapping meets conversation flow
 */
export function CanvasView() {
  const { messages, conversations, sendMessage } = useAppStore();
  const { 
    canvasNodes, 
    canvasEdges, 
    canvasViewport,
    updateCanvasNodes,
    updateCanvasEdges,
    setCanvasViewport 
  } = useCasualStore();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [canvasMode, setCanvasMode] = useState('conversation'); // 'conversation' | 'topic' | 'hybrid'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const reactFlowWrapper = useRef(null);
  const reactFlowInstance = useRef(null);

  // Define node types (align with graph node type ids)
  const nodeTypes = useMemo(() => ({
    conversation_cluster: ConversationClusterNode,
    topicNode: TopicNode,
    insightNode: InsightNode,
    questionNode: QuestionNode,
  }), []);

  // Generate nodes and edges from current conversation
  const conversationGraph = useMemo(() => {
    if (!messages || messages.length === 0) {
      return { nodes: [], edges: [] };
    }

    return conversationEngine.buildConversationGraph(messages);
  }, [messages]);

  // Initialize canvas with conversation data (sanitize nodes/edges)
  useEffect(() => {
    if (conversationGraph.nodes.length > 0) {
      const sanitizedNodes = conversationGraph.nodes.map((node) => ({
        ...node,
        type: 'conversation_cluster',
        draggable: true,
      }));

      const nodeIdSet = new Set(sanitizedNodes.map((n) => n.id));
      const sanitizedEdges = conversationGraph.edges
        .filter((edge) => edge.source && edge.target && nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
        .map((edge, idx) => ({
          id: edge.id || `edge-${idx}`,
          source: edge.source,
          target: edge.target,
          // Normalize to default edge type to avoid missing custom types
          type: undefined,
          animated: true,
          style: { stroke: 'rgb(99 102 241 / 0.4)' },
        }));

      setNodes(sanitizedNodes);
      setEdges(sanitizedEdges);
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [conversationGraph, setNodes, setEdges]);

  // Handle node selection
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  // Handle connection creation
  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'rgb(99 102 241 / 0.5)' },
    }, eds));
  }, [setEdges]);

  // Add new topic node
  const addTopicNode = useCallback((topic) => {
    const newNode = {
      id: `topic-${Date.now()}`,
      type: 'topicNode',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: {
        label: topic,
        type: 'topic',
        connections: 0,
      },
      draggable: true,
    };

    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  // Generate insight node from AI analysis
  const generateInsightNode = useCallback(async () => {
    if (!messages || messages.length === 0) return;

    const insights = conversationEngine.generateConversationInsights(conversations || []);
    const topics = conversationEngine.extractTopics(messages, { maxTopics: 3 });

    const insightText = topics.length > 0 
      ? `Key insight: The conversation explores ${topics[0].name} with ${insights.totalConversations} related discussions`
      : 'This conversation shows interesting patterns in your thinking';

    const newNode = {
      id: `insight-${Date.now()}`,
      type: 'insightNode',
      position: { 
        x: Math.random() * 200 + 100, 
        y: Math.random() * 200 + 100 
      },
      data: {
        label: 'AI Insight',
        insight: insightText,
        confidence: 0.8,
      },
      draggable: true,
    };

    setNodes((nds) => [...nds, newNode]);
  }, [messages, conversations, setNodes]);

  // Save canvas state
  const saveCanvas = useCallback(() => {
    updateCanvasNodes(nodes);
    updateCanvasEdges(edges);
    setCanvasViewport({
      x: reactFlowInstance.current?.getViewport?.()?.x || 0,
      y: reactFlowInstance.current?.getViewport?.()?.y || 0,
      zoom: reactFlowInstance.current?.getViewport?.()?.zoom || 1,
    });
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

  return (
    <div className={`h-full relative ${isFullscreen ? 'fixed inset-0 z-50 bg-forge-bg' : ''}`}>
      {/* Canvas Controls */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <div className="bg-forge-surface/90 border border-forge-border rounded-lg p-2 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search canvas..."
                className="pl-7 pr-2 py-1 w-32 bg-forge-bg border border-forge-border/30 rounded text-xs focus:outline-none focus:border-workspace-casual/50"
              />
            </div>

            {/* Canvas mode */}
            <select
              value={canvasMode}
              onChange={(e) => setCanvasMode(e.target.value)}
              className="px-2 py-1 bg-forge-bg border border-forge-border/30 rounded text-xs focus:outline-none"
            >
              <option value="conversation">Conversation Flow</option>
              <option value="topic">Topic Mapping</option>
              <option value="hybrid">Hybrid View</option>
            </select>

            {/* Actions */}
            <button
              onClick={generateInsightNode}
              className="p-1 rounded text-text-muted hover:text-workspace-casual transition-colors"
              title="Generate AI insight"
            >
              <Brain size={14} />
            </button>

            <button
              onClick={() => setShowMiniMap(!showMiniMap)}
              className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
              title="Toggle minimap"
            >
              <Eye size={14} />
            </button>

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
              title="Toggle fullscreen"
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Tools */}
      <div className="absolute top-4 right-4 z-10">
        <div className="bg-forge-surface/90 border border-forge-border rounded-lg p-2 backdrop-blur-sm">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => addTopicNode('New Topic')}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-workspace-casual transition-colors"
              title="Add topic node"
            >
              <Plus size={12} />
              Topic
            </button>
            
            <button
              onClick={saveCanvas}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
              title="Save canvas"
            >
              <Save size={12} />
              Save
            </button>
            
            <button
              onClick={() => {
                // Reset to fit view
                reactFlowInstance.current?.fitView?.();
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
              title="Fit to view"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>
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
            // Restore viewport if saved
            if (canvasViewport.zoom !== 1) {
              instance.setViewport(canvasViewport);
            }
          }}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
          className="conversation-canvas"
        >
          <Background color="#374151" gap={20} />
          
          <Controls 
            className="bg-forge-surface/80 border border-forge-border rounded-lg"
            showZoom={true}
            showFitView={true}
            showInteractive={true}
          />
          
          {showMiniMap && (
            <MiniMap
              className="bg-forge-surface/80 border border-forge-border rounded-lg"
              nodeColor={(node) => {
                switch (node.type) {
                  case 'conversationCluster': return '#6366f1';
                  case 'topicNode': return '#10b981';
                  case 'insightNode': return '#f59e0b';
                  case 'questionNode': return '#ec4899';
                  default: return '#6b7280';
                }
              }}
            />
          )}
        </ReactFlow>
      </div>

      {/* Selected Node Details */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="absolute top-0 right-0 w-80 h-full bg-forge-surface/95 border-l border-forge-border backdrop-blur-sm overflow-y-auto"
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
  );
}

/**
 * Custom node component for conversation clusters
 */
function ConversationClusterNode({ data, selected }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      className={`px-4 py-3 rounded-lg border-2 bg-forge-surface shadow-lg cursor-pointer transition-all ${
        selected 
          ? 'border-workspace-casual shadow-workspace-casual/20' 
          : 'border-forge-border hover:border-workspace-casual/50'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-2 min-w-[200px] max-w-[300px]">
        <MessageSquare size={16} className="text-workspace-casual mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-text-primary mb-1 line-clamp-2">
            {data.label}
          </h3>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{data.messageCount} messages</span>
            <span>•</span>
            <span>{new Date(data.timestamp).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Connection points */}
      <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-workspace-casual rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-workspace-casual rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="absolute -left-1 top-1/2 transform -translate-y-1/2 w-2 h-2 bg-workspace-casual rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="absolute -right-1 top-1/2 transform -translate-y-1/2 w-2 h-2 bg-workspace-casual rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
    </motion.div>
  );
}

/**
 * Custom node for topics
 */
function TopicNode({ data, selected }) {
  return (
    <motion.div
      className={`px-3 py-2 rounded-full border-2 bg-emerald-500/10 cursor-pointer transition-all ${
        selected 
          ? 'border-emerald-400 shadow-emerald-400/20' 
          : 'border-emerald-500/30 hover:border-emerald-400/50'
      }`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <div className="flex items-center gap-2">
        <Lightbulb size={14} className="text-emerald-400" />
        <span className="text-sm font-medium text-text-primary">
          {data.label}
        </span>
        {data.connections > 0 && (
          <span className="text-xs text-text-muted bg-forge-bg/50 rounded-full px-1.5 py-0.5">
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
      className={`px-3 py-2 rounded-lg border-2 bg-amber-500/10 cursor-pointer transition-all max-w-[250px] ${
        selected 
          ? 'border-amber-400 shadow-amber-400/20' 
          : 'border-amber-500/30 hover:border-amber-400/50'
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-2">
        <Brain size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-medium text-text-primary mb-1">
            {data.label}
          </h4>
          <p className="text-[10px] text-text-muted line-clamp-2">
            {data.insight}
          </p>
          <div className="mt-1 text-[9px] text-amber-400">
            Confidence: {Math.round((data.confidence || 0) * 100)}%
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
      className={`px-3 py-2 rounded-lg border-2 bg-pink-500/10 cursor-pointer transition-all max-w-[200px] ${
        selected 
          ? 'border-pink-400 shadow-pink-400/20' 
          : 'border-pink-500/30 hover:border-pink-400/50'
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-start gap-2">
        <MessageSquare size={14} className="text-pink-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-primary line-clamp-3">
            {data.question || data.label}
          </p>
        </div>
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
      case 'conversationCluster':
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
        <h3 className="text-lg font-semibold text-text-primary">Node Details</h3>
        <button
          onClick={onClose}
          className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-4">
        {/* Node info */}
        <div className="p-3 bg-forge-bg/50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            {node.type === 'conversationCluster' && <MessageSquare size={16} className="text-workspace-casual" />}
            {node.type === 'topicNode' && <Lightbulb size={16} className="text-emerald-400" />}
            {node.type === 'insightNode' && <Brain size={16} className="text-amber-400" />}
            {node.type === 'questionNode' && <MessageSquare size={16} className="text-pink-400" />}
            <span className="text-sm font-medium text-text-primary">
              {node.data.label}
            </span>
          </div>
          
          {node.data.question && (
            <div className="mb-2">
              <p className="text-xs text-text-muted mb-1">Original Question:</p>
              <p className="text-sm text-text-primary">{node.data.question}</p>
            </div>
          )}
          
          {node.data.insight && (
            <div className="mb-2">
              <p className="text-xs text-text-muted mb-1">Insight:</p>
              <p className="text-sm text-text-primary">{node.data.insight}</p>
            </div>
          )}
          
          {node.data.responses && node.data.responses.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1">Responses ({node.data.responses.length}):</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {node.data.responses.map((response, index) => (
                  <p key={index} className="text-xs text-text-secondary line-clamp-2 p-1 bg-forge-surface/50 rounded">
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
            className="w-full px-3 py-2 bg-workspace-casual/20 hover:bg-workspace-casual/30 text-workspace-casual rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Search size={14} />
            Explore This Topic
          </button>
          
          {node.type === 'conversationCluster' && (
            <button
              onClick={() => {
                const prompt = `Can you provide alternative perspectives on: "${node.data.question}"`;
                onSendMessage(prompt);
                onClose();
              }}
              className="w-full px-3 py-2 bg-forge-elevated hover:bg-forge-hover text-text-primary rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
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



