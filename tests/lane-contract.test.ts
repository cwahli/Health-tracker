import { describe, it, expect } from 'vitest';
import {
  ROLES,
  LANES,
  laneFor,
  isDegraded,
  canFill,
  checkBotRow,
  checkRegistry,
} from '../scripts/lib/lane-contract.mjs';

describe('laneFor', () => {
  it('describes every dispatch backend', () => {
    for (const backend of ['opencode', 'cline', 'grok', 'agy', 'gemini', 'freebuff', 'human']) {
      expect(laneFor(backend).backend).toBe(backend);
    }
  });

  it('throws on unknown backend', () => {
    expect(() => laneFor('nope')).toThrow(/unknown backend/);
    expect(() => isDegraded('nope', 'resume')).toThrow(/unknown backend/);
  });
});

describe('degraded markings', () => {
  it('marks cline degraded for resume only', () => {
    expect(isDegraded('cline', 'resume')).toBe(true);
    expect(isDegraded('cline', 'tools')).toBe(false);
  });

  it('marks gemini API-only with no tools or session', () => {
    const gemini = laneFor('gemini');
    expect(gemini.apiOnly).toBe(true);
    expect(gemini.tools).toBe(false);
    expect(gemini.session).toBe(false);
  });

  it('marks freebuff API-only with no tools or session', () => {
    const freebuff = laneFor('freebuff');
    expect(freebuff.apiOnly).toBe(true);
    expect(freebuff.tools).toBe(false);
    expect(freebuff.session).toBe(false);
  });

  it('keeps opencode and human clean', () => {
    expect(LANES.opencode.degraded).toEqual([]);
    expect(LANES.human.degraded).toEqual([]);
  });
});

describe('roles', () => {
  it('locks the role vocabulary', () => {
    expect(ROLES).toEqual(['specify', 'implement', 'verify']);
  });

  it('lets any backend fill any role', () => {
    for (const backend of Object.keys(LANES)) {
      for (const role of ROLES) {
        expect(canFill(backend, role)).toBe(true);
      }
    }
  });
});

describe('checkBotRow / checkRegistry', () => {
  it('accepts place ids on surface runtimes', () => {
    expect(checkBotRow({ id: 'vm', runtime: 'bot-host' })).toEqual([]);
    expect(checkBotRow({ id: 'qa_meal' })).toEqual([]);
  });

  it('rejects agent, model, and process names as ids', () => {
    for (const id of ['dev', 'dispatch', 'coder', 'cline', 'gemini', 'agy', 'freebuff']) {
      expect(checkBotRow({ id, runtime: 'bot-host' }).length).toBeGreaterThan(0);
    }
  });

  it('rejects non-surface runtimes', () => {
    expect(checkBotRow({ id: 'vm', runtime: 'cli' }).length).toBeGreaterThan(0);
  });

  it('flags an id-less row once', () => {
    expect(checkRegistry({ bots: [{}] })).toEqual(['bot row has no id']);
  });

  it('passes the real registry', async () => {
    const { loadRegistry, resolveRegistryPath } = await import('../scripts/lib/registry.mjs');
    const path = await import('node:path');
    const repoRoot = path.resolve(__dirname, '..');
    const registry = loadRegistry(resolveRegistryPath(null, repoRoot));
    expect(checkRegistry(registry)).toEqual([]);
  });
});
