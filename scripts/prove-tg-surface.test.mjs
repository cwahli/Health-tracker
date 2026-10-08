import { describe, it, expect } from 'vitest';

import {
  argvHasThinkingHigh,
  callbackDataOf,
  chatLaneOf,
  utcStamp,
  checkLine,
  parseEnvFile,
  isIdleOutput,
  sessionIdOf,
  argvHasSessionOnce,
  toolNamesFromData,
  buildEvidence,
  milestoneSteps,
  checksFor,
} from './prove-tg-surface.mjs';

const FIX_TELEGRAM = [
  '10:00:01 out: prove-tg-surface ping tok-1 — reply with the word PONG',
  '10:00:02 in: ⏳ OpenCode space-bunny-free (xhigh) working… 0s',
  '10:00:09 in: ✓ Done · OpenCode space-bunny-free · 7s So far: · read (completed) src/a.ts · 3s · bash (completed) npm test · 4s',
  '10:00:09 in: PONG',
];

describe('prove-tg-surface checklist writer (fixture transcripts)', () => {
  it('parses the idle gate from pgrep output', () => {
    expect(isIdleOutput('')).toBe(true);
    expect(isIdleOutput('\n')).toBe(true);
    expect(isIdleOutput('531001\n')).toBe(false);
  });

  it('reads workspace-scoped and bare session bindings', () => {
    expect(sessionIdOf({ 1: '/home/ubuntu/src/Health-tracker\u0000ses_abc' }, 1)).toBe('ses_abc');
    expect(sessionIdOf({ 1: 'ses_old' }, 1)).toBe('ses_old');
    expect(sessionIdOf({}, 1)).toBeNull();
  });

  it('accepts exactly one --session with the disposable id', () => {
    expect(argvHasSessionOnce('opencode run --format json --session ses_abc -m x', 'ses_abc')).toBe(true);
    expect(argvHasSessionOnce('opencode run --session ses_abc --session ses_abc', 'ses_abc')).toBe(false);
    expect(argvHasSessionOnce('opencode run --session ses_other', 'ses_abc')).toBe(false);
    expect(argvHasSessionOnce('opencode run --format json', 'ses_abc')).toBe(false);
  });

  it('extracts tool names from session_message payloads', () => {
    expect(toolNamesFromData('{"tool":"bash","status":"completed"}')).toContain('bash');
    // Live opencode shape, copied off session ses_ef981a56 (M2 2026-10-04).
    expect(toolNamesFromData('{"type": "tool", "id": "call_Zt1", "name": "shell", "executed": false}')).toContain('shell');
    expect(toolNamesFromData('no json here')).toEqual([]);
  });

  it('parses env files without executing them', () => {
    expect(parseEnvFile('A=1\n# c\nB=x=y\n')).toEqual({ A: '1', B: 'x=y' });
  });

  it('m0 passes on the ping fixture', () => {
    const checks = checksFor('m0', {
      sent: 'ping', telegram: FIX_TELEGRAM.join('\n'), toolNames: ['read', 'bash'],
      disposableId: 'ses_new', beforeId: 'ses_old',
      arrivalMs: {}, argvSightings: ['opencode run --session ses_new'], termLine: 't', token: 'tok-1',
    });
    expect(checks.every((c) => c.startsWith('- [pass]'))).toBe(true);
  });

  it('m0 fails when the ping never reaches the session', () => {
    const checks = checksFor('m0', {
      sent: 'ping', telegram: 'in: hello', toolNames: [],
      disposableId: null, beforeId: 'ses_old',
      arrivalMs: {}, argvSightings: [], termLine: 't', token: 'tok-missing',
    });
    expect(checks.some((c) => c.startsWith('- [FAIL]'))).toBe(true);
  });

  it('resolves tap bytes nested under type.data', () => {
    const buf = Buffer.from('fm:x');
    expect(callbackDataOf({ type: { data: buf } })).toBe(buf);
    expect(callbackDataOf({ data: buf })).toBe(buf);
    expect(callbackDataOf({ type: {}, text: 'x' })).toBeNull();
    expect(callbackDataOf(null)).toBeNull();
  });

  it('spots the cline thinking level on the child argv', () => {
    expect(argvHasThinkingHigh(['argv :: cline -p hi --thinking high'])).toBe(true);
    expect(argvHasThinkingHigh(['argv :: cline -p hi --thinking low'])).toBe(false);
    expect(argvHasThinkingHigh([])).toBe(false);
  });

  it('m4 lane sections pass on the fixture', () => {
    const telegram = ['m4 ping tok-m4 OPENCODE-OK', 'Model set to cline:cline-free/deepseek-v4.1-flash (free)', 'Thinking level set to high', 'CLINE-OK', 'Cline cannot load that skill', 'Freebuff runs in the terminal'].join('\n');
    const checks = checksFor('m4', {
      sent: 'x', telegram, toolNames: ['bash'],
      disposableId: 'ses_n', beforeId: 'ses_o',
      argvSightings: ['argv :: cline --thinking high'], termLine: 't', token: 'tok-m4',
      tapResults: { freebuff: { ok: true, summary: 'tapped' } },
      laneNotes: ['- [pass] Token Harbor: recorded dry'],
    });
    expect(checks.every((c) => c.startsWith('- [pass]'))).toBe(true);
    expect(checks.some((c) => c.includes('Token Harbor'))).toBe(true);
  });

  it('m6 crossing sections pass on the fixture', () => {
    const telegram = ['m6 ping tok-6', 'Thinking level set to medium', 'M6-SKILL', 'M6-CLINE', 'M6-GROK', 'M6-FINAL', 'So far:'].join('\n');
    const checks = checksFor('m6', {
      sent: 'x', telegram, toolNames: ['bash', 'read'],
      disposableId: 'ses_n', beforeId: 'ses_o',
      arrivalMs: {}, argvSightings: ['opencode run --session ses_n'], termLine: 't', token: 'tok-6',
    });
    expect(checks.every((c) => c.startsWith('- [pass]'))).toBe(true);
  });

  it('m6 records a skipped grok hop instead of failing it', () => {
    const telegram = ['m6 ping tok-6', 'Thinking level set to medium', 'M6-SKILL', 'M6-CLINE', 'Held: grok is still unreachable', 'M6-FINAL'].join('\n');
    const checks = checksFor('m6', {
      sent: 'x', telegram, toolNames: ['bash'],
      disposableId: 'ses_n', beforeId: 'ses_o',
      arrivalMs: {}, argvSightings: [], termLine: 't', token: 'tok-6',
    });
    expect(checks.every((c) => c.startsWith('- [pass]'))).toBe(true);
    expect(checks.some((c) => c.includes('skipped'))).toBe(true);
  });

  it('m5 keeps the transcript line and defers to sections', () => {
    const checks = checksFor('m5', {
      sent: 'x', telegram: 'tok-5 here', toolNames: [],
      disposableId: null, beforeId: 'ses_o',
      arrivalMs: {}, argvSightings: [], termLine: 't', token: 'tok-5',
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].startsWith('- [pass]')).toBe(true);
  });

  it('reads the chat lane off the prefs file', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const f = path.join(os.tmpdir(), `prefs-lane-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ 6218257274: { model: 'cline:cline-free/deepseek-v4.1-flash' } }));
    expect(chatLaneOf(f)).toBe('cline');
    fs.writeFileSync(f, JSON.stringify({ 6218257274: { model: 'opencode/space-bunny-free' } }));
    expect(chatLaneOf(f)).toBe('opencode');
    fs.writeFileSync(f, JSON.stringify({}));
    expect(chatLaneOf(f)).toBe('opencode');
    fs.rmSync(f, { force: true });
  });

  it('m1 enforces the 5s arrival budget', () => {
    const base = {
      sent: 'x', telegram: 'FIRST SECOND', toolNames: ['bash'],
      disposableId: 'ses_n', beforeId: 'ses_o', argvSightings: [], termLine: 't', token: 'FIRST',
    };
    expect(checksFor('m1', { ...base, arrivalMs: { first: 3200 } }).every((c) => c.startsWith('- [pass]'))).toBe(true);
    expect(checksFor('m1', { ...base, arrivalMs: { first: 9000 } }).some((c) => c.startsWith('- [FAIL]'))).toBe(true);
  });

  it('writes the evidence file shape the plan requires', () => {
    const md = buildEvidence({
      milestone: 'm0', utc: '2026-10-04T00:00:00Z', host: 'vps', lane: 'opencode',
      sessionId: 'ses_n', sent: ['ping'], telegram: FIX_TELEGRAM, tool: ['10:00:05 user: ping'],
      checks: ['- [pass] demo'], restored: true,
    });
    for (const needle of ['# TG tool surface — m0', 'host: vps', 'ses_n', '## Text sent', '## Telegram transcript', '## Tool transcript', '## Checklist', 'Restore:']) {
      expect(md).toContain(needle);
    }
  });

  it('every milestone has a script and the stamp is filename-safe', () => {
    for (const m of ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6']) {
      expect(milestoneSteps(m).length).toBeGreaterThan(0);
    }
    expect(utcStamp(new Date('2026-10-04T00:00:00Z'))).not.toMatch(/[:.]/);
    expect(checkLine(true, 'x')).toBe('- [pass] x');
    expect(checkLine(false, 'x')).toBe('- [FAIL] x');
  });
});
