#!/usr/bin/env node
/**
 * assert-allowance-watch-deployed — the watcher the box RUNS must be the watcher
 * this repo ships.
 *
 * Why this exists. On 2026-10-07 the operator asked why Cline's Muse row was
 * missing, and the answer was that `ht-allowance-watch` had re-stamped that lane
 * depleted 27 times in a day — every ~46 minutes — on evidence that had lapsed on
 * 2026-09-26, eleven days before the last renewal. The probe could not run: the
 * unit's `Environment=PATH` had no `~/.npm-global/bin`, where the Cline CLI lives.
 *
 * That defect was undiagnosable from the repo for a structural reason, and this
 * file is the sensor for the reason rather than for the symptom:
 *
 *   * the unit existed ONLY at /etc/systemd/system/ht-allowance-watch.service —
 *     no copy in the repo — so its PATH could not be read, diffed, reviewed or
 *     reproduced by anyone working in a checkout;
 *   * its ExecStart named /home/ubuntu/bot-host-r14, a tree nothing deploys, so
 *     the watcher's own code was a hand-copy that the next hand-copy (or the
 *     next fast-forward of that tree) could silently replace with the pre-fix
 *     file — which is exactly how the fix made on the box the same day could
 *     have vanished again without a single red check.
 *
 * `systemd/ht-allowance-watch.service` now carries the unit and
 * `allowance-watch-core.cjs#resolveCliBin` removes the PATH dependency. Both are
 * only true of the box once the unit is installed there, and installing it needs
 * root — a step no checkout can run and no CI can see. So "is it fixed?" has a
 * mechanical answer here instead of "the operator says it looks fine": this
 * compares what the box is actually running, byte for byte, with what the repo
 * commits, and exits non-zero the moment they diverge.
 *
 * Read-only: it probes and judges, and never writes to the box.
 *
 * Exit 0 — judged, and the box runs this repo's watcher with no lane held.
 * Exit 1 — judged, and it does not. The reasons and the two install lines print.
 * Exit 3 — not judged (no route to the box). Never a silent pass: an
 *          unjudgeable run says so and cannot be mistaken for a clean one.
 *
 * Run: node tools/telegram-provider-router/scripts/assert-allowance-watch-deployed.mjs
 *      node ... --host user@addr   # judge another box
 *      node ... --self-test        # offline: the judging logic, no route needed
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const UNIT = 'ht-allowance-watch';
const DEPLOY_CLONE = '/home/ubuntu/deploy/Health-tracker';
/** Trees that serve bots but are never reset to main — a fix copied here is temporary by construction. */
const NEVER_DEPLOYED = ['/home/ubuntu/bot-host-r14'];
const DEFAULT_HOST = process.env.HT_DEPLOY_HOST || 'ubuntu@51.254.217.163';
/** The lane whose ❌ was the operator-visible symptom. */
const HELD_LANE = /muse-spark-1\.3-contributor/i;
const UNCERTAIN_HOLD = /not installed|uncertain/i;

export const REPO_FILES = {
  unit: join(ROOT, 'systemd', `${UNIT}.service`),
  wrapper: join(ROOT, 'tools', 'telegram-provider-router', 'bin', UNIT),
  core: join(ROOT, 'tools', 'telegram-provider-router', 'src', 'allowance-watch-core.cjs'),
};

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function repoFacts(files = REPO_FILES) {
  return {
    unit: readFileSync(files.unit, 'utf8'),
    wrapper: sha256(readFileSync(files.wrapper)),
    core: sha256(readFileSync(files.core)),
  };
}

/** One probe, one ssh: sections are delimited by a `##name` line and carry raw output. */
const PROBE = `
u=${UNIT}
f=$(systemctl show $u -p FragmentPath --value 2>/dev/null)
printf '\\n##unitpath\\n'
echo "$f"
printf '\\n##unit\\n'
if [ -n "$f" ]; then cat "$f" 2>&1; fi
printf '\\n##exec\\n'
systemctl show $u -p ExecStart --value 2>/dev/null
printf '\\n##mainpid\\n'
systemctl show $u -p MainPID --value 2>/dev/null
w=$(systemctl show $u -p ExecStart --value 2>/dev/null | sed -e 's/.*argv\\[\\]=//' -e 's/ ;.*//' | awk '{print $2}')
printf '\\n##wrapperpath\\n'
echo "$w"
printf '\\n##wrapper\\n'
if [ -n "$w" ]; then sha256sum "$w" 2>&1; fi
printf '\\n##core\\n'
if [ -n "$w" ]; then sha256sum "$(dirname "$w")/../src/allowance-watch-core.cjs" 2>&1; fi
printf '\\n##deployhead\\n'
git -C ${DEPLOY_CLONE} rev-parse HEAD 2>&1
printf '\\n##sharedir\\n'
s=$(grep -o 'FREE_LANES_SHARED_DIR=[^ ]*' "$f" 2>/dev/null | tail -1 | cut -d= -f2)
echo "$s"
printf '\\n##session\\n'
if [ -n "$s" ]; then cat "$s/session.json" 2>&1; fi
printf '\\n##journal\\n'
journalctl -u $u -n 300 --no-pager 2>/dev/null | grep -E 'sweep:' | tail -3
`;

/**
 * Split one probe dump into its sections.
 *
 * The marker is matched wherever it appears, not only at the start of a line.
 * That is not defensive padding: the first cut of this probe emitted `##journal`
 * straight after `session.json`, which has no trailing newline, so the marker
 * landed as `}##journal` and the journal section parsed as EMPTY — the sweep
 * check then reported "no sweep line in the journal tail" while three sweep
 * lines sat in the raw dump. A parser that can silently drop a section turns a
 * check into a no-op, and a no-op check is worse than a missing one because it
 * reports PASS. The probe now prints markers with a leading newline as well.
 */
export function parseSections(raw) {
  const out = {};
  const parts = String(raw || '').split(/##([a-z]+)[ \t]*\n?/i);
  for (let i = 1; i < parts.length; i += 2) {
    out[parts[i].toLowerCase()] = String(parts[i + 1] ?? '').replace(/\s+$/, '');
  }
  return out;
}

/** Trailing whitespace and blank lines are not a difference between two copies of one file. */
function normalize(text) {
  return String(text || '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
}

/**
 * What actually differs between the installed unit and the committed one.
 *
 * Comparing whole files reports "line 1 differs" and teaches nothing: the repo
 * copy opens with a forty-line rationale header the hand-written box unit never
 * had. The directives are the part systemd reads, so compare those first and name
 * the one that differs; only when they agree is the difference the header itself.
 */
function describeUnitDiff(installed, repo) {
  const directives = (text) =>
    normalize(text)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  const a = directives(installed);
  const b = directives(repo);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `the ${i + 1}th directive differs — box: ${JSON.stringify(a[i] ?? null)} · repo: ${JSON.stringify(b[i] ?? null)}`;
    }
  }
  return `same ${b.length} directives; the two files differ only in the rationale header the repo copy carries`;
}

const firstSha = (text) => (String(text || '').match(/\b([0-9a-f]{64})\b/) || [])[1] || '';

/**
 * Judge an already-collected dump. Pure — every input is a string, so the whole
 * decision is testable offline (`--self-test`) on a machine with no route.
 */
export function judge(sections, facts, { now = Date.now() } = {}) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

  const evidence = {
    unitPath: sections.unitpath || '',
    exec: sections.exec || '',
    wrapperPath: sections.wrapperpath || '',
    deployHead: sections.deployhead || '',
    sharedDir: sections.sharedir || '',
    mainPid: sections.mainpid || '',
    lastSweeps: (sections.journal || '').split('\n').filter(Boolean),
  };

  const hasUnit = Boolean((sections.unit || '').trim());
  add(
    'the box has the unit installed',
    hasUnit,
    hasUnit ? '' : 'systemd reports no unit file — the watcher the box runs is not one the repo owns',
  );

  const same = hasUnit && normalize(sections.unit) === normalize(facts.unit);
  add(
    'the installed unit is identical to systemd/ht-allowance-watch.service',
    same,
    same ? '' : hasUnit ? describeUnitDiff(sections.unit, facts.unit) : 'nothing to compare — no unit file on the box',
  );

  const wp = evidence.wrapperPath;
  const inDeploy = wp.startsWith(`${DEPLOY_CLONE}/`);
  const undeployed = NEVER_DEPLOYED.find((t) => wp.startsWith(`${t}/`));
  add(
    'ExecStart runs the deploy clone, not an undeployed tree',
    inDeploy,
    inDeploy
      ? ''
      : undeployed
        ? `${wp} lives in ${undeployed}, which no deploy resets to main — the watcher's code there is a hand-copy, and the next one silently undoes this fix`
        : `ExecStart names ${JSON.stringify(wp)}, which is not under ${DEPLOY_CLONE}`,
  );

  const gotWrapper = firstSha(sections.wrapper);
  add(
    "the running wrapper is this repo's wrapper",
    Boolean(gotWrapper) && gotWrapper === facts.wrapper,
    gotWrapper === facts.wrapper ? '' : `running ${gotWrapper || (sections.wrapper || '(unreadable)')} · repo ${facts.wrapper}`,
  );

  const gotCore = firstSha(sections.core);
  add(
    "the running core is this repo's core",
    Boolean(gotCore) && gotCore === facts.core,
    gotCore === facts.core ? '' : `running ${gotCore || (sections.core || '(unreadable)')} · repo ${facts.core}`,
  );

  let hold = null;
  let sessionNote = 'no session file was read';
  try {
    const parsed = JSON.parse(sections.session || '{}');
    const quota = parsed && typeof parsed.quota === 'object' && parsed.quota ? parsed.quota : {};
    const keys = Object.keys(quota).filter((k) => HELD_LANE.test(k));
    sessionNote = keys.length
      ? `records on the Cline Muse lane: ${keys.join(', ')}`
      : 'no quota record for the Cline Muse lane';
    for (const key of keys) {
      const rec = quota[key] || {};
      const until = Number(rec.depletedUntil || 0);
      const uncertain = UNCERTAIN_HOLD.test(String(rec.lastError || '')) || /unknown/i.test(String(rec.kind || ''));
      if (until > now && uncertain) {
        hold = { key, until, kind: rec.kind, lastError: rec.lastError };
        break;
      }
    }
  } catch (err) {
    sessionNote = `session unreadable: ${err.message}`;
  }
  add(
    'no Cline Muse lane is held by an uncertain stamp',
    !hold,
    hold
      ? `${hold.key} held until ${new Date(hold.until).toISOString()} kind=${JSON.stringify(hold.kind)} lastError=${JSON.stringify(hold.lastError)} — this is the self-renewing ❌`
      : sessionNote,
  );

  const sweeps = evidence.lastSweeps;
  const last = sweeps[sweeps.length - 1] || '';
  const m = last.match(/sweep: (\d+) due \/ (\d+) depleted \/ (\d+) lanes — probed (\d+), flips (\d+), re-stamps (\d+), uncertain (\d+)/);
  add(
    'the last sweep re-stamps nothing',
    Boolean(m) && m[6] === '0' && m[7] === '0',
    m
      ? m[6] === '0' && m[7] === '0'
        ? ''
        : `last sweep re-stamped ${m[6]} lane(s) and reported ${m[7]} uncertain — ${last}`
      : last
        ? `no sweep line recognised in the journal tail — ${last}`
        : 'no sweep line in the journal tail',
  );

  return { judged: true, checks, evidence };
}

function probe(host) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    host,
    PROBE,
  ];
  try {
    const raw = execFileSync('ssh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000 });
    return { reachable: true, raw };
  } catch (err) {
    return { reachable: false, raw: `${err.stdout || ''}${err.stderr || ''}`, error: err.message };
  }
}

const REMEDIATION = [
  'Fix — on the box, as its administrator (this is the one step no checkout can run):',
  '  install -m 644 systemd/ht-allowance-watch.service /etc/systemd/system/',
  '  systemctl daemon-reload && systemctl restart ht-allowance-watch',
  '',
  'Run it AFTER the merge has deployed. ExecStart runs the deploy clone, so installing',
  'the unit while that clone still holds the pre-fix wrapper runs the pre-fix wrapper —',
  'which is the bug this unit exists to fix. Re-run this check to confirm the install.',
];

function report({ host, judged, checks, evidence, reason = '' }) {
  console.log(`assert-allowance-watch-deployed: ${host}`);
  console.log(judged ? `judged against ${evidence.unitPath || '(no unit)'}` : `NOT JUDGED — ${reason}`);
  if (judged) {
    console.log(`  unit        ${evidence.unitPath || '(none)'}`);
    console.log(`  ExecStart   ${evidence.wrapperPath || '(none)'}`);
    console.log(`  deploy head ${evidence.deployHead || '(unknown)'}`);
    console.log(`  shared dir  ${evidence.sharedDir || '(not in the unit)'}`);
    console.log(`  MainPID     ${evidence.mainPid || '(none)'}`);
    for (const line of evidence.lastSweeps) console.log(`  sweep       ${line.replace(/^.*node\[\d+\]: /, '')}`);
  }
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${!c.ok && c.detail ? `\n        ${c.detail}` : ''}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  if (failed) {
    console.log('');
    for (const line of REMEDIATION) console.log(line);
    console.log('');
    console.log(`assert-allowance-watch-deployed: ${checks.length - failed} pass, ${failed} FAIL — the box does not run what the repo ships`);
  } else if (judged) {
    console.log(`assert-allowance-watch-deployed: ${checks.length} pass, 0 fail — the box runs this repo's watcher`);
  } else {
    console.log(`assert-allowance-watch-deployed: 0 pass, 0 fail — nothing was judged`);
  }
  return failed ? 1 : 0;
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? '' : argv[i + 1] || '';
}

/** The judging logic on fixtures, so a box is not needed to prove the checks can fail. */
export function selfTest(now = Date.now()) {
  const facts = repoFacts();
  const sweepOk = 'Oct 07 20:33:30 vps node[234831]: [2026-10-07T20:33:30.659Z] sweep: 0 due / 0 depleted / 17 lanes — probed 0, flips 0, re-stamps 0, uncertain 0';
  const sweepBad = 'Oct 07 19:26:06 vps node[222538]: [2026-10-07T19:26:06.107Z] sweep: 1 due / 1 depleted / 17 lanes — probed 0, flips 0, re-stamps 1, uncertain 1';
  const installed = {
    unitpath: `/etc/systemd/system/${UNIT}.service`,
    unit: facts.unit,
    exec: `{ path=/usr/bin/node ; argv[]=/usr/bin/node ${DEPLOY_CLONE}/tools/telegram-provider-router/bin/${UNIT} --daemon ; ignore_errors=no ; }`,
    mainpid: '234831',
    wrapperpath: `${DEPLOY_CLONE}/tools/telegram-provider-router/bin/${UNIT}`,
    wrapper: `${facts.wrapper}  ${DEPLOY_CLONE}/tools/telegram-provider-router/bin/${UNIT}`,
    core: `${facts.core}  ${DEPLOY_CLONE}/tools/telegram-provider-router/src/allowance-watch-core.cjs`,
    deployhead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    sharedir: '/home/ubuntu/.local/state/shared-free-lanes',
    session: '{\n  "quota": {}\n}',
    journal: sweepOk,
  };
  const failedNames = (r) => r.checks.filter((c) => !c.ok).map((c) => c.name).join(' | ');

  const cases = [
    {
      name: 'an installed box, running this repo, passes every check',
      sections: installed,
      want: (r) => r.judged && r.checks.length === 7 && r.checks.every((c) => c.ok),
      expect: 'all 7 checks pass',
    },
    {
      name: 'the 2026-10-07 failure — a watcher run from the never-deployed tree',
      sections: { ...installed, wrapperpath: '/home/ubuntu/bot-host-r14/tools/telegram-provider-router/bin/ht-allowance-watch', wrapper: `${'a'.repeat(64)}  /home/ubuntu/bot-host-r14/...` },
      want: (r) => /deploy clone, not an undeployed tree/.test(failedNames(r)) && /is this repo's wrapper/.test(failedNames(r)),
      expect: 'the undeployed-tree check and the wrapper-hash check fail',
    },
    {
      name: 'the pre-fix unit — a PATH with no Cline bin, so the probe cannot answer',
      sections: { ...installed, unit: facts.unit.replace('PATH=/home/ubuntu/.npm-global/bin:', 'PATH=') },
      want: (r) => /installed unit is identical/.test(failedNames(r)),
      expect: 'the unit-identity check fails',
    },
    {
      name: 'an uncertain hold re-stamped at the default TTL',
      sections: {
        ...installed,
        journal: sweepBad,
        session: JSON.stringify({
          quota: {
            'cline/cline-free/muse-spark-1.3-contributor': {
              kind: 'limit-unknown',
              depletedUntil: now + 45 * 60 * 1000,
              lastError: 'probe uncertain: cline: not installed',
            },
          },
        }, null, 2),
      },
      want: (r) => /held by an uncertain stamp/.test(failedNames(r)) && /last sweep re-stamps nothing/.test(failedNames(r)),
      expect: 'the lane-hold check and the sweep check fail',
    },
    {
      name: 'a genuine vendor 429 is not a deployment failure',
      sections: {
        ...installed,
        session: JSON.stringify({
          quota: {
            'cline/cline-free/muse-spark-1.3-contributor': {
              kind: 'allowance-empty',
              depletedUntil: now + 45 * 60 * 1000,
              countdownHint: 'Try again in 23h 15m',
            },
          },
        }, null, 2),
      },
      want: (r) => r.checks.every((c) => c.ok),
      expect: 'every check still passes — a measured limit is not a stamp this checker judges',
    },
    {
      name: 'a wrapper that is not this repo\'s fails on the hash alone',
      sections: { ...installed, wrapper: `${'b'.repeat(64)}  ${DEPLOY_CLONE}/tools/telegram-provider-router/bin/${UNIT}` },
      want: (r) => /is this repo's wrapper/.test(failedNames(r)) && !/is this repo's core/.test(failedNames(r)),
      expect: 'only the wrapper hash fails',
    },
  ];

  // The parser is judged too: a marker a section's own content swallowed made the
  // sweep check report no sweep line while the dump held three of them.
  const glued = `##session\n{\n  "quota": {}\n}##journal\nOct 07 sweep: 0 due / 0 depleted`;
  const parserCases = [
    {
      name: 'a marker glued to a section that has no trailing newline is still a section',
      want: () => parseSections(glued).journal === 'Oct 07 sweep: 0 due / 0 depleted',
      expect: 'journal is parsed out of the glued `}##journal` line',
    },
    {
      name: 'a marker does not swallow the section that follows it',
      want: () => parseSections('##a\none\n##b\ntwo\n').a === 'one' && parseSections('##a\none\n##b\ntwo\n').b === 'two',
      expect: 'two clean sections',
    },
  ];

  let passed = 0;
  let failed = 0;
  console.log('assert-allowance-watch-deployed --self-test:');
  for (const c of cases) {
    const r = judge(c.sections, facts, { now });
    const ok = c.want(r);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (ok) passed += 1;
    else {
      failed += 1;
      console.error(`        expected ${c.expect}; failed checks: ${failedNames(r) || '(none)'}`);
    }
  }
  for (const c of parserCases) {
    const ok = c.want();
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (ok) passed += 1;
    else {
      failed += 1;
      console.error(`        expected ${c.expect}`);
    }
  }
  console.log(`assert-allowance-watch-deployed: ${passed} pass, ${failed} fail`);
  return failed ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  const host = argValue(argv, '--host') || DEFAULT_HOST;
  const p = probe(host);
  if (!p.reachable) {
    return report({ host, judged: false, checks: [], evidence: {}, reason: `no route — ${String(p.error || '').split('\n')[0]}` });
  }
  const sections = parseSections(p.raw);
  const { checks, evidence } = judge(sections, repoFacts());
  return report({ host, judged: true, checks, evidence });
}

if (process.argv[1] && process.argv[1].endsWith('assert-allowance-watch-deployed.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
