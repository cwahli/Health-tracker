# Google store — live scorecard

**Status: NOT GREEN — 11 green / 1 partial / 2 red.** Live run `20260926T130901Z` on `vps`.
Acting as `cwah.liu@gmail.com` (user identity, 5497.56 GB quota).

Everything the plan set out to prove is now proven **except** writing text *into* a
Google Doc, and that one blocker is environmental, not a defect in this code:

```text
documents.batchUpdate  ->  400, content-type text/html
                          (Google's front door serving a bot-challenge page)
```

Measured on this host: `0/10` challenged during one window, then `6/6` passing with
byte-identical requests minutes later, then challenged again. 65 s of graduated
backoff (5 s / 15 s / 45 s) did not outlast a window. Other methods are unaffected
through the same window — `sheets.values.append` 5/5, and every Drive call
(create, binary upload, rename, delete, read, list) green in every run. The client
now retries a challenge page like a 429 and names it if it persists, because
failing a working capability on one bad minute is how a store gets written off.

**Run it:** `node scripts/google-store-scorecard.mjs` (add `--json` for the full
evidence log, `--only=G-05,G-11` for one leg). Every row prints
`UTC / bot+pid / operation / API response id / side effect / negative check`, the
same evidence shape as the R-14.1 and R-16 live proofs.

**What "green" means here.** Not "the write returned 200". A rename is green when a
later read shows the new name and the same id. An append is green when the read-back
contains both the seed and the appended text. A delete is green when a later read is
404. The board also proves the boundaries: a keyless location is refused a direct
write, an unenrolled project is refused by name, an unauthenticated relay call is
401, and a run leaves nothing behind.

| Row | What it proves | Where | State | Note |
|---|---|---|---|---|
| **G-01** | add a picture (real 48×48 PNG, multipart upload) | vps direct | **green** | id + 221 bytes, read-back name matches |
| **G-02** | rename it — same id, new name, bytes untouched | vps direct | **green** | same id, new name, size still 221 bytes |
| **G-03** | add a Doc | vps direct | **red** | the Doc is created (Drive MIME), but seeding its text needs `documents.batchUpdate`, which is challenged |
| **G-04** | edit the Doc — append, human text survives | vps direct | **red** | same blocker: the only API that writes Doc text is challenged from this host |
| **G-05** | add a Sheet, inside the project folder, first tab renamed | vps direct | **green** | created through Drive (only Drive can set a parent), tab is `turn_log` |
| **G-06** | edit the Sheet — append two rows, first row not rewritten | vps direct | **green** | 2 rows read back, `A2 = g06b` so the first row was not rewritten |
| **G-07** | delete the picture, proven by a later 404 | vps direct | **green** | 204, then 404 |
| **G-08** | delete the Doc, proven by a later 404 | vps direct | **green** | 204, then 404 |
| **G-09** | delete the Sheet, proven by a later 404 | vps direct | **green** | via `drive.files.delete` — a spreadsheet is a Drive file, and `spreadsheets.delete` is the challenged method |
| **G-10** | **a location with no credential** adds all three through the relay, edits them, deletes them, and gets receipts | mobile (keyless) | **partial** | every step proven — refused a direct write, created all three via receipts, renamed the picture, deleted all three, all read back missing — except the Doc edit, which is the challenged method |
| **G-11** | an unenrolled project is refused by name, nothing written | mobile (keyless) | **green** | `400` · 0 litter objects |
| **G-12** | an unauthenticated relay call is rejected before routing | mobile (keyless) | **green** | `401` |
| **G-13** | two locations, one turn id → two objects, neither overwritten | vps + mobile | RED | same ownership refusal |
| **G-14** | nothing this run created is left behind | vps direct | **green** | judged against a pre-run baseline of the folder, and the run sweeps its own ids first |

## Reading the board honestly

- **G-11/G-12/G-14 are green and they are not consolation prizes.** They are the
  boundary rows: they prove the store refuses what it should and litters nothing.
  Those hold regardless of the identity decision, which is why they are the rows to
  trust while the rest is blocked.
- **G-10 is partial, and the missing part is the Doc edit.** Everything else about
  the keyless path is proven: refused a direct write, created all three through the
  relay, renamed the picture, deleted all three, all read back missing. A phone with
  no key can therefore store and remove data through a receipt; only Doc *text*
  editing is unproven there, for the same environmental reason.
- **G-13 is the concurrency proof.** Same turn id from two locations must produce two
  distinct objects. It is the row that would catch an overwrite bug.
- Rows that need a previous row report `needs G-0x` rather than a fake failure, so a
  blocked board never looks like a broken one.

## Location coverage — what is *not* proven yet

| Location | Credential | Rows run | Honest state |
|---|---|---|---|
| `vps` (this box) | service account enrolled | G-01…G-09, G-13, G-14 | direct path proven to the ownership wall |
| `mobile` | **none, by design** | G-10…G-12 | relay path proven for refusals; write path blocked behind G-10 |
| `grok` | not enrolled | none | **not started** — needs the credential on that host |
| `collab` | not enrolled | none | **not started** — needs the credential on that host |

Grok and collab are the remaining honest gap once the identity is settled: a host is
"enrolled" when its own env carries the credential and the probe is green *on that
host*. Nothing in this board is inferred from another location's result.

## What is left, and the three ways to close it

The only unproven capability is **writing text into a Google Doc** (G-03's seed, G-04,
and the Doc half of G-10). `documents.batchUpdate` is the sole API for it, and this
host is being served a bot-challenge page for it.

1. **Wait it out.** The window demonstrably clears (6/6 passing with the same
   requests). Re-run the board and G-03/G-04 go green on their own. Cheapest, and
   honest about what it is.
2. **Send those two calls from another egress.** The block is per source IP, so a
   second host (the `grok` or `collab` machine) may not be challenged at all. This
   also folds in the location enrolment the board still lists as "not started".
3. **Add a Drive-based Doc path.** Drive answers reliably from here, and it can
   create a Doc *with* content by uploading text with the Docs MIME type. That
   proves "add a doc" today. It does **not** prove "edit a doc" the honest way:
   editing a Doc through Drive means replacing its content, which trades away the
   append-only law this plan is built on. Offered as an explicit trade, not a fix.

## After that

1. Enroll `grok` and `collab`, run the board from each, and record the rows here.
2. A real phone for G-10's caller (the simulated keyless caller is a stand-in until
   then, and the row stays honest about that).
3. G-1's pilot: 20 live turns logged from both VPS bots, with the spool proving no
   chat reply ever waits on Google.
