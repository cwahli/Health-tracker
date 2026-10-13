import { describe, expect, it } from 'vitest';
import { formatMem, statusKeyMaps } from './shell-session';

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
    const { live, mem } = statusKeyMaps([{ bot: 'vm2', live: true, memMiB: 180 }]);
    expect(live).toEqual({ vm2: true, 'tty:vm2': true });
    expect(mem).toEqual({ vm2: 180, 'tty:vm2': 180 });
  });
  it('paints a keyed bare row under its own id only, never the shared bot', () => {
    const { live, mem } = statusKeyMaps([{ id: 'opencode:ses_abc', bot: 'vm', live: true }]);
    expect(live).toEqual({ 'opencode:ses_abc': true });
    expect(mem).toEqual({});
    expect(live.vm).toBeUndefined();
  });
  it('marks dormant rows without a memory entry', () => {
    const { live, mem } = statusKeyMaps([{ bot: 'vm', live: false, memMiB: 0 }]);
    expect(live).toEqual({ vm: false, 'tty:vm': false });
    expect(mem).toEqual({});
  });
  it('skips rows with no bot', () => {
    const { live, mem } = statusKeyMaps([{ bot: undefined as unknown as string, live: true }]);
    expect(live).toEqual({});
    expect(mem).toEqual({});
  });
});
