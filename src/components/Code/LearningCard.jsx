/**
 * LearningCard Component
 * 
 * Collapsible card showing contextual learning opportunities
 * based on patterns detected in the current code.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getContextualLearning, SKILL_CATEGORIES } from '../../services/contextualLearning';

const LearningCard = ({ code, filePath, onApplyLesson }) => {
  const [opportunities, setOpportunities] = useState([]);
  const [expandedLesson, setExpandedLesson] = useState(null);
  const [showProgress, setShowProgress] = useState(false);
  const [statistics, setStatistics] = useState(null);

  useEffect(() => {
    const learning = getContextualLearning();
    
    // Initial analysis
    if (code) {
      learning.analyzeCode(code, filePath);
    }
    
    // Listen for changes
    const unsubscribe = learning.addListener((data) => {
      setOpportunities(data.opportunities);
      setStatistics(data.statistics);
    });

    // Get initial statistics
    setStatistics(learning.getStatistics());

    return () => unsubscribe();
  }, [code, filePath]);

  // Re-analyze when code changes (debounced)
  useEffect(() => {
    if (!code) return;
    
    const timer = setTimeout(() => {
      getContextualLearning().analyzeCode(code, filePath);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [code, filePath]);

  const handleCompleteLesson = useCallback((lessonId) => {
    getContextualLearning().completeLesson(lessonId);
    setExpandedLesson(null);
  }, []);

  const handleDismissLesson = useCallback((lessonId, e) => {
    e.stopPropagation();
    getContextualLearning().dismissLesson(lessonId);
  }, []);

  const handleApplyLesson = useCallback((lesson) => {
    onApplyLesson?.(lesson);
    handleCompleteLesson(lesson.id);
  }, [onApplyLesson, handleCompleteLesson]);

  // No opportunities detected
  if (opportunities.length === 0 && !showProgress) {
    return null;
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div 
        className="px-4 py-2 bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border-b border-gray-700 flex items-center justify-between cursor-pointer"
        onClick={() => setShowProgress(!showProgress)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🎓</span>
          <span className="text-sm font-medium text-gray-200">
            Learning Opportunities
          </span>
          {opportunities.length > 0 && (
            <span className="bg-indigo-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
              {opportunities.length}
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setShowProgress(!showProgress); }}
          className="text-xs text-gray-400 hover:text-gray-200"
        >
          {showProgress ? 'Hide Progress' : 'View Progress'}
        </button>
      </div>

      {/* Progress View */}
      {showProgress && statistics && (
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(statistics.skillProgress).map(([category, progress]) => (
              <div key={category} className="bg-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span>{progress.icon}</span>
                  <span className="text-sm font-medium text-gray-200">{progress.name}</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">{progress.percentage}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs capitalize ${
                    progress.level === 'advanced' ? 'text-purple-400' :
                    progress.level === 'intermediate' ? 'text-indigo-400' :
                    'text-gray-400'
                  }`}>
                    {progress.level}
                  </span>
                  <span className="text-xs text-gray-500">
                    {progress.completedLessons}/{progress.totalLessons} lessons
                  </span>
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-3 text-center">
            <span className="text-xs text-gray-400">
              Total: {statistics.completed} completed, {statistics.available} available
            </span>
          </div>
        </div>
      )}

      {/* Opportunities List */}
      {opportunities.length > 0 && (
        <div className="divide-y divide-gray-800">
          {opportunities.slice(0, 3).map((opportunity) => (
            <div key={opportunity.id} className="bg-gray-900">
              {/* Collapsed View */}
              <div 
                className="px-4 py-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
                onClick={() => setExpandedLesson(expandedLesson === opportunity.id ? null : opportunity.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        opportunity.level === 'beginner' ? 'bg-green-600/20 text-green-300' :
                        opportunity.level === 'intermediate' ? 'bg-amber-600/20 text-amber-300' :
                        'bg-red-600/20 text-red-300'
                      }`}>
                        {opportunity.level}
                      </span>
                      <span className="text-sm font-medium text-gray-200">
                        {opportunity.title}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {opportunity.summary}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => handleDismissLesson(opportunity.id, e)}
                      className="p-1 text-gray-500 hover:text-gray-300"
                      title="Dismiss"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <svg 
                      className={`w-4 h-4 text-gray-400 transition-transform ${
                        expandedLesson === opportunity.id ? 'rotate-180' : ''
                      }`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Expanded Lesson View */}
              {expandedLesson === opportunity.id && opportunity.lesson && (
                <div className="px-4 pb-4 space-y-3">
                  {/* Current vs Better */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-red-900/20 rounded-lg p-2 border border-red-800/30">
                      <span className="text-xs text-red-400 font-medium">Current</span>
                      <p className="text-xs text-gray-300 mt-1">{opportunity.lesson.current}</p>
                    </div>
                    <div className="bg-green-900/20 rounded-lg p-2 border border-green-800/30">
                      <span className="text-xs text-green-400 font-medium">Better</span>
                      <p className="text-xs text-gray-300 mt-1">{opportunity.lesson.better}</p>
                    </div>
                  </div>

                  {/* Benefits */}
                  <div>
                    <span className="text-xs text-gray-400 font-medium">Benefits:</span>
                    <ul className="mt-1 space-y-0.5">
                      {opportunity.lesson.benefits.map((benefit, i) => (
                        <li key={i} className="text-xs text-gray-300 flex items-start gap-1">
                          <span className="text-green-400">✓</span>
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Example */}
                  <div>
                    <span className="text-xs text-gray-400 font-medium">Example:</span>
                    <pre className="mt-1 p-2 bg-gray-800 rounded text-xs text-gray-300 overflow-x-auto">
                      {opportunity.lesson.example}
                    </pre>
                  </div>

                  {/* Resources */}
                  {opportunity.lesson.resources && (
                    <div>
                      <span className="text-xs text-gray-400 font-medium">Learn more:</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {opportunity.lesson.resources.map((resource, i) => (
                          <a
                            key={i}
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                          >
                            {resource.title} ↗
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      onClick={() => handleCompleteLesson(opportunity.id)}
                      className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                    >
                      Got it!
                    </button>
                    {onApplyLesson && (
                      <button
                        onClick={() => handleApplyLesson(opportunity)}
                        className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
                      >
                        Apply Pattern
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          
          {opportunities.length > 3 && (
            <div className="px-4 py-2 text-center">
              <span className="text-xs text-gray-500">
                +{opportunities.length - 3} more opportunities
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Hook to use contextual learning
 */
export function useContextualLearning(code, filePath) {
  const [data, setData] = useState({
    opportunities: [],
    statistics: null
  });

  useEffect(() => {
    const learning = getContextualLearning();
    
    // Analyze code
    if (code) {
      learning.analyzeCode(code, filePath);
    }
    
    // Listen for changes
    const unsubscribe = learning.addListener(setData);
    
    // Get initial data
    setData({
      opportunities: learning.getDetectedOpportunities(),
      statistics: learning.getStatistics()
    });

    return () => unsubscribe();
  }, [code, filePath]);

  return {
    ...data,
    learning: getContextualLearning(),
    completeLesson: (id) => getContextualLearning().completeLesson(id),
    dismissLesson: (id) => getContextualLearning().dismissLesson(id)
  };
}

export default LearningCard;
