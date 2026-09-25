/**
 * V-30.1 — derived ticket state (S-C-lite, P2 decided 2026-09-24).
 *
 * Roles never set a state; they post artifacts (defect, repro, plan, attempts, verify).
 * bugState() is the one pure projection — server-side on every write (§4.3.4/§4.3.5).
 * mapLegacyStatus() stays and is an input, not replaced (widening).
 *
 * Vocabulary: new → packed → in_fix → verifying → done
 *   + flags: needs_repro, not_reproducible, blocked_reason, duplicate_of.
 * There is NO agent-settable state route — state is always derived.
 */

import {
  BURN_BUDGET,
  mapLegacyStatus,
  type BugAttempt,
  type BugCommit,
  type BugCurationEvent,
  type BugHandoff,
  type BugRepro,
  type BugWorkItem,
} from './bugWorkItem';

export type BugStateName = 'new' | 'packed' | 'in_fix' | 'verifying' | 'done';

export const BUG_STATE_NAMES: readonly BugStateName[] = ['new', 'packed', 'in_fix', 'verifying', 'done'];

export type BugStateFlags = {
  needs_repro?: boolean;
  not_reproducible?: boolean;
  blocked_reason?: string;
  duplicate_of?: string;
};

export type BugTicketState = {
  state: BugStateName;
  flags: BugStateFlags;
  /** Legacy-compatible issue_tags.status value (to_fix | fixed). */
  legacy_status: 'to_fix' | 'fixed';
  /** Legacy-compatible queue for old readers. */
  queue: BugWorkItem['queue'];
};

export type ReproConsensusResult = {
  ok: boolean;
  match: boolean;
  escalated: boolean;
  status: string;
  consensus?: string;
  blocked_reason?: string;
  escalation_assignee?: string;
  reason?: string;
  count: number;
  verdicts: Array<{ status: string; by?: string; [k: string]: any }>;
};

/**
 * Evaluate reproduction verdicts on a card (BOT-21 rule).
 * "Two repro verdicts on one card must match or escalate."
 */
export function evaluateReproVerdicts(verdictsRaw: any = []): ReproConsensusResult {
  const rawList = Array.isArray(verdictsRaw)
    ? verdictsRaw
    : verdictsRaw?.verdicts || [verdictsRaw?.prev, verdictsRaw?.next].filter(Boolean);

  const verdicts = (rawList || [])
    .map((v: any) => (typeof v === 'string' ? { status: v } : v))
    .filter((v: any) => v && typeof v.status === 'string');

  const substantive = verdicts.filter((v: any) =>
    ['confirmed', 'failed', 'ambiguous'].includes(v.status)
  );

  if (substantive.length === 0) {
    return {
      ok: true,
      match: true,
      escalated: false,
      status: verdicts[0]?.status || 'none',
      count: 0,
      verdicts,
    };
  }

  if (substantive.length === 1) {
    return {
      ok: true,
      match: true,
      escalated: false,
      status: substantive[0].status,
      consensus: substantive[0].status,
      count: 1,
      verdicts: substantive,
    };
  }

  // Two or more substantive verdicts: check consensus
  const firstStatus = substantive[0].status;
  const allMatch = substantive.every((v: any) => v.status === firstStatus && v.status !== 'ambiguous');

  if (allMatch) {
    return {
      ok: true,
      match: true,
      escalated: false,
      status: firstStatus,
      consensus: firstStatus,
      count: substantive.length,
      verdicts: substantive,
    };
  }

  // Conflict / mismatch / ambiguous -> ESCALATE!
  const statusSummary = substantive.map((v: any) => `${v.by ? v.by + ':' : ''}${v.status}`).join(' vs ');
  return {
    ok: true,
    match: false,
    escalated: true,
    status: 'ambiguous',
    blocked_reason: 'repro_verdict_conflict',
    escalation_assignee: 'orchestrator',
    reason: `Two repro verdicts on one card conflict (${statusSummary}); escalated with blocked_reason=repro_verdict_conflict`,
    count: substantive.length,
    verdicts: substantive,
  };
}

function lastAttemptRow(item: BugWorkItem): (BugAttempt & { applied?: boolean }) | undefined {
  for (let i = item.commits.length - 1; i >= 0; i--) {
    const a = item.commits[i]?.attempt;
    if (a) return a;
  }
  if (item.burns.length) return item.burns[item.burns.length - 1];
  return undefined;
}

function burnedCount(item: BugWorkItem): number {
  return item.burns.filter((b) => b.burned).length;
}

/**
 * Pure projection: artifacts + legacy queue → S-C-lite state + flags.
 * Precedence (full §4.3.4 collapsed to lite §4.3.5):
 *   done → (blocked flag) → (duplicate flag) → verifying → in_fix
 *        → packed (planned/reproduced/needs_repro/not_repro collapse here) → new
 */
export function bugState(item: BugWorkItem): BugTicketState {
  const flags: BugStateFlags = {};

  if (item.duplicate_of) flags.duplicate_of = String(item.duplicate_of);

  let blockedReason = item.blocked_reason ? String(item.blocked_reason) : undefined;
  if (!blockedReason && burnedCount(item) >= BURN_BUDGET) blockedReason = 'burn_budget';
  // Legacy queue=blocked without an explicit reason still flags blocked.
  if (!blockedReason && mapLegacyStatus(undefined, item.queue) === 'blocked') {
    blockedReason = 'queue_blocked';
  }

  // BOT-21: Multi-verdict consensus check
  if (Array.isArray(item.repro_verdicts) && item.repro_verdicts.length >= 2) {
    const reproEval = evaluateReproVerdicts(item.repro_verdicts);
    if (!reproEval.match && reproEval.escalated) {
      if (!blockedReason) {
        blockedReason = reproEval.blocked_reason || 'repro_verdict_conflict';
      }
      flags.not_reproducible = true;
    } else if (reproEval.status === 'failed') {
      flags.not_reproducible = true;
    }
  }

  if (blockedReason) flags.blocked_reason = blockedReason;

  if (item.repro?.status === 'needed') flags.needs_repro = true;
  if (item.repro && (item.repro.status === 'failed' || item.repro.status === 'ambiguous')) {
    flags.not_reproducible = true;
  }

  const legacy = mapLegacyStatus(undefined, item.queue);
  const lastAtt = lastAttemptRow(item);
  const hasAgentAttempt = item.commits.some((c: BugCommit) => !!c.attempt);

  let state: BugStateName;
  const verifyMethod = item.verify?.method;
  const verifyGreen = item.verify?.result === 'green';
  // JOURNEY_GREEN_DOES_NOT_CLOSE — a green qa-runner journey stays verifying.
  // done requires the card's own named_test, or a manual human check.
  if (verifyGreen && (verifyMethod === 'named_test' || verifyMethod === 'manual')) {
    state = 'done';
  } else if (verifyGreen && verifyMethod === 'journey') {
    state = 'verifying';
  } else if (legacy === 'done') {
    // Legacy fixed/ignored without a verify artifact still reads as done.
    state = 'done';
  } else if (lastAtt?.applied && !item.verify) {
    state = 'verifying';
  } else if (hasAgentAttempt && legacy === 'in_progress' && !item.verify) {
    state = 'in_fix';
  } else if (item.plan || item.repro?.status === 'confirmed' || item.defect) {
    // planned / reproduced / needs_repro / not_reproducible / packed → packed
    state = 'packed';
  } else if (legacy === 'in_progress' || legacy === 'blocked') {
    // Old cards mid-work with no new artifacts keep their progress.
    state = legacy === 'blocked' ? 'packed' : 'in_fix';
  } else {
    state = 'new';
  }

  // blocked is a flag, not a state — but queue=blocked is preserved for old readers.
  let queue: BugWorkItem['queue'];
  if (state === 'done') queue = 'done';
  else if (flags.blocked_reason && (legacy === 'blocked' || flags.blocked_reason === 'repro_verdict_conflict')) queue = 'blocked';
  else if (state === 'in_fix' || state === 'verifying') queue = 'in_progress';
  else if (legacy === 'blocked') queue = 'blocked';
  else if (legacy === 'in_progress') queue = 'in_progress';
  else queue = 'ready';

  const legacy_status: 'to_fix' | 'fixed' = state === 'done' ? 'fixed' : 'to_fix';

  return { state, flags, legacy_status, queue };
}

/** Project state onto a work_item copy (persists `state`, syncs queue for old readers). */
export function projectBugState(item: BugWorkItem): { item: BugWorkItem; ticket: BugTicketState } {
  const ticket = bugState(item);
  const next: BugWorkItem = {
    ...item,
    state: ticket.state,
    queue: ticket.queue,
    blocked_reason: ticket.flags.blocked_reason,
    duplicate_of: ticket.flags.duplicate_of,
  };
  if (!ticket.flags.blocked_reason) delete next.blocked_reason;
  if (!ticket.flags.duplicate_of) delete next.duplicate_of;
  return { item: next, ticket };
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function curationHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function curationSnapshot(item: BugWorkItem, titleOverride?: string | null) {
  return {
    revision: Number(item.revision || 0),
    title: titleOverride === undefined ? item.bug : titleOverride,
    bug: item.bug,
    class: item.class,
    surface: item.surface,
    assignee: item.assignee,
    archived_at: item.archived_at,
    archive_reason: item.archive_reason,
    defect: item.defect || null,
  };
}

const CURATION_FIELDS = new Set(['op', 'expected_revision', 'reason', 'title', 'class', 'surface', 'assignee', 'component', 'expected', 'criteria']);
const FORBIDDEN_CURATION_FIELDS = new Set(['observed', 'defect', 'repro', 'repro_verdicts', 'plan', 'verify', 'attempts', 'burns', 'commits', 'current_evidence', 'queue', 'state', 'done', 'remaining', 'parked', 'blocked_reason', 'duplicate_of']);

export function validateCuration(body: any): ValidationResult<any> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'curation body required' };
  const forbidden = Object.keys(body).find((key) => FORBIDDEN_CURATION_FIELDS.has(key));
  if (forbidden) return { ok: false, error: `curation cannot change ${forbidden}` };
  const unknown = Object.keys(body).find((key) => !CURATION_FIELDS.has(key));
  if (unknown) return { ok: false, error: `curation field not allowed: ${unknown}` };
  const op = String(body.op || 'review');
  if (!['review', 'edit', 'rewrite', 'handoff', 'archive'].includes(op)) return { ok: false, error: `unsupported curation op: ${op}` };
  const expectedRevision = Number(body.expected_revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return { ok: false, error: 'expected_revision is required' };
  const reason = String(body.reason || '').trim();
  if (!reason) return { ok: false, error: 'curation reason is required' };
  if (op === 'handoff' && String(body.assignee || '') !== 'orchestrator') return { ok: false, error: 'handoff assignee must be orchestrator' };
  const value: any = { op, expected_revision: expectedRevision, reason };
  for (const key of ['title', 'class', 'surface', 'assignee', 'component', 'expected', 'criteria']) {
    if (body[key] !== undefined) value[key] = body[key] === null ? null : String(body[key]).trim();
  }
  if (value.title === '') return { ok: false, error: 'title cannot be empty' };
  if (value.assignee && !['bug_ticket', 'qa_meal', 'qa_biomarker', 'qa_onboarding', 'orchestrator', 'human'].includes(value.assignee)) return { ok: false, error: `unknown assignee: ${value.assignee}` };
  return { ok: true, value };
}

export function applyCuration(item: BugWorkItem, body: any, now = new Date().toISOString()) {
  const validated = validateCuration(body);
  if (!validated.ok) return validated as { ok: false; error: string };
  const input = validated.value;
  const currentRevision = Number(item.revision || 0);
  if (input.op === 'handoff' && !item.defect) return { ok: false, error: 'handoff requires a packed defect' };
  if (currentRevision !== input.expected_revision) return { ok: false, error: `stale revision: expected ${input.expected_revision}, current ${currentRevision}` };
  const beforeHash = curationHash(curationSnapshot(item));
  const next: BugWorkItem = {
    ...item,
    defect: item.defect ? { ...item.defect } : item.defect,
    revision: currentRevision + 1,
    curation_events: [...(item.curation_events || [])],
  };
  if (input.class !== undefined) next.class = input.class || undefined;
  if (input.surface !== undefined) next.surface = (input.surface || undefined) as any;
  if (input.assignee !== undefined) next.assignee = (input.assignee || undefined) as any;
  if (item.defect) {
    if (input.component !== undefined) next.defect!.component = input.component || item.defect.component;
    if (input.expected !== undefined) next.defect!.expected = input.expected || item.defect.expected;
    if (input.criteria !== undefined) next.defect!.criteria = input.criteria || item.defect.criteria;
  }
  if (input.op === 'archive') {
    next.archived_at = now;
    next.archive_reason = input.reason;
    delete next.handoff;
  } else if (input.op !== 'handoff') {
    delete next.handoff;
  }
  const afterHash = curationHash(curationSnapshot(next, input.title));
  const event: BugCurationEvent = {
    id: `${now}-${currentRevision + 1}`,
    at: now,
    actor: 'bug_ticket',
    op: input.op,
    reason: input.reason,
    from_revision: currentRevision,
    to_revision: currentRevision + 1,
    before_hash: beforeHash,
    after_hash: afterHash,
  };
  next.curation_events!.push(event);
  if (input.op === 'handoff') {
    const handoff: BugHandoff = {
      from: 'bug_ticket',
      to: 'orchestrator',
      revision: next.revision!,
      at: now,
      packet_hash: afterHash,
      status: 'ready',
    };
    next.handoff = handoff;
  }
  return { ok: true, value: next, title: input.title, event, before_hash: beforeHash, after_hash: afterHash };
}

/** Validate a posted defect artifact (exactly the Single Verifiable Defect shape). */
export function validateDefect(body: any): ValidationResult<NonNullable<BugWorkItem['defect']>> {
  const component = String(body?.component || '').trim();
  const observed = String(body?.observed || '').trim();
  const expected = String(body?.expected || '').trim();
  const criteria = String(body?.criteria || '').trim();
  if (!component || !observed || !expected || !criteria) {
    return { ok: false, error: 'defect requires component, observed, expected, criteria' };
  }
  return { ok: true, value: { component, observed, expected, criteria } };
}

export function validateRepro(body: any): ValidationResult<NonNullable<BugWorkItem['repro']>> {
  const status = String(body?.status || '').trim();
  const allowed = ['not_needed', 'needed', 'confirmed', 'failed', 'ambiguous'];
  if (!allowed.includes(status)) {
    return { ok: false, error: `repro.status must be one of ${allowed.join(', ')}` };
  }
  const repro: NonNullable<BugWorkItem['repro']> = { status: status as any };
  if (body?.command !== undefined) repro.command = String(body.command);
  if (body?.params !== undefined) repro.params = body.params;
  if (body?.run_log !== undefined) repro.run_log = String(body.run_log);
  if (body?.before !== undefined) repro.before = String(body.before);
  if (body?.after !== undefined) repro.after = String(body.after);
  if (body?.expected !== undefined) repro.expected = String(body.expected);
  if (body?.actual !== undefined) repro.actual = String(body.actual);
  if (body?.exit_code !== undefined && body?.exit_code !== null) repro.exit_code = Number(body.exit_code);
  if (body?.by !== undefined) repro.by = String(body.by);
  repro.at = new Date().toISOString();
  if (status === 'confirmed' && (!repro.command || repro.exit_code === undefined)) {
    return { ok: false, error: 'confirmed repro requires command and exit_code' };
  }
  if ((status === 'failed' || status === 'ambiguous') && !repro.run_log) {
    return { ok: false, error: `${status} repro requires run_log` };
  }
  return { ok: true, value: repro };
}

export function validatePlan(body: any): ValidationResult<NonNullable<BugWorkItem['plan']>> {
  const hypothesis = String(body?.hypothesis || '').trim();
  const files = Array.isArray(body?.files) ? body.files.map(String).filter(Boolean) : [];
  const gates = Array.isArray(body?.gates) ? body.gates.map(String).filter(Boolean) : [];
  if (!hypothesis || !files.length || !gates.length) {
    return { ok: false, error: 'plan requires hypothesis, files[], gates[]' };
  }
  const plan: NonNullable<BugWorkItem['plan']> = { hypothesis, files, gates };
  if (body?.approach !== undefined) plan.approach = String(body.approach);
  if (Array.isArray(body?.risks)) plan.risks = body.risks.map(String);
  if (Array.isArray(body?.blocked_by)) plan.blocked_by = body.blocked_by.map(String);
  if (body?.by !== undefined) plan.by = String(body.by);
  plan.at = new Date().toISOString();
  return { ok: true, value: plan };
}

export function validateVerify(body: any): ValidationResult<NonNullable<BugWorkItem['verify']>> {
  const method = String(body?.method || 'named_test');
  if (!['named_test', 'journey', 'manual'].includes(method)) {
    return { ok: false, error: 'verify.method must be named_test | journey | manual' };
  }
  const command = String(body?.command || '').trim();
  const result = String(body?.result || '').trim();
  if (result !== 'green' && result !== 'red') {
    return { ok: false, error: 'verify.result must be green | red' };
  }
  if (!command) return { ok: false, error: 'verify requires command' };
  const evidence = Array.isArray(body?.evidence) ? body.evidence.map(String) : [];
  const verify: NonNullable<BugWorkItem['verify']> = {
    method: method as any,
    command,
    result,
    evidence,
  };
  if (body?.by !== undefined) verify.by = String(body.by);
  verify.at = new Date().toISOString();
  return { ok: true, value: verify };
}
