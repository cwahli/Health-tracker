/**
 * red-main-notice.mjs — the file a red `main` leaves behind.
 *
 * WHY THIS EXISTS
 * ---------------
 * `merge-gate.mjs` refuses the next merge while `main` is red. That is the right
 * reflex and it was the whole of it, which left the worst state this repository
 * can be in completely silent:
 *
 *   - `main` fails its post-merge verification;
 *   - the gate refuses every `agent/**` PR from then on;
 *   - and NOTHING says so. No issue, no annotation, no line anywhere a human
 *     would look. The queue simply stops, and the first person to notice is
 *     whoever pushes next and wonders why their green PR is not merging.
 *
 * A block with no announcement is indistinguishable from every other kind of
 * stall — a queued runner, a flaky network, an agent that walked away. The
 * consequence existed and the cause was invisible, so the module that produces
 * the consequence names the cause: once per incident, in an issue, with the
 * commit, the failed check, and the way out.
 *
 * WHAT "RED" MEANS HERE, AND WHY IT IS NOT "NOT GREEN"
 * ----------------------------------------------------
 * This is the part that must not be sloppy, because a false alarm trains people
 * to ignore the alarm. The notice fires on exactly one condition: a verification
 * of `main` **concluded a failure**. It does not fire on the states the gate
 * itself refuses to read as red:
 *
 *   - a verification that has not concluded (`queued`, `in_progress`) — that is
 *     the in-progress window, and the merge is HELD for it, not refused;
 *   - `cancelled` — the live normal state of a commit a newer merge superseded;
 *     nothing is verified and nothing is wrong;
 *   - absent — no verification was ever recorded, which is not evidence of
 *     failure.
 *
 * `evaluateMainHealth` already draws that line (it is the only place that knows
 * which check names are verifications of `main`, and which conclusions mean
 * broken), so this module does not redraw it: the merge driver passes the
 * verdict it already computed, and the workflow passes the gate's own job
 * result through `resultToState` — which maps `cancelled` and `skipped` to
 * "ignore" rather than to red, for the same reason.
 *
 * ONE INCIDENT, ONE ISSUE
 * -----------------------
 * The issue is found by its exact title, and it is *maintained* rather than
 * re-filed: the first red creates it, later reds comment on it (so the timeline
 * shows how long the queue was stalled and what it stalled), and a verification
 * that concludes `success` comments once and closes it. If it re-opened a fresh
 * issue per refused PR the signal would become the noise, and if it never closed
 * it would become a permanent open issue nobody reads.
 *
 * A repeat is deliberately NOT deduplicated. Two refusals minutes apart are two
 * real facts about the size of the outage, and the alternative — comparing
 * against the last comment, which needs another paginated read — buys quiet at
 * the cost of a second thing that can be wrong.
 *
 * FAILING TO NOTIFY IS NOT FAILING TO BLOCK
 * -----------------------------------------
 * Every network path here is wrapped: a 403, a 500, a rate limit or a missing
 * token returns `{ action: 'failed' }` and says so in the log — it never throws
 * and it never changes the merge decision. The refusal is decided before this
 * runs and does not depend on it. What it must not do is fail *quietly*, so the
 * failure is reported as an annotation and as a line beginning `!!!`.
 *
 * The title-and-sha work is pure and driven directly by the sensors; the
 * `call` function is injected so the same code runs against a loopback fake.
 */

/** The issue is found by this exact title — there is no label to depend on. */
export const MAIN_RED_ISSUE_TITLE = '[ci] main is red — the merge queue is blocked';

/** Stamped into the issue body so tooling can recognise its own output. */
export const MAIN_RED_MARKER = '<!-- health-tracker:main-red -->';

export const MAIN_VERIFY_WORKFLOW = '.github/workflows/main-verify.yml';
export const AUTO_MERGE_WORKFLOW = '.github/workflows/auto-merge.yml';

/** The entry point `main-verify.yml` runs. */
export const NOTICE_SCRIPT = 'scripts/notify-main-red.mjs';

export const NOTICE_ACTIONS = ['create', 'comment', 'close', 'none', 'failed'];

/** The one job result that means `main` verified green. */
export const VERIFICATION_GREEN_RESULT = 'success';

/**
 * Job results that mean `main` is genuinely broken.
 *
 * `failure` is the only one a workflow job reports for "the gates said no",
 * including a job that timed out or whose runner died — those surface as
 * `failure` here even though the *check* conclusion is `timed_out` or
 * `startup_failure`, which `merge-gate.mjs` also counts as broken.
 */
export const VERIFICATION_RED_RESULTS = new Set(['failure']);

/**
 * Translate a gate's job result into what the notice should do.
 *
 * `cancelled` and `skipped` are NOT red: a canceled verification is a newer
 * merge superseding this one (that is the documented live state of
 * `main-verify`'s concurrency group), and treating it as broken would announce
 * an outage on every second merge. Unrecognised values are ignored rather than
 * guessed at.
 */
export function resultToState(result) {
  const value = String(result || '').trim();
  if (value === VERIFICATION_GREEN_RESULT) return 'green';
  if (VERIFICATION_RED_RESULTS.has(value)) return 'red';
  return 'ignore';
}

const shortSha = (sha) => (sha ? `\`${String(sha).slice(0, 7)}\`` : '`main`');

/** True when an issue row is the standing red-`main` notice. */
export function isNoticeIssue(issue, { title = MAIN_RED_ISSUE_TITLE } = {}) {
  if (!issue || typeof issue !== 'object') return false;
  // The issues endpoint returns pull requests too, and a PR is never the notice.
  if (issue.pull_request) return false;
  if (String(issue.state || 'open') !== 'open') return false;
  return String(issue.title || '').trim() === title;
}

/** The open notice issue, or null. Pure, so the sensor can drive every shape. */
export function findNoticeIssue(issues, opts = {}) {
  return (Array.isArray(issues) ? issues : []).find((issue) => isNoticeIssue(issue, opts)) || null;
}

/**
 * What to do about `state` given whether the notice is already open.
 *
 * Kept separate from the I/O and exhaustive in both directions: "red with no
 * issue" opens one, "red with an issue" records the repeat, "green with an
 * issue" closes it, and "green with no issue" does nothing at all — the last
 * one matters, because a green `main` is the overwhelming majority of the time
 * and it must cost nothing and touch nothing.
 */
export function decideNotice({ state, openIssue } = {}) {
  if (state === 'red') {
    return openIssue
      ? { action: 'comment', number: openIssue.number, reason: 'main is still red' }
      : { action: 'create', reason: 'main is red and nobody has been told' };
  }
  if (state === 'green') {
    return openIssue
      ? { action: 'close', number: openIssue.number, reason: 'main verifies green again' }
      : { action: 'none', reason: 'main is green and no notice is open' };
  }
  return { action: 'none', reason: `state "${String(state)}" is neither red nor green` };
}

/** The durable record of a red `main`: what broke, why it matters, how out. */
export function buildRedIssueBody({
  mainSha = '',
  mainReason = '',
  conclusion = 'failure',
  failed = [],
  blockedBy = null,
  overridden = false,
  at = '',
} = {}) {
  const lines = [
    MAIN_RED_MARKER,
    '',
    `**\`main\` is red.** A post-merge verification of ${shortSha(mainSha)} concluded \`${conclusion}\`, and`,
    '`merge-agent-pr` now refuses **every** `agent/**` pull request until a verification of `main`',
    'concludes `success`. The queue is stalled, and this issue is the reason.',
    '',
  ];
  if (mainReason) lines.push('```', String(mainReason), '```', '');
  lines.push('### What failed', '');
  if (Array.isArray(failed) && failed.length) {
    for (const failure of failed) lines.push(`- \`${failure}\``);
  } else {
    lines.push(`- the post-merge verification of ${shortSha(mainSha)} (\`gates / tsc + named gates\`)`);
  }
  lines.push('', '### What it blocks', '');
  if (blockedBy) {
    lines.push(
      `- ${blockedBy} — its own required checks passed, and the merge was refused because of \`main\``,
    );
  } else {
    lines.push(
      '- every `agent/**` pull request: their own gates can be green and the merge still refuses,',
      '  because landing on a known-broken tree turns one break into two',
    );
  }
  if (overridden) {
    lines.push(
      '',
      '⚠️ A merge has been pushed through anyway with the `--allow-red-main` override, so `main`',
      'carries a change that was never verified. Treat the next verification as authoritative.',
    );
  }
  lines.push(
    '',
    '### How to recover',
    '',
    '1. Fix the tree on an `agent/**` branch and let the PR head go green — the refusal is about',
    '   `main`, not about that PR, so its own checks are not what is failing.',
    '2. Land it through the override: **Actions → auto-merge → Run workflow**, the PR number, and',
    '   ✅ `allow_red_main`. Without the override there is no way out — the only way to change',
    '   `main` is to merge, and every merge is refused.',
    '3. That merge dispatches a fresh verification of `main`. **This issue closes itself** the',
    '   moment one concludes `success`.',
    '',
    'A direct push to `main` is the path that skips the gate which would have caught this. Prefer',
    'the PR.',
    '',
    `_Maintained by \`scripts/lib/red-main-notice.mjs\`${at ? ` — opened ${at}` : ''}._`,
  );
  return lines.join('\n');
}

/** The timeline entry for "and it is still red". */
export function buildRecurrenceComment({ mainSha = '', conclusion = 'failure', blockedBy = null, at = '' } = {}) {
  const who = blockedBy ? ` — it refused ${blockedBy}` : '';
  const when = at ? ` at ${at}` : '';
  return [
    `${MAIN_RED_MARKER} \`main\` is **still red**${when}: ${shortSha(mainSha)} concluded \`${conclusion}\`${who}.`,
    '',
    'The queue is still stalled. See the top of this issue for the way out.',
  ].join('\n');
}

/** The timeline entry for "and it is green again", posted before closing. */
export function buildRecoveryComment({ mainSha = '', at = '' } = {}) {
  const when = at ? ` (${at})` : '';
  return [
    `✅ A verification of \`main\` concluded \`success\` on ${shortSha(mainSha)}${when}.`,
    '',
    'The merge queue is unblocked and this issue closes itself.',
  ].join('\n');
}

/** One line a human can read in a run log. */
export function describeNotice(outcome) {
  if (!outcome || typeof outcome !== 'object') return 'main-red notice: no attempt was made';
  switch (outcome.action) {
    case 'create':
      return `main-red notice: opened issue #${outcome.number} — main is red and the queue is blocked`;
    case 'comment':
      return `main-red notice: recorded the repeat on issue #${outcome.number}`;
    case 'close':
      return `main-red notice: closed issue #${outcome.number} — main verifies green again`;
    case 'none':
      return `main-red notice: nothing to report (${outcome.reason || 'no change'})`;
    case 'failed':
      return `main-red notice: NOT reported (${outcome.detail || 'unknown error'})`;
    default:
      return `main-red notice: unknown action ${JSON.stringify(outcome.action)}`;
  }
}

/**
 * GitHub turns `::error::` written to a step's stdout into a run annotation,
 * which is the one bit of a green-looking run list a human notices. Outside
 * Actions it is meaningless noise, so it is only emitted where it lands.
 */
function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::${level}::${message}`);
}

/**
 * Every open issue, newest first, paginated but bounded.
 *
 * `sort=created&direction=desc` because the notice is recent by construction, so
 * the common case is the first page; the bound exists so a repository with
 * thousands of open issues cannot turn a notification into a timeout. The
 * endpoint returns pull requests alongside issues (filtered by `isNoticeIssue`).
 */
export async function listOpenIssues(call, owner, repo, { perPage = 100, maxPages = 5 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await call(
      `/repos/${owner}/${repo}/issues?state=open&sort=created&direction=desc&per_page=${perPage}&page=${page}`,
    );
    const rows = Array.isArray(batch) ? batch : [];
    out.push(...rows);
    if (rows.length < perPage) break;
  }
  return out;
}

/**
 * Say it out loud, and leave the record.
 *
 * Returns an outcome rather than throwing: this runs beside a decision that has
 * already been made, and a notification that cannot be filed must not become a
 * merge that was not refused. It reports the failure instead — loudly, because a
 * silent notifier is the bug this file was written to remove.
 *
 * @param {object}   opts
 * @param {Function} opts.call     the injected REST client (`makeClient().call`)
 * @param {string}   opts.owner
 * @param {string}   opts.repo
 * @param {'red'|'green'} opts.state
 * @param {object}   opts.details  `{ mainSha, mainReason, conclusion, failed, blockedBy, overridden, at }`
 */
export async function syncRedMainNotice({ call, owner, repo, state, details = {}, log = console.log, warn = console.error } = {}) {
  const at = details.at || new Date().toISOString();
  const detail = { ...details, at };
  const concise = detail.mainReason || `${shortSha(detail.mainSha)} did not verify`;

  if (state === 'red') {
    // The loud part, and it comes BEFORE any API call on purpose: the run log and
    // the annotation are the report of last resort, so they must not depend on
    // the very API whose failure they would otherwise be hiding. Both land in the
    // run that noticed, so the person reading a stalled PR finds the reason
    // without knowing to go and look at `main`.
    annotate('error', `main is red${detail.mainSha ? ` (${String(detail.mainSha).slice(0, 7)})` : ''} — every agent PR is refused until it verifies green`);
    warn(`!!! MAIN IS RED — the merge queue is blocked: ${concise}`);
  }

  try {
    const open = await listOpenIssues(call, owner, repo);
    const existing = findNoticeIssue(open);
    const decision = decideNotice({ state, openIssue: existing });

    if (decision.action === 'none') {
      if (state === 'green') log('main is green again and no red-main notice was open — nothing to do');
      return { action: 'none', reason: decision.reason, issue: existing ? existing.number : null, at };
    }

    if (decision.action === 'create') {
      const body = buildRedIssueBody(detail);
      const created = await call(`/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        body: { title: MAIN_RED_ISSUE_TITLE, body },
      });
      const outcome = { action: 'create', number: created?.number ?? null, url: created?.html_url ?? null, at };
      log(describeNotice(outcome));
      return outcome;
    }

    if (decision.action === 'comment') {
      const body = state === 'red' ? buildRecurrenceComment(detail) : buildRecoveryComment(detail);
      await call(`/repos/${owner}/${repo}/issues/${decision.number}/comments`, { method: 'POST', body: { body } });
      const outcome = { action: 'comment', number: decision.number, at };
      if (state === 'red') warn(`!!! ${describeNotice(outcome)}`); else log(describeNotice(outcome));
      return outcome;
    }

    // close: comment first, so the issue's last words explain why it shut.
    await call(`/repos/${owner}/${repo}/issues/${decision.number}/comments`, {
      method: 'POST',
      body: { body: buildRecoveryComment(detail) },
    });
    await call(`/repos/${owner}/${repo}/issues/${decision.number}`, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    });
    const outcome = { action: 'close', number: decision.number, at };
    log(describeNotice(outcome));
    return outcome;
  } catch (err) {
    const outcome = { action: 'failed', detail: err?.message || String(err), state, at };
    // A failure to report is itself reportable, and it is the one thing this
    // module may never do quietly.
    annotate('error', `main-red notice could not be filed: ${outcome.detail}`);
    warn(`!!! ${describeNotice(outcome)} — ${state === 'red' ? 'main is STILL red and the queue is still blocked' : 'a recovery may be left unrecorded'}`);
    return outcome;
  }
}

/** The lines of a workflow belonging to one job id (2-space key), or null. */
function jobBlock(text, jobId) {
  const lines = String(text || '').split('\n');
  const escaped = String(jobId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((line) => new RegExp(`^ {2}${escaped}:\\s*$`).test(line));
  if (start === -1) return null;
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join('\n');
}

/** Every indented key/value pair of one job, as `key: value` pairs. */
function jobKeys(block) {
  const out = {};
  for (const line of String(block || '').split('\n')) {
    const m = line.match(/^ {4}([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Check that the notice has somewhere to be filed and something to file it.
 *
 * A notifier whose wiring is broken is the exact silent no-op this change exists
 * to remove, so the entry point refuses to run against a workflow that cannot
 * report — rather than logging "nothing to report" while `main` is red. Every
 * problem is returned, not just the first, so one run names all of them.
 */
export function validateNoticeWiring({ readWorkflow } = {}) {
  const problems = [];
  if (typeof readWorkflow !== 'function') return { ok: false, problems: ['no workflow reader was provided'] };
  const read = (rel) => {
    try {
      return readWorkflow(rel) || '';
    } catch {
      return null;
    }
  };

  const verify = read(MAIN_VERIFY_WORKFLOW);
  if (verify === null) {
    problems.push(`${MAIN_VERIFY_WORKFLOW} is missing (a red main would be reported by nobody)`);
  } else {
    const block = jobBlock(verify, 'notice');
    if (block === null) {
      problems.push(`${MAIN_VERIFY_WORKFLOW} has no "notice" job (main's result is not reported anywhere)`);
    } else {
      const keys = jobKeys(block);
      if (keys.needs !== 'gates') {
        problems.push(`${MAIN_VERIFY_WORKFLOW} "notice" does not \`needs: gates\` (it would report a result that has not happened)`);
      }
      if (!/^always\(\)$/.test(String(keys.if || ''))) {
        // Without this the job is skipped exactly when the gate fails — i.e. the
        // one case it exists for is the one case it would not run in.
        problems.push(`${MAIN_VERIFY_WORKFLOW} "notice" is not \`if: always()\` (it would be skipped whenever main is red)`);
      }
      if (!String(block).includes('notify-main-red.mjs')) {
        problems.push(`${MAIN_VERIFY_WORKFLOW} "notice" does not run ${NOTICE_SCRIPT}`);
      }
    }
    if (!/^ {2}issues:\s*write\s*$/m.test(verify)) {
      problems.push(`${MAIN_VERIFY_WORKFLOW} does not grant \`issues: write\` (the notice would be a 403)`);
    }
  }

  const merge = read(AUTO_MERGE_WORKFLOW);
  if (merge === null) {
    problems.push(`${AUTO_MERGE_WORKFLOW} is missing`);
  } else if (!/^ {2}issues:\s*write\s*$/m.test(merge)) {
    problems.push(`${AUTO_MERGE_WORKFLOW} does not grant \`issues: write\` (a refusal could not say why it was refused)`);
  }

  return { ok: problems.length === 0, problems };
}
