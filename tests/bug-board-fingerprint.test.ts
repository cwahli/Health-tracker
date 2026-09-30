import { describe, it, expect } from 'vitest';
import { overviewPayloadKey, workItemChangeKey } from '../src/components/bug-board/useBugBoard';

// Sensor for the bot-vs-board drift class: steward mutations that rewrite
// work_item JSON without bumping updated_at/status must still flip the
// board fingerprint, otherwise the quiet poller skips setData and the board
// shows stale Class/State while `bugctl list` is already fresh.
const tag = (over = {}) => ({
  id: 'tag_test_001',
  updated_at: '2026-09-25 09:28:04',
  status: 'to_fix',
  category: 'foodcart',
  linked_count: 1,
  title: 'BUG-20260921-8449 re-open',
  work_item: JSON.stringify({
    public_n: 7,
    queue: 'ready',
    class: 'UI',
    commits: [],
    remaining: ['nav labels'],
    done: [],
    ...over,
  }),
});

const payload = (tags) => ({ bugTags: tags, allReports: [], deletionCandidates: [] });

describe('overviewPayloadKey work_item sensitivity', () => {
  it('is stable for identical payloads', () => {
    expect(overviewPayloadKey(payload([tag()]))).toBe(overviewPayloadKey(payload([tag()])));
  });

  it('flips on class-only curation (same updated_at/status)', () => {
    const before = overviewPayloadKey(payload([tag()]));
    const after = overviewPayloadKey(payload([tag({ class: 'CLONE_UI' })]));
    expect(after).not.toBe(before);
  });

  it('flips on queue/block change (same updated_at/status)', () => {
    const before = overviewPayloadKey(payload([tag()]));
    const after = overviewPayloadKey(
      payload([tag({ queue: 'blocked', blocked_reason: 'dispatch failed' })])
    );
    expect(after).not.toBe(before);
  });

  it('flips on remaining/done movement (same updated_at/status)', () => {
    const before = overviewPayloadKey(payload([tag()]));
    const after = overviewPayloadKey(payload([tag({ remaining: [], done: ['nav labels'] })]));
    expect(after).not.toBe(before);
  });

  it('never throws on corrupt work_item strings', () => {
    const bad = { ...tag(), work_item: '{not-json' };
    expect(() => workItemChangeKey(bad)).not.toThrow();
    expect(() => overviewPayloadKey(payload([bad]))).not.toThrow();
  });

  it('handles tags with no work_item', () => {
    const bare = { ...tag() };
    delete bare.work_item;
    expect(() => overviewPayloadKey(payload([bare]))).not.toThrow();
  });
});
