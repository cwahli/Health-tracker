import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  observerDigest,
  observerFileName,
  rowForObserverFile,
  collectActivity,
  readActivityInputs,
} from './activity-hub.mjs';
import { observerLogPath } from './work-session.mjs';

describe('activity-hub observer identity', () => {
  it('digest matches work-session observerLogPath for real row shapes', () => {
    // createObserver(workSession) is called with the store row, whose .id is
    // `chat|project` — the digest input must be exactly that string.
    const rows = [
      { id: '6218257274|health-tracker', chat: '6218257274' },
      { id: '1|external-health', chat: '1', workspace: '/x' },
    ];
    for (const row of rows) {
      expect(observerLogPath(row).split('/').pop()).toBe(observerFileName(row.id));
    }
  });

  it('file names map back to row ids, rotation included, junk rejected', () => {
    const id = '6218257274|health-tracker';
    const idx = new Map([[observerDigest(id), id]]);
    expect(rowForObserverFile('session-deadbeef.log', idx)).toBe(null);
    expect(rowForObserverFile(observerFileName(id), idx)).toBe(id);
    expect(rowForObserverFile(`${observerFileName(id)}.1`, idx)).toBe(id);
    expect(rowForObserverFile('sessions.json', idx)).toBe(null);
    expect(rowForObserverFile(observerFileName('other|row'), idx)).toBe(null);
  });
});

describe('readActivityInputs', () => {
  let home = '';
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
    fs.mkdirSync(path.join(home, '.hermes', 'work-observers'), { recursive: true });
    fs.mkdirSync(path.join(home, '.local', 'state', 'bot-host', 'vm'), { recursive: true });
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('empty home degrades to empty inputs, never throws', () => {
    const inp = readActivityInputs({ home });
    expect(inp.workRows).toEqual([]);
    expect(collectActivity(inp)).toEqual([]);
  });

  it('joins work rows, bindings, leases, holds, and observer tails', () => {
    const rowId = '42|health-tracker';
    fs.writeFileSync(
      path.join(home, '.hermes', 'work-sessions.json'),
      JSON.stringify({ sessions: { [rowId]: { id: rowId, chat: '42', workspace: '/w', lane: 'opencode', location: 'vps', tx: true, viewMode: 'observer' } } }),
    );
    fs.writeFileSync(
      path.join(home, '.local', 'state', 'bot-host', 'vm', 'sessions.json'),
      JSON.stringify({ 42: `/w\u0000ses_abc0000001` }),
    );
    fs.writeFileSync(
      path.join(home, '.local', 'state', 'bot-host', 'vm', 'leases.json'),
      JSON.stringify({ 42: { chatId: '42', startedAt: 8000 } }),
    );
    fs.writeFileSync(
      path.join(home, '.hermes', 'location_state.json'),
      JSON.stringify({ 43: { requested: 'grok', reason: 'silent', since: 'x' } }),
    );
    fs.writeFileSync(
      path.join(home, '.hermes', 'work-observers', observerFileName(rowId)),
      `${JSON.stringify({ type: 'run_start', at: 't' })}\nnot json\n${JSON.stringify({ type: 'event', at: 't2' })}\n`,
    );
    const rows = collectActivity({ ...readActivityInputs({ home }), now: 9000 });
    expect(rows.map((r) => [r.chat, r.state])).toEqual([['42', 'working']]);
    expect(rows[0].elapsedMs).toBe(1000);
    expect(rows[0].sessionId8).toBe('ses_abc00000');
    expect(rows[0].bots).toEqual(['vm']);
    expect(rows[0].lastEvent).toBe('event');
  });
});

describe('collectActivity', () => {
  const workRows = [
    { id: 'w|health-tracker', chat: 'w', workspace: '/w', lane: 'opencode', location: 'vps', tx: true, viewMode: 'observer', opencodeSessionId: 'ses_w0000000001' },
    { id: 'h|health-tracker', chat: 'h', workspace: '/w', lane: 'cline', location: 'grok', tx: false, viewMode: 'observer' },
    { id: 'i|external-health', chat: 'i', workspace: '/e', lane: 'opencode', location: 'vps', tx: false, viewMode: 'observer' },
  ];
  const bindings = new Map([['w', { workspace: '/w', sessionId: 'ses_bound0000001', bots: ['vm'] }]]);
  const files = new Map([
    [observerDigest('w|health-tracker'), { mtimeMs: 1000, lastEvent: 'run_start' }],
    [observerDigest('i|external-health'), { mtimeMs: 2000, lastEvent: 'run_complete' }],
  ]);

  it('working beats held beats idle; binding wins the session id', () => {
    const rows = collectActivity({
      workRows,
      bindings,
      leases: new Map([['w', { startedAt: 500, bots: ['vm', 'vm2'] }]]),
      blocked: new Map([['h', { requested: 'grok', reason: 'silent' }]]),
      observerFiles: files,
      now: 1500,
    });
    expect(rows.map((r) => [r.chat, r.state])).toEqual([
      ['w', 'working'],
      ['h', 'held'],
      ['i', 'idle'],
    ]);
    const [w, h, i] = rows;
    expect(w.elapsedMs).toBe(1000);
    expect(w.lastEvent).toBe('run_start');
    expect(w.sessionId8).toBe('ses_bound000');
    expect(w.bots).toEqual(['vm', 'vm2']);
    expect(h.bots).toEqual([]);
    expect(w.tx).toBe(true);
    expect(h.host).toBe('grok');
    expect(i.lastEventAt).toBe(2000);
    expect(i.sessionId8).toBe('');
  });

  it('missing sources degrade to unknown, never throw', () => {
    const rows = collectActivity({ workRows: [{ id: 'x|p' }] });
    expect(rows).toEqual([
      {
        chat: 'x', project: 'p', sessionId8: '', bots: [], workspace: '', lane: '',
        host: '', tx: false, viewMode: '', state: 'idle', elapsedMs: null,
        lastEventAt: null, lastEvent: null,
      },
    ]);
    expect(collectActivity()).toEqual([]);
    expect(collectActivity({ workRows: [{}] })).toEqual([]);
  });
});
