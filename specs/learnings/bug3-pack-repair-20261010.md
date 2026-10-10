# Bug-3 pack repair: row claimed a pack that never posted (2026-10-10)

Card #3 (`tag_muwyto87_lb78bc`, "Inbox leftover: Incorrect nutrition labdl")
sat at Status=review against gate "Pack complete + pack --check green" with
defect=null, repro=null, plan=null, verify=null. The sheet Work-done claimed
`pack --check exit 0` plus 2 PNGs, but nothing was ever POSTed — the human
stamp on the row ("[human 10 Oct] This one doesn't match the rule") was right.
Three repairs, all measured:

1. Packed for real. `bugctl pack --id '#3' --check` → ok:true green, then
   POSTed exactly ONE defect + class OPENING_DRIFT + surface food. #3 is the
   sibling of Bug-2 (same title, same evidence job): Bug-2 took the micros
   defect (OPENING_WRONG, 16 micro keys at 0, now done), so #3 took the other
   remaining line — the trial-balance drift (Scout Opening 300 kcal != Saved
   Table 287 kcal). Class comes from the detecting sensor itself:
   `detectLedgerImbalances` fires `ledger_scout_est_vs_saved_table` with
   classHint OPENING_DRIFT (verified by direct run: scout 300 vs table 287
   reproduces the exact remaining string). Fingerprint
   `OPENING_DRIFT|scout_opening_300_kcal_...|2026-W41`, deduped against
   `bugctl list` (12 cards, no OPENING_DRIFT collision, Bug-2's fingerprint
   untouched). Canonical state now `packed`.
2. Row id fix: `[id]` said "#2" on card #3 → corrected to #3; `[state]`
   new → packed per `bugctl state`; stale "(new/ready)" wording → "(packed
   10 Oct)". Human stamp preserved byte-for-byte; agent note appended after
   it. Status kept at review ONLY because the gate is now genuinely met
   (pack posted + check green + fresh PNG proof) — never set Done from a
   pack slice.
3. Drive folder `1Jj1Bp356CSZscpX7LWQ3mj_IRMnupP7A`: deleted the 2 stale
   7-Oct PNGs (they evidenced a pack that never happened), uploaded 2 fresh
   headless captures (`bug3-pack-check.png`, `bug3-packet-after.png`) rendered
   from the real command JSON. Folder holds only #3's shots.

Rules for next time:

- A row that says "pack --check exit 0" with the card still at defect=null
  is a claim without a POST. Verify `bugctl packet --id` before trusting
  Work-done, and treat any such row as the human did here: doesn't match
  the rule until the defect is canonical.
- Sibling cards with the same title are a split, not duplicates: each takes
  exactly one remaining line, each with its own defect class and fingerprint.
  Reuse a sibling's component framing only where the evidence matches;
  #3's drift needed its own (trial-balance chain, not the canonical DB).
- `bugctl` on PATH is a shim to the deploy clone's script, so the git
  journal for a pack POST lands in `/home/ubuntu/deploy/Health-tracker`
  (not the worktree) — that clone is auto-deploy's; never commit there.
  The worktree branch for a pack slice carries the learnings note as its
  committable artifact; the pack itself lives in the API store + sheet.
- Scope discipline held: no fix implemented, no coder dispatched, no app
  code touched (so per AGENTS.md L11/L10: no vitest, no tsc — nothing to
  gate). QA repro noted as What's-left, not started.
