const DEFAULT_AUTONOMOUS_SUMMARY = {
  confidence: 0.72,
  riskLevel: 'medium',
  focusAreas: ['structure', 'naming', 'DX'],
  agents: [
    { id: 'architect', label: 'Architect', status: 'idle' },
    { id: 'coder', label: 'Code', status: 'idle' },
    { id: 'review', label: 'Review', status: 'standing-by' },
  ],
};

function safeId(prefix = 'agent') {
  const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (globalCrypto?.randomUUID) {
    return `${prefix}-${globalCrypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;
}

function scoreComplexity(content = '') {
  const lines = content.split('\n').length;
  const hasTodos = content.match(/todo|fixme/gi)?.length || 0;
  const hasConsole = content.match(/console\.log/gi)?.length || 0;
  const hasComments = content.match(/\/\//g)?.length || 0;
  const density = lines ? (hasComments + hasTodos) / lines : 0;
  return {
    lines,
    hasTodos,
    hasConsole,
    density,
  };
}

function buildSuggestionFromContent({ filePath, content, mode }) {
  const idBase = safeId('suggestion');
  const suggestions = [];
  const { hasTodos, hasConsole, lines } = scoreComplexity(content);

  if (hasTodos) {
    suggestions.push({
      id: `${idBase}-todos`,
      type: 'cleanup',
      priority: 'medium',
      lineRange: 'multiple',
      message: `Resolve the ${hasTodos} TODO comment${hasTodos > 1 ? 's' : ''} left in ${filePath}.`,
      autoFix: false,
    });
  }

  if (hasConsole) {
    suggestions.push({
      id: `${idBase}-logs`,
      type: 'quality',
      priority: 'low',
      lineRange: 'multiple',
      message: `Remove ${hasConsole} debugging console.log statement${hasConsole > 1 ? 's' : ''} before shipping.`,
      autoFix: true,
    });
  }

  if (lines > 400) {
    suggestions.push({
      id: `${idBase}-size`,
      type: 'refactor',
      priority: 'high',
      lineRange: 'global',
      message: 'This file is getting large. Consider splitting it into smaller modules or hooks.',
      autoFix: false,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: `${idBase}-fresh`,
      type: mode === 'review' ? 'review' : 'improvement',
      priority: 'medium',
      lineRange: 'global',
      message: 'Everything looks stable. Consider adding inline docs or tests to lock behaviour.',
      autoFix: false,
    });
  }

  return suggestions;
}

export async function generateSuggestions({ filePath, content, mode = 'autonomous' }) {
  return buildSuggestionFromContent({ filePath, content, mode });
}

export async function runQuickAction(action, context) {
  const { filePath, content } = context;
  const idPrefix = safeId(action);
  const baseResponse = {
    transcript: '',
    suggestions: [],
  };

  switch (action) {
    case 'improve':
      baseResponse.transcript = `Here is a set of focused improvements for ${filePath}.`;
      baseResponse.suggestions = buildSuggestionFromContent({ filePath, content, mode: 'autonomous' });
      break;
    case 'bugs':
      baseResponse.transcript = `Scanned ${filePath} for risky patterns.`;
      baseResponse.suggestions = [
        {
          id: `${idPrefix}-strict`,
          type: 'bug',
          message: 'Enable strict mode or add PropTypes/TypeScript interfaces to catch runtime issues.',
          lineRange: 'global',
          priority: 'high',
          autoFix: false,
        },
        {
          id: `${idPrefix}-errors`,
          type: 'bug',
          message: 'Wrap async calls with try/catch to surface actionable errors.',
          lineRange: 'multiple',
          priority: 'medium',
          autoFix: false,
        },
      ];
      break;
    case 'explain':
      baseResponse.transcript = `Breakdown of ${filePath} in plain English.`;
      baseResponse.suggestions = [
        {
          id: `${idPrefix}-docs`,
          type: 'docs',
          message: 'Consider adding JSDoc or inline comments for exported functions to onboard future contributors faster.',
          lineRange: 'global',
          priority: 'low',
          autoFix: false,
        },
      ];
      break;
    case 'refactor':
    default:
      baseResponse.transcript = `Refactor plan for ${filePath}.`;
      baseResponse.suggestions = [
        {
          id: `${idPrefix}-cohesion`,
          type: 'refactor',
          message: 'Extract repeated logic into dedicated hooks/services to reduce duplication.',
          lineRange: 'global',
          priority: 'medium',
          autoFix: true,
        },
      ];
      break;
  }

  return baseResponse;
}

export async function generateAgentReply(prompt, context) {
  const summary = [
    `Context: ${context?.filePath || 'unknown'} (${context?.content?.split('\n').length || 0} lines)`,
    `Mode: ${context?.mode || 'autonomous'}`,
    'Agent is synthesizing a high-level response with actionable steps.',
  ].join('\n');

  return `${summary}\n\nResponse:\n- ${prompt}\n- Add tests where needed\n- Keep momentum rolling ⚡️`;
}

export function generateAutonomousPlan(request, context) {
  const now = Date.now();
  return {
    id: safeId('plan'),
    createdAt: now,
    request,
    context,
    steps: [
      {
        id: safeId('step'),
        title: 'Understand current state',
        owner: 'architect',
        description: `Map ${context?.filePath || 'target file'} and identify constraints.`,
        status: 'ready',
      },
      {
        id: safeId('step'),
        title: 'Implement changes',
        owner: 'coder',
        description: 'Modify code with guardrails + capture diff preview.',
        status: 'blocked',
      },
      {
        id: safeId('step'),
        title: 'Self review',
        owner: 'review',
        description: 'Run lint/test, summarize impacts, propose follow-ups.',
        status: 'blocked',
      },
    ],
  };
}

export function estimateAutoFix(content) {
  const issues = scoreComplexity(content);
  const severity =
    issues.hasTodos > 2 || issues.hasConsole > 0
      ? 'high'
      : issues.lines > 400
        ? 'medium'
        : 'low';
  return {
    canAutoFix: severity !== 'low',
    severity,
    summary:
      severity === 'high'
        ? 'Clean up TODOs/logs before shipping.'
        : severity === 'medium'
          ? 'Large file. Agent recommends modularisation.'
          : 'Minor polish available.',
  };
}

export function getAgentStatus() {
  return {
    ...DEFAULT_AUTONOMOUS_SUMMARY,
    timestamp: Date.now(),
  };
}

export function getAgentQuickActions() {
  return [
    { id: 'improve', label: 'Suggest improvements' },
    { id: 'bugs', label: 'Find bugs' },
    { id: 'explain', label: 'Explain code' },
    { id: 'refactor', label: 'Refactor' },
  ];
}

export const agentService = {
  generateSuggestions,
  runQuickAction,
  generateAgentReply,
  generateAutonomousPlan,
  estimateAutoFix,
  getAgentStatus,
  getAgentQuickActions,
};

export default agentService;

