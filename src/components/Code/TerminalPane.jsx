import { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { api } from '../../utils/electronAPI';
import { useEditorStore } from '../../stores/editorStore';
import { shallow } from 'zustand/shallow';

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_BELL = String.fromCharCode(7);
const ANSI_RE = new RegExp(
  `${ANSI_ESCAPE}(?:\\[[0-?]*[ -/]*[@-~]|\\].*?(?:${ANSI_BELL}|${ANSI_ESCAPE}\\\\))`,
  'g'
);
function stripAnsi(text) {
  return String(text || '').replace(ANSI_RE, '');
}

const MAX_HISTORY = 50;

export function TerminalPane() {
  const { rootPath } = useEditorStore((state) => ({
    rootPath: state.rootPath,
  }), shallow);

  const [command, setCommand] = useState('');
  const [lines, setLines] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const outputRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => { scrollToBottom(); }, [lines, scrollToBottom]);

  const pushLines = useCallback((newLines) => {
    setLines((prev) => {
      const next = [...prev, ...newLines];
      return next.length > 2000 ? next.slice(-1500) : next;
    });
  }, []);

  const handleRun = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd) return;

    setHistory((prev) => {
      const deduped = prev.filter((c) => c !== cmd);
      const next = [cmd, ...deduped];
      return next.slice(0, MAX_HISTORY);
    });
    setHistoryIdx(-1);
    setCommand('');
    pushLines([{ type: 'cmd', text: `$ ${cmd}` }]);

    if (cmd === 'clear' || cmd === 'cls') {
      setLines([]);
      return;
    }

    setIsRunning(true);
    try {
      const result = await api.runTerminalCommand({
        cwd: rootPath || undefined,
        command: cmd,
        timeout: 60000,
      });
      const out = [];
      if (result.stdout) {
        stripAnsi(result.stdout).split('\n').forEach((l) =>
          out.push({ type: 'out', text: l })
        );
      }
      if (result.stderr) {
        stripAnsi(result.stderr).split('\n').forEach((l) =>
          out.push({ type: 'err', text: l })
        );
      }
      const success = result.success !== false && result.code === 0;
      out.push({
        type: success ? 'exit-ok' : 'exit-fail',
        text: `exit ${result.code ?? '?'}`,
      });
      pushLines(out);
    } catch (err) {
      pushLines([{ type: 'err', text: String(err?.message || err) }]);
    } finally {
      setIsRunning(false);
      inputRef.current?.focus();
    }
  }, [command, rootPath, pushLines]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRun();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next);
      setCommand(history[next]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setCommand('');
        return;
      }
      const next = historyIdx - 1;
      setHistoryIdx(next);
      setCommand(history[next]);
      return;
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  }, [handleRun, history, historyIdx]);

  const lineClass = (type) => {
    switch (type) {
      case 'cmd':      return 'text-[#569cd6]';
      case 'err':      return 'text-[#f44747]';
      case 'exit-ok':  return 'text-[#608b4e]';
      case 'exit-fail': return 'text-[#f44747]';
      default:         return 'text-[#cccccc]';
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#000000] overflow-hidden">
      <div
        ref={outputRef}
        className="flex-1 overflow-auto font-mono text-[12px] px-3 py-2 leading-[1.5] select-text"
      >
        {lines.length === 0 ? (
          <span className="text-[#555555]">Ready. Type a command below.</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap ${lineClass(line.type)}`}>{line.text}</div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[#121218] bg-[#0b0b10]">
        {rootPath && (
          <span className="text-[10px] text-[#608b4e] font-mono truncate max-w-[140px]">
            {rootPath.split(/[/\\]/).pop()}
          </span>
        )}
        <span className="text-[11px] text-[#808080] select-none">$</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => { setCommand(e.target.value); setHistoryIdx(-1); }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          disabled={isRunning}
          className="flex-1 bg-transparent text-[12px] font-mono text-[#cccccc] placeholder-[#555555] outline-none disabled:opacity-40"
          autoFocus
        />
        {isRunning ? (
          <Loader2 size={14} className="text-[#808080] animate-spin flex-shrink-0" />
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLines([])}
              title="Clear (Ctrl+L)"
              className="p-1 rounded text-[#808080] hover:text-[#cccccc] hover:bg-[#171722] transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TerminalPane;
