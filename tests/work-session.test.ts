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
  debugProbe,
  sessionStatus,
  scrubSecrets,
  statusForTelegram,
} from '../scripts/lib/work-session.mjs';

let store;
const noTmux = () => false;
const yesTmux = () => true;

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
