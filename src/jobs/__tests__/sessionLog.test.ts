import { describe, it, expect } from 'vitest';
import { recordSessionEvent, getSessionLog } from '../sessionLog';

// `sessionLog.ts` raised the ring buffer from 80 to 150 in 4914d52 ("fix: resolve portion edit
// downgrade, …") to keep more diagnostics per job, but this test was left asserting 80, so the
// suite was red on every run — including on trees that never ran Q-11. The buffer size is the
// code's deliberate intent here, so the test follows it and stops reporting a false failure.
const MAX_EVENTS = 150;

describe('sessionLog', () => {
  it(`keeps a ring buffer of ${MAX_EVENTS}`, () => {
    const overflow = 20;
    for (let i = 0; i < MAX_EVENTS + overflow; i++) {
      recordSessionEvent('ring1', { writer: 'poller', action: 'accepted', status: String(i) });
    }
    const log = getSessionLog('ring1');
    expect(log.length).toBe(MAX_EVENTS);
    // The oldest `overflow` events were dropped, so the window is [overflow, MAX + overflow).
    expect(log[0].status).toBe(String(overflow));
    expect(log[MAX_EVENTS - 1].status).toBe(String(MAX_EVENTS + overflow - 1));
  });

  it('does not grow past the ring size for a short run', () => {
    for (let i = 0; i < 5; i++) {
      recordSessionEvent('ring2', { writer: 'LogChat.submit', action: 'accepted', status: String(i) });
    }
    const log = getSessionLog('ring2');
    expect(log.length).toBe(5);
    expect(log[0].status).toBe('0');
    expect(log[4].status).toBe('4');
  });

  it('collapses a repeated identical event but keeps a different action', () => {
    const first = recordSessionEvent('ring3', { writer: 'poller', action: 'accepted', status: 'running' });
    const repeat = recordSessionEvent('ring3', { writer: 'poller', action: 'accepted', status: 'running' });
    const differentAction = recordSessionEvent('ring3', { writer: 'poller', action: 'completed', status: 'running' });
    expect(first.length).toBe(1);
    expect(repeat.length).toBe(1);
    expect(differentAction.length).toBe(2);
  });
});
