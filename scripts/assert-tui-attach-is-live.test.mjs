// R-14.1 card 6c sensor: a turn must never attach to a TUI server that is not
// answering. On 2026-09-25 a work-session row recorded at 11:14 still pointed
// at an opencode server that had died, so every turn on @VM_19485_bot failed in
// ~2s with "Session not found" and the chat got "the model returned no text".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { opencodeServerHealthy } from './lib/opencode-tui.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

console.log('assert-tui-attach-is-live:');

// 1. The health check itself: a port nobody listens on is unhealthy, and it
//    must not throw or hang.
const dead = await opencodeServerHealthy('http://127.0.0.1:1/global/health');
check('a dead server reports unhealthy', dead === false);
check('a nonsense url reports unhealthy', (await opencodeServerHealthy('not-a-url')) === false);

// 2. The turn path checks before it attaches.
const src = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
check('the turn path imports the health check', /opencodeServerHealthy/.test(src));
check('a tui view is verified before use', /workSession\.viewMode === 'tui' && workSession\.serverUrl\) \{\s*\n\s*const live = await opencodeServerHealthy/.test(src));
check('a dead view is dropped, not attached', /dropping the stale view/.test(src));
check('the drop clears the server url', /viewMode: 'headless', serverUrl: null, state: 'stale'/.test(src));
// CHANGED 2026-09-29, deliberately. Two checks here used to assert that the
// turn attaches a server url for a tui view, and that the source has at most
// four attach sites. Both encoded a decision the installed CLI has since
// falsified, so keeping them would guard a dead path:
//   - `--attach` is not a flag in opencode v2.0.19 (verified against the binary:
//     the CLI prints help and exits 1), so the turn they guarded died as "the
//     model returned no text output".
//   - `--server` is the v2 spelling, but it needs OPENCODE_PASSWORD against a
//     service that demands one, and the bot holds no such password.
//   - With no server flag the run goes to the opencode background service, which
//     is the SAME service tui-attach.sh's terminal talks to. That is the
//     arrangement that lets a chat turn and a terminal prompt share one session,
//     so the attach plumbing is removed rather than renamed.
// The replacement guards are the stronger claim: no server directive reappears
// on the turn path, and an attached TUI can no longer gate a turn.
check('the turn pins no server url', !/attachUrl:/.test(src));
check('the turn still pins the session when a tui view is live', /sessionId: workSession\.viewMode === 'tui' \? workSession\.opencodeSessionId : undefined/.test(src));
check('an attached TUI no longer defers a turn', !/tuiHoldsConversation/.test(src));
check('the TUI is presence, not a lock', /export function tuiIsAttached/.test(src));
check('the /tui copy no longer promises a refusal', !/refuses to attach while I am mid-turn/.test(src));
check(
  'no --attach is pushed on the turn path',
  !/args\.push\('--attach'/.test(fs.readFileSync(path.join(HERE, 'lib', 'agent-opencode.mjs'), 'utf8')),
);

// 3. No call to a function that does not exist. writeObserverTerminal was
// called on every non-OpenCode surface and was never defined, so every Cline
// turn died with a ReferenceError and the chat never saw the answer.
const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check('no call to the undefined writeObserverTerminal', !/writeObserverTerminal\(/.test(code));
check('other surfaces still record a terminal state', /workLane !== 'opencode' && observer/.test(src) && /observer\.write\(/.test(src));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
