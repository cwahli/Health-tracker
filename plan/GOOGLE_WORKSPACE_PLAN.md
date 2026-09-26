# Google Workspace store for all agents — plan

**Goal:** every agent, in every location, can read the external project it is working on
and store its data (files → Drive, rows → Sheets, human-readable summaries → Docs).
**Status:** PLAN (not execute). No code, no credentials, no Google Cloud project yet.

**Two tracks, one plan.** Track A is *read the project* (the workspace must be reachable
from vps, mobile, grok and collab). Track B is *store the data* (Drive/Sheets/Docs).
They meet at the handoff pack: the same pack that moves a turn between locations is
what gets archived to Drive, and its manifest row is what gets appended to Sheets.

**Execute index:** [ROADMAP.md](./ROADMAP.md) (new row when this plan is accepted).
Related: [R16_QS_MATRIX.md](./R16_QS_MATRIX.md) (QS-1/3/4/9 are the cross-location rows
this unblocks), [DATA_PLANE.md](./DATA_PLANE.md) (the *app* stays Firebase Auth + D1 +
R2 — this plan adds **no second OAuth stack to the app**), `scripts/lib/swap-pack.mjs`
(the pack format), `scripts/lib/project-registry.mjs` (external-N workspaces).

---

## 0. What "works in all locations for all agents" means

| Location | Agent surface | Network | Key storage | Reads project via | Writes Google via |
|---|---|---|---|---|---|
| `vps` | `vm`, `vm2` (bot-host) | direct egress | host config dir, mode 600 | local checkout `~/projects/<id>` | direct, shared lib |
| `mobile` | phone (Cline) | phone network | **no key on device** | local checkout if present, else pack from vps | relay to vps (handoff pattern), never direct |
| `grok` | TG router worker | direct egress | host config dir, mode 600 | local checkout if present, else pack from vps | direct, shared lib |
| `collab` | collab-bot | direct egress | host config dir, mode 600 | local checkout if present, else pack from vps | direct, shared lib |

The rule: a location without the credential (or without the checkout) does not fail
silently and does not pretend — it degrades honestly (`needs setup`, same pattern as
lanes) and hands the work to a location that has it (the QS-3 handoff pattern). Mobile
never holds the key: a phone is losable, its storage is app-sandboxed, and OAuth
consent on a headless CLI is a support ticket factory.

---

## 1. Auth design (the one human checkpoint)

**Service account. Not per-bot OAuth.** One Google Cloud project, one service account,
one JSON key. Reasons:

- Headless hosts (vps, grok worker, collab) cannot do OAuth consent flows; a service
  account works with zero human interaction after setup.
- The app already forbids a second OAuth stack ([DATA_PLANE.md](./DATA_PLANE.md)); a
  service account adds **no OAuth UX anywhere** — it is a key file, like the
  provider keys the bots already hold.
- Rotation is one file swap per host, no per-bot re-consent.

**Card-3 lessons, applied (R-14.1 card 3: least privilege, credential isolation):**

- Key lives **only** in host config dirs (`~/.config/bot-host/common.env` style: a
  `GOOGLE_SERVICE_ACCOUNT_JSON` *path*, mode 600, loaded via systemd `EnvironmentFile`).
  **Never in the repo, never in chat, never in logs** (redact on sight).
- The service account is granted access to **specific Drive folders only** — never
  whole-Drive, never domain-wide. One top folder per project (`health-tracker`,
  `external-1`, `external-2`, …); subfolders inherit.
- External-project turns receive a **restricted child env** (`envMode: 'project'`,
  same mechanism as today): they get the *folder ID* for their project, never the key
  path and never the key. A turn that cannot name its folder cannot reach another
  project's data, exactly as an external turn today cannot touch the website repo.
- Sheets rows are **append-only by construction** (only `values:append` is
  implemented). One correction to an earlier draft of this plan: there is **no
  separate delete scope** on Drive/Sheets/Docs. An identity that can create in a
  folder can also delete from it, so the guardrail is *folder scoping plus audit
  and read-back*, not a narrower scope. Anything the account can write, it can
  destroy — which is why the scorecard's delete leg is also the blast-radius proof.
- Docs the agents generate live in the project's own Docs tree, one per generator.
- Rotation: new key → drop into host config → restart unit → zero-burn probe (G-0
  script) → delete old key in Google Cloud console. Documented below as G-5 exit step.

**Human does (once, ~15 min):** create the Cloud project → enable Drive/Sheets/Docs
APIs → create the service account → download the JSON key → create the top folders →
share each folder with the service account address (Editor on data folders, Viewer
nowhere) → hand the key file path + folder IDs to the agent for host enrollment.
Everything after that is agent work.

**The var is a PATH, and the name is underscore-cased.** `GOOGLE_SERVICE_ACCOUNT_JSON`
points at the file (mode 600, so it can actually be protected — an inline env blob
cannot). Folders are `GOOGLE_FOLDER_<PROJECT_UPPER_UNDERSCORE>`, e.g.
`GOOGLE_FOLDER_HEALTH_TRACKER`, because systemd's `EnvironmentFile` accepts
`[A-Za-z_][A-Za-z0-9_]*` only: a hyphenated `GOOGLE_FOLDER_health-tracker` is
**dropped silently**, and the surface then reports "no folder configured" while the
credential is present and working. This is not hypothetical — the first probe run
hit exactly that, which is why `foldersFromEnv` maps the underscore form back to the
project id and a sensor pins the trap.

### G-0 record — enrolled 2026-09-26

| Fact | Value |
|---|---|
| Cloud project | `food-search-502514` ("Food search") |
| Service account | `doc-api@food-search-502514.iam.gserviceaccount.com` (no project roles) |
| Key file (VPS) | `~/.config/bot-host/google-fleet-key.json`, `-rw-------`, owner `ubuntu` |
| Root folder | Drive folder **"Projects"** — `1KB7r2kj6znFj2YjcSapQchiH5sBaYJKa`, shared Editor. It is a **My Drive** folder, which is what makes writes impossible for a service account (§1b). |
| Host env | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_FOLDER_HEALTH_TRACKER` in `~/.config/bot-host/common.env` |
| **G-0 probe** | Credential half **PASS** (token minted, folder listed, 0 writes). Now **NOT READY** on `write ownership` — see §1b. |
| G-0 sensor | `node scripts/assert-google-store.test.mjs` → **48 pass, 0 fail** (stubbed fetch; the real key is never read by a test) |
| **Live scorecard** | `node scripts/google-store-scorecard.mjs` → **3 green / 0 partial / 11 red**, all reds = §1b ownership. Board: [GOOGLE_STORE_LIVE_MATRIX.md](./GOOGLE_STORE_LIVE_MATRIX.md) |

One lesson worth keeping: the first probe run printed `NOT READY` with a *working*
credential. The honest red row ("credential present, but no `GOOGLE_FOLDER_<project>`
configured") is what made the cause findable — a thrown error would have hidden it.


---

## 1b. File ownership — the constraint that decides the identity (BLOCKER, found live)

The first live scorecard run on 2026-09-26 was **3 green / 11 red**, and every red
had one cause. Drive says this about the create:

```text
403 Service Accounts do not have storage quota.
    Leverage shared drives, or use OAuth delegation instead.
    reason: storageQuotaExceeded
```

Drive also reports `canAddChildren: true` for that same folder, so the folder
permission is genuinely fine — the failure is **ownership**. A file is owned by
whoever created it, and a service account owns nothing and has no storage quota,
so it can *read* a folder it was given Editor on and cannot *put* anything in it.
`ownedByMe: false`, `driveId: undefined` → the folder is a **My Drive** folder.

So the identity choice is not a preference; it is forced by the account type:

| Option | Needs | Result |
|---|---|---|
| **A. Shared Drive (Team Drive)** + service account as member | A **Google Workspace** account (business/edu). Personal @gmail.com **cannot** create a shared drive. | The drive owns created files, so the service account writes as itself. Keeps the no-OAuth, key-file design. |
| **B. One user identity** (single OAuth client + refresh token for the human, used by every agent) | Works with a personal account. One consent screen, once. | Files are owned by the human, so writes work. Loses "no OAuth anywhere"; keeps "one credential, no per-bot consent". |
| **C. Domain-wide delegation** | Workspace + admin. | Heaviest. Not needed unless per-user impersonation is required. |

`scripts/probe-google-store.mjs` now checks this **without writing**: a My Drive
folder has no `driveId`, and the probe reports `write ownership: a service account
cannot own files here` as a red row. A READY credential with an unwriteable target
is exactly the failure a zero-burn probe exists to catch early.

**Until this is resolved, G-1's write legs cannot go green and no agent should be
enrolled.** Everything else (plan, client, probe, sensor, relay route, scorecard)
is identity-agnostic: switching is a credential source in the host env, not a
rewrite.

## 2. Data model — what goes where

**Drive (files, content-addressed names, never overwritten):**
`/<project>/turns/YYYY-MM-DD/<UTC>-<location>-<chat>-<turnid>.md` — turn log: prompt,
lane used, result, quota events. `/<project>/packs/…` — handoff packs (`swap-pack.mjs`
output, same bytes the relay carries). `/<project>/evidence/…` — R-14.1/R-16 style
captures (UTC / bot+PID / command / raw reply / side-effect / negative check).
`/<project>/docs/` — generated Docs exports (PDF/MD snapshots beside the live Doc).
Filename rule: `<UTC>-<location>-<chat>-<turnid>-<slug>` — two agents can never
collide, retries are idempotent by turn id, nothing is ever edited in place.

**Sheets (append-only rows, one spreadsheet per purpose):**
- `turn_log` — one row per turn: UTC, chat, location, project, role, model, lane,
  tokens (if known), result (ok/depleted/error class), reset hint. This is the sheet
  the fleet argues from; everything else is derived.
- `quota_events` — depletion stamps mirrored from the ledgers (lane, until, source).
- `bakeoff_waves` — bakeoff results (feeds `FREE_MODEL_BAKEOFF.md`, which stays the
  human-readable ledger; the Sheet is the queryable one).
- `errors` — dead-end signatures (the learning loop's input).
One tab per month (`2026-09`, …); the writer creates the tab if missing. No cell is
ever edited — corrections are new rows (same rule as the ledger: stamps, not edits).
A single monthly compactor (one designated host, vps) may archive tabs older than 90
days to Drive and note it in the Doc. Exactly one writer role per spreadsheet;
everyone else appends.

**Docs (generated, never hand-edited by agents):**
- Per-location weekly rollup: **one generated Doc per generating location** (e.g.
  `2026-W40-rollup-vps`, `…-grok`), plus one shared **index Doc** that links them.
  Every location may generate; nothing needs a designated writer, and two
  generators can never clobber each other because they write different documents.
  Humans and agents edit freely; a generation only ever *appends* at the document
  end (`insertText` at `endIndex`), so a human section is never overwritten. A
  sensor pins that insertion shape.
- QS/R-14.1 evidence snapshots on demand (`/evidence` → Doc link in chat).

**What does NOT go to Google:** secrets/keys (host config only), full prompt contents
containing user personal data beyond what the turn log needs (log metadata + short
brief, same redaction rule as `/compact` handoffs), binaries/photos (those stay on R2
per DATA_PLANE — Drive is for agent text artifacts, not a second photo store).

---

## 3. The shared module (one implementation, all surfaces)

`scripts/lib/google-store.mjs` — pure helpers + a thin `fetch`-based client for the
three APIs (Drive `files.create/list`, Sheets `values.append`, Docs `documents.create`
+ `batchUpdate`). **No new heavy dependency** (no `googleapis` npm package: it drags
OAuth machinery the fleet will never use; service-account JWT is ~40 lines of
`node:crypto`). Same law as the lanes code: bot-host, collab, mobile-relay and the
Grok router all import this file; a per-bot copy fails its row. Vendor-mirror into the
router only if the router cannot import it (mirror + drift check, same as
`free-lane-table.vendor.mjs`).

Companion pieces, same pattern as the lanes work:
- `googleReady(env)` in the setup-gaps style — binary n/a (pure fetch), credential
  present + parses + folder IDs present → ready; else `needsSetup` naming the missing
  variable. Surfaced in `/setup` per location and in the zero-burn probe.
- `scripts/probe-google-store.mjs` — zero-burn: auth parses, Drive `files.list` on the
  project folder (1 page), Sheets metadata read, no writes. Per host, same evidence
  role as `probe-free-lanes.mjs`.
- `assert-google-store.test.mjs` — stubbed `fetch`, never touches live Google:
  JWT shape, append payload shape, filename rule, idempotency (same turn id twice →
  one logical row), redaction (key material never in a payload/log line), degraded
  path (no credential → honest `needsSetup`, no throw, no write attempt).
- Local spool: `~/.local/share/<bot>/google-spool/` — every write is spooled to disk
  first, then flushed; a failed flush retries with backoff and never loses the row
  (same durability idea as ledger stamps). Flush cadence: every 5 min or 50 rows,
  plus on-demand (`/sync`). **Turns never block on Google** — a slow API must not
  slow a chat reply; spool-and-confirm-async, with the confirmation in the next
  `/allowance`-style read, not in the turn path.

---

## 4. Per-location behavior (the matrix that makes "all locations" true)

| Capability | vps (vm/vm2) | grok | collab | mobile |
|---|---|---|---|---|
| Read own checkout | yes | if checkout present | if checkout present | if checkout present |
| Read project without checkout | n/a (has it) | pack from vps (`runOnWorker` + `/packs`) | pack from vps | pack from vps |
| Write Drive/Sheets | direct (key on host) | direct (key on host) | direct (key on host) | **relay**: payload → vps writes, receipt (file ID / row range) back in chat |
| Generate Docs | `vm2` (designated) | no (reads only) | no (reads only) | no (reads only) |
| No credential | `needsSetup` in `/setup` + probe | same | same | same (and relay unavailable → honest "no route", handoff per QS-3) |

`/project <id>` keeps working everywhere; what changes per location is only *how* the
bytes move, never *whether the user is told*. A location that cannot do a step says
which step, which variable/folder is missing, and which location can do it — the same
honesty rule as depleted lanes.

---

## 5. Rollout (gates, not dates)

| ID | What | Done when (gate) | Do not |
|---|---|---|---|
| **G-0** | Human checkpoint (§1) + zero-burn probe from vps | `probe-google-store.mjs` green on vps: auth parses, folder listed, Sheets metadata read, **zero writes** | Writing anything before the probe is green |
| **G-1** | `google-store.mjs` + `googleReady()` + sensor + spool/flush | `assert-google-store.test.mjs` green; `/setup` shows a google row per location; spool dir + retry proven with stubbed fetch | A `googleapis` dependency; writes in the turn path |
| **G-2** | Pilot: turn log → Sheets from vps (both bots) | 20 consecutive live turns appear as 20 rows (turn-id deduped), evidence block per row (UTC/bot/PID/command/side-effect), zero chat-latency regression | Backfilling history; editing rows |
| **G-3** | Enroll grok + collab; mobile relay path | Same 20-turn proof per location; mobile proof shows relay receipt (file ID) in chat, never a direct write | Key file on the phone; silent direct-write fallback |
| **G-4** | Drive packs + weekly Doc generator | One handoff pack round-trips vps→Drive→grok; one generated Doc with human-editable sections intact after regen | Hand-editing generated sections by agent; photos/binaries to Drive |
| **G-5** | All-agents cutover + rotation drill | Every location green in one pass (R-16 evidence style); key rotated once with zero failed writes during the swap | Declaring done with a red location |

**Evidence style** follows the repo norm: UTC / bot+MainPID / command sent / raw reply
(or API response ID) / side-effect / negative check (e.g. "no duplicate row on retry",
"no write attempted without credential", "human Doc section intact after regen").

---

## 6. Risks, stated plainly

1. **Key leak blast radius.** A service-account key that can write is a write key
   everywhere it is shared. Mitigation: folder-scoped sharing, no delete scope, mode
   600, redaction sensor, rotation drill as G-5 exit. If a key is ever pasted anywhere
   (chat, log, issue), rotate immediately — same rule as provider keys.
2. **Sheets as a database.** It is a ledger, not a query engine: append-only,
   monthly tabs, no formulas agents depend on, no concurrent cell edits. Anything that
   needs querying gets exported to Drive monthly and, if it outgrows Sheets, moves to
   D1 (DATA_PLANE stays the app's SoT — this store never becomes a second app DB).
3. **Two writers, one Doc.** Solved by single designated generator + append-only human
   sections. Violations show up as edit conflicts; the sensor asserts the generator
   never touches human sections.
4. **Mobile as second-class.** Accepted deliberately: the phone holds no key and does
   no direct writes. The risk is relay downtime == mobile dark; mitigated by the spool
   (mobile spools locally, syncs when a route exists) and by saying so in `/setup`.
5. **Quota.** Sheets write quota is per-minute per project: spool + batch flush (not
   per-turn writes) keeps the fleet under it. Drive/Sheets/Docs usage is trivially
   inside free tiers at this volume; the plan needs no billing step.
6. **Scope creep into the app.** This store is agent-to-Google, not app-to-Google.
   Nothing here touches `src/`, Firebase Auth, D1, or R2 paths. Any proposal that does
   is a different plan.

---

## 7. Decisions needed (human)

0. **BLOCKING — pick the identity:** can your Google account create a **Shared
   Drive** (that means a Google Workspace business/edu account)? If yes → option
   A, keep the service account, and I will have you create one shared drive and
   add `doc-api@…` as a member. If it is a personal @gmail.com → option B, one
   user identity with a refresh token, and I will add that credential source.
   Everything else in this plan is already built and waiting.
1. **Google account to own the Cloud project** (a shared/team account, not personal).
2. **Folder sharing model**: one top folder per project shared with the service
   account (recommended), or one folder total with subfolders.
3. **Doc writer**: confirm `vm2` as the designated generator, or name another.
4. **Retention**: 90-day Sheet tabs → Drive archive (recommended), or keep live.
5. Accept this plan → it becomes a ROADMAP row with G-0…G-5 as the gates.
