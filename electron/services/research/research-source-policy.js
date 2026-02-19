/**
 * Research Source Policy
 *
 * Strict-by-default policy intended for verification-heavy research.
 * Official/authoritative sources are prioritized and tertiary sources are blocked.
 */

const SPAM_DOMAINS = [
  'pinterest.com',
  'reddit.com',
  'quora.com',
  'tiktok.com',
  'ebay.com',
  'etsy.com',
  'fandom.com',
];

const SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'threads.net',
];

const DIRECTORY_DOMAINS = [
  'yelp.com',
  'yellowpages.com',
  'mapquest.com',
  'healthgrades.com',
  'zocdoc.com',
];

const TERTIARY_REFERENCE_DOMAINS = [
  'wikipedia.org',
  'wikidata.org',
  'wikivoyage.org',
  'britannica.com',
];

const AUTHORITATIVE_TLDS = ['.gov', '.mil', '.edu'];
const SECONDARY_TLDS = ['.org'];
const COMMERCIAL_OFFICIAL_TLDS = ['.com', '.io', '.ai', '.co', '.dev', '.app'];

const DEFAULT_HARD_BLOCKLIST = [
  ...SPAM_DOMAINS,
  ...SOCIAL_DOMAINS,
  ...DIRECTORY_DOMAINS,
  ...TERTIARY_REFERENCE_DOMAINS,
];

const DEFAULT_SOURCE_POLICY = {
  mode: 'strict_official_first',
  requireOfficial: true,
  allowSecondary: false,
  rejectSpam: true,
  rejectSocial: true,
  rejectDirectories: true,
  rejectTertiary: true,
  allowedDomains: [],
  officialDomains: [],
  secondaryDomains: [],
  blockedDomains: [],
  hardBlockedDomains: DEFAULT_HARD_BLOCKLIST,
};

function safeLower(input) {
  return String(input || '').trim().toLowerCase();
}

function normalizeDomain(input) {
  let domain = safeLower(input);
  if (!domain) return '';

  if (domain.includes('://')) {
    try {
      domain = new URL(domain).hostname.toLowerCase();
    } catch (_error) {
      // fall through
    }
  }

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

function matchesDomainList(domain, list = []) {
  if (!domain || !Array.isArray(list) || list.length === 0) return false;
  return list.some((item) => domainMatches(domain, item));
}

function normalizeDomainList(list = []) {
  return Array.from(new Set((Array.isArray(list) ? list : [])
    .map((item) => normalizeDomain(item))
    .filter(Boolean)));
}

function normalizePolicy(rawPolicy = {}) {
  const source = rawPolicy && typeof rawPolicy === 'object' ? rawPolicy : {};
  const policy = { ...DEFAULT_SOURCE_POLICY, ...source };

  // Legacy aliases
  if (source.rejectDirectoryPages !== undefined && source.rejectDirectories === undefined) {
    policy.rejectDirectories = Boolean(source.rejectDirectoryPages);
  }
  if (source.rejectSocialProfiles !== undefined && source.rejectSocial === undefined) {
    policy.rejectSocial = Boolean(source.rejectSocialProfiles);
  }
  if (Array.isArray(source.officialDomains) && source.allowedDomains === undefined) {
    policy.allowedDomains = source.officialDomains.slice();
  }

  policy.mode = String(policy.mode || DEFAULT_SOURCE_POLICY.mode).trim().toLowerCase() || DEFAULT_SOURCE_POLICY.mode;

  if (policy.mode === 'strict_official_first' || policy.mode === 'official_first') {
    policy.requireOfficial = true;
    policy.allowSecondary = false;
    policy.rejectTertiary = true;
    policy.rejectSocial = true;
    policy.rejectDirectories = true;
  } else if (policy.mode === 'balanced') {
    policy.requireOfficial = true;
    policy.allowSecondary = true;
    policy.rejectTertiary = false;
  } else if (policy.mode === 'open_web') {
    policy.requireOfficial = false;
    policy.allowSecondary = true;
    policy.rejectTertiary = false;
  }

  policy.requireOfficial = Boolean(policy.requireOfficial);
  policy.allowSecondary = Boolean(policy.allowSecondary);
  policy.rejectSpam = Boolean(policy.rejectSpam);
  policy.rejectSocial = Boolean(policy.rejectSocial);
  policy.rejectDirectories = Boolean(policy.rejectDirectories);
  policy.rejectTertiary = Boolean(policy.rejectTertiary);
  policy.allowedDomains = normalizeDomainList(policy.allowedDomains);
  policy.officialDomains = normalizeDomainList(policy.officialDomains);
  policy.secondaryDomains = normalizeDomainList(policy.secondaryDomains);
  policy.blockedDomains = normalizeDomainList(policy.blockedDomains);
  policy.hardBlockedDomains = normalizeDomainList(
    (policy.hardBlockedDomains || []).concat(DEFAULT_HARD_BLOCKLIST)
  );

  return policy;
}

function classifyDomainTier(domain = '', policy = DEFAULT_SOURCE_POLICY) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { tier: 'rejected', domainClass: 'invalid', quality: 0 };

  if (
    matchesDomainList(normalized, policy.allowedDomains) ||
    matchesDomainList(normalized, policy.officialDomains) ||
    AUTHORITATIVE_TLDS.some((tld) => normalized.endsWith(tld))
  ) {
    return { tier: 'authoritative', domainClass: 'official', quality: 0.95, isOfficial: true };
  }

  if (COMMERCIAL_OFFICIAL_TLDS.some((tld) => normalized.endsWith(tld))) {
    return { tier: 'authoritative', domainClass: 'commercial', quality: 0.78, isOfficial: true };
  }

  if (
    matchesDomainList(normalized, policy.secondaryDomains) ||
    SECONDARY_TLDS.some((tld) => normalized.endsWith(tld))
  ) {
    return { tier: 'secondary', domainClass: 'secondary', quality: 0.68, isOfficial: false };
  }

  return { tier: 'tertiary', domainClass: 'tertiary', quality: 0.32, isOfficial: false };
}

/**
 * Returns:
 * {
 *   normalizedUrl, domain, quality, tier, domainClass,
 *   isRejected, isOfficial, reason
 * }
 */
function classifySource(candidate = {}, rawPolicy = DEFAULT_SOURCE_POLICY) {
  const policy = normalizePolicy(rawPolicy);
  const normalizedUrl = normalizeUrl(candidate.url || candidate.source_url || '');
  if (!normalizedUrl) {
    return {
      normalizedUrl: '',
      domain: '',
      quality: 0,
      tier: 'rejected',
      domainClass: 'invalid',
      isRejected: true,
      isOfficial: false,
      reason: 'invalid_url',
    };
  }

  let domain = '';
  try {
    domain = normalizeDomain(new URL(normalizedUrl).hostname);
  } catch (_error) {
    return {
      normalizedUrl,
      domain: '',
      quality: 0,
      tier: 'rejected',
      domainClass: 'invalid',
      isRejected: true,
      isOfficial: false,
      reason: 'invalid_url',
    };
  }

  if (
    matchesDomainList(domain, policy.hardBlockedDomains) ||
    matchesDomainList(domain, policy.blockedDomains)
  ) {
    return {
      normalizedUrl,
      domain,
      quality: 0,
      tier: 'rejected',
      domainClass: 'blocked',
      isRejected: true,
      isOfficial: false,
      reason: matchesDomainList(domain, policy.hardBlockedDomains) ? 'hard_blocked_domain' : 'blocked_domain',
    };
  }

  if (policy.rejectSpam && matchesDomainList(domain, SPAM_DOMAINS)) {
    return {
      normalizedUrl,
      domain,
      quality: 0,
      tier: 'rejected',
      domainClass: 'spam',
      isRejected: true,
      isOfficial: false,
      reason: 'spam_domain',
    };
  }

  if (policy.rejectSocial && matchesDomainList(domain, SOCIAL_DOMAINS)) {
    return {
      normalizedUrl,
      domain,
      quality: 0,
      tier: 'rejected',
      domainClass: 'social',
      isRejected: true,
      isOfficial: false,
      reason: 'social_domain',
    };
  }

  if (policy.rejectDirectories && matchesDomainList(domain, DIRECTORY_DOMAINS)) {
    return {
      normalizedUrl,
      domain,
      quality: 0,
      tier: 'rejected',
      domainClass: 'directory',
      isRejected: true,
      isOfficial: false,
      reason: 'directory_domain',
    };
  }

  const tierInfo = classifyDomainTier(domain, policy);
  const tier = tierInfo.tier || 'tertiary';
  const domainClass = tierInfo.domainClass || 'tertiary';
  const isOfficial = Boolean(tierInfo.isOfficial);

  if (policy.rejectTertiary && tier === 'tertiary') {
    return {
      normalizedUrl,
      domain,
      quality: 0.08,
      tier: 'rejected',
      domainClass,
      isRejected: true,
      isOfficial,
      reason: 'tertiary_source_rejected',
    };
  }

  if (policy.requireOfficial && tier !== 'authoritative') {
    if (policy.allowSecondary && tier === 'secondary') {
      return {
        normalizedUrl,
        domain,
        quality: Number(tierInfo.quality || 0.68),
        tier,
        domainClass,
        isRejected: false,
        isOfficial: false,
        reason: 'accepted_secondary_fallback',
      };
    }
    return {
      normalizedUrl,
      domain,
      quality: Number(tierInfo.quality || 0.2),
      tier: 'rejected',
      domainClass,
      isRejected: true,
      isOfficial: false,
      reason: 'non_authoritative_source',
    };
  }

  return {
    normalizedUrl,
    domain,
    quality: Number(tierInfo.quality || 0.5),
    tier,
    domainClass,
    isRejected: false,
    isOfficial,
    reason: `accepted_${tier}`,
  };
}

function mergeSourcePolicy(basePolicy = DEFAULT_SOURCE_POLICY, overridePolicy = {}) {
  const normalizedBase = normalizePolicy(basePolicy);
  const normalizedOverride = normalizePolicy(overridePolicy);
  const merged = {
    ...DEFAULT_SOURCE_POLICY,
    ...normalizedBase,
    ...normalizedOverride,
  };

  merged.allowedDomains = normalizeDomainList(
    (normalizedBase.allowedDomains || []).concat(normalizedOverride.allowedDomains || [])
  );
  merged.officialDomains = normalizeDomainList(
    (normalizedBase.officialDomains || []).concat(normalizedOverride.officialDomains || [])
  );
  merged.secondaryDomains = normalizeDomainList(
    (normalizedBase.secondaryDomains || []).concat(normalizedOverride.secondaryDomains || [])
  );
  merged.blockedDomains = normalizeDomainList(
    (normalizedBase.blockedDomains || []).concat(normalizedOverride.blockedDomains || [])
  );
  merged.hardBlockedDomains = normalizeDomainList(
    (normalizedBase.hardBlockedDomains || [])
      .concat(normalizedOverride.hardBlockedDomains || [])
      .concat(DEFAULT_HARD_BLOCKLIST)
  );

  merged.requireOfficial = Boolean(merged.requireOfficial);
  merged.allowSecondary = Boolean(merged.allowSecondary);
  merged.rejectSpam = Boolean(merged.rejectSpam);
  merged.rejectSocial = Boolean(merged.rejectSocial);
  merged.rejectDirectories = Boolean(merged.rejectDirectories);
  merged.rejectTertiary = Boolean(merged.rejectTertiary);

  return normalizePolicy(merged);
}

module.exports = {
  DEFAULT_SOURCE_POLICY,
  classifySource,
  mergeSourcePolicy,
  normalizeUrl,
  normalizeDomain,
  domainMatches,
  normalizePolicy,
};
