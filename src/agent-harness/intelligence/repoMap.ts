export interface ParserRegistration {
  language: string;
  extensions: string[];
  parseSymbols(content: string, path: string): RepoSymbol[];
}

export interface RepoSymbol {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'component' | 'hook' | 'constant' | 'type' | 'unknown';
  path: string;
  line: number;
  exports: string[];
  references: string[];
  score?: number;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoMap {
  symbols: RepoSymbol[];
  rankedSymbols: RepoSymbol[];
  parserLanguages: string[];
  notes: string[];
}

export class ParserRegistry {
  private readonly parsers = new Map<string, ParserRegistration>();

  register(parser: ParserRegistration): void {
    for (const extension of parser.extensions) {
      this.parsers.set(extension.toLowerCase(), parser);
    }
  }

  getParser(path: string): ParserRegistration | undefined {
    const extension = path.match(/\.[^.]+$/)?.[0]?.toLowerCase();
    return extension ? this.parsers.get(extension) : undefined;
  }

  languages(): string[] {
    return [...new Set([...this.parsers.values()].map((parser) => parser.language))];
  }
}

export const defaultParserRegistry = new ParserRegistry();

defaultParserRegistry.register({
  language: 'typescript-javascript',
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
  parseSymbols: parseJsTsSymbols,
});

export function buildRepoMap(files: RepoFile[], registry = defaultParserRegistry): RepoMap {
  const symbols = files.flatMap((file) => {
    const parser = registry.getParser(file.path);
    return parser ? parser.parseSymbols(file.content, file.path) : [];
  });
  const rankedSymbols = rankSymbolsWithPageRank(symbols);
  return {
    symbols,
    rankedSymbols,
    parserLanguages: registry.languages(),
    notes: [
      'Parser registry is pluggable; Python/Go support should be added by registering parsers, not by refactoring repo-map callers.',
      'Tree-sitter Node bindings are the intended production parser backend; this v1 keeps parser calls behind the registry contract.',
    ],
  };
}

export function rankSymbolsWithPageRank(symbols: RepoSymbol[], iterations = 20, damping = 0.85): RepoSymbol[] {
  if (symbols.length === 0) return [];
  const byName = new Map(symbols.map((symbol) => [symbol.name, symbol]));
  let scores = new Map(symbols.map((symbol) => [symbol.id, 1 / symbols.length]));

  for (let step = 0; step < iterations; step += 1) {
    const next = new Map(symbols.map((symbol) => [symbol.id, (1 - damping) / symbols.length]));
    for (const symbol of symbols) {
      const outgoing = symbol.references.map((name) => byName.get(name)).filter(Boolean) as RepoSymbol[];
      const share = (scores.get(symbol.id) || 0) / Math.max(1, outgoing.length);
      for (const target of outgoing) {
        next.set(target.id, (next.get(target.id) || 0) + damping * share);
      }
    }
    scores = next;
  }

  return symbols
    .map((symbol) => ({ ...symbol, score: scores.get(symbol.id) || 0 }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function parseJsTsSymbols(content: string, path: string): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const lines = content.split('\n');
  const symbolPattern =
    /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+([A-Za-z_$][\w$]*)|^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)?/;

  lines.forEach((line, index) => {
    const match = line.match(symbolPattern);
    const name = match?.[1] || match?.[2];
    if (!name) return;
    symbols.push({
      id: `${path}:${name}:${index + 1}`,
      name,
      kind: inferKind(line, name),
      path,
      line: index + 1,
      exports: line.includes('export') ? [name] : [],
      references: extractLikelyReferences(content, name),
    });
  });

  return symbols;
}

function inferKind(line: string, name: string): RepoSymbol['kind'] {
  if (line.includes('class ')) return 'class';
  if (line.includes('interface ') || line.includes('type ')) return 'type';
  if (name.startsWith('use')) return 'hook';
  if (/^[A-Z]/.test(name) && (line.includes('function') || line.includes('=>'))) return 'component';
  if (line.includes('function')) return 'function';
  return 'constant';
}

function extractLikelyReferences(content: string, selfName: string): string[] {
  const identifiers = content.match(/\b[A-Za-z_$][\w$]*\b/g) || [];
  const counts = new Map<string, number>();
  for (const identifier of identifiers) {
    if (identifier === selfName) continue;
    counts.set(identifier, (counts.get(identifier) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([identifier]) => identifier);
}
