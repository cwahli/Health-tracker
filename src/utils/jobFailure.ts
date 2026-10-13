/** Turn worker/Gemini abort strings into a line a human can act on. */
export function humanizeJobFailure(raw: string | null | undefined, modelHint?: string | null): string {
  const s = String(raw || '').trim();
  const model = modelHint || (s.match(/gemini-[a-z0-9.-]+/i) || [])[0] || 'this model';

  if (/429|RESOURCE_EXHAUSTED|quota exceeded|quota cooldown/i.test(s)) {
    return `Gemini free-tier quota on ${model} (15 requests/min). Wait the retry-after, or switch to Gemini 3.1 Flash Lite (separate bucket). Not a bad photo.`;
  }
  if (/stream stalled|no response from analysis engine|produced no tokens/i.test(s)) {
    return `Vision Scout went silent for 90s on ${model} after the prompt was sent. Gemini often hangs like this when the free-tier bucket is exhausted or the model is overloaded — not a bad photo. Switch to Gemini 3.1 Flash Lite and retry.`;
  }
  if (/timed out after 180s|timed out after 150/i.test(s)) {
    return `The meal job hit the 180s wall before Scout finished. Usually quota/overload, not your photos. Switch model and retry.`;
  }
  if (/503|UNAVAILABLE|high demand/i.test(s)) {
    return `Gemini ${model} is overloaded. Wait a moment or switch to Gemini 3.1 Flash Lite.`;
  }
  if (/Vision Scout Corrupted/i.test(s)) {
    return 'Analysis failed.';
  }
  // F1: raw Vision Scout failures must never render API JSON, status codes,
  // or key-validity text (e.g. 400 "API key not valid"). Normalize to a
  // modality-neutral meal message (fixes text meals told to "re-upload" an
  // image they never sent).
  if (/Vision Scout Failed/i.test(s)) {
    return "Couldn't analyze this meal. Please try again.";
  }
  // F1: raw fetch/protocol failures must never render bodies or codes.
  if (/Request failed|Server returned|Details:|\bAPI key\b|api key not valid/i.test(s) || (/\b[45]\d\d\b/.test(s) && /[\{\}]/i.test(s))) {
    return 'Analysis failed. Please try again.';
  }
  const out = s || 'Analysis failed.';
  return /Vision Scout Corrupted/i.test(out) ? 'Analysis failed.' : out;
}
