import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compressReasoning, cleanReasoning } from '../scripts/lib/reasoning-compress.mjs';
import { Throttle } from '../scripts/lib/tg-throttle.mjs';
import { mapOpencodeEvent, buildOpencodeArgs } from '../scripts/lib/agent-opencode.mjs';
import { clamp, MAX_MESSAGE_CHARS } from '../scripts/lib/tg-api.mjs';
import { loadRegistry, getBot, resolveToken } from '../scripts/lib/registry.mjs';

describe('reasoning-compress', () => {
  it('strips code fences and markdown noise', () => {
    const cleaned = cleanReasoning('Look at ```ts\nconst x = 1\n``` and `y` *here*');
    expect(cleaned).not.toContain('```');
    expect(cleaned).not.toContain('`');
    expect(cleaned).toContain('Look at');
  });

  it('keeps the lead sentence and decision lines within the cap', () => {
    const trace = [
      'The user reports a meal calc bug.',
      'Some unrelated background about the history of the file that is long and not useful.',
      'I should check server_food_catalog.ts because the source union is wrong.',
      'Then I will patch the type and run tsc.',
    ].join(' ');
    const out = compressReasoning(trace, { maxChars: 220 });
    expect(out.startsWith('The user reports a meal calc bug.')).toBe(true);
    expect(out).toContain('I should check');
    expect(out.length).toBeLessThanOrEqual(220);
  });

  it('never exceeds maxChars even without sentence boundaries', () => {
    const out = compressReasoning('x'.repeat(500), { maxChars: 50 });
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('...')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(compressReasoning('')).toBe('');
    expect(compressReasoning(null)).toBe('');
  });
});

describe('tg-throttle', () => {
  const fakeClock = () => {
    let t = 0;
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    };
    return { now: () => t, sleep, sleeps };
  };

  it('does not delay the first submit but spaces the second', async () => {
    const clock = fakeClock();
    const throttle = new Throttle({ minIntervalMs: 2500, now: clock.now, sleep: clock.sleep });
    await throttle.submit(async () => 'a');
    await throttle.submit(async () => 'b');
    expect(clock.sleeps).toEqual([2500]);
  });

  it('defers submits until retry_after elapses', async () => {
    const clock = fakeClock();
    const throttle = new Throttle({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    throttle.pause(30);
    await throttle.submit(async () => 'x');
    expect(clock.sleeps).toEqual([30000]);
  });
});

describe('agent-opencode event mapping', () => {
  it('maps reasoning and text parts', () => {
    expect(mapOpencodeEvent({ type: 'reasoning', part: { text: 'thinking' } })).toEqual({
      kind: 'reasoning',
      text: 'thinking',
    });
    expect(mapOpencodeEvent({ type: 'text', part: { text: 'answer' } })).toEqual({
      kind: 'text',
      text: 'answer',
    });
  });

  it('maps tool, step_finish and error', () => {
    expect(
      mapOpencodeEvent({ type: 'tool', part: { tool: 'bash', state: { status: 'completed' } } }),
    ).toMatchObject({ kind: 'tool', tool: 'bash', status: 'completed' });
    expect(mapOpencodeEvent({ type: 'step_finish', part: { cost: 0.01 } })).toMatchObject({
      kind: 'step_finish',
    });
    expect(
      mapOpencodeEvent({ type: 'error', error: { data: { message: 'boom' } } }),
    ).toMatchObject({ kind: 'error', message: 'boom' });
    expect(mapOpencodeEvent(null)).toBeNull();
  });

  it('builds args with thinking, variant and model, prompt last', () => {
    const args = buildOpencodeArgs({
      prompt: 'fix it',
      model: 'opencode-go/deepseek-v4.1-flash',
      variant: 'high',
      thinking: true,
      extraArgs: ['--session', 'ses_1'],
    });
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--thinking',
      '--variant',
      'high',
      '-m',
      'opencode-go/deepseek-v4.1-flash',
      '--session',
      'ses_1',
      'fix it',
    ]);
  });
});

describe('tg-api clamp', () => {
  it('truncates to the Telegram limit', () => {
    const out = clamp('y'.repeat(MAX_MESSAGE_CHARS + 100));
    expect(out.length).toBe(MAX_MESSAGE_CHARS);
    expect(out.endsWith('...')).toBe(true);
    expect(clamp('short')).toBe('short');
  });
});

describe('registry', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bot-registry-'));
  const file = path.join(tmp, 'registry.json');

  it('loads multiple bots and resolves by id', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        bots: [
          { id: 'opencode', enabled: true, telegram: { tokenEnv: 'A' }, agent: { kind: 'opencode' } },
          { id: 'second', enabled: true, telegram: { tokenEnv: 'B' }, agent: { kind: 'opencode' } },
        ],
      }),
    );
    const registry = loadRegistry(file);
    expect(registry.bots).toHaveLength(2);
    expect(getBot(registry, 'second').id).toBe('second');
    expect(getBot(registry).id).toBe('opencode');
  });

  it('rejects duplicate ids', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        bots: [
          { id: 'dup', telegram: { tokenEnv: 'A' }, agent: { kind: 'opencode' } },
          { id: 'dup', telegram: { tokenEnv: 'B' }, agent: { kind: 'opencode' } },
        ],
      }),
    );
    expect(() => loadRegistry(file)).toThrow(/Duplicate/);
  });

  it('reports a missing token clearly', () => {
    const bot = { id: 'opencode', telegram: { tokenEnv: 'MISSING_TOKEN_ENV' } };
    expect(() => resolveToken(bot, {})).toThrow(/MISSING_TOKEN_ENV/);
    expect(resolveToken(bot, { MISSING_TOKEN_ENV: 'abc' })).toBe('abc');
  });
});
