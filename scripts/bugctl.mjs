#!/usr/bin/env node
/**
 * bugctl — V-30.1 offline JSONL queue + thin HTTP client for the bug ticket store.
 *
 * State is ALWAYS derived server-side via bugState(). There is no `state --set`.
 * Every transition is (1) POSTed as an artifact and (2) appended to the git journal
 * at specs/bug-journal/<public_n>.jsonl (P1 A+D).
 *
 * Env:
 *   BUG_API_BASE   default http://127.0.0.1:3000
 *   BUG_API_TOKEN  sent as X-Bug-Api-Token (A-f5)
 *   BUGCTL_QUEUE   offline queue path (default .bugctl-queue.jsonl)
 *
 * Commands:
 *   create  --title T [--surface S] [--class C] [--assignee A] [--source S]
 *   pack    --id N --component C --observed O --expected E --criteria R [--class ...]
 *           --check          validate payload only (schema + single-defect + criteria + fingerprint); no HTTP
 *           --split <file>   multi-item report JSON → { ok, card, split[] } (one card + split list)
 *   repro   --id N --status S [--command CMD] [--exit-code N] [--run-log L]
 *           --check          validate verdict only (validateRepro vocabulary + artifacts); no HTTP
 *   plan    --id N --hyp H --files a.ts,b.ts --gates g1,g2
 *   attempt --id N --hyp H --file F --test T --result R [--line L] [--applied]
 *   verify  --id N --result green|red --command CMD [--evidence e1,e2]
 *   claim   --id N --assignee A
 *   duplicate --id N --of TAG
 *   unblock --id N [--reason R]
 *   evidence --id N --summary S [--job-id J]
 *   next | list [--state S] | show --id N | packet --id N [--format text] | state --id N | queue [--state S]
 *   curate --id N --expected-revision R --reason WHY [--title T] [--class C] [--surface S] [--component C --expected E --criteria R]
 *   handoff --id N --expected-revision R --reason WHY

 *   flush          replay the offline queue
 *   help
 *
 * --json is always available; human summary is printed when stdout is a TTY and --json is absent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packCheck, splitMultiItemReport, isVagueReport, fingerprint, reproCheck } from './lib/bug-pack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const BASE = (process.env.BUG_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.BUG_API_TOKEN || '';
const QUEUE_PATH = process.env.BUGCTL_QUEUE || path.join(REPO_ROOT, '.bugctl-queue.jsonl');
const JOURNAL_DIR = path.join(REPO_ROOT, 'specs', 'bug-journal');

function parseArgs(argv) {
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

function out(obj, args) {
  if (args.json || !process.stdout.isTTY) {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  } else {
    const lines = [];
    if (obj.error) lines.push(`ERROR: ${obj.error}`);
    else {
      if (obj.state) lines.push(`state=${obj.state}${obj.flags?.blocked_reason ? ` blocked=${obj.flags.blocked_reason}` : ''}${obj.flags?.needs_repro ? ' needs_repro' : ''}${obj.flags?.not_reproducible ? ' not_reproducible' : ''}${obj.flags?.duplicate_of ? ` duplicate_of=${obj.flags.duplicate_of}` : ''}`);
      if (obj.tag_id != null) lines.push(`card=${obj.public_n ? '#' + obj.public_n : obj.tag_id} (${obj.tag_id})`);
      if (obj.say) lines.push(obj.say);
      if (obj.message) lines.push(obj.message);
      for (const k of Object.keys(obj)) {
        if (['state', 'flags', 'tag_id', 'public_n', 'say', 'message', 'error', 'work_item', 'queue', 'packet', 'rows'].includes(k)) continue;
        if (obj[k] !== undefined && typeof obj[k] !== 'object') lines.push(`${k}=${obj[k]}`);
      }
      if (Array.isArray(obj.queue)) lines.push(`queue: ${obj.queue.length} card(s)`);
      if (Array.isArray(obj.rows)) lines.push(`rows: ${obj.rows.length}`);
      if (obj.count != null) lines.push(`count=${obj.count}`);
    }
    process.stdout.write(lines.join('\n') + '\n');
    if (args.json === false && obj.work_item) {
      /* human mode: keep compact */
    }
  }
}

function fail(msg, args, code = 1) {
  out({ error: msg }, args);
  process.exit(code);
}

async function api(method, pathname, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['X-Bug-Api-Token'] = TOKEN;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = res.ok && text ? text : { error: `HTTP ${res.status}` };
  }
  return { status: res.status, ok: res.ok, json };
}

function appendQueue(op) {
  const row = { ...op, queued_at: new Date().toISOString() };
  fs.appendFileSync(QUEUE_PATH, JSON.stringify(row) + '\n');
  return row;
}

function appendJournal(publicN, op) {
  if (!publicN) return;
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  const file = path.join(JOURNAL_DIR, `${publicN}.jsonl`);
  const row = { ...op, at: new Date().toISOString() };
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

// V-30.4 live proof: block/unblock (and other PATCH ops) return the legacy
// work_item shape without top-level public_n — deriving it from now.public_id
// keeps their journal rows from being silently dropped.
function journalPub(r) {
  if (r?.public_n != null) return r.public_n;
  const pid = r?.now?.public_id;
  if (pid != null && String(pid).startsWith('#')) return Number(String(pid).slice(1)) || undefined;
  return undefined;
}

// V-30.4: only WRITES queue when the API is unavailable. A queued read
// (packet/queue/next/list/show/state) can never be replayed by `flush` — it
// would keep `bugctl flush` red forever. Reads fail loud instead.
const WRITE_OPS = new Set([
  'create', 'pack', 'defect', 'repro', 'plan', 'attempt', 'verify', 'close',
  'claim', 'duplicate', 'unblock', 'block', 'evidence', 'curate', 'handoff',
]);

async function withFallback(op, args, fn) {
  const isWrite = WRITE_OPS.has(op?.op);
  try {
    const result = await fn();
    if (result.status === 401 || result.status === 503) {
      if (isWrite) appendQueue(op);
      return { ...result.json, ...(isWrite ? { queued: true, queue_path: QUEUE_PATH } : {}) };
    }
    return result.json;
  } catch (e) {
    if (isWrite) appendQueue(op);
    return { error: String(e?.message || e), ...(isWrite ? { queued: true, queue_path: QUEUE_PATH } : {}) };
  }
}

function resolveId(args) {
  const raw = String(args.id || args._[1] || '').replace(/^#/, '');
  if (!raw) return null;
  return raw;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!cmd || cmd === 'help' || cmd === '--help') {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const m = src.match(/\/\*\*([\s\S]*?)\*\//);
    process.stdout.write((m ? m[1] : 'bugctl help') + '\n');
    return;
  }

  switch (cmd) {
    case 'create': {
      const title = String(args.title || args._[1] || '').trim();
      if (!title) fail('--title required', args);
      const body = {
        title,
        surface: args.surface,
        class: args.class,
        assignee: args.assignee,
        source: args.source || 'human',
        idem_key: args['idem-key'] || args.idem_key,
        reply_to: args['reply-to'] ? JSON.parse(args['reply-to']) : undefined,
      };
      const r = await withFallback({ op: 'create', ...body }, args, () => api('POST', '/api/bugs', body));
      if (r.tag_id) appendJournal(r.public_n, { op: 'create', tag_id: r.tag_id, state: r.state, title });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'pack':
    case 'defect': {
      if (args.check) {
        const body = {
          component: args.component,
          observed: args.observed,
          expected: args.expected,
          criteria: args.criteria,
          class: args.class,
          surface: args.surface,
          fingerprint: args.fingerprint,
          idem_key: args['idem-key'] || args.idem_key,
        };
        const chk = packCheck(body);
        out(chk.ok ? { ok: true, check: 'pack', value: chk.value } : chk, args);
        if (!chk.ok) process.exit(1);
        break;
      }
      if (args.split) {
        let raw;
        try {
          raw = JSON.parse(fs.readFileSync(String(args.split), 'utf8'));
        } catch (e) {
          fail(`--split file unreadable: ${e.message}`, args);
        }
        const sp = splitMultiItemReport(raw);
        out(sp, args);
        if (!sp.ok) process.exit(1);
        break;
      }
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const body = {
        component: args.component,
        observed: args.observed,
        expected: args.expected,
        criteria: args.criteria,
        class: args.class,
        surface: args.surface,
        fingerprint: args.fingerprint,
        assignee: args.assignee,
        source: args.source,
        idem_key: args['idem-key'] || args.idem_key,
      };
      const chk = packCheck(body);
      if (!chk.ok) {
        out({ ...chk, hint: 'bugctl pack --check failed — fix payload before POST' }, args);
        process.exit(1);
      }
      const r = await withFallback({ op: 'pack', id, ...chk.value }, args, () =>
        api('POST', `/api/bugs/${encodeURIComponent(id)}/defect`, chk.value)
      );
      if (r.ok && r.state) appendJournal(r.public_n, { op: 'pack', tag_id: r.tag_id, state: r.state, flags: r.flags, defect: chk.value });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'repro': {
      const body = {
        status: args.status,
        command: args.command,
        exit_code: args['exit-code'] !== undefined ? Number(args['exit-code']) : undefined,
        run_log: args['run-log'] || args.run_log,
        before: args.before,
        after: args.after,
        expected: args.expected,
        actual: args.actual,
        by: args.by,
      };
      const chk = reproCheck(body);
      if (args.check) {
        out(chk.ok ? { ok: true, check: 'repro', value: chk.value } : chk, args);
        if (!chk.ok) process.exit(1);
        break;
      }
      if (!chk.ok) {
        out({ ...chk, hint: 'bugctl repro --check failed — fix verdict before POST' }, args);
        process.exit(1);
      }
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const r = await withFallback({ op: 'repro', id, ...chk.value }, args, () => api('POST', `/api/bugs/${encodeURIComponent(id)}/repro`, chk.value));
      if (r.ok && r.state) appendJournal(r.public_n, { op: 'repro', tag_id: r.tag_id, state: r.state, flags: r.flags, repro_status: chk.value.status });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'plan': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const body = {
        hypothesis: args.hyp || args.hypothesis,
        files: String(args.files || '').split(',').map((s) => s.trim()).filter(Boolean),
        gates: String(args.gates || '').split(',').map((s) => s.trim()).filter(Boolean),
        approach: args.approach,
        by: args.by,
      };
      const r = await withFallback({ op: 'plan', id, ...body }, args, () => api('POST', `/api/bugs/${encodeURIComponent(id)}/plan`, body));
      if (r.ok && r.state) appendJournal(r.public_n, { op: 'plan', tag_id: r.tag_id, state: r.state, flags: r.flags, plan: body });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'attempt': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const body = {
        hyp: args.hyp,
        file: args.file,
        test: args.test,
        result: args.result,
        line: args.line,
        note: args.note,
        actor: args.actor,
        burned: args.burned !== undefined ? args.burned !== 'false' && args.burned !== false : undefined,
        applied: args.applied === true || args.applied === 'true' ? true : undefined,
      };
      const r = await withFallback({ op: 'attempt', id, ...body }, args, () => api('POST', `/api/bugs/${encodeURIComponent(id)}/attempts`, body));
      if (r.ok && r.state) {
        const pub = journalPub(r);
        appendJournal(pub, { op: 'attempt', tag_id: r.tag_id || id, state: r.state, flags: r.flags, hyp: body.hyp, result: body.result });
      }
      out(r, args);
      if (r.error && !r.queued && r.status !== 409) process.exit(1);
      break;
    }

    case 'verify':
    case 'close': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const body = {
        method: args.method || 'named_test',
        command: args.command,
        result: args.result || (cmd === 'close' ? 'green' : undefined),
        evidence: String(args.evidence || '').split(',').map((s) => s.trim()).filter(Boolean),
        by: args.by,
      };
      const r = await withFallback({ op: 'verify', id, ...body }, args, () => api('POST', `/api/bugs/${encodeURIComponent(id)}/verify`, body));
      if (r.state) appendJournal(journalPub(r), { op: 'verify', tag_id: r.tag_id, state: r.state, flags: r.flags, result: body.result });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'claim': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      if (!args.assignee) fail('--assignee required', args);
      const r = await withFallback({ op: 'claim', id, assignee: args.assignee }, args, () =>
        api('PATCH', `/api/bugs/${encodeURIComponent(id)}`, { assignee: args.assignee })
      );
      if (r.state) appendJournal(journalPub(r), { op: 'claim', tag_id: r.tag_id, state: r.state, assignee: args.assignee });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'duplicate': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const of = String(args.of || args.duplicate_of || '').trim();
      if (!of) fail('--of <tag_id> required', args);
      const r = await withFallback({ op: 'duplicate', id, of }, args, () =>
        api('PATCH', `/api/bugs/${encodeURIComponent(id)}`, { duplicate_of: of })
      );
      if (r.state) appendJournal(journalPub(r), { op: 'duplicate', tag_id: r.tag_id, state: r.state, flags: r.flags, of });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'unblock': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const r = await withFallback({ op: 'unblock', id }, args, () =>
        api('PATCH', `/api/bugs/${encodeURIComponent(id)}`, {
          blocked_reason: null,
          reset_burns: args['reset-burns'] === true || args['reset-burns'] === 'true',
        })
      );
      if (r.state) appendJournal(journalPub(r), { op: 'unblock', tag_id: r.tag_id, state: r.state, flags: r.flags });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'block': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const reason = String(args.reason || 'blocked').trim();
      const r = await withFallback({ op: 'block', id, reason }, args, () =>
        api('PATCH', `/api/bugs/${encodeURIComponent(id)}`, { blocked_reason: reason, queue: 'blocked' })
      );
      if (r.state) appendJournal(journalPub(r), { op: 'block', tag_id: r.tag_id, state: r.state, flags: r.flags, reason });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'evidence': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const body = {
        summary: args.summary || 'evidence',
        job_id: args['job-id'] || args.job_id,
        debug_url: args['debug-url'],
        photo_urls: args['photo-urls'] ? String(args['photo-urls']).split(',').filter(Boolean) : [],
      };
      const r = await withFallback({ op: 'evidence', id, ...body }, args, () =>
        api('POST', `/api/bugs/${encodeURIComponent(id)}/attach`, body)
      );
      if (r.ok) appendJournal(r.public_n || r.now?.public_id, { op: 'evidence', tag_id: id, summary: body.summary });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'curate':
    case 'edit':
    case 'rewrite': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const body = {
        op: cmd === 'rewrite' ? 'rewrite' : cmd === 'edit' ? 'edit' : String(args.op || 'review'),
        expected_revision: Number(args['expected-revision'] ?? args.expected_revision),
        reason: args.reason,
        title: args.title,
        class: args.class,
        surface: args.surface,
        assignee: args.assignee,
        component: args.component,
        expected: args.expected,
        criteria: args.criteria,
      };
      const r = await withFallback({ op: 'curate', id, payload: body }, args, () => api('POST', `/api/bugs/${encodeURIComponent(id)}/curation`, body));
      if (r.receipt) appendJournal(journalPub(r), { op: body.op, tag_id: r.tag_id || id, state: r.state, receipt: r.receipt });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'handoff': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const body = {
        op: 'handoff',
        expected_revision: Number(args['expected-revision'] ?? args.expected_revision),
        reason: args.reason,
        assignee: 'orchestrator',
      };
      const r = await withFallback({ op: 'handoff', id, payload: body }, args, () => api('POST', `/api/bugs/${encodeURIComponent(id)}/curation`, body));
      if (r.receipt) appendJournal(journalPub(r), { op: 'handoff', tag_id: r.tag_id || id, state: r.state, receipt: r.receipt });
      out(r, args);
      if (r.error && !r.queued) process.exit(1);
      break;
    }

    case 'next': {
      const r = await withFallback({ op: 'next' }, args, () => api('GET', `/api/bugs/next?mode=${encodeURIComponent(args.mode || '')}${args.n ? `&n=${args.n}` : ''}`));
      out(r, args);
      break;
    }

    case 'list': {
      const qs = new URLSearchParams();
      if (args.state) qs.set('state', args.state);
      if (args.assignee) qs.set('assignee', args.assignee);
      if (args.surface) qs.set('surface', args.surface);
      const r = await withFallback({ op: 'list', ...Object.fromEntries(qs) }, args, () => api('GET', `/api/bugs/list?${qs}`));
      if (r.rows) {
        out({ source: r.source, count: r.count ?? r.rows.length, generated_at: r.generated_at, rows: r.rows }, args);
      } else out(r, args);
      break;
    }

    case 'queue': {
      const qs = new URLSearchParams();
      if (args.state) qs.set('state', args.state);
      if (args.assignee) qs.set('assignee', args.assignee);
      if (args.surface) qs.set('surface', args.surface);
      const r = await withFallback({ op: 'queue', ...Object.fromEntries(qs) }, args, () => api('GET', `/api/bugs/queue?${qs}`));
      out(r, args);
      break;
    }

    case 'show':
    case 'state': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const r = await withFallback({ op: cmd, id }, args, () => api('GET', `/api/bugs/${encodeURIComponent(id)}/${cmd === 'state' ? 'state' : ''}`.replace(/\/$/, '')));
      out(r, args);
      break;
    }

    case 'packet': {
      const id = resolveId(args);
      if (!id) fail('--id required', args);
      const fmt = args.format ? `?format=${encodeURIComponent(args.format)}` : '';
      // V-30.4: a packet READ is never queued — withFallback would leave an
      // unflushable op in the offline queue (flush counts it failed forever).
      // The dispatcher needs a live read; writes still queue via withFallback.
      const r = await api('GET', `/api/bugs/${encodeURIComponent(id)}/packet${fmt}`);
      const payload = r.json;
      if (args.format === 'text' && typeof payload === 'string') process.stdout.write(payload + '\n');
      else if (args.format === 'text' && payload && payload.packet) process.stdout.write(payload.packet + '\n');
      else out(payload, args);
      if (payload && payload.error && !r.ok) process.exit(1);
      break;
    }

    case 'flush': {
      if (!fs.existsSync(QUEUE_PATH)) {
        out({ message: 'queue empty', path: QUEUE_PATH }, args);
        break;
      }
      const lines = fs.readFileSync(QUEUE_PATH, 'utf8').split('\n').filter(Boolean);
      let sent = 0;
      let failed = 0;
      const remaining = [];
      for (const line of lines) {
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          failed++;
          continue;
        }
        const { op, queued_at, ...rest } = row;
        try {
          let res;
          if (op === 'create') res = await api('POST', '/api/bugs', rest);
          else if (op === 'pack' || op === 'defect') res = await api('POST', `/api/bugs/${encodeURIComponent(rest.id)}/defect`, rest);
          else if (op === 'repro') res = await api('POST', `/api/bugs/${encodeURIComponent(rest.id)}/repro`, rest);
          else if (op === 'plan') res = await api('POST', `/api/bugs/${encodeURIComponent(rest.id)}/plan`, rest);
          else if (op === 'attempt') res = await api('POST', `/api/bugs/${encodeURIComponent(rest.id)}/attempts`, rest);
          else if (op === 'verify' || op === 'close') res = await api('POST', `/api/bugs/${encodeURIComponent(rest.id)}/verify`, rest);
          else if (op === 'claim') res = await api('PATCH', `/api/bugs/${encodeURIComponent(rest.id)}`, { assignee: rest.assignee });
          else if (op === 'duplicate') res = await api('PATCH', `/api/bugs/${encodeURIComponent(rest.id)}`, { duplicate_of: rest.of });
          else if (op === 'unblock') res = await api('PATCH', `/api/bugs/${encodeURIComponent(rest.id)}`, { blocked_reason: null });
          else if (op === 'block') res = await api('PATCH', `/api/bugs/${encodeURIComponent(rest.id)}`, { blocked_reason: rest.reason, queue: 'blocked' });
           else if (op === 'evidence') res = await api('POST', `/api/bugs/${encodeURIComponent(rest.id)}/attach`, rest);
           else if (op === 'curate' || op === 'handoff') res = await api('POST', `/api/bugs/${encodeURIComponent(rest.id)}/curation`, rest.payload || rest);
          else {
            failed++;
            remaining.push(line);
            continue;
          }
          if (res.ok) sent++;
          else {
            failed++;
            remaining.push(line);
          }
        } catch {
          failed++;
          remaining.push(line);
        }
      }
      fs.writeFileSync(QUEUE_PATH, remaining.length ? remaining.join('\n') + '\n' : '');
      out({ message: 'flush done', sent, failed, remaining: remaining.length, path: QUEUE_PATH }, args);
      if (failed) process.exit(1);
      break;
    }

    default:
      fail(`unknown command: ${cmd} (try: bugctl help)`, args);
  }
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
