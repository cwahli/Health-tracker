---
id: RESEARCH-3
status: locked
class: UNOBSERVED_VENDOR_CONTRACT
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health/research.mjs
  - scripts/fixtures/search-providers.json
  - scripts/fixtures/search-provider-probe.json
  - scripts/fixtures/search-provider-probe.mjs
  - scripts/assert-external-health.test.mjs
  - AI_HANDOVER.md
frozen_files:
  - scripts/lib/health/docs.mjs
  - scripts/lib/health/context.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/lib/health/doctor.mjs
  - scripts/lib/health/d1.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/lib/health/reconcile.mjs
  - scripts/health-runner.mjs
  - scripts/council-runner.mjs
  - scripts/lib/project-registry.mjs
  - scripts/lib/commands.mjs
  - projects/external-health/soul.md
  - projects/external-health/roles
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

# RESEARCH-3 — the declared endpoints, probed on the wire

## Goal

`scripts/fixtures/search-providers.json` pins each provider request as a vendor
contract — endpoint, method, where the credential goes, which response field
carries a hit — but every line of it was written from the vendors' documentation.
Nothing had ever confirmed, on the wire, that the host routes that path, that the
credential is read from that header, or that the refusal looks the way the
transcription says it does. RESEARCH-2 found the Tavily defect only because the
vendor's SDK source happened to contradict the old docs; a transcription can be
wrong for years and read as green.

This pass takes **one unauthenticated observation of each declared endpoint** and
records the observation itself: what was sent, what came back, and what it does
and does not prove about the recorded envelope. No credential exists on this
host, so every reply is a rejection — which still discriminates.

## What was observed

Taken **2026-10-01** from a macOS host (node v26.8.1), by hand, with the invalid
value `probe-not-a-credential-0000`. Each declared request was built by the lane's
own `SEARCH_PROVIDERS[].build` — the code the shipped lane runs — and the full
record, verbatim, is `scripts/fixtures/search-provider-probe.json`.

- **Brave** — declared `GET https://api.search.brave.com/res/v1/web/search?q=…&count=10`
  with `X-Subscription-Token` → `HTTP 422 SUBSCRIPTION_TOKEN_INVALID`
  (`meta.component: "authentication"`). With the header removed the same path
  answers `HTTP 422 VALIDATION` whose error lists `loc ["header","x-subscription-token"]`
  and `msg "Field required"` — the vendor naming the header it wants. **The one
  thing it cannot prove:** the same token on `/res/v1/web/searchX` returns the
  identical `SUBSCRIPTION_TOKEN_INVALID`, so Brave checks auth before routing and
  the routed path is *not* distinguishable this way. Recorded as an explicit
  unknown, not smoothed over.
- **Tavily** — declared `POST https://api.tavily.com/search` with
  `Authorization: Bearer` → `HTTP 401 {"detail":{"error":"Unauthorized: missing or invalid API key."}}`.
  The old body-`api_key` shape returns the identical 401 (the RESEARCH-2 fix is
  the right one, and this observation is why the fixture may say so). `/searchX`
  → `HTTP 404` with an empty body, **which does prove the declared path exists**.
- **Google** — declared `GET https://www.googleapis.com/customsearch/v1?key=…&cx=…&num=10&q=…`
  → `HTTP 400 "API key not valid. Please pass a valid API key."` (`details[].reason
  API_KEY_INVALID`, `metadata.service customsearch.googleapis.com`); no key at all
  → `HTTP 403 PERMISSION_DENIED ("Method doesn't allow unregistered callers")`;
  `/customsearch/v1x` → `HTTP 404` (HTML error page, i.e. the path is real);
  `num=25` (above the documented maximum) → the same key error, so no parameter
  validation is observable ahead of the key. The same invalid key in an
  `X-Goog-Api-Key` header also reaches key validation — the lane's query
  placement is confirmed, its exclusivity is not.

**This is unauthenticated observation, not a captured successful response.** No
200 envelope, result field or rate-limit status is confirmed here, and the
`proves`/`doesNotProve` lists that carry that boundary live in the record.

## What changes

- **`scripts/fixtures/search-provider-probe.json` (new).** The evidence: date,
  platform, the non-credential, and per provider every request/response pair
  verbatim, plus `proves` and `doesNotProve`. It is data, never a sensor.
- **`scripts/fixtures/search-provider-probe.mjs` (new).** The hand-run probe that
  produced it, importing the real builders so a re-run observes the lane's own
  bytes. It is imported by nothing: no test, no CI job, no shipped module.
- **`scripts/fixtures/search-providers.json`.** A `rejected` case per provider,
  the **verbatim body the vendor actually returned** (Brave 422, Tavily 401,
  Google 400), and a note that separates it in kind from the transcribed
  `ok`/`zero`/`http`/`html`/`wrongShape` envelopes.
- **`scripts/assert-external-health.test.mjs`.** Section 15 gains the three
  `rejected` chain cases: a real credential rejection falls through to the next
  declared provider, and when the last provider is rejected the refusal carries
  the vendor's own status. New section 16 reads the evidence offline —
  dated, the explicit statement present, the credential declared as a
  non-credential, one entry per declared provider, the reply a refusal and not a
  search result, `proves`/`doesNotProve` both non-empty, the fixture's `rejected`
  body equal to the observed body — and carries **the drift sensor**: the request
  on record must equal the one `SEARCH_PROVIDERS[].build` produces today, so a
  changed endpoint or a moved credential header cannot leave green evidence
  behind. Section 16 also asserts the probe tool is imported by nothing in the
  gate, which is the rule this whole file lives under.

## How it was proved

- `assert-external-health`: **558 → 596 checks, 0 fail**; every earlier section
  untouched.
- **Red three ways**, each restored and 596/0 again: Tavily's credential header
  renamed → **2 FAIL** (the pinned contract and the drift sensor); Tavily's
  endpoint path changed → **2 FAIL**; the recorded rejection's status rewritten
  → **1 FAIL** (the evidence no longer matches the fixture).
- **Through the command surface** — `health-runner --research` behind the
  `--import` shim, i.e. the code path `/health research` runs, on a scratch
  workspace: with the two observed rejections as Brave's and Tavily's answers,
  the run **exits 0**, falls through to `google-cse`, and the log's attempts read
  `[{brave, HTTP 422}, {tavily, HTTP 401}]` with one fetched hit and one 404
  refusal — a real credential rejection is a fall-through, not a dead search.
  With no credential it **exits 3** `stage: 'credential'`, names all five
  variables and `~/.config/bot-host/common.env`, writes nothing, and makes no
  request.
- Gates: `assert-external-projects`, `assert-council-no-invented-case`,
  `assert-command-scope`, `assert-auto-merge`, `assert-main-verify`,
  `tsc --noEmit`, `assert-spec-diff RESEARCH-3`, `no-undo`, `test:prepush`.

## Left

- **The successful envelopes are still transcriptions.** `ok`, `zero` and
  Brave's `429` describe what the vendors' docs say a good answer looks like;
  they were not observed. The `rejected` cases and the drift sensor make the
  difference visible, and re-running the probe (`node
  scripts/fixtures/search-provider-probe.mjs --json …`) is one command — but it
  needs a credential on the host to see a 200.
- **Brave's routed path is unproven** (auth is checked before routing), and no
  parameter validation was observed ahead of the credential anywhere.
- **Re-probing is a manual act**: nothing polls the vendors, and nothing will
  notice a vendor change until someone re-runs the probe or a contract fails on
  a host with a credential.
- **Still open from the plan:** the analysis producer (nothing writes
  `result/health-analysis.json`), the Doctor not gating publishing yet, and the
  eight data-gate items (H-1…H-8) that stay the user's to fix in the app.
