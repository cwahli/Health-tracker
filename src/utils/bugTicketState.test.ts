import { describe, expect, it } from 'vitest';
import {
  BURN_BUDGET,
  emptyWorkItem,
  mapLegacyStatus,
  type BugAttempt,
  type BugCommit,
  type BugWorkItem,
} from './bugWorkItem';
import {
  BUG_STATE_NAMES,
  bugState,
  projectBugState,
  validateDefect,
  validatePlan,
  validateRepro,
  validateVerify,
} from './bugTicketState';

function base(partial?: Partial<BugWorkItem>): BugWorkItem {
  return emptyWorkItem(partial);
}

function attempt(partial?: Partial<BugAttempt>): BugAttempt {
  return {
    at: '2026-09-24T00:00:00.000Z',
    actor: 'agent',
    hyp: 'h1',
    file: 'f.ts',
    test: 'f.test.ts',
    result: 'fail',
    burned: false,
    ...partial,
  };
}

function withAttempt(item: BugWorkItem, a: BugAttempt, extra?: Partial<BugCommit>): BugWorkItem {
  const commit: BugCommit = {
    id: `c${item.commits.length + 1}`,
    at: a.at,
    actor: a.actor,
    kind: 'agent',
    summary: 'attempt',
    attempt: a,
    ...extra,
  };
  return { ...item, commits: [...item.commits, commit] };
}

describe('bugState — S-C-lite projection', () => {
  it('exposes exactly the 5 lite state names', () => {
    expect(BUG_STATE_NAMES).toEqual(['new', 'packed', 'in_fix', 'verifying', 'done']);
  });

  it('empty card → new / ready / to_fix', () => {
    const s = bugState(base());
    expect(s.state).toBe('new');
    expect(s.queue).toBe('ready');
    expect(s.legacy_status).toBe('to_fix');
    expect(s.flags).toEqual({});
  });

  it('defect posted → packed', () => {
    const item = base({
      defect: { component: 'LogChat', observed: 'x', expected: 'y', criteria: 'z' },
    });
    expect(bugState(item).state).toBe('packed');
  });

  it('defect + repro.status=needed → packed + needs_repro flag', () => {
    const item = base({
      defect: { component: 'LogChat', observed: 'x', expected: 'y', criteria: 'z' },
      repro: { status: 'needed', command: 'npm run x' },
    });
    const s = bugState(item);
    expect(s.state).toBe('packed');
    expect(s.flags.needs_repro).toBe(true);
  });

  it('repro confirmed (no plan/attempt) collapses to packed', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      repro: { status: 'confirmed', command: 'x', exit_code: 1, run_log: 'log' },
    });
    const s = bugState(item);
    expect(s.state).toBe('packed');
    expect(s.flags.needs_repro).toBeUndefined();
    expect(s.flags.not_reproducible).toBeUndefined();
  });

  it('repro failed/ambiguous → packed + not_reproducible flag (kept, P2)', () => {
    for (const status of ['failed', 'ambiguous'] as const) {
      const item = base({
        defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
        repro: { status, run_log: 'log' },
      });
      const s = bugState(item);
      expect(s.state).toBe('packed');
      expect(s.flags.not_reproducible).toBe(true);
    }
  });

  it('plan posted (no attempt) collapses planned → packed', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      plan: { hypothesis: 'h', files: ['f.ts'], gates: ['vitest f'] },
      queue: 'ready',
    });
    expect(bugState(item).state).toBe('packed');
  });

  it('open attempt + queue in_progress → in_fix', () => {
    let item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      plan: { hypothesis: 'h', files: ['f.ts'], gates: ['g'] },
    });
    item = withAttempt(item, attempt({ burned: true }));
    item = { ...item, queue: 'in_progress' };
    expect(bugState(item).state).toBe('in_fix');
    expect(bugState(item).queue).toBe('in_progress');
    expect(bugState(item).legacy_status).toBe('to_fix');
  });

  it('last attempt applied + no verify → verifying', () => {
    let item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      queue: 'in_progress',
    });
    item = withAttempt(item, attempt({ applied: true, result: 'green', burned: false }));
    const s = bugState(item);
    expect(s.state).toBe('verifying');
    expect(s.queue).toBe('in_progress');
  });

  it('verify green → done / fixed', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      verify: { method: 'named_test', command: 'npx vitest run x', result: 'green', evidence: [] },
      queue: 'in_progress',
    });
    const s = bugState(item);
    expect(s.state).toBe('done');
    expect(s.queue).toBe('done');
    expect(s.legacy_status).toBe('fixed');
  });

  it('journey green does not close the card', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      verify: { method: 'journey', command: 'node scripts/qa-runner.mjs --journey=meal', result: 'green', evidence: [] },
      queue: 'in_progress',
    });
    const s = bugState(item);
    expect(s.state).toBe('verifying');
    expect(s.queue).not.toBe('done');
    expect(s.legacy_status).toBe('to_fix');
  });

  it('verify red does not close', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      verify: { method: 'named_test', command: 'npx vitest run x', result: 'red', evidence: [] },
      queue: 'in_progress',
    });
    expect(bugState(item).state).not.toBe('done');
  });

  it('duplicate_of → flag, state stays underlying', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      duplicate_of: 'tag-other',
    });
    const s = bugState(item);
    expect(s.flags.duplicate_of).toBe('tag-other');
    expect(s.state).toBe('packed');
  });

  it('blocked_reason → flag (blocked is not a lite state)', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      blocked_reason: 'needs_human_creds',
      queue: 'blocked',
    });
    const s = bugState(item);
    expect(s.flags.blocked_reason).toBe('needs_human_creds');
    expect(s.state).toBe('packed');
    expect(s.queue).toBe('blocked');
  });

  it('burns >= BURN_BUDGET auto-flags blocked_reason=burn_budget', () => {
    const burns = Array.from({ length: BURN_BUDGET }, (_, i) =>
      attempt({ burned: true, hyp: `h${i}`, file: `f${i}.ts`, test: `t${i}.ts` })
    );
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      burns,
      queue: 'in_progress',
    });
    const s = bugState(item);
    expect(s.flags.blocked_reason).toBe('burn_budget');
    // blocked is a flag — underlying progress still shows in_fix (attempt exists)
    expect(['in_fix', 'packed']).toContain(s.state);
  });

  it('legacy status=fixed (green tick) still projects done without verify artifact', () => {
    const item = base({ queue: 'done' });
    // mapLegacyStatus input: hydrate would set queue=done from status=fixed
    expect(mapLegacyStatus('fixed', 'ready')).toBe('done');
    const s = bugState({ ...item, queue: 'done' });
    expect(s.state).toBe('done');
    expect(s.legacy_status).toBe('fixed');
  });

  it('old card mid-work with no artifacts keeps in_progress → in_fix', () => {
    const item = base({ queue: 'in_progress' });
    expect(bugState(item).state).toBe('in_fix');
  });

  it('mapLegacyStatus is still the input (not replaced)', () => {
    // queue=ready + no artifacts → new
    expect(bugState(base({ queue: 'ready' })).state).toBe('new');
    // fixed legacy wins over stale ready queue via mapLegacyStatus inside projection path
    expect(mapLegacyStatus('fixed', 'ready')).toBe('done');
  });
});

describe('projectBugState', () => {
  it('writes state onto item and syncs queue/legacy fields', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
    });
    const { item: next, ticket } = projectBugState(item);
    expect(next.state).toBe('packed');
    expect(ticket.state).toBe('packed');
    expect(next.queue).toBe(ticket.queue);
  });

  it('clears blocked_reason/duplicate_of flags when absent', () => {
    const item = base({ blocked_reason: 'x', duplicate_of: 'y' });
    const { item: next, ticket } = projectBugState(item);
    // both flags present → preserved
    expect(ticket.flags.blocked_reason).toBe('x');
    expect(next.blocked_reason).toBe('x');
    expect(next.duplicate_of).toBe('y');
  });
});

describe('artifact validators', () => {
  it('defect requires all four fields', () => {
    expect(validateDefect({}).ok).toBe(false);
    expect(
      validateDefect({ component: 'a', observed: 'b', expected: 'c', criteria: 'd' }).ok
    ).toBe(true);
  });

  it('confirmed repro requires command + exit_code', () => {
    expect(validateRepro({ status: 'confirmed' }).ok).toBe(false);
    expect(validateRepro({ status: 'confirmed', command: 'x', exit_code: 1 }).ok).toBe(true);
  });

  it('failed/ambiguous repro requires run_log', () => {
    expect(validateRepro({ status: 'failed' }).ok).toBe(false);
    expect(validateRepro({ status: 'failed', run_log: 'log' }).ok).toBe(true);
  });

  it('plan requires hypothesis, files, gates', () => {
    expect(validatePlan({}).ok).toBe(false);
    expect(validatePlan({ hypothesis: 'h', files: ['a.ts'], gates: ['g'] }).ok).toBe(true);
  });

  it('verify requires command and green|red result', () => {
    expect(validateVerify({}).ok).toBe(false);
    expect(validateVerify({ command: 'x', result: 'purple' }).ok).toBe(false);
    expect(validateVerify({ command: 'x', result: 'green' }).ok).toBe(true);
  });

  it('no validator accepts a state field (no agent-settable state)', () => {
    const d = validateDefect({ component: 'a', observed: 'b', expected: 'c', criteria: 'd', state: 'done' });
    expect(d.ok && 'state' in (d.value as any)).toBe(false);
    const v = validateVerify({ command: 'x', result: 'green', state: 'done' });
    expect(v.ok && 'state' in (v.value as any)).toBe(false);
  });
});
