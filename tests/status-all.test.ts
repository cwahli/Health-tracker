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
  it('renders a narrow table when model+agent are uniform, off bots on one line', () => {
    const text = formatFleetStatusTable(
      [
        { id: 'vm', name: 'VM Bot', enabled: true, role: 'coordinator', model: 'm', agent: 'build', sessionId: 'ses_123456789012345', foreignSession: false, totals: { runs: 2, tokens: 1500, cost: 0 }, task: 'working' },
        { id: 'vm2', name: 'VM2', enabled: true, role: 'data_steward', model: 'm', agent: 'build', sessionId: null, foreignSession: true, totals: null, task: 'idle' },
        { id: 'old', name: 'Old', enabled: false, role: null, model: null, agent: null, sessionId: null, foreignSession: false, totals: null, task: 'off' },
      ],
      { chatId: '7', via: 'vm' },
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('Fleet status · chat 7 · 3 agents (via vm)');
    expect(lines[1]).toBe('all: m · build');
    expect(lines[2]).toBe('```');
    expect(lines[3]).toContain('Bot');
    expect(lines[3]).toContain('Role');
    expect(lines[3]).toContain('Session');
    const vm = lines.find((l) => l.startsWith('vm '));
    expect(vm).toContain('coordinator');
    expect(vm).toContain('working');
    expect(vm).toContain('2 runs·1.5k');
    expect(vm).toContain('ses_1234');
    expect(lines.find((l) => l.startsWith('vm2'))).toContain('data_steward');
    expect(lines.find((l) => l.startsWith('vm2'))).toContain('other-proj');
    expect(lines).toContain('```');
    expect(lines[lines.length - 1]).toBe('off: old');
    expect(text).not.toContain('•');
  });

  it('renders Model/Agent columns when bots differ', () => {
    const text = formatFleetStatusTable(
      [
        { id: 'vm', name: 'VM Bot', enabled: true, model: 'opencode/nemotron-free', agent: 'build', sessionId: null, foreignSession: false, totals: null, task: 'idle' },
        { id: 'mobile', name: 'Mobile', enabled: true, model: 'other/model', agent: 'plan', sessionId: null, foreignSession: false, totals: null, task: 'idle' },
      ],
      { chatId: '7' },
    );
    expect(text).toContain('Model');
    expect(text).toContain('opencode/nemotron…');
    expect(text).toContain('other/model');
    expect(text).not.toContain('all:');
  });

  it('renders a header for an empty fleet', () => {
    const text = formatFleetStatusTable([], { chatId: '7' });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Fleet status · chat 7 · 0 agents');
    expect(lines.filter((l) => l === '```').length).toBe(2);
  });
});

describe('fleetChatStatus council filter', () => {
  let root = '';
  let home = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-council-root-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-council-home-'));
    writeJson(path.join(root, 'bots', 'registry.json'), {
      master: 'vm',
      bots: [
        { id: 'vm', name: 'VM Bot', runtime: 'bot-host', enabled: true, agent: { model: 'm', defaultAgent: 'build' } },
        { id: 'vm2', name: 'VM2', runtime: 'bot-host', enabled: true, extends: 'vm', agent: { healthRole: 'data_steward' } },
        { id: 'vm3', name: 'VM3', runtime: 'bot-host', enabled: true, extends: 'vm' },
      ],
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const roleOf = (b) => String(b.agent?.healthRole || '');

  it('lists master plus seat holders only', () => {
    const rows = fleetChatStatus({ chatId: '7', workspace: 'ws', root, home, seats: ['data_steward'], roleOf });
    expect(rows.map((r) => r.id).sort()).toEqual(['vm', 'vm2']);
    expect(rows.find((r) => r.id === 'vm')?.role).toBe('coordinator');
    expect(rows.find((r) => r.id === 'vm2')?.role).toBe('data_steward');
  });

  it('lists everyone without a seat filter', () => {
    const rows = fleetChatStatus({ chatId: '7', workspace: 'ws', root, home });
    expect(rows.map((r) => r.id).sort()).toEqual(['vm', 'vm2', 'vm3']);
  });
});

describe('fleet-status-html', () => {
  const rows = [
    { id: 'vm', name: 'VM Bot', enabled: true, role: 'coordinator', model: 'opencode/nemotron-free', agent: 'build', sessionId: 'ses_abc', foreignSession: false, totals: { runs: 3, tokens: 12500, cost: 0 }, lastUsage: { tokens: 310000, contextLimit: 1000000 }, task: 'working' },
    { id: 'vm2', name: 'VM2', enabled: true, role: 'data_steward', model: 'cline:claude-free', agent: 'build', sessionId: null, foreignSession: false, totals: null, lastUsage: null, task: 'idle' },
    { id: 'old', name: 'Old', enabled: false, role: null, model: null, agent: null, sessionId: null, foreignSession: false, totals: null, lastUsage: null, task: 'off' },
  ];

  it('maps tool surface from the row model', async () => {
    const mod = await import('../scripts/lib/fleet-status-html.mjs');
    expect(mod.toolOf('opencode/nemotron-free')).toBe('opencode');
    expect(mod.toolOf('cline:claude-free')).toBe('cline');
    expect(mod.toolOf(null)).toBe('—');
  });

  it('renders session usage as tokens plus context share', async () => {
    const { usageCell } = await import('../scripts/lib/fleet-status.mjs');
    expect(usageCell(rows[0])).toBe('310k (31%)');
    expect(usageCell(rows[1])).toBe('—');
  });

  it('shows honest run counts when the lane reports no tokens', async () => {
    const { usageCell } = await import('../scripts/lib/fleet-status.mjs');
    const run = (totals) => ({ lastUsage: null, totals });
    expect(usageCell(run({ runs: 1, tokens: 0, cost: 0 }))).toBe('1 run');
    expect(usageCell(run({ runs: 3, tokens: 0, cost: 0 }))).toBe('3 runs');
    expect(usageCell(run({ runs: 2, tokens: 1500, cost: 0.01234 }))).toBe('2 runs·1.5k·$0.0123');
  });

  it('builds skill-pipeline data: positional rows matching the columns', async () => {
    const mod = await import('../scripts/lib/fleet-status-html.mjs');
    const model = mod.buildFleetStatusTableJson(rows, { title: 'T', subtitle: 'S' });
    expect(model.title).toBe('T');
    expect(model.preamble).toEqual(['S']);
    expect(model.tables).toHaveLength(1);
    expect(model.tables[0].columns).toEqual(['Agent', 'Role', 'Model', 'Tool', 'Session', 'Task', 'Usage']);
    for (const r of model.tables[0].rows) expect(r).toHaveLength(model.tables[0].columns.length);
    expect(model.tables[0].rows[0]).toEqual(['vm', 'coordinator', 'opencode/nemotron-free', 'opencode', 'ses_abc', 'working', '310k (31%)']);
    expect(model.notes.join('\n')).toContain('off: old');
  });

  it('writes the document through qa-evidence/build-table.py when present', async () => {
    const mod = await import('../scripts/lib/fleet-status-html.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-doc-'));
    try {
      const doc = mod.writeFleetStatusDoc(rows, { title: 'T', subtitle: 'S', dir });
      const html = fs.readFileSync(doc.htmlPath, 'utf8');
      for (const cell of ['Agent', 'Role', 'Model', 'Tool', 'Session', 'Task', 'Usage', 'vm', 'coordinator', 'opencode', 'cline', 'ses_abc', 'working', '310k (31%)', 'off: old']) {
        expect(html).toContain(cell);
      }
      if (doc.renderer === 'qa-evidence/build-table.py') {
        expect(html).toContain('st-table');
      } else {
        expect(doc.renderer).toBe('builtin-grid-fallback');
        expect(html).toContain('<table');
      }
      // The JSON the builder ate is kept beside the document for inspection.
      const kept = JSON.parse(fs.readFileSync(doc.jsonPath, 'utf8'));
      expect(kept.tables[0].rows).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the built-in grid when the builder is missing', async () => {
    const mod = await import('../scripts/lib/fleet-status-html.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-docfb-'));
    try {
      const doc = mod.writeFleetStatusDoc(rows, { title: 'T', subtitle: 'S', dir, buildTablePy: null });
      expect(doc.renderer).toBe('builtin-grid-fallback');
      const html = fs.readFileSync(doc.htmlPath, 'utf8');
      expect(html).toContain('310k (31%)');
      expect(html).toContain('<table');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps persisted last-run snapshots to rows', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-last-root-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-last-home-'));
    try {
      writeJson(path.join(root, 'bots', 'registry.json'), {
        master: 'vm',
        bots: [{ id: 'vm', runtime: 'bot-host', enabled: true, agent: { model: 'm', defaultAgent: 'build' } }],
      });
      const state = path.join(home, '.local', 'state', 'bot-host', 'vm');
      writeJson(path.join(state, 'totals.json'), {
        7: { runs: 2, tokens: 5000, cost: 0, last: { tokens: { total: 310000 }, cost: 0, contextLimit: 1000000, agent: 'build', at: 1 } },
      });
      const found = fleetChatStatus({ chatId: '7', workspace: 'ws', root, home }).find((r) => r.id === 'vm');
      expect(found?.lastUsage).toEqual({ tokens: 310000, contextLimit: 1000000 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('noteUsage last-run persistence', () => {
  it('stores the last snapshot beside cumulative totals', async () => {
    const prevHome = process.env.HOME;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-noteusage-'));
    process.env.HOME = fakeHome;
    const { noteUsage } = await import('../scripts/bot-host.mjs');
    try {
      const totals = new Map();
      const lastUsage = new Map();
      await noteUsage({
        chatId: '7',
        result: { usage: { tokens: { total: 310000 }, cost: 0 } },
        eff: { model: 'opencode/nemotron-free', agent: 'build' },
        config: { id: 'probe-bot' },
        caches: {},
        totals,
        lastUsage,
      });
      const saved = JSON.parse(
        fs.readFileSync(path.join(fakeHome, '.local', 'state', 'bot-host', 'probe-bot', 'totals.json'), 'utf8'),
      );
      expect(saved['7'].runs).toBe(1);
      expect(saved['7'].tokens).toBe(310000);
      expect(saved['7'].last.tokens).toEqual({ total: 310000 });
      expect(saved['7'].last.agent).toBe('build');
      expect(Number(saved['7'].last.at)).toBeGreaterThan(0);
    } finally {
      process.env.HOME = prevHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('runSeatModel usage passthrough', () => {
  it('returns the winning lane usage so the group path can record it', async () => {
    const { runSeatModel } = await import('../scripts/lib/health/seat-model.mjs');
    const res = await runSeatModel({
      prompt: 'hi',
      chatModel: 'm',
      botModel: 'm',
      models: ['m'],
      runOpencodeImpl: async () => ({ finalText: 'hello', lastError: '', usage: { cost: 0.001, tokens: { total: 310000 } } }),
    });
    expect(res.finalText).toBe('hello');
    expect(res.usage).toEqual({ cost: 0.001, tokens: { total: 310000 } });
  });

  it('yields null usage when the lane reports none', async () => {
    const { runSeatModel } = await import('../scripts/lib/health/seat-model.mjs');
    const res = await runSeatModel({
      prompt: 'hi',
      chatModel: 'm',
      botModel: 'm',
      models: ['m'],
      runOpencodeImpl: async () => ({ finalText: 'hello', lastError: '' }),
    });
    expect(res.usage).toBeNull();
  });
});

describe('noteUsage runs-only record', () => {
  it('keeps a runs-only turn with its snapshot instead of skipping it', async () => {
    const prevHome = process.env.HOME;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'status-all-noteusage-zero-'));
    process.env.HOME = fakeHome;
    const { noteUsage } = await import('../scripts/bot-host.mjs');
    try {
      // bot-host captures HOME at import, so assert the in-memory record
      // (the disk path is covered by the persistence test above).
      const totals = new Map();
      const lastUsage = new Map();
      await noteUsage({
        chatId: '9',
        result: { usage: { tokens: { total: 0 }, cost: 0 } },
        eff: { model: 'opencode/nemotron-free', agent: 'build' },
        config: { id: 'probe-zero' },
        caches: {},
        totals,
        lastUsage,
      });
      const kept = totals.get('9');
      expect(kept.runs).toBe(1);
      expect(kept.tokens).toBe(0);
      expect(Number(kept.last.at)).toBeGreaterThan(0);
    } finally {
      process.env.HOME = prevHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
