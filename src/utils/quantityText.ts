/**
 * quantityText.ts — locale boundary for user-stated meal quantities.
 *
 * S-10 PORTION_FUNNEL: parse free-text quantity statements into STRUCTURED
 * candidates. All locale knowledge lives HERE (one declarative table per
 * locale). Decision logic in `server_portion_clarify.ts` imports only the
 * structured type below — it contains zero language, zero thresholds on
 * grams, zero packaging concepts. New country = table rows + tests here.
 *
 * Numbers+mass units (100g, 330ml, 1.5kg) parse language-free. Only fraction
 * words, interrogatives, past-time adverbials, and stopwords are per-locale.
 */

export interface StatedQuantity {
  /** Resolved mass in grams (density-1 assumption for ml/L). Null when the statement carries no computable mass (bare fraction, bare count). */
  grams: number | null;
  /** Fraction of a pack/container (0.5 = half). Null unless a fraction word matched. */
  fraction: number | null;
  /** Unit count ("2 cans" → 2). Null unless a count+unit matched. */
  count: number | null;
  /** Normalized unit noun ("can"). Null unless a count+unit matched. */
  unitNoun: string | null;
  /** Food token text ("kacang"). Null when the clause names no food (bare "100g"). */
  itemRefText: string | null;
  /** Interrogative shape ("is 100g a lot?") — not a consumption statement. */
  isQuestion: boolean;
  /** Past-time reference ("yesterday", "kemarin") — not this meal. */
  isPastReference: boolean;
  /** Matched clause span (for debug records). */
  raw: string;
}

interface LocaleTable {
  fractionWords: Record<string, number>;
  interrogativeStarts: string[];
  pastTimeWords: string[];
  stopwords: Set<string>;
  unitNouns: Record<string, string>;
}

const EN: LocaleTable = {
  fractionWords: { half: 0.5, halves: 0.5, quarter: 0.25, quarters: 0.25, third: 1 / 3, thirds: 1 / 3, whole: 1, full: 1 },
  interrogativeStarts: ['is', 'are', 'do', 'does', 'did', 'how', 'what', 'can', 'should', 'would'],
  pastTimeWords: ['yesterday', 'last week', 'last month', 'days ago'],
  stopwords: new Set(['i', 'a', 'an', 'the', 'of', 'and', 'had', 'have', 'has', 'ate', 'eat', 'eaten', 'with', 'this', 'that', 'my', 'for', 'please', 'log', 'just', 'only', 'about', 'around', 'it', 'its']),
  unitNouns: {
    can: 'can', cans: 'can', bottle: 'bottle', bottles: 'bottle', bar: 'bar', bars: 'bar',
    piece: 'piece', pieces: 'piece', slice: 'slice', slices: 'slice', pack: 'pack', packs: 'pack',
    cup: 'cup', cups: 'cup', bowl: 'bowl', bowls: 'bowl',
  },
};

const ID: LocaleTable = {
  fractionWords: { separuh: 0.5, setengah: 0.5, setengahnya: 0.5, seperempat: 0.25, seperempatnya: 0.25, sepertiga: 1 / 3, seluruh: 1, semua: 1, habis: 1 },
  interrogativeStarts: ['apakah', 'berapa', 'bagaimana', 'gimana', 'bolehkah', 'bisakah'],
  pastTimeWords: ['kemarin', 'kemaren', 'minggu lalu', 'bulan lalu', 'hari lalu'],
  stopwords: new Set(['saya', 'aku', 'gue', 'yang', 'ini', 'itu', 'dan', 'dengan', 'dari', 'makan', 'makanlah', 'habis', 'sudah', 'telah', 'baru', 'saja', 'aja', 'kira', 'sekitar', 'tolong', 'catat']),
  unitNouns: {
    kaleng: 'can', botol: 'bottle', batang: 'bar', potong: 'piece', iris: 'slice', bungkus: 'pack',
    cangkir: 'cup', mangkuk: 'bowl', gelas: 'cup', porsi: 'portion',
  },
};

function tableFor(locale: unknown): LocaleTable {
  const s = String(locale || 'en').toLowerCase();
  if (s.startsWith('id')) return ID;
  return EN;
}

const MASS_RE = /(\d+(?:\.\d+)?)\s*(kg|grams?|g|ml|l|liters?|litres?|oz)\b/i;
const COUNT_UNIT_RE = /\b(\d+)\s*([a-zA-Z]+)\b/;

function toGrams(n: number, unit: string): number | null {
  const u = unit.toLowerCase();
  if (u === 'kg') return Math.round(n * 1000);
  if (u === 'g' || u.startsWith('gram')) return Math.round(n);
  if (u === 'l' || u.startsWith('lit')) return Math.round(n * 1000);
  if (u === 'ml') return Math.round(n);
  if (u === 'oz') return Math.round(n * 28.35);
  return null;
}

function stripStopwords(text: string, table: LocaleTable): string {
  return text
    .split(/\s+/)
    .filter((w) => w && !table.stopwords.has(w.toLowerCase()))
    .join(' ')
    .trim();
}

function splitClauses(text: string): string[] {
  return text
    // Never split decimals ("1.5kg"): dot splits only on dot+whitespace.
    .split(/[,;+&]|\.\s+|(\band\b)|(\bdan\b)/i)
    .map((c) => (c || '').trim())
    .filter((c) => c && !/^(and|dan)$/i.test(c));
}

/**
 * Parse user-stated quantities from meal-log submission text.
 * Returns one entry per quantity-bearing clause. Clauses without quantities
 * produce no entry (zero candidates → funnel behavior unchanged).
 */
export function parseStatedQuantity(text: unknown, locale: unknown = 'en'): StatedQuantity[] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const table = tableFor(locale);
  const out: StatedQuantity[] = [];

  for (const clause of splitClauses(raw)) {
    const cl = clause.toLowerCase().trim();
    if (!cl) continue;
    const isQuestion =
      /\?\s*$/.test(clause.trim()) ||
      table.interrogativeStarts.some((w) => cl === w || cl.startsWith(`${w} `));
    const isPastReference = table.pastTimeWords.some((w) => cl.includes(w));

    // Fraction words ("half the kacang", "separuh kacang").
    let fraction: number | null = null;
    let rest = clause;
    for (const [word, val] of Object.entries(table.fractionWords)) {
      const m = cl.match(new RegExp(`\\b${word}\\b`, 'i'));
      if (m) {
        fraction = val;
        rest = (clause.slice(0, m.index) + ' ' + clause.slice(m.index + m[0].length)).trim();
        break;
      }
    }

    // Mass mention ("100g", "330 ml", "1.5kg").
    let grams: number | null = null;
    let massSpan = '';
    const massMatch = rest.match(MASS_RE);
    if (massMatch) {
      grams = toGrams(parseFloat(massMatch[1]), massMatch[2]);
      massSpan = massMatch[0];
      rest = (rest.slice(0, massMatch.index) + ' ' + rest.slice(massMatch.index + massMatch[0].length)).trim();
    }

    // Count + unit ("2 cans", "1 kaleng").
    let count: number | null = null;
    let unitNoun: string | null = null;
    if (grams == null && fraction == null) {
      const cu = rest.match(COUNT_UNIT_RE);
      if (cu) {
        const noun = table.unitNouns[cu[2].toLowerCase()];
        if (noun) {
          count = parseInt(cu[1], 10);
          unitNoun = noun;
          rest = (rest.slice(0, cu.index) + ' ' + rest.slice(cu.index + cu[0].length)).trim();
        }
      }
    }

    if (grams == null && fraction == null && count == null) continue;

    const itemRefText = stripStopwords(rest.replace(/[()"]/g, ' ').trim(), table) || null;
    out.push({
      grams,
      fraction,
      count,
      unitNoun,
      itemRefText,
      isQuestion,
      isPastReference,
      raw: clause.trim(),
    });
  }

  return out;
}
