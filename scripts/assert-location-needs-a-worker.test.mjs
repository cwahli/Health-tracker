// R-14.1 card 4 sensor: /location names a host with a connected worker, not a
// variable. Setting BOT_LOCATION is not a connection. With no worker, the
// command must refuse, the location must not change, and the following turn
// must not start a lane on this machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_HOSTS,
  TTL_MS,
  recordWorkerConnected,
  workerStatus,
  clearWorker,
  presencePath,
} from './lib/worker-presence.mjs';
import { getBlockedLocation, setBlockedLocation, clearBlockedLocation } from './lib/location-state.mjs';

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

console.log('assert-location-needs-a-worker:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-'));
const at = (host, opts = {}) => workerStatus(host, { home, ...opts });

try {
  // 1. The host this process runs on is reachable by definition.
  check('the local host is reachable', at('vps').reachable);
  check('the local host says why', /poller/.test(at('vps').reason));
  check('vm2 counts as this machine', at('vm2').reachable);

  // 2. A remote host with no worker is not.
  for (const host of ['mobile', 'collab', 'grok']) {
    check(`${host} is unreachable with no worker`, at(host).reachable === false);
    check(`${host} says no worker has connected`, /no worker has connected/.test(at(host).reason));
  }

  // 3. A connected worker makes it reachable, and the record goes stale.
  recordWorkerConnected({ host: 'mobile', pid: process.pid, detail: 'phone', home });
  check('mobile is reachable once a worker has connected', at('mobile').reachable);
  check('the record remembers the worker', at('mobile').reason === 'worker connected');

  const stale = at('mobile', { now: Date.now() + TTL_MS + 1000 });
  check('a silent worker goes stale', stale.reachable === false);
  check('the stale reason names the silence', /silent for/.test(stale.reason));

  const dead = recordWorkerConnected({ host: 'collab', pid: 999999, detail: 'notebook', home });
  check('a dead worker pid is not a connection', at('collab').reachable === false);
  check('the dead reason names the pid', /pid 999999 is gone/.test(at('collab').reason));
  check('the record still exists on disk', fs.existsSync(presencePath('collab', home)));
  check('an unknown host is unreachable, not an error', workerStatus('somewhere-else', { home }).reachable === false);

  // 4. A record with no timestamp is not trusted.
  fs.writeFileSync(presencePath('grok', home), JSON.stringify({ host: 'grok', pid: null }), 'utf8');
  check('a record with no timestamp is not a connection', at('grok').reachable === false);

  clearWorker('mobile', home);
  check('clearing the record drops the host', at('mobile').reachable === false);

  // 5. The refused request is remembered per chat and can be released.
  setBlockedLocation(42, 'mobile', 'no worker has connected', { home });
  check('the refused host is remembered', getBlockedLocation(42, { home })?.requested === 'mobile');
  check('another chat is not held', getBlockedLocation(43, { home }) === null);
  clearBlockedLocation(42, { home });
  check('clearing releases the hold', getBlockedLocation(42, { home }) === null);

  // 6. Wiring: the command path checks presence, and the turn path holds.
  const src = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check('the command imports the presence check', /import \{ KNOWN_HOSTS, workerStatus \}/.test(src));
  check('/location only sets BOT_LOCATION when a worker answered', /const status = workerStatus\(target\);\s*\n\s*if \(status\.reachable\) \{\s*\n\s*process\.env\.BOT_LOCATION = target;/.test(src));
  check('/location records the refusal', /setBlockedLocation\(chatId, target, status\.reason\)/.test(src));
  check('the refusal says the turn was not run', /the turn was \*\*not\*\* run/.test(src));
  check('the old unconditional assignment is gone', !/if \(target === 'mobile' \|\| target === 'vps'\) \{\s*\n\s*process\.env\.BOT_LOCATION = target;/.test(src));
  check('the turn path holds instead of falling back', /const heldLocation = getBlockedLocation\(chatId\);/.test(src));
  check('the held turn returns before any lane is chosen', /no allowance was spent[\s\S]{0,400}return;/.test(src));
  check('the hold is released when the worker appears', /if \(status\.reachable\) \{\s*\n\s*process\.env\.BOT_LOCATION = status\.host;\s*\n\s*clearBlockedLocation\(chatId\);/.test(src));
  check('every known host is offered', KNOWN_HOSTS.length >= 4);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
