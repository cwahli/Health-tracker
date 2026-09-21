const DECISION_HINTS = [
  /\bi'?ll\b/i,
  /\bi will\b/i,
  /\bneed to\b/i,
  /\bshould\b/i,
  /\bbecause\b/i,
  /\bso that\b/i,
  /\bfirst\b/i,
  /\bnext\b/i,
  /\bthen\b/i,
  /\blet me\b/i,
  /\bcheck\b/i,
  /\bfix\b/i,
  /\bthe (bug|issue|problem|error)\b/i,
  /\broot cause\b/i,
  /\bplan\b/i,
];

export function cleanReasoning(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#*_>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSentences(text) {
  return cleanReasoning(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function compressReasoning(text, { maxChars = 220 } = {}) {
  const sentences = splitSentences(text);
  if (!sentences.length) return '';
  const picked = [sentences[0]];
  for (const sentence of sentences.slice(1)) {
    if (picked.join(' ').length >= maxChars) break;
    if (DECISION_HINTS.some((re) => re.test(sentence))) picked.push(sentence);
  }
  let out = picked.join(' ');
  if (out.length > maxChars) {
    const room = Math.max(0, maxChars - 3);
    out = `${out.slice(0, room).replace(/\s+\S*$/, '')}...`;
  }
  return out;
}
