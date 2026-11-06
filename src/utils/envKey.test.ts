import { describe, expect, it } from 'vitest';
import { cleanEnvValue, firstEnvValue } from './envKey';

// Regression: Oct-13 quoted-key outage. A double-quoted .env value must never
// reach an API caller with the quotes intact.
describe('cleanEnvValue', () => {
  it('strips matching double quotes', () => {
    expect(cleanEnvValue('"AQ.Ab8Rxyz"')).toBe('AQ.Ab8Rxyz');
  });
  it('strips matching single quotes', () => {
    expect(cleanEnvValue("'AQ.Ab8Rxyz'")).toBe('AQ.Ab8Rxyz');
  });
  it('trims surrounding whitespace (incl. inside quotes)', () => {
    expect(cleanEnvValue('  "AQ.Ab8Rxyz"  ')).toBe('AQ.Ab8Rxyz');
  });
  it('leaves unquoted values untouched', () => {
    expect(cleanEnvValue('AQ.Ab8Rxyz')).toBe('AQ.Ab8Rxyz');
  });
  it('leaves inner quotes alone', () => {
    expect(cleanEnvValue('say "hi"')).toBe('say "hi"');
  });
  it('leaves unbalanced quotes alone', () => {
    expect(cleanEnvValue('"oops')).toBe('"oops');
  });
  it('non-strings become empty', () => {
    expect(cleanEnvValue(undefined)).toBe('');
    expect(cleanEnvValue(null)).toBe('');
  });
});

describe('firstEnvValue', () => {
  it('first non-empty cleaned value wins', () => {
    expect(firstEnvValue(['A', 'B'], { A: '', B: '"k2"' })).toBe('k2');
    expect(firstEnvValue(['A', 'B'], { A: '"k1"', B: 'k2' })).toBe('k1');
  });
  it('empty when nothing set', () => {
    expect(firstEnvValue(['A', 'B'], {})).toBe('');
  });
});
