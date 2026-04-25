/**
 * Draft Selector Service
 *
 * Pairs a "main" chat model with a compatible "draft" model so the
 * Phase 2 speculative-decoding loop has a sensible default. The draft
 * runs on the NPU; the main runs on RTX/CPU. For speculative decoding
 * to work the two models MUST share a tokenizer; same family + chat
 * template is also strongly preferred.
 *
 * Source-of-truth precedence:
 *   1. User override file at scripts/draft-pairs.json (read on demand,
 *      not cached -- it's small enough to re-parse, and the user can
 *      edit it without restarting the app).
 *   2. Curated table in this file (data, not code -- ships with the
 *      release; the only place we vouch for compatibility scores).
 *   3. Heuristic fallback: same family detection by name patterns.
 *      Used when neither override nor curated entry is available.
 *
 * Compatibility scoring:
 *   1.0  Same tokenizer + same chat template (drop-in pair).
 *   0.7  Same family but different tokenizer revision (adapter needed
 *        before draft tokens can be fed to the verifier).
 *   < 0.5  Different family entirely; not a viable speculative pair.
 *
 * The orchestrator should refuse pairs scoring < 0.7 in production. The
 * 0.5 floor is for diagnostics / dev exploration only.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_OVERRIDE_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'draft-pairs.json');

// Curated pair table. Each main lists the draft we recommend, the
// tokenizer family they share, and a score. Patterns are matched
// case-insensitively against the orchestrator's incoming model id.
const CURATED_PAIRS = [
  // ─── Qwen 2.5 ───────────────────────────────────────────────
  // 0.5B / 1.5B drafts share tokenizer with all sibling sizes.
  {
    family: 'qwen2.5',
    tokenizerId: 'qwen2',
    score: 1.0,
    drafts: ['qwen2.5:1.5b', 'qwen2.5:0.5b', 'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov'],
    matches: [/^qwen2\.5:(?:7b|14b|32b|72b)/i, /Qwen2\.5-(?:7B|14B|32B|72B)/i],
  },
  {
    family: 'qwen2.5-coder',
    tokenizerId: 'qwen2',
    score: 1.0,
    drafts: ['qwen2.5-coder:1.5b', 'qwen2.5-coder:0.5b'],
    matches: [/^qwen2\.5-coder:(?:7b|14b|32b)/i, /Qwen2\.5-Coder-(?:7B|14B|32B)/i],
  },

  // ─── Llama 3.x ──────────────────────────────────────────────
  // 1B/3B drafts share tokenizer with 8B/70B/405B across 3.1 and 3.2.
  // Ordered most-specific-first so 3.1 matches do not get captured by
  // the 3.2 entry.
  {
    family: 'llama3.1',
    tokenizerId: 'llama3',
    score: 1.0,
    drafts: ['llama3.2:1b', 'llama3.2:3b'],
    matches: [/^llama3\.1:(?:8b|70b|405b)/i, /Llama-3\.1-(?:8B|70B|405B)/i],
  },
  {
    family: 'llama3.2',
    tokenizerId: 'llama3',
    score: 1.0,
    drafts: ['llama3.2:1b', 'llama3.2:3b'],
    matches: [/^llama3\.2:(?:8b|70b)/i, /Meta-Llama-3\.2-(?:8B|70B)/i],
  },

  // ─── DeepSeek ───────────────────────────────────────────────
  // R1 distilled drafts share tokenizer family with their bases.
  {
    family: 'deepseek-r1',
    tokenizerId: 'deepseek',
    score: 1.0,
    drafts: ['deepseek-r1:1.5b'],
    matches: [/^deepseek-r1:(?:7b|8b|14b|32b|70b)/i, /DeepSeek-R1-Distill-(?:Qwen|Llama)-(?:7B|14B|32B|70B)/i],
  },
  {
    family: 'deepseek-coder',
    tokenizerId: 'deepseek-coder',
    score: 1.0,
    drafts: ['deepseek-coder:1.3b', 'deepseek-coder:6.7b'],
    matches: [/^deepseek-coder:(?:6\.7b|33b)/i, /deepseek-coder-(?:6\.7|33)b/i],
  },

  // ─── Phi-4 family ───────────────────────────────────────────
  // Phi-4 mini is the recommended draft for Phi-4 14B. Tokenizer is
  // the same Phi-4 SentencePiece BPE; chat template is identical.
  {
    family: 'phi-4',
    tokenizerId: 'phi-4',
    score: 1.0,
    drafts: ['phi4-mini:3.8b', 'phi-4-mini-instruct'],
    matches: [/^phi-?4:(?:14b)/i, /Phi-4(?:-instruct)?(?:-(?:14b|q4_k_m|q5_k_m))?/i],
  },

  // ─── Mistral / Mixtral ──────────────────────────────────────
  // 7B Instruct and Nemo share tokenizer; Mixtral 8x7B is also
  // tokenizer-compatible with Mistral 7B.
  {
    family: 'mistral',
    tokenizerId: 'mistral-v0.3',
    score: 0.9,
    drafts: ['mistral:7b'],
    matches: [/^mixtral:(?:8x7b|8x22b)/i, /Mixtral-8x(?:7B|22B)/i],
  },
];

const HEURISTIC_FAMILIES = [
  { tag: 'qwen2.5', score: 0.7, draft: 'qwen2.5:1.5b' },
  { tag: 'qwen2.5-coder', score: 0.7, draft: 'qwen2.5-coder:1.5b' },
  { tag: 'llama3', score: 0.7, draft: 'llama3.2:1b' },
  { tag: 'deepseek-r1', score: 0.7, draft: 'deepseek-r1:1.5b' },
  { tag: 'deepseek-coder', score: 0.7, draft: 'deepseek-coder:1.3b' },
  { tag: 'phi-4', score: 0.7, draft: 'phi4-mini:3.8b' },
  { tag: 'mistral', score: 0.6, draft: 'mistral:7b' },
];

function readOverrides(overridePath = DEFAULT_OVERRIDE_PATH) {
  try {
    if (!fs.existsSync(overridePath)) return [];
    const raw = fs.readFileSync(overridePath, 'utf8');
    const parsed = JSON.parse(raw);
    const pairs = Array.isArray(parsed?.pairs) ? parsed.pairs : [];
    // Tolerate sloppy hand-edits: filter out entries missing the two
    // required fields rather than rejecting the whole file.
    return pairs.filter((entry) => entry && entry.main && entry.draft);
  } catch (err) {
    console.warn(`[DraftSelector] Failed to read override file ${overridePath}:`, err?.message || err);
    return [];
  }
}

function normalizeId(modelId) {
  return String(modelId || '').trim();
}

function matchCurated(modelId) {
  const id = normalizeId(modelId);
  if (!id) return null;
  for (const entry of CURATED_PAIRS) {
    if ((entry.matches || []).some((re) => re.test(id))) {
      return {
        draftModelId: entry.drafts[0],
        draftCandidates: [...entry.drafts],
        tokenizerId: entry.tokenizerId,
        family: entry.family,
        score: entry.score,
        source: 'curated',
      };
    }
  }
  return null;
}

function matchHeuristic(modelId) {
  const id = normalizeId(modelId).toLowerCase();
  if (!id) return null;
  for (const entry of HEURISTIC_FAMILIES) {
    if (id.includes(entry.tag)) {
      return {
        draftModelId: entry.draft,
        draftCandidates: [entry.draft],
        tokenizerId: entry.tag,
        family: entry.tag,
        score: entry.score,
        source: 'heuristic',
      };
    }
  }
  return null;
}

function getDraftFor(mainModelId, options = {}) {
  const id = normalizeId(mainModelId);
  if (!id) return null;

  const overridePath = options.overridePath || DEFAULT_OVERRIDE_PATH;
  const overrides = readOverrides(overridePath);
  const overrideHit = overrides.find((entry) => normalizeId(entry.main) === id || id.includes(normalizeId(entry.main)));
  if (overrideHit) {
    return {
      draftModelId: normalizeId(overrideHit.draft),
      draftCandidates: [normalizeId(overrideHit.draft)],
      tokenizerId: overrideHit.tokenizerId || null,
      family: overrideHit.family || 'override',
      score: typeof overrideHit.score === 'number' ? overrideHit.score : 1.0,
      source: 'override',
    };
  }

  return matchCurated(id) || matchHeuristic(id);
}

function listSupportedMains() {
  const mains = new Set();
  for (const entry of CURATED_PAIRS) {
    for (const re of (entry.matches || [])) {
      mains.add(re.source);
    }
  }
  return [...mains];
}

function validatePair({ mainTokenizer, draftTokenizer, mainTokenizerHash, draftTokenizerHash } = {}) {
  // Hash equivalence is the strongest signal: the two models were
  // exported with the same tokenizer.json. Phase 2 verifier requires
  // this for production routing.
  if (mainTokenizerHash && draftTokenizerHash) {
    const compatible = mainTokenizerHash === draftTokenizerHash;
    return {
      compatible,
      reason: compatible ? 'tokenizer-hash-match' : 'tokenizer-hash-mismatch',
      score: compatible ? 1.0 : 0.0,
    };
  }
  // Fallback: compare tokenizer family ids when hashes are unavailable
  // (e.g. one side is GGUF and the other is OpenVINO).
  if (mainTokenizer && draftTokenizer) {
    const compatible = String(mainTokenizer).toLowerCase() === String(draftTokenizer).toLowerCase();
    return {
      compatible,
      reason: compatible ? 'tokenizer-id-match' : 'tokenizer-id-mismatch',
      score: compatible ? 0.85 : 0.0,
    };
  }
  return {
    compatible: false,
    reason: 'tokenizer-info-missing',
    score: 0.0,
  };
}

function loadOverrides(overridePath = DEFAULT_OVERRIDE_PATH) {
  return readOverrides(overridePath);
}

module.exports = {
  getDraftFor,
  listSupportedMains,
  validatePair,
  loadOverrides,
  CURATED_PAIRS,
  HEURISTIC_FAMILIES,
  DEFAULT_OVERRIDE_PATH,
};
