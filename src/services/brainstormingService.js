function baseOption(label, emphasis, context = {}) {
  return {
    id: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    title: label,
    emphasis,
    summary: context.summary || 'Agent-generated concept.',
    pros: context.pros || [],
    cons: context.cons || [],
    estimate: context.estimate || 'Medium effort',
    files: context.files || [],
  };
}

export function generateBrainstormOptions({ filePath, rootPath }) {
  const scope = filePath || 'project';
  const baseSummary = `Fresh angles for ${scope.split(/[\\/]/).pop() || 'this feature'}`;
  return [
    baseOption('Precision Refactor', 'quality', {
      summary: `${baseSummary} focusing on code health and self-documented patterns.`,
      pros: ['Low risk', 'Improves readability', 'Keeps Git diff tight'],
      cons: ['Does not ship net-new functionality'],
      estimate: 'Low effort',
      files: [filePath].filter(Boolean),
    }),
    baseOption('DX Upgrade', 'experience', {
      summary: 'Create helper utilities and scaffolding to accelerate future work.',
      pros: ['Boosts developer happiness', 'Encourages reuse'],
      cons: ['Requires aligning on conventions'],
      estimate: 'Medium effort',
      files: [rootPath ? `${rootPath}/src/utils` : 'src/utils'],
    }),
    baseOption('Hero Feature Sprint', 'impact', {
      summary: 'Bold move — build a showcase flow that makes the product pop.',
      pros: ['High user impact', 'Great for demos'],
      cons: ['Touching multiple layers', 'Needs testing + docs'],
      estimate: 'High effort',
      files: [rootPath ? `${rootPath}/src/components` : 'src/components'],
    }),
  ];
}

export default {
  generateBrainstormOptions,
};













