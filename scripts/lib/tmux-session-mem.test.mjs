import { describe, it, expect } from 'vitest';

import {
  parsePaneLines,
  parsePsLines,
  sumSessionTrees,
  collectSessionMem,
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

describe('collectSessionMem', () => {
  const canned = (panesOut, psOut, failOn = '') => (file, _args, _opts, cb) => {
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
