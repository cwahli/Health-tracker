# Google store — live scorecard

**Status:** **NOT GREEN — 3 green / 0 partial / 11 red.** One root cause, and it is
not a code defect: a service account cannot own files in a **My Drive** folder, so
every create is refused with `403 storageQuotaExceeded`.

**The identity is decided** (plan §1b): no Workspace subscription, therefore no
shared drive, therefore **one user identity** — a single OAuth grant belonging to
the human, used by every surface, authorized once by
`scripts/google-authorize.mjs`. The moment that bundle exists, this board re-runs
unchanged: no code path forks on credential type. Until then the board stays
honestly red rather than claiming a write path nobody has exercised.

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
| **G-01** | add a picture (real 48×48 PNG, multipart upload) | vps direct | RED | `403 Service Accounts do not have storage quota` |
| **G-02** | rename it — same id, new name, bytes untouched | vps direct | RED | needs G-01 |
| **G-03** | add a Doc (Docs MIME + seeded text) | vps direct | RED | `403 The user's Drive storage quota has been exceeded` |
| **G-04** | edit the Doc — append, human text survives | vps direct | RED | needs G-03 |
| **G-05** | add a Sheet (first tab) | vps direct | RED | Sheets answers with a non-JSON error page on the same ownership refusal |
| **G-06** | edit the Sheet — append two rows, first row not rewritten | vps direct | RED | needs G-05 |
| **G-07** | delete the picture, proven by a later 404 | vps direct | RED | needs G-01 |
| **G-08** | delete the Doc, proven by a later 404 | vps direct | RED | needs G-03 |
| **G-09** | delete the Sheet, proven by a later 404 | vps direct | RED | needs G-05 |
| **G-10** | **a location with no credential** adds all three through the relay, edits them, deletes them, and gets receipts | mobile (keyless) | RED | same ownership refusal, relayed |
| **G-11** | an unenrolled project is refused by name, nothing written | mobile (keyless) | **green** | `400` · 0 litter objects |
| **G-12** | an unauthenticated relay call is rejected before routing | mobile (keyless) | **green** | `401` |
| **G-13** | two locations, one turn id → two objects, neither overwritten | vps + mobile | RED | same ownership refusal |
| **G-14** | nothing this run created is left behind | vps direct | **green** | folder holds nothing from the run |

## Reading the board honestly

- **G-11/G-12/G-14 are green and they are not consolation prizes.** They are the
  boundary rows: they prove the store refuses what it should and litters nothing.
  Those hold regardless of the identity decision, which is why they are the rows to
  trust while the rest is blocked.
- **G-10 is the row that matters most** and the one still unproven. A green G-10
  means a phone with no key can add, edit and delete through a receipt. Until it
  runs green, "works on the phone" is a design, not a fact.
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

## After the identity is fixed

1. `node scripts/probe-google-store.mjs` — expect `READY` with `write ownership: ok`.
2. `node scripts/google-store-scorecard.mjs` — expect 14 green.
3. Enroll `grok` and `collab`, run the board from each, and record the rows here.
4. A real phone for G-10's caller (the simulated keyless caller is a stand-in until
   then, and the row stays honest about that).
