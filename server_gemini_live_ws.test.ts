import { describe, it, expect } from 'vitest';
import {
  normalizeLivePageContext,
  buildLiveSystemInstruction,
  buildLiveTools,
} from './server_gemini_live_ws.js';

describe('live page context', () => {
  it('sanitizes page and derives logged-out + empty profile', () => {
    expect(normalizeLivePageContext({ page: 'signup', authMode: 'signup' }, null)).toEqual({
      page: 'signup', authState: 'logged-out', authMode: 'signup', profileEmpty: true,
    });
    expect(normalizeLivePageContext({ page: '"><evil' }, { age: 30 })).toEqual({
      page: 'unknown', authState: 'logged-in', profileEmpty: false,
    });
    expect(normalizeLivePageContext({ page: 'food' }, { nickname: 'Bo' })).toEqual({
      page: 'food', authState: 'logged-in', profileEmpty: true,
    });
  });

  it('auth pages get signup walkthrough rules, never health forms', () => {
    const text = buildLiveSystemInstruction({
      language: 'id',
      profile: null,
      pageContext: { page: 'signup', authState: 'logged-out', authMode: 'signup', profileEmpty: true },
    });
    expect(text).toContain('AUTH screen (SIGN UP)');
    expect(text).toContain('Ask NOTHING else — no age, height, weight, goals, or labs');
  });

  it('empty logged-in profiles get profile-fill rules, tabs get tailored help', () => {
    const text = buildLiveSystemInstruction({
      language: 'en',
      profile: { language: 'en' },
      pageContext: { page: 'food', authState: 'logged-in', profileEmpty: true },
    });
    expect(text).toContain('health profile is empty');
    expect(text).toContain('food tab');
  });

  it('no page context means no page rules (legacy callers unaffected)', () => {
    const text = buildLiveSystemInstruction({ language: 'en', profile: { language: 'en' } });
    expect(text).not.toContain('PAGE RULE');
    expect(text).not.toContain('SITUATION');
  });

  it('auth sessions declare no tools; logged-in sessions keep all four', () => {
    expect(buildLiveTools({ page: 'signup', authState: 'logged-out', profileEmpty: true })).toEqual([]);
    expect(buildLiveTools({ page: 'food', authState: 'logged-in', profileEmpty: false }).length).toBe(1);
    expect(buildLiveTools(null).length).toBe(1);
    const authText = buildLiveSystemInstruction({
      language: 'id', profile: null,
      pageContext: { page: 'auth', authState: 'logged-out', profileEmpty: true },
    });
    expect(authText).toContain('no app tools on this screen');
  });
});
