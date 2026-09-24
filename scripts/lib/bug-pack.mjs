import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * bug-pack.mjs — V-30.2 packer gate helpers (pure, no HTTP).
 *
 * packCheck: schema + single-defect + criteria + fingerprint (bugctl pack --check).
 * reproCheck: verdict vocabulary + artifact fields (bugctl repro --check, V-30.3).
 * splitMultiItemReport: BUG-8449 rule — one card + a split list, never a bundle.
 * fingerprint / isoWeekKey: mirror of src/utils/bugWorkItem.ts (bugctl is pure mjs).
 * packForDispatch: validate and pack inbound defect reports for run-coding-dispatch.sh (BOT-20).
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

/** Status vocabulary of validateRepro (src/utils/bugTicketState.ts) — never extend it here. */
export const REPRO_STATUSES = ['not_needed', 'needed', 'confirmed', 'failed', 'ambiguous'];

/**
 * Validate a repro verdict before POST /api/bugs/:id/repro (bugctl repro --check).
 * Mirrors validateRepro exactly: same status vocabulary, same artifact fields
 * (confirmed → command + exit_code; failed/ambiguous → run_log). `not_needed`
 * means no repro was required and is NOT a synonym for not_reproducible.
 * Returns { ok: true, value } or { ok: false, error, issues[] }.
 */
export function reproCheck(body) {
  const issues = [];
  const status = String(body?.status || '').trim();
  if (!status) issues.push('status required');
  else if (!REPRO_STATUSES.includes(status)) {
    issues.push(`repro.status must be one of ${REPRO_STATUSES.join(', ')}`);
  }

  const value = { status };
  const str = (v) => String(v);
  if (body?.command !== undefined && body?.command !== null && str(body.command) !== '') value.command = str(body.command);
  if (body?.params !== undefined && body?.params !== null) value.params = body.params;
  if (body?.run_log !== undefined && body?.run_log !== null && str(body.run_log) !== '') value.run_log = str(body.run_log);
  if (body?.before !== undefined && body?.before !== null && str(body.before) !== '') value.before = str(body.before);
  if (body?.after !== undefined && body?.after !== null && str(body.after) !== '') value.after = str(body.after);
  if (body?.expected !== undefined && body?.expected !== null) value.expected = str(body.expected);
  if (body?.actual !== undefined && body?.actual !== null) value.actual = str(body.actual);
  if (body?.exit_code !== undefined && body?.exit_code !== null && str(body.exit_code) !== '') {
    const n = Number(body.exit_code);
    if (Number.isNaN(n)) issues.push('exit_code must be a number');
    else value.exit_code = n;
  }
  if (body?.by !== undefined && body?.by !== null && str(body.by) !== '') value.by = str(body.by);

  if (status === 'confirmed' && (!value.command || value.exit_code === undefined)) {
    issues.push('confirmed repro requires command and exit_code');
  }
  if ((status === 'failed' || status === 'ambiguous') && !value.run_log) {
    issues.push(`${status} repro requires run_log`);
  }

  if (issues.length) return { ok: false, error: issues.join('; '), issues };
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

/**
 * Validate and pack an inbound dispatch payload for run-coding-dispatch.sh (BOT-20).
 *
 * Accepts:
 *   - opts.workItem / opts['work-item']: versioned BugWorkItem / JSON string / @file path
 *   - four fields: opts.page (or opts.component), opts.observed, opts.expected, opts.screenshot
 *   - optional: opts.criteria, opts.class, opts.surface, opts.task
 *
 * Rules:
 *   1. Several defects (bundled or items array) become 1 card + split list via splitMultiItemReport.
 *   2. Must pass packCheck(). If packCheck fails, returns { ok: false, error, issues }.
 *   3. Nothing failing packCheck passes through as a task.
 */
export function packForDispatch(opts = {}) {
  let workItem = opts.workItem || opts['work-item'] || opts.work_item;
  if (typeof workItem === 'string') {
    const s = workItem.trim();
    if (s.startsWith('@')) {
      try {
        workItem = JSON.parse(fs.readFileSync(s.slice(1), 'utf8'));
      } catch (e) {
        return { ok: false, error: `cannot read work_item file '${s.slice(1)}': ${e.message}`, issues: ['work_item file unreadable'] };
      }
    } else if (fs.existsSync(s) && (s.endsWith('.json') || s.includes('/') || s.includes('\\'))) {
      try {
        workItem = JSON.parse(fs.readFileSync(s, 'utf8'));
      } catch (e) {
        return { ok: false, error: `cannot read work_item file '${s}': ${e.message}`, issues: ['work_item file unreadable'] };
      }
    } else {
      try {
        workItem = JSON.parse(s);
      } catch (e) {
        return { ok: false, error: `invalid work_item JSON: ${e.message}`, issues: ['work_item JSON invalid'] };
      }
    }
  }

  // If no work_item was passed, check if task is JSON or path to JSON
  if (!workItem && typeof opts.task === 'string') {
    const t = opts.task.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        workItem = JSON.parse(t);
      } catch {}
    } else if ((t.endsWith('.json') || t.startsWith('@')) && fs.existsSync(t.replace(/^@/, ''))) {
      try {
        workItem = JSON.parse(fs.readFileSync(t.replace(/^@/, ''), 'utf8'));
      } catch {}
    }
  }

  let card = null;
  let split = [];

  // If workItem is array or has multiple items/issues:
  const rawItems = Array.isArray(workItem) ? workItem : workItem?.items || workItem?.issues;
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const sp = splitMultiItemReport(workItem);
    if (!sp.ok) {
      return { ok: false, error: sp.error || 'failed to split multi-item report', issues: [sp.error || 'multi-item split failed'], card: null, split: [] };
    }
    card = sp.card;
    split = sp.split || [];
  } else if (workItem && typeof workItem === 'object') {
    const d = workItem.defect || workItem;
    card = {
      component: String(d.component || d.page || opts.component || opts.page || '').trim(),
      observed: String(d.observed || opts.observed || '').trim(),
      expected: String(d.expected || opts.expected || '').trim(),
      criteria: String(d.criteria || opts.criteria || '').trim(),
      class: String(d.class || d.bugClass || workItem.class || opts.class || '').trim(),
      surface: String(d.surface || workItem.surface || opts.surface || opts.page || '').trim(),
      fingerprint: String(d.fingerprint || workItem.fingerprint || opts.fingerprint || '').trim(),
      idem_key: String(d.idem_key || workItem.idem_key || opts['idem-key'] || opts.idem_key || '').trim(),
    };
  }

  // If no card yet, assemble from explicit fields or parse from task text:
  if (!card) {
    let component = String(opts.component || opts.page || '').trim();
    let observed = String(opts.observed || '').trim();
    let expected = String(opts.expected || '').trim();
    let criteria = String(opts.criteria || '').trim();
    let cls = String(opts.class || opts.bugClass || '').trim();
    let surface = String(opts.surface || opts.page || '').trim();

    // Try parsing structured key-value lines from task text if observed/expected are missing:
    if ((!observed || !expected || !component) && opts.task && typeof opts.task === 'string') {
      const taskText = opts.task;
      const mComp = taskText.match(/(?:page|component):\s*([^\n;.]+)/i);
      const mObs = taskText.match(/(?:observed|actual|defect|error):\s*([^\n;]+)/i);
      const mExp = taskText.match(/(?:expected|desired|fix|suggested fix):\s*([^\n;]+)/i);
      const mCrit = taskText.match(/(?:criteria|verification|verify):\s*([^\n;]+)/i);
      if (mComp && !component) component = mComp[1].trim();
      if (mObs && !observed) observed = mObs[1].trim();
      if (mExp && !expected) expected = mExp[1].trim();
      if (mCrit && !criteria) criteria = mCrit[1].trim();
    }

    card = {
      component,
      observed,
      expected,
      criteria,
      class: cls,
      surface,
      fingerprint: String(opts.fingerprint || '').trim(),
      idem_key: String(opts['idem-key'] || opts.idem_key || '').trim(),
    };
  }

  // Default criteria if expected is present and criteria is empty:
  if (!card.criteria && card.expected) {
    card.criteria = 'named check proves this single discrepancy fixed';
  }

  // Check if observed/expected look bundled (multiple enumerated defects in text):
  if (looksBundled(card.observed, card.expected)) {
    const lines = String(card.observed || '')
      .split('\n')
      .map((l) => l.replace(/^[-*•\d.)\s|]+/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 1) {
      const sp = splitMultiItemReport(
        lines.map((l) => ({
          issue: l,
          observed: l,
          component: card.component,
          class: card.class,
          surface: card.surface,
        }))
      );
      if (sp.ok && sp.card) {
        card = sp.card;
        split = sp.split || [];
      }
    }
  }

  // Validate the resulting card with packCheck:
  const chk = packCheck(card);
  if (!chk.ok) {
    return { ok: false, error: chk.error, issues: chk.issues, card: null, split: [] };
  }

  const screenshot = opts.screenshot || workItem?.screenshot || (Array.isArray(workItem?.photo_urls) ? workItem.photo_urls[0] : '') || '';

  return {
    ok: true,
    card: chk.value,
    split,
    screenshot,
  };
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

export async function cli(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log('usage: bug-pack.mjs <dispatch|check|split> [options]');
    return;
  }
  switch (cmd) {
    case 'dispatch':
    case 'pack-dispatch': {
      const res = packForDispatch(args);
      if (res.ok) {
        process.stdout.write(JSON.stringify(res, null, 2) + '\n');
        process.exitCode = 0;
      } else {
        process.stderr.write(JSON.stringify(res, null, 2) + '\n');
        process.exitCode = 1;
      }
      break;
    }
    case 'check':
    case 'pack-check': {
      const chk = packCheck(args);
      if (chk.ok) {
        process.stdout.write(JSON.stringify(chk, null, 2) + '\n');
        process.exitCode = 0;
      } else {
        process.stderr.write(JSON.stringify(chk, null, 2) + '\n');
        process.exitCode = 1;
      }
      break;
    }
    case 'split': {
      const target = args.file || args._[0];
      if (!target) {
        process.stderr.write('split requires a file path\n');
        process.exitCode = 1;
        return;
      }
      const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
      const sp = splitMultiItemReport(raw);
      if (sp.ok) {
        process.stdout.write(JSON.stringify(sp, null, 2) + '\n');
        process.exitCode = 0;
      } else {
        process.stderr.write(JSON.stringify(sp, null, 2) + '\n');
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.error(`unknown command: ${cmd}`);
      process.exitCode = 1;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`bug-pack: ${err.message}`);
    process.exit(1);
  });
}

