import { describe, it, expect } from 'vitest';

import {
  parsePaneLines,
  parsePsLines,
  parseSessionActivity,
  parseSessionNames,
  sumSessionTrees,
  pssForPids,
  applyPss,
  collectSessionMem,
  collectSessionIdle,
  matchSesPids,
  collectBareSessionMem,
  shortModel,
  agentForArgv,
  deriveSessionAgent,
  listTmuxNames,
  collectTmuxSessions,
  collectUnattributedMem,
} from './tmux-session-mem.mjs';

// PSS must never reach the real /proc in unit tests: every collector test
// below pins either the RSS-fallback path (noProc) or a canned reader.
const noProc = async () => { throw new Error('no proc in tests'); };

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
      .toEqual({
        4113756: { ppid: 1, rssKb: 34272, args: '' },
        4113785: { ppid: 4113756, rssKb: 158572, args: '' },
      });
  });
  it('captures argv when ps provides it', () => {
    expect(parsePsLines('PID PPID RSS ARGS\n100 1 1024 opencode --session ses_abc\n'))
      .toEqual({ 100: { ppid: 1, rssKb: 1024, args: 'opencode --session ses_abc' } });
  });
  it('skips malformed rows', () => {
    expect(parsePsLines('PID PPID RSS\nabc 1 2\n1 x 2\n1 2 y\n1 2\n')).toEqual({});
  });
});

describe('sumSessionTrees', () => {
  it('sums panes plus descendants, in MiB rounded', () => {
    const panes = { 'VM-tui': [100] };
    const ps = {
      100: { ppid: 1, rssKb: 34272, pssKb: 20000 },
      101: { ppid: 100, rssKb: 158572, pssKb: 150000 },
      102: { ppid: 101, rssKb: 2048, pssKb: 2048 },
      999: { ppid: 1, rssKb: 999999, pssKb: 999999 },
    };
    // (20000 + 150000 + 2048) / 1024 = 168.0 → 168; pid 999 is not under 100.
    expect(sumSessionTrees(panes, ps)).toEqual({ 'VM-tui': 168 });
  });
  it('skips unreadable processes instead of RSS-inflating them', () => {
    // Same tree, no pssKb anywhere: shared libraries would be counted once
    // per process under RSS — the 4x overstatement measured live.
    const panes = { 'VM-tui': [100] };
    const ps = {
      100: { ppid: 1, rssKb: 34272 },
      101: { ppid: 100, rssKb: 158572 },
    };
    expect(sumSessionTrees(panes, ps)).toEqual({});
  });
  it('omits sessions with no matched process instead of reporting zero', () => {
    expect(sumSessionTrees({ ghost: [555] }, { 1: { ppid: 0, rssKb: 10 } })).toEqual({});
    expect(sumSessionTrees({}, { 1: { ppid: 0, rssKb: 10 } })).toEqual({});
  });
  it('does not loop on a pid cycle', () => {
    const ps = {
      1: { ppid: 2, rssKb: 1024, pssKb: 1024 },
      2: { ppid: 1, rssKb: 1024, pssKb: 1024 },
    };
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
      readFile: noProc,
    });
    // Unreadable smaps (noProc) means nothing attributable: omitted, not
    // RSS-inflated. The PSS path is covered by 'collectors use PSS' below.
    expect(got).toEqual({});
  });
  it('resolves {} when tmux or ps fails', async () => {
    await expect(collectSessionMem({ sessions: ['VM-tui'], execFile: canned(PANES, PS, 'tmux'), readFile: noProc }))
      .resolves.toEqual({});
    await expect(collectSessionMem({ sessions: ['VM-tui'], execFile: canned(PANES, PS, 'ps'), readFile: noProc }))
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
    const pss = async () => 'Pss: 102400 kB\n';
    await expect(collectTmuxSessions({ execFile, readFile: pss, now: 1791917460000 })).resolves.toEqual([
      { name: 'VM-tui', memMiB: 200, idleMs: 60000 },
      { name: 'colab', memMiB: 100, idleMs: 0 },
    ]);
  });
  it('lists sessions even when nothing is readable, memory omitted', async () => {
    await expect(collectTmuxSessions({ execFile, readFile: noProc, now: 1791917460000 })).resolves.toEqual([
      { name: 'VM-tui', idleMs: 60000 },
      { name: 'colab', idleMs: 0 },
    ]);
  });
  it('omits unknown figures instead of zeroing', async () => {
    const partial = (file, args, _opts, cb) => {
      if (file === 'tmux' && args[0] === 'list-sessions') cb(null, 'ghost 1791917400\n');
      else if (file === 'tmux') cb(null, '');
      else cb(null, 'PID PPID RSS\n');
    };
    await expect(collectTmuxSessions({ execFile: partial, readFile: noProc, now: 1791917460000 })).resolves.toEqual([
      { name: 'ghost', idleMs: 60000 },
    ]);
  });
  it('resolves [] on failure', async () => {
    const failing = (_f, _a, _o, cb) => cb(new Error('boom'));
    await expect(collectTmuxSessions({ execFile: failing, readFile: noProc })).resolves.toEqual([]);
  });
});

describe('pssForPids / applyPss (PSS wins, RSS is the tracked fallback)', () => {
  const canned = (files) => async (path) => {
    if (!(path in files)) throw new Error('unreadable');
    return files[path];
  };
  it('reads Pss lines and skips unreadable pids', async () => {
    const got = await pssForPids([100, 101], {
      readFile: canned({ '/proc/100/smaps_rollup': 'Rss:  100 kB\nPss:   40 kB\n' }),
    });
    expect(got).toEqual({ 100: 40 });
  });
  it('applyPss prefers PSS and flags the fallback', () => {
    const ps = { 1: { ppid: 0, rssKb: 100 }, 2: { ppid: 1, rssKb: 200 } };
    expect(applyPss(ps, { 1: 30 })).toEqual({
      1: { ppid: 0, rssKb: 100, pssKb: 30, pssOk: true },
      2: { ppid: 1, rssKb: 200, pssKb: null, pssOk: false },
    });
  });
  it('sumSessionTrees adds PSS, so shared pages stop double-counting', () => {
    const panes = { s: [1] };
    const ps = { 1: { ppid: 0, rssKb: 100, pssKb: 30, pssOk: true } };
    expect(sumSessionTrees(panes, ps)).toEqual({ s: 0 + 0 }); // 30KB rounds to 0
    const ps2 = { 1: { ppid: 0, rssKb: 102400, pssKb: 30720, pssOk: true } };
    expect(sumSessionTrees({ s: [1] }, ps2)).toEqual({ s: 30 });
  });
  it('collectors use PSS when the reader serves it', async () => {
    const execFile = (file, args, _opts, cb) => {
      if (file === 'tmux') cb(null, 's 1\n');
      else cb(null, 'PID PPID RSS\n1 0 102400\n');
    };
    const readFile = async () => 'Pss:  30720 kB\n';
    await expect(collectSessionMem({ sessions: ['s'], execFile, readFile })).resolves.toEqual({ s: 30 });
  });
});

describe('collectUnattributedMem (the reconciling remainder)', () => {
  const execFile = (file, _args, _opts, cb) => {
    if (file === 'tmux') cb(null, 's 1\n');
    else cb(null, 'PID PPID RSS\n1 0 102400\n2 1 51200\n9 1 1024\n');
  };
  it('sums PSS outside pane trees with a process count', async () => {
    // pid 1 + child 2 are in session s; pid 9's ppid 1 — also a member.
    // A lone outsider first:
    const exec2 = (file, _args, _opts, cb) => {
      if (file === 'tmux') cb(null, 's 1\n');
      else cb(null, 'PID PPID RSS\n1 0 1024\n2 1 1024\n7 0 2048\n');
    };
    const pss2 = async (path) => (path === '/proc/7/smaps_rollup' ? 'Pss: 2048 kB\n' : 'Pss: 1 kB\n');
    await expect(collectUnattributedMem({ execFile: exec2, readFile: pss2 }))
      .resolves.toEqual({ mib: 2, procs: 1 });
  });
  it('resolves {} on failure', async () => {
    const failing = (_f, _a, _o, cb) => cb(new Error('boom'));
    await expect(collectUnattributedMem({ execFile: failing, readFile: noProc })).resolves.toEqual({});
  });
});

describe('matchSesPids / collectBareSessionMem (exclusive backends only)', () => {
  it('matches argv containing the session id', () => {
    const ps = {
      1: { ppid: 0, rssKb: 10, args: 'tmux' },
      2: { ppid: 1, rssKb: 10, args: 'opencode --session ses_abc' },
    };
    expect(matchSesPids(ps, 'ses_abc')).toEqual([2]);
    expect(matchSesPids(ps, 'ses_nope')).toEqual([]);
    expect(matchSesPids(ps, '')).toEqual([]);
  });
  it('reports mib + shared for in-tree backends, mib only for exclusive ones', async () => {
    const execFile = (file, args, _opts, cb) => {
      if (file === 'tmux') cb(null, 'VM-tui 10\n');
      else cb(null, 'PID PPID RSS ARGS\n10 1 1024 bash\n11 10 204800 opencode --session ses_in\n12 1 102400 opencode --session ses_out\n');
    };
    const got = await collectBareSessionMem({
      sessions: ['ses_in', 'ses_out', 'ses_gone'],
      execFile,
      readFile: async () => 'Pss: 102400 kB\n',
    });
    // ses_in's root (11) is a child of pane pid 10 → shared; ses_out is exclusive.
    expect(got).toEqual({
      ses_in: { mib: 100, shared: true },
      ses_out: { mib: 100, shared: false },
    });
  });
  it('resolves {} on failure or empty input', async () => {
    const failing = (_f, _a, _o, cb) => cb(new Error('boom'));
    await expect(collectBareSessionMem({ sessions: ['s'], execFile: failing, readFile: noProc }))
      .resolves.toEqual({});
    await expect(collectBareSessionMem({ sessions: [] })).resolves.toEqual({});
  });
});

describe('agentForArgv / deriveSessionAgent (argv structure, never bare substring)', () => {
  it('names cline with its shortened model', () => {
    expect(agentForArgv('/home/u/.npm-global/lib/node_modules/cline/bin/.cline -i -P cline -m cline-free/muse-spark-1.3-contributor -c /ws --id 1'))
      .toEqual({ kind: 'cline', model: 'muse-spark-1.3-contributor' });
    expect(agentForArgv('/home/u/.npm-global/bin/cline -i')).toEqual({ kind: 'cline', model: '' });
  });
  it('names opencode lanes and serve apart', () => {
    expect(agentForArgv('/home/u/.opencode/bin/opencode --session ses_abc')).toEqual({ kind: 'opencode' });
    expect(agentForArgv('/home/u/.opencode/bin/opencode')).toEqual({ kind: 'opencode' });
    expect(agentForArgv('/home/u/.opencode/bin/opencode serve --service')).toEqual({ kind: 'serve' });
    expect(agentForArgv('/home/u/bin/colab-tabs __watch job')).toEqual({ kind: 'colab-tabs' });
  });
  it('refuses bare-substring matches', () => {
    // A picker id or a prose mention is not an invocation.
    expect(agentForArgv('opencode:ses_abc')).toBeNull();
    expect(agentForArgv('/bin/bash -c echo hello')).toBeNull();
    expect(agentForArgv('')).toBeNull();
  });
  it('picks the highest-priority backend per tree', () => {
    expect(deriveSessionAgent(['-bash', '/home/u/bin/colab-tabs __watch j'])).toBe('colab-tabs');
    expect(deriveSessionAgent(['/home/u/.opencode/bin/opencode serve --service', '-bash'])).toBe('serve');
    expect(deriveSessionAgent([
      '/home/u/.opencode/bin/opencode serve --service',
      '/home/u/.opencode/bin/opencode --session ses_x',
    ])).toBe('opencode');
    expect(deriveSessionAgent([
      '/home/u/bin/colab-tabs __watch j',
      '/x/bin/.cline -m a/b-model',
    ])).toBe('cline/b-model');
    expect(deriveSessionAgent(['-bash', 'ps -ef'])).toBe('');
    expect(deriveSessionAgent([])).toBe('');
  });
  it('shortens models to the last segment, capped', () => {
    expect(shortModel('cline-free/muse-spark-1.3-contributor')).toBe('muse-spark-1.3-contributor');
    expect(shortModel('big-pickle')).toBe('big-pickle');
  });
});

describe('collectTmuxSessions agent labels', () => {
  it('attaches the derived backend label per session', async () => {
    const execFile = (file, args, _opts, cb) => {
      if (file === 'tmux' && args[0] === 'list-sessions') cb(null, 'VM-tui 1791917400\nplain 1791917400\n');
      else if (file === 'tmux') cb(null, 'VM-tui 100\nplain 200\n');
      else cb(null, 'PID PPID RSS ARGS\n100 1 1024 /x/bin/.cline -m a/b-model\n200 1 1024 -bash\n');
    };
    const readFile = async () => 'Pss: 10240 kB\n';
    await expect(collectTmuxSessions({ execFile, readFile, now: 1791917460000 })).resolves.toEqual([
      { name: 'VM-tui', memMiB: 10, idleMs: 60000, agent: 'cline/b-model' },
      { name: 'plain', memMiB: 10, idleMs: 60000 },
    ]);
  });
});
