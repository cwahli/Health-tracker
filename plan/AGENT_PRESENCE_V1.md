# Agent presence & claim — V1 plan

**Status:** proposal. Nothing implemented. Self-contained by design: it does not
edit `plan/ROADMAP.md` (CODEOWNERS: `@cwahli`, and it carries an active
sequence other agents are executing). Linking it into the roadmap is a separate,
deliberate step.

**Supersedes:** nothing. It replaces the *assumed* approach (scan PIDs, infer
intent) with what OpenCode already publishes.

---

## 1. The foundation: this is not a PID scanner

Measured on the VPS, 2026-10-02:

| observation | number |
|---|---|
| rows a naive PID scan emits | **14** |
| …of those, infrastructure daemons (`cline-hub-daemon`, 2× `worker-relay`, 2× `worker-agent`, `opencode serve`) | 7 |
| …idle TUI sessions aged 1d12h–2d15h | 3 |
| leaked dispatch processes reported as *live agents* | 3 (up to 6 days) |

A PID scan overcounts 3–4× before it is wrong once. The three leaked processes
(`run-coding-dispatch.sh`, PPID 1, zero git, zero log writes since Sep 25) would
each have been a live agent row.

**But the scan is unnecessary.** OpenCode 2.0.21 already publishes exactly the
facts a presence system needs, per session.

**Verified live on this box, 2026-10-02** (`opencode api get /api/session`,
50 sessions, 0 duplicate ids):

| need | source | live? |
|---|---|---|
| enumerate sessions | `GET /api/session` | yes |
| **per-session idle timestamp** | `time.idle` — 46 of 50 sessions non-zero | yes |
| created / updated / viewed | `time.{created,updated,viewed}` | yes |
| **working directory** | `location.directory` — 11 distinct across 50 sessions | yes |
| terminal outcome | `outcome` — `succeeded` / `failed` / `interrupted` | yes |
| which agent / model | `agent`, `model` | yes |
| transcript read | `GET /api/session/{id}/message` | yes |
| session log tail | `GET /api/experimental/session/{id}/log` | yes |

Actual field set returned by both `GET /api/session` and
`GET /api/session/{id}`:
`agent, cost, id, location, model, outcome, projectID, time, title, tokens`.

**Three corrections to the schema, which overstates itself:**

1. **`parentID` is declared in the OpenAPI `Session.Info` schema but is NOT
   returned.** Neither is `metadata`, `directory`, `revert` or `fork`. Do not
   build on them.
2. **Consequence: parent–child session modelling is not exposed.** The review's
   hardest requirement — "key the parent session, not every child PID; one row
   per session id" — therefore **dissolves rather than needs solving**. Measured:
   50 sessions, 0 duplicate ids. A process scanner double-counts children
   because a PID tree has many processes per session; a *session* scanner
   cannot, because one id is one row by construction. The overcount risk was an
   artifact of scanning processes, not of sessions.
3. **No branch or SHA in the payload.** Both must be derived from
   `location.directory` + git. Dedupe by directory first: 11 distinct cwds for 50
   sessions, so 11 git reads per scan, not 50.

`time.idle` is maintained by the product itself. **Phase 0 is a reader, not an
auditor.** The reviewer's hardest problem — "a live PID can be an idle statue" —
is a property of process tables, not of sessions; a session with a stale
`time.idle` and no `time.updated` movement is exactly as quiet as it looks.

Access: `opencode api get /api/session` — the built-in command handles service
discovery and auth; the raw endpoint returns `UnauthorizedError` without it.
OpenAPI at `/openapi.json`, 116 paths. `GET /api/session/active` exists
("List active sessions") but its response shape is **unconfirmed**; P0 treats
`/api/session` as the spine and `/active` as optional until proven.

---

## 2. Phases

Each phase is separately landable. **No phase starts before the previous
exits.** Nothing writes to the sheet before Phase 2's dry-run diff is accepted.

### P0 — Observe (read-only)

Enumerate sessions every scan. For each: `id`, `agent`, `model`, `outcome`,
`location.directory`, and `time.{created,updated,idle}`. Resolve branch + head
SHA from `location.directory` **once per distinct directory** (measured: 11
directories for 50 sessions). Write one JSON line per session per scan to a scan
ledger. **Touch nothing else.**

- **Gate:** a sensor asserting the reader never mutates — it runs, then a second
  read shows identical `time.idle` for untouched sessions.
- **Exit:** 72h of scans with no gaps, and the reader correctly reports the
  three known-leaked processes as *absent* (they have no session at all, which is
  the correct answer — a leaked shell is not a session).
- **Note:** non-opencode surfaces (hermes/Telegram bots, dispatch scripts) have
  no session id. P0 reports them in a **separate** `surface:` column and does
  not pretend they are sessions. See §6.

### P1 — Claim ledger and machine rows

A **claim** is a row: session id, claim start (UTC), branch, head SHA, surface.
Reconciliation is idempotent and additive.

- Claim is written by the watcher on **detection** (first scan where a session
  looks stuck), *not* by the agent. The agent does not self-report; see §5.
- **Hysteresis, in this direction and no other:** fire on the *first* good
  signal, clear only after **two consecutive quiet scans**. Two quiet scans is
  for *stopping* a row, never for waiting to speak.
- Quiet = `time.idle` beyond the bound **and** `time.updated` unchanged **and**
  no new commit on that session's branch since the claim's recorded SHA.
- Rows are **Pending** and machine-marked. The In-progress flip is a later,
  separately-reviewed change (§4).

**Gate:** a sensor over a throwaway fixture repo + a fake session feed, proving
(a) one scan of stuck → one row, (b) one quiet scan does not clear, (c) second
quiet scan clears, (d) reconciliation never overwrites a status a human moved.

**Exit:** a week of rows with zero false starts, measured (see P4).

### P2 — Nudge: the session inbox

`GET /api/session/{id}/inbox` exists, with `Session.Inbox.UserPayload`
(`text` required, plus `agents`/`files`/`metadata`/`skills`) and
`PATCH /api/session/{id}/inbox/{inboxID}`. The inbox is a product feature, not
something to build.

- **One nudge per open row, then a cooldown.** Never a loop.
- Channel: **the session inbox, or a note to the human.** Never Telegram to a
  seat bot — see §3.
- Skill text stays short: an inbox check and a claim line. Nothing else.

**Gate:** sensor proving one nudge per row, cooldown honoured, and no nudge when
the row is not yet past the detection bound.

**Exit:** nudges delivered, zero duplicates, and a recorded rate.

### P3 — Nudge: direct prompt (opt-in, idle-gated)

`POST /api/session/{id}/prompt` takes `{ text, agents?, skills?, files?, id? }`.
This is the supported "write into the session" path and is **preferred over any
terminal injection.**

Gate on all of:
- the session is **idle** (`time.idle` past the bound), not mid-turn;
- the session opted in (V1: a plan-owned opt-in file — `Session.Info.metadata`
  is **not returned** by 2.0.21, so it cannot carry the flag; see §6);
- one nudge per row per cooldown;
- the nudge is posted as a **labelled** message, never as unattributed user text.

`Session.Message.Synthetic` exists with a `description` field — a synthetic
message is *distinguishable* from something the human typed. **Use it.** A nudge
that is indistinguishable from the user's own message is a lie in the transcript.

`POST /api/session/{id}/interrupt` exists but is **out of scope for V1.**
Interrupting a running turn to deliver a reminder is a different, more dangerous
action and needs its own decision.

**Gate:** sensor proving no prompt is sent to a non-idle session, none to a
non-opted-in session, and that the nudge lands as a labelled message.

### P4 — Baseline, then policy

Only after P0–P3 have run long enough to measure:

- **claim rate**: sessions claimed within 20 minutes of detection.
- **unclaimed-ended** ages → digest. **N comes from this baseline, not a default.**
- The multi-claim flag is the WIP rule. **No numeric limit until the baseline
  exists.** "80% within 20 minutes" stays a hypothesis.

**V1 exit:** a live detection at ~12 minutes *and* a measured claim rate.

---

## 3. Corrections to the review, measured on this box

The review is sound in structure. Three of its specifics do not survive contact
with this fleet, and one is wrong:

1. **"Quiet means … no new git" cannot be used at repo scope.** The `*/5` cron
   `sync-workbench-clean-ff.sh` sweeps every worktree: **12,099 files touched in
   6 hours**, 83 worktrees, last run `12:26:56 pulled=0 current=83 skipped=7`.
   Repo-wide git churn is *permanently* true, so every dead session reads alive
   and nothing ever closes. **Scope the git signal to the session's own branch
   and the SHA recorded at claim start.** Not "the repo changed".

2. **The ~12-minute detection needs its own timer.** Available cadences are
   `*/2`, `*/5`, `*/15`, hourly. The `*/5` slot is occupied by the workbench
   sync. Do not hang presence scanning off it — that couples liveness to a job
   that touches every worktree.

3. **"A Telegram message to the seat bot wakes the poller" is wrong here.** The
   meal-audit loop posts hourly as `--profile=orchestrator`, yet the
   orchestrator's `state.db` was last modified **Sep 25 11:31** — 26+ posts, zero
   agent turns. The loop **borrows the bot identity without invoking the agent**.
   So the risk is not a spurious turn; it is a presence signal keyed on "did the
   seat bot post?" reading 26 events as 26 pieces of work. **Key liveness on
   `time.idle`/`time.updated`, never on outbound Telegram traffic.**

4. **"Git is ground truth" is true for presence, false for "landed".** Proven
   twice on this fleet: a squash-merged branch looked unlanded forever until
   `git cherry` reported `-`, and three stranded branches looked landed by plain
   reachability. If any surface infers *landed*, it must compare **patches, not
   shas** (shipped as `ab1a45e2`).

---

## 4. Non-goals (pinned)

- No transcript summarisation into notes. No fabricated summaries.
- No keystroke injection into a terminal. The supported paths are
  `session.prompt` and the inbox; `tmux send-keys` is not a transport.
- No cross-tool mind-reading: one observer, one key space, no inferring intent.
- No always-on daemon in V1. A cron that writes pointers is the right size.
- No writes to `scripts/agent-heartbeat.mjs` or the fleet beat files. That is
  **branch-keyed liveness** and the hygiene cleaner's trust anchor; this plan is
  **session-keyed claims**. Different key spaces, deliberately.
- Evidence recorded: pid, cwd, branch, SHA, session id, gate path + exit code.
  **Never gate output on the sheet.**
- Mobile stays read-only. A missed scan is not an ended session — partition
  rather than declare death.
- `Session.Info.time.idle` is the liveness source; `agent-heartbeat.mjs` is not
  the presence store and this plan does not make it one.

---

## 5. Pinned decisions, kept

- **Two signals, then reconcile.** Presence plus git evidence. Git evidence is
  the durable half; the committed diff is ground truth, and intent is never
  inferred from a transcript.
- **Claims and liveness stay apart.** Desired state, heartbeat, and observed
  result are three separate facts. A silent node is partitioned, not dead.
- **Hysteresis and exception-only review.** Fire on the first good signal, clear
  only after it stays quiet. Review exceptions, not everything.
- **Measure a baseline before any WIP limit.** Atlassian's rollout order.
- **Machine rows only** until a dry-run says otherwise. Reconciliation must
  never overwrite a status a human moved.
- **Keep the scan ledger** when a noise row leaves the sheet. Pure-noise rows
  may leave the human view; the detection log stays, or the "claimed within 20
  minutes" denominator loses exactly the sessions that never became a row.
- **Branch → ticket only with a time window, and only for git work.** A branch
  name alone collides when two sessions share a checkout — which this fleet
  already forbids for hub files.
- **The end hook records; it does not gate.** A session-end hook appends a
  marker. The reconciler plus the nudge produce the claim. "End requires a
  claim" belongs on the reconciler.
- **The hook appends where the tool has one.** Claude Code's `SessionEnd`
  cannot block exit (1.5s budget; async exit codes never return) and Codex,
  Cursor, Grok and OpenCode do not share the event. Hook where available; never
  depend on it.

---

## 6. Open questions for the human

1. **Non-opencode surfaces.** Hermes/Telegram bots and dispatch scripts have no
   session id — a leaked `run-coding-dispatch.sh` is a shell, not a session, so
   the session API is blind to it by design. P0 lists them under a separate
   `surface:` key read from process state. Should they get rows at all in V1, or
   stay out until they have a session id? Note the tension: adding them
   reintroduces exactly the PID-scanning the session API removes.
2. **Nudge default.** Inbox-only (safe, never interrupts) as the default, with
   `session.prompt` opt-in per session? Or prompt-by-default for seats that
   opted in at fleet level?
3. **Opt-in storage.** `Session.Info.metadata` is not returned by 2.0.21.
   A plan-owned JSON file, or `PATCH /api/session/{id}` (`session.update`) to set
   a field the API then keeps? The second is cleaner if the field survives a
   round-trip — unverified, and worth one probe before P3.
4. **Scan timer.** A dedicated `*/2` or `*/5` cron, or a systemd timer? A cron
   is one fewer moving part but shares the tab with jobs that can wedge.
5. **Retention.** The scan ledger is the baseline denominator, so it must
   outlive the sheet. How long, and does it need a monthly rollup?