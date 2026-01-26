// Lightweight code template/snippet catalog for the Code workspace.
// This reuses the idea of prompt templates, but focused on code structures.

const CODE_TEMPLATES = [
  {
    id: 'react-component',
    name: 'React component (function)',
    language: 'tsx',
    category: 'React',
    description: 'Basic function component with props and Tailwind-friendly structure.',
    snippet: `import React from 'react';

export interface {{Name}}Props {
  // TODO: define props
}

export function {{Name}}(props: {{Name}}Props) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{{Title}}</h2>
      {/* content */}
    </div>
  );
}

export default {{Name}};`,
  },
  {
    id: 'zustand-store',
    name: 'Zustand store',
    language: 'ts',
    category: 'State',
    description: 'Zustand store with typed state and actions.',
    snippet: `import { create } from 'zustand';

interface {{Name}}State {
  items: string[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const use{{Name}}Store = create<{{Name}}State>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,
  async load() {
    set({ isLoading: true, error: null });
    try {
      // TODO: load data
      set({ items: [], isLoading: false });
    } catch (error: any) {
      set({ error: error?.message || 'Failed to load', isLoading: false });
    }
  },
}));`,
  },
  {
    id: 'ipc-handler',
    name: 'Electron IPC handler',
    language: 'js',
    category: 'Electron',
    description: 'Pattern for adding a new ipcMain.handle block.',
    snippet: `ipcMain.handle('{{channel}}', async (_event, payload) => {
  try {
    // TODO: implement logic using payload
    return { success: true, data: null };
  } catch (error) {
    console.error('{{channel}} failed:', error);
    return { success: false, error: error.message };
  }
});`,
  },
];

export function listCodeTemplates() {
  return CODE_TEMPLATES;
}

export function findCodeTemplate(id) {
  return CODE_TEMPLATES.find((tpl) => tpl.id === id) || null;
}

export function applyTemplateToName(template, name) {
  if (!template?.snippet) return '';
  let result = template.snippet;
  if (name) {
    result = result.replace(/{{Name}}/g, name);
    result = result.replace(/{{Title}}/g, name);
  }
  return result;
}

export default {
  listCodeTemplates,
  findCodeTemplate,
  applyTemplateToName,
};














