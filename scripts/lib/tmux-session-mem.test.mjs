import { describe, it, expect } from 'vitest';

import {
  parsePaneLines,
  parsePsLines,
  parseSessionActivity,
  parseSessionNames,
  sumSessionTrees,
  collectSessionMem,
  collectSessionIdle,
  listTmuxNames,
  collectTmuxSessions,
} from './tmux-session-mem.mjs';

describe('parsePaneLines', () => {
  it('maps sessions to pane pids', () => {
    expect(parsePaneLines('VM-tui 4113756\nVM-tui 4114456\ncolab 624283\n'))
      .toEqual({ 'VM-tui': [4113756, 4114456], colab: [624283] });
  });
  it('splits on the last space so spaced session names survive', () => {
    expect(parsePaneLines('my session 123\n')).toEqual({ 'my session': [123] });
  });
  it('skips blank and malformed lines', () => {
    expect(parsePaneLines('\nno-pid-here\nVM-tui abc\nVM-tui -5\nVM-tui 0\nVM-tui 42\n'))
      .toEqual({ 'VM-tui': [42] });
  });
});

describe('parsePsLines', () => {
  it('skips the header and reads pid/ppid/rss', () => {
    expect(parsePsLines('    PID    PPID   RSS\n   4113756       1  34272\n   4113785 4113756 158572\n'))
      .toEqual({ 4113756: { ppid: 1, rssKb: 34272 }, 4113785: { ppid: 4113756, rssKb: 158572 } });
  });
  it('skips malformed rows', () => {
    expect(parsePsLines('PID PPID RSS\nabc 1 2\n1 x 2\n1 2 y\n1 2\n')).toEqual({});
  });
});

describe('sumSessionTrees', () => {
  it('sums panes plus descendants, in MiB rounded', () => {
    const panes = { 'VM-tui': [100] };
    const ps = {
      100: { ppid: 1, rssKb: 34272 },
      101: { ppid: 100, rssKb: 158572 },
      102: { ppid: 101, rssKb: 2048 },
      999: { ppid: 1, rssKb: 999999 },
    };
    // (34272 + 158572 + 2048) / 1024 = 190.3 → 190; pid 999 is not under 100.
    expect(sumSessionTrees(panes, ps)).toEqual({ 'VM-tui': 190 });
  });
  it('omits sessions with no matched process instead of reporting zero', () => {
    expect(sumSessionTrees({ ghost: [555] }, { 1: { ppid: 0, rssKb: 10 } })).toEqual({});
    expect(sumSessionTrees({}, { 1: { ppid: 0, rssKb: 10 } })).toEqual({});
  });
  it('does not loop on a pid cycle', () => {
    const ps = { 1: { ppid: 2, rssKb: 1024 }, 2: { ppid: 1, rssKb: 1024 } };
    expect(sumSessionTrees({ s: [1] }, ps)).toEqual({ s: 2 });
  });
});

describe('collectSessionMem', () => {  const canned = (panesOut, psOut, failOn = '') => (file, _args, _opts, cb) => {
    if (file === failOn) cb(new Error('boom'));
    else if (file === 'tmux') cb(null, panesOut);
    else cb(null, psOut);
  };
  const PANES = 'VM-tui 100\ncolab 200\n';
  const PS = 'PID PPID RSS\n100 1 102400\n101 100 102400\n200 1 51200\n';

  it('resolves per-session MiB for the requested sessions only', async () => {
    const got = await collectSessionMem({
      sessions: ['VM-tui'],
      execFile: canned(PANES, PS),
    });
    // VM-tui: (102400 + 102400)/1024 = 200; colab not requested.
    expect(got).toEqual({ 'VM-tui': 200 });
  });
  it('resolves {} when tmux or ps fails', async () => {
    await expect(collectSessionMem({ sessions: ['VM-tui'], execFile: canned(PANES, PS, 'tmux') }))
      .resolves.toEqual({});
    await expect(collectSessionMem({ sessions: ['VM-tui'], execFile: canned(PANES, PS, 'ps') }))
      .resolves.toEqual({});
  });
  it('resolves {} for empty input without spawning', async () => {
    let spawned = 0;
    const spy = () => { spawned++; };
    await expect(collectSessionMem({ sessions: [], execFile: spy })).resolves.toEqual({});
    expect(spawned).toBe(0);
  });
});

describe('parseSessionActivity', () => {
  it('maps sessions to idle milliseconds', () => {
    const now = 1791917460000;
    expect(parseSessionActivity('VM-tui 1791917400\ncolab 1791917460\n', now))
      .toEqual({ 'VM-tui': 60000, colab: 0 });
  });
  it('clamps future activity at zero and skips malformed lines', () => {
    const now = 1000000;
    expect(parseSessionActivity('\nnope\nVM-tui abc\nVM-tui -5\nVM-tui 2000\n', now))
      .toEqual({ 'VM-tui': 0 });
  });
});

describe('collectSessionIdle', () => {
  const canned = (out, fail = false) => (file, _args, _opts, cb) => {
    if (fail) cb(new Error('boom'));
    else cb(null, out);
  };
  it('resolves idle ages for the requested sessions only', async () => {
    const got = await collectSessionIdle({
      sessions: ['VM-tui'],
      now: 1791917460000,
      execFile: canned('VM-tui 1791917400\ncolab 1791917460\n'),
    });
    expect(got).toEqual({ 'VM-tui': 60000 });
  });
  it('resolves {} on failure or empty input', async () => {
    await expect(collectSessionIdle({ sessions: ['VM-tui'], execFile: canned('', true) }))
      .resolves.toEqual({});
    let spawned = 0;
    await expect(collectSessionIdle({ sessions: [], execFile: () => { spawned++; } }))
      .resolves.toEqual({});
    expect(spawned).toBe(0);
  });
});

describe('parseSessionNames', () => {
  it('lists non-blank names', () => {
    expect(parseSessionNames('VM-tui\n\ncolab\n')).toEqual(['VM-tui', 'colab']);
  });
});

describe('listTmuxNames', () => {
  it('resolves the live names', async () => {
    const execFile = (file, _args, _opts, cb) => cb(null, 'a\nb\n');
    await expect(listTmuxNames({ execFile })).resolves.toEqual(['a', 'b']);
  });
  it('resolves [] on failure', async () => {
    const execFile = (_f, _a, _o, cb) => cb(new Error('no tmux'));
    await expect(listTmuxNames({ execFile })).resolves.toEqual([]);
  });
});

describe('collectTmuxSessions', () => {
  const byCmd = {
    sessions: 'VM-tui 1791917400\ncolab 1791917460\n',
    panes: 'VM-tui 100\nVM-tui 101\ncolab 200\n',
    ps: 'PID PPID RSS\n100 1 102400\n101 100 102400\n200 1 51200\n',
  };
  const execFile = (file, args, _opts, cb) => {
    if (file === 'tmux' && args[0] === 'list-sessions') cb(null, byCmd.sessions);
    else if (file === 'tmux') cb(null, byCmd.panes);
    else cb(null, byCmd.ps);
  };
  it('returns every session sorted, with memory and idle age', async () => {
    await expect(collectTmuxSessions({ execFile, now: 1791917460000 })).resolves.toEqual([
      { name: 'VM-tui', memMiB: 200, idleMs: 60000 },
      { name: 'colab', memMiB: 50, idleMs: 0 },
    ]);
  });
  it('omits unknown figures instead of zeroing', async () => {
    const partial = (file, args, _opts, cb) => {
      if (file === 'tmux' && args[0] === 'list-sessions') cb(null, 'ghost 1791917400\n');
      else if (file === 'tmux') cb(null, '');
      else cb(null, 'PID PPID RSS\n');
    };
    await expect(collectTmuxSessions({ execFile: partial, now: 1791917460000 })).resolves.toEqual([
      { name: 'ghost', idleMs: 60000 },
    ]);
  });
  it('resolves [] on failure', async () => {
    const failing = (_f, _a, _o, cb) => cb(new Error('boom'));
    await expect(collectTmuxSessions({ execFile: failing })).resolves.toEqual([]);
  });
});
