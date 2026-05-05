import { applyEditByFormat } from '../edits';
import type { ToolAdapters } from '../tools/registry';

declare global {
  interface Window {
    electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }
}

function api(): Window['electronAPI'] {
  return window.electronAPI;
}

// IPC envelope from electron/ipc/code-tools-handlers.js okResult/errorResult helpers.
// On success, the payload fields are spread to the top level alongside { ok: true, data }.
// On error, { ok: false, error, code, details } is returned.
type IpcEnvelope = Record<string, unknown> & { ok?: boolean; error?: string; details?: Record<string, unknown> };

function unwrap(result: unknown, channel: string): IpcEnvelope {
  if (!result || typeof result !== 'object') {
    throw new Error(`${channel} returned no result`);
  }
  const envelope = result as IpcEnvelope;
  if (envelope.ok === false) {
    throw new Error(String(envelope.error ?? `${channel} failed`));
  }
  return envelope;
}

export interface ElectronToolAdaptersOptions {
  projectRoot: string;
}

export function createElectronToolAdapters(options: ElectronToolAdaptersOptions): ToolAdapters {
  const { projectRoot } = options;

  return {
    async readFile(path, _signal) {
      const envelope = unwrap(await api().toolReadFile(projectRoot, path, undefined, undefined), 'tool:readFile');
      const content = envelope.content ?? (envelope.data as { content?: string } | undefined)?.content;
      if (typeof content !== 'string') {
        throw new Error(`tool:readFile returned no content for ${path}`);
      }
      return content;
    },

    async writeFile(path, content, _signal) {
      unwrap(await api().toolWriteFile(projectRoot, path, content), 'tool:writeFile');
    },

    async editFile(path, editContent, signal) {
      const existingContent = await this.readFile(path, signal);
      // Infer edit format from editContent markers; default to whole-file replacement.
      const format =
        editContent.includes('<<<<<<< SEARCH') ? 'diff'
        : editContent.startsWith('---') || editContent.startsWith('@@') ? 'udiff'
        : 'whole';
      const applyResult = applyEditByFormat(existingContent, editContent, format);
      if (!applyResult.ok || typeof applyResult.content !== 'string') {
        throw new Error(applyResult.error?.message ?? 'Edit application failed');
      }
      await this.writeFile(path, applyResult.content, signal);
    },

    async listDirectory(path, _signal) {
      const envelope = unwrap(await api().toolListDirectory(projectRoot, path, false, 1), 'tool:listDirectory');
      const entries = (envelope.entries as Array<{ name?: string; type?: string }> | undefined)
        ?? (envelope.data as { entries?: Array<{ name?: string; type?: string }> } | undefined)?.entries
        ?? [];
      return entries.map((entry) => ({
        name: String(entry.name ?? ''),
        type: (entry.type === 'directory' || entry.type === 'file' ? entry.type : 'other') as
          | 'file'
          | 'directory'
          | 'other',
      }));
    },

    async grep(pattern, path, _signal) {
      const envelope = unwrap(
        await api().toolSearchCode(projectRoot, pattern, path, 200, false),
        'tool:searchCode',
      );
      const matches = (envelope.results as Array<{ path?: string; line?: number; content?: string }> | undefined)
        ?? (envelope.data as { results?: Array<{ path?: string; line?: number; content?: string }> } | undefined)?.results
        ?? [];
      return matches.map((entry) => ({
        path: String(entry.path ?? ''),
        line: Number(entry.line ?? 0),
        text: String(entry.content ?? ''),
      }));
    },

    async runTerminalCommand(command, cwd, _signal) {
      const raw = (await api().toolRunCommand(projectRoot, command, cwd ?? projectRoot)) as IpcEnvelope | null;
      if (!raw || typeof raw !== 'object') {
        return { code: -1, stdout: '', stderr: 'tool:runCommand returned no result' };
      }
      // Both success and error envelopes carry exitCode/stdout/stderr — at top level on success,
      // and inside `details` on error. Don't throw on non-zero exit; report it via the result code.
      const top = raw as Record<string, unknown>;
      const details = (raw.details as Record<string, unknown> | undefined) ?? {};
      const exitCode = Number(top.exitCode ?? details.exitCode ?? (raw.ok === false ? 1 : 0));
      const stdout = String(top.stdout ?? details.stdout ?? '');
      const stderr = String(top.stderr ?? details.stderr ?? raw.error ?? '');
      return { code: exitCode, stdout, stderr };
    },

    async runTests(command, signal) {
      return this.runTerminalCommand(command ?? 'npm test', undefined, signal);
    },

    async repoMap(_signal) {
      return { message: 'repoMap requires tree-sitter build integration (future slice)' };
    },

    async codebaseSearch(query, signal) {
      return this.grep(query, undefined, signal);
    },
  };
}
