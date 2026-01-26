import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  ReactFlow, 
  MiniMap, 
  Controls, 
  Background,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Network,
  Brain,
  MessageSquare,
  Lightbulb,
  Search,
  Filter,
  Layers,
  Zap,
  TrendingUp,
  Clock,
  Star,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Download,
  Share,
  RotateCcw,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { useCasualStore } from '../../stores/casualStore';
import conversationEngine from '../../services/conversationEngine';

/**
 * Knowledge Web - Visual graph of all conversations and their interconnections
 * Shows the evolution of your knowledge and thinking patterns over time
 */
export function KnowledgeWeb({ className = '' }) {
  const { conversations } = useAppStore();
  const { conversationIndex, conversationConnections } = useCasualStore();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [viewMode, setViewMode] = useState('topics'); // 'topics' | 'conversations' | 'timeline' | 'insights'
  const [filterBy, setFilterBy] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState('medium');

  const reactFlowInstance = useRef(null);

  // Build knowledge graph from all conversations
  const knowledgeGraph = useMemo(() => {
    if (!conversations || conversations.length === 0) {
      return { nodes: [], edges: [], clusters: [] };
    }

    // Process conversations to extract topics and relationships
    const processedConversations = conversations.map(conv => {
      const metadata = conversationIndex[conv.id] || {};
      const topics = metadata.topics || conversationEngine.extractTopics(conv.messages || [], { maxTopics: 5 });
      
      return {
        ...conv,
        topics,
        mood: metadata.mood || 'neutral',
        messageCount: metadata.messageCount || (conv.messages || []).length,
      };
    });

    // Find relationships between conversations
    const relationships = conversationEngine.findConversationRelationships(processedConversations);

    // Build nodes and edges based on view mode
    const { nodes, edges, clusters } = buildGraphForViewMode(processedConversations, relationships, viewMode);

    return { nodes, edges, clusters };
  }, [conversations, conversationIndex, viewMode]);

  // Update React Flow when knowledge graph changes
  useEffect(() => {
    setNodes(knowledgeGraph.nodes);
    setEdges(knowledgeGraph.edges);
  }, [knowledgeGraph, setNodes, setEdges]);

  // Filter nodes based on search and filters
  const filteredNodes = useMemo(() => {
    let filtered = nodes;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(node => 
        node.data?.label?.toLowerCase().includes(query) ||
        node.data?.topics?.some(topic => topic.toLowerCase().includes(query)) ||
        node.data?.summary?.toLowerCase().includes(query)
      );
    }

    // Apply category filter
    if (filterBy !== 'all') {
      filtered = filtered.filter(node => {
        switch (filterBy) {
          case 'recent':
            return node.data?.isRecent;
          case 'important':
            return node.data?.importance > 0.7;
          case 'connected':
            return node.data?.connectionCount > 2;
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [nodes, searchQuery, filterBy]);

  const handleNodeClick = useCallback((event, node) => {
    setSelectedCluster(node);
    
    // Highlight connected nodes
    const connectedEdges = edges.filter(edge => 
      edge.source === node.id || edge.target === node.id
    );
    const connectedNodeIds = new Set([
      ...connectedEdges.map(edge => edge.source),
      ...connectedEdges.map(edge => edge.target),
    ]);
    
    // Update node styles to highlight connections
    setNodes(currentNodes => 
      currentNodes.map(n => ({
        ...n,
        className: connectedNodeIds.has(n.id) ? 'highlighted' : 'dimmed',
      }))
    );
  }, [edges, setNodes]);

  const resetHighlights = useCallback(() => {
    setNodes(currentNodes => 
      currentNodes.map(n => ({
        ...n,
        className: '',
      }))
    );
    setSelectedCluster(null);
  }, [setNodes]);

  return (
    <div className={`h-full relative bg-forge-bg ${className} ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Controls Header */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
        <div className="flex items-center gap-3 bg-forge-surface/90 border border-forge-border rounded-lg p-2 backdrop-blur-sm">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search knowledge web..."
              className="pl-7 pr-2 py-1 w-40 bg-forge-bg border border-forge-border/30 rounded text-xs focus:outline-none focus:border-workspace-casual/50"
            />
          </div>

          {/* View mode */}
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            className="px-2 py-1 bg-forge-bg border border-forge-border/30 rounded text-xs focus:outline-none"
          >
            <option value="topics">Topic Clusters</option>
            <option value="conversations">Conversation Network</option>
            <option value="timeline">Timeline Flow</option>
            <option value="insights">Insight Mapping</option>
          </select>

          {/* Filter */}
          <select
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value)}
            className="px-2 py-1 bg-forge-bg border border-forge-border/30 rounded text-xs focus:outline-none"
          >
            <option value="all">All Nodes</option>
            <option value="recent">Recent</option>
            <option value="important">Important</option>
            <option value="connected">Highly Connected</option>
          </select>
        </div>

        <div className="flex items-center gap-2 bg-forge-surface/90 border border-forge-border rounded-lg p-2 backdrop-blur-sm">
          <button
            onClick={() => setShowMiniMap(!showMiniMap)}
            className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
            title="Toggle minimap"
          >
            <Eye size={14} />
          </button>
          
          <button
            onClick={resetHighlights}
            className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
            title="Clear selection"
          >
            <RotateCcw size={14} />
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

      {/* Knowledge Graph */}
      <div className="h-full">
        <ReactFlow
          nodes={filteredNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={resetHighlights}
          onInit={(instance) => {
            reactFlowInstance.current = instance;
          }}
          nodeTypes={{
            topicCluster: TopicClusterNode,
            conversationNode: ConversationNode,
            insightNode: InsightWebNode,
            timelineNode: TimelineNode,
          }}
          fitView
          attributionPosition="bottom-left"
          className="knowledge-web-canvas"
        >
          <Background 
            color="#374151" 
            gap={viewMode === 'timeline' ? 50 : 20} 
            variant={viewMode === 'timeline' ? 'lines' : 'dots'}
          />
          
          <Controls 
            className="bg-forge-surface/80 border border-forge-border rounded-lg"
          />
          
          {showMiniMap && (
            <MiniMap
              className="bg-forge-surface/80 border border-forge-border rounded-lg"
              nodeColor={(node) => getNodeColor(node)}
              maskColor="rgb(15, 23, 42, 0.8)"
            />
          )}
        </ReactFlow>
      </div>

      {/* Selected Cluster Details */}
      <AnimatePresence>
        {selectedCluster && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="absolute bottom-4 left-4 right-4 bg-forge-surface/95 border border-forge-border rounded-lg p-4 backdrop-blur-sm shadow-xl max-h-48 overflow-y-auto"
          >
            <ClusterDetailsPanel 
              cluster={selectedCluster}
              onClose={() => setSelectedCluster(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-forge-surface/90 border border-forge-border rounded-lg p-3 backdrop-blur-sm">
        <h4 className="text-xs font-medium text-text-primary mb-2">Legend</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-workspace-casual"></div>
            <span className="text-text-muted">Conversations</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
            <span className="text-text-muted">Topics</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-400"></div>
            <span className="text-text-muted">Insights</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Custom node components
function TopicClusterNode({ data, selected }) {
  return (
    <motion.div
      className={`px-3 py-2 rounded-lg border-2 bg-emerald-500/10 cursor-pointer transition-all ${
        selected ? 'border-emerald-400 shadow-emerald-400/20' : 'border-emerald-500/30'
      }`}
      whileHover={{ scale: 1.05 }}
    >
      <div className="flex items-center gap-2">
        <Lightbulb size={16} className="text-emerald-400" />
        <div>
          <h3 className="text-sm font-medium text-text-primary">{data.label}</h3>
          <p className="text-xs text-text-muted">{data.conversationCount} conversations</p>
        </div>
      </div>
    </motion.div>
  );
}

function ConversationNode({ data, selected }) {
  return (
    <motion.div
      className={`px-3 py-2 rounded-lg border-2 bg-workspace-casual/10 cursor-pointer transition-all max-w-[200px] ${
        selected ? 'border-workspace-casual shadow-workspace-casual/20' : 'border-workspace-casual/30'
      }`}
      whileHover={{ scale: 1.02 }}
    >
      <div className="flex items-start gap-2">
        <MessageSquare size={14} className="text-workspace-casual mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-medium text-text-primary line-clamp-2 mb-1">
            {data.title || data.summary}
          </h3>
          <div className="flex items-center gap-1 text-[10px] text-text-muted">
            <span>{data.messageCount} msg</span>
            <span>•</span>
            <span>{data.topicCount} topics</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function InsightWebNode({ data, selected }) {
  return (
    <motion.div
      className={`px-2 py-1.5 rounded border-2 bg-amber-500/10 cursor-pointer transition-all ${
        selected ? 'border-amber-400 shadow-amber-400/20' : 'border-amber-500/30'
      }`}
      whileHover={{ scale: 1.05 }}
    >
      <div className="flex items-center gap-1">
        <Brain size={12} className="text-amber-400" />
        <span className="text-xs font-medium text-text-primary">{data.label}</span>
      </div>
    </motion.div>
  );
}

function TimelineNode({ data, selected }) {
  return (
    <motion.div
      className={`px-2 py-1 rounded-full border-2 bg-blue-500/10 cursor-pointer transition-all ${
        selected ? 'border-blue-400 shadow-blue-400/20' : 'border-blue-500/30'
      }`}
      whileHover={{ scale: 1.1 }}
    >
      <div className="flex items-center gap-1">
        <Clock size={10} className="text-blue-400" />
        <span className="text-xs text-text-primary">{data.period}</span>
      </div>
    </motion.div>
  );
}

function ClusterDetailsPanel({ cluster, onClose }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">
          {cluster.data?.label || 'Knowledge Cluster'}
        </h3>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <p className="text-text-muted mb-1">Connections:</p>
          <p className="text-text-primary font-medium">{cluster.data?.connectionCount || 0}</p>
        </div>
        <div>
          <p className="text-text-muted mb-1">Importance:</p>
          <p className="text-text-primary font-medium">
            {cluster.data?.importance ? `${Math.round(cluster.data.importance * 100)}%` : 'Unknown'}
          </p>
        </div>
        <div>
          <p className="text-text-muted mb-1">Last Updated:</p>
          <p className="text-text-primary font-medium">
            {cluster.data?.lastUpdated ? new Date(cluster.data.lastUpdated).toLocaleDateString() : 'Unknown'}
          </p>
        </div>
        <div>
          <p className="text-text-muted mb-1">Type:</p>
          <p className="text-text-primary font-medium capitalize">{cluster.type?.replace(/([A-Z])/g, ' $1') || 'Node'}</p>
        </div>
      </div>

      {cluster.data?.topics && cluster.data.topics.length > 0 && (
        <div className="mt-3">
          <p className="text-text-muted mb-2 text-xs">Related Topics:</p>
          <div className="flex flex-wrap gap-1">
            {cluster.data.topics.map((topic, index) => (
              <span
                key={index}
                className="px-2 py-0.5 bg-workspace-casual/20 text-workspace-casual rounded text-[10px]"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {cluster.data?.summary && (
        <div className="mt-3">
          <p className="text-text-muted mb-1 text-xs">Summary:</p>
          <p className="text-text-primary text-xs">{cluster.data.summary}</p>
        </div>
      )}
    </div>
  );
}

// Helper functions
function buildGraphForViewMode(conversations, relationships, viewMode) {
  const nodes = [];
  const edges = [];
  const clusters = [];

  switch (viewMode) {
    case 'topics':
      return buildTopicGraph(conversations, relationships);
    case 'conversations':
      return buildConversationGraph(conversations, relationships);
    case 'timeline':
      return buildTimelineGraph(conversations);
    case 'insights':
      return buildInsightGraph(conversations, relationships);
    default:
      return { nodes, edges, clusters };
  }
}

function buildTopicGraph(conversations, relationships) {
  const topicClusters = {};
  const nodes = [];
  const edges = [];

  // Group conversations by topics
  conversations.forEach(conv => {
    (conv.topics || []).forEach(topic => {
      const topicName = topic.name || topic;
      if (!topicClusters[topicName]) {
        topicClusters[topicName] = {
          name: topicName,
          conversations: [],
          totalMessages: 0,
          avgMood: 'neutral',
        };
      }
      topicClusters[topicName].conversations.push(conv);
      topicClusters[topicName].totalMessages += conv.messageCount || 0;
    });
  });

  // Create topic nodes
  Object.entries(topicClusters).forEach(([topicName, cluster], index) => {
    const angle = (index / Object.keys(topicClusters).length) * Math.PI * 2;
    const radius = 200 + (cluster.conversations.length * 20);
    
    nodes.push({
      id: `topic-${topicName}`,
      type: 'topicCluster',
      position: {
        x: Math.cos(angle) * radius + 400,
        y: Math.sin(angle) * radius + 300,
      },
      data: {
        label: topicName,
        conversationCount: cluster.conversations.length,
        messageCount: cluster.totalMessages,
        topics: [topicName],
        importance: cluster.conversations.length / conversations.length,
        connectionCount: cluster.conversations.length,
      },
    });
  });

  // Create edges between related topics
  relationships.forEach(rel => {
    const sourceConv = conversations.find(c => c.id === rel.source);
    const targetConv = conversations.find(c => c.id === rel.target);
    
    if (sourceConv && targetConv && rel.sharedTopics.length > 0) {
      rel.sharedTopics.forEach(sharedTopic => {
        const sourceNodeId = `topic-${sharedTopic}`;
        const targetNodeId = `topic-${sharedTopic}`;
        
        if (sourceNodeId !== targetNodeId) {
          edges.push({
            id: `edge-${sourceNodeId}-${targetNodeId}`,
            source: sourceNodeId,
            target: targetNodeId,
            type: 'smoothstep',
            animated: rel.strength > 0.7,
            style: { 
              stroke: `rgba(99, 102, 241, ${rel.strength})`,
              strokeWidth: 1 + rel.strength * 2,
            },
          });
        }
      });
    }
  });

  return { nodes, edges, clusters: Object.values(topicClusters) };
}

function buildConversationGraph(conversations, relationships) {
  const nodes = conversations.map((conv, index) => ({
    id: conv.id,
    type: 'conversationNode',
    position: {
      x: (index % 5) * 250 + Math.random() * 50,
      y: Math.floor(index / 5) * 150 + Math.random() * 30,
    },
    data: {
      label: conv.title || conversationEngine.generateConversationSummary(conv.messages || []),
      title: conv.title,
      summary: conversationEngine.generateConversationSummary(conv.messages || []),
      messageCount: (conv.messages || []).length,
      topicCount: (conv.topics || []).length,
      mood: conv.mood || 'neutral',
      lastUpdated: conv.updated_at,
      isRecent: new Date(conv.updated_at || 0) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
  }));

  const edges = relationships.map(rel => ({
    id: rel.id,
    source: rel.source,
    target: rel.target,
    type: 'smoothstep',
    animated: rel.strength > 0.6,
    style: {
      stroke: rel.type === 'strong' ? 'rgb(99 102 241)' : 
             rel.type === 'medium' ? 'rgb(99 102 241 / 0.7)' : 
             'rgb(99 102 241 / 0.4)',
      strokeWidth: rel.strength * 3,
    },
    label: rel.sharedTopics.join(', '),
  }));

  return { nodes, edges, clusters: [] };
}

function buildTimelineGraph(conversations) {
  // Sort conversations by date
  const sortedConvs = [...conversations].sort((a, b) => 
    new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );

  const nodes = sortedConvs.map((conv, index) => ({
    id: conv.id,
    type: 'timelineNode',
    position: {
      x: index * 200 + 100,
      y: 300 + Math.sin(index * 0.3) * 100, // Wavy timeline
    },
    data: {
      label: conv.title || conversationEngine.generateConversationSummary(conv.messages || []),
      period: new Date(conv.created_at || 0).toLocaleDateString(),
      messageCount: (conv.messages || []).length,
      isRecent: index >= sortedConvs.length - 5,
    },
  }));

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `timeline-${i}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      type: 'smoothstep',
      style: { stroke: 'rgb(99 102 241 / 0.5)' },
    });
  }

  return { nodes, edges, clusters: [] };
}

function buildInsightGraph(conversations, relationships) {
  // Create insight nodes from conversation analysis
  const insights = conversationEngine.generateConversationInsights(conversations);
  const nodes = [];
  const edges = [];

  // Central insight node
  nodes.push({
    id: 'central-insight',
    type: 'insightNode',
    position: { x: 400, y: 300 },
    data: {
      label: 'Knowledge Center',
      insight: `${insights.totalConversations} conversations, ${insights.topTopics.length} main topics`,
      importance: 1.0,
    },
  });

  // Topic insight nodes
  insights.topTopics.slice(0, 8).forEach((topic, index) => {
    const angle = (index / 8) * Math.PI * 2;
    const radius = 150;
    
    nodes.push({
      id: `insight-${topic.name}`,
      type: 'insightNode',
      position: {
        x: 400 + Math.cos(angle) * radius,
        y: 300 + Math.sin(angle) * radius,
      },
      data: {
        label: topic.name,
        insight: `Discussed in ${Math.round(topic.score)} conversations`,
        importance: topic.score / insights.totalConversations,
      },
    });

    // Connect to center
    edges.push({
      id: `edge-center-${topic.name}`,
      source: 'central-insight',
      target: `insight-${topic.name}`,
      type: 'smoothstep',
      style: { stroke: `rgba(245, 158, 11, ${topic.score / insights.topTopics[0].score})` },
    });
  });

  return { nodes, edges, clusters: [] };
}

function getNodeColor(node) {
  switch (node.type) {
    case 'topicCluster': return '#10b981';
    case 'conversationNode': return '#6366f1';
    case 'insightNode': return '#f59e0b';
    case 'timelineNode': return '#3b82f6';
    default: return '#6b7280';
  }
}

export default KnowledgeWeb;








