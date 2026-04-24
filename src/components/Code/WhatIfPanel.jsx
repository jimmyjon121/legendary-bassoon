import React, { useCallback, useEffect, useState } from 'react';
import { getWhatIfEngine, IMPACT_LEVEL, SIMULATION_STATUS } from '../../services/whatIfEngine';

const TABS = ['summary', 'impact', 'tests', 'security', 'bundle'];

function getRiskStyle(level) {
  switch (level) {
    case IMPACT_LEVEL.CRITICAL:
      return { bg: 'bg-red-600', text: 'text-red-200', border: 'border-red-500' };
    case IMPACT_LEVEL.HIGH:
      return { bg: 'bg-orange-600', text: 'text-orange-200', border: 'border-orange-500' };
    case IMPACT_LEVEL.MEDIUM:
      return { bg: 'bg-amber-600', text: 'text-amber-200', border: 'border-amber-500' };
    case IMPACT_LEVEL.LOW:
      return { bg: 'bg-green-600', text: 'text-green-200', border: 'border-green-500' };
    default:
      return { bg: 'bg-gray-600', text: 'text-gray-200', border: 'border-gray-500' };
  }
}

const WhatIfPanel = ({ projectFiles, onApplyChanges, onClose }) => {
  const [simulations, setSimulations] = useState([]);
  const [currentSimulation, setCurrentSimulation] = useState(null);
  const [proposedChange, setProposedChange] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    const engine = getWhatIfEngine();
    const unsubscribe = engine.addListener((state) => {
      setSimulations(state.all);
      setCurrentSimulation(state.current);
    });

    setSimulations(engine.getAllSimulations());
    setCurrentSimulation(engine.getCurrentSimulation());

    return () => unsubscribe();
  }, []);

  const handleCreateSimulation = useCallback(async () => {
    const normalizedChange = proposedChange.trim();
    if (!normalizedChange) return;

    const engine = getWhatIfEngine();
    setIsRunning(true);

    try {
      const simulation = await engine.createSimulation(
        [{ type: 'description', content: normalizedChange }],
        { name: normalizedChange.substring(0, 50) }
      );
      await engine.runSimulation(simulation.id, projectFiles);
      setProposedChange('');
    } catch (error) {
      console.error('Simulation failed:', error);
    } finally {
      setIsRunning(false);
    }
  }, [projectFiles, proposedChange]);

  const handleApply = useCallback(() => {
    if (!currentSimulation) return;
    const engine = getWhatIfEngine();
    const { patches } = engine.applySimulation(currentSimulation.id);
    onApplyChanges?.(patches);
    engine.discardSimulation(currentSimulation.id);
  }, [currentSimulation, onApplyChanges]);

  const handleDiscard = useCallback(() => {
    if (!currentSimulation) return;
    getWhatIfEngine().discardSimulation(currentSimulation.id);
  }, [currentSimulation]);

  const summary = currentSimulation?.summary || null;
  const summaryRiskStyle = getRiskStyle(summary?.overallRisk);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">[?]</span>
          <h2 className="font-medium text-gray-200">What-If Simulation</h2>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="p-4 border-b border-gray-700">
        <label className="text-sm text-gray-400 mb-2 block">
          Describe the change you want to simulate:
        </label>
        <textarea
          value={proposedChange}
          onChange={(e) => setProposedChange(e.target.value)}
          placeholder="e.g., Convert UserService from class to hooks"
          className="w-full h-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleCreateSimulation}
          disabled={!proposedChange.trim() || isRunning}
          className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          {isRunning ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running Simulation...
            </>
          ) : (
            <>
              <span aria-hidden="true">[?]</span>
              Simulate Changes
            </>
          )}
        </button>
      </div>

      {currentSimulation && currentSimulation.status === SIMULATION_STATUS.COMPLETED && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className={`px-4 py-3 ${summaryRiskStyle.bg}`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-white">{currentSimulation.name}</h3>
                <p className={`text-sm ${summaryRiskStyle.text}`}>
                  Risk Level: {summary?.overallRisk?.toUpperCase() || 'NONE'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {summary?.canProceed ? (
                  <span className="px-2 py-1 bg-green-500/30 text-green-200 text-xs rounded">
                    Safe to Apply
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-red-500/30 text-red-200 text-xs rounded">
                    Review Required
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex border-b border-gray-700">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm capitalize ${
                  activeTab === tab
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'summary' && summary && (
              <div className="space-y-4">
                {summary.blockers.length > 0 && (
                  <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-red-300 mb-2">Blockers</h4>
                    <ul className="space-y-1">
                      {summary.blockers.map((blocker, index) => (
                        <li key={`blocker:${index}`} className="text-sm text-red-200 flex items-start gap-2">
                          <span aria-hidden="true">!</span>
                          {blocker}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.warnings.length > 0 && (
                  <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-amber-300 mb-2">Warnings</h4>
                    <ul className="space-y-1">
                      {summary.warnings.map((warning, index) => (
                        <li key={`warning:${index}`} className="text-sm text-amber-200 flex items-start gap-2">
                          <span aria-hidden="true">!</span>
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.positives.length > 0 && (
                  <div className="bg-green-900/30 border border-green-700 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-green-300 mb-2">Improvements</h4>
                    <ul className="space-y-1">
                      {summary.positives.map((positive, index) => (
                        <li key={`positive:${index}`} className="text-sm text-green-200 flex items-start gap-2">
                          <span aria-hidden="true">+</span>
                          {positive}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.blockers.length === 0 && summary.warnings.length === 0 && (
                  <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 text-center">
                    <span className="text-2xl" aria-hidden="true">OK</span>
                    <p className="text-sm text-green-200 mt-1">
                      No issues detected. Changes look safe to apply.
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'impact' && currentSimulation.results.impact && (
              <div className="space-y-3">
                <div className="text-sm text-gray-400">
                  {currentSimulation.results.impact.affectedFiles.length} files will be affected
                </div>
                {currentSimulation.results.impact.affectedFiles.map((file, index) => (
                  <div key={`impact:${index}`} className="bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className={file.directChanges ? 'text-blue-400' : 'text-gray-400'} aria-hidden="true">
                        {file.directChanges ? 'D' : 'L'}
                      </span>
                      <span className="text-sm text-gray-200 truncate">{file.file}</span>
                    </div>
                    {file.directChanges ? (
                      <span className="text-xs text-blue-400">Direct changes</span>
                    ) : (
                      <span className="text-xs text-gray-500">Dependent file</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'tests' && currentSimulation.results.tests && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-green-900/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-400">
                      {currentSimulation.results.tests.predicted.passing}
                    </div>
                    <div className="text-xs text-green-300">Passing</div>
                  </div>
                  <div className="bg-red-900/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-red-400">
                      {currentSimulation.results.tests.predicted.failing}
                    </div>
                    <div className="text-xs text-red-300">Failing</div>
                  </div>
                  <div className="bg-amber-900/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-400">
                      {currentSimulation.results.tests.predicted.needsUpdate}
                    </div>
                    <div className="text-xs text-amber-300">Needs Update</div>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-gray-400">
                      {currentSimulation.results.tests.predicted.skipped}
                    </div>
                    <div className="text-xs text-gray-500">Skipped</div>
                  </div>
                </div>

                {currentSimulation.results.tests.details.map((detail, index) => (
                  <div key={`test:${index}`} className="bg-gray-800 rounded-lg p-3 text-sm">
                    <div className="text-gray-200">{detail.file}</div>
                    <div className="text-xs text-gray-400 mt-1">{detail.impact}</div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'security' && currentSimulation.results.security && (
              <div className="space-y-4">
                {currentSimulation.results.security.vulnerabilities.length === 0
                  && currentSimulation.results.security.warnings.length === 0 && (
                  <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 text-center">
                    <span className="text-2xl" aria-hidden="true">OK</span>
                    <p className="text-sm text-green-200 mt-1">No security issues detected</p>
                  </div>
                )}

                {currentSimulation.results.security.vulnerabilities.map((vulnerability, index) => (
                  <div
                    key={`vulnerability:${index}`}
                    className={`rounded-lg p-3 border ${
                      vulnerability.severity === 'critical'
                        ? 'bg-red-900/30 border-red-700'
                        : 'bg-orange-900/30 border-orange-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={vulnerability.severity === 'critical' ? 'text-red-400' : 'text-orange-400'}
                        aria-hidden="true"
                      >
                        !
                      </span>
                      <span className="text-sm font-medium text-gray-200">{vulnerability.message}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{vulnerability.file}</div>
                  </div>
                ))}

                {currentSimulation.results.security.warnings.map((warning, index) => (
                  <div key={`security-warning:${index}`} className="bg-amber-900/20 rounded-lg p-3 border border-amber-800">
                    <div className="text-sm text-amber-200">{warning.message}</div>
                    <div className="text-xs text-gray-400 mt-1">{warning.file}</div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'bundle' && currentSimulation.results.bundle && (
              <div className="space-y-4">
                <div
                  className={`rounded-lg p-4 text-center ${
                    currentSimulation.results.bundle.status === 'good'
                      ? 'bg-green-900/30'
                      : currentSimulation.results.bundle.status === 'warning'
                        ? 'bg-amber-900/30'
                        : 'bg-gray-800'
                  }`}
                >
                  <div className="text-3xl font-bold text-gray-200">
                    {currentSimulation.results.bundle.changeFormatted}
                  </div>
                  <div className="text-sm text-gray-400">Estimated bundle size change</div>
                </div>

                {currentSimulation.results.bundle.details.map((detail, index) => (
                  <div key={`bundle:${index}`} className="bg-gray-800 rounded-lg p-3">
                    <div className="text-sm text-gray-200">{detail.file}</div>
                    {detail.type === 'new_imports' && (
                      <div className="text-xs text-gray-400 mt-1">
                        New imports: {detail.imports.length}
                      </div>
                    )}
                    {detail.warning && (
                      <div className="text-xs text-amber-400 mt-1">{detail.warning}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
            <button
              onClick={handleDiscard}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleApply}
              disabled={!summary?.canProceed}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                summary?.canProceed
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              Apply Changes
            </button>
          </div>
        </div>
      )}

      {!currentSimulation && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <span className="text-4xl" aria-hidden="true">[?]</span>
            <h3 className="text-lg font-medium text-gray-300 mt-4">
              Simulate Before You Commit
            </h3>
            <p className="text-sm text-gray-500 mt-2 max-w-sm">
              Describe a change you are considering and see what would happen
              before you actually make it.
            </p>
          </div>
        </div>
      )}

      {simulations.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 text-[11px] text-gray-500">
          Simulations tracked: {simulations.length}
        </div>
      )}
    </div>
  );
};

export default WhatIfPanel;
