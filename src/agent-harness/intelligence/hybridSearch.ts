export interface RankedSearchResult {
  id: string;
  path: string;
  line?: number;
  text: string;
  score: number;
  source: 'grep' | 'vector' | 'fusion';
}

export interface HybridSearchInputs {
  grepResults: RankedSearchResult[];
  vectorResults: RankedSearchResult[];
  limit?: number;
  rrfK?: number;
}

export function reciprocalRankFusion(inputs: HybridSearchInputs): RankedSearchResult[] {
  const limit = inputs.limit ?? 20;
  const rrfK = inputs.rrfK ?? 60;
  const scores = new Map<string, RankedSearchResult>();

  addRankedList(scores, inputs.grepResults, rrfK);
  addRankedList(scores, inputs.vectorResults, rrfK);

  return [...scores.values()]
    .map((result) => ({ ...result, source: 'fusion' as const }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function hybridSearch(args: {
  query: string;
  grep: (query: string) => Promise<RankedSearchResult[]>;
  vector: (query: string) => Promise<RankedSearchResult[]>;
  limit?: number;
}): Promise<RankedSearchResult[]> {
  const [grepResults, vectorResults] = await Promise.all([args.grep(args.query), args.vector(args.query)]);
  return reciprocalRankFusion({ grepResults, vectorResults, limit: args.limit });
}

function addRankedList(target: Map<string, RankedSearchResult>, results: RankedSearchResult[], rrfK: number): void {
  results.forEach((result, index) => {
    const key = result.id || `${result.path}:${result.line || 0}:${result.text.slice(0, 80)}`;
    const existing = target.get(key);
    const score = 1 / (rrfK + index + 1);
    target.set(key, {
      ...(existing || result),
      score: (existing?.score || 0) + score,
    });
  });
}
