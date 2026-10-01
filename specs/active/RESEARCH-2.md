---
id: RESEARCH-2
status: locked
class: UNEXERCISED_VENDOR_CONTRACT
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health/research.mjs
  - scripts/assert-external-health.test.mjs
  - scripts/fixtures/search-providers.json
  - scripts/fixtures/search-providers.mjs
  - scripts/fixtures/search-provider-shim.mjs
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

# RESEARCH-2 — the vendor contracts, exercised before a credential exists

## Goal

The literature lane talks to three search APIs, and every one of those requests is
a **vendor contract**: the endpoint, the method, where the credential goes, which
response field carries a hit. RESEARCH-1 wrote those three contracts from the
vendors' documentation and proved the lane with a `search`/`fetchImpl` seam, so
no provider was ever actually called — and the first moment a mis-shaped request
matters is on a host that finally has a credential, where the failure shows up as
"the literature lane found nothing" rather than as a stack trace.

This pass exercises each contract against recorded responses and fixes what breaks.
It found two real defects:

1. **Tavily's credential was in the wrong place.** The entry sent `api_key` in the
   JSON body — the shape of the vendor's *old* SDK. Today's [API
   reference](https://docs.tavily.com/documentation/api-reference/endpoint/search)
   and today's [vendor SDK](https://github.com/tavily-ai/tavily-python) both send
   `Authorization: Bearer <token>` with no `api_key` at all. On a real host with a
   Tavily key the lane would have taken a 401 and fallen through — or refused
   `stage: 'search'` if Tavily were the only credential configured. The credential
   now travels in the header, where the vendor documents it and where it does not
   land in proxy logs and error reports.
2. **A body that is not the documented shape leaked parser internals into the
   refusal.** A bot check served as `200 text/html` produced
   `Unexpected token '<', "<!doctype "... is not valid JSON` — a JavaScript
   internal with a fragment of the page — and a renamed field produced
   `((intermediate value) || []).map is not a function`. Both reach the user's
   chat through `formatResearchText`. The three ways a 200 can be wrong are now
   named in the vendor's terms: not JSON (a bot check, or a redirect), not the
   documented shape, no results.

The rest of the boundary held up under exercise and is now pinned: zero results is
a failure rather than an empty answer, a non-200 falls through, the chain stops at
the first provider that answers, a host with no egress refuses rather than
reporting nothing found, and no request is made without a credential.

## What changes

- **`scripts/lib/health/research.mjs`.** Tavily's `build` sends
  `Authorization: Bearer` (and no `api_key` body field); the 200-with-the-wrong-
  body paths are split so the attempt records *what the vendor did* rather than
  what the parser said. The provider-table comment now says that each `build` is a
  recorded contract, and where it is recorded.
- **`scripts/fixtures/search-providers.json` (new).** The contracts as data: per
  provider, the request the lane must send (endpoint, method, headers, exact body)
  and one recorded response per shape a real API returns — the documented
  envelope, zero results, a non-200, a bot check as 200 HTML, a renamed field, and
  a DNS failure (`throws`, because a host with no egress never gets a response).
  Bodies are trimmed to the documented fields the lane reads, with the envelope
  keys kept, and each entry cites the vendor doc it was recorded from.
- **`scripts/fixtures/search-providers.mjs` (new).** Turns the recording into a
  `fetch`, and reports which requests went to which vendor. Shared by the sensor
  and the command-surface shim, so there is one implementation of the recording.
- **`scripts/fixtures/search-provider-shim.mjs` (new).** A `node --import` stand-in
  for the global `fetch`, so a *command* — which builds its own runner in its own
  process — can be driven against the recording. The alternative was a
  production env var that exists only for tests; this keeps the shipped code clean.
- **`scripts/assert-external-health.test.mjs`.** New section 15 (**459 → 558
  checks**): each provider alone (request pinned url-for-url, credential location,
  parsed field, the fetched page hashed); every failure mode falling through to
  the next provider with the attempt named; the chain stopping at the first
  provider that answers; two failures then a success; the refusal a user reads
  carrying no parser internals or page content; and the CLI — the same code path
  `/health research` runs — driven through the shim, with the credential-missing
  run still exiting 3 and making no request at all.

## How it was proved

- `assert-external-health`: **459 → 558 checks, 0 fail**; every earlier section
  untouched and still green.
- **Red six ways** (each sabotage restored, 558/0 again): the Brave endpoint path
  changed → 2 FAIL (module path and command path); Tavily's credential moved back
  into the body → 3 FAIL; a zero-result provider made to end the search instead of
  falling through → 9 FAIL; Brave's `title`/`description` fields swapped → 3 FAIL
  (including the command-path check); the non-JSON failure made to echo the body
  again → 3 FAIL; Brave's subscription header emptied → 2 FAIL.
- **Exercised boundary sweep** (no change needed, recorded here so the next reader
  does not re-derive it): nine degenerate bodies (`null`, `[]`, `{}`, a bare
  string, a bare number, `web: null`, `results: null`, `items: null`) each become a
  named failure with no crash; a hostile query
  (`vitamin D & iron (2x) #tag "quoted" 中文`) is percent-encoded in the Brave and
  Google URLs (`%26`, `%23`, `%22`, UTF-8) and carried verbatim in Tavily's JSON
  body; 25 returned hits are cut to `MAX_HITS_PER_QUERY`; and a two-query run whose
  first query fails everywhere still writes the log for the second, with the
  failure listed in `failedQueries`.
- Gates: `assert-external-projects`, `assert-council-no-invented-case`,
  `assert-command-scope`, `assert-auto-merge`, `assert-main-verify`,
  `tsc --noEmit`, `assert-spec-diff RESEARCH-2`, `no-undo`, `test:prepush`.

## Left

- **No live provider call.** This box still has no search credential, so the
  vendors are exercised against recordings rather than over the network. What that
  cannot catch is a change the vendors make *after* this recording — a moved
  endpoint, a new required parameter — which is what the pinned request shapes are
  for: the next person to touch a provider sees the contract they are changing,
  with the doc link next to it.
- **The recording is a snapshot, not a subscription.** Re-recording is a manual
  act; nothing fetches the vendors' docs.
- **Still open from the plan:** the analysis producer (nothing writes
  `result/health-analysis.json`), the Doctor not gating publishing yet, and the
  eight data-gate items that stay the user's to fix in the app.
