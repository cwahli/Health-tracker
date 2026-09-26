// R-14 guard 10 sensor: one live poller per bot id. A second bot-host with
// the same id — what a move creates while the old host is still up — is
// refused by name; a lease held by a dead pid is taken over, not obeyed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  leasePath,
  acquirePollerLease,
  renewPollerLease,
  releasePollerLease,
  pollerLeaseState,
} from './lib/poller-lease.mjs';

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

console.log('assert-poller-lease:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'poller-lease-'));
const KEY = 'vm';
// A process that is alive for the whole test (the rival poller), and one that
// is certainly gone (a lease left behind by a crash).
const rival = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
const deadPid = (() => {
  const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  return Number(child.pid);
})();

try {
  // 1. First boot takes the lease.
  const first = acquirePollerLease({ key: KEY, host: 'vps', pid: process.pid, home });
  check('the first poller acquires the lease', first.ok === true && first.row.pid === process.pid);
  check('the lease records the host it was taken for', pollerLeaseState({ key: KEY, home }).host === 'vps');

  // 2. A second poller with the same id is refused, by name.
  const second = acquirePollerLease({ key: KEY, host: 'colab', pid: rival.pid, home });
  check('a second poller with the same id is refused', second.ok === false);
  check('the refusal names the holder and the host it holds for', new RegExp(`pid ${process.pid}`).test(second.reason) && /on vps/.test(second.reason));
  check('the refused starter does not overwrite the lease', pollerLeaseState({ key: KEY, home }).pid === process.pid);

  // 3. Re-acquiring your own lease is a no-op success.
  const again = acquirePollerLease({ key: KEY, host: 'vps', pid: process.pid, home });
  check('a restart by the same pid re-acquires cleanly', again.ok === true);

  // 4. Only the holder can renew or release.
  check('a non-holder cannot renew', renewPollerLease({ key: KEY, host: 'x', pid: rival.pid, home }) === false);
  check('a non-holder cannot release', releasePollerLease({ key: KEY, pid: rival.pid, home }) === false);
  check('the lease survives a stale release', pollerLeaseState({ key: KEY, home }) !== null);
  const renewed = renewPollerLease({ key: KEY, host: 'mobile', pid: process.pid, home });
  check('the holder renews, and the lease follows the location', renewed === true && pollerLeaseState({ key: KEY, home }).host === 'mobile');
  check('the holder can release', releasePollerLease({ key: KEY, pid: process.pid, home }) === true);
  check('release leaves no lease behind', pollerLeaseState({ key: KEY, home }) === null);

  // 3'. A lease whose pid died is taken over, not obeyed.
  fs.mkdirSync(path.dirname(leasePath(KEY, home)), { recursive: true });
  fs.writeFileSync(leasePath(KEY, home), `${JSON.stringify({ key: KEY, host: 'vps', pid: deadPid, acquiredAt: '2026-01-01T00:00:00.000Z', renewedAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`);
  const takeover = acquirePollerLease({ key: KEY, host: 'colab', pid: 333, home });
  check('a lease held by a dead pid is taken over', takeover.ok === true);
  check('the takeover says whose lease it was', takeover.row.takenOverFrom && takeover.row.takenOverFrom.pid === deadPid);
  check('the takeover keeps the original acquisition time', takeover.row.acquiredAt === '2026-01-01T00:00:00.000Z');

  // 4'. The key cannot escape its directory.
  const traversal = leasePath('../../etc/passwd', home);
  check('a hostile bot id cannot escape the lease directory', !traversal.includes('..') && traversal.startsWith(path.join(home, '.hermes', 'poller-lease')));

  // 5. Source wiring: acquired before the bot starts, released on shutdown.
  const bot = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  const main = bot.slice(bot.indexOf('async function main()'));
  const acquireAt = main.indexOf('acquirePollerLease(');
  check('the lease is acquired in main, before the token is resolved', acquireAt !== -1 && main.indexOf('resolveToken(bot)', acquireAt) > acquireAt);
  check('a refused second poller exits instead of starting', /refusing to start: \$\{lease\.reason\}/.test(main) && /process\.exit\(1\);/.test(main));
  check('shutdown gives the lease back', /releasePollerLease\(\{ key: config\.id, pid: process\.pid \}\)/.test(main) && /process\.once\('SIGTERM'/.test(main));
  check('the lease is renewed while the poller runs', /renewPollerLease\(\{ key: config\.id, host: workLocation\(\), pid: process\.pid \}\)/.test(main));
  check('/location moves the lease with the host it names', /renewPollerLease\(\{ key: config\.id, host: target/.test(bot));
} finally {
  try {
    rival.kill('SIGKILL');
  } catch {}
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
