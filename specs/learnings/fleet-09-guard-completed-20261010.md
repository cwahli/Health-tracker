# Fleet-09 archaeology: `spec:fleet-miniapp` gate unverifiable as written (2026-10-10)

Role: process-archaeology, report only. No code changed, no guard/spec edits,
no sheet status change. One file added (this note); one Work-done line appended
to the Fleet-09 row (`current!C25`); Status stays `Assigned`.

## Verdict up front

- Named sensor green, re-run here: `node scripts/assert-fleet-miniapp.test.mjs`
  → **17 pass / 0 fail**.
- Outer guard red, re-run here: `node scripts/assert-spec-diff.mjs fleet-miniapp`
  → `FAIL spec_not_locked: fleet-miniapp.md status=completed (must be locked
  before implement)`. So `node scripts/journey-guard.mjs fleet-miniapp` (which
  runs spec-diff as its `spec-diff` node, `scripts/journey-guard.mjs:97`) cannot
  pass on a clean tree. The row's Completion gate
  (`scripts/assert-fleet-miniapp.test.mjs: 4 pass; … journey-guard … GUARD PASS`)
  is therefore **unverifiable as written**: its first half is green, its second
  half cites a guard run from before the status flip (see §2).
- This is a **spec-lifecycle artifact, not a code regression**. Nothing about
  the failure suggests the /fleet implementation is broken.

## What `completed` means here

`completed` is not a lifecycle value — it is a one-off handoff annotation. The
canonical status set is `draft | locked | done`
(`docs/agent/LOCKED_SPEC_PROCESS.md:86`), and completed packets are closed by
**moving** `specs/active/<ID>.md` → `specs/done/<ID>.md` (Turn 5,
`LOCKED_SPEC_PROCESS.md:359-373`; cf. `specs/done/R-13.md`, which keeps
`status: locked` and marks done-ness by directory). `fleet-miniapp` instead
stayed in `specs/active/` with a non-enumerated status, so every consumer that
filters on `locked` (guard, discover queue) now misreads it: not implementable,
not closable by script, and invisible to the night queue for the wrong reason.

## 1. What the guard's locked-requirement protects

Enforcement point: `scripts/assert-spec-diff.mjs:148-151` — any status other
than `locked` is an immediate `spec_not_locked` fail **before** the
allowed/frozen/rewrite checks run.

It protects four things:

1. **Verify means "code matches the frozen contract."** After lock, the spec
   body (Allowed / Frozen / invariants) is frozen memory
   (`LOCKED_SPEC_PROCESS.md:97,128`). If Verify ran against a `draft` (still
   editable) or a post-hoc status, an implementer could widen `allowed_files`
   after the fact and paint the gate green — failure class `SPEC_DRIFT`
   (`LOCKED_SPEC_PROCESS.md:136-144`: "implementer edited the locked spec …
   revert spec; fix code instead").
2. **Builder-start discipline.** `journey-guard.mjs:144-155` (`interrupt_before
   builder`) plus `docs/agent/JOURNEY.md:46` (`go → packet status: locked`)
   ensure no application diffs land while the packet is still a draft. The
   `locked` check is the machine-readable half of the human `go`.
3. **Unattended-queue eligibility.** `scripts/discover-gated-work.mjs:44`
   queues only packets with `status === 'locked'` (and `auto_go`). A non-locked
   value keeps landed work out of the night loop — correct outcome here, but
   only by accident of a non-canonical string rather than by the `done/`
   location the queue design assumes.
4. **Standing/GUARD credibility.** `standing` + `spec-diff` run on every guard
   invocation (`journey-guard.mjs:96-97`). A bypass (e.g. accepting `completed`
   as pass) would let any future packet self-certify by renaming its status
   instead of meeting the contract — the exact "edit the script that says fail"
   move the Reviewer role exists to forbid (`JOURNEY.md:79-85`).

What breaks if bypassed: post-hoc Allowed-widening passes Verify; draft
packets accumulate application diffs without `interrupt` firing; completed
work re-enters the auto-go queue (if re-locked in place) or rots in `active/`
forever (as now), where the next agent must re-derive "is this done?" from
prose instead of from location + gate log.

## 2. Spec file state and history on main

- **Now:** `specs/active/fleet-miniapp.md` frontmatter `status: completed`,
  gate `node scripts/assert-fleet-miniapp.test.mjs`. Body carries a
  `## Landed Implementation (PR #475, #481, #482)` section plus
  `## Next Handoff Actions for Cold Agent` (→ R-15). Landed code itself is not
  under question here.
- **Only two commits ever touch it on main:**
  - `35511a8a` (2026-10-02 12:55 UTC, via github-actions[bot],
    trailer `Author: Gemini 3.8 Flash (High) Mac`): creates the packet with
    `status: locked` alongside the implementation. Commit message records all
    gates green **including** `journey-guard fleet-miniapp (GUARD PASS)` —
    consistent: the guard passed while the packet was still `locked`.
  - `3dde40ff` (2026-10-02 16:51 +0100, via github-actions[bot], same Mac
    trailer): docs-only handoff (`specs/active/fleet-miniapp.md` +
    `AI_HANDOVER.md`) flipping `locked` → `completed` and recording PR #482
    status. No application code in the diff.
- **Checkpoints agree with the locked era:** `specs/checkpoints/fleet-miniapp/
  builder-start` and `builder-end` both snapshot the packet with
  `status: locked` (heads `a425c974` / `0e472a43`, 2026-10-02 ~11:07–11:18Z).
- **Was the work proven? Yes, at the time and more so now.** At `3dde40ff`:
  `assert-fleet-miniapp` 11/11, `assert-tui-gateway` 131/131,
  `assert-health-group` 118/118, `tsc --noEmit` clean (per commit message; the
  2026-10-02 AI_HANDOVER entries corroborate 6/6 → 11/11 across #475 → #482).
  Since then the sensor grew with the code (dual-layout projection #542,
  `auto:` keys, Drive FILE-link case — see 2026-10-04 fleet-tab-split
  AI_HANDOVER entry) to today's **17/17**. The red half is purely the status
  string the completion commit left behind.
- **Known context:** `plan/HANDOFF_2026-10-02.md:250-254` already flags the
  pattern — "implementing PR merged but packet still in `active/`" (lists
  `fleet-miniapp` #475 among others): "coordinate with the landing agent
  first — several carry a live `## Left`." The `## Left` here (R-15 pointer,
  on-device screenshot witness) was the reason floated for keeping it visible;
  the cost is the guard state above.

## 3. Legitimate resolution paths (nothing applied — guard and spec are protected)

| Path | Files touched | Who must confirm |
|------|---------------|------------------|
| **A. Close flow (promote → `specs/done/`)** — move `specs/active/fleet-miniapp.md` → `specs/done/fleet-miniapp.md` (done-ness by location, per R-13 precedent; keep or set status per human call) + one `AI_HANDOVER.md` line. | spec path (rename), `AI_HANDOVER.md` | human (`promote`, JOURNEY.md:65) and/or landing-agent coordination per HANDOFF_2026-10-02 §250-254; merge via normal PR, never direct to main |
| **B. Re-lock in place** — set frontmatter back to `status: locked`. | spec frontmatter (1 line) | human `go`/lock authority only — agents cannot unlock/re-lock (`LOCKED_SPEC_PROCESS.md:421`: "you lock; agent cannot unlock"; AGENTS.md §3 protects the process). Risks re-queuing landed work into `discover-gated-work` if `auto_go` is set |
| **C. Gate-text fix on the sheet row** — amend Fleet-09 Completion-gate cell to cite only the runnable named sensor (`node scripts/assert-fleet-miniapp.test.mjs`, 17/17 today) and record journey-guard as N/A-post-completion with pointer to this note. | sheet cell only, no repo files | human/PM (shared board truth); sibling `agent/gate-sweep` (PR #705) already annotates this row — coordinate, don't overwrite |
| **D. Guard exemption for terminal states (REJECTED)** — teaching `assert-spec-diff.mjs` to pass `completed`/`done` in place. | `scripts/assert-*.mjs` (protected) | would require a human before→after under AGENTS.md §3, and it weakens what "pass" means for every packet — do not do this to close one row |

## Recommendation: path A (close flow), optionally + C as annotation

- Restores the canonical invariant (active/ ≡ locked-or-draft; done-ness ≡
  `done/` location + gate log) without touching guard semantics.
- Ends the ambiguity the night queue and the next cold agent would otherwise
  re-derive from prose: after the move, `assert-spec-diff fleet-miniapp`
  correctly reports `spec_missing` in active (a clear, expected signal) instead
  of today's misleading `spec_not_locked`, and the done packet preserves the
  contract + Landed section for R-15 follow-ups.
- Path B alone re-arms the guard but misrepresents landed work as implementable
  and risks unattended re-queue; path C alone fixes the row's verifiability but
  leaves the repo non-canonical. C is a fine **annotation** alongside A ("gate
  as written superseded by close; sensor 17/17; see done packet"), not the fix.
- Explicitly not done here: this mission is report-only, and both the guard
  (`scripts/`) and the spec (`specs/active/`) are protected to edit — the move
  and any status write belong to the human (or the landing agent's coordinated
  follow-up), merged through a normal PR.

## Human confirms

1. Whether the `## Left` items (R-15 pointer, on-device `/fleet` screenshot
   witness) are satisfied or explicitly carried elsewhere — the only substantive
   reason the packet lingered in `active/`.
2. Path A: `promote`/approve the `active/` → `done/` move (+ AI_HANDOVER line),
   and the exact status string to record on the done copy.
3. Optionally path C wording on the Fleet-09 Completion-gate cell (sensor-only
   gate + pointer), coordinated with the gate-sweep annotation already on-row.
4. Nothing else: no guard edit (path D stays rejected), no re-lock without a
   new work item (path B stays unapplied).
