// === VENDORED FROM scripts/lib/free-catalogs.mjs — DO NOT EDIT ===
// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.

/**
 * The free-model catalogs, read as the single source for what R-16 calls a
 * score and a tier.
 *
 * R-16 is explicit about both, and about where they may not come from:
 *
 *   - "Benchmark score shown on `/freemodel` comes from `FREE_MODEL_BAKEOFF.md`,
 *      not a new rating." (QS-7: "a model with no bakeoff entry shows
 *      'unranked', never an invented number")
 *   - "high (coding-agent-capable) vs light (docs/inventory) split follows
 *      `FREE_CODING_TOOLS_CATALOG.md` Ranked picks + Tools x free models and
 *      `FREE_MODEL_TOOL_PICKER.md` defaults ... no new tier file, no per-bot
 *      tier fork."
 *
 * So there is no ratings table in this repository. A number that is not in the
 * bakeoff ledger is not rendered; a tier that is not in the catalog is not
 * invented. Both facts carry the file and line they came from, because a score
 * with no pointer is exactly the thing the charter forbids.
 *
 * The catalogs are markdown that people edit, so the parsers are deliberately
 * small and total: an unreadable or absent catalog yields no score and no tier,
 * never a guess. `/freemodel` then shows "unranked" for that row, which is the
 * honest answer and is what QS-7 asks for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

export const CATALOG_FILES = {
  bakeoff: 'golden/scorecard/current/FREE_MODEL_BAKEOFF.md',
  catalog: 'golden/scorecard/current/FREE_CODING_TOOLS_CATALOG.md',
  picker: 'golden/scorecard/current/FREE_MODEL_TOOL_PICKER.md',
};

/** Where the catalogs may live, nearest first. The vendor copy runs from src/. */
const CANDIDATE_ROOTS = [REPO, path.resolve(HERE, '..', '..', '..')];

function readCatalog(which) {
  const rel = CATALOG_FILES[which];
  for (const root of CANDIDATE_ROOTS) {
    const p = path.join(root, rel);
    try {
      if (fs.existsSync(p)) return { text: fs.readFileSync(p, 'utf8'), file: p };
    } catch {
      /* try the next root */
    }
  }
  return { text: '', file: null };
}

/** `opencode/space-bunny-free`, `cline-free/muse-spark-1.3-contributor` → `space-bunny-free`. */
export function modelIdOf(ref) {
  let s = String(ref || '').trim().toLowerCase();
  if (!s) return '';
  // Prefixes are peeled repeatedly, because they stack: a Cloudflare lane is
  // "cloudflare/@cf/<namespace>/<model>", and the `@cf/` rule cannot see its own
  // segment until the provider prefix in front of it is gone. One pass left
  // "qwen3.8-27b" as "@cf/qwen/qwen3.8-27b", which matched no catalog row and
  // rendered as unlisted — a high model silently demoted by a parsing slip.
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/^@cf\/[a-z0-9_.-]+\//, '');
    s = s.replace(/^@[^/]+\//, ''); // any other "@provider/" shape
    s = s.replace(/^[a-z0-9_-]+[:/]/, ''); // provider prefix: opencode/, cline-free/, poolside/
    if (s === before) break;
  }
  s = s.replace(/:free$/, ''); // Token Harbor's ":free" is a routing suffix
  s = s.replace(/(^|[/])models?[/]/, '$1');
  return s;
}

/** Separators differ between the catalogs and the model ids: the catalog writes
 * "Laguna S 2.1 free" and "DeepSeek V4.1 Flash" where the ids are
 * `laguna-s-2.1` and `deepseek-v4.1-flash`. Comparing with every non-letter and
 * non-digit removed is what makes one catalog row and one live model the same
 * model, which is the whole point of reading tiers from the catalog. */
const loose = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** True when a ledger cell or catalog row is talking about this model. */
function mentions(cell, id) {
  const hay = String(cell || '').toLowerCase();
  if (!hay || !id) return false;
  if (hay.includes(id)) return true;
  // A ledger cell may name a sibling tier in parentheses, e.g.
  // "poolside/laguna-s-2.1:free (GLM free promo ended)" for laguna-s-2.1.
  const stem = id.replace(/-(free|contributor|preview|flash)$/, '');
  if (stem.length >= 6 && hay.includes(stem)) return true;
  const lh = loose(hay);
  const li = loose(id);
  if (li.length >= 6 && lh.includes(li)) return true;
  const ls = loose(stem);
  return ls.length >= 6 && lh.includes(ls);
}

/** Split a markdown table into trimmed cell rows, dropping the header. */
function tableRows(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    out.push(cells);
  }
  return out;
}

const RESULT_PASS = /\bPASS\b/;
const RESULT_PARTIAL = /\bPARTIAL\b|\bPARTIAL FAIL\b/;

/**
 * The bakeoff ledger's own verdict for a model, counted from its wave rows.
 *
 * Returns `{ ranked, label, pass, partial, fail, waves, last, source, line }`,
 * where `ranked` is false when the model has no row in the ledger — the caller's
 * cue to print "unranked" rather than a number.
 */
export function bakeoffVerdict(ref) {
  const id = modelIdOf(ref);
  const { text, file } = readCatalog('bakeoff');
  const none = { ranked: false, label: 'unranked', pass: 0, partial: 0, fail: 0, waves: 0, last: null, source: file || CATALOG_FILES.bakeoff, line: null };
  if (!id || !text) return none;
  let pass = 0;
  let partial = 0;
  let fail = 0;
  let last = null;
  let line = null;
  tableRows(text).forEach((cells, i) => {
    // | When (UTC) | Tool | Model | Thinking | Task | Result | ... |
    const [when, , modelCell, , , resultCell] = cells;
    if (!modelCell || !resultCell) return;
    if (/^model$/i.test(modelCell)) return;
    if (/^n\/a/i.test(modelCell)) return; // a Playwright soak row, not a model
    // Boundary-aware for the same reason the tier match is: the ledger's DeepSeek
    // rows are all V4.1, and a substring test would give the forbidden V4 a score
    // and a wave count it never ran.
    if (!matchScore(modelCell, id)) return;
    const text6 = `${resultCell}`;
    if (RESULT_PARTIAL.test(text6)) partial += 1;
    else if (RESULT_PASS.test(text6)) pass += 1;
    else fail += 1;
    if (!last || String(when) > String(last)) last = String(when).slice(0, 10);
    if (line === null) line = i + 1;
  });
  const waves = pass + partial + fail;
  if (!waves) return none;
  // The label is a count of the ledger's own verdicts. It is not a benchmark
  // number and it is not comparable across models that ran different waves.
  const bits = [];
  if (pass) bits.push(`${pass} pass`);
  if (partial) bits.push(`${partial} partial`);
  if (fail) bits.push(`${fail} fail`);
  return { ranked: true, label: `bakeoff ${bits.join(' · ')}`, pass, partial, fail, waves, last, source: file || CATALOG_FILES.bakeoff, line };
}

/**
 * Does `hay` name this model, with a clean boundary at the end?
 *
 * The boundary is the whole point. `deepseek-v4` is a *prefix* of
 * `deepseek-v4.1-flash` in loose form ("deepseekv4" inside "deepseekv41flash"),
 * and a plain substring test therefore reports the catalog's V4.1 row as a match
 * for V4 — handing a model the rank of a different model, and in this catalog
 * specifically walking straight past the standing "Any DeepSeek V4 — Forbidden"
 * lock. A match must end at a non-alphanumeric, or at the catalog's own
 * " free" suffix, which is how "Laguna S 2.1 free" is the same model as
 * `laguna-s-2.1`.
 */
function boundaryHit(hay, base, minLength = 6) {
  if (!base || base.length < minLength) return false;
  let at = hay.indexOf(base);
  while (at >= 0) {
    const after = hay.slice(at + base.length);
    if (!after) return true;
    if (!/[a-z0-9]/.test(after[0])) return true;
    if (after.startsWith('free')) return true; // the catalog's free-tier suffix
    at = hay.indexOf(base, at + 1);
  }
  return false;
}

/**
 * Score how specifically a cell names this model: 2 for the id itself, 1 for a
 * tier-stripped stem ("ling-3.0-flash-fin" for a `…-fin-free` id), 0 for a
 * longer model that merely starts with this id.
 */
function matchScore(cell, id) {
  const lh = loose(cell);
  if (!lh || !id) return 0;
  const li = loose(id);
  if (boundaryHit(lh, li)) return 2;
  const stem = String(id).replace(/-(free|contributor|preview|flash)$/, '');
  const ls = loose(stem);
  if (ls.length >= 6 && ls !== li && boundaryHit(lh, ls)) return 1;
  return 0;
}

/** Find a table by one of its header cells; returns { col, rows }. */
function tableByHeader(text, headerCell) {
  const rows = tableRows(text);
  const at = rows.findIndex((c) => c.some((cell) => String(cell).trim().toLowerCase() === headerCell.toLowerCase()));
  if (at < 0) return null;
  const header = rows[at].map((c) => String(c).trim().toLowerCase());
  const col = header.indexOf(headerCell.toLowerCase());
  return { col, rows: rows.slice(at + 1), header };
}

/**
 * The catalog's Ranked-picks row for a model, or null.
 *
 * One scan answers both questions R-16 asks of the catalog — what tier is this
 * model, and where does the catalog rank it — because they are the same row, and
 * two scans would be two chances to disagree about which row matched.
 */
function rankedPick(id, src) {
  const { text, file } = readCatalog('catalog');
  const where = file || src || CATALOG_FILES.catalog;
  if (!id || !text) return null;
  const table = tableByHeader(text, 'Tool + model');
  if (!table) return null;
  const cModel = table.header.indexOf('tool + model');
  const cWhy = table.header.indexOf('why this rank');
  const cStatus = table.header.indexOf('status');
  const cCap = table.header.indexOf('est. useful free usage');
  const cRank = table.header.indexOf('rank');
  const hits = [];
  for (const cells of table.rows) {
    const score = matchScore(cells[cModel], id);
    if (!score) continue;
    hits.push({
      score,
      cells,
      terminal: /\b(dead|forbidden|blocked|retired)\b/i.test(String(cells[cStatus] || '')),
      ended: /\b(promo )?ended\b/i.test(`${cells[cStatus] || ''} ${cells[cCap] || ''}`),
      freebuff: /freebuff/i.test(String(cells[cModel] || '')),
    });
  }
  if (!hits.length) return null;
  const best = Math.max(...hits.map((h) => h.score));
  const top = hits.filter((h) => h.score === best);
  // A retirement or a user lock is the catalog saying the opposite of high, and
  // it outranks a looser match that would hand this model another row's rank.
  // "Any DeepSeek V4 — Forbidden" must not inherit V4.1 Flash's tier or rank.
  const lock = top.find((h) => h.terminal);
  if (lock) return { tier: null, rank: null, retired: true, why: `catalog status: ${lock.cells[cStatus]}`, source: where };
  const ended = top.find((h) => h.ended);
  if (ended) return { tier: null, rank: null, retired: true, why: `catalog status: ${ended.cells[cStatus] || ended.cells[cCap]}`, source: where };
  // A model can be listed under two tools (DeepSeek V4.1 Flash is rank 1 on Cline
  // and rank 4 on Freebuff). The coding-capable tool wins; only when every best
  // match is Freebuff is the model terminal-only on this host.
  if (top.every((h) => h.freebuff)) {
    return { tier: null, rank: null, retired: false, terminalOnly: true, why: `Freebuff row (terminal-only on this host): ${top[0].cells[cModel]}`, source: where };
  }
  const win = top.find((h) => !h.freebuff) || top[0];
  const why = `${win.cells[cWhy] || ''} ${win.cells[cStatus] || ''}`.trim();
  // The catalog is explicit about the light tier: rank 6 Laguna S 2.1 is a
  // "fallback" that is "Proven light" and "weaker for restores". A row the
  // catalog calls a docs/inventory fallback is light; the top picks are high.
  const light = /proven light|fallback|docs\/?inventory|inventory\/?docs|weaker for restores|\blight\b/i.test(why);
  const rankCell = String(cRank >= 0 ? win.cells[cRank] ?? '' : '').replace(/[^0-9.]/g, '');
  const rank = rankCell ? Number(rankCell) : null;
  return { tier: light ? 'light' : 'high', rank, retired: false, why: why || null, source: where, fromRank: true };
}

/** Catalog tier for a model: 'high' | 'light' | null (unlisted). */
export function tierForModel(ref) {
  const src = CATALOG_FILES.catalog;
  const hit = rankedPick(modelIdOf(ref), src);
  // A lock outranks a tier: a retired or forbidden row is answered before the
  // per-model table is consulted, so `deepseek-v4` stays unlisted even though
  // `deepseek-v4.1-flash` is high and the two are one token apart.
  if (hit && (hit.retired || hit.terminalOnly)) return { tier: null, source: hit.source, line: null, why: hit.why };
  // "Tools x free models": | Tool | How to connect | Free models (usable) | ...
  const id = modelIdOf(ref);
  const { text, file } = readCatalog('catalog');
  const where = file || src;
  if (!id || !text) return { tier: null, source: where, line: null, why: null };

  // "Model tiers": the per-model table. Consulted before Tools x free models
  // because it is per-model rather than per-tool, which is the order the catalog's
  // own reading rules state.
  const tiers = tableByHeader(text, 'Tier');
  if (tiers) {
    const cModelT = tiers.header.indexOf('model');
    const cTier = tiers.header.indexOf('tier');
    const cBasis = tiers.header.indexOf('basis');
    const hits = [];
    for (const cells of tiers.rows) {
      // "Hy3" is the row for `hy3-free`: the catalog writes the model the way a
      // person says it and the ledger carries the provider's `-free` suffix, so a
      // stem pass runs when the full id does not match. A stem match is weaker than
      // an id match and is scored as such.
      let score = matchScore(cells[cModelT], id);
      if (!score) {
        // The catalog writes "Ring 2.6 1T" for `ring-2.6-1t-free` and "Hy3" for
        // `hy3-free`, so the stem pass drops the provider's `-free` and then a tier
        // word the cell leaves off.
        let stem = String(id).replace(/-(free|contributor|preview|rc|beta)$/, '');
        if (stem !== id && matchScore(cells[cModelT], stem) === 2) score = 1;
        if (!score) {
          const shorter = stem.replace(/-(flash|pro|omni|lite|ultra|super|tiny|fin|1t)$/i, '');
          if (shorter !== stem && shorter.length >= 4 && matchScore(cells[cModelT], shorter) === 2) score = 1;
        }
        // Short names are safe here in a way they are not in prose: the tier table
        // is one curated row per model, so "Hy3" matching `hy3-free` is the row
        // doing its job, where in a ledger cell it would be a coincidence.
        if (!score && stem.length >= 2 && stem.length < 6) {
          const looseCell = loose(cells[cModelT]);
          if (boundaryHit(looseCell, loose(stem), 2)) score = 1;
        }
      }
      if (score) hits.push({ score, cells });
    }
    if (hits.length) {
      const bestT2 = Math.max(...hits.map((h) => h.score));
      const win = hits.find((h) => h.score === bestT2);
      const raw = String(win.cells[cTier] || '').trim().toLowerCase();
      const tier = /\bhigh\b|\bcoding\b/.test(raw) ? 'high' : /\blight\b/.test(raw) ? 'light' : null;
      if (tier) return { tier, source: where, line: null, why: String(win.cells[cBasis] || '').trim() || `catalog tier: ${raw}` };
    }
  }

  const tools = tableByHeader(text, 'Free models (usable)');
  if (tools) {
    const cTool = tools.header.indexOf('tool');
    const cModels = tools.header.indexOf('free models (usable)');
    const cCap = tools.header.indexOf('cap / estimate');
    const cCaveat = tools.header.indexOf('data / caveats');
    const hits = [];
    for (const cells of tools.rows) {
      const score = matchScore(cells[cModels], id);
      if (score) hits.push({ score, cells });
    }
    const bestT = hits.length ? Math.max(...hits.map((h) => h.score)) : 0;
    for (const { cells } of hits.filter((h) => h.score === bestT)) {
      const tool = String(cells[cTool] || '');
      // Freebuff is terminal-only on this host. The same model under a
      // coding-capable tool is not, so a non-Freebuff row decides when there is one.
      if (/freebuff/i.test(tool)) {
        const onlyFreebuff = hits.filter((h) => h.score === bestT).every((h) => /freebuff/i.test(String(h.cells[cTool] || '')));
        if (onlyFreebuff) return { tier: null, source: where, line: null, why: `terminal-only tool row: ${tool}` };
        continue;
      }
      const why = `${cells[cCap] || ''} ${cells[cCaveat] || ''}`.trim();
      const light = /fallback|\blight\b|inventory|docs/i.test(why);
      return { tier: light ? 'light' : 'high', source: where, line: null, why: why || `${tool} row` };
    }
  }
  // The ranked pick is the catalog's own opinion, used when neither the per-model
  // tier table nor Tools x free models had anything to say about this model.
  if (hit && hit.fromRank) return { tier: hit.tier, source: hit.source, line: null, why: hit.why };
  return { tier: null, source: where, line: null, why: null };
}

/**
 * The external published benchmark figures for a model, read from the catalog's
 * Benchmarks table. Never a tier basis — the Model tiers table decides that — and
 * never a number the table does not carry: a model with no published figure comes
 * back as `{ published: false }` so the caller prints nothing rather than a
 * neighbour's score.
 */
export function benchmarkFor(ref) {
  const id = modelIdOf(ref);
  const { text, file } = readCatalog('catalog');
  const none = { published: false, aa: null, other: null, source: file || CATALOG_FILES.catalog, checked: null };
  if (!id || !text) return none;
  const table = tableByHeader(text, 'AA Index v4.3');
  if (!table) return none;
  const cModel = table.header.indexOf('model');
  const cAa = table.header.indexOf('aa index v4.3');
  const cOther = table.header.indexOf('other published figures');
  const cSource = table.header.indexOf('source');
  const cChecked = table.header.indexOf('checked');
  // The last row is a catch-all listing every model with no figure; matching it is
  // how those models are answered honestly instead of falling through.
  const hits = [];
  for (const cells of table.rows) {
    const cell = String(cells[cModel] || '');
    if (!cell) continue;
    const names = cell.split(/·|,/).map((x) => x.trim()).filter(Boolean);
    for (const n of names) {
      // Same ladder the tier table uses: the catalog writes the family
      // ("MiMo V2.6 Flash") where the ledger carries the provider's suffixes
      // (`mimo-v2.6`, `mimo-v2.6-flash-free`), and a curated table can be trusted
      // with a looser match than prose.
      let score = matchScore(n, id);
      if (!score) {
        const stems = [
          String(id).replace(/-(free|contributor|preview|rc|beta)$/, ''),
          String(id).replace(/-(free|contributor|preview|rc|beta)$/, '').replace(/-(flash|pro|omni|lite|ultra|super|tiny|fin)$/i, ''),
        ];
        for (const st of stems) {
          if (!st || st === id) continue;
          const m = matchScore(n, st);
          if (m) { score = 1; break; }
        }
      }
      if (!score) {
        // The other direction: the catalog carries a tier word the ledger id omits,
        // so "MiMo V2.6" is the row written "MiMo V2.6 Flash". Only a known tier word
        // may follow, or this would match any longer model name.
        const lh = loose(n);
        const li = loose(id);
        if (li.length >= 5 && lh.startsWith(li) && /^(flash|pro|omni|lite|ultra|super|tiny|fin|preview|max|high|instruct)/.test(lh.slice(li.length))) {
          score = 1;
        }
      }
      if (score) hits.push({ score, cells, cell });
    }
  }
  if (!hits.length) return none;
  const best = Math.max(...hits.map((h) => h.score));
  const win = hits.find((h) => h.score === best);
  const rawAa = String(win.cells[cAa] || '').trim();
  const source = String(win.cells[cSource] || '').trim();
  const checked = String(win.cells[cChecked] || '').trim();
  const none2 = /no published figure|none found|no figure/i.test(rawAa);
  if (none2) return { published: false, aa: null, other: String(win.cells[cOther] || '').trim() || null, source, checked, via: win.cell };
  // "~41 (est.)" -> 41 with estimated: true; "25 (AA's own estimate)" -> 25 estimated too.
  const num = rawAa.match(/\d+(?:\.\d+)?/);
  return {
    published: true,
    aa: num ? Number(num[0]) : null,
    estimated: /~/.test(rawAa) || /estimate/i.test(rawAa),
    other: String(win.cells[cOther] || '').trim() || null,
    source,
    checked,
    via: win.cell,
  };
}

/** The short label a button or row carries: `AA39.5`, `AA~41`, or nothing. */
export function benchmarkLabel(ref) {
  const b = benchmarkFor(ref);
  if (!b.published || typeof b.aa !== 'number') return '';
  return `AA${b.estimated ? '~' : ''}${b.aa}`;
}

/**
 * The catalog's rank for a model (1 is the top pick), or null when the catalog
 * does not rank it. This is the only ordering signal the repository has that is
 * about model quality, and it is the one R-16 points at.
 */
export function catalogRank(ref) {
  const hit = rankedPick(modelIdOf(ref), CATALOG_FILES.catalog);
  if (!hit || hit.retired || hit.terminalOnly) return { rank: null, source: hit ? hit.source : null, why: hit ? hit.why : null };
  return { rank: Number.isFinite(hit.rank) ? hit.rank : null, source: hit.source, why: hit.why };
}

/**
 * A "bigger is better" score for the supersession rule, taken from the catalog
 * rank. Rank 1 becomes the highest number, so a newer model only supersedes an
 * older one when the catalog ranks it at least as high — the version rule can no
 * longer promote a newer model the catalog has not heard of over one it ranks.
 */
export function catalogScore(ref) {
  const { rank } = catalogRank(ref);
  return Number.isFinite(rank) ? -rank : null;
}

/**
 * Tier for the walk: high first, then unlisted, then light. Light models stay
 * reachable (QS-10 wants tier-internal order, not a hard cut) but never take a
 * turn over while a high lane is free.
 */
export function walkTierRank(ref) {
  const { tier } = tierForModel(ref);
  return tier === 'high' ? 0 : tier === 'light' ? 2 : 1;
}

/** The label `/freemodel` puts on a button: a ledger label, or "unranked". */
export function scoreLabelFor(ref) {
  return bakeoffVerdict(ref).label;
}

/** Everything one row needs, with provenance, for a caller that renders it. */
export function catalogFacts(ref) {
  const b = bakeoffVerdict(ref);
  const t = tierForModel(ref);
  const bench = benchmarkFor(ref);
  return {
    id: modelIdOf(ref),
    score: b.label,
    ranked: b.ranked,
    waves: b.waves,
    last: b.last,
    tier: t.tier,
    tierWhy: t.why,
    source: b.source,
    tierSource: t.source,
    benchmark: bench.published ? bench.aa : null,
    benchmarkLabel: benchmarkLabel(ref),
    benchmarkEstimated: Boolean(bench.estimated),
    benchmarkSource: bench.source,
    benchmarkChecked: bench.checked,
  };
}
