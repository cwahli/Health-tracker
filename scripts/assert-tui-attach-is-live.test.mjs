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
check('the attach still only happens for a tui view', /attachUrl: workSession\.viewMode === 'tui' \? workSession\.serverUrl : undefined/.test(src));

// 3. No other path attaches without asking.
const attaches = (src.match(/--attach|attachUrl:/g) || []).length;
check(`attach sites are few enough to audit (${attaches})`, attaches <= 4);

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
