#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(file, needle, label) {
  if (!file.includes(needle)) {
    throw new Error(`${label}: missing ${needle}`);
  }
}

function assertMatches(file, pattern, label) {
  if (!pattern.test(file)) {
    throw new Error(`${label}: missing pattern ${pattern}`);
  }
}

function main() {
  const profiles = read('src/agent-harness/modelProfiles.ts');
  const loop = read('src/agent-harness/masterLoop.ts');
  const registry = read('src/agent-harness/tools/registry.ts');
  const edits = read('src/agent-harness/edits/index.ts');
  const detection = read('src/agent-harness/detection/detectModelProfile.ts');
  const runtime = read('src/agent-harness/runtime/ollamaHarnessClient.ts');
  const repoMap = read('src/agent-harness/intelligence/repoMap.ts');
  const vectorIndex = read('src/agent-harness/intelligence/vectorIndex.ts');
  const modes = read('src/agent-harness/modes.ts');
  const canonicalPlan = read('docs/agent-harness-approved-plan.md');

  assertIncludes(canonicalPlan, 'Approved Canonical Plan', 'canonical plan capture');
  assertIncludes(profiles, "tool_format: 'native-json'", 'GPT-OSS native tool format');
  assertIncludes(profiles, "supports_native_tools: true", 'GPT-OSS native tool support');
  assertIncludes(profiles, "agent_loop_style: 'native-tools'", 'GPT-OSS native loop');
  assertIncludes(profiles, "edit_format: 'diff'", 'SEARCH/REPLACE default');
  assertIncludes(profiles, "reasoning_levels: {", 'GPT-OSS reasoning levels');
  assertIncludes(profiles, "tool_format: 'qwen3-xml'", 'Qwen3 XML tool format');
  assertIncludes(profiles, "temperature: 0.6", 'Qwen3 thinking temperature');
  assertIncludes(profiles, "presence_penalty: 1.5", 'Qwen3 presence penalty');
  assertIncludes(profiles, "tool_format: 'json-schema-fallback'", 'Gemma fallback');
  assertIncludes(profiles, "coding_quality_tier: 'usable'", 'Dolphin coding tier');
  assertIncludes(profiles, "tool_quality_tier: 'experimental'", 'Dolphin tool tier');
  assertIncludes(profiles, 'Math.floor(profile.context_window * 0.85)', 'computed compaction threshold');
  assertIncludes(profiles, 'source: DetectionSource', 'structured detection trace');

  assertIncludes(loop, 'new AbortController()', 'AbortController per run');
  assertIncludes(loop, 'REPEATED_IDENTICAL_TOOL_CALL', 'repeated tool-call guard');
  assertIncludes(loop, 'renderTodoReminder', 'TODO reminder injection');
  assertIncludes(loop, "'[ERROR] '", 'structured tool error prefix');
  assertIncludes(loop, 'compactMessagesAtThreshold', 'context compaction');

  for (const toolName of [
    'read_file',
    'write_file',
    'edit_file',
    'list_directory',
    'grep',
    'run_terminal_command',
    'run_tests',
    'repo_map',
    'codebase_search',
    'todo_write',
    'attempt_completion',
  ]) {
    assertIncludes(registry, `name: '${toolName}'`, `${toolName} registration`);
  }
  assertIncludes(registry, 'READ_REQUIRED_BEFORE_EDIT', 'read-before-edit guard');
  assertIncludes(registry, 'safeParse', 'Zod schema validation');
  assertIncludes(registry, 'suggestToolNames', 'unknown tool suggestions');
  assertIncludes(registry, 'Promise.all(readExecutions', 'read parallelization');
  assertIncludes(registry, 'serialExecutions', 'write/execute serialization');

  assertIncludes(edits, 'SEARCH_REPLACE_NO_MATCH', 'SEARCH/REPLACE no-match error');
  assertIncludes(edits, 'Closest-match lines:', 'closest-match line numbers');
  assertIncludes(edits, 'Similarity score:', 'similarity score');
  assertIncludes(edits, 'whitespace-normalized', 'whitespace fallback');
  assertIncludes(edits, 'empty-line-insensitive', 'empty-line fallback');
  assertIncludes(edits, 'applyUnifiedDiffStrict', 'strict unified diff');
  assertIncludes(edits, 'PATCH_FORMAT_RESERVED', 'patch reserved');

  assertMatches(detection, /Gemma3 name matched[\s\S]*capabilities did not include tools/, 'Gemma metadata tool gate');
  assertIncludes(detection, 'benchmarkCache.getByDigest', 'benchmark cache reuse');
  assertIncludes(detection, 'benchmarkCache.saveByDigest', 'benchmark persistence');
  assertIncludes(detection, "source: 'bench'", 'benchmark trace overwrite');

  assertIncludes(runtime, 'keep_alive: options.keep_alive', 'explicit keep_alive');
  assertIncludes(runtime, 'Math.max(32768, merged.num_ctx)', 'minimum num_ctx');
  assertIncludes(runtime, 'OLLAMA_FLASH_ATTENTION', 'flash attention env');
  assertIncludes(runtime, 'OLLAMA_KV_CACHE_TYPE', 'KV cache env');
  assertIncludes(runtime, '4 * 60 * 1000', '4-minute heartbeat');
  assertIncludes(runtime, 'messagePort?.postMessage', 'MessagePort streaming');
  assertIncludes(runtime, "profile.id === 'gpt-oss'", 'GPT-OSS reasoning-level override');

  assertIncludes(repoMap, 'class ParserRegistry', 'pluggable parser registry');
  assertIncludes(repoMap, "extensions: ['.js', '.jsx', '.ts', '.tsx']", 'JS/TS parser registration');
  assertIncludes(repoMap, 'rankSymbolsWithPageRank', 'PageRank-style symbol ranking');
  assertIncludes(vectorIndex, 'VECTOR_DIMENSIONS = 768', 'Qwen3 embedding dimensions');
  assertIncludes(vectorIndex, "EMBEDDING_MODEL_ID = 'Qwen3-Embedding-0.6B'", 'embedding model id');
  assertIncludes(vectorIndex, "SQLITE_VEC_EXTENSION = 'sqlite-vec'", 'sqlite-vec marker');
  assertIncludes(modes, 'resolveHarnessMode', 'mode resolution');
  assertIncludes(modes, 'profile.optimal_options', 'mode/profile resolution order');

  console.log('agent-harness-smoke PASS');
}

try {
  main();
} catch (error) {
  console.error('agent-harness-smoke FAIL');
  console.error(error.message);
  process.exit(1);
}
