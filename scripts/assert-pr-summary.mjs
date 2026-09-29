#!/usr/bin/env node
// PR body contract: every PR must carry a summary blurb, progress status,
// what's left, and an author trailer (location shape). Read from PR_BODY.
// Bodies are written now, so the legacy no-location trailer shape is NOT
// accepted here (commits keep their own grandfathering in
// scripts/check-agent-identity.sh).
const body = String(process.env.PR_BODY || '');
const fail = (m) => { console.error(`assert-pr-summary: ${m}`); process.exit(1); };
const ok = (m) => console.log(`assert-pr-summary: ${m}`);

const TRAILER = /^(?:Agent|Author): [^ ].+ \([^()]+\) [A-Za-z0-9][A-Za-z0-9._-]*$/m;
if (!TRAILER.test(body)) {
  fail('missing author trailer. Append one line:\n  Author: <model and version> (<thinking level>) <location>\n  e.g. Author: Grok 4.7 (High) VM');
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
ok('body contract satisfied');
