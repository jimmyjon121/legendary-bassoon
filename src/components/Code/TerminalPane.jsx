import React, { useState } from 'react';
import { Play, Terminal } from 'lucide-react';
import { api } from '../../utils/electronAPI';
import { useEditorStore } from '../../stores/editorStore';

export function TerminalPane() {
  const { rootPath } = useEditorStore((state) => ({
    rootPath: state.rootPath,
  }));

  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = async () => {
    if (!command.trim()) return;
    setIsRunning(true);
    setOutput((prev) => (prev ? `${prev}\n\n$ ${command}\n` : `$ ${command}\n`));
    try {
      const result = await api.runTerminalCommand({
        cwd: rootPath || undefined,
        command: command.trim(),
      });
      const text =
        (result.stdout || '') +
        (result.stderr ? `\n[stderr]\n${result.stderr}` : '') +
        `\n\n[exit code ${result.code}]`;
      setOutput((prev) => `${prev}${text}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#000000] overflow-hidden">
      {/* Command input bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#121218] bg-[#0b0b10]">
        {rootPath && (
          <span className="text-[10px] text-[#608b4e] font-mono truncate max-w-[180px]">
            {rootPath.split(/[/\\]/).pop()}
          </span>
        )}
        <span className="text-[11px] text-[#808080]">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npm test, node script.js, etc."
          className="flex-1 bg-transparent text-[12px] font-mono text-[#cccccc] placeholder-[#555555] outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleRun();
            }
          }}
        />
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning || !command.trim()}
          className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#007acc]/20 text-[#3daee9] hover:bg-[#007acc]/30 disabled:opacity-40 transition-colors"
        >
          {isRunning ? '...' : 'Run'}
        </button>
      </div>
      {/* Output area */}
      <div className="flex-1 overflow-auto font-mono text-[12px] text-[#cccccc] px-3 py-2 whitespace-pre-wrap leading-[1.5]">
        {output || <span className="text-[#555555]">Terminal output will appear here.</span>}
      </div>
    </div>
  );
}

export default TerminalPane;

















