---
id: collab-bug-intake
status: locked
class: BUG_INTAKE_VISIBILITY
skill: debug-contract
edit_mode: patch
allowed_files:
  - src/utils/bugSnapshot.ts
  - src/utils/bugSnapshot.test.ts
  - serverBugSnapshot.ts
  - scripts/lib/bug-intake.mjs
  - scripts/bug-intake.test.mjs
  - scripts/bugctl-drain.mjs
  - scripts/skills/common/bug-ticket/SKILL.md
  - scripts/skills/common/telegram-photo/SKILL.md
frozen_files:
  - scripts/bot-host.mjs
  - scripts/bugctl.mjs
  - scripts/run-coding-dispatch.sh
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server.ts
  - server_routes_admin.ts
  - server_routes_r2.ts
  - server_d1.ts
  - scripts/journey-guard.mjs
  - scripts/assert-*.mjs
  - docs/agent/standing.json
  - docs/agent/**
  - AGENTS.md
  - plan/ROADMAP.md
  - bots/registry.json
gate:
  - npx vitest run src/utils/bugSnapshot.test.ts
  - node --test scripts/bug-intake.test.mjs
  - node scripts/assert-bug-ticket-continuity.mjs
---

# Packet: collab-bug-intake — a bug picture is reachable from every surface

Follow-on to `phone-bug-intake` (#303), which made a phone screenshot become a
real ticket. This packet closes the three gaps that stop that ticket being usable
from anywhere except the phone browser and this VM.

## Journey

A bug reported with a picture is **the same object** on every surface. Telegram
`/resume`, the collab bots, and a CLI on another box all show the picture and can
act on it — because a screenshot is stored once and every reader resolves it the
same way, over an absolute URL, with a write path that actually authenticates.

"Better" = location-agnostic. Today the image is stored centrally but three
plumbing gaps mean it is not: an evidence URL that only works in a browser, a
lane that never files a picture as a card, and a write queue with no drainer.

## Findings (do not redo)

1. **The Bug Ticket Bot is not a `bot-host` bot.** `bots/registry.json:221-241`
   registers `hermes_bug_ticket` with `"runtime": "hermes"`, a hermes profile
   (`profile: "bug_ticket"`, `@Bug_ticket_bot`, token `HERMES_BUG_TICKET_TOKEN`).
   So `scripts/bot-host.mjs` **does not serve it**, and auto-filing inbound media
   there would wire the wrong bot entirely. This corrects the framing I gave the
   human before writing this packet.
2. **`buildBugEvidenceText` emits a relative URL.** `bugArtifactUrl`
   (`src/utils/bugSnapshot.ts:134-141`) returns `/api/bugs/…/artifacts?…`. That is
   correct in a browser on the same origin and **useless in a chat message** —
   Telegram only auto-links absolute `http(s)` URLs. The pre-existing
   `photo_urls` are absolute `r2.dev` URLs, which is why those render. This is a
   defect I introduced in #303: an evidence block printing an unopenable path is
   worse than one printing nothing, because it looks like it worked.
3. **The `bug-ticket` skill never mentions a picture.**
   `scripts/skills/common/bug-ticket/SKILL.md` has zero matches for
   screenshot/photo/attach. The agent is told how to pack, repro, plan and verify
   a card but never that it may bring evidence, even though `bugctl create
   --screenshot=<path>` now accepts one (#303).
4. **Queued writes have no drainer.** `bugctl flush` exists
   (`scripts/bugctl.mjs:524`) and `scripts/skills/common/bug-ticket/SKILL.md:58`
   tells the agent to *"wait for `bugctl flush` before claiming success"* — but
   nothing in the repo, a script, a cron, or a bot ever invokes it. A write queued
   while the API is down sits there indefinitely.
5. **`BUG_API_TOKEN` is provisioned nowhere** — absent from `.env`,
   `.env.example`, `bots/registry.json`, and `scripts/mobile/`. Combined with
   `BUG_API_BASE` defaulting to `http://127.0.0.1:3000` (`scripts/bugctl.mjs:49`),
   a non-browser writer is hard-401'd by `bugWriteGuard`
   (`serverBugSnapshot.ts:65-83`) and its write queues.
6. **The `telegram-photo` skill teaches the wrong recipe.** It says to
   `node scripts/qa-runner.mjs --journey=meal` to "Capture a live app
   screenshot" — a headless desktop Chromium against the live site, not the
   phone. That is a simulation of the app, not a picture of the user's phone.

## Plan

### Node 1 — absolute evidence URLs (fix the #303 defect)
- **Target:** `src/utils/bugSnapshot.ts` (`buildBugEvidenceText`,
  `bugArtifactUrl`), `serverBugSnapshot.ts` (packet route).
- **Do:** add an optional `origin` to `buildBugEvidenceText`; when present,
  absolutise the artifacts URLs it emits. Default stays relative so the in-app
  browser rendering is byte-identical. The packet route derives the origin from
  the request — follow the existing pattern at `server.ts:3245`
  (`req.protocol` + `req.get('host')`), and honour `x-forwarded-proto` since the
  deploy sits behind a tunnel.
- **Pitfall:** do **not** hardcode a host. The same code serves localhost, the
  duckdns tunnel, and a quick-tunnel hostname that changes on every reconnect.
- **Pitfall:** keep `photo_urls` (already absolute) untouched.
- **Sensor:** a text packet requested with a Host header renders absolute
  screenshot URLs; with no origin it still renders relative ones.

### Node 2 — the bug-ticket lane files a picture as evidence
- **Target:** `scripts/skills/common/bug-ticket/SKILL.md`,
  `scripts/skills/common/telegram-photo/SKILL.md`.
- **Do:** teach the lane, in the skill it actually loads, that an inbound image
  is evidence: `bugctl create --screenshot=<abs path>` for a new card,
  `bugctl evidence` for an existing one. State the preconditions that make it
  work — `BUG_API_BASE` pointing at a reachable server, `BUG_API_TOKEN` set, and
  the honest failure mode (a missing file is a hard error; an upload failure is
  a warning and the card still exists). Correct the `telegram-photo` skill's
  capture recipe so it stops pointing at a desktop headless run.
- **Pitfall:** this is a **skill**, not a bot-host patch — Finding 1. Do not
  edit `scripts/bot-host.mjs`; it is Frozen here precisely because it is the
  wrong seam for a hermes-runtime bot.
- **Pitfall:** keep the skill net-zero in spirit — replace the wrong recipe, do
  not append a second contradictory one.
- **Sensor:** the skill names the flag, the preconditions, and the failure mode;
  no `qa-runner --journey=meal` remains as the answer to "capture the phone".

### Node 3 — a drainer that something can actually call
- **Target:** new `scripts/bugctl-drain.mjs`; new `scripts/lib/bug-intake.mjs`
  holds the reusable pieces.
- **Do:** a standalone, cron-safe drainer: replay `.bugctl-queue.jsonl` through
  the same op mapping `bugctl flush` uses, exit 0 when the queue is empty or
  fully drained, exit 1 when rows remain. Idempotent, bounded, no Telegram
  dependency. Put the shared "is this queue row replayable / what does it need"
  logic in `scripts/lib/bug-intake.mjs` so it is unit-testable without spawning
  a server.
- **Pitfall:** do **not** duplicate the op→route table. `scripts/bugctl.mjs` owns
  it and is **Frozen**; read it rather than forking it, and say so in the skill
  if the tables ever drift.
- **Pitfall:** a drainer with a side effect per row must never delete a row it
  failed to send. That is the bug class in `assert-bug-repro`'s bundle checks.
- **Sensor:** unit tests for the queue-row logic; drainer exits 0 on empty, 1 on
  un-sendable rows, 0 after a successful replay.

## Test plan

```text
npx tsc --noEmit
npx vitest run src/utils/bugSnapshot.test.ts
node --test scripts/bug-intake.test.mjs
node scripts/assert-bug-ticket-continuity.mjs
node scripts/journey-guard.mjs collab-bug-intake
```

Per `docs/agent/DOMAIN_REGRESSION_MAP.md:145-146` this domain is
`src/utils/bug*.test.ts` + `tests/bugctl-queue.test.ts`. New logic goes into the
new `scripts/bug-intake.test.mjs`; **do not** extend `tests/bugctl-queue.test.ts`,
whose subject is `bugctl`'s own queue and which this packet must not change
(`scripts/bugctl.mjs` is Frozen).

## Audit plan

1. Scope vs ROADMAP — a locked packet, not a ROADMAP ID.
2. **Standing rows in force** — `meal_image_unique` (one URL per capture; drop
   `data:` once a stored key exists): Node 2's skill must not tell the lane to
   keep a local data URL alongside a stored shot. `load_hack_forbidden`: no
   deleting tests or gates to make this pass.
3. **Class list** — forbidden: hardcoding a host, forking bugctl's op table,
   editing Frozen files to make a gate pass, or a drainer that drops unsent rows.
4. **Honest residual, named not painted**
   - **The token is still not provisioned.** This packet makes the lane *able* to
     file; `BUG_API_TOKEN` / `BUG_API_BASE` for `HERMES_BUG_TICKET_TOKEN`'s host
     are VM config, not repo content. Until they exist, writes still queue.
   - **The drainer still needs a scheduler.** This lands a safe, idempotent
     command; wiring a timer is an ops step on the VM. Do not claim it is
     scheduled.
   - **No bot wires inbound photos to cards automatically.** The lane is taught
     to; it is an agent, so it decides. That is the honest ceiling for a
     hermes-runtime bot without editing its runtime.

## Blast radius

Allowed / Frozen are the YAML lists above.

Out of scope, explicitly:
- `scripts/bugctl.mjs` (Frozen — own the queue, do not fork it).
- `scripts/bot-host.mjs` (Frozen — wrong seam, Finding 1).
- `bots/registry.json` (CODEOWNERS `*`, and the token env is VM config).
- Any auth change. `bugWriteGuard` stays exactly as it is.

## Stop and come back

Two repairs fail · any Frozen file appears in the diff · Node 2 turns out to need
a `bot-host` hook after all (stop: that contradicts Finding 1) · the drainer
turns out to need to mutate `scripts/bugctl.mjs`'s queue format.

---

## Build log (Builder, all three nodes patched)

| Node | Status | Sensor |
|------|--------|--------|
| 1 absolute evidence URLs | done | `originFromHeaders` + `buildBugEvidenceText({origin})`; 4 new cases; tsc clean |
| 2 lane files a picture | done | `bug-ticket` SKILL gains a "Bringing a picture" section; `telegram-photo` capture recipe corrected |
| 3 a drainer something can call | done | `scripts/bugctl-drain.mjs` + `scripts/lib/bug-intake.mjs`; 14/14 |

### Corrections made to my own plan while building

1. **The packet proposed `bugctl evidence` for attaching a picture to an existing
   card. It cannot.** `evidence` takes `--photo-urls` — URLs that already exist in
   R2 (`scripts/bugctl.mjs:438-449`, route `POST /api/bugs/:tagId/attach`); it
   has no file path and no upload. The skill now says so explicitly and tells the
   agent to file a card with `duplicate_of` or state the limitation, rather than
   promising a one-shot path that does not exist.
2. **`requestOrigin` was moved into `serverBugSnapshot.ts` and then its pure core
   was pulled back into `src/utils/bugSnapshot.ts` as `originFromHeaders()`.** A
   four-line header read exported from a 2400-line server module had no permanent
   test; as a pure function over a header bag it has one, and the Express wrapper
   is a one-liner. Verified the import is cheap either way (918ms) before moving.
3. **`bugShotExt` note carried over from #303**: `png`/`jpg` only, matching what
   the snapshot path writes and what the artifacts route serves as an image.

### Gate results

| Gate | Result |
|------|--------|
| `tsc --noEmit` | clean |
| `src/utils/bugSnapshot.test.ts` | 21/21 |
| `scripts/bug-intake.test.mjs` (`node --test`) | 14/14 |
| `tests/bugctl-queue.test.ts` | 11/11 — untouched, as required (`scripts/bugctl.mjs` is Frozen) |
| `src/utils/bug*.test.ts` | 187/187 |
| `scripts/assert-bug-ticket-continuity.mjs` | 42/0 |
| `scripts/assert-shell-smoke.mjs` | 31/31 |
| `scripts/journey-guard.mjs` | standing PASS, allowed_files PASS, frozen_files PASS, **1 FAIL** |

### The one Guard FAIL — `rewrite`, same heuristic as #303

```
FAIL rewrite: scripts/skills/common/bug-ticket/SKILL.md changed 43% of lines (edit_mode=patch);
              scripts/skills/common/telegram-photo/SKILL.md changed 31% of lines (edit_mode=patch)
```

```
scripts/skills/common/bug-ticket/SKILL.md     +59  -1   (0 deletions; the 1 is a replaced line)
scripts/skills/common/telegram-photo/SKILL.md +19  -2   (2 deletions: the wrong capture recipe)
```

`assert-spec-diff.mjs:198-202` counts additions as churn against a small file.
`bug-ticket` is 82 lines, so a 59-line section is 43% by arithmetic and nothing
was rewritten. `telegram-photo`'s 2 deletions are the *intended* correction Node 2
asked for — replacing the wrong recipe rather than appending a contradictory
second one, per the node's own pitfall.

Not worked around, for the same reasons as #303: the gate is Frozen and protected
by AGENTS.md §3, and both available workarounds (splitting the section into a new
skill file, or leaving the wrong recipe in place) are worse than the flag.

### Honest residuals — the chain is still not end-to-end

- **The token is still not provisioned.** `BUG_API_TOKEN` / `BUG_API_BASE` for the
  host running `@Bug_ticket_bot` are VM config, not repo content. Until they
  exist, that lane's writes still queue. The skill now says to check a read first
  and states that a read succeeding does not prove writes will.
- **The drainer is not scheduled.** It is idempotent and cron-safe; nothing
  invokes it yet. Wiring a timer is an ops step.
- **No bot auto-files a photo to a card.** The lane is *taught* to. It is an
  agent, so it decides. This is the honest ceiling without editing the hermes
  runtime, which this packet deliberately does not touch.
- **The artifacts route is still unauthenticated**, so the absolute URLs this
  packet now prints are open to anyone who can reach the host. That makes the
  links work from every surface *and* makes the pictures world-readable. Gating
  them needs the separate decision flagged in #299.

