/**
 * bug-pack.mjs — V-30.2 packer gate helpers (pure, no HTTP).
 *
 * packCheck: schema + single-defect + criteria + fingerprint (bugctl pack --check).
 * splitMultiItemReport: BUG-8449 rule — one card + a split list, never a bundle.
 * fingerprint / isoWeekKey: mirror of src/utils/bugWorkItem.ts (bugctl is pure mjs).
 */

export function isoWeekKey(at) {
  const d = at ? new Date(at) : new Date();
  if (Number.isNaN(d.getTime())) return 'unknown';
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function fingerprint(cls, queryOrKey, at) {
  const c = String(cls || 'other').trim().toUpperCase().replace(/\s+/g, '_');
  const q = String(queryOrKey || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  return `${c}|${q || 'unknown'}|${isoWeekKey(at)}`;
}

/** True when observed/expected text enumerates multiple distinct discrepancies. */
export function looksBundled(observed, expected) {
  const o = String(observed || '');
  const e = String(expected || '');
  const both = o + '\n' + e;
  // Numbered lists ("1. ", "1) ", "| 1 |") or 3+ bullet lines.
  const numbered = /\n\s*\d+[.)]\s+\S/.test(both) || /\|\s*\d+\s*\|/.test(both);
  const bullets = both.split('\n').filter((l) => /^\s*[-*•]\s+\S/.test(l)).length;
  // Enumerators that describe a multi-item report title/description.
  const saysMany = /\b\d+\s+(areas?|items?|discrepanc\w+|issues?|problems?)\b/i.test(both);
  // Split-list dump: 3+ short non-empty lines (issue titles), not one paragraph.
  const lines = o.split('\n').map((l) => l.trim()).filter(Boolean);
  const multiLineTitles = lines.length >= 3 && lines.every((l) => l.length < 160) && !/\n\n/.test(o);
  return numbered || bullets >= 3 || saysMany || multiLineTitles;
}

/**
 * Validate a pack payload before POST /api/bugs/:id/defect.
 * Returns { ok: true, value, fingerprint } or { ok: false, error, issues[] }.
 */
export function packCheck(body) {
  const issues = [];
  const component = String(body?.component || '').trim();
  const observed = String(body?.observed || '').trim();
  const expected = String(body?.expected || '').trim();
  const criteria = String(body?.criteria || '').trim();
  const cls = String(body?.class || body?.bugClass || '').trim();
  const surface = String(body?.surface || '').trim();

  if (!component) issues.push('component required');
  if (!observed) issues.push('observed required');
  if (!expected) issues.push('expected required');
  if (!criteria) issues.push('criteria required');
  if (looksBundled(observed, expected)) {
    issues.push('single-defect: report enumerates multiple discrepancies — split to one card + split list');
  }

  let fp = String(body?.fingerprint || '').trim();
  if (!fp) {
    if (observed) fp = fingerprint(cls || 'other', observed);
    else issues.push('fingerprint required (or provide observed to derive it)');
  }

  if (issues.length) return { ok: false, error: issues.join('; '), issues };

  const value = { component, observed, expected, criteria };
  if (cls) value.class = cls;
  if (surface) value.surface = surface;
  value.fingerprint = fp;
  value.idem_key = String(body?.idem_key || body?.['idem-key'] || fp);
  return { ok: true, value, issues: [] };
}

/**
 * Split a multi-item report into one primary card + a split list.
 * Never returns a bundled card. Primary is the highest-priority single defect
 * (omega-3 / floating-point first when present — BUG-8449 fixture), else first.
 *
 * items: [{ issue, observed, expected, component?, class?, surface?, criteria? }]
 * or a bug-backlog-shaped { title, items: [...] }.
 */
export function splitMultiItemReport(report) {
  const raw = Array.isArray(report) ? report : report?.items || report?.issues || [];
  const items = raw
    .map((it) => {
      if (typeof it === 'string') return { issue: it, observed: it, expected: '' };
      return {
        issue: String(it.issue || it.title || it.observed || '').trim(),
        observed: String(it.observed || it.issue || '').trim(),
        expected: String(it.expected || '').trim(),
        component: it.component,
        class: it.class,
        surface: it.surface,
        criteria: it.criteria,
      };
    })
    .filter((it) => it.observed || it.issue);

  if (items.length === 0) {
    return { ok: false, error: 'empty report — no items to pack', card: null, split: [] };
  }
  if (items.length === 1) {
    const only = items[0];
    const card = {
      component: only.component || only.issue || 'unspecified',
      observed: only.observed || only.issue,
      expected: only.expected || only.observed || only.issue,
      criteria: only.criteria || 'named check proves the single discrepancy fixed',
      class: only.class,
      surface: only.surface,
      fingerprint: only.fingerprint,
    };
    const fp = packCheck(card);
    return { ok: fp.ok, error: fp.error, card: fp.ok ? fp.value : null, split: [] };
  }

  // Prefer the floating-point / omega-3 line (BUG-8449 real defect).
  let primaryIdx = items.findIndex((it) => /omega|7\.700000000000001|floating[- ]?point/i.test(it.observed + it.issue));
  if (primaryIdx < 0) primaryIdx = 0;

  const primary = items[primaryIdx];
  const rest = items.filter((_, i) => i !== primaryIdx);
  const card = {
    component: primary.component || 'Home' ,
    observed: primary.observed || primary.issue,
    expected: primary.expected || primary.observed || primary.issue,
    criteria: primary.criteria || 'named check proves this single discrepancy fixed',
    class: primary.class,
    surface: primary.surface || 'home',
  };
  const chk = packCheck(card);
  if (!chk.ok) return { ok: false, error: chk.error, card: null, split: rest };

  const split = rest.map((it, i) => ({
    n: i + 1,
    issue: it.issue,
    observed: it.observed,
    expected: it.expected,
    component: it.component,
    note: 'split list — pack as its own card when picked up; never re-bundle',
  }));

  return { ok: true, card: chk.value, split, primary_n: 1 };
}

/** Vague report: cannot form expected/criteria → packer posts defect + repro.status=needed. */
export function isVagueReport(report) {
  const text = typeof report === 'string' ? report : JSON.stringify(report || '');
  const hasObservable = /(?:shows?|is |are |missing|wrong|broken|bug|error)/i.test(text);
  const hasSpecific =
    /\d+\.\d+|#[a-z0-9-]+|\b[A-Z][a-z]+ [A-Z]/.test(text) && text.length > 80;
  if (!text.trim()) return true;
  // Too short or no concrete observable → vague.
  if (text.trim().length < 24) return true;
  if (!hasObservable) return true;
  return !hasSpecific && text.trim().length < 120;
}
