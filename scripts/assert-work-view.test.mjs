#!/usr/bin/env node
/**
 * assert-work-view.test.mjs — card 6c named gate.
 *
 * A swap must move the VIEW, not just the session row. The stable view lives
 * in one tmux session (`work-view`, no location slug) and repointWorkView()
 * re-targets its pane in place after a swap. This sensor proves, against a
 * fake tmux runner:
 *  1. the stable name and target shape (`work-view:<window>`);
 *  2. after a repoint, capture-pane shows the CURRENT tool and no pane still
 *     runs the old one (the old pane is gone);
 *  3. repoint uses only list-panes / kill-pane / respawn-pane / send-keys /
 *     capture-pane — never anything that destroys or forks the view;
 *  4. a view with no pane fails closed instead of inventing one.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('assert-work-view (card 6c)\n');

const libPath = path.join(ROOT, 'scripts/lib/work-session.mjs');
const { WORK_VIEW_SESSION, workViewTarget, tmuxWindowFor, repointWorkView } =
  await import(new URL(`file://${libPath.replace(/\\/g, '/')}`).href);

const ALLOWED = new Set(['list-panes', 'kill-pane', 'respawn-pane', 'send-keys', 'capture-pane']);
const FORBIDDEN = ['kill-session', 'kill-window', 'new-session', 'new-window', 'split-window'];

/** Fake tmux modeling one view target: panes plus a visible screen. */
function fakeViewTmux({ panes, respawnOk = true, sendKeysOk = true }) {
  const calls = [];
  let live = [...panes];
  let screen = live.map((p) => `SCREEN ${p.id}: ${p.command}`).join('\n');
  const targetOf = (args) => args[args.indexOf('-t') + 1];
  const fn = (args) => {
    calls.push(args);
    const [cmd] = args;
    if (cmd === 'list-panes') return live.map((p) => `${p.id}\t${p.command}`).join('\n');
    if (cmd === 'kill-pane') {
      live = live.filter((p) => p.id !== targetOf(args));
      return true;
    }
    if (cmd === 'respawn-pane') {
      if (!respawnOk) return false;
      const hit = live.find((p) => p.id === targetOf(args));
      if (!hit) return false;
      hit.command = args.at(-1);
      screen = `LIVE: ${hit.command}`;
      return true;
    }
    if (cmd === 'send-keys') {
      if (!sendKeysOk) return false;
      const last = args.at(-1);
      if (last === 'C-c') screen = '';
      else screen = `LIVE: ${last === 'Enter' ? args.at(-2) : last}`;
      return true;
    }
    if (cmd === 'capture-pane') return screen;
    return false;
  };
  return { fn, calls, panes: () => live, screen: () => screen };
}

const CHAT_ID = '6218257274|health-tracker';
const OLD_CMD = "'opencode' attach 'http://127.0.0.1:4096' --dir '/home/ubuntu/src/Health-tracker' --session 'ses_old'";
const NEW_CMD = "'opencode' attach 'http://127.0.0.1:4096' --dir '/root/Health-tracker' --session 'ses_new'";

// 1. Stable name, no location slug.
check('the swap view is one stable session', WORK_VIEW_SESSION === 'work-view');
check('the view target keeps the chat window, not a location',
  workViewTarget(CHAT_ID) === `work-view:${tmuxWindowFor(CHAT_ID)}`);
check('the stable target never names a machine',
  !/vps|mobile|collab|grok|work-vps|home|root/i.test(workViewTarget(CHAT_ID)));

// 2. Repoint moves the view: old tool gone, current tool on screen.
{
  const target = workViewTarget(CHAT_ID);
  const view = fakeViewTmux({ panes: [{ id: '%1', command: OLD_CMD }, { id: '%2', command: 'bash' }] });
  const out = repointWorkView({ target, command: NEW_CMD, expect: 'ses_new', tmux: view.fn });
  check('repoint succeeds and verifies the current tool', out.ok === true && out.verified === true && out.target === target);
  check('repoint keeps one pane and drops the stale sibling',
    out.pane === '%1' && out.removedPanes.join(',') === '%2');
  check('capture-pane shows the current tool, not the old screen',
    view.screen().includes('ses_new') && !view.screen().includes('ses_old'));
  check('no remaining pane still runs the old tool',
    view.panes().every((p) => p.command !== OLD_CMD));
  check('repoint used only view-moving commands',
    view.calls.every(([cmd]) => ALLOWED.has(cmd)),
    view.calls.map(([cmd]) => cmd).join(','));
  check('repoint never destroys or forks the view',
    !view.calls.flat().some((arg) => FORBIDDEN.some((f) => String(arg).includes(f))));
}

// 3. send-keys fallback when respawn-pane is unavailable.
{
  const target = workViewTarget(CHAT_ID);
  const view = fakeViewTmux({ panes: [{ id: '%1', command: OLD_CMD }], respawnOk: false });
  const out = repointWorkView({ target, command: NEW_CMD, expect: 'ses_new', tmux: view.fn });
  check('repoint falls back to send-keys and still verifies',
    out.ok === true && out.method === 'send-keys' && view.screen().includes('ses_new'));
}

// 4. Fail closed: no pane means no invented view.
{
  const target = workViewTarget(CHAT_ID);
  const view = fakeViewTmux({ panes: [] });
  const out = repointWorkView({ target, command: NEW_CMD, expect: 'ses_new', tmux: view.fn });
  const verbs = view.calls.map(([cmd]) => cmd);
  check('an empty view fails closed instead of inventing one',
    out.ok === false && out.verified === false && verbs.every((cmd) => cmd === 'list-panes'));
}

// 5. Missing arguments fail closed.
check('repoint without a target fails closed',
  repointWorkView({ command: NEW_CMD, tmux: () => { throw new Error('must not be called'); } }).ok === false);
check('repoint without a command fails closed',
  repointWorkView({ target: workViewTarget(CHAT_ID), tmux: () => { throw new Error('must not be called'); } }).ok === false);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
