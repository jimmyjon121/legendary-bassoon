import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  DNA, 
  TrendingUp, 
  Heart, 
  Brain, 
  Zap, 
  MessageSquare,
  Clock,
  Activity,
  BarChart3,
  Info,
  Eye,
  EyeOff
} from 'lucide-react';
import conversationEngine from '../../services/conversationEngine';

/**
 * Visual DNA representation of a conversation showing its evolution,
 * complexity, mood, and unique characteristics
 */
export function ConversationDNA({ 
  messages = [], 
  className = '',
  size = 'md', // 'sm', 'md', 'lg'
  interactive = true,
  showDetails = false
}) {
  const [hoveredSegment, setHoveredSegment] = useState(null);
  const [detailsVisible, setDetailsVisible] = useState(showDetails);

  // Analyze conversation to generate DNA data
  const dnaData = useMemo(() => {
    if (!messages || messages.length === 0) {
      return {
        segments: [],
        complexity: 0,
        diversity: 0,
        engagement: 0,
        evolution: [],
        characteristics: {},
      };
    }

    // Divide conversation into segments (every 5-10 messages)
    const segmentSize = Math.max(3, Math.min(10, Math.floor(messages.length / 8)));
    const segments = [];
    
    for (let i = 0; i < messages.length; i += segmentSize) {
      const segmentMessages = messages.slice(i, i + segmentSize);
      const topics = conversationEngine.extractTopics(segmentMessages, { maxTopics: 3 });
      const mood = conversationEngine.analyzeConversationMood(segmentMessages);
      
      // Calculate segment characteristics
      const complexity = calculateComplexity(segmentMessages);
      const engagement = calculateEngagement(segmentMessages);
      const novelty = calculateNovelty(segmentMessages, messages.slice(0, i));
      
      segments.push({
        id: `segment-${i}`,
        startIndex: i,
        endIndex: Math.min(i + segmentSize - 1, messages.length - 1),
        messageCount: segmentMessages.length,
        topics,
        mood: mood.overall,
        complexity,
        engagement,
        novelty,
        timestamp: segmentMessages[0].created_at,
      });
    }

    // Calculate overall metrics
    const overallComplexity = segments.reduce((sum, s) => sum + s.complexity, 0) / segments.length;
    const topicDiversity = calculateTopicDiversity(segments);
    const engagementLevel = segments.reduce((sum, s) => sum + s.engagement, 0) / segments.length;

    // Track conversation evolution
    const evolution = segments.map((segment, index) => ({
      phase: index + 1,
      primaryTopic: segment.topics[0]?.name || 'general',
      mood: segment.mood,
      complexity: segment.complexity,
      novelty: segment.novelty,
    }));

    return {
      segments,
      complexity: overallComplexity,
      diversity: topicDiversity,
      engagement: engagementLevel,
      evolution,
      characteristics: extractCharacteristics(segments),
    };
  }, [messages]);

  const sizeConfig = {
    sm: { width: 200, height: 60, segmentHeight: 40 },
    md: { width: 300, height: 80, segmentHeight: 60 },
    lg: { width: 400, height: 100, segmentHeight: 80 },
  };

  const config = sizeConfig[size] || sizeConfig.md;

  if (dnaData.segments.length === 0) {
    return (
      <div className={`flex items-center gap-2 text-text-muted ${className}`}>
        <DNA size={16} />
        <span className="text-xs">No conversation data</span>
      </div>
    );
  }

  return (
    <div className={`conversation-dna ${className}`}>
      {/* DNA Visualization */}
      <div className="relative" style={{ width: config.width, height: config.height }}>
        <svg width={config.width} height={config.height} className="overflow-visible">
          {/* DNA double helix structure */}
          {dnaData.segments.map((segment, index) => {
            const x = (index / dnaData.segments.length) * (config.width - 40) + 20;
            const isHovered = hoveredSegment === segment.id;
            
            // Calculate helix positions
            const angle1 = (index / dnaData.segments.length) * Math.PI * 4;
            const angle2 = angle1 + Math.PI;
            const y1 = config.height * 0.3 + Math.sin(angle1) * 15;
            const y2 = config.height * 0.7 + Math.sin(angle2) * 15;
            
            // Colors based on mood and complexity
            const getSegmentColor = () => {
              if (segment.mood === 'positive') return '#10b981'; // emerald
              if (segment.mood === 'negative') return '#ef4444'; // red
              if (segment.complexity > 0.7) return '#8b5cf6'; // purple (complex)
              if (segment.engagement > 0.8) return '#f59e0b'; // amber (engaging)
              return '#6b7280'; // gray (neutral)
            };
            
            const color = getSegmentColor();
            
            return (
              <g key={segment.id}>
                {/* DNA strand nodes */}
                <motion.circle
                  cx={x}
                  cy={y1}
                  r={isHovered ? 6 : 4}
                  fill={color}
                  opacity={isHovered ? 1 : 0.8}
                  className="cursor-pointer"
                  onMouseEnter={() => interactive && setHoveredSegment(segment.id)}
                  onMouseLeave={() => interactive && setHoveredSegment(null)}
                  whileHover={{ scale: 1.2 }}
                />
                <motion.circle
                  cx={x}
                  cy={y2}
                  r={isHovered ? 6 : 4}
                  fill={color}
                  opacity={isHovered ? 1 : 0.6}
                  className="cursor-pointer"
                  onMouseEnter={() => interactive && setHoveredSegment(segment.id)}
                  onMouseLeave={() => interactive && setHoveredSegment(null)}
                  whileHover={{ scale: 1.2 }}
                />
                
                {/* Connecting line */}
                <line
                  x1={x}
                  y1={y1}
                  x2={x}
                  y2={y2}
                  stroke={color}
                  strokeWidth={isHovered ? 3 : 2}
                  opacity={isHovered ? 0.8 : 0.4}
                />
                
                {/* Complexity indicator (line thickness varies) */}
                {index < dnaData.segments.length - 1 && (
                  <line
                    x1={x}
                    y1={y1}
                    x2={(index + 1) / dnaData.segments.length * (config.width - 40) + 20}
                    y2={config.height * 0.3 + Math.sin((index + 1) / dnaData.segments.length * Math.PI * 4) * 15}
                    stroke={color}
                    strokeWidth={1 + segment.complexity * 2}
                    opacity={0.3}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hoveredSegment && interactive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute z-10 bg-forge-surface border border-forge-border rounded-lg p-2 shadow-lg text-xs pointer-events-none"
            style={{
              left: '50%',
              top: '100%',
              transform: 'translateX(-50%)',
              marginTop: '8px',
            }}
          >
            {(() => {
              const segment = dnaData.segments.find(s => s.id === hoveredSegment);
              if (!segment) return null;
              
              return (
                <div className="space-y-1">
                  <div className="font-medium text-text-primary">
                    Messages {segment.startIndex + 1}-{segment.endIndex + 1}
                  </div>
                  <div className="text-text-muted">
                    Mood: {segment.mood} • Complexity: {Math.round(segment.complexity * 100)}%
                  </div>
                  {segment.topics.length > 0 && (
                    <div className="text-workspace-casual">
                      Topics: {segment.topics.map(t => t.name).join(', ')}
                    </div>
                  )}
                </div>
              );
            })()}
          </motion.div>
        )}
      </div>

      {/* DNA Metrics */}
      <div className="mt-3 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1 text-text-muted">
          <BarChart3 size={12} />
          <span>Complexity: {Math.round(dnaData.complexity * 100)}%</span>
        </div>
        <div className="flex items-center gap-1 text-text-muted">
          <TrendingUp size={12} />
          <span>Diversity: {Math.round(dnaData.diversity * 100)}%</span>
        </div>
        <div className="flex items-center gap-1 text-text-muted">
          <Activity size={12} />
          <span>Engagement: {Math.round(dnaData.engagement * 100)}%</span>
        </div>
        
        {interactive && (
          <button
            onClick={() => setDetailsVisible(!detailsVisible)}
            className="flex items-center gap-1 text-workspace-casual hover:text-workspace-casual/80 transition-colors ml-auto"
          >
            {detailsVisible ? <EyeOff size={12} /> : <Eye size={12} />}
            Details
          </button>
        )}
      </div>

      {/* Detailed analysis */}
      {detailsVisible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-3 p-3 bg-forge-bg/30 border border-forge-border/30 rounded-lg text-xs space-y-2"
        >
          <h4 className="font-medium text-text-primary flex items-center gap-1">
            <DNA size={12} />
            Conversation Characteristics
          </h4>
          
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(dnaData.characteristics).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="text-text-muted capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}:</span>
                <span className="text-text-primary">{value}</span>
              </div>
            ))}
          </div>
          
          {dnaData.evolution.length > 0 && (
            <div>
              <h5 className="font-medium text-text-primary mb-1">Evolution Path</h5>
              <div className="space-y-1">
                {dnaData.evolution.map((phase, index) => (
                  <div key={index} className="flex items-center gap-2 text-text-muted">
                    <span className="w-4 text-center">{phase.phase}</span>
                    <span className="flex-1 truncate">{phase.primaryTopic}</span>
                    <span className={`text-[10px] ${
                      phase.mood === 'positive' ? 'text-green-400' :
                      phase.mood === 'negative' ? 'text-red-400' :
                      'text-text-muted'
                    }`}>
                      {phase.mood}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// Helper functions for DNA analysis
function calculateComplexity(messages) {
  if (!messages || messages.length === 0) return 0;
  
  const avgLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / messages.length;
  const questionCount = messages.filter(m => m.content?.includes('?')).length;
  const codeBlocks = messages.filter(m => m.content?.includes('```')).length;
  const technicalTerms = messages.filter(m => 
    /\b(algorithm|function|variable|method|class|interface|api|database|server|client)\b/i.test(m.content || '')
  ).length;
  
  // Normalize factors
  const lengthFactor = Math.min(1, avgLength / 200);
  const questionFactor = Math.min(1, questionCount / messages.length);
  const codeFactor = Math.min(1, codeBlocks / Math.max(1, messages.length * 0.5));
  const techFactor = Math.min(1, technicalTerms / Math.max(1, messages.length * 0.3));
  
  return (lengthFactor + questionFactor + codeFactor + techFactor) / 4;
}

function calculateEngagement(messages) {
  if (!messages || messages.length === 0) return 0;
  
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  
  // Engagement factors
  const responseRatio = userMessages.length > 0 ? assistantMessages.length / userMessages.length : 0;
  const avgUserLength = userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / Math.max(1, userMessages.length);
  const followUpQuestions = userMessages.filter((m, i) => i > 0 && m.content?.includes('?')).length;
  
  const responseRatioScore = Math.min(1, responseRatio);
  const lengthScore = Math.min(1, avgUserLength / 100);
  const followUpScore = Math.min(1, followUpQuestions / Math.max(1, userMessages.length));
  
  return (responseRatioScore + lengthScore + followUpScore) / 3;
}

function calculateNovelty(segmentMessages, previousMessages) {
  if (!segmentMessages || segmentMessages.length === 0) return 0.5;
  if (!previousMessages || previousMessages.length === 0) return 1;
  
  // Calculate how different this segment is from previous conversation
  const segmentTopics = conversationEngine.extractTopics(segmentMessages, { maxTopics: 5 });
  const previousTopics = conversationEngine.extractTopics(previousMessages, { maxTopics: 10 });
  
  const segmentTopicNames = new Set(segmentTopics.map(t => t.name));
  const previousTopicNames = new Set(previousTopics.map(t => t.name));
  
  const overlap = [...segmentTopicNames].filter(name => previousTopicNames.has(name)).length;
  const total = segmentTopicNames.size;
  
  return total > 0 ? 1 - (overlap / total) : 0.5;
}

function calculateTopicDiversity(segments) {
  const allTopics = new Set();
  segments.forEach(segment => {
    segment.topics.forEach(topic => allTopics.add(topic.name));
  });
  
  const averageTopicsPerSegment = segments.reduce((sum, s) => sum + s.topics.length, 0) / segments.length;
  
  return Math.min(1, (allTopics.size / (segments.length * 2)) + (averageTopicsPerSegment / 5));
}

function extractCharacteristics(segments) {
  if (segments.length === 0) return {};
  
  const characteristics = {};
  
  // Conversation style
  const avgComplexity = segments.reduce((sum, s) => sum + s.complexity, 0) / segments.length;
  if (avgComplexity > 0.7) {
    characteristics.style = 'Deep & Complex';
  } else if (avgComplexity > 0.4) {
    characteristics.style = 'Thoughtful';
  } else {
    characteristics.style = 'Casual';
  }
  
  // Dominant mood
  const moodCounts = {};
  segments.forEach(s => {
    moodCounts[s.mood] = (moodCounts[s.mood] || 0) + 1;
  });
  const dominantMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  characteristics.mood = dominantMood || 'neutral';
  
  // Evolution pattern
  const complexityTrend = segments.map(s => s.complexity);
  const isIncreasingComplexity = complexityTrend[complexityTrend.length - 1] > complexityTrend[0];
  characteristics.evolution = isIncreasingComplexity ? 'Deepening' : 'Simplifying';
  
  // Novelty pattern
  const avgNovelty = segments.reduce((sum, s) => sum + s.novelty, 0) / segments.length;
  if (avgNovelty > 0.7) {
    characteristics.exploration = 'Highly Exploratory';
  } else if (avgNovelty > 0.4) {
    characteristics.exploration = 'Moderately Exploratory';
  } else {
    characteristics.exploration = 'Focused';
  }
  
  return characteristics;
}

/**
 * Mini DNA component for conversation previews
 */
export function MiniConversationDNA({ messages = [], className = '' }) {
  const dnaData = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    
    const topics = conversationEngine.extractTopics(messages, { maxTopics: 3 });
    const mood = conversationEngine.analyzeConversationMood(messages);
    const complexity = calculateComplexity(messages);
    
    return { topics, mood: mood.overall, complexity };
  }, [messages]);

  if (!dnaData) {
    return <div className={`w-8 h-2 bg-forge-border/30 rounded ${className}`} />;
  }

  const getColor = () => {
    if (dnaData.mood === 'positive') return 'bg-green-400';
    if (dnaData.mood === 'negative') return 'bg-red-400';
    if (dnaData.complexity > 0.7) return 'bg-purple-400';
    return 'bg-workspace-casual';
  };

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all ${getColor()}`}
          style={{ 
            height: `${8 + Math.sin(i * 0.8) * 4}px`,
            opacity: 0.4 + (dnaData.complexity * 0.6),
          }}
        />
      ))}
    </div>
  );
}

export default ConversationDNA;











