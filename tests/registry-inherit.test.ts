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
  it("registry tokenEnv values are unique", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
    const file = path.join(dir, "registry.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        master: "opencode",
        bots: [
          { id: "opencode", telegram: { tokenEnv: "SAME" }, agent: { kind: "opencode" } },
          { id: "dup", telegram: { tokenEnv: "SAME" } },
        ],
      }),
    );
    const reg = loadRegistry(file);
    const envs = reg.bots.map((b) => b.telegram.tokenEnv);
    expect(new Set(envs).size).toBe(envs.length);
  });
});
\n