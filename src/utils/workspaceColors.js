// Workspace color class mappings to avoid Tailwind purge issues
export const workspaceColorClasses = {
  'workspace-casual': {
    bg: 'bg-workspace-casual',
    bg20: 'bg-workspace-casual/20',
    bg30: 'bg-workspace-casual/30',
    text: 'text-workspace-casual',
    border: 'border-workspace-casual',
    border30: 'border-workspace-casual/30',
  },
  'workspace-work': {
    bg: 'bg-workspace-work',
    bg20: 'bg-workspace-work/20',
    bg30: 'bg-workspace-work/30',
    text: 'text-workspace-work',
    border: 'border-workspace-work',
    border30: 'border-workspace-work/30',
  },
  'workspace-code': {
    bg: 'bg-workspace-code',
    bg20: 'bg-workspace-code/20',
    bg30: 'bg-workspace-code/30',
    text: 'text-workspace-code',
    border: 'border-workspace-code',
    border30: 'border-workspace-code/30',
  },
  'workspace-research': {
    bg: 'bg-workspace-research',
    bg20: 'bg-workspace-research/20',
    bg30: 'bg-workspace-research/30',
    text: 'text-workspace-research',
    border: 'border-workspace-research',
    border30: 'border-workspace-research/30',
  },
  'workspace-nsfw': {
    bg: 'bg-workspace-nsfw',
    bg20: 'bg-workspace-nsfw/20',
    bg30: 'bg-workspace-nsfw/30',
    text: 'text-workspace-nsfw',
    border: 'border-workspace-nsfw',
    border30: 'border-workspace-nsfw/30',
  },
};

export function getWorkspaceColorClasses(color) {
  return workspaceColorClasses[color] || workspaceColorClasses['workspace-casual'];
}

