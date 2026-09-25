import { describe, it, expect } from 'vitest';
import {
  LANES,
  laneFor,
  isDegraded,
  laneSupports,
} from '../scripts/lib/lane-contract.mjs';

/**
 * R-15 sensor — freebuff lane row + the headless capability probe.
 *
 * `headless` answers exactly one dispatch question per lane: can this backend
 * take a one-shot prompt from a script today? Freebuff's CLI (0.0.19x) is
 * TUI/login only, so its answer is no; the lane graduates by shrinking its
 * degraded list (never by pinning a version), and these tests flip with it.
 */
describe('freebuff lane row (R-15)', () => {
  it('is a cli lane with tools but no session', () => {
    const freebuff = laneFor('freebuff');
    expect(freebuff.kind).toBe('cli');
    expect(freebuff.tools).toBe(true);
    expect(freebuff.session).toBe(false);
    expect(freebuff.degradedReason).toMatch(/TUI|terminal/i);
  });

  it('is degraded for resume and headless, not for tools', () => {
    expect(isDegraded('freebuff', 'resume')).toBe(true);
    expect(isDegraded('freebuff', 'headless')).toBe(true);
    expect(isDegraded('freebuff', 'tools')).toBe(false);
  });
});

describe('laneSupports (headless probe)', () => {
  it('is the negation of isDegraded for every lane x capability', () => {
    const caps = ['resume', 'headless', 'tools', 'session', 'plan'];
    for (const backend of Object.keys(LANES)) {
      for (const cap of caps) {
        expect(laneSupports(backend, cap)).toBe(!isDegraded(backend, cap));
      }
    }
  });

  it('answers the dispatch question: can this backend take a one-shot script prompt today', () => {
    expect(laneSupports('opencode', 'headless')).toBe(true);
    expect(laneSupports('cline', 'headless')).toBe(true);
    expect(laneSupports('grok', 'headless')).toBe(true);
    expect(laneSupports('freebuff', 'headless')).toBe(false);
    expect(laneSupports('gemini', 'headless')).toBe(true);
    expect(laneSupports('human', 'headless')).toBe(true);
  });

  it('throws on unknown lane like isDegraded', () => {
    expect(() => laneSupports('nope', 'headless')).toThrow(/unknown backend/);
  });
});
