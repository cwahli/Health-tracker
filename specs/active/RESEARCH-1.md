---
id: RESEARCH-1
status: locked
class: UNVERIFIED_CITATION
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health/research.mjs
  - scripts/lib/health/docs.mjs
  - scripts/lib/health/context.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/health-runner.mjs
  - scripts/bot-host.mjs
  - scripts/lib/commands.mjs
  - scripts/assert-external-health.test.mjs
  - projects/external-health/roles/research_lead.md
  - AI_HANDOVER.md
frozen_files:
  - scripts/lib/health/doctor.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/lib/health/reconcile.mjs
  - scripts/lib/health/d1.mjs
  - scripts/council-runner.mjs
  - scripts/lib/project-registry.mjs
  - projects/external-health/soul.md
  - projects/external-health/roles/data_steward.md
  - projects/external-health/roles/health_analyst.md
  - projects/external-health/roles/test_planner.md
  - projects/external-health/roles/safety_reviewer.md
  - projects/external-health/roles/doctor.md
  - projects/external-health/templates
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-external-health.test.mjs
  - node scripts/assert-external-projects.test.mjs
  - node scripts/assert-council-no-invented-case.test.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-auto-merge.test.mjs
  - node scripts/assert-main-verify.test.mjs
  - npx tsc --noEmit
---

# RESEARCH-1 — the literature lane, and a link nobody fetched is not a citation

## Goal

`research_lead` is already a seat and already owns document 4. What it does not
have is reach: no search tool, no way to record what a search returned, and no
check that the links it writes into "Medical Insights" exist. A seat that cites
from memory is the failure this drop exists for — a plausible-looking title,
year and url is indistinguishable, in the published document, from one that was
opened and read.

So the lane is three things and one rule:

1. **A declared provider chain** (`brave` → `tavily` → `google-cse`), each entry
   naming the environment variables that make it usable. The chain is the honest
   form of "can this host search": a provider that fails falls through to the
   next one **with the failed attempt reported**, and a provider that answered
   with no results is a *failure*, not an empty result.
2. **A fetch log** — `result/health-research.json`: every hit, its status, byte
   count, sha256, title and the query that found it; refusals (404, empty body,
   non-http, transport error) are recorded too, marked not citable.
3. **The document-4 citation contract** — `validateDoctorReport`'s sibling. The
   publisher checks the rendered lines of every `analysis.*` section of document
   4 against that log: **every line carries a link, every link was fetched and
   recorded as ok, every citation line carries a year**. A section that fails is
   refused by name with the sentence in the published bytes — an unverified link
   is a refusal, not a link. Documents 1–3 are untouched by the contract.
4. **The staleness rule** on the publisher. The verify artifact is the snapshot
   every claim about *now* rests on; past the 31-day renewal window
   (`STALE_AFTER_DAYS`, the number `readiness` already reported) the analysis
   sections are withheld and the header says STALE. This is the plan's own
   item and it lives here because document 4 is where "the literature says X" is
   most easily read as current.

Two smaller consequences, both required by the request: a missing search
credential is a **finding** in `/health readiness` that names the variables (like
`GEMINI_API_KEY`), never a silent empty log; and the lane's hits are a section in
the pack every seat is handed, so a seat sees the only links it may cite.

## What changes

- **`scripts/lib/health/research.mjs` (new).** `SEARCH_PROVIDERS` (per provider:
  `keys` = either-name variables, `also` = additionally-required ones — Brave
  accepts `BRAVE_SEARCH_API_KEY` *or* `BRAVE_API_KEY`, Google needs key + cx),
  `searchAvailability(env)`, `webSearch({query, env, fetchImpl, limit})` →
  `{ok, provider, hits, attempts}`, `fetchHit(hit)` → the receipt, `loadResearchLog`
  / `applyResearch` (idempotent by url; `firstFetchedAt` preserved; queries
  capped), `linksIn`, `validateInsightCitations(lines, {log})` and
  `citationRefusalText(verdict)`. The year rule looks for the year on the line
  *with the links removed* — a slug like `…/khor-2024` is not a publication year.
- **`scripts/lib/health/docs.mjs`.** `STALE_AFTER_DAYS` moves here (the
  publisher's own clock); `gateFromArtifact(artifact, {now})` returns `ageDays`
  and `stale` and `analysisAllowed = allowed && !stale`; `renderHeader` carries
  the STALE banner; `staleRefusalText`; `renderSection` applies the citation
  contract to document 4's analysis sources; `renderDoc`/`planPublish` thread
  `citations` and return the refusal reasons.
- **`scripts/health-runner.mjs`.** `runHealthResearch` (no query → `stage:
  'query'`; no credential → `stage: 'credential'`, naming the variables and the
  file, **nothing written**; every provider failed → `stage: 'search'`, nothing
  written; else writes the log) and `formatResearchText`. The credential is read
  the way D1 config is read: `envFile`, else `HEALTH_ENV_FILE`, else the process
  env, the process env winning. `/health refresh` loads the log from the
  workspace and passes it to `planPublish`; the artifact reports `citationRefusals`
  and `citedLinks`, and the reply distinguishes the three reasons a section can be
  withheld (open gate / stale snapshot / uncitable citation).
- **`scripts/bot-host.mjs`, `scripts/lib/commands.mjs`.** `/health research
  "<query>"` behind the running-guard the other work commands have, and the
  command text.
- **`projects/external-health/roles/research_lead.md`.** The seat's own
  instruction: run the lane before writing a citation, and cite only what the log
  holds as fetched.
- **No new seat, no new deliverable, no new published document.**

## How it was proved

- `assert-external-health`: **382 → 459 checks, 0 fail**. New section 14:
  the chain and its fall-through, `fetchHit`'s receipts and refusals, the
  contract's three rules on literal lines, the lane's refusals (nothing written),
  the `envFile` credential, idempotence, the staleness rule at the gate and in
  the bytes, the contract at render time (document 4 vs documents 1–3), the CLI
  door, and **a run against a copy of the real workspace with the user's folder
  re-hashed afterwards**. Section 9 gained the end-to-end pair: a closed gate
  with the log publishes the recorded link; the same payload **without** the log
  publishes the refusal in document 4 and leaves documents 1–3 alone.
- **Red proofs** (each sabotage restored; 459/0 again after each): the
  fetch-before-cite check removed → 6 checks FAIL (the four doc-4 refusals, the
  refusal sentence, the leaked claim); the credential finding made silent → 4
  FAIL; `analysisAllowed` blind to staleness → 2 FAIL (`stale`, `draft`); the
  runner stops reporting `citationRefusals` → 1 FAIL; the `research` candidate
  dropped from the pack → 3 FAIL (including the existing
  "every candidate is a section or an absence, exactly once" invariant).
- Gates green: `assert-external-projects`, `assert-council-no-invented-case`,
  `assert-command-scope`, `assert-auto-merge`, `assert-main-verify`,
  `tsc --noEmit`, `assert-spec-diff RESEARCH-1`, `no-undo`, `test:prepush`.

## Left

- **No live search.** This box has no search credential in
  `~/.config/bot-host/common.env`, so the lane is proven through the `search` and
  `fetchImpl` seams and its refusal path is proven live
  (`--research --query=…` → exit 3, `stage: credential`, nothing written). The
  credential is the user's to add; `/health readiness` names every variable that
  would fix it.
- **The first real citations are still withheld, correctly.** Eight data-gate
  items are open, so every analysis section is refused anyway; document 4 stays
  uncited until the gate closes *and* the lane has run.
- **The analysis producer is still to come.** Nothing writes
  `result/health-analysis.json` yet, so the contract has no live payload to
  judge.
- **The Doctor does not gate publishing yet** — its strikes are an artifact, not
  a publish block. Separate drop.
