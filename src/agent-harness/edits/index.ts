import type { EditFormat } from '../modelProfiles';

export interface EditApplyResult {
  ok: boolean;
  content?: string;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
}

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

const SEARCH_MARKER = '<<<<<<< SEARCH';
const DIVIDER_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';

export function applyEditByFormat(original: string, edit: string, format: EditFormat): EditApplyResult {
  if (format === 'whole') return applyWholeFile(edit);
  if (format === 'diff') return applySearchReplaceDiff(original, edit);
  if (format === 'diff-fenced') return applyDiffFenced(original, edit);
  if (format === 'udiff') return applyUnifiedDiffStrict(original, edit);
  if (format === 'patch') {
    return {
      ok: false,
      error: {
        code: 'PATCH_FORMAT_RESERVED',
        message: 'patch format is reserved for future GPT-4.1-class profiles and is not enabled for local profiles.',
      },
    };
  }
  return { ok: false, error: { code: 'UNKNOWN_EDIT_FORMAT', message: `Unknown edit format: ${format}` } };
}

export function applyWholeFile(content: string): EditApplyResult {
  return { ok: true, content, meta: { format: 'whole' } };
}

export function applyDiffFenced(original: string, fencedEdit: string): EditApplyResult {
  const match = fencedEdit.match(/```(?:diff|search-replace)?\n([\s\S]*?)```/);
  return applySearchReplaceDiff(original, match ? match[1] : fencedEdit);
}

export function applySearchReplaceDiff(original: string, edit: string): EditApplyResult {
  const blocks = parseSearchReplaceBlocks(edit);
  if (blocks.length === 0) {
    return {
      ok: false,
      error: {
        code: 'SEARCH_REPLACE_BLOCK_MISSING',
        message: `[ERROR] SEARCH_REPLACE_BLOCK_MISSING\nUse ${SEARCH_MARKER}, ${DIVIDER_MARKER}, and ${REPLACE_MARKER} markers.`,
      },
    };
  }

  let next = original;
  for (const block of blocks) {
    const applied = applyOneSearchReplaceBlock(next, block);
    if (!applied.ok) return applied;
    next = applied.content as string;
  }
  return { ok: true, content: next, meta: { format: 'diff', blocks: blocks.length } };
}

export function parseSearchReplaceBlocks(edit: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  let cursor = 0;
  while (cursor < edit.length) {
    const start = edit.indexOf(SEARCH_MARKER, cursor);
    if (start === -1) break;
    const divider = edit.indexOf(DIVIDER_MARKER, start + SEARCH_MARKER.length);
    const end = edit.indexOf(REPLACE_MARKER, divider + DIVIDER_MARKER.length);
    if (divider === -1 || end === -1) break;
    const search = trimOneLeadingNewline(edit.slice(start + SEARCH_MARKER.length, divider));
    const replace = trimOneLeadingNewline(edit.slice(divider + DIVIDER_MARKER.length, end));
    blocks.push({ search: trimOneTrailingNewline(search), replace: trimOneTrailingNewline(replace) });
    cursor = end + REPLACE_MARKER.length;
  }
  return blocks;
}

export function applyOneSearchReplaceBlock(original: string, block: SearchReplaceBlock): EditApplyResult {
  const exactIndex = original.indexOf(block.search);
  if (exactIndex !== -1) {
    return {
      ok: true,
      content: original.slice(0, exactIndex) + block.replace + original.slice(exactIndex + block.search.length),
      meta: { strategy: 'exact' },
    };
  }

  const whitespaceMatch = findNormalizedMatch(original, block.search, normalizeWhitespace);
  if (whitespaceMatch) {
    return replaceRange(original, whitespaceMatch.start, whitespaceMatch.end, block.replace, 'whitespace-normalized');
  }

  const emptyLineMatch = findNormalizedMatch(original, block.search, normalizeEmptyLines);
  if (emptyLineMatch) {
    return replaceRange(original, emptyLineMatch.start, emptyLineMatch.end, block.replace, 'empty-line-insensitive');
  }

  return createSearchReplaceNoMatch(original, block.search);
}

export function applyUnifiedDiffStrict(original: string, patch: string): EditApplyResult {
  const lines = patch.split('\n');
  const hunkHeaders = lines.filter((line) => line.startsWith('@@ '));
  if (hunkHeaders.length === 0 || !patch.startsWith('--- ')) {
    return {
      ok: false,
      error: {
        code: 'INVALID_UNIFIED_DIFF',
        message: '[ERROR] INVALID_UNIFIED_DIFF\nUnified diff must include file headers and at least one @@ hunk.',
      },
    };
  }

  let originalLines = original.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i];
    if (!header.startsWith('@@ ')) continue;
    const match = header.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (!match) {
      return { ok: false, error: { code: 'INVALID_HUNK_HEADER', message: `[ERROR] INVALID_HUNK_HEADER\n${header}` } };
    }
    const start = Number(match[1]) - 1 + offset;
    const oldChunk: string[] = [];
    const newChunk: string[] = [];
    i += 1;
    while (i < lines.length && !lines[i].startsWith('@@ ')) {
      const line = lines[i];
      if (line.startsWith(' ')) {
        oldChunk.push(line.slice(1));
        newChunk.push(line.slice(1));
      } else if (line.startsWith('-')) {
        oldChunk.push(line.slice(1));
      } else if (line.startsWith('+')) {
        newChunk.push(line.slice(1));
      } else if (line === '\\ No newline at end of file') {
        // Metadata line from unified diff, not file content.
      } else if (!line.startsWith('--- ') && !line.startsWith('+++ ')) {
        return { ok: false, error: { code: 'INVALID_HUNK_LINE', message: `[ERROR] INVALID_HUNK_LINE\n${line}` } };
      }
      i += 1;
    }
    i -= 1;

    const existing = originalLines.slice(start, start + oldChunk.length);
    if (existing.join('\n') !== oldChunk.join('\n')) {
      return {
        ok: false,
        error: {
          code: 'UNIFIED_DIFF_CONTEXT_MISMATCH',
          message: `[ERROR] UNIFIED_DIFF_CONTEXT_MISMATCH\nHunk starting at line ${start + 1} did not match file content.`,
          details: { expected: oldChunk.join('\n'), actual: existing.join('\n') },
        },
      };
    }
    originalLines = [...originalLines.slice(0, start), ...newChunk, ...originalLines.slice(start + oldChunk.length)];
    offset += newChunk.length - oldChunk.length;
  }

  return { ok: true, content: originalLines.join('\n'), meta: { format: 'udiff', strict: true } };
}

function replaceRange(original: string, start: number, end: number, replace: string, strategy: string): EditApplyResult {
  return {
    ok: true,
    content: original.slice(0, start) + replace + original.slice(end),
    meta: { strategy },
  };
}

function createSearchReplaceNoMatch(original: string, search: string): EditApplyResult {
  const closest = closestLineWindow(original, search);
  return {
    ok: false,
    error: {
      code: 'SEARCH_REPLACE_NO_MATCH',
      message: [
        '[ERROR] SEARCH_REPLACE_NO_MATCH',
        'The SEARCH block did not match the file.',
        '',
        'Searched block preview:',
        preview(search),
        '',
        `Closest-match lines: ${closest.startLine}-${closest.endLine}`,
        `Similarity score: ${closest.score.toFixed(3)}`,
        'Closest-match context:',
        closest.context,
        '',
        'Corrected SEARCH guidance: copy the exact current file text from read_file output, include enough surrounding context, and keep whitespace identical when possible.',
      ].join('\n'),
      details: {
        searchedPreview: preview(search),
        closestContext: closest.context,
        startLine: closest.startLine,
        endLine: closest.endLine,
        similarityScore: closest.score,
      },
    },
  };
}

function findNormalizedMatch(
  original: string,
  search: string,
  normalize: (value: string) => string,
): { start: number; end: number } | null {
  const originalLines = original.split('\n');
  const searchLineCount = search.split('\n').length;
  const normalizedSearch = normalize(search);
  for (let startLine = 0; startLine < originalLines.length; startLine += 1) {
    for (let length = Math.max(1, searchLineCount - 2); length <= searchLineCount + 2; length += 1) {
      const candidate = originalLines.slice(startLine, startLine + length).join('\n');
      if (normalize(candidate) === normalizedSearch) {
        return {
          start: charOffsetForLine(originalLines, startLine),
          end: charOffsetForLine(originalLines, startLine + length),
        };
      }
    }
  }
  return null;
}

function closestLineWindow(original: string, search: string): { startLine: number; endLine: number; context: string; score: number } {
  const originalLines = original.split('\n');
  const searchLines = search.split('\n');
  const targetLength = Math.max(1, searchLines.length);
  let best = { startLine: 1, endLine: Math.min(originalLines.length, targetLength), context: '', score: 0 };

  for (let index = 0; index < originalLines.length; index += 1) {
    const contextLines = originalLines.slice(index, index + targetLength + 4);
    const score = similarity(normalizeWhitespace(contextLines.join('\n')), normalizeWhitespace(search));
    if (score > best.score) {
      best = {
        startLine: index + 1,
        endLine: index + contextLines.length,
        context: withLineNumbers(contextLines, index + 1),
        score,
      };
    }
  }

  return best;
}

function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function withLineNumbers(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index}: ${line}`).join('\n');
}

function charOffsetForLine(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join('\n').length + (lineIndex === 0 ? 0 : 1);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[ \t]+/g, ' ').trim();
}

function normalizeEmptyLines(value: string): string {
  return value
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim())
    .join('\n');
}

function preview(value: string): string {
  const lines = value.split('\n');
  return lines.slice(0, 12).join('\n') + (lines.length > 12 ? '\n...' : '');
}

function trimOneLeadingNewline(value: string): string {
  return value.startsWith('\n') ? value.slice(1) : value;
}

function trimOneTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}
