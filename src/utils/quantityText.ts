export interface StatedQuantity {
  raw: string;
  grams?: number;
  itemRefText?: string;
  isQuestion?: boolean;
  isPastReference?: boolean;
  count?: number;
  unit?: string;
  fraction?: number;
  unitNoun?: string;
}

export function parseStatedQuantity(text: unknown, locale: unknown): StatedQuantity[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const results: StatedQuantity[] = [];
  
  const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:g|grams)\b/i);
  if (gramMatch) {
    results.push({
      raw: gramMatch[0],
      grams: parseFloat(gramMatch[1]),
      itemRefText: text.replace(gramMatch[0], '').trim(),
      isQuestion: /\?/.test(text),
      isPastReference: /\b(?:yesterday|last|previous)\b/i.test(text)
    });
  } else {
    results.push({
      raw: text,
      itemRefText: text.trim(),
      isQuestion: /\?/.test(text),
      isPastReference: /\b(?:yesterday|last|previous)\b/i.test(text)
    });
  }
  
  return results;
}
