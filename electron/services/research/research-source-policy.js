const DIRECTORY_HOST_PATTERNS = [
  'wikipedia.org',
  'wikidata.org',
  'mapquest.com',
  'yelp.com',
  'yellowpages.com',
  'findhelp.org',
  'psychologytoday.com',
  'rehab.com',
  'healthgrades.com',
  'zocdoc.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'youtube.com',
];

const DIRECTORY_PATH_PATTERNS = [
  '/directory',
  '/directories',
  '/listing',
  '/listings',
  '/reviews',
  '/compare',
  '/find/',
  '/search',
];

const OFFICIAL_TITLE_HINTS = [
  /\bofficial\b/i,
  /\babout us\b/i,
  /\bcontact us\b/i,
  /\bour programs\b/i,
  /\bservices\b/i,
  /\bapply\b/i,
  /\breferral\b/i,
];

const REJECT_TITLE_HINTS = [
  /\bbest\b/i,
  /\btop\b/i,
  /\breviews?\b/i,
  /\bcompare\b/i,
  /\bdirectory\b/i,
];

const DEFAULT_SOURCE_POLICY = {
  mode: 'discover_broad_verify_official',
  requireOfficial: true,
  rejectDirectoryPages: true,
  rejectSocialProfiles: true,
  officialDomains: [],
};

function safeLower(input) {
  return String(input || '').trim().toLowerCase();
}

function normalizeDomain(input) {
  let domain = safeLower(input);
  if (!domain) return '';
  if (domain.startsWith('www.')) domain = domain.slice(4);
  return domain;
}

function normalizeUrl(urlLike) {
  const raw = String(urlLike || '').trim();
  if (!raw) return '';
  try {
    const value = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

function domainMatches(candidateDomain, targetDomain) {
  const left = normalizeDomain(candidateDomain);
  const right = normalizeDomain(targetDomain);
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`);
}

function hostLooksInstitutional(domain) {
  if (!domain) return false;
  if (domain.endsWith('.gov') || domain.endsWith('.edu')) return true;
  const segments = domain.split('.');
  if (segments.length <= 2) return true;
  return !['blogspot.com', 'substack.com', 'wordpress.com', 'medium.com'].some((host) => domainMatches(domain, host));
}

function isDirectoryHost(domain) {
  return DIRECTORY_HOST_PATTERNS.some((item) => domainMatches(domain, item));
}

function isDirectoryPath(pathname = '') {
  const lowered = safeLower(pathname);
  if (!lowered) return false;
  return DIRECTORY_PATH_PATTERNS.some((pattern) => lowered.includes(pattern));
}

function titleLooksDirectory(title = '', snippet = '') {
  const haystack = `${title || ''} ${snippet || ''}`;
  return REJECT_TITLE_HINTS.some((pattern) => pattern.test(haystack));
}

function titleLooksOfficial(title = '', snippet = '') {
  const haystack = `${title || ''} ${snippet || ''}`;
  return OFFICIAL_TITLE_HINTS.some((pattern) => pattern.test(haystack));
}

function classifySource(candidate = {}, rawPolicy = DEFAULT_SOURCE_POLICY) {
  const policy = {
    ...DEFAULT_SOURCE_POLICY,
    ...(rawPolicy || {}),
    officialDomains: Array.isArray(rawPolicy?.officialDomains)
      ? rawPolicy.officialDomains.map(normalizeDomain).filter(Boolean)
      : [],
  };

  const normalizedUrl = normalizeUrl(candidate.url || candidate.source_url || '');
  if (!normalizedUrl) {
    return {
      normalizedUrl: '',
      domain: '',
      isOfficial: false,
      isRejected: true,
      confidence: 0,
      reason: 'invalid_url',
    };
  }

  const parsed = new URL(normalizedUrl);
  const domain = normalizeDomain(parsed.hostname);
  const title = String(candidate.title || candidate.source_title || '');
  const snippet = String(candidate.snippet || candidate.excerpt_text || '');

  if (policy.officialDomains.length > 0) {
    const allowed = policy.officialDomains.some((item) => domainMatches(domain, item));
    if (!allowed) {
      return {
        normalizedUrl,
        domain,
        isOfficial: false,
        isRejected: true,
        confidence: 0.05,
        reason: 'not_in_official_allowlist',
      };
    }
  }

  const isDirectory = isDirectoryHost(domain) || isDirectoryPath(parsed.pathname) || titleLooksDirectory(title, snippet);
  if (policy.rejectDirectoryPages && isDirectory) {
    return {
      normalizedUrl,
      domain,
      isOfficial: false,
      isRejected: true,
      confidence: 0.1,
      reason: 'directory_or_review_source',
    };
  }

  const looksSocial = ['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'linkedin.com', 'youtube.com']
    .some((item) => domainMatches(domain, item));
  if (policy.rejectSocialProfiles && looksSocial) {
    return {
      normalizedUrl,
      domain,
      isOfficial: false,
      isRejected: true,
      confidence: 0.1,
      reason: 'social_profile_source',
    };
  }

  let confidence = 0.2;
  if (hostLooksInstitutional(domain)) confidence += 0.25;
  if (titleLooksOfficial(title, snippet)) confidence += 0.25;
  if (domain.endsWith('.gov') || domain.endsWith('.edu')) confidence += 0.2;

  const isOfficial = confidence >= 0.55;
  return {
    normalizedUrl,
    domain,
    isOfficial,
    isRejected: false,
    confidence: Math.min(1, Math.max(0, confidence)),
    reason: isOfficial ? 'official_confident' : 'insufficient_official_confidence',
  };
}

function mergeSourcePolicy(basePolicy = DEFAULT_SOURCE_POLICY, overridePolicy = {}) {
  const merged = {
    ...DEFAULT_SOURCE_POLICY,
    ...(basePolicy || {}),
    ...(overridePolicy || {}),
  };
  const officialDomains = []
    .concat(basePolicy?.officialDomains || [])
    .concat(overridePolicy?.officialDomains || [])
    .map(normalizeDomain)
    .filter(Boolean);
  merged.officialDomains = Array.from(new Set(officialDomains));
  return merged;
}

module.exports = {
  DEFAULT_SOURCE_POLICY,
  classifySource,
  mergeSourcePolicy,
  normalizeUrl,
  normalizeDomain,
  domainMatches,
};
