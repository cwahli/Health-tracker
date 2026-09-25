import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sessionKey,
  tmuxSessionFor,
  tmuxWindowFor,
  resolveSession,
  getSession,
  setTx,
  handoffSession,
  abortSession,
  ensureTmuxWorkView,
  disableTmuxObserver,
  debugProbe,
  sessionStatus,
  scrubSecrets,
  statusForTelegram,
  observerLogPath,
  createObserver,
  formatObserverRecord,
  writeObserverRecord,
  unquoteTmuxValue,
} from '../scripts/lib/work-session.mjs';

let store;
const noTmux = () => false;

function fakeTmux(initial = {}) {
  const sessions = new Map(Object.entries(initial).map(([name, windows]) => [name, new Set(windows)]));
  const panes = new Map();
  const calls = [];
  let nextPane = 1;
  const paneKey = (target) => String(target).replace(/:$/, '');
  const addPane = (target, command) => {
    const id = `%${nextPane++}`;
    panes.set(`${paneKey(target)}\t${id}`, { target: paneKey(target), id, command });
    return id;
  };
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'has-session') return sessions.has(args[2]);
    if (args[0] === 'list-windows') return [...(sessions.get(args[2]) || [])].join('\n');
    if (args[0] === 'new-session') {
      const session = args[3];
      sessions.set(session, new Set([args[5]]));
      addPane(`${session}:${args[5]}`, args.at(-1));
      return true;
    }
    if (args[0] === 'new-window') {
      const session = args[3].replace(/:$/, '');
      const windows = sessions.get(session) || new Set();
      windows.add(args[5]);
      sessions.set(session, windows);
      addPane(`${session}:${args[5]}`, args.at(-1));
      return true;
    }
    if (args[0] === 'list-panes') {
      const target = paneKey(args[2]);
      return [...panes.values()].filter((pane) => pane.target === target).map((pane) => `${pane.id}\t${pane.command}`).join('\n');
    }
    if (args[0] === 'split-window') {
      return addPane(args[3], args.at(-1));
    }
    if (args[0] === 'select-pane' || args[0] === 'kill-pane') {
      if (args[0] === 'kill-pane') {
        const entry = [...panes.entries()].find(([, pane]) => pane.id === args[2]);
        if (entry) panes.delete(entry[0]);
      }
      return true;
    }
    return false;
  };
  for (const [session, windows] of sessions) {
    for (const window of windows) addPane(`${session}:${window}`, 'bash');
  }
  return { calls, run, sessions, panes };
}

beforeEach(() => {
  store = path.join(os.tmpdir(), `ws_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
});

const loc = { location: 'vps', chat: 'qa_meal', workspace: '/home/ubuntu/src/Health-tracker' };

/** Regression sensor (live defect 2026-09-24, BOT-19): real tmux renders
 * pane_start_command as a shell-quoted word, so an exact-equality observer
 * matcher never recognized the pane it created — /tx on spawned duplicate
 * panes, /tx off could never kill one, and the probe stayed observerLive:false. */
describe('real-tmux quoted start commands', () => {
  it('unquoteTmuxValue strips one shell-quote layer and unescapes', () => {
    expect(unquoteTmuxValue('"tail -F x\'"')).toBe("tail -F x'");
    expect(unquoteTmuxValue("'tail -F \"x\"'")).toBe('tail -F "x"');
    expect(unquoteTmuxValue('bash')).toBe('bash');
    expect(unquoteTmuxValue(null)).toBe('');
  });

  function seedRealTmuxPane(t, fake, logPath) {
    // Exactly what real tmux reports for the observer pane.
    const quoted = `\"/usr/bin/tail -n 40 -F -- '${logPath}'\"`;
    fake.panes.set(`${t}\t%99`, { target: t, id: '%99', command: quoted });
    return '%99';
  }

  it('debugProbe reports observerLive for a real-tmux quoted tail pane', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const t = `${tmuxSessionFor(session.location)}:${tmuxWindowFor(session.id)}`;
    const fake = fakeTmux({ [tmuxSessionFor(session.location)]: [tmuxWindowFor(session.id)] });
    const logPath = observerLogPath(session);
    seedRealTmuxPane(t, fake, logPath);
    const probe = debugProbe('opencode', { session, tmux: fake.run });
    expect(probe.observerLive).toBe(true);
    expect(probe.observerPane).toBe('%99');
    expect(probe.attach).toBe(true);
  });

  it('ensureTmuxWorkView reuses the quoted pane instead of spawning a duplicate', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const tmuxS = tmuxSessionFor(session.location);
    const tmuxW = tmuxWindowFor(session.id);
    const t = `${tmuxS}:${tmuxW}`;
    const fake = fakeTmux({ [tmuxS]: [tmuxW] });
    const logPath = observerLogPath(session);
    seedRealTmuxPane(t, fake, logPath);
    const r = ensureTmuxWorkView(session, { tmux: fake.run });
    expect(r.ok).toBe(true);
    expect(r.migrated).toBe(false);
    expect(r.observerPane).toBe('%99');
    expect(fake.calls.filter((c) => c[0] === 'split-window')).toHaveLength(0);
  });

  it('disableTmuxObserver kills exactly the quoted observer pane', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const tmuxS = tmuxSessionFor(session.location);
    const tmuxW = tmuxWindowFor(session.id);
    const t = `${tmuxS}:${tmuxW}`;
    const fake = fakeTmux({ [tmuxS]: [tmuxW] });
    const logPath = observerLogPath(session);
    const paneId = seedRealTmuxPane(t, fake, logPath);
    const r = disableTmuxObserver(session, { tmux: fake.run });
    expect(r.ok).toBe(true);
    expect(r.stopped).toBe(true);
    expect(r.pane).toBe(paneId);
  });
});

describe('session identity', () => {
  it('keys sessions without any bot id', () => {
    expect(sessionKey(loc)).toBe('vps|qa_meal|/home/ubuntu/src/Health-tracker');
  });

  it('maps one location to one tmux session', () => {
    expect(tmuxSessionFor('vps')).toBe('work-vps');
    expect(tmuxSessionFor('VPS-2 (!!)')).toBe('work-vps-2');
    expect(tmuxWindowFor('vps|qa_meal|/w')).toMatch(/^ws-/);
  });

  it('creates on demand and re-resolves stably', () => {
    const a = resolveSession({ ...loc, lane: 'opencode' }, store);
    const b = resolveSession(loc, store);
    expect(a.id).toBe(b.id);
    expect(b.lane).toBe('opencode');
  });

  it('reads null for unknown sessions', () => {
    expect(getSession('x|y|z', store)).toBeNull();
  });
});

describe('tx', () => {
  it('toggles observation without stopping work', () => {
    const s = resolveSession(loc, store);
    setTx(s.id, true, store);
    expect(getSession(s.id, store).tx).toBe(true);
    setTx(s.id, false, store);
    const off = getSession(s.id, store);
    expect(off.tx).toBe(false);
    expect(off.state).toBe('active');
  });
});

describe('tmux work view', () => {
  it('creates a tail-backed session and reuses the exact observer pane', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const tmux = fakeTmux();
    const first = ensureTmuxWorkView(session, { tmux: tmux.run });
    const second = ensureTmuxWorkView(session, { tmux: tmux.run });

    expect(first).toMatchObject({ ok: true, created: true, migrated: false, surface: 'terminal', tmuxSession: 'work-vps' });
    expect(first.target).toBe(`work-vps:${tmuxWindowFor(session.id)}`);
    expect(first.observerLog).toBe(observerLogPath(session));
    expect(tmux.calls.some((args) => args[0] === 'new-session' && String(args.at(-1)).includes('/usr/bin/tail -n 40 -F --'))).toBe(true);
    expect(second).toMatchObject({ ok: true, created: false, migrated: false, observerPane: first.observerPane });
    expect(tmux.calls.filter((args) => args[0] === 'split-window')).toHaveLength(0);
    expect(tmux.calls.filter((args) => args[0] === 'select-pane').length).toBeGreaterThanOrEqual(2);
    expect(tmux.calls.flat().some((arg) => /send-keys|respawn-pane|kill-window|kill-session/.test(String(arg)))).toBe(false);
  });

  it('adds only a missing window to an existing session', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const tmux = fakeTmux({ 'work-vps': ['other'] });
    const result = ensureTmuxWorkView(session, { tmux: tmux.run });
    expect(result.ok).toBe(true);
    expect(tmux.calls.map((args) => args[0])).toEqual(['has-session', 'list-windows', 'new-window', 'list-windows', 'list-panes', 'select-pane']);
    expect(tmux.sessions.get('work-vps')).toEqual(new Set(['other', tmuxWindowFor(session.id)]));
  });

  it('migrates a legacy blank window with a non-destructive observer pane', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const window = tmuxWindowFor(session.id);
    const tmux = fakeTmux({ 'work-vps': [window] });
    const result = ensureTmuxWorkView(session, { tmux: tmux.run });
    expect(result).toMatchObject({ ok: true, created: false, migrated: true });
    expect(tmux.calls.map((args) => args[0])).toEqual(['has-session', 'list-windows', 'list-panes', 'split-window', 'select-pane']);
    expect(tmux.calls.flat().some((arg) => /send-keys|respawn-pane|kill-window|kill-session/.test(String(arg)))).toBe(false);
    expect(debugProbe('opencode', { session, tmux: tmux.run }).observerLive).toBe(true);
  });

  it('cleans up only the exact observer pane', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const tmux = fakeTmux();
    const view = ensureTmuxWorkView(session, { tmux: tmux.run });
    const result = disableTmuxObserver(session, { tmux: tmux.run });
    expect(result).toMatchObject({ ok: true, stopped: true, pane: view.observerPane });
    expect(tmux.calls.some((args) => args[0] === 'kill-pane' && args[2] === view.observerPane)).toBe(true);
    expect(tmux.calls.flat().some((arg) => /kill-window|kill-session|send-keys|respawn-pane/.test(String(arg)))).toBe(false);
  });

  it('never invokes tmux for an API-only lane', () => {
    const session = resolveSession({ ...loc, lane: 'gemini' }, store);
    const tmux = fakeTmux();
    const result = ensureTmuxWorkView(session, { tmux: tmux.run });
    expect(result).toMatchObject({ ok: true, created: false, surface: 'api', target: null });
    expect(tmux.calls).toEqual([]);
  });

  it('uses a stable collision-resistant workstream name', () => {
    const prefix = 'vps|chat|/a/very/long/workspace/path/that/keeps/going';
    expect(tmuxWindowFor(`${prefix}/one`)).not.toBe(tmuxWindowFor(`${prefix}/two`));
  });
});

describe('debugProbe', () => {
  it('keeps one shape across all backends', () => {
    const keys = new Set();
    for (const backend of ['opencode', 'cline', 'grok', 'agy', 'gemini', 'human']) {
      const p = debugProbe(backend, { tmux: noTmux });
      keys.add(Object.keys(p).sort().join(','));
    }
    expect(keys.size).toBe(1);
  });

  it('terminal lanes report observer liveness, not window existence', () => {
    const s = resolveSession(loc, store);
    const tmux = fakeTmux();
    ensureTmuxWorkView(s, { tmux: tmux.run });
    const p = debugProbe('opencode', { session: s, tmux: tmux.run });
    expect(p).toMatchObject({ surface: 'terminal', attach: true, observerLive: true, tmuxSession: 'work-vps' });
    expect(p.target).toBe(`work-vps:${tmuxWindowFor(s.id)}`);
  });

  it('API lanes never claim attach', () => {
    const s = resolveSession(loc, store);
    const p = debugProbe('gemini', { session: s, tmux: noTmux });
    expect(p).toMatchObject({ surface: 'api', attach: false, events: true });
  });

  it('rejects unknown backends', () => {
    expect(() => debugProbe('nope', { tmux: noTmux })).toThrow(/unknown backend/);
  });
});

describe('handoff / abort', () => {
  it('handoff keeps the session and preserves state', () => {
    const s = resolveSession({ ...loc, lane: 'opencode' }, store);
    const moved = handoffSession(s.id, 'cline', store);
    expect(moved.lane).toBe('cline');
    expect(moved.laneHistory).toEqual(['opencode', 'cline']);
    expect(moved.workspace).toBe(loc.workspace);
  });

  it('handoff rejects unknown backends and sessions', () => {
    const s = resolveSession(loc, store);
    expect(() => handoffSession(s.id, 'nope', store)).toThrow(/unknown backend/);
    expect(handoffSession('x|y|z', 'grok', store)).toBeNull();
  });

  it('abort closes but preserves the transcript', () => {
    const s = resolveSession({ ...loc, lane: 'grok' }, store);
    const dead = abortSession(s.id, { transcriptRef: 'dispatch_BUG-9_grok.log' }, store);
    expect(dead.state).toBe('aborted');
    expect(dead.transcriptRef).toBe('dispatch_BUG-9_grok.log');
    expect(dead.lane).toBe('grok');
    expect(getSession(s.id, store)).not.toBeNull();
  });
});

describe('private observer log', () => {
  it('writes sanitized full activity and uses a hashed private path', () => {
    const root = path.join(os.tmpdir(), `observer_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const session = resolveSession(loc, store);
    const observer = createObserver(session, { root, now: () => '2026-09-24T00:00:00.000Z' });
    expect(path.basename(observer.path)).not.toContain(session.id);
    expect(path.dirname(observer.path)).toBe(root);
    observer.onEvent({ kind: 'reasoning', text: 'private reasoning' });
    observer.onEvent({ kind: 'tool', tool: 'read', status: 'completed', input: { path: 'src/index.ts', apiKey: 'do-not-log' }, output: 'file contents' });
    observer.onEvent({ kind: 'step_finish', tokens: { total: 42, input: 'do-not-log' }, cost: 0.01 });
    observer.onEvent({ kind: 'text', text: 'final answer' });
    observer.onEvent({ kind: 'error', message: 'provider error' });
    const content = fs.readFileSync(observer.path, 'utf8');
    const records = content.trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'thinking', content: 'private reasoning' }),
      expect.objectContaining({ kind: 'tool', tool: 'read', content: expect.stringContaining('src/index.ts') }),
      expect.objectContaining({ kind: 'text', content: 'final answer' }),
      expect.objectContaining({ kind: 'error', content: 'provider error' }),
    ]));
    expect(content).toContain('"tokens":42');
    expect(content).not.toContain('do-not-log');
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(observer.path).mode & 0o777).toBe(0o600);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rotates a bounded append-only log', () => {
    const root = path.join(os.tmpdir(), `observer_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const logPath = path.join(root, 'events.log');
    for (let i = 0; i < 5; i += 1) {
      writeObserverRecord(logPath, formatObserverRecord('run_start', {}, { model: 'm1' }, `t${i}`), 80);
    }
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.statSync(logPath).size).toBeLessThanOrEqual(80);
    expect(fs.statSync(`${logPath}.1`).size).toBeLessThanOrEqual(80);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('secret scrubbing', () => {
  it('redacts token/key/secret assignments and bot-token shapes', () => {
    const out = scrubSecrets('a OPENCODE_BOT_TOKEN=abc b 123456:AAEc-def_ghi-jklmnopQRSTUV c');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('123456:');
    expect(out).toContain('[redacted]');
  });

  it('keeps the Telegram status view leak-free', () => {
    const s = resolveSession({ ...loc, lane: 'gemini' }, store);
    const view = statusForTelegram(s.id, { tmux: noTmux }, store);
    expect(view.id).toBe(s.id);
    expect(JSON.stringify(view)).not.toMatch(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/);
  });

  it('sessionStatus carries the probe', () => {
    const s = resolveSession({ ...loc, lane: 'human' }, store);
    expect(sessionStatus(s.id, { tmux: noTmux }, store).probe.surface).toBe('api');
  });
});
