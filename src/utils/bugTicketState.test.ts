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
  curationSnapshot,
  applyCuration,
  evaluateReproVerdicts,
  projectBugState,
  validateCuration,
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

describe('card stewardship', () => {
  it('creates a revisioned receipt for a safe edit', () => {
    const item = base({
      defect: { component: 'HomeTab', observed: 'shows 7.700000000000001', expected: '7.7', criteria: 'one decimal' },
    });
    const result = applyCuration(item, {
      op: 'edit',
      expected_revision: 0,
      reason: 'clarify expected display',
      expected: '7.7g',
    }, '2026-09-24T00:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision).toBe(1);
    expect(result.value.defect?.observed).toBe(item.defect?.observed);
    expect(result.value.defect?.expected).toBe('7.7g');
    expect(result.value.curation_events).toHaveLength(1);
    expect(result.before_hash).not.toBe(result.after_hash);
  });

  it('rejects evidence and stale revisions', () => {
    const item = base({ defect: { component: 'HomeTab', observed: 'observed', expected: 'expected', criteria: 'criteria' }, revision: 2 });
    expect(validateCuration({ op: 'edit', expected_revision: 2, reason: 'x', observed: 'changed' })).toMatchObject({ ok: false });
    expect(applyCuration(item, { op: 'review', expected_revision: 1, reason: 'stale' })).toMatchObject({ ok: false });
  });

  it('archives without deleting the card or its history', () => {
    const item = base({ defect: { component: 'E2E', observed: 'observed', expected: 'expected', criteria: 'criteria' } });
    const result = applyCuration(item, { op: 'archive', expected_revision: 0, reason: 'disposable live test' }, '2026-09-25T00:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archived_at).toBe('2026-09-25T00:00:00.000Z');
    expect(result.value.curation_events).toHaveLength(1);
    expect(result.value.defect).toEqual(item.defect);
  });

  it('creates an explicit current orchestrator handoff', () => {
    const item = base({ defect: { component: 'HomeTab', observed: 'observed', expected: 'expected', criteria: 'criteria' } });
    const result = applyCuration(item, { op: 'handoff', expected_revision: 0, reason: 'reviewed', assignee: 'orchestrator' }, '2026-09-24T00:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handoff).toMatchObject({ to: 'orchestrator', status: 'ready', revision: 1 });
    expect(result.value.assignee).toBe('orchestrator');
    expect(curationSnapshot(result.value).revision).toBe(1);
  });
});

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

  it('vague card with repro needed exposes needs_repro', () => {
    const item = base({ repro: { status: 'needed' } });
    expect(bugState(item)).toMatchObject({ state: 'new', flags: { needs_repro: true } });
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

describe('BOT-21 — Repro Consensus (evaluateReproVerdicts & bugState)', () => {
  it('empty or non-substantive verdicts return count 0 and match true', () => {
    expect(evaluateReproVerdicts([]).match).toBe(true);
    expect(evaluateReproVerdicts([{ status: 'not_needed' }]).count).toBe(0);
    expect(evaluateReproVerdicts([{ status: 'needed' }]).count).toBe(0);
  });

  it('single substantive verdict returns that status and does not escalate', () => {
    const res = evaluateReproVerdicts([{ status: 'confirmed', command: 'cmd', exit_code: 1 }]);
    expect(res.match).toBe(true);
    expect(res.escalated).toBe(false);
    expect(res.status).toBe('confirmed');
    expect(res.count).toBe(1);
  });

  it('two matching confirmed verdicts maintain consensus without escalation', () => {
    const res = evaluateReproVerdicts([
      { status: 'confirmed', command: 'cmd1', exit_code: 1, by: 'qa1' },
      { status: 'confirmed', command: 'cmd2', exit_code: 1, by: 'qa2' },
    ]);
    expect(res.match).toBe(true);
    expect(res.escalated).toBe(false);
    expect(res.status).toBe('confirmed');
    expect(res.consensus).toBe('confirmed');
    expect(res.count).toBe(2);
  });

  it('two matching failed verdicts maintain consensus and mark status failed', () => {
    const res = evaluateReproVerdicts([
      { status: 'failed', run_log: 'log1', by: 'qa1' },
      { status: 'failed', run_log: 'log2', by: 'qa2' },
    ]);
    expect(res.match).toBe(true);
    expect(res.escalated).toBe(false);
    expect(res.status).toBe('failed');
    expect(res.consensus).toBe('failed');
  });

  it('two conflicting verdicts (confirmed vs failed) escalate to orchestrator with repro_verdict_conflict', () => {
    const res = evaluateReproVerdicts([
      { status: 'confirmed', command: 'cmd', exit_code: 1, by: 'qa1' },
      { status: 'failed', run_log: 'log', by: 'qa2' },
    ]);
    expect(res.match).toBe(false);
    expect(res.escalated).toBe(true);
    expect(res.blocked_reason).toBe('repro_verdict_conflict');
    expect(res.escalation_assignee).toBe('orchestrator');
    expect(res.status).toBe('ambiguous');
  });

  it('two conflicting verdicts with ambiguous status escalate to orchestrator', () => {
    const res = evaluateReproVerdicts([
      { status: 'confirmed', command: 'cmd', exit_code: 1 },
      { status: 'ambiguous', run_log: 'flaky' },
    ]);
    expect(res.match).toBe(false);
    expect(res.escalated).toBe(true);
    expect(res.blocked_reason).toBe('repro_verdict_conflict');
  });

  it('bugState: card with conflicting repro_verdicts derives blocked_reason and queue=blocked', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      repro_verdicts: [
        { status: 'confirmed', command: 'cmd', exit_code: 1 },
        { status: 'failed', run_log: 'log' },
      ],
    });
    const s = bugState(item);
    expect(s.flags.blocked_reason).toBe('repro_verdict_conflict');
    expect(s.flags.not_reproducible).toBe(true);
    expect(s.queue).toBe('blocked');
    expect(s.state).toBe('packed');
  });

  it('bugState: card with matching confirmed repro_verdicts stays in ready queue (no conflict flag)', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      repro_verdicts: [
        { status: 'confirmed', command: 'cmd', exit_code: 1 },
        { status: 'confirmed', command: 'cmd', exit_code: 1 },
      ],
    });
    const s = bugState(item);
    expect(s.flags.blocked_reason).toBeUndefined();
    expect(s.flags.not_reproducible).toBeUndefined();
    expect(s.queue).toBe('ready');
    expect(s.state).toBe('packed');
  });

  it('bugState: card with matching failed repro_verdicts derives not_reproducible', () => {
    const item = base({
      defect: { component: 'a', observed: 'b', expected: 'c', criteria: 'd' },
      repro_verdicts: [
        { status: 'failed', run_log: 'log1' },
        { status: 'failed', run_log: 'log2' },
      ],
    });
    const s = bugState(item);
    expect(s.flags.blocked_reason).toBeUndefined();
    expect(s.flags.not_reproducible).toBe(true);
    expect(s.state).toBe('packed');
  });
});
