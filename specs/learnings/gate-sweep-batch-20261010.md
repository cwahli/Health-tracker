# Gate-sweep batch verification — 2026-10-10 (VM, agent/gate-sweep)

15 Assigned rows worked read-only on origin/main tip `adfeb83b`. No code
changed. 3 flipped to review with per-key Drive proof; 12 left Assigned with
honest Work-done notes (4 RED findings, 8 UNVERIFIABLE). Sheet-04 state cell
fixed (note moved to Work-done, state=open).

## GREEN → review (gate ran verbatim, exit 0, PNG per command in per-key folder)

- Merge-01 (spec:MERGE-GATE-1): tsc clean; auto-merge 89/89; hygiene 25/25;
  registry-inherit 17/17. Folder `spec:MERGE-GATE-1` (1yPW5kt2NgI1VXhBH8-uSLV_RHrehIif0).
- Main-01 (spec:MAIN-VERIFY-1): tsc clean; main-verify 17/17; auto-merge 89/89;
  hygiene 25/25. Folder `spec:MAIN-VERIFY-1` (1tcdBep1myB5E26Y8G9Rc-MjHgC1rTpVS).
- Forge-01 (spec:FORGE-1): tsc clean; bot-clone 11/11; bot-clone.test 16/16;
  add-bot.test 13/13; bot-forge 52/52; registry-inherit 17/17. Prior 2-fail was
  missing teleproto on an unprovisioned checkout (declared dep, present after
  `npm ci` env provisioning — no code change). 2026-10-06 R13 PNGs moved to
  `superseded/` (move-not-delete). Folder `spec:FORGE-1` (1-tWa4MgKrDLtktvvpxQC2hLAgQV_Jba-).
- assert-sheet-proof.mjs: all 3 flipped rows PASS. The sensor's 2 live FAILs
  (Domain-01, Auto-01 mislinks) are pre-existing on untouched rows.

## RED findings for a later wave (gate exits non-zero on main, not fixed)

1. bot-host.test.ts `filters zero-cost authorized opencode models` (285/286):
   `listFreeOpenCode` asks the live `opencode models` catalog first; on any box
   with the CLI + auth it returns current free models (incl. opencode-go refs)
   and bypasses the mocked cache. Test is not hermetic — inject
   `liveModels: () => null`. Blocks Health-02, Health-10, Health-09 gates.
2. assert-google-store `nothing is ever replaced: no PUT` (76/77): #510 added
   `updateValues` with `method: 'PUT'` to google-store.mjs, contradicting the
   standing no-PUT assertion. Needs a human verdict: amend test or move the
   review-queue PUT out of the store. Blocks Health-10 gate.
3. journey-guard fleet-miniapp: `FAIL spec_not_locked` — specs/active/fleet-miniapp.md
   has `status: completed` (committed 3dde40ff) but guard requires `locked`
   before implement. Spec-lifecycle verdict needed. Blocks Fleet-09 gate.

## UNVERIFIABLE (prose/no-command gates or live-only needs, left Assigned)

- Health-01: no runnable gate; children not all green here; needs live workspace + creds.
- Sheet-04: gate is prose; state fixed to open. Needs a verifiable gate command.
- Sync-09 / Sync-08: prose gates; a real sync would mutate (out of scope).
- Fleet-06: gate premise stale — #491/#495/#500 all MERGED 2026-10-03, not OPEN red.
- Req-18: needs live phone re-tap of /fleet Tickets.
- Req-12: gate is literally `0`; needs a real gate or human archive decision.
- Spec-01: needs live Telegram + phone shot; blockers #491/#495 now merged so rebase is open.

## Env note

`npm ci` (714 pkgs) was required to run tsc/vitest/teleproto-dependent gates;
node_modules is gitignored, tree otherwise untouched.
