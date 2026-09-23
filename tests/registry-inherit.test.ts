import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadRegistry,
  getBot,
  resolveToken,
  normalizeConfig,
  applyMasterDefaults,
} from '../scripts/lib/registry.mjs';

describe('loadRegistry', () => {
  it('loads and applies master defaults for child bots', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        master: 'opencode',
        bots: [
          {
            id: 'opencode',
            name: 'Master',
            telegram: { tokenEnv: 'MASTER_TOKEN', allowedUserIds: [1] },
            agent: {
              kind: 'opencode',
              model: 'model-a',
              workspace: '/ws',
              sharedSkills: ['a', 'b'],
              allowExternalDirectory: true,
            },
            progress: { mode: 'concise', maxEdits: 40 },
            session: { mode: 'per-chat' },
          },
          {
            id: 'child',
            telegram: { tokenEnv: 'CHILD_TOKEN' },
            agent: { playwrightOutputDir: '/tmp/child-shots' },
          },
        ],
      }),
    );
    const reg = loadRegistry(file);
    const child = getBot(reg, 'child');
    expect(child.telegram.tokenEnv).toBe('CHILD_TOKEN');
    expect(child.telegram.allowedUserIds).toEqual([1]);
    expect(child.agent.kind).toBe('opencode');
    expect(child.agent.model).toBe('model-a');
    expect(child.agent.sharedSkills).toEqual(['a', 'b']);
    expect(child.agent.workspace).toBe('/ws');
    expect(child.agent.allowExternalDirectory).toBe(true);
    expect(child.agent.playwrightOutputDir).toBe('/tmp/child-shots');
    expect(child.progress.mode).toBe('concise');
    expect(child.session.mode).toBe('per-chat');
    expect(child.name).toBe('Master');
  });

  it('lets child override nested master fields', () => {
    const reg = applyMasterDefaults({
      master: 'opencode',
      bots: [
        {
          id: 'opencode',
          telegram: { tokenEnv: 'T1', allowedUserIds: [1] },
          agent: { kind: 'opencode', model: 'm1', sharedSkills: ['a'] },
        },
        {
          id: 'child',
          name: 'Child',
          telegram: { tokenEnv: 'T2', allowedUserIds: [2] },
          agent: { model: 'm2', sharedSkills: ['z'] },
        },
      ],
    });
    const child = getBot(reg, 'child');
    expect(child.name).toBe('Child');
    expect(child.agent.model).toBe('m2');
    expect(child.agent.sharedSkills).toEqual(['z']);
    expect(child.telegram.allowedUserIds).toEqual([2]);
    expect(child.agent.kind).toBe('opencode');
  });

  it('lets child clear inherited scalar fields with null', () => {
    const reg = applyMasterDefaults({
      master: 'opencode',
      bots: [
        {
          id: 'opencode',
          telegram: { tokenEnv: 'T1', allowedUserIds: [1] },
          agent: { kind: 'opencode', model: 'm1', variant: 'high', playwrightOutputDir: '/tmp/shots' },
        },
        {
          id: 'child',
          telegram: { tokenEnv: 'T2' },
          agent: { model: 'm2', variant: null, playwrightOutputDir: null },
        },
      ],
    });
    const child = getBot(reg, 'child');
    expect(child.agent.model).toBe('m2');
    expect(child.agent.variant).toBeNull();
    expect(child.agent.playwrightOutputDir).toBeNull();
    const cfg = normalizeConfig(child, { defaultWorkspace: '/ws' });
    expect(cfg.agent.variant).toBeNull();
    expect(cfg.agent.playwrightOutputDir).toBe('');
  });

  it('appends child agent.skills to inherited sharedSkills', () => {
    const reg = applyMasterDefaults({
      master: 'opencode',
      bots: [
        {
          id: 'opencode',
          telegram: { tokenEnv: 'T1' },
          agent: { kind: 'opencode', sharedSkills: ['a', 'b'] },
        },
        {
          id: 'child',
          telegram: { tokenEnv: 'T2' },
          agent: { skills: ['c'] },
        },
      ],
    });
    expect(getBot(reg, 'child').agent.sharedSkills).toEqual(['a', 'b', 'c']);
    // master untouched
    expect(getBot(reg, 'opencode').agent.sharedSkills).toEqual(['a', 'b']);
  });

  it('requires tokenEnv on every bot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        bots: [
          { id: 'opencode', telegram: { tokenEnv: 'T' }, agent: { kind: 'opencode' } },
          { id: 'child' },
        ],
      }),
    );
    expect(() => loadRegistry(file)).toThrow(/tokenEnv/);
  });

  it('rejects unknown extends', () => {
    expect(() =>
      applyMasterDefaults({
        master: 'opencode',
        bots: [
          { id: 'opencode', telegram: { tokenEnv: 'T' }, agent: { kind: 'opencode' } },
          { id: 'child', extends: 'nope', telegram: { tokenEnv: 'T2' } },
        ],
      }),
    ).toThrow(/unknown bot/);
  });

  it('keeps first bot as default getBot target', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        bots: [
          { id: 'opencode', telegram: { tokenEnv: 'T1' }, agent: { kind: 'opencode' } },
          { id: 'second', telegram: { tokenEnv: 'T2' }, agent: { kind: 'opencode' } },
        ],
      }),
    );
    const registry = loadRegistry(file);
    expect(getBot(registry, 'second').id).toBe('second');
    expect(getBot(registry).id).toBe('opencode');
  });
});

describe('resolveToken / normalizeConfig', () => {
  it('resolveToken throws MISSING_TOKEN_ENV', () => {
    const bot = { id: 'x', telegram: { tokenEnv: 'MISSING_TOKEN_ENV' } };
    expect(() => resolveToken(bot, {})).toThrow(/MISSING_TOKEN_ENV/);
    expect(resolveToken(bot, { MISSING_TOKEN_ENV: 'abc' })).toBe('abc');
  });

  it('normalizeConfig preserves settings', () => {
    const cfg = normalizeConfig(
      {
        id: 'opencode',
        telegram: { tokenEnv: 'T', allowedUserIds: ['1'] },
        agent: {
          kind: 'opencode',
          workspace: '/ws',
          allowExternalDirectory: true,
          sharedSkills: ['.agents/skills'],
          playwrightOutputDir: '/tmp/shots',
        },
      },
      { defaultWorkspace: '/default' },
    );
    expect(cfg.agent.allowExternalDirectory).toBe(true);
    expect(cfg.agent.sharedSkills).toEqual(['.agents/skills']);
    expect(cfg.agent.playwrightOutputDir).toBe('/tmp/shots');
    expect(cfg.telegram.allowedUserIds).toEqual([1]);
  });
});

describe("one poller per token", () => {
  it("loadRegistry rejects duplicate tokenEnv values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
    const file = path.join(dir, "registry.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        master: "opencode",
        bots: [
          { id: "opencode", telegram: { tokenEnv: "SAME" }, agent: { kind: "opencode" } },
          { id: "dup", telegram: { tokenEnv: "SAME" }, agent: { kind: "opencode" } },
        ],
      }),
    );
    expect(() => loadRegistry(file)).toThrow(/Duplicate tokenEnv/);
  });
});

describe("runtime isolation", () => {
  const mixed = () =>
    applyMasterDefaults({
      master: "vm",
      bots: [
        {
          id: "vm",
          runtime: "bot-host",
          telegram: { tokenEnv: "VM", allowedUserIds: [1] },
          agent: { kind: "opencode", model: "m1", sharedSkills: ["a"] },
        },
        {
          id: "h",
          runtime: "hermes",
          telegram: { tokenEnv: "H" },
          agent: { kind: "hermes" },
          hermes: { profile: "qa_meal" },
        },
      ],
    });

  it("does not merge bot-host master defaults into a hermes bot", () => {
    const h = mixed().bots.find((b) => b.id === "h");
    expect(h.agent.kind).toBe("hermes");
    expect(h.agent.model).toBeUndefined();
    expect(h.agent.sharedSkills).toBeUndefined();
    expect(h.telegram.allowedUserIds).toBeUndefined();
  });

  it("getBot never returns a hermes-runtime bot", () => {
    const reg = applyMasterDefaults({
      master: "vm",
      bots: [
        { id: "vm", runtime: "bot-host", telegram: { tokenEnv: "VM" }, agent: { kind: "opencode" } },
        {
          id: "h",
          runtime: "hermes",
          enabled: true,
          telegram: { tokenEnv: "H" },
          agent: { kind: "hermes" },
        },
      ],
    });
    expect(() => getBot(reg, "h")).toThrow(/not found|not enabled/);
    expect(getBot(reg).id).toBe("vm");
  });

  it("normalizeConfig exposes runtime and hermes metadata", () => {
    const h = mixed().bots.find((b) => b.id === "h");
    const cfg = normalizeConfig(h);
    expect(cfg.runtime).toBe("hermes");
    expect(cfg.hermes).toEqual({ profile: "qa_meal" });
  });
});
