import { describe, expect, it } from 'vitest';
import { tabUrl, formatMem } from './shell-nav';

describe('tabUrl (refresh boots from ?tab=, so it must name the visible tab)', () => {
  it('sets the tab on an empty query', () => {
    expect(tabUrl('', 'hotels', '')).toBe('?tab=hotels');
  });
  it('replaces a stale tab but preserves the token', () => {
    const out = tabUrl('?token=TOK&bot=web&tab=tui', 'hotels', 'web');
    expect(out).toContain('tab=hotels');
    expect(out).not.toContain('tab=tui');
    expect(out).toContain('token=TOK');
    expect(out).toContain('bot=web');
  });
  it('sets the bot when given, keeps it when not', () => {
    expect(tabUrl('?token=T', 'fleet', 'web')).toContain('bot=web');
    expect(tabUrl('?token=T&bot=web', 'fleet', '')).toContain('bot=web');
  });
});

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
