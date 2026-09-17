import { describe, it, expect } from 'vitest';
import { recordSessionEvent, getSessionLog } from '../sessionLog';

describe('sessionLog', () => {
  it('keeps a ring buffer of 80', () => {
    for (let i = 0; i < 90; i++) {
      recordSessionEvent('ring1', { writer: 'poller', action: 'accepted', status: String(i) });
    }
    const log = getSessionLog('ring1');
    expect(log.length).toBe(80);
    expect(log[0].status).toBe('10');
    expect(log[79].status).toBe('89');
  });
});
