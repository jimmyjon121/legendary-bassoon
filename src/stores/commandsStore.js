import { create } from 'zustand';
import { useAppStore } from './appStore';

export const useCommandsStore = create((set, get) => ({
  isOpen: false,
  query: '',
  commands: [],

  open() {
    set({ isOpen: true });
  },

  close() {
    set({ isOpen: false, query: '' });
  },

  toggle() {
    set((state) => ({ isOpen: !state.isOpen }));
  },

  setQuery(query) {
    set({ query });
  },

  initializeDefaultCommands() {
    const { commands } = get();
    if (commands && commands.length > 0) return;

    const app = useAppStore.getState();

    const baseCommands = [
      {
        id: 'new-chat',
        title: 'New conversation',
        category: 'Chat',
        run: () => app.createConversation(),
      },
      {
        id: 'open-settings',
        title: 'Open settings',
        category: 'Navigation',
        run: () => app.toggleSettings(),
      },
      {
        id: 'open-model-selector',
        title: 'Open model selector',
        category: 'Models',
        run: () => app.toggleModelSelector(),
      },
      {
        id: 'open-model-finder',
        title: 'Open model finder',
        category: 'Models',
        run: () => app.toggleModelFinder(),
      },
      {
        id: 'toggle-image-gen',
        title: 'Toggle image generation panel',
        category: 'Images',
        run: () => app.toggleImageGen(),
      },
      {
        id: 'switch-workspace-casual',
        title: 'Switch to Casual workspace',
        category: 'Workspace',
        run: () => app.setWorkspace('casual'),
      },
      {
        id: 'switch-workspace-work',
        title: 'Switch to Work workspace',
        category: 'Workspace',
        run: () => app.setWorkspace('work'),
      },
      {
        id: 'switch-workspace-code',
        title: 'Switch to Code workspace',
        category: 'Workspace',
        run: () => app.setWorkspace('code'),
      },
      {
        id: 'switch-workspace-private',
        title: 'Switch to Private workspace',
        category: 'Workspace',
        run: () => app.setWorkspace('nsfw'),
      },
      {
        id: 'export-conversation',
        title: 'Export current conversation',
        category: 'Chat',
        run: () => {
          const { openExportModal } = useAppStore.getState();
          if (openExportModal) openExportModal();
        },
      },
    ];

    set({ commands: baseCommands });
  },

  executeCommand(id) {
    const { commands } = get();
    const cmd = commands.find((c) => c.id === id);
    if (!cmd || typeof cmd.run !== 'function') return;
    try {
      cmd.run();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Command failed', error);
    }
  },
}));


