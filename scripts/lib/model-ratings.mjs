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
  const alias = RATING_ALIASES[id];
  if (!alias) return null;
  const { rows, found } = loadScorecard();
  if (!found || !rows.length) return null;
  const want = alias.replace(/[`*]/g, '').replace(/\(you\)/i, '').trim().toLowerCase();
  const hit = rows.find((r) => r.key === want)
    // The base model shares the variant's score ("Base Ling 3.0 Flash = 21").
    || rows.find((r) => want.startsWith(r.key) || r.key.startsWith(want));
  if (!hit) return null;
  return { score: hit.score, estimated: hit.estimated, name: hit.label };
}

/** `· AA 48` for a button, or '' when unscored. */
export function ratingSuffix(ref) {
  const r = ratingForModel(ref);
  if (!r) return '';
  return ` · AA${r.estimated ? '~' : ''}${r.score}`;
}

/** Every alias, resolved — used by the sensor to prove the table still matches. */
export function resolvedRatings() {
  const out = [];
  for (const [id, alias] of Object.entries(RATING_ALIASES)) {
    out.push({ id, alias, rating: ratingForModel(id) });
  }
  return out;
}
