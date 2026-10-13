import { describe, expect, it } from 'vitest';
import { tabUrl } from './shell-nav';

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
