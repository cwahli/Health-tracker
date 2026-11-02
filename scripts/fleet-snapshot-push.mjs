#!/usr/bin/env node
/**
 * fleet-snapshot-push.mjs — Publish the local fleet dashboard + Mac telemetry to the gateway.
 *
 * The dashboard that owns the authoritative fleet rows (`fleet-status.py
 * --serve`, default http://127.0.0.1:8765/status.json) runs on a machine the
 * deployed gateway cannot dial back. This reporter reads that status.json,
 * attaches Mac switch & resource telemetry (`mac`), and POSTs it to the
 * gateway's `/fleet/api/snapshot` door, while also executing any queued Mac
 * switch, process, and guarded agent-message actions returned by the gateway.
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

const SEND_TOOLS = new Set(['opencode', 'commandcode']);
const VSCODE_SEND_HELPER = path.join(os.homedir(), '.config', 'health-tracker', 'fleet-vscode-screen-send.mjs');
const SEND_LOG = path.join(os.homedir(), 'Library', 'Logs', 'fleet-send.log');
const WATCH_STATE = path.join(os.homedir(), '.local', 'state', 'agent-watch', 'state.json');
const ACTION_RECEIPTS = path.join(os.homedir(), '.local', 'state', 'health-tracker', 'fleet-action-receipts.json');
const SEND_STATE_MAX_AGE_MS = 5 * 60 * 1000;
const sendRunning = new Map();

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

function cleanSendMessage(raw) {
  return String(raw || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
}

function findCommandCodeFile(sessionId, home) {
  const root = path.join(home, '.commandcode', 'projects');
  const hits = [];
  try {
    for (const dir of fs.readdirSync(root)) {
      let files = [];
      try {
        files = fs.readdirSync(path.join(root, dir));
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith('.jsonl') && !file.endsWith('.checkpoints.jsonl') && file.startsWith(sessionId)) {
          hits.push(path.join(root, dir, file));
        }
      }
    }
  } catch {
    return null;
  }
  return hits.length === 1 ? hits[0] : null;
}

function sendSessionError(tool, sessionId, watchStatePath, now = Date.now()) {
  let state;
  let stat;
  try {
    stat = fs.statSync(watchStatePath);
    state = JSON.parse(fs.readFileSync(watchStatePath, 'utf8'));
  } catch {
    return 'Watcher state unavailable';
  }
  const heartbeat = Number(state.heartbeat) || 60;
  const lastRun = Number(state.last_run);
  const maxAgeMs = Math.max(180, 3 * heartbeat) * 1000;
  if (!Number.isFinite(lastRun) || now - lastRun * 1000 > maxAgeMs || now - stat.mtimeMs > SEND_STATE_MAX_AGE_MS) {
    return 'Watcher state is stale; refusing to send';
  }
  const sessions = state.sessions && typeof state.sessions === 'object' && Array.isArray(state.sessions[tool])
    ? state.sessions[tool]
    : [];
  const matches = sessions.filter((session) => session && String(session.id) === sessionId &&
    (!session.tool || String(session.tool) === tool));
  if (matches.length !== 1) return 'Session not found or ambiguous in watcher state';
  if (matches[0].busy !== false) return 'Refused: session is busy or its state is unknown';
  return null;
}

function appendSendLog(sendLogPath, line) {
  try {
    fs.mkdirSync(path.dirname(sendLogPath), { recursive: true });
    fs.appendFileSync(sendLogPath, `${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    console.error(`[fleet-send] unable to write send log: ${err.message}`);
  }
}

function startVscodeSend({ id, at, sessionId, message, key, home, spawnImpl, sendLogPath, helperPath }) {
  const refuse = (text) => ({ id, ok: false, message: text, at });
  if (!fs.existsSync(helperPath)) return refuse('VS Code sender helper is missing');

  fs.mkdirSync(path.dirname(sendLogPath), { recursive: true });
  const logFd = fs.openSync(sendLogPath, 'a');
  let child;
  try {
    child = spawnImpl(process.execPath, [helperPath], {
      detached: true,
      stdio: ['pipe', 'pipe', logFd],
      cwd: home,
    });
  } finally {
    fs.closeSync(logFd);
  }
  sendRunning.set(key, child);
  child.unref();
  child.on('error', (err) => {
    if (sendRunning.get(key) === child) sendRunning.delete(key);
    appendSendLog(sendLogPath, `vscode ${sessionId.slice(0, 8)} spawn error: ${err.message}`);
  });
  child.on('exit', (code) => {
    if (sendRunning.get(key) === child) sendRunning.delete(key);
    appendSendLog(sendLogPath, `vscode ${sessionId.slice(0, 8)} chars=${message.length} exit=${code}`);
  });

  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      finish(refuse('VS Code sender did not acknowledge within 60 seconds; status is uncertain and further sends are blocked until it exits'));
    }, 60_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      child.stdout.destroy();
      try {
        const ack = JSON.parse(buffer.slice(0, newline));
        if (ack.ok !== true) {
          finish(refuse(`VS Code send failed: ${String(ack.error || 'sender rejected the message').slice(0, 180)}`));
          return;
        }
        const warning = ack.warning ? `; watcher tracking warning: ${String(ack.warning).slice(0, 160)}` : '';
        finish({
          id,
          ok: true,
          message: `${String(ack.message || `Submitted to VS Code session ${sessionId.slice(0, 8)}`)}${warning}. The Brief updates within about a minute`,
          at,
        });
      } catch {
        finish(refuse('VS Code sender returned an invalid acknowledgement'));
      }
    });
    child.on('error', (err) => finish(refuse(`VS Code sender failed to start: ${err.message}`)));
    child.stdin.on('error', (err) => finish(refuse(`VS Code sender input failed: ${err.message}`)));
    child.on('exit', (code) => {
      if (!settled) finish(refuse(`VS Code sender exited before acknowledging (code ${code})`));
    });
    child.stdin.end(JSON.stringify({ sessionId, message }));
  });
}

async function startSendMessage(action, id, at, { home, watchStatePath, sendLogPath, helperPath, spawnImpl }) {
  const tool = String(action.tool || '');
  const rowId = String(action.rowId || '');
  const sessionId = String(action.sessionId || '');
  const message = cleanSendMessage(action.message);
  const refuse = (text) => ({ id, ok: false, message: text, at });

  if (!SEND_TOOLS.has(tool) && tool !== 'vscode') {
    return refuse(`Refused: send is not supported for ${tool || 'this tool'}`);
  }
  const match = rowId.match(/^watch:(vscode|commandcode|opencode):([A-Za-z0-9_-]{4,80})$/);
  if (!match || match[1] !== tool || match[2] !== sessionId) {
    return refuse('Refused: target does not match the watcher row');
  }
  if (!message || message.length > 2000) return refuse('Refused: message must be 1-2000 characters');

  const key = `${tool}:${sessionId}`;
  if (sendRunning.has(key)) return refuse('A message is already running in this session');
  const stateError = sendSessionError(tool, sessionId, watchStatePath);
  if (stateError) return { ...refuse(stateError), deferred: true };

  if (tool === 'vscode') {
    return startVscodeSend({ id, at, sessionId, message, key, home, spawnImpl, sendLogPath, helperPath });
  }

  let args;
  if (tool === 'opencode') {
    args = ['run', '--session', sessionId, '--auto', '--', message];
  } else {
    const sessionFile = findCommandCodeFile(sessionId, home);
    if (!sessionFile) return refuse('Refused: session file not found or ambiguous');
    args = ['--session', sessionFile, '-p', '--yolo', '--', message];
  }

  const binary = tool === 'opencode'
    ? path.join(home, '.opencode', 'bin', 'opencode')
    : path.join(home, '.local', 'bin', 'cmd');
  if (!fs.existsSync(binary)) return refuse(`${tool} CLI is missing`);
  fs.mkdirSync(path.dirname(sendLogPath), { recursive: true });
  const child = spawnImpl(binary, args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: home,
  });
  sendRunning.set(key, child);
  child.on('error', (err) => {
    if (sendRunning.get(key) === child) sendRunning.delete(key);
    appendSendLog(sendLogPath, `${tool} ${sessionId.slice(0, 8)} spawn error: ${err.message}`);
  });
  child.on('exit', (code) => {
    if (sendRunning.get(key) === child) sendRunning.delete(key);
    appendSendLog(sendLogPath, `${tool} ${sessionId.slice(0, 8)} chars=${message.length} exit=${code}`);
  });
  child.unref();
  return { id, ok: true, message: `Started send to ${tool} session ${sessionId.slice(0, 8)}; the Brief updates within about a minute`, at };
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

export async function executeMacAction(action, options = {}) {
  const at = new Date().toISOString();
  if (!action || typeof action !== 'object') {
    return { id: '', ok: false, message: 'Invalid action', at };
  }
  const id = String(action.id || '');
  const home = options.home || os.homedir();
  const watchStatePath = options.watchStatePath || WATCH_STATE;
  const sendLogPath = options.sendLogPath || SEND_LOG;
  const helperPath = options.helperPath || VSCODE_SEND_HELPER;
  const spawnImpl = options.spawnImpl || spawn;
  try {
    if (action.type === 'send_message') {
      return await startSendMessage(action, id, at, {
        home,
        watchStatePath,
        sendLogPath,
        helperPath,
        spawnImpl,
      });
    }

    if (action.type === 'toggle_switch') {
      const target = String(action.target || '');
      const turnOn = String(action.state || '') === 'on';

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
    pendingActionIds: Array.isArray(data.pendingActionIds) ? data.pendingActionIds : null,
  };
}

function loadActionReceipts(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw new Error(`Unable to load Fleet action receipts at ${filePath}: ${err.message}`, { cause: err });
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.receipts)) {
    throw new Error(`Fleet action receipts at ${filePath} have an unsupported or invalid format`);
  }
  const receipts = new Map();
  for (const receipt of parsed.receipts) {
    if (!receipt || typeof receipt.id !== 'string' || !receipt.id ||
        !['started', 'completed'].includes(receipt.state)) {
      throw new Error(`Fleet action receipts at ${filePath} contain an invalid entry`);
    }
    if (receipt.state === 'completed' &&
        (!receipt.outcome || typeof receipt.outcome !== 'object' || receipt.outcome.id !== receipt.id)) {
      throw new Error(`Fleet action receipt ${receipt.id} has an invalid outcome`);
    }
    receipts.set(receipt.id, receipt);
  }
  return receipts;
}

function writeActionReceipts(filePath, receipts) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const fd = fs.openSync(temporaryPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify({ version: 1, receipts: [...receipts.values()] })}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporaryPath, filePath);
}

export function createActionReceiptStore({ filePath = ACTION_RECEIPTS } = {}) {
  let receipts = filePath ? loadActionReceipts(filePath) : new Map();
  const save = (next) => {
    if (filePath) writeActionReceipts(filePath, next);
    receipts = next;
  };
  return Object.freeze({
    async execute(action, executor = executeMacAction) {
      const id = String(action?.id || '');
      if (!id) throw new Error('Fleet action receipt requires an action id');
      const previous = receipts.get(id);
      if (previous?.state === 'completed') return { ...previous.outcome };
      if (previous?.state === 'started') {
        const outcome = {
          id,
          ok: false,
          message: 'Delivery was interrupted; it was not retried automatically. Send again if needed.',
          at: new Date().toISOString(),
        };
        const next = new Map(receipts);
        next.set(id, { id, state: 'completed', outcome });
        save(next);
        return { ...outcome };
      }

      const started = new Map(receipts);
      started.set(id, { id, state: 'started', startedAt: new Date().toISOString() });
      save(started);
      const outcome = await executor(action);
      if (outcome?.deferred === true) {
        const waiting = new Map(receipts);
        waiting.delete(id);
        save(waiting);
        return outcome;
      }
      const completedOutcome = {
        id,
        ok: Boolean(outcome?.ok),
        message: String(outcome?.message || 'Action completed without a result').slice(0, 220),
        at: String(outcome?.at || new Date().toISOString()),
        ...(outcome?.stoppingReporter ? { stoppingReporter: true } : {}),
      };
      const completed = new Map(receipts);
      completed.set(id, { id, state: 'completed', outcome: completedOutcome });
      save(completed);
      return { ...completedOutcome };
    },
    prune(pendingActionIds) {
      const pending = new Set((Array.isArray(pendingActionIds) ? pendingActionIds : []).map(String));
      const next = new Map([...receipts].filter(([id]) => pending.has(id)));
      if (next.size !== receipts.size) save(next);
    },
  });
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
  const receiptPath = getArg('action-receipts', process.env.FLEET_ACTION_RECEIPTS_PATH || ACTION_RECEIPTS);
  const actionReceipts = createActionReceiptStore({ filePath: receiptPath });

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
      if (res.ok && Array.isArray(res.pendingActionIds)) actionReceipts.prune(res.pendingActionIds);
      if (res.ok && Array.isArray(res.pendingActions) && res.pendingActions.length > 0) {
        for (const act of res.pendingActions) {
          const outcome = await actionReceipts.execute(act);
          if (outcome.deferred === true) {
            console.log(`[fleet-snapshot] waiting for ${act.tool} session to become available`);
            continue;
          }
          lastActionResult = outcome;
          const target = act.type === 'send_message' ? `${act.tool} ${act.rowId}` : (act.target || act.pid);
          console.log(`[fleet-snapshot] executed action ${act.type} (${target}): ${outcome.message}`);
          if (outcome.stoppingReporter) reporterStopPending = true;
          const followMac = collectMacSystemStatus({ lastActionResult, reporterStopPending });
          const acknowledged = await pushSnapshot({
            sourceUrl,
            gatewayUrl,
            secret,
            mac: followMac,
            fallbackOnSourceError: true,
          });
          if (acknowledged.ok && Array.isArray(acknowledged.pendingActionIds)) {
            actionReceipts.prune(acknowledged.pendingActionIds);
          }
        }
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
