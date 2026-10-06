import { describe, it, expect } from 'vitest';

import {
  formatPermissionPrompt,
  parsePermissionCallback,
  permissionKeyboard,
  listPendingPermissions,
  replyPermission,
  cleanPermissionError,
  startPermissionWatch,
  stopPermissionWatch,
} from './permission-bridge.mjs';

describe('formatPermissionPrompt', () => {
  it('names the action and lists resources', () => {
    const text = formatPermissionPrompt({ action: 'external_directory', resources: ['/home/ubuntu/src/Health-tracker'] });
    expect(text).toContain('Needs approval — external_directory');
    expect(text).toContain('/home/ubuntu/src/Health-tracker');
  });

  it('caps long resource lists and survives junk', () => {
    const text = formatPermissionPrompt({ action: 'x', resources: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(text).toContain('+2 more');
    expect(formatPermissionPrompt(null)).toContain('unknown action');
    expect(formatPermissionPrompt({})).toContain('unknown action');
  });
});

describe('permissionKeyboard', () => {
  it('fits the 64-byte callback cap and round-trips through the parser', () => {
    const keyboard = permissionKeyboard('abcdef12');
    const buttons = keyboard.inline_keyboard[0];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.callback_data.length).toBeLessThanOrEqual(64);
      expect(button.callback_data.startsWith('perm:')).toBe(true);
      const parsed = parsePermissionCallback(button.callback_data.slice('perm:'.length));
      expect(parsed).not.toBeNull();
      expect(parsed.token).toBe('abcdef12');
    }
    expect(parsePermissionCallback('bogus')).toBeNull();
    expect(parsePermissionCallback('once:zzz')).toBeNull();
  });
});

describe('parsePermissionCallback', () => {
  it('accepts the three decisions and rejects the rest', () => {
    expect(parsePermissionCallback('once:abcdef12')).toEqual({ decision: 'once', token: 'abcdef12' });
    expect(parsePermissionCallback('always:abcdef12')).toEqual({ decision: 'always', token: 'abcdef12' });
    expect(parsePermissionCallback('reject:abcdef12')).toEqual({ decision: 'reject', token: 'abcdef12' });
    expect(parsePermissionCallback('allow:abcdef12')).toBeNull();
    expect(parsePermissionCallback('')).toBeNull();
    expect(parsePermissionCallback(null)).toBeNull();
  });
});

describe('listPendingPermissions', () => {
  it('unwraps {data:[...]} and tolerates bare arrays', async () => {
    const req = { id: 'per_1', sessionID: 'ses_1', action: 'edit', resources: [] };
    const execOk = (bin, args, opts, cb) => cb(null, JSON.stringify({ data: [req] }), '');
    expect(await listPendingPermissions({ sessionId: 'ses_1', execFileImpl: execOk })).toEqual([req]);
    const execBare = (bin, args, opts, cb) => cb(null, JSON.stringify([req]), '');
    expect(await listPendingPermissions({ sessionId: 'ses_1', execFileImpl: execBare })).toEqual([req]);
  });

  it('returns [] without a session and throws the service error', async () => {
    const execNever = () => { throw new Error('must not spawn'); };
    expect(await listPendingPermissions({ sessionId: '', execFileImpl: execNever })).toEqual([]);
    const execErr = (bin, args, opts, cb) => cb(null, JSON.stringify({ _tag: 'SessionNotFoundError', message: 'nope' }), '');
    await expect(listPendingPermissions({ sessionId: 'ses_x', execFileImpl: execErr })).rejects.toThrow('nope');
  });

  it('passes sessionID as a --param and the workspace as cwd', async () => {
    const seen = {};
    const execSpy = (bin, args, opts, cb) => {
      seen.args = args; seen.cwd = opts.cwd;
      cb(null, JSON.stringify({ data: [] }), '');
    };
    await listPendingPermissions({ sessionId: 'ses_abc', workspace: '/tmp/w', execFileImpl: execSpy });
    expect(seen.args.slice(0, 2)).toEqual(['api', 'session.permission.list']);
    expect(seen.args).toContain('sessionID=ses_abc');
    expect(seen.cwd).toBe('/tmp/w');
  });
});

describe('replyPermission', () => {
  it('posts the decision and requires all three ids', async () => {
    let posted;
    const execSpy = (bin, args, opts, cb) => {
      posted = args;
      cb(null, '', '');
    };
    await expect(replyPermission({ sessionId: 'ses_1', requestId: 'per_1', decision: 'reject', execFileImpl: execSpy })).resolves.toBe('reject');
    expect(posted).toContain('session.permission.reply');
    expect(posted).toContain('sessionID=ses_1');
    expect(posted).toContain('requestID=per_1');
    const dataFlag = posted.indexOf('--data');
    expect(JSON.parse(posted[dataFlag + 1])).toEqual({ decision: 'reject' });
    await expect(replyPermission({ sessionId: '', requestId: 'per_1', decision: 'once', execFileImpl: execSpy })).rejects.toThrow();
  });
});

describe('cleanPermissionError', () => {
  it('drops log prefixes and keeps the last line', () => {
    expect(cleanPermissionError('timestamp=2026 level=info hi\nboom')).toBe('boom');
    expect(cleanPermissionError('')).toBe('');
  });
});

describe('startPermissionWatch', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const yieldMacrotask = () => new Promise((r) => setTimeout(r, 1));

  function harness({ requests = [], tap = null, sendSucceeds = true } = {}) {
    const sent = [];
    const edited = [];
    const replied = [];
    const running = new Map([['7', { child: { pid: 1 }, aborted: false }]]);
    const api = {
      sendMessage: async (chatId, text, extra) => {
        sent.push({ chatId, text, extra });
        if (!sendSucceeds) throw new Error('send down');
        return { messageId: 100 + sent.length };
      },
      editMessageText: async (chatId, messageId, text, extra) => {
        edited.push({ chatId, messageId, text, extra });
        return true;
      },
    };
    const listImpl = async () => requests;
    const replyImpl = async ({ decision }) => {
      replied.push(decision);
      return decision;
    };
    const state = startPermissionWatch({
      api,
      chatId: '7',
      running,
      getSessionId: () => 'ses_test',
      workspace: '/tmp/w',
      pollMs: 1,
      waitMs: tap === 'timeout' ? 20 : 10_000,
      sleepImpl: yieldMacrotask,
      listImpl,
      replyImpl,
      tokenImpl: () => 'abcdef12',
    });
    if (tap) {
      const go = async () => {
        for (let i = 0; i < 200 && !running.get('7')?.permWait; i++) await tick();
        if (tap !== 'timeout') running.get('7')?.permWait?.resolve(tap);
      };
      go();
    }
    return { sent, edited, replied, running, state };
  }

  it('asks once per request and replies once on tap', async () => {
    const req = { id: 'per_1', action: 'edit', resources: ['/x'] };
    const h = harness({ requests: [req], tap: 'once' });
    for (let i = 0; i < 500 && h.replied.length === 0; i++) await tick();
    await stopPermissionWatch(h.state);
    await h.state.task;
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].extra.reply_markup.inline_keyboard[0]).toHaveLength(3);
    expect(h.replied).toEqual(['once']);
    expect(h.edited).toHaveLength(1);
    expect(h.edited[0].text).toContain('Allowed once');
    expect(h.running.get('7').permWait).toBeUndefined();
  });

  it('rejects on timeout and never executes without approval', async () => {
    const req = { id: 'per_9', action: 'bash', resources: ['rm -rf /'] };
    const h = harness({ requests: [req], tap: 'timeout' });
    for (let i = 0; i < 500 && h.replied.length === 0; i++) await tick();
    await stopPermissionWatch(h.state);
    await h.state.task;
    expect(h.replied).toEqual(['reject']);
    expect(h.edited[0].text).toContain('No answer in 2m — rejected');
  });

  it('stays silent when nothing is pending and stops clean', async () => {
    const h = harness({ requests: [] });
    await Promise.resolve();
    await stopPermissionWatch(h.state);
    await h.state.task;
    expect(h.sent).toHaveLength(0);
  });
});
