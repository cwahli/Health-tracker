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
  debugProbe,
  sessionStatus,
  scrubSecrets,
  statusForTelegram,
} from '../scripts/lib/work-session.mjs';

let store;
const noTmux = () => false;
const yesTmux = () => true;

function fakeTmux(initial = {}) {
  const sessions = new Map(Object.entries(initial).map(([name, windows]) => [name, new Set(windows)]));
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'has-session') return sessions.has(args[2]);
    if (args[0] === 'list-windows') {
      return [...(sessions.get(args[2]) || [])].join('\n');
    }
    if (args[0] === 'new-session') {
      sessions.set(args[3], new Set([args[5]]));
      return true;
    }
    if (args[0] === 'new-window') {
      const session = args[3].replace(/:$/, '');
      const windows = sessions.get(session) || new Set();
      windows.add(args[5]);
      sessions.set(session, windows);
      return true;
    }
    return false;
  };
  return { calls, run, sessions };
}

beforeEach(() => {
  store = path.join(os.tmpdir(), `ws_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
});

const loc = { location: 'vps', chat: 'qa_meal', workspace: '/home/ubuntu/src/Health-tracker' };

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
  it('creates a session and workstream window once', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const tmux = fakeTmux();
    const first = ensureTmuxWorkView(session, { tmux: tmux.run });
    const count = tmux.calls.length;
    const second = ensureTmuxWorkView(session, { tmux: tmux.run });

    expect(first).toMatchObject({ ok: true, created: true, surface: 'terminal', tmuxSession: 'work-vps' });
    expect(first.target).toBe(`work-vps:${tmuxWindowFor(session.id)}`);
    expect(tmux.calls).toContainEqual(['new-session', '-d', '-s', 'work-vps', '-n', tmuxWindowFor(session.id), '-c', session.workspace]);
    expect(second).toMatchObject({ ok: true, created: false });
    expect(tmux.calls).toHaveLength(count + 2);
  });

  it('adds only a missing window to an existing session', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const tmux = fakeTmux({ 'work-vps': ['other'] });
    const result = ensureTmuxWorkView(session, { tmux: tmux.run });
    expect(result.ok).toBe(true);
    expect(tmux.calls.map((args) => args[0])).toEqual(['has-session', 'list-windows', 'new-window', 'list-windows']);
    expect(tmux.sessions.get('work-vps')).toEqual(new Set(['other', tmuxWindowFor(session.id)]));
  });

  it('reuses an existing workstream without creating or killing anything', () => {
    const session = resolveSession({ ...loc, lane: 'opencode' }, store);
    const window = tmuxWindowFor(session.id);
    const tmux = fakeTmux({ 'work-vps': [window] });
    const result = ensureTmuxWorkView(session, { tmux: tmux.run });
    expect(result).toMatchObject({ ok: true, created: false });
    expect(tmux.calls.map((args) => args[0])).toEqual(['has-session', 'list-windows']);
    expect(tmux.calls.flat().some((arg) => /kill|respawn|send-keys/.test(String(arg)))).toBe(false);
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

  it('terminal lanes attach via tmux when present', () => {
    const s = resolveSession(loc, store);
    const p = debugProbe('opencode', { session: s, tmux: yesTmux });
    expect(p).toMatchObject({ surface: 'terminal', attach: true, tmuxSession: 'work-vps' });
    expect(p.target).toBe(`work-vps:${tmuxWindowFor(s.id)}`);
  });

  it('API lanes never claim attach', () => {
    const s = resolveSession(loc, store);
    const p = debugProbe('gemini', { session: s, tmux: yesTmux });
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
