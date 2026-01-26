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
    <div className="h-40 flex flex-col border border-forge-border rounded-lg bg-forge-bg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-forge-border text-[11px]">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-text-muted" />
          <span className="text-text-primary">Terminal</span>
          {rootPath && (
            <span className="text-[10px] text-text-muted truncate max-w-[180px]">
              {rootPath}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npm test, node script.js, etc."
            className="input text-[11px] h-7 w-52"
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
            className="p-1.5 rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30 disabled:opacity-60 transition-colors"
          >
            <Play size={12} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto font-mono text-[11px] text-text-muted px-3 py-2 whitespace-pre-wrap">
        {output || 'Output will appear here.'}
      </div>
    </div>
  );
}

export default TerminalPane;

















