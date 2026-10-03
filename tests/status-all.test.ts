import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  fleetChatStatus,
  formatFleetStatusTable,
  FLEET_CHAT_RUNTIMES,
} from '../scripts/lib/fleet-status.mjs';

const SEP = '\u0000';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function botState(home, id, files) {
  for (const [name, value] of Object.entries(files)) {
    writeJson(path.join(home, '.local', 'state', 'bot-host', id, name), value);
  }
}

describe('fleetChatStatus', () => {
  let root = '';
  let home = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-root-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-home-'));
    writeJson(path.join(root, 'bots', 'registry.json'), {
      master: 'vm',
      bots: [
        { id: 'vm', name: 'VM Bot', runtime: 'bot-host', enabled: true, agent: { model: 'm-vm', defaultAgent: 'build' } },
        { id: 'vm2', name: 'VM2', runtime: 'bot-host', enabled: true, extends: 'vm' },
        { id: 'mobile', name: 'Mobile', runtime: 'device', enabled: true, agent: { model: 'm-mob', defaultAgent: 'plan' } },
        { id: 'old', name: 'Old', runtime: 'bot-host', enabled: false, agent: { model: 'm-old', defaultAgent: 'build' } },
        { id: 'hermes', name: 'Hermes', runtime: 'hermes', enabled: true },
      ],
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('lists bot-host/device bots, marks disabled off, excludes other runtimes', () => {
    const rows = fleetChatStatus({ chatId: '7', workspace: 'ws', root, home });
    expect(rows.map((r) => r.id).sort()).toEqual(['mobile', 'old', 'vm', 'vm2']);
    expect(rows.find((r) => r.id === 'old')?.task).toBe('off');
    expect(rows.find((r) => r.id === 'vm2')?.model).toBe('m-vm');
  });

  it('pref overrides win over registry defaults', () => {
    botState(home, 'vm', { 'prefs.json': { 7: { model: 'm-chat', agent: 'plan' } } });
    const rows = fleetChatStatus({ chatId: 7, workspace: 'ws', root, home });
    expect(rows.find((r) => r.id === 'vm')).toMatchObject({ model: 'm-chat', agent: 'plan' });
    expect(rows.find((r) => r.id === 'mobile')).toMatchObject({ model: 'm-mob', agent: 'plan' });
  });

  it('scopes sessions to the workspace like /status does', () => {
    botState(home, 'vm', { 'sessions.json': { 7: `ws${SEP}ses-match` } });
    botState(home, 'vm2', { 'sessions.json': { 7: `other${SEP}ses-foreign` } });
    botState(home, 'mobile', { 'sessions.json': { 7: 'bare-legacy-id' } });
    const rows = fleetChatStatus({ chatId: '7', workspace: 'ws', root, home });
    expect(rows.find((r) => r.id === 'vm')?.sessionId).toBe('ses-match');
    expect(rows.find((r) => r.id === 'vm2')).toMatchObject({ sessionId: null, foreignSession: true });
    expect(rows.find((r) => r.id === 'mobile')?.sessionId).toBeNull();
  });

  it('reads working state from this chat’s lease entry only', () => {
    botState(home, 'vm', { 'leases.json': { 7: { chatId: 7, startedAt: Date.now() } } });
    botState(home, 'vm2', { 'leases.json': { 9: { chatId: 9, startedAt: Date.now() } } });
    const rows = fleetChatStatus({ chatId: '7', workspace: 'ws', root, home });
    expect(rows.find((r) => r.id === 'vm')?.task).toBe('working');
    expect(rows.find((r) => r.id === 'vm2')?.task).toBe('idle');
  });

  it('passes chat totals through, null when zero', () => {
    botState(home, 'vm', { 'totals.json': { 7: { runs: 2, tokens: 1500, cost: 0.01234 } } });
    const rows = fleetChatStatus({ chatId: '7', workspace: 'ws', root, home });
    expect(rows.find((r) => r.id === 'vm')?.totals).toEqual({ runs: 2, tokens: 1500, cost: 0.01234 });
    expect(rows.find((r) => r.id === 'vm2')?.totals).toBeNull();
  });

  it('returns [] without a registry or chat id', () => {
    expect(fleetChatStatus({ chatId: '7', workspace: 'ws', root: '/nonexistent', home })).toEqual([]);
    expect(fleetChatStatus({ chatId: '', workspace: 'ws', root, home })).toEqual([]);
  });

  it('covers the chat-capable runtimes', () => {
    expect([...FLEET_CHAT_RUNTIMES].sort()).toEqual(['bot-host', 'device']);
  });
});

describe('formatFleetStatusTable', () => {
  it('renders one line per bot with the answering bot named', () => {
    const text = formatFleetStatusTable(
      [
        { id: 'vm', name: 'VM Bot', enabled: true, model: 'm', agent: 'build', sessionId: 'ses_123456789012345', foreignSession: false, totals: { runs: 2, tokens: 1500, cost: 0 }, task: 'working' },
        { id: 'vm2', name: 'VM2', enabled: true, model: null, agent: null, sessionId: null, foreignSession: true, totals: null, task: 'idle' },
        { id: 'old', name: 'Old', enabled: false, model: null, agent: null, sessionId: null, foreignSession: false, totals: null, task: 'off' },
      ],
      { chatId: '7', via: 'vm' },
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('Fleet status · chat 7 · 3 bots (via vm)');
    expect(lines[1]).toContain('VM Bot (vm)');
    expect(lines[1]).toContain('task: working');
    expect(lines[1]).toContain('2 runs · 1.5k');
    expect(lines[1]).toContain('ses_12345678');
    expect(lines[2]).toContain('session: other project');
    expect(lines[3]).toBe('• Old (old) — off');
  });

  it('renders a header for an empty fleet', () => {
    expect(formatFleetStatusTable([], { chatId: '7' })).toBe('Fleet status · chat 7 · 0 bots');
  });
});
