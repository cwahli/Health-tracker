import { describe, it, expect } from 'vitest';
import {
  buildCommandcodeArgs,
  describeCommandcodeExit,
  normalizeCommandcodeUsage,
  mapCommandcodeEvent,
} from '../scripts/lib/agent-commandcode.mjs';

describe('buildCommandcodeArgs', () => {
  it('passes --yolo in yolo mode, which is the only flag that lifts the headless block', () => {
    // `--permission-mode yolo` does NOT lift it in headless mode (docs/headless);
    // the lane is useless without the flag, so this pin is the user's request.
    expect(buildCommandcodeArgs({ prompt: 'hi' })).toContain('--yolo');
  });

  it('does not pass --yolo in any other mode', () => {
    expect(buildCommandcodeArgs({ prompt: 'hi', permissionMode: 'default' })).not.toContain('--yolo');
  });

  it('keeps the auto-update notice off stdout, and is a one-shot json run', () => {
    const args = buildCommandcodeArgs({ prompt: 'hi' });
    expect(args).toContain('--no-auto-update');
    expect(args).toEqual(expect.arrayContaining(['-p', 'hi', '--output-format', 'json']));
  });

  it('resumes by id and pins the model and effort', () => {
    const args = buildCommandcodeArgs({
      prompt: 'hi',
      sessionId: 'eff6f47a-923b-430f-b066-1e5c62ae5a0c',
      model: 'deepseek/deepseek-v4-flash',
      effort: 'high',
    });
    expect(args).toEqual(expect.arrayContaining([
      '--resume', 'eff6f47a-923b-430f-b066-1e5c62ae5a0c',
      '-m', 'deepseek/deepseek-v4-flash',
      '--effort', 'high',
    ]));
  });

  it('omits model, effort and resume when they are not given', () => {
    const args = buildCommandcodeArgs({ prompt: 'hi' });
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('-m');
    expect(args).not.toContain('--effort');
  });
});

describe('normalizeCommandcodeUsage', () => {
  it('sums input and output when the frame carries no total', () => {
    expect(normalizeCommandcodeUsage({ input_tokens: 10, output_tokens: 5 }).tokens).toEqual({ total: 15 });
  });

  it('is safe on a missing usage block', () => {
    expect(normalizeCommandcodeUsage(null)).toEqual({ cost: 0, tokens: null });
  });
});

describe('describeCommandcodeExit', () => {
  it('names auth and credits by exit code so the chat can act on it', () => {
    expect(describeCommandcodeExit(3)).toMatch(/not authenticated/i);
    expect(describeCommandcodeExit(10)).toMatch(/out of credits/i);
    expect(describeCommandcodeExit(0)).toBe('');
  });
});

describe('mapCommandcodeEvent', () => {
  it('maps a tool frame and ignores a non-event frame', () => {
    expect(mapCommandcodeEvent({ type: 'event', event: { type: 'tool_running', toolName: 'bash' } }))
      .toEqual({ kind: 'tool', tool: 'bash', status: 'running' });
    expect(mapCommandcodeEvent({ type: 'result', subtype: 'success' })).toBeNull();
  });
});
