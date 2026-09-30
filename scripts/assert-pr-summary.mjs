#!/usr/bin/env node
// PR body contract: every PR must carry a summary blurb, progress status,
// what's left, and an author trailer (location shape). Read from PR_BODY.
// Bodies are written now, so the legacy no-location trailer shape is NOT
// accepted here (commits keep their own grandfathering in
// scripts/check-agent-identity.sh).
const body = String(process.env.PR_BODY || '');
const fail = (m) => { console.error(`assert-pr-summary: ${m}`); process.exit(1); };
const ok = (m) => console.log(`assert-pr-summary: ${m}`);

// Kept in step with `author_pattern` in scripts/check-agent-identity.sh, which
// judges the same body on the same run. Two copies of one rule WILL drift —
// this one was still accepting `Agent:` and an `n/a` thinking level after the
// rename was enforced there. A comment naming the other copy is cheaper than a
// sensor, and the strict check still runs, so drift here fails safe: it can
// only let something through that the other script then rejects.
const TRAILER = /^Author: [^ ].+ \([A-Za-z][A-Za-z0-9._-]*\) [A-Za-z0-9][A-Za-z0-9._-]*$/m;
if (!TRAILER.test(body)) {
  fail([
    'missing author trailer. Append one line:',
    '  Author: <model and version> (<thinking level>) <location>',
    '  e.g. Author: Grok 4.7 (High) VM',
    'The prefix is Author:, not the legacy Agent:. The thinking level must be a',
    "word: (none) for a model with no levels, n/a is not accepted.",
  ].join('\n'));
}
ok('author trailer present');

const heads = ['summary', 'status', 'left'];
const lines = body.split('\n');
const sections = {};
let cur = null;
for (const ln of lines) {
  const h = ln.match(/^##\s*(.+?)\s*$/);
  if (h) {
    cur = h[1].trim().toLowerCase();
    if (!(cur in sections)) sections[cur] = [];
    continue;
  }
  if (cur) sections[cur].push(ln);
}
let missing = 0;
for (const name of heads) {
  const text = (sections[name] || []).join('\n').trim();
  // Ignore managed commit-list bullets and marker comments when judging
  // whether the author wrote anything.
  const meat = text
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('<!--') && !/^(?:Agent|Author): /.test(l.trim()))
    .join('\n')
    .trim();
  if (!meat) {
    console.error(`assert-pr-summary: empty or missing '## ${name[0].toUpperCase()}${name.slice(1)}' section.`);
    missing++;
  } else {
    ok(`'## ${name}' present (${meat.length} chars)`);
  }
}
if (missing) {
  fail('add non-empty ## Summary, ## Status and ## Left sections to the PR body.');
}
// The handover pointer: `git log` is what the next agent reads, and free
// prose does not tell them WHERE to continue. One machine-readable line in
// ## Left names the continuation — a trail section, a roadmap row, a branch,
// or a follow-up PR. Presence only; the prose around it stays free.
// Same-line anchor: `\s*` would reach across a blank line into the trailer,
// accepting a bare `Next:` the skeleton leaves unfilled (proven by sensor).
const leftText = (sections.left || []).join('\n');
if (!/^Next:[ \t]*\S+/m.test(leftText)) {
  fail('## Left must name the continuation with one line: "Next: <trail-file#section | plan/ROADMAP.md#row | agent/<branch> | #<pr>>" (e.g. "Next: TUI_TG_AUTH_TRAIL.md#current-blocker").');
}
ok('## Left names the continuation (Next:)');
ok('body contract satisfied');
