// === VENDORED FROM scripts/lib/model-ratings.mjs — DO NOT EDIT ===
// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.

/**
 * Benchmark ratings for the free models, read from the repo's canonical scorecard.
 *
 * qa-evidence/model-comparison.json is marked "SOURCE OF TRUTH" and scores on
 * Artificial Analysis Intelligence Index v4.3 — a composite that includes
 * Terminal-Bench 4.0 and AutomationBench-AA, so it measures agentic coding rather
 * than chat. It is also curated: it covers roughly half the free models this host
 * can actually reach, and says nothing about the rest.
 *
 * Hence the explicit alias table below instead of pattern matching. A fuzzy match
 * was tried first and it was wrong in both directions — it missed nine real pairs
 * (ling-3.0-flash, minimax-m3, laguna-s-2.1, longcat-2.0, nemotron-3-super …) and
 * was one rename away from putting a neighbouring model's score on a button. Every
 * alias is asserted to exist in the scorecard, so a rename upstream fails a test
 * rather than silently mislabeling a lane.
 *
 * A model with no alias gets no rating. Showing nothing is honest; showing a
 * neighbour's number is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Our model id (last path segment) → the exact row label in the scorecard. */
export const RATING_ALIASES = {
  // OpenCode / Zen free models
  'muse-spark-1.3-contributor-free': 'Muse Spark 1.3 Free',
  'muse-spark-1.2-contributor-free': 'Muse Spark 1.2 Free',
  'mimo-v2.6-flash-free': 'MiMo-V2.6-Flash Free',
  'big-pickle': 'Big Pickle (you)',
  'minimax-m3-free': '`minimax/minimax-m3:free`',
  'nemotron-3-ultra-free': 'Nemotron 3 Ultra Free',
  'nemotron-3-super-free': '`nvidia/nemotron-3-super-120b-a12b:free`',
  'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning Free',
  'ling-3.0-flash-free': 'Ling 3.0 Flash Fin Free', // base Ling 3.0 Flash = same 21
  'ling-3.0-flash-fin-free': 'Ling 3.0 Flash Fin Free',
  'laguna-s-2.1-free': '`poolside/laguna-s-2.1:free`',
  'longcat-2.0-free': '`meituan/longcat-2.0:free`',
  // Cline free models (the scorecard's paid rows are the same models)
  'solar-pro4': '`upstage/solar-pro4:free`',
  'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'glm-5.3-flash': 'GLM-5.3-Flash',
  // Token Harbor / Cloudflare / Gemini
  'qwen3.8-flash:free': 'Qwen3.8 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
};

/**
 * Public benchmark results for models the scorecard does not cover.
 *
 * These are a DIFFERENT scale and are kept in their own fields on purpose:
 * `swe` is SWE-bench Verified % resolved and `tb` is Terminal-Bench, while `aa` is
 * the scorecard's Artificial Analysis Intelligence Index. Printing 78.8 under an
 * "AA" label would be a category error — the two are not comparable, and the
 * button shows which is which.
 *
 * Grouped by what the evidence says, and `why` is kept so a later reader can see
 * the basis rather than having to trust the label. "unscored" is not evidence of
 * weakness: space-bunny has no published score but is the one model the fleet is
 * told to fall back to, and it answers on this box.
 */
export const BENCHMARKS = {
  'glm-5-free': { swe: 77.8, tb: 56.2, group: 'coding', why: 'Z.ai GLM-5: SWE-bench Verified 77.8 (best open-weights), Terminal-Bench 2.0 56.2, AA Index 50' },
  'glm-4.7-free': { swe: 73.8, group: 'coding', why: 'Z.ai GLM-5 comparison table: SWE-bench Verified 73.8' },
  'kimi-k2.5-free': { swe: 76.8, group: 'coding', why: 'Z.ai comparison table: SWE-bench Verified 76.8; K2.6 sibling scores 80.2' },
  'qwen3.6-plus-free': { swe: 78.8, tb: 61.6, group: 'coding', why: 'Alibaba: SWE-bench Verified 78.8, Terminal-Bench 2.0 61.6, LiveCodeBench v6 87.1' },
  'deepseek-v4-flash-free': { group: 'coding', why: 'same family as DeepSeek V4.1 Flash (AA 39.5); cache says "enhanced agentic capabilities". Weak on long autonomous loops' },
  'mimo-v2.5-free': { group: 'coding', why: 'cache: "omni model for text, image, video, audio, and agents"; MiMo 2.6 sibling scores AA 41' },
  'mimo-v2-pro-free': { group: 'coding', why: 'MiMo Pro tier, 1M context; Flash sibling AA 41, Pro measured 46.3' },
  'mimo-v2-flash-free': { group: 'coding', why: 'MiMo Flash tier, same family as the AA 41 sibling' },
  'mimo-v2-omni-free': { group: 'coding', why: 'MiMo omni tier, same family as the AA 41 sibling' },
  'north-mini-code-free': { group: 'coding', why: 'cache: "Cohere coding model for practical software engineering and agentic edits"' },
  'hy3-free': { group: 'coding', why: 'cache: "Tencent Hy reasoning model for coding, instruction following, and agent tasks"' },
  'hy3-preview-free': { group: 'coding', why: 'same Hy family as hy3-free; no description of its own' },
  'minimax-m2.1-free': { group: 'coding', why: 'MiniMax M2 family is positioned for agentic coding; no published score found' },
  'minimax-m2.5-free': { group: 'coding', why: 'MiniMax M2 family is positioned for agentic coding; no published score found' },
  'space-bunny-free': { group: 'coding', why: 'UNSCORED but operationally verified: plan/ROADMAP + BOT_ROLES make it the fleet fallback on "insufficient funds", and it answers on this box. Cache: "reasoning model for coding, agentic tasks, tool use", 1M ctx' },
  'ox-alpha-free': { group: 'coding', why: 'cache: "Stealth reasoning model for coding, agentic tasks, and tool use", 1M ctx. No published score' },
  'x-preview-f-free': { group: 'coding', why: 'cache: "Stealth reasoning model for coding, agentic tasks, and tool use", 1M ctx. No published score' },
  'ring-2.6-1t-free': { group: 'coding', why: '1T-parameter open-weights tier; no published score and no description' },
  'grok-code': { group: 'coding', why: 'coding by name. NOT named -free, so it has no place in a free list' },
  'kat-coder-pro': { group: 'coding', why: 'Cline free coding model by name; no published score' },
  'deepseek-v4': { group: 'coding', why: 'Token Harbor row for the same DeepSeek V4 family (V4.1 Flash = AA 39.5)' },
  'qwen3.8-27b': { group: 'coding', why: 'Cloudflare-hosted Qwen 3.8 at 27B; Qwen3.8 Flash scores AA 39.9 and 27B is the larger tier' },
  'glm-4.7-flash': { group: 'coding', why: 'Cloudflare-hosted GLM 4.7; SWE-bench Verified 73.8 for the family' },
  'ling-2.6-flash-free': { group: 'light', why: 'Ling family: AA 21 for 3.0 Flash, described as low-latency assistance and extraction' },
  'ling-3.0-flash-free': { group: 'light', why: 'AA 21 — "Efficient model for low-latency assistance, extraction, and routine automation"' },
  'ling-3.0-tiny-free': { group: 'light', why: 'Ling family, "Compact MoE … responsive agents, instruction following"; below 3.0 Flash' },
  'trinity-large-preview-free': { group: 'light', why: '131K context, the smallest in the list, and no description; "Large" notwithstanding' },
  'gemini-3.7-flash': { group: 'light', why: 'between Gemini 3.5 Flash Lite (AA 22) and 3.8 Flash (AA 41.2); no score of its own' },
  'big-pickle': { group: 'light', why: 'AA ~30 (the scorecard calls it its least certain cell), text-only, and the handover records that only --variant low replies' },
};

/**
 * Estimates, and only where a MEASURED relative exists.
 *
 * An estimate from a measured parent or sibling is an inference with a stated
 * basis, and it is rendered with a `~` so it can never be read as a measurement.
 * An estimate from nothing — a model with no published score, no measured relative
 * and no description — is not an estimate, it is a guess, so those stay blank.
 * `basis` names the relative for every one of these, and a sensor checks it.
 */
export const AA_ESTIMATES = {
  'deepseek-v4-flash-free': { aaEst: 38, basis: 'previous generation of DeepSeek V4.1 Flash (AA 39.5 measured)' },
  'glm-4.7-free': { aaEst: 42, basis: 'GLM-5 is AA 50 published and the vendor claims ~20% improvement over 4.7' },
  'mimo-v2-pro-free': { aaEst: 46, basis: 'the scorecard records the MiMo Pro sibling as 46.3, a measured figure' },
  'mimo-v2.5-free': { aaEst: 39, basis: 'one version older than MiMo 2.6 Flash, whose AA 41 is itself an ESTIMATE in the scorecard — the weakest inference here' },
  'minimax-m2.5-free': { aaEst: 26, basis: 'previous generation of MiniMax M3 (AA 30 measured)' },
  'minimax-m2.1-free': { aaEst: 25, basis: 'two generations before MiniMax M3 (AA 30 measured)' },
  'ling-3.0-tiny-free': { aaEst: 16, basis: 'the tiny sibling of Ling 3.0 Flash (AA 21 measured)' },
  'ling-2.6-flash-free': { aaEst: 18, basis: 'previous generation of Ling 3.0 Flash (AA 21 measured)' },
  'gemini-3.7-flash': { aaEst: 30, basis: 'interpolated between two measured rows: Gemini 3.5 Flash Lite (AA 22) and Gemini 3.8 Flash (AA 41.2)' },
};

let cache = null;

function loadScorecard() {
  if (cache) return cache;
  let dir = HERE;
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'qa-evidence', 'model-comparison.json');
    if (fs.existsSync(p)) {
      try {
        const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
        const rows = [];
        for (const key of ['free', 'ranking']) {
          for (const row of doc?.[key]?.rows || []) {
            const rawLabel = String(row[0] ?? '');
            const label = rawLabel.replace(/[`*]/g, '').replace(/\(you\)/i, '').trim();
            const scoreCell = String(row[key === 'free' ? 2 : 1] ?? '');
            const m = scoreCell.match(/~?(\d{2,3}(?:\.\d)?)/);
            if (!m) continue;
            rows.push({ label, key: label.toLowerCase(), score: Number(m[1]), estimated: scoreCell.includes('est') || scoreCell.startsWith('~') });
          }
        }
        cache = { rows, found: true };
        return cache;
      } catch {
        break;
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  cache = { rows: [], found: false };
  return cache;
}

/** Strip our ref down to the model id the alias table is keyed on. */
function modelIdOf(ref) {
  return String(ref || '').trim().split('/').filter(Boolean).pop() || '';
}

/**
 * The rating for a model ref, or null when the scorecard has no score for it.
 * Never guesses: an unaliased model returns null.
 */
export function ratingForModel(ref) {
  const id = modelIdOf(ref);
  if (!id) return null;
  const extra = BENCHMARKS[id] || null;
  const est = AA_ESTIMATES[id] || null;
  const alias = RATING_ALIASES[id];
  if (!alias) return (extra || est) ? { aa: null, ...(extra || {}), ...(est ? { aaEst: est.aaEst, estimateBasis: est.basis } : {}) } : null;
  const { rows, found } = loadScorecard();
  if (!found || !rows.length) return (extra || est) ? { aa: null, ...(extra || {}), ...(est ? { aaEst: est.aaEst, estimateBasis: est.basis } : {}) } : null;
  const want = alias.replace(/[`*]/g, '').replace(/\(you\)/i, '').trim().toLowerCase();
  const hit = rows.find((r) => r.key === want)
    // The base model shares the variant's score ("Base Ling 3.0 Flash = 21").
    || rows.find((r) => want.startsWith(r.key) || r.key.startsWith(want));
  if (!hit) return (extra || est) ? { aa: null, ...(extra || {}), ...(est ? { aaEst: est.aaEst, estimateBasis: est.basis } : {}) } : null;
  return { aa: hit.score, estimated: hit.estimated, name: hit.label, ...(extra || {}), ...(est ? { aaEst: est.aaEst, estimateBasis: est.basis } : {}) };
}

/**
 * Which group a model belongs to: coding or light.
 *
 * The rule is the scorecard's own where it has a number — AA >= 35 is coding, below
 * is light — and the recorded evidence everywhere else. "unknown" is a real answer
 * and is deliberately not collapsed into either side.
 */
export function groupForModel(ref) {
  const id = modelIdOf(ref);
  if (!id) return 'unknown';
  const r = ratingForModel(id);
  const curated = BENCHMARKS[id]?.group;
  if (curated) return curated;
  if (typeof r?.aa === 'number') return r.aa >= 35 ? 'coding' : 'light';
  return 'unknown';
}

/**
 * ` · AA48` / ` · SWE78.8` for a button, or '' when there is nothing to show.
 * The two scales are labelled separately and never merged into one number.
 */
export function ratingSuffix(ref) {
  const r = ratingForModel(ref);
  if (!r) return '';
  const bits = [];
  if (typeof r.aa === 'number') bits.push(`AA${r.estimated ? '~' : ''}${r.aa}`);
  else if (typeof r.aaEst === 'number') bits.push(`AA~${r.aaEst}`);
  if (typeof r.swe === 'number') bits.push(`SWE${r.swe}`);
  return bits.length ? ` · ${bits.join(' ')}` : '';
}

/** Every alias, resolved — used by the sensor to prove the table still matches. */
export function resolvedRatings() {
  const out = [];
  for (const [id, alias] of Object.entries(RATING_ALIASES)) {
    out.push({ id, alias, rating: ratingForModel(id) });
  }
  return out;
}
