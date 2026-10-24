#!/usr/bin/env node
/**
 * fleet-snapshot-push.mjs — Publish the local fleet dashboard + Mac telemetry to the gateway.
 *
 * The dashboard that owns the authoritative fleet rows (`fleet-status.py
 * --serve`, default http://127.0.0.1:8765/status.json) runs on a machine the
 * deployed gateway cannot dial back. This reporter reads that status.json,
 * attaches Mac switch & resource telemetry (`mac`), and POSTs it to the
 * gateway's `/fleet/api/snapshot` door, while also executing any queued Mac
 * switch/kill actions returned by the gateway.
 *
 * Usage:
 *   node scripts/fleet-snapshot-push.mjs --once
 *   node scripts/fleet-snapshot-push.mjs --interval 5000
 *
 * Env / flags:
 *   FLEET_STATUS_URL   --source     default http://127.0.0.1:8765/status.json
 *   FLEET_GATEWAY_URL  --gateway    default https://app.health-tracker.co.uk
 *   FLEET_TELEMETRY_SECRET / TUI_GATEWAY_SECRET   --secret
 */
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';
import { execFileSync, spawn } from 'node:child_process';

// Cloudflare dual-stack: ensure IPv4 is preferred over broken IPv6 routes on macOS
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const PROTECTED_PROCESSES = new Set([
  'kernel_task',
  'launchd',
  'WindowServer',
  'loginwindow',
  'SystemUIServer',
  'Finder',
  'Dock',
  'Terminal',
  'iTerm2',
  'sshd',
]);

export function getArg(name, fallback = '') {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      // `--source URL` (space form) as well as bare boolean flags.
      return next && !next.startsWith('--') ? next : '1';
    }
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return fallback;
}

export function readSecretFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

function runCmd(cmd, args = [], timeout = 2500) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }) || '';
  } catch {
    return '';
  }
}

export function collectMacSystemStatus({ lastActionResult = null, reporterStopPending = false } = {}) {
  const home = os.homedir();
  const totalMemBytes = os.totalmem();
  const totalGb = Number((totalMemBytes / (1024 ** 3)).toFixed(1));

  // 1. Automation switches
  const fleetdOut = runCmd('/usr/bin/pgrep', ['-fl', 'tooling/fleetd.py']).trim();
  const fleetdPids = fleetdOut
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((p) => /^\d+$/.test(p));

  const statusSrvOut = runCmd('/usr/bin/pgrep', ['-fl', 'fleet-status.py.*--serve']).trim();
  const statusSrvPids = statusSrvOut
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((p) => /^\d+$/.test(p));

  const launchctlOut = runCmd('/bin/launchctl', ['list']);
  const snapshotLoaded = !reporterStopPending && /co\.health-tracker\.fleet-snapshot/.test(launchctlOut);
  const sageSyncLoaded = /sage-sync/i.test(launchctlOut);

  const httpOut = runCmd('/usr/bin/pgrep', ['-fl', 'http\\.server']).trim();
  const httpPorts = [];
  const httpPids = [];
  if (httpOut) {
    for (const line of httpOut.split('\n')) {
      const pid = line.trim().split(/\s+/)[0];
      if (/^\d+$/.test(pid)) httpPids.push(pid);
      const m = line.match(/http\.server\s+(\d+)/);
      if (m) httpPorts.push(m[1]);
    }
  }

  const switches = [
    {
      id: 'fleetd',
      label: 'Fleetd (Sage PM daemon)',
      on: fleetdPids.length > 0,
      detail: fleetdPids.length > 0 ? `Running (PID ${fleetdPids.join(', ')})` : 'Off (paused)',
      toggleable: true,
    },
    {
      id: 'fleet_snapshot',
      label: 'Fleet Snapshot Reporter (launchd)',
      on: snapshotLoaded || !reporterStopPending,
      detail: reporterStopPending
        ? 'Stopping launchd agent…'
        : snapshotLoaded
          ? `Loaded (PID ${process.pid}, pushing every 5s)`
          : `Running once (PID ${process.pid})`,
      toggleable: true,
    },
    {
      id: 'fleet_status_srv',
      label: 'Local Fleet Status Server (:8765)',
      on: statusSrvPids.length > 0,
      detail: statusSrvPids.length > 0 ? `Serving 127.0.0.1:8765 (PID ${statusSrvPids.join(', ')})` : 'Off',
      toggleable: true,
    },
    {
      id: 'sage_sync',
      label: 'Figma Sage Sync (launchd)',
      on: sageSyncLoaded,
      detail: sageSyncLoaded ? 'Loaded in launchd' : 'Off (unloaded)',
      toggleable: fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'com.sage.figma-sync.plist')) ||
        fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'co.sage.sync.plist')),
    },
    {
      id: 'http_servers',
      label: 'Stale Python http.server listeners',
      on: httpPids.length > 0,
      detail: httpPids.length > 0
        ? `${httpPids.length} running (ports: ${httpPorts.slice(0, 8).join(', ') || 'various'})`
        : '0 running (clean)',
      toggleable: httpPids.length > 0,
    },
  ];

  // 2. Memory via vm_stat + sysctl vm.swapusage
  const vmStat = runCmd('/usr/bin/vm_stat');
  const pageSizeMatch = vmStat.match(/page size of (\d+) bytes/i);
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 16384;
  const parsePages = (label) => {
    const m = vmStat.match(new RegExp(`${label}:\\s+(\\d+)`, 'i'));
    return m ? Number(m[1]) : 0;
  };
  const freePages = parsePages('Pages free') + parsePages('Pages speculative');
  const activePages = parsePages('Pages active');
  const wiredPages = parsePages('Pages wired down');
  const compressedPages = parsePages('Pages occupied by compressor');
  const toGb = (pages) => Number(((pages * pageSize) / (1024 ** 3)).toFixed(1));
  const wiredGb = toGb(wiredPages);
  const compressedGb = toGb(compressedPages);
  const activeGb = toGb(activePages);
  const freeGb = Math.max(0, Number((totalGb - (wiredGb + compressedGb + activeGb)).toFixed(1)) || toGb(freePages));
  const usedGb = Number(Math.min(totalGb, Math.max(0, totalGb - freeGb)).toFixed(1));
  const usedPct = totalGb > 0 ? Math.round((usedGb / totalGb) * 100) : 0;

  const swapOut = runCmd('/usr/sbin/sysctl', ['-n', 'vm.swapusage']);
  const swapUsedMatch = swapOut.match(/used\s*=\s*([\d.]+)M/i);
  const swapUsedMb = swapUsedMatch ? Math.round(Number(swapUsedMatch[1])) : 0;

  // 3. Disk via df -Pk /
  const dfOut = runCmd('/bin/df', ['-Pk', '/']);
  let totalGib = 0;
  let usedGib = 0;
  let availGib = 0;
  let diskUsedPct = 0;
  const dfLines = dfOut.trim().split('\n');
  if (dfLines.length >= 2) {
    const cols = dfLines[dfLines.length - 1].trim().split(/\s+/);
    if (cols.length >= 5) {
      totalGib = Number((Number(cols[1]) / (1024 * 1024)).toFixed(0)) || 0;
      usedGib = Number((Number(cols[2]) / (1024 * 1024)).toFixed(0)) || 0;
      availGib = Number((Number(cols[3]) / (1024 * 1024)).toFixed(0)) || 0;
      diskUsedPct = parseInt(cols[4], 10) || (totalGib > 0 ? Math.round((usedGib / totalGib) * 100) : 0);
    }
  }

  // 4. Top processes by CPU & Memory
  const psCpu = runCmd('/bin/ps', ['-Ao', 'pid=,user=,pcpu=,pmem=,rss=,comm=,args=', '-r']);
  const psMem = runCmd('/bin/ps', ['-Ao', 'pid=,user=,pcpu=,pmem=,rss=,comm=,args=', '-m']);
  const seenPids = new Set();
  const processes = [];
  const currentUser = os.userInfo().username;

  for (const block of [psCpu, psMem]) {
    for (const rawLine of block.split('\n').slice(0, 18)) {
      const m = rawLine.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      if (!pid || seenPids.has(pid) || pid === process.pid) continue;
      const user = m[2];
      const cpuPct = Number(Number(m[3]).toFixed(1));
      const memPct = Number(Number(m[4]).toFixed(1));
      const rssMb = Math.round(Number(m[5]) / 1024);
      if (cpuPct < 0.5 && rssMb < 60 && processes.length >= 10) continue;
      seenPids.add(pid);
      const commBase = path.basename(m[6]);
      const fullArgs = m[7].trim();
      const killable = user === currentUser && pid > 100 && !PROTECTED_PROCESSES.has(commBase);
      processes.push({
        pid,
        name: commBase,
        command: fullArgs.slice(0, 200),
        cpuPct,
        memPct,
        rssMb,
        killable,
      });
    }
  }
  processes.sort((a, b) => (b.cpuPct * 3 + b.rssMb / 100) - (a.cpuPct * 3 + a.rssMb / 100));

  return {
    hostname: os.hostname(),
    collectedAt: new Date().toISOString(),
    reporterOnline: !reporterStopPending,
    switches,
    resources: {
      cpuCount: os.cpus().length,
      loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
      memory: {
        totalGb,
        usedGb,
        wiredGb,
        compressedGb,
        freeGb,
        usedPct,
        swapUsedMb,
      },
      disk: {
        totalGib,
        usedGib,
        availGib,
        usedPct: diskUsedPct,
      },
    },
    processes: processes.slice(0, 18),
    lastActionResult,
  };
}

export function executeMacAction(action) {
  const at = new Date().toISOString();
  if (!action || typeof action !== 'object') {
    return { id: '', ok: false, message: 'Invalid action', at };
  }
  const id = String(action.id || '');
  try {
    if (action.type === 'toggle_switch') {
      const target = String(action.target || '');
      const turnOn = String(action.state || '') === 'on';
      const home = os.homedir();

      if (target === 'fleetd') {
        if (turnOn) {
          spawn('/bin/sh', [
            '-c',
            'tmux has-session -t fleetd 2>/dev/null || tmux new-session -d -s fleetd "cd /Users/chiwah/src/work/sage-prototypes && /opt/homebrew/bin/python3 -u tooling/fleetd.py >> .work/fleetd.log 2>&1"',
          ], { detached: true, stdio: 'ignore' }).unref();
          return { id, ok: true, message: 'Started fleetd in tmux session "fleetd"', at };
        }
        runCmd('/usr/bin/pkill', ['-f', 'tooling/fleetd.py']);
        runCmd('/opt/homebrew/bin/tmux', ['kill-session', '-t', 'fleetd']);
        return { id, ok: true, message: 'Stopped fleetd daemon', at };
      }

      if (target === 'fleet_status_srv') {
        if (turnOn) {
          spawn('/bin/sh', [
            '-c',
            'nohup /opt/homebrew/bin/python3 /Users/chiwah/src/work/_process/bin/fleet-status.py --root /Users/chiwah/src/work/sage-prototypes --serve --port 8765 >/dev/null 2>&1 &',
          ], { detached: true, stdio: 'ignore' }).unref();
          return { id, ok: true, message: 'Started fleet-status.py on port 8765', at };
        }
        runCmd('/usr/bin/pkill', ['-f', 'fleet-status.py.*--serve']);
        return { id, ok: true, message: 'Stopped fleet-status.py (:8765)', at };
      }

      if (target === 'http_servers') {
        runCmd('/usr/bin/pkill', ['-f', 'http\\.server']);
        return { id, ok: true, message: 'Killed stale python http.server listeners', at };
      }

      if (target === 'sage_sync') {
        const plistCandidates = [
          path.join(home, 'Library', 'LaunchAgents', 'com.sage.figma-sync.plist'),
          path.join(home, 'Library', 'LaunchAgents', 'co.sage.sync.plist'),
        ].filter((p) => fs.existsSync(p));
        if (!plistCandidates.length) {
          return { id, ok: false, message: 'No sage-sync plist found in ~/Library/LaunchAgents', at };
        }
        for (const p of plistCandidates) {
          runCmd('/bin/launchctl', [turnOn ? 'load' : 'unload', p]);
        }
        return { id, ok: true, message: `${turnOn ? 'Loaded' : 'Unloaded'} sage-sync LaunchAgent`, at };
      }

      if (target === 'fleet_snapshot' && !turnOn) {
        const plist = path.join(home, 'Library', 'LaunchAgents', 'co.health-tracker.fleet-snapshot.plist');
        spawn('/bin/sh', ['-c', `sleep 1.5 && /bin/launchctl unload "${plist}"`], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        return { id, ok: true, message: 'Unloading co.health-tracker.fleet-snapshot LaunchAgent', at, stoppingReporter: true };
      }

      return { id, ok: false, message: `Unsupported switch toggle: ${target}`, at };
    }

    if (action.type === 'kill_pid') {
      const pid = Number(action.pid);
      if (!Number.isInteger(pid) || pid <= 100) {
        return { id, ok: false, message: `Refused invalid PID ${pid}`, at };
      }
      const info = runCmd('/bin/ps', ['-o', 'user=,comm=', '-p', String(pid)]).trim();
      if (!info) {
        return { id, ok: false, message: `PID ${pid} is no longer running`, at };
      }
      const parts = info.split(/\s+/);
      const user = parts[0];
      const commBase = path.basename(parts.slice(1).join(' '));
      if (user !== os.userInfo().username) {
        return { id, ok: false, message: `Refused: PID ${pid} belongs to ${user}`, at };
      }
      if (PROTECTED_PROCESSES.has(commBase)) {
        return { id, ok: false, message: `Refused: ${commBase} (${pid}) is a protected process`, at };
      }
      process.kill(pid, 'SIGTERM');
      return { id, ok: true, message: `Sent SIGTERM to ${commBase} (PID ${pid})`, at };
    }
  } catch (err) {
    return { id, ok: false, message: err.message || 'Action failed', at };
  }
  return { id, ok: false, message: 'Unknown action', at };
}

export async function pushSnapshot({
  sourceUrl = 'http://127.0.0.1:8765/status.json',
  gatewayUrl = 'https://app.health-tracker.co.uk',
  secret = '',
  fetchImpl = fetch,
  mac = undefined,
  fallbackOnSourceError = false,
} = {}) {
  let status = null;
  try {
    const src = await fetchImpl(sourceUrl, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!src.ok) {
      if (!fallbackOnSourceError) {
        return { ok: false, stage: 'source', status: src.status, error: `status.json returned ${src.status}` };
      }
    } else {
      status = await src.json();
    }
  } catch (err) {
    if (!fallbackOnSourceError) throw err;
  }

  if (!status || !Array.isArray(status.channels)) {
    if (!fallbackOnSourceError) {
      return { ok: false, stage: 'source', error: 'status.json has no channels[]' };
    }
    status = {
      project: 'sage-prototypes (local server offline)',
      updated: new Date().toISOString(),
      channels: [],
    };
  }

  const payload = { source: 'fleet-status.py', status };
  if (mac) payload.mac = mac;

  const res = await fetchImpl(`${String(gatewayUrl).replace(/\/+$/, '')}/fleet/api/snapshot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-fleet-telemetry-secret': secret } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data?.ok) {
    return { ok: false, stage: 'gateway', status: res.status, error: data?.error || text.slice(0, 200) };
  }
  return {
    ok: true,
    rows: data.rows,
    receivedAt: data.receivedAt,
    stale: data.stale,
    pendingActions: Array.isArray(data.pendingActions) ? data.pendingActions : [],
  };
}

async function main() {
  const sourceUrl = getArg('source', process.env.FLEET_STATUS_URL || 'http://127.0.0.1:8765/status.json');
  const gatewayUrl = getArg('gateway', process.env.FLEET_GATEWAY_URL || 'https://app.health-tracker.co.uk');
  const secretFile = getArg('secret-file', '');
  const fileEnv = secretFile ? readSecretFile(secretFile) : {};
  const secret = getArg('secret', process.env.FLEET_TELEMETRY_SECRET || process.env.TUI_GATEWAY_SECRET || fileEnv.FLEET_TELEMETRY_SECRET || '');
  const interval = Math.max(1000, Number(getArg('interval', '5000')) || 5000);
  const once = process.argv.includes('--once');

  let lastState = '';
  let lastActionResult = null;
  let reporterStopPending = false;

  const beat = async () => {
    try {
      const mac = collectMacSystemStatus({ lastActionResult, reporterStopPending });
      const res = await pushSnapshot({
        sourceUrl,
        gatewayUrl,
        secret,
        mac,
        fallbackOnSourceError: true,
      });
      const key = res.ok ? `ok:${res.rows}` : `${res.stage}:${res.status || ''}:${res.error || ''}`;
      // One line per state change, not one per 5s push.
      if (key !== lastState) {
        lastState = key;
        if (res.ok) {
          console.log(`[fleet-snapshot] pushed ${res.rows} row(s) + Mac telemetry to ${gatewayUrl} at ${res.receivedAt || new Date().toISOString()}`);
        } else {
          console.warn(`[fleet-snapshot] ${res.stage} failed: ${res.error}`);
        }
      }
      if (res.ok && Array.isArray(res.pendingActions) && res.pendingActions.length > 0) {
        for (const act of res.pendingActions) {
          const outcome = executeMacAction(act);
          lastActionResult = outcome;
          console.log(`[fleet-snapshot] executed action ${act.type} (${act.target || act.pid}): ${outcome.message}`);
          if (outcome.stoppingReporter) reporterStopPending = true;
        }
        // Immediately push an updated snapshot reflecting the action result
        const followMac = collectMacSystemStatus({ lastActionResult, reporterStopPending });
        await pushSnapshot({
          sourceUrl,
          gatewayUrl,
          secret,
          mac: followMac,
          fallbackOnSourceError: true,
        });
      }
      return res;
    } catch (err) {
      const key = `error:${err.message}`;
      if (key !== lastState) {
        lastState = key;
        console.warn(`[fleet-snapshot] error: ${err.message}`);
      }
      return { ok: false, error: err.message };
    }
  };

  const first = await beat();
  if (once) return first;
  setInterval(beat, interval);
  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[fleet-snapshot] fatal: ${err.message}`);
    process.exit(1);
  });
}
