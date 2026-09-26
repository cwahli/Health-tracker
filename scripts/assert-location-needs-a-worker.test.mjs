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
  machineLabel,
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
  check('the command imports the presence check', /import \{[^}]*KNOWN_HOSTS[^}]*workerStatus/.test(src));
  check('/location only sets BOT_LOCATION when a worker answered', /const status = workerStatus\(target\);\s*\n\s*if \(status\.reachable\) \{\s*\n\s*process\.env\.BOT_LOCATION = target;/.test(src));
  check('/location records the refusal', /setBlockedLocation\(chatId, target, status\.reason\)/.test(src));
  check('the refusal says the turn was not run', /the turn was \*\*not\*\* run/.test(src));
  check('the old unconditional assignment is gone', !/if \(target === 'mobile' \|\| target === 'vps'\) \{\s*\n\s*process\.env\.BOT_LOCATION = target;/.test(src));
  check('the turn path holds instead of falling back', /const heldLocation = getBlockedLocation\(chatId\);/.test(src));
  check('the held turn returns before any lane is chosen', /no allowance was spent[\s\S]{0,400}return;/.test(src));
  check('the hold is released when the worker appears', /if \(status\.reachable\) \{\s*\n\s*process\.env\.BOT_LOCATION = status\.host;\s*\n\s*clearBlockedLocation\(chatId\);/.test(src));
  check('every known host is offered', KNOWN_HOSTS.length >= 4);

  // 7. A remote host takes the turn over instead of running it here.
  check('the turn path asks whether the host is local', /if \(!isLocalHost\(location\)\) \{/.test(src));
  check('a remote turn goes through runOnWorker', /await runOnWorker\(\{/.test(src));
  check('the remote turn carries the project, role and workspace', /project: isExternalTurn \? activeProject\.id : 'health-tracker'/.test(src) && /role: activeRole \|\| ''/.test(src) && /workspace: effectiveWorkspace/.test(src));
  check('the reply names the host that ran it', /host: \$\{host\}/.test(src) || /host: \$\{location\}/.test(src));
  // Disclosed change (guards 4-5): an unreachable host used to fall through to
  // a local run on this machine's allowance. It now holds the turn, by name.
  const bot = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check(
    'a worker with no live connection holds the turn instead of running locally',
    /if \(!remoteStatus\.reachable\)[\s\S]{0,300}setBlockedLocation\(chatId, (location|host)/.test(bot) &&
      !/if \(!status\.reachable\) return null;/.test(bot)
  );

  // 8. The requested location survives a restart: BOT_LOCATION is process env
  // and dies with the poller, so /location also saves it in the chat's prefs
  // (reloaded on boot) and the turn path prefers the saved request. /status
  // prints the requested route, not just the physical host.
  check(
    'the requested location is saved per chat on /location',
    /setPref\(prefs, chatId, \{ location: target \}\);?\s*\n\s*savePrefs\(config\.id, prefs\);/.test(src)
  );
  check(
    'the turn path prefers the saved request over process env',
    /desiredLocation\(prefs, chatId\) \|\| workLocation\(\)/.test(src)
  );
  check('status shows the requested route', /route: requested/.test(src));
  check('status shows which machine the worker is', /worker: \$\{machineLabel\(/.test(src));

  // 9. Machine identity: presence records which machine answered, stand-ins
  // are labeled, and /location prints it — a stand-in must never silently
  // pass as the physical device its host name suggests.
  const mach = { hostname: 'phone-1', platform: 'android', arch: 'arm64' };
  recordWorkerConnected({ host: 'mobile', pid: process.pid, detail: 'phone', machine: mach, standin: false, home });
  const identified = at('mobile');
  check('presence carries the machine that connected', identified.machine?.hostname === 'phone-1');
  check('a real worker is not labeled a stand-in', identified.standin === false);
  check('the machine line names host and platform', machineLabel(mach) === 'phone-1 (android/arm64)');
  check('an absent machine is said out loud, not blank', machineLabel(null) === 'unknown machine');
  recordWorkerConnected({ host: 'mobile', pid: process.pid, home });
  check('a heartbeat that omits the machine keeps the last one', at('mobile').machine?.hostname === 'phone-1');
  recordWorkerConnected({ host: 'mobile', pid: process.pid, machine: mach, standin: true, home });
  check('a stand-in is labeled in presence', at('mobile').standin === true);
  recordWorkerConnected({ host: 'mobile', pid: process.pid, home });
  check('a heartbeat that omits the flag keeps the stand-in label', at('mobile').standin === true);
  recordWorkerConnected({ host: 'mobile', pid: process.pid, standin: false, home });
  check('an explicit standin:false from the worker clears the label', at('mobile').standin === false);
  check('/location prints the worker machine', /worker: \$\{machineLabel\(status\.machine\)\}/.test(src));
  check('/location warns on a stand-in', /labeled stand-in/.test(src));
  check('the canary refuses a worker with no machine identity', /no machine identity reported by the worker/.test(src));
  check('the canary refuses a changed worker identity', /worker identity changed/.test(src));
  clearWorker('mobile', home);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
