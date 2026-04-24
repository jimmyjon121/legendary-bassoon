const ACK_REGEX = /^(thanks|thank you|thx|ok|okay|cool|nice|great|sounds good|all good|appreciate it)[!.? ]*$/i;
const SIMPLE_GREETING_REGEX = /^(how are you|good morning|good afternoon|good evening|what's up|whats up)[!.? ]*$/i;
const GREETING_PREFIXES = new Set(['hi', 'hello', 'hey', 'yo', 'sup']);
const GREETING_TRAILING_TOKENS = new Set([
  'there',
  'again',
  'friend',
  'buddy',
  'pal',
  'mate',
  'bro',
  'sis',
  'team',
  'folks',
  'everyone',
  'all',
  'yall',
  "y'all",
  'my',
]);
const SELF_CHECK_PATTERNS = [
  /\bhow are you(?: doing)?(?: today)?\b/i,
  /\bhow's it going\b/i,
  /\bhows it going\b/i,
  /\bhow have you been\b/i,
  /\bare you (?:doing )?(?:okay|ok|good|well)\b/i,
  /\bdid you have a day\b/i,
  /\bhow was your day\b/i,
  /\bdid you sleep\b/i,
];

function claimsHumanExperience(text) {
  const lower = String(text || '').toLowerCase();
  const patterns = [
    'my day was',
    'my day has been',
    'i had a good day',
    'i had a great day',
    'i had a busy day',
    "i'm having a good day",
    "i'm having a great day",
    'i slept well',
    'i just woke up',
    "i've been busy today",
    'yes, my day was',
  ];
  return patterns.some((pattern) => lower.includes(pattern));
}

export function isGreetingPrompt(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (SIMPLE_GREETING_REGEX.test(raw)) return true;

  const normalized = raw
    .toLowerCase()
    .replace(/[.!?,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  if (!GREETING_PREFIXES.has(words[0])) return false;
  return words.slice(1).every((word) => GREETING_TRAILING_TOKENS.has(word));
}

export function isAcknowledgementPrompt(text) {
  return ACK_REGEX.test(String(text || '').trim());
}

export function isAssistantSelfCheckPrompt(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 140) return false;
  return SELF_CHECK_PATTERNS.some((pattern) => pattern.test(raw));
}

export function isShortTurnPrompt(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (isAssistantSelfCheckPrompt(raw)) return true;
  if (raw.length > 72) return false;
  return isGreetingPrompt(raw) || isAcknowledgementPrompt(raw);
}

const GREETING_REPLIES = [
  'Hey! What can I help you with?',
  'Hi there! What are you working on?',
  'Hey! What would you like to dive into?',
];

const ACK_REPLIES = [
  'Happy to help! Let me know if anything else comes up.',
  'Anytime! What else can I help with?',
  'Glad that helped! Anything else?',
];

const SELF_CHECK_REPLIES = [
  "I'm doing fine in AI terms. I don't actually have a day, but I'm here and ready to help.",
  "I'm here and ready to help. I don't experience days the way people do.",
  "Doing well on my side. I don't have a real day, but I'm ready to jump in.",
];

function pickRandom(arr) {
  if (!arr || arr.length === 0) return 'What can I help you with?';
  return arr[Math.floor(Math.random() * arr.length)];
}

export function buildShortTurnReply(text) {
  if (isAssistantSelfCheckPrompt(text)) return pickRandom(SELF_CHECK_REPLIES);
  if (isGreetingPrompt(text)) return pickRandom(GREETING_REPLIES);
  if (isAcknowledgementPrompt(text)) return pickRandom(ACK_REPLIES);
  return 'What can I help you with?';
}

export function sanitizeShortTurnOutput(prompt, output) {
  const raw = String(output || '').trim();
  const selfCheckPrompt = isAssistantSelfCheckPrompt(prompt);
  if (!selfCheckPrompt && !isShortTurnPrompt(prompt)) return raw;
  if (!raw) return buildShortTurnReply(prompt);

  const line = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^[#>*\-\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!line) return buildShortTurnReply(prompt);
  const firstSentence = (line.match(/^[^.!?]+[.!?]?/)?.[0] || line).trim();
  const wordCount = (firstSentence.match(/[A-Za-z0-9']+/g) || []).length;

  if (selfCheckPrompt && claimsHumanExperience(line)) {
    return buildShortTurnReply(prompt);
  }

  if (
    wordCount > (selfCheckPrompt ? 26 : 18) ||
    firstSentence.length > (selfCheckPrompt ? 180 : 140) ||
    /markdown|example of|first item|second item|quick links|here are|let me|i can help you with/i.test(firstSentence)
  ) {
    return buildShortTurnReply(prompt);
  }

  return firstSentence;
}
