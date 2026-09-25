/**
 * V-30.4 scratch fixture — the packet-driven dispatch flow, proven offline on
 * a throwaway card. No production card is the test fixture; no HTTP.
 *
 * Walks the exact rows run-coding-dispatch.sh --ticket=#n posts through the
 * same server-side semantics (POST /attempts + PATCH blocked_reason):
 *   packed → attempt(start) → in_fix → attempt(committed, applied)
 *   → verifying → verify named_test green → done
 * plus the three negative laws:
 *   - failed dispatch keeps blocked_reason (not just escalated_human)
 *   - a green JOURNEY alone never closes the card
 *   - dispatchGuard refuses a second dispatch of an in_fix card
 */
import { describe, expect, it } from 'vitest';
import { applyAttempt, emptyWorkItem, type BugWorkItem, type BugCommit } from './bugWorkItem';
import { bugState, projectBugState } from './bugTicketState';
import {
  dispatchGuard,
  categoryFor,
  planFromPacket,
  parseSpec,
  specPathFor,
  DEFAULT_GATE,
} from '../../scripts/lib/bug-dispatch.mjs';

type PostedAttempt = {
  hyp: string;
  file?: string;
  test?: string;
  result: string;
  note?: string;
  actor?: string;
  /** body.burned === false (dispatcher bookkeeping rows); server defaults otherwise. */
  burnedFalse?: boolean;
  /** body.applied === true (commit landed) — server stamps the last commit attempt. */
  applied?: boolean;
};

/** Mirrors serverBugSnapshot POST /api/bugs/:tagId/attempts. */
function postAttempt(item: BugWorkItem, a: PostedAttempt): BugWorkItem {
  const result = a.result;
  const { item: next, rejected } = applyAttempt(item, {
    actor: a.actor || 'orchestrator',
    hyp: a.hyp,
    file: a.file || '',
    test: a.test || '',
    result,
    burned: a.burnedFalse === true ? false : !/green|pass/i.test(result),
    note: a.note,
  });
  if (rejected === 'already_burned') throw new Error(`unexpected rejected: ${rejected}`);
  let stamped = next;
  if (a.applied !== undefined) {
    const commits: BugCommit[] = next.commits.map((c, i) =>
      i === next.commits.length - 1 && c.attempt
        ? { ...c, attempt: { ...c.attempt, applied: a.applied } }
        : c,
    );
    stamped = { ...next, commits };
  }
  return projectBugState(stamped).item;
}

/** Mirrors PATCH /api/bugs/:tagId { blocked_reason, queue: 'blocked' }. */
function patchBlock(item: BugWorkItem, reason: string): BugWorkItem {
  return projectBugState({ ...item, blocked_reason: reason, queue: 'blocked' }).item;
}

function packedCard(): BugWorkItem {
  return emptyWorkItem({
    queue: 'ready',
    remaining: ['Weekly targets pill shows 7.7g after load'],
    defect: {
      component: 'WeeklyNutritionCard',
      observed: 'Omega-3 shows 7.700000000000001g',
      expected: '7.7g',
      criteria: 'Weekly targets pill shows 7.7g after load',
    },
    plan: {
      hypothesis: 'weeklyTarget is not rounded to 1 decimal',
      files: ['src/components/WeeklyNutritionCard.tsx'],
      gates: ['npx vitest run src/utils/bugDispatchFlow.test.ts'],
      by: 'orchestrator',
    },
  });
}

const scratchPacket = (state = 'packed', flags: Record<string, unknown> = {}) =>
  ({ state, flags, defect: { component: 'X', observed: 'o', expected: 'e', criteria: 'c' } }) as any;

describe('V-30.4 dispatch flow — packed → in_fix → verifying → done', () => {
  it('start row → in_fix; committed+applied row → verifying; named_test green → done', () => {
    let item = packedCard();
    expect(bugState(item).state).toBe('packed');

    // attempt START (dispatcher, post-lock): queue in_progress, author=orchestrator.
    item = postAttempt(item, {
      hyp: 'weeklyTarget is not rounded to 1 decimal',
      file: 'src/components/WeeklyNutritionCard.tsx',
      test: 'npx tsc --noEmit',
      result: 'start',
      note: 'dispatch start tool=opencode model=deepseek-v4.1-flash',
      burnedFalse: true,
    });
    expect(bugState(item).state).toBe('in_fix');
    expect(bugState(item).queue).toBe('in_progress');
    expect(item.commits.at(-1)?.attempt?.burned).toBe(false);

    // attempt END (dispatcher, commit pushed): applied=true → awaiting verifier.
    item = postAttempt(item, {
      hyp: 'weeklyTarget is not rounded to 1 decimal',
      file: 'src/components/WeeklyNutritionCard.tsx',
      test: 'npx tsc --noEmit',
      result: 'committed',
      note: 'pushed agent/dispatch-x (abc1234); awaiting non-author verifier',
      burnedFalse: true,
      applied: true,
    });
    expect(bugState(item).state).toBe('verifying');
    expect(bugState(item).flags.blocked_reason).toBeUndefined();

    // Verifier (not the author) posts named_test green → done.
    item = { ...item, verify: { result: 'green', method: 'named_test', command: 'npx tsc --noEmit', by: 'qa_meal' } as any };
    expect(bugState(item).state).toBe('done');
    expect(bugState(item).queue).toBe('done');
  });

  it('green journey alone stays verifying (JOURNEY_GREEN_DOES_NOT_CLOSE)', () => {
    let item = packedCard();
    item = postAttempt(item, { hyp: 'h', result: 'start', burnedFalse: true });
    item = postAttempt(item, { hyp: 'h', result: 'committed', burnedFalse: true, applied: true });
    item = { ...item, verify: { result: 'green', method: 'journey', command: 'node scripts/qa-runner.mjs --journey=meal', by: 'qa_meal' } as any };
    expect(bugState(item).state).toBe('verifying');
  });

  it('failed dispatch keeps blocked_reason (block, not only escalated_human)', () => {
    let item = packedCard();
    item = postAttempt(item, { hyp: 'h', result: 'start', burnedFalse: true });
    expect(bugState(item).state).toBe('in_fix');

    item = postAttempt(item, {
      hyp: 'h',
      result: 'failed: dispatch failed: opencode did not resolve (no fix committed)',
      note: 'dispatch failed: opencode did not resolve (no fix committed)',
      burnedFalse: true,
    });
    item = patchBlock(item, 'dispatch failed: opencode did not resolve (no fix committed)');

    const t = bugState(item);
    expect(t.flags.blocked_reason).toBe('dispatch failed: opencode did not resolve (no fix committed)');
    expect(t.state).not.toBe('done');
    expect(t.queue).toBe('blocked');
    // The end row is preserved in the attempt history.
    expect(item.commits.at(-1)?.attempt?.result).toMatch(/^failed:/);
  });

  it('bookkeeping rows never consume the burn budget', () => {
    let item = packedCard();
    for (let i = 0; i < 3; i++) {
      item = postAttempt(item, { hyp: `h${i}`, result: 'start', burnedFalse: true });
    }
    expect(bugState(item).flags.blocked_reason).toBeUndefined();
    expect(item.burns).toHaveLength(0);
  });
});

describe('dispatchGuard — idempotency (double-dispatch refusal)', () => {
  it('refuses an in_fix card', () => {
    const r = dispatchGuard(scratchPacket('in_fix'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/in_fix/);
  });

  it('refuses verifying, done, and unpacked cards', () => {
    expect(dispatchGuard(scratchPacket('verifying')).ok).toBe(false);
    expect(dispatchGuard(scratchPacket('done')).ok).toBe(false);
    expect(dispatchGuard(scratchPacket('new')).ok).toBe(false);
    expect(dispatchGuard({ state: 'packed', flags: {} }).ok).toBe(false); // no defect pack
  });

  it('refuses an archived card', () => {
    expect(dispatchGuard({ ...scratchPacket('packed'), archived_at: '2026-09-25T00:00:00Z' }).reason).toMatch(/archived/);
  });

  it('refuses blocked / not_reproducible / duplicate flags even when packed', () => {
    expect(dispatchGuard(scratchPacket('packed', { blocked_reason: 'burn_budget' })).reason).toMatch(/blocked_reason/);
    expect(dispatchGuard(scratchPacket('packed', { not_reproducible: true })).reason).toMatch(/not_reproducible/);
    expect(dispatchGuard(scratchPacket('packed', { duplicate_of: 'tag_y' })).reason).toMatch(/duplicate_of/);
  });

  it('allows a packed card, and allows the live lock holder (same run)', () => {
    expect(dispatchGuard(scratchPacket('packed')).ok).toBe(true);
    const sameRun = dispatchGuard(scratchPacket('in_fix'), { lockPid: 4242, selfPid: '4242' });
    expect(sameRun.ok).toBe(true);
    expect(sameRun.reason).toMatch(/same run/);
    expect(dispatchGuard(scratchPacket('in_fix'), { lockPid: 111, selfPid: 4242 }).ok).toBe(false);
  });
});

describe('plan artifact + spec + category (pure helpers)', () => {
  it('planFromPacket uses the spec allowed_files/gates and falls back to the default gate', () => {
    const spec = { allowed_files: ['src/x.ts'], gate: ['npx vitest run src/x.test.ts'], goal: 'show 7.7g' } as any;
    const ok = planFromPacket(scratchPacket(), spec);
    expect(ok.ok).toBe(true);
    expect(ok.hypothesis).toBe('show 7.7g');
    expect(ok.files).toEqual(['src/x.ts']);
    expect(ok.gates).toEqual(['npx vitest run src/x.test.ts']);

    const noGate = planFromPacket(scratchPacket(), { allowed_files: ['src/x.ts'], gate: [], goal: '' } as any);
    expect(noGate.ok).toBe(true);
    expect(noGate.gates).toEqual([DEFAULT_GATE]);

    const noSpec = planFromPacket(scratchPacket(), null);
    expect(noSpec.ok).toBe(false);
    expect(noSpec.reason).toMatch(/specs\/active/);
  });

  it('parseSpec reads TEMPLATE frontmatter lists + Goal line', () => {
    const spec = parseSpec(`---
id: card-2
status: draft
class: STALE_TURN
allowed_files:
  - src/components/WeeklyNutritionCard.tsx
frozen_files:
  - src/App.tsx
gate:
  - npx vitest run src/utils/bugDispatchFlow.test.ts
---

# card-2 — title

## Goal
Round weeklyTarget to one decimal.
`);
    expect(spec.allowed_files).toEqual(['src/components/WeeklyNutritionCard.tsx']);
    expect(spec.frozen_files).toEqual(['src/App.tsx']);
    expect(spec.gate).toEqual(['npx vitest run src/utils/bugDispatchFlow.test.ts']);
    expect(spec.goal).toBe('Round weeklyTarget to one decimal.');
    expect(spec.class).toBe('STALE_TURN');
  });

  it('specPathFor prefers card-<n>.md then <tag_id>.md', () => {
    expect(specPathFor('specs/active', 13, 'F-13')).toMatch(/F-13\.md$/);
    expect(specPathFor('specs/active', 999999, 'tag_nope')).toBe('');
  });

  it('categoryFor maps surfaces to dispatch categories', () => {
    expect(categoryFor('home')).toBe('meal');
    expect(categoryFor('biomarker')).toBe('biomarker');
    expect(categoryFor('onboarding')).toBe('onboarding');
    expect(categoryFor('')).toBe('general');
  });
});
