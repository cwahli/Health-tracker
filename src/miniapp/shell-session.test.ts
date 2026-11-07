import { describe, expect, it } from 'vitest';
import { formatMem, statusKeyMaps, formatIdle, lookForRow, sortByMem, filterBareRows, applyRouteAgents, activityKeyMaps, attachedKeyMaps, TTY_IDLE_RED_MS } from './shell-session';
import type { TmuxEntry } from './shell-session';

describe('formatMem (picker memory readout shows a number or nothing)', () => {
  it('renders megabytes below 1 GiB', () => {
    expect(formatMem(412)).toBe('412 MB');
    expect(formatMem(1)).toBe('1 MB');
  });
  it('renders gigabytes at and above 1 GiB', () => {
    expect(formatMem(1024)).toBe('1.0 GB');
    expect(formatMem(2048)).toBe('2.0 GB');
  });
  it('renders nothing for absent measurements, never a zero', () => {
    expect(formatMem(0)).toBe('');
    expect(formatMem(-5)).toBe('');
    expect(formatMem(NaN)).toBe('');
  });
});

describe('statusKeyMaps (tty rows light under their tty:<bot> picker id)', () => {
  it('paints an unkeyed tty row under both bot and tty:bot', () => {
    const { live, mem, idle } = statusKeyMaps([{ bot: 'vm2', live: true, memMiB: 180, idleMs: 60000 }]);
    expect(live).toEqual({ vm2: true, 'tty:vm2': true });
    expect(mem).toEqual({ vm2: 180, 'tty:vm2': 180 });
    expect(idle).toEqual({ vm2: 60000, 'tty:vm2': 60000 });
  });
  it('paints a keyed bare row under its own id only, never the shared bot', () => {
    const { live, mem, idle } = statusKeyMaps([{ id: 'opencode:ses_abc', bot: 'vm', live: true }]);
    expect(live).toEqual({ 'opencode:ses_abc': true });
    expect(mem).toEqual({});
    expect(idle).toEqual({});
    expect(live.vm).toBeUndefined();
  });
  it('marks dormant rows without memory or idle entries', () => {
    const { live, mem, idle } = statusKeyMaps([{ bot: 'vm', live: false, memMiB: 0, idleMs: -1 }]);
    expect(live).toEqual({ vm: false, 'tty:vm': false });
    expect(mem).toEqual({});
    expect(idle).toEqual({});
  });
  it('skips rows with no bot', () => {
    const { live, mem, idle } = statusKeyMaps([{ bot: undefined as unknown as string, live: true }]);
    expect(live).toEqual({});
    expect(mem).toEqual({});
    expect(idle).toEqual({});
  });
  it('folds routeless tmux entries under tmux:<name> and skips routed ones', () => {
    const tmux: TmuxEntry[] = [
      { name: 'colab', memMiB: 300, idleMs: 3600000, route: null },
      { name: 'VM-tui-vm2', memMiB: 150, idleMs: 1000, route: 'vm2' },
      { name: '', memMiB: 1, idleMs: 1, route: null },
    ];
    const { live, mem, idle } = statusKeyMaps([], tmux);
    expect(live).toEqual({ 'tmux:colab': true });
    expect(mem).toEqual({ 'tmux:colab': 300 });
    expect(idle).toEqual({ 'tmux:colab': 3600000 });
  });
});

describe('formatIdle', () => {
  it('reads minutes, hours, days', () => {
    expect(formatIdle(0)).toBe('just now');
    expect(formatIdle(5 * 60000)).toBe('5m');
    expect(formatIdle(2 * 3600000)).toBe('2h');
    expect(formatIdle(3 * 86400000)).toBe('3d');
  });
  it('is blank when unmeasurable', () => {
    expect(formatIdle(NaN)).toBe('');
    expect(formatIdle(-1)).toBe('');
  });
});

describe('lookForRow (one rule for dot, memory, state)', () => {
  it('paints a live tty row green with memory on top, dot-only without agent', () => {
    expect(lookForRow({ bot: 'vm' }, { live: true, memMiB: 243, idleMs: 60000 }, 0))
      .toEqual({ dot: 'live', memText: '243 MB', stateText: '' });
  });
  it('paints a live tty row with its agent when known', () => {
    expect(lookForRow(
      { bot: 'vm', agent: 'cline/muse-spark-1.3-contributor' },
      { live: true, memMiB: 243, idleMs: 60000 }, 0,
    )).toEqual({ dot: 'live', memText: '243 MB', stateText: 'cline/muse-spark-1.3-contributor · live' });
  });
  it('paints an idle tty row red with agent and idle age', () => {
    expect(lookForRow(
      { bot: 'vm', agent: 'cline/muse-spark-1.3-contributor' },
      { live: true, memMiB: 243, idleMs: TTY_IDLE_RED_MS + 1 }, 0,
    )).toEqual({
      dot: 'idle', memText: '243 MB',
      stateText: `cline/muse-spark-1.3-contributor · idle ${formatIdle(TTY_IDLE_RED_MS + 1)}`,
    });
  });
  it('paints an idle tty row red with its idle age', () => {
    expect(lookForRow({ bot: 'vm' }, { live: true, memMiB: 243, idleMs: TTY_IDLE_RED_MS + 1 }, 0))
      .toEqual({ dot: 'idle', memText: '243 MB', stateText: `idle ${formatIdle(TTY_IDLE_RED_MS + 1)}` });
  });
  it('paints a dormant tty row grey with no numbers', () => {
    expect(lookForRow({ bot: 'vm' }, { live: false }, 0))
      .toEqual({ dot: 'dormant', memText: '', stateText: '' });
  });
  it('paints an idle bare session red with its age from updatedAt', () => {
    const now = 1791917460000;
    const updatedAt = new Date(now - 3 * 3600000).toISOString();
    expect(lookForRow(
      { kind: 'opencode', bot: 'vm', agent: 'opencode/x', status: 'idle', updatedAt },
      { live: true }, now,
    )).toEqual({ dot: 'idle', memText: '', stateText: 'idle 3h' });
  });
  it('paints a working bare session green with no memory', () => {
    expect(lookForRow(
      { kind: 'opencode', bot: 'vm', agent: 'opencode/x', status: 'working', updatedAt: null },
      { live: true }, 0,
    )).toEqual({ dot: 'live', memText: '', stateText: 'working' });
  });
  it('paints a raw tmux row like a tty row (red when idle, memory on top)', () => {
    expect(lookForRow({ kind: 'tmux', bot: 'colab' }, { live: true, memMiB: 300, idleMs: 3600000 }, 0))
      .toEqual({ dot: 'idle', memText: '300 MB', stateText: 'idle 1h' });
  });
  it('paints the box aggregate green with its detail line', () => {
    expect(lookForRow(
      { kind: 'box', bot: 'other processes', detail: '212 processes outside tmux' },
      { live: true, memMiB: 1400 }, 0,
    )).toEqual({ dot: 'live', memText: '1.4 GB', stateText: '212 processes outside tmux' });
  });
  it('paints a bare row with an exclusive backend like a measured row', () => {
    expect(lookForRow(
      { kind: 'opencode', bot: 'vm', agent: 'opencode/x', status: 'working', updatedAt: null },
      { live: true, memMiB: 100 }, 0,
    )).toEqual({ dot: 'live', memText: '100 MB', stateText: 'working' });
  });
});

describe('activityKeyMaps (working/held badges key tty:<bot> and ses:<id12>)', () => {
  const entries = [
    { chat: '1', sessionId8: 'ses_abc00000', bots: ['vm'], lane: 'opencode', host: 'vps', state: 'working', elapsedMs: 90000 },
    { chat: '2', sessionId8: 'ses_zzz00000', bots: ['vm'], lane: 'cline', host: 'grok', state: 'held', elapsedMs: null },
    { chat: '3', sessionId8: '', bots: ['vm2'], lane: 'opencode', host: 'vps', state: 'idle', elapsedMs: null },
  ] as Parameters<typeof activityKeyMaps>[0];
  it('badges bots and sessions; working wins ties by elapsed', () => {
    const { act } = activityKeyMaps(entries);
    expect(act['tty:vm']).toEqual({ state: 'working', lane: 'opencode', elapsedMs: 90000, host: 'vps' });
    expect(act['ses:ses_abc00000']).toEqual(act['tty:vm']);
    expect(act['ses:ses_zzz00000']).toEqual({ state: 'held', lane: 'cline', elapsedMs: null, host: 'grok' });
    expect(act['tty:vm2']).toBe(undefined);
  });
  it('a working badge greens the row with lane and elapsed', () => {
    expect(lookForRow(
      { bot: 'vm' },
      { live: true, memMiB: 100, act: { state: 'working', lane: 'opencode', elapsedMs: 90000, host: 'vps' } }, 0,
    )).toEqual({ dot: 'live', memText: '100 MB', stateText: 'working opencode 1m' });
  });
  it('a working badge shows on a dormant pane (headless turns are the invisible ones)', () => {
    expect(lookForRow(
      { bot: 'vm' },
      { live: false, act: { state: 'working', lane: 'opencode', elapsedMs: 1000, host: 'vps' } }, 0,
    )).toEqual({ dot: 'dormant', memText: '', stateText: 'working opencode just now' });
  });
  it('a working badge wins the subline over the static agent tag', () => {
    expect(lookForRow(
      { bot: 'vm', agent: 'cline/muse-spark-1.3-contributor' },
      { live: true, memMiB: 100, act: { state: 'working', lane: 'opencode', elapsedMs: 60000, host: 'vps' } }, 0,
    )).toEqual({ dot: 'live', memText: '100 MB', stateText: 'working opencode 1m' });
  });
  it('a held badge keeps the dot and names the host', () => {
    expect(lookForRow(
      { bot: 'vm' },
      { live: false, act: { state: 'held', lane: 'cline', elapsedMs: null, host: 'grok' } }, 0,
    )).toEqual({ dot: 'dormant', memText: '', stateText: 'held grok' });
    expect(lookForRow(
      { kind: 'opencode', bot: 'vm', status: 'idle', updatedAt: null },
      { live: false, act: { state: 'held', lane: 'opencode', elapsedMs: null, host: 'mobile' } }, 0,
    )).toEqual({ dot: 'idle', memText: '', stateText: 'held mobile' });
  });
});

describe('filterBareRows (visible implies measurable, never numberless)', () => {
  const rows = [
    { bot: 'vm', id: 'tty:vm', kind: 'tty' },
    { bot: 's1', id: 'opencode:s1', kind: 'opencode' },
    { bot: 's2', id: 'opencode:s2', kind: 'opencode' },
    { bot: 'colab', id: 'tmux:colab', kind: 'tmux' },
  ];
  it('holds bare rows until status truth arrives (no numberless flash)', () => {
    expect(filterBareRows(rows, {}, false).map((r) => r.bot))
      .toEqual(['vm', 'colab']);
  });
  it('hides mem-less bare rows once status is known, keeps the rest', () => {
    expect(filterBareRows(rows, { 'opencode:s1': 100 }, true).map((r) => r.bot))
      .toEqual(['vm', 's1', 'colab']);
  });
  it('keeps attached mem-less bare rows visible, like the session in use', () => {
    const attached = [
      { bot: 'vm', id: 'opencode:ses_abc000001', kind: 'opencode', sessionId: 'ses_abc000001' },
      { bot: 'vm', id: 'opencode:ses_zzz000002', kind: 'opencode', sessionId: 'ses_zzz000002' },
    ];
    expect(filterBareRows(attached, {}, true, new Set(['ses:ses_abc00000'])).map((r) => r.id))
      .toEqual(['opencode:ses_abc000001']);
  });
  it('keeps the picked row visible without memory', () => {
    const attached = [
      { bot: 'vm', id: 'opencode:ses_abc000001', kind: 'opencode', sessionId: 'ses_abc000001' },
      { bot: 'vm', id: 'opencode:ses_zzz000002', kind: 'opencode', sessionId: 'ses_zzz000002' },
    ];
    expect(filterBareRows(attached, {}, true, new Set(['opencode:ses_zzz000002'])).map((r) => r.id))
      .toEqual(['opencode:ses_zzz000002']);
  });
  it('keeps attached rows even before status truth arrives', () => {
    const attached = [
      { bot: 'vm', id: 'tty:vm', kind: 'tty' },
      { bot: 'vm', id: 'opencode:ses_abc000001', kind: 'opencode', sessionId: 'ses_abc000001' },
      { bot: 'vm', id: 'opencode:ses_zzz000002', kind: 'opencode', sessionId: 'ses_zzz000002' },
    ];
    expect(filterBareRows(attached, {}, false, new Set(['ses:ses_abc00000'])).map((r) => r.id))
      .toEqual(['tty:vm', 'opencode:ses_abc000001']);
  });
});

describe('attachedKeyMaps (every hub session keeps its row, any state)', () => {
  it('maps working, held AND idle sessions, not just badges', () => {
    const { attached } = attachedKeyMaps([
      { chat: '1', sessionId8: 'ses_abc00000', bots: ['vm'], lane: 'opencode', host: 'vps', state: 'working', elapsedMs: 1 },
      { chat: '2', sessionId8: 'ses_zzz00000', bots: [], lane: 'cline', host: 'grok', state: 'held', elapsedMs: null },
      { chat: '3', sessionId8: 'ses_idle00000', bots: [], lane: 'opencode', host: 'vps', state: 'idle', elapsedMs: null },
    ] as Parameters<typeof attachedKeyMaps>[0]);
    expect(attached.has('ses:ses_abc00000')).toBe(true);
    expect(attached.has('ses:ses_zzz00000')).toBe(true);
    expect(attached.has('ses:ses_idle00000')).toBe(true);
    expect(attached.has('tty:vm')).toBe(true);
  });
  it('tolerates missing input', () => {
    expect(attachedKeyMaps().attached.size).toBe(0);
    expect(attachedKeyMaps(null as unknown as []).attached.size).toBe(0);
  });
});

describe('applyRouteAgents (tty doors inherit their session agent)', () => {
  const routes = [
    { bot: 'vm', id: 'tty:vm', kind: 'tty' },
    { bot: 'vm2', id: 'tty:vm2', kind: 'tty' },
    { bot: 'colab', id: 'tmux:colab', kind: 'tmux' },
  ];
  it('paints tty rows from unkeyed status rows, leaves the rest alone', () => {
    const out = applyRouteAgents(routes, [
      { bot: 'vm', agent: 'cline/muse-spark-1.3-contributor' },
      { id: 'opencode:s1', bot: 'vm', agent: 'opencode/x' },
    ]);
    expect(out && out[0]).toMatchObject({ bot: 'vm', agent: 'cline/muse-spark-1.3-contributor' });
    expect(out && out[1]).not.toHaveProperty('agent');
    expect(out && out[2]).not.toHaveProperty('agent');
  });
  it('passes routes through when there is nothing to apply', () => {
    expect(applyRouteAgents(routes, [])).toBe(routes);
    expect(applyRouteAgents(null, [{ bot: 'vm', agent: 'x' }])).toBeNull();
  });
});

describe('sortByMem (heaviest first, unmeasured keep order at the bottom)', () => {
  it('sorts measured rows down and unmeasured last, stably', () => {
    const rows = [
      { bot: 'bare-b' },
      { bot: 'vm', id: 'tty:vm' },
      { bot: 'bare-a' },
      { bot: 'colab', id: 'tmux:colab' },
      { bot: 'vm2', id: 'tty:vm2' },
    ];
    const mem = { 'tty:vm': 200, 'tmux:colab': 400, 'tty:vm2': 200 };
    expect(sortByMem(rows, mem).map((r) => r.bot))
      .toEqual(['colab', 'vm', 'vm2', 'bare-b', 'bare-a']);
  });
  it('tolerates missing input', () => {
    expect(sortByMem([], {})).toEqual([]);
  });
});
