import { describe, expect, it } from 'vitest';
import { isRefusalText } from './frame-refusal';

describe('isRefusalText (framed-tab refusal probe)', () => {
  it('reads the exact gateway refusal', () => {
    expect(isRefusalText('{"ok":false,"error":"bad token"}')).toBe(true);
  });
  it('reads Chrome pretty-printed refusal (newlines + spaces)', () => {
    expect(isRefusalText('{\n  "ok": false,\n  "error": "bad token"\n}')).toBe(true);
  });
  it('reads refusal with a different reason', () => {
    expect(isRefusalText('{"ok":false,"error":"token expired"}')).toBe(true);
  });
  it('does not fire on a live app page', () => {
    expect(isRefusalText('⚡\nCentral Compliance & Agenda\n● LIVE VM')).toBe(false);
  });
  it('does not fire on a success envelope', () => {
    expect(isRefusalText('{"ok":true,"token":"abc"}')).toBe(false);
  });
  it('does not fire on empty / mounting frames', () => {
    expect(isRefusalText('')).toBe(false);
  });
  it('does not fire on terminal transcripts that mention JSON', () => {
    expect(isRefusalText('$ curl /api/x\n{"ok":true}')).toBe(false);
  });
});
