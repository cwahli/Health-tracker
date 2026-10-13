import { describe, expect, it } from 'vitest';
import { formatMem, statusKeyMaps, formatIdle, lookForRow, sortByMem, filterBareRows, TTY_IDLE_RED_MS } from './shell-session';
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
});
