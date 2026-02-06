/**
 * PersonaSelector Component
 * 
 * Dropdown selector for switching between AI personas.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getPersonaManager, PERSONAS } from '../../services/personaManager';

const PersonaSelector = ({ onPersonaChange, showDescription = true, compact = false }) => {
  const [currentPersona, setCurrentPersona] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [autoDetect, setAutoDetect] = useState(true);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const manager = getPersonaManager();
    setCurrentPersona(manager.getCurrentPersona());
    setAutoDetect(manager.autoDetect);

    const unsubscribe = manager.addListener((persona) => {
      setCurrentPersona(persona);
    });

    return () => unsubscribe();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPersona = useCallback((personaId) => {
    const manager = getPersonaManager();
    manager.setPersona(personaId);
    setIsOpen(false);
    onPersonaChange?.(manager.getCurrentPersona());
  }, [onPersonaChange]);

  const handleToggleAutoDetect = useCallback((e) => {
    e.stopPropagation();
    const manager = getPersonaManager();
    manager.setAutoDetect(!autoDetect);
    setAutoDetect(!autoDetect);
  }, [autoDetect]);

  if (!currentPersona) return null;

  const personas = Object.values(PERSONAS);

  // Compact view (for toolbar)
  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
          title={`Current persona: ${currentPersona.name}`}
        >
          <span className="text-base">{currentPersona.icon}</span>
          <span className="text-xs text-gray-300 hidden sm:inline">{currentPersona.name}</span>
          <svg 
            className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-gray-900 rounded-lg shadow-xl border border-gray-700 overflow-hidden z-50">
            {personas.map((persona) => (
              <button
                key={persona.id}
                onClick={() => handleSelectPersona(persona.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800 transition-colors ${
                  persona.id === currentPersona.id ? 'bg-gray-800' : ''
                }`}
              >
                <span className="text-base">{persona.icon}</span>
                <span className="text-sm text-gray-200">{persona.name}</span>
                {persona.id === currentPersona.id && (
                  <svg className="w-4 h-4 text-green-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Full view
  return (
    <div className="relative" ref={dropdownRef}>
      {/* Current persona button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors border border-gray-700"
      >
        <span className="text-2xl">{currentPersona.icon}</span>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200">{currentPersona.name}</span>
            {autoDetect && (
              <span className="text-xs bg-blue-600/30 text-blue-300 px-1.5 py-0.5 rounded">
                Auto
              </span>
            )}
          </div>
          {showDescription && (
            <p className="text-xs text-gray-400 mt-0.5">{currentPersona.description}</p>
          )}
        </div>
        <svg 
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 rounded-lg shadow-xl border border-gray-700 overflow-hidden z-50">
          {/* Auto-detect toggle */}
          <div 
            className="px-4 py-2 border-b border-gray-700 flex items-center justify-between cursor-pointer hover:bg-gray-800"
            onClick={handleToggleAutoDetect}
          >
            <span className="text-xs text-gray-400">Auto-detect from file</span>
            <div className={`w-8 h-4 rounded-full transition-colors ${autoDetect ? 'bg-blue-600' : 'bg-gray-600'}`}>
              <div className={`w-3 h-3 bg-white rounded-full m-0.5 transition-transform ${autoDetect ? 'translate-x-4' : ''}`} />
            </div>
          </div>

          {/* Persona list */}
          <div className="max-h-80 overflow-y-auto">
            {personas.map((persona) => (
              <button
                key={persona.id}
                onClick={() => handleSelectPersona(persona.id)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-800 transition-colors border-b border-gray-800 last:border-0 ${
                  persona.id === currentPersona.id ? 'bg-gray-800/50' : ''
                }`}
              >
                <span className="text-2xl">{persona.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">{persona.name}</span>
                    {persona.id === currentPersona.id && (
                      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{persona.description}</p>
                  
                  {/* Persona traits */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {persona.explains && (
                      <span className="text-xs bg-purple-600/20 text-purple-300 px-1.5 py-0.5 rounded">
                        Explains
                      </span>
                    )}
                    {persona.securityFocused && (
                      <span className="text-xs bg-red-600/20 text-red-300 px-1.5 py-0.5 rounded">
                        Security
                      </span>
                    )}
                    {persona.testFocused && (
                      <span className="text-xs bg-green-600/20 text-green-300 px-1.5 py-0.5 rounded">
                        Testing
                      </span>
                    )}
                    {persona.refactorFocused && (
                      <span className="text-xs bg-amber-600/20 text-amber-300 px-1.5 py-0.5 rounded">
                        Quality
                      </span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      persona.verbosity === 'minimal' ? 'bg-gray-600/30 text-gray-300' :
                      persona.verbosity === 'high' ? 'bg-blue-600/20 text-blue-300' :
                      'bg-gray-600/20 text-gray-400'
                    }`}>
                      {persona.verbosity === 'minimal' ? 'Concise' : 
                       persona.verbosity === 'high' ? 'Detailed' : 'Balanced'}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Hook to use persona in components
 */
export function usePersona() {
  const [persona, setPersona] = useState(() => getPersonaManager().getCurrentPersona());

  useEffect(() => {
    const manager = getPersonaManager();
    const unsubscribe = manager.addListener(setPersona);
    return unsubscribe;
  }, []);

  return {
    ...persona,
    manager: getPersonaManager(),
    setPersona: (id) => getPersonaManager().setPersona(id),
    getSystemPrompt: () => getPersonaManager().getSystemPrompt(),
    getConfig: () => getPersonaManager().getConfig()
  };
}

export default PersonaSelector;
