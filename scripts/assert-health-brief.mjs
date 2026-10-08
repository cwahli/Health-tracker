/**
 * Gate: the seat context must find the brief, and only ever the right one.
 *
 * The health workspace is a *data* workspace — `result/` and `sources/`, nothing
 * else — and the brief is committed with the pack in the repo. Roles already
 * resolve that way (the registry prefers the repo copy of `roles/` and treats a
 * workspace copy as a drift-checked mirror). The brief did not, so on this box
 * `buildHealthContext` answered `ok:false` for the project's own workspace:
 *
 *   no brief or charter in /home/ubuntu/projects/external-health-coach
 *     (looked for BRIEF.md, brief.md, charter.md, CHARTER.md)
 *
 * `ok:false` stops the turn before the model is ever called, so `/health
 * analyze`, `/health doctor` and every seat in the room refused on a workspace
 * that had simply never been given a copy. The brief was one directory away the
 * whole time, at `projects/external-health/charter.md`.
 *
 * Two rules, and the second is the one that keeps this from becoming a new way
 * to be wrong:
 *
 *   1. A project's own workspace falls back to that project's pack.
 *   2. Any *other* directory still refuses. A seat must never borrow a mandate
 *      from a pack it was not pointed at — that is the failure this reader
 *      exists to prevent, and a blanket fallback would cause it silently.
 *
 * The probes execute the real resolver against fixtures. Nothing here reads the
 * source to decide whether the source is right: a rule that can be satisfied by
 * editing a comment is not a rule.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BRIEF_FILES, buildHealthContext } from './lib/health/context.mjs';

/** A scratch tree that cleans itself up, so a run leaves nothing behind. */
function scratch(name, build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `assert-health-brief-${name}-`));
  build(root);
  return root;
}

const write = (abs, text) => {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return abs;
};

/**
 * One rule, several fixtures.
 *
 * `registered` is the project's workspace and `pack` its template dir — those
 * two stay fixed for the whole audit, because "the project's own workspace" is
 * the thing being tested. `target` is whichever directory we ask about, and the
 * interesting cases are the ones where target is *not* `registered`.
 */
function probe({ label, target, registered, templateDir }) {
  const registry = { 'external-health': { workspace: registered, templateDir } };
  const ctx = buildHealthContext(target, { registry, now: new Date('2026-10-02T00:00:00Z') });
  const brief = ctx.sections.find((s) => s.key === 'brief');
  return { label, ok: ctx.ok, refuses: ctx.refuses, brief, ctx };
}

export function audit() {
  const failures = [];
  const fail = (kind, detail) => failures.push({ kind, detail });

  // --- 1. the motivating case: the project's own workspace, no local brief ---
  const pack = scratch('pack', (root) => {
    write(path.join(root, 'charter.md'), '# Pack charter\n\nThe mandate a seat must see.\n');
    write(path.join(root, 'roles', 'doctor.md'), '# doctor\n');
  });
  const ownWs = scratch('own-ws', (root) => {
    write(path.join(root, 'result', 'health-verify.json'), '{"summary":"s"}');
    write(path.join(root, 'sources', 'lab.json'), '{}');
  });

  const own = probe({ label: "the project's own workspace falls back to the pack", target: ownWs, registered: ownWs, templateDir: pack });
  if (!own.ok) fail('own-workspace-refuses', `a data workspace with no local brief still refused: ${own.refuses.join('; ')}`);
  if (!own.brief) fail('no-brief-section', 'the fallback produced no brief section');
  if (own.brief && !/pack in the repo/.test(own.brief.label)) fail('provenance', `the brief must say it came from the pack, got label=${own.brief.label}`);
  if (own.brief && !own.brief.text.includes('mandate a seat must see')) fail('wrong-text', `the pack charter was not the text delivered: ${JSON.stringify(own.brief.text.slice(0, 80))}`);
  if (own.brief && path.resolve(own.brief.path) !== path.resolve(path.join(pack, 'charter.md'))) fail('wrong-file', `the fallback reported the wrong file: ${own.brief.path}`);
  // The refusal message must not be the thing that saved this run: the whole
  // point is that the seat is handed the mandate rather than nothing.
  if (own.ctx.bytes <= 0) fail('empty-block', 'the rendered pack came back empty');

  // --- 2. the rule that keeps it honest: a stranger still refuses ------------
  const strangerWs = scratch('stranger', (root) => {
    write(path.join(root, 'result', 'health-verify.json'), '{"summary":"s"}');
  });
  const stranger = probe({ label: 'a stranger directory refuses', target: strangerWs, registered: ownWs, templateDir: pack });
  if (stranger.ok) fail('stranger-accepted', 'an unrelated workspace borrowed the pack charter and seated a turn');
  if (stranger.brief) fail('stranger-brief', 'an unrelated workspace was handed a brief section');
  if (!/no brief or charter/.test(stranger.refuses.join(' '))) fail('stranger-message', `the refusal no longer names the missing brief: ${stranger.refuses.join('; ')}`);

  // --- 3. a local brief still wins: an operator's copy is the one they mean ---
  const localWs = scratch('local', (root) => {
    write(path.join(root, 'BRIEF.md'), '# Local brief\n\nThe workspace means this one.\n');
  });
  const local = probe({ label: 'a workspace brief wins over the pack', workspace: localWs, target: localWs, registered: ownWs, templateDir: pack });
  if (!local.ok) fail('local-refuses', `a workspace with its own brief refused: ${local.refuses.join('; ')}`);
  if (local.brief && local.brief.path !== 'BRIEF.md') fail('local-path', `a workspace brief must be reported by name, got ${local.brief.path}`);
  if (local.brief && local.brief.label !== 'The brief') fail('local-label', `a workspace brief must not claim it came from the pack, got ${local.brief.label}`);
  if (local.brief && local.brief.text.includes('The workspace means this one') === false) fail('local-text', 'the local brief was not the text delivered');

  // --- 4. ordering on the real path: the registered workspace's own copy wins --
  // Probe 3 cannot see this. There the target is a stranger, so the pack is
  // never consulted and a reversed precedence would look identical. Only when
  // the target *is* the registered workspace, and both copies exist, does the
  // order become observable — which is exactly the mutation that slipped past.
  const bothWs = scratch('both', (root) => {
    write(path.join(root, 'BRIEF.md'), '# Workspace brief\n\nThis copy was put here on purpose.\n');
    write(path.join(root, 'result', 'health-verify.json'), '{"summary":"s"}');
  });
  const both = probe({ label: 'the registered workspace copy beats the pack', target: bothWs, registered: bothWs, templateDir: pack });
  if (!both.ok) fail('both-refuses', `a registered workspace with its own brief refused: ${both.refuses.join('; ')}`);
  if (both.brief && !both.brief.text.includes('put here on purpose')) fail('precedence', `the pack overrode the workspace's own brief: ${JSON.stringify(both.brief.text.slice(0, 60))}`);
  if (both.brief && both.brief.label !== 'The brief') fail('precedence-label', `a workspace brief must not claim it came from the pack, got ${both.brief.label}`);

  // --- 5. every accepted name still works, by the same rule ------------------
  for (const name of BRIEF_FILES) {
    const ws = path.join(localWs, `named-${name}`);
    fs.mkdirSync(ws, { recursive: true });
    write(path.join(ws, name), `# via ${name}\n`);
    const r = probe({ label: `${name} resolves`, target: ws, registered: ownWs, templateDir: pack });
    if (!r.ok) fail('accepted-name', `${name} in a workspace should resolve locally, but refused`);
  }

  for (const root of [pack, ownWs, strangerWs, localWs, bothWs]) fs.rmSync(root, { recursive: true, force: true });

  return { ok: failures.length === 0, failures };
}

export function run() {
  return audit();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const out = run();
  if (out.ok) {
    console.log('assert-health-brief: ok');
  } else {
    for (const f of out.failures) console.error(`  FAIL  ${f.kind}: ${f.detail}`);
    console.error(`assert-health-brief: ${out.failures.length} fail`);
    process.exit(1);
  }
}
