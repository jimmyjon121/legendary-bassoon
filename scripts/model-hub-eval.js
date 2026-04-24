#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function read(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function assertContains(haystack, needle, description, failures) {
  if (!haystack.includes(needle)) {
    failures.push(description);
  }
}

function main() {
  const failures = [];
  const modelHubPanel = read('src/components/ModelHub/ModelHubPanel.jsx');
  const hfBrowser = read('electron/services/huggingface-browser.js');

  assertContains(
    modelHubPanel,
    'const HF_QUALITY_MODES = [',
    'Model Hub must define HF quality modes',
    failures
  );
  assertContains(
    modelHubPanel,
    "{ id: 'strict', label: 'Trusted only'",
    'Model Hub must expose strict creator-trust mode',
    failures
  );
  assertContains(
    modelHubPanel,
    "{ id: 'raw', label: 'Raw feed'",
    'Model Hub must expose raw feed mode',
    failures
  );
  assertContains(
    modelHubPanel,
    'if (hfQualityConfig.minScore > 0) {',
    'Model Hub must enforce quality score threshold filtering',
    failures
  );
  assertContains(
    modelHubPanel,
    'if (hfQualityConfig.hideLowSignal || hfHideNoisyModels) {',
    'Model Hub must suppress noisy low-signal repos by default quality policy',
    failures
  );
  assertContains(
    modelHubPanel,
    'const hfCreatorBuckets = useMemo(() => {',
    'Model Hub must support creator-grouped presentation',
    failures
  );
  assertContains(
    modelHubPanel,
    'const creator = getHfCreatorName(model);',
    'Model Hub creator grouping must derive canonical creator labels',
    failures
  );
  assertContains(
    modelHubPanel,
    'if (b.trust !== a.trust) return b.trust - a.trust;',
    'Model Hub creator groups must sort by creator trust',
    failures
  );
  assertContains(
    modelHubPanel,
    'const hfRequestSeqRef = useRef(0);',
    'Model Hub must track request sequence to prevent stale pagination writes',
    failures
  );
  assertContains(
    modelHubPanel,
    'if (requestSeq !== hfRequestSeqRef.current) return;',
    'Model Hub must ignore stale HuggingFace responses during concurrent refresh',
    failures
  );

  assertContains(
    hfBrowser,
    "normalizeCreatorInfo(input = '') {",
    'HF browser must normalize creator metadata',
    failures
  );
  assertContains(
    hfBrowser,
    "getCreatorTrustScore(creator = '') {",
    'HF browser must score creator trust for ranking',
    failures
  );
  assertContains(
    hfBrowser,
    'isLikelyLowSignalRepo({',
    'HF browser must classify noisy low-signal repos',
    failures
  );
  assertContains(
    hfBrowser,
    'computeModelQualityScore({',
    'HF browser must compute blended quality score',
    failures
  );
  assertContains(
    hfBrowser,
    'const qualityDiff = Number(b?.qualityScore || 0) - Number(a?.qualityScore || 0);',
    'HF browser pagination order must include quality score tie-break',
    failures
  );
  assertContains(
    hfBrowser,
    "const hasMore = Boolean(nextCursor && String(nextCursor) !== String(cursor || ''));",
    'HF browser paging must expose deterministic hasMore semantics',
    failures
  );

  if (failures.length > 0) {
    console.error('Model Hub Eval FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Model Hub Eval PASS');
}

main();
