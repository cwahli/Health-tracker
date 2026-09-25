# Roadmap — start here

**This is the only execute file.** There is no `studio/` pack folder. Four architecture files sit beside this one. Do not add a fifth.

| File | What it is |
|---|---|
| **This file** | What is left, in order — AI Studio works **this file** |
| [BIOMARKER_LIFECYCLE.md](./BIOMARKER_LIFECYCLE.md) | Pillar 1 architecture |
| [FOOD.md](./FOOD.md) | Pillar 2 — Process (stop at the module table) |
| [RELIABILITY.md](./RELIABILITY.md) | Pillar 3 — infra / quotas + how we fix the site (working process) |
| [QUALITY.md](./QUALITY.md) | Pillar 4 — how we test (§1.4; process goldens §1.3 / **Q-8**) |

Laws: `docs/agent/domains/{biomarkers,food-calc,sync}.md`  
WIP: `AI_HANDOVER.md` (header only) · Completed: `archive/` · `plan/archive/`

**As of 2026-09-18.** Scorecard sealed ALL GREEN **744/0/0** @ `5615f1e` (`golden/scorecard/result_summary/LATEST.md`). Q-9 extract-only shipped. F-11.2 / F-11.3 curator LLM shipped. Q-8.6 outer soak shipped. **Q-11 shell split is COMPLETE** — App.tsx is wiring-only (350 / 14 KB) with real auth/sync, and `Header.tsx` is 690 lines / 28 KB (was 9,101 / 373 KB when Q-11 opened; the settings overlay and theme customizer now own their files). **Grok-only is retired** — locked packets in `specs/active/` are executable by any agent. Do not reopen FDC or put curator back on Analyze.

---

## AI Studio — how to run (PRE-APPROVED)

The human will say **work on the roadmap**. That means:

1. Read **this file** from the top through **Current work**.
2. Implement the **first open ID** that is not `blocked_human`. Locked packets in `specs/active/` are **pre-approved go** — do not wait for Grok quota.
3. Named gates for that ID (below). Never `npm test`. Never ask to confirm a **read**. If a file truncates, read the rest in the same turn.
4. When that ID’s gates are green, **immediately** start the next open ID in this file. Do not wait for “continue.”
5. Stop when you hit `blocked_human` or context pressure (then write one line on `AI_HANDOVER.md` **Now** table: which ID finished).

Do **not** open `archive/`, `plan/archive/`, `FOOD.md` Part A/B, or old F-9 packs.

---

## Current work — R-14.1 cards, then blocked product IDs (2026-09-25)

**Next bot code is R-14.1, one card at a time.** Load [plan/R14_1_AGENT_PLAN.md](./R14_1_AGENT_PLAN.md) and stop. The product shape is [plan/LOCATION_AGNOSTIC_AGENTS.md](./LOCATION_AGNOSTIC_AGENTS.md). R-14.1 is **not** complete. `assert-external-projects.test.mjs` never sends a Telegram command. Do not mark the row done from it.

**Frozen. Do not bring these back** because the chat can now point at another worker:

- BOT-1–BOT-23 and BOT-25's landed lib are history. Do not reopen the lane contract, the soul composer, succession, or the Grok session split to "fit" `/location`.
- V-30.1–V-30.5 are done. The website ticket path stays the website ticket path. External projects do not get a second bug pipeline.
- CB-1–CB-5 are done. **CB-6 as written is superseded** (it required a git push to `origin/main`). Do not start CB-7 or CB-8.
- BOT-24's landed allowance list stays. R-14.1 card 6 reads that list. Do not restart BOT-24 from packet 1.
- Shipped site tracks (S, F, B, D, Q, L landed rows) stay shipped. This plan does not reopen them.
- Do not add a bot per role, per project, or per place. Do not install Antigravity. Do not blank `bots/soul.md`. Do not move a Telegram poller between machines. Do not implement the silent cloud fallback in [LOCATION_AGNOSTIC_PROJECT_COUNCIL.md](./LOCATION_AGNOSTIC_PROJECT_COUNCIL.md). That file is a draft. The agent plan replaces it.

BOT-14, BOT-19, BOT-21, and BOT-23 stay DONE.

**Ticket flow (the agreed shape — roles, not bots):** packer (`bug_ticket`, Solar-free, card only) → QA reproduces (`qa_meal --ticket`, V-30.3) → orchestrator specifies (strong model, locked spec) → you lock (`go`) → script dispatches one healthy backend → verifier (didn't author it) closes on `named_test` green. Packer never writes specs, never dispatches, never edits `src/`. Full role contract: `plan/BUG_TICKET_PIPELINE.md` §4.4. Worked transcript: stuck meal-analysis card (`STALE_TURN`, `jobPreview.ts` turn plumbing) in §6.2. The dev is a transient process, not a bot — no registry row, no token, no memory.

**D-2 is CLOSED.** All ledger rows DONE; verified clean-tree on 2026-09-24: `tsc` 0, 60/60 packet vitest, `journey-guard D-2` PASS (retired from `specs/active/`). Residual: `golden_cases` has no D1 table (skipped by design). Next open work: **F-13.2** (blocked — needs a live T2 `per_100g` lock capture; do not guess math in `finalizeDishLedger`). **V-27 is DONE** (phone check passed 2026-09-24).

**Bot code** follows the rail above (BOT-20 using the existing `scripts/lib/bug-pack.mjs`). **Track V Phase 10 pickup:** V-30.1 DONE, **V-30.2 CLOSED 2026-09-24** (P9 token, one live E2E reply, `enabled: true` + `@Bug_ticket_bot`, traceable fixture + packer-only boundary), **V-30.3 DONE 2026-09-24** (human go received; skill/runner/`repro --check`/gate `assert-bug-repro` 57/0 + live verdict on card #2 → `failed`/`not_reproducible`, `svc-repro` done), **V-30.4 DONE 2026-09-24** (human go received; `--ticket=#n` packet dispatch + guard + plan/attempt/block + verifier separation; gate `assert-bug-dispatch` 49/0; live VPS proof: card #3 → `done` via PR #101 + named_test verify, card #4 → `blocked_reason`, hardening #98/#102/#103), **V-30.5 DONE 2026-09-25** (human go received; generated `bug-backlog.mjs` + preserved legacy, `/resume`, capability proof transitions with ticket-scoped strict, CI gates, `BUG_PIPELINE.md`/`telegram_work.md`, retro-audit 6/6 from disk, review-failures fixture signature sensorized + zero recurrence since #130). The complete dependency order, exact runbook, and file/gate handoff are in `plan/BUG_TICKET_PIPELINE.md` §6.2.

B0 / B7.4–7.6 / B8.0 / Q-8.6 / F-10.8 / Q-9 / F-11.2–11.3 / Q-4 / Q-10 are **shipped**. Do not restart them.

**Q-11 and Q-13 are done** (App.tsx 350 / 14 KB, `Header.tsx` 690 / 28.8 KB, `BiomarkerDictionaryModal.tsx` 3,725 / 180 KB — see the entries below). The only remaining >200 KB file is **`LogChat.tsx`** (340 KB / 6,474 lines, under its 6,500 ceiling after extraction).

## BOT-24 — location-scoped `/freemodel` + allowance (IN PROGRESS — do not restart)

**Rule:** `/freemodel` is a property of the worker that is actually running the turn, never a global catalog. R-14.1 does not replace this list. A depleted lane uses the next equivalent row on that same worker. A location change happens only when that list is empty (R-14.1 card 6). Do not reopen packets 1–3. The live matrix below is still the bar before anyone marks BOT-24 DONE. Each VM, phone/proot, and Collab host has its own installed tools, credentials, provider catalog, and quota. The list may show Cline, Token Harbor, Freebuff, Gemini-through-OpenCode, or omit them when that host cannot run or authenticate them. Never infer availability from another host's list or shared pref document.

**Progress reviewed on `main` at `15381ba`; WIP handoff branch: `agent/bot24-catalog-handoff`.** This section is the BOT-24 execute board; do not reopen the completed slices below.

**Landed:** `f34f9b1` added the shared per-bot allowance ledger and per-bot auto-track; `5ee133d` added location-scoped host capability filtering; `931cab2` routed Gemini through OpenCode; `2ce8a43` added router depletion UX and exhausted-route switching; `cd733ed` added the active tool-allowance ping; `712eab9` added explicit Cline enrollment and made router Cline candidates ledger-driven. The active ping and the bot-host command wiring have been live-checked on the VM, but the full BOT-24 live matrix is not complete.

**Reviewed gap:** the command surfaces do not yet share one canonical, host-aware route projection. Bot-host `/freemodel` starts from host discovery and annotates a per-bot ledger, while `/allowance` renders that ledger; the router separately probes provider catalogs and reads its router ledger. A route can therefore appear in one surface but not the other, and a tap can resolve a display label rather than a stable execution route. The shared `free-lanes.mjs` vendor copy has ledger/quota/rendering helpers but no exported host-aware usable-choice projection.

**High-risk findings to fix next:** normalize OpenCode-hosted `tokenharbor/*`, `cloudflare/*`, and `google/*` refs to their actual execution owner before quota/allowance matching; make bot-host callbacks use stable route identities; make bot-host failover and quota stamping use the selected actual route and the per-bot ledger; keep router Freebuff terminal-only by default; pass vendor reset hints through the active ping; and make ping target eligibility and ledger writes explicitly per bot. Do not treat pending/unauthenticated/ended lanes as selectable. The current bot-host freemodels tests still contain three known stale failures from the pre-location-scoped/Gemini behavior.

**Next packet, in order:**
1. Add a pure host-aware canonical usable-choice projection in `scripts/lib/free-lanes.mjs`, with normalized execution route identity, selectable/terminal-only status, current quota, and catalog availability; sync the router vendor mirror.
2. Make bot-host and router `/freemodel` bodies/buttons and `/allowance` usable rows consume that projection, preserving per-bot quota isolation and explicit Freebuff visibility without Telegram selection.
3. Add stable callback tokens, selected-route execution/failover, and per-route quota stamping tests; then add the per-bot active-ping reset/isolation integration test.
4. Run the VM and mobile live checklist below, record host/bot/command/timestamp/reply evidence, and only then mark BOT-24 DONE.

**Completion bar:** the same normalized route-key set is shown by `/freemodel` and `/allowance` for the same host and bot, selected routes execute through the normalized route, depleted selection names the next usable route, vendor reset clocks survive both ledgers, and VM + mobile live acceptance evidence is captured. This WIP branch is documentation-only; no BOT-24 implementation changes are staged here.

1. **Location detection and filtering** — `scripts/lib/freemodels.mjs` detects `BOT_LOCATION`/Termux/host, checks local OpenCode, Cline CLI + auth, OpenCode provider catalog, Token Harbor credentials/catalog, and Freebuff binary + credentials. VM and mobile must produce different lists when their local capabilities differ. Each bot's `/freemodel` must read its own host state.
2. **Cline** — list Cline models only when the local Cline executable works and its auth is present. Mobile ARM64 Cline is omitted until the CLI is actually supported and installed; do not advertise a static Cline list that cannot run.
3. **Token Harbor** — list its free models only when the local OpenCode catalog exposes the Token Harbor provider and this host has its credential. Keep shared Token Harbor quota in the per-bot allowance ledger; do not copy another bot's depletion stamp.
4. **Freebuff** — show the lane for visibility when locally available, marked terminal-only and never rendered as a selectable Telegram button. Do not claim a Telegram execution path that does not exist.
5. **Gemini API** — expose keyed Gemini through a tool surface, preferably `google/gemini-*` routed by OpenCode; do not add new standalone `gemini:` picker entries. Migrate legacy stored `gemini:` preferences to their OpenCode-hosted id. Gemini availability and API quota remain host-specific.
6. **Allowance consistency** — `/freemodel` and `/allowance` must use the same per-bot ledger. Depleted lanes show reset times; selecting a depleted lane must not hang and must name the next usable lane.
7. **Live testing (required before DONE)** — on one VM bot and one mobile bot separately, with no dual poller: send `/freemodel`, verify the displayed providers match that host's local tools; send `/allowance`, verify the location line and reset board; tap one available and one depleted lane; run one real request and confirm the per-host ledger stamps the result. Capture the host, bot id, command, timestamp, and reply in the ticket. A Cline/Token Harbor/Freebuff lane is not live-proven until it is actually available on that host.

**Gate:** `node scripts/check-capability-propagation.mjs`; `node scripts/probe-free-lanes.mjs` for zero-burn location output; then the VM + mobile live checklist above. Do not mark BOT-24 DONE from static inspection alone.

**Do this, in order. Packets are locked = go (`auto_go: true`).**

1. **Q-11.7 DONE** — `31aece2` (ProfileModal out of `Header.tsx`). Packet retired to `specs/done/q-11-7-header-profile.SUPERSEDED.md`; its `≤ 1,200 / < 200 KB` target was unreachable from the profile portal alone and is carried by 11.12.
2. **Q-11.10 DONE** — `e2ab233`. App `handle*` bodies → `useFoodLogActions` / `useBiomarkerActions` / `useReportActions` (App.tsx 3,114 → 1,098). `specs/done/`.
3. **Q-11.11 DONE** — App.tsx 1,098 → **350 lines / 14,416 B**, wiring only, via `useAppShellState.ts`; CATALOG ceiling 350, parity re-recorded. `specs/done/`.
4. **Q-11.12 DONE** — nodes landed `cdbf2cd` (settings overlay → `DbInteractionsOverlay.tsx`) and `c92ec49` + `2fb8d88` (theme customizer → `useThemeCustomizer.ts` + `ThemeCustomizerScreen.tsx`, move-only, then its orphaned imports). `Header.tsx` 3,545 → **690 lines / 28,791 B**: the packet's ≤ 1,200-line and < 200 KB targets are both met, and every moved slice was proven byte-identical against the pre-move file. Packet retired to `specs/done/`. **The Q-11 ladder is complete** — no Q-11 packet is active.
5. **Q-13 DONE** — `specs/done/q-13-biomarker-dictionary-split.md`. `BiomarkerDictionaryModal.tsx` 6,230 lines / 345 KB → **3,725 lines / 183,970 B**, under the AI Studio 200 KB ceiling. Nodes: `02d84dc` packet → `145d8e2` consolidation panel (49.7 KB) → `450f7c4` data-accuracy panel (41.7 KB) → `ad84598` agent panel (37.6 KB) → `fafc060` `DictionaryItem` + `autoCalibrateBiomarkerCalibrate`/`autoCalibrateBiomarkerDef` + `ensureCustomRanges` (44.6 KB, no props). CATALOG ratcheted 6640 → 3726. The planned batch-paste panel (49.2 KB / 74 props) was dropped as poor value — the file already cleared the ceiling without it. **Do not touch `LogChat.tsx`** — another agent is editing it in this working tree, and it is now the largest remaining file (340 KB / 6,474 lines, under the 6,500 ceiling).
6. **R-13.1 LIVE on OVH VPS-2 (Track V V-0...V-16 COMPLETE, Phase 6 V-19...V-26 COMPLETE)** — host is **OVH VPS-2** (`https://health-tracking.duckdns.org`), Caddy + systemd `health-tracker.service` (node dist/server.cjs), GitHub Webhook auto-deploy active. Render in 24-48h soak mode prior to V-17 deletion. **Next mobile ID: V-27 DONE 2026-09-24** (Mosh + tmux `health`, public key-only SSH, phone check passed). Plan: [VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md) Phase 7. Do not redo V-19…V-26. **Auto-deploy wipes uncommitted work — always push.**
7. **F-13** — `specs/active/F-13.md` stays locked for food follow-up; do not mix with Q-13 files.
8. **Track D — D-2 is the ACTIVE execute ID (see top).** One SQL = **D1** (Firebase Auth + R2). Plan: [DATA_PLANE.md](./DATA_PLANE.md). **R-5 superseded.** Muse audit: [R2_STORAGE_AUDIT.md](./R2_STORAGE_AUDIT.md). **D-1** = unpaid recovery when 402 lifts (~**2026-09-24**), not a paid dump. R2 leak-stop is **D-9 DONE**; R2 deletes are **D-10 after D-1**. **SQLite on the VPS is D-5: benchmark only, after V-16.** No cutover without D-6 human go.

**BUG-1 — Food pagination count fallback (recurring regression, COMPLETE 2026-09-24).**  
Fixed across 5 layers: (1) `src/utils/syncUtils.ts` awaits `authStateReady()` and falls back to `localStorage.getItem('auth_token')` so mobile/custom sessions attach Bearer token and stop getting 401; (2) `server_db_d1.ts:d1PullSync` retries count query on transient failure and does not fall back to `rawFoods.length` on pagination/incremental queries; (3) `server_routes_sync.ts` stops falling back to `activeFoods.length` for `totalFoodsCount`; (4) `src/hooks/useAppSync.ts` uses `Math.max` ratchet so total count never regresses downward and caches/restores `totalFoodsCount` in storage bundle; (5) Deterministic sensor planted at `src/utils/__tests__/foodPaginationCount.test.ts` (7/7 pass). Learning: `specs/learnings/food-pagination-count-fallback-20260924.md`.  

**BUG-2 — Gemini 503 on food analysis (peak demand mitigation, COMPLETE 2026-09-24).**  
Enhanced `server_food_scout_source.ts` with emergency safety net: (1) increased backoff delay for 503/UNAVAILABLE to 2500ms; (2) `runScoutRetryLoop` now hops to `gemini-2.5-flash` if both `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` return 503/UNAVAILABLE during peak demand on the flash-lite infrastructure. Verified via `sync-regression` + `food-calc`, `tsc` 0.

**Still `blocked_human`:** **L-5** (name a locale first — do not invent `fr`/`zh` copy), **D-3 / D-5…D-6 / D-10** (**D-1 is DONE 2026-09-25** — Supabase 402 lifted, 197 rows backfilled, see [DATA_PLANE.md](./DATA_PLANE.md)). **Do not start:** USDA, curator-on-Analyze, Q-9 rewrite binge, LogChat/FoodCard/Dictionary splits (need their own packets), ConfirmBar as a side quest, Cloud Run go-live, deleting Render before soak PASS, **VPS SQLite as production**, dual-write D1+SQLite, **paying to unpause Supabase**, **R2 bulk-delete from `R2_DELETE_CANDIDATES.json`**. **Do not stub** auth/sync to hit a line budget (`a14abea` / `7d94def`).

**Gate:** `npx tsc --noEmit` · `node scripts/assert-biomarker-lifecycle-m31.mjs` · `npm run scorecard:debug` (sealed ALL GREEN 744/0/0 at `5615f1e`, `golden/scorecard/result_summary/LATEST.md`).

**Human ops DONE 2026-09-14 (site live, not Gemini):** Render serves `GET /api/scorecard/contract` (`live_origin` PASS in sealed run); `supabase/migrations/20260913_brand_menu_items_status.sql` applied to live Supabase by hand; Home Top Targets confirmed (sat fat over target red).

```text
                    ┌─────────────────────┐
                    │  4. Quality loop     │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   1. Biomarkers         2. Food              3. Sync
```

**Standing rules (every task)**

1. Work item = **one class**, not a job id or “make EMIS all-green.”
2. Inner loop = **vitest, no Gemini.** Outer = one frozen example.
3. Allowed files only (`QUALITY.md` playbooks).
4. Two burned hypotheses → STOP.
5. Honest residual (pending / unmatched / flagged / MISS) is success.
6. Ship after COMPLETE (`tsc` + named gates). IMPACT before coding.

Locked converts never change: `1.293` / `1.411` / `3.362` / `79.56` / `13.68`.

---

## Which track now

| If you are… | Do |
|---|---|
| **AI Studio / Gemini / OpenCode / Cline (default)** | **Current work** above. Locked `specs/active/` packets. F-10 is shipped. |
| **Grok leftover** | **Retired 2026-09-17.** F-9.5 / F-10.6 / Q-8.1–8.6 / Q-9 / F-11 / F-12 / B8.1 shipped. Q-4 + Q-10 packets locked for any agent. Do not sit in a live wait loop. |
| Tests feel huge / every edit runs everything | **Q-7:** named map rows only. Do not `npm test`. Do not recreate missing asserts. |
| Food create architecture | **F-10** (one Meal Agent + TS expand). Not a Dietitian critic. |
| Food calories / debug file | **F-8.10, F-8.12, F-8.13** (split, packaged bind, debug). Soak is **F-10.8**, not a replay of always-dietitian. |
| Food identity still wrong | One **class** playbook (`FALSE_FRIEND` first). **Not** USDA. Brand catalog = **F-11**. Delete FDC = **F-12**. |
| Biomarkers | **B0** Apply smoke, then B2 leftover hygiene, then real G-B2. Chat UX = fill-template (one agent + TS batch), not 10 personas. |
| Site is slow | **R-8** measure (Q-1 is already green). Then R-9 defer. Not FoodCard/App splits first |
| Make the site live / leave Render | **Track V / R-13.1 LIVE on OVH VPS-2** — [VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md). Origin is `https://health-tracking.duckdns.org`. V-17 (delete Render) waits on the soak. Phase 6 (V-19…V-26) is COMPLETE. **V-27 server config COMPLETE** (Mosh + tmux `health`, awaiting phone check). **V-28 COMPLETE** (Telegram 3-dot typing action, inter-agent waiting status, and telegram_work.md). **V-29 COMPLETE** (Granular Orchestrator toolkit: status, stop, list-models, single-tool execution mode, and structured failure summaries). |
| Localisation leftover | **Active** — human unparked Track L 2026-09-15. Restore EN/ID packs (no invent); L-1…L-4 in progress; L-5 waits on named milestone locale. |
| Location, `/project`, `/role`, or the rating council | [R14_1_AGENT_PLAN.md](./R14_1_AGENT_PLAN.md). Not a new bot. Not Antigravity. Not the council draft's offline cloud fallback. |
| Website / live-pass bugs | **Track S** below. One class, named vitest. Not the next live case. |
| New feature or update | [RELIABILITY.md](./RELIABILITY.md) **§10** gate table in the same change, then the F / B / L id. Do not start with a live case matrix. |
| Meal-Audit Bot (audit of live meal turns) | **LIVE 2026-09-22.** Plan [MEAL_AUDIT_BOT_PLAN.md](./MEAL_AUDIT_BOT_PLAN.md). Bot **@Meal_audit_bot** — token in `~/.hermes/profiles/meal_audit/.env`, `auth.json` copied from default (fixes "not logged into Nous Portal"), home channel `6218257274`, `hermes-gateway` multiplexed. Model `upstage/solar-pro4:free` (nous) + vision `stepfun/step-3.7-flash:free`; skill `meal-audit-engine`. **E2E W1 PASS:** photo → bundle `Meal-Instant-Noodles-01` (32-nutrient ledger, Atwater Δ3.4%, bbox + copied photo, `meal-audit-compare` PASS). `MAI-20260922-001` fixed (`turnKey`), fixtures `scripts/fixtures/meal_audits/`, suite 2/2 PASS, calibrate=100. **Cleared 2026-09-22:** (1) canonical = repo `artifacts/meal_audits/` via absolute `--output-dir` (SKILL 2.2.0; old gateway-cwd diverts fixed) — supersedes the choose-the-dir question (repo `artifacts/meal_audits/` via **absolute** path, or keep profile holdout) and align `SKILL.md`; (2) model **code-fenced** the `MEDIA:` tag (skill forbids) — gateway still extracted it, but harden the skill/prompt and re-verify on phone; (3) holdout → `golden/meal/` promote step missing; (4) `meal-audit-suite.mjs report` skips the `holdout/` dir (only matches `Meal-*`) — rename bundle dir or teach the scanner; (5) **W2** multi-turn flow review not yet run against a live job id/timestamp; (6) managed-bot pairing (`t.me/NousHostedHermesBot`) timed out twice — **BotFather manual token** is the reliable path, document it. |

### Bot side — reference (execute from docs/agents/bot_work.md)

**Cold agent:** load `docs/agents/bot_work.md` only. This table is reference. BOT-1–BOT-8 are history. There is no Cline agent. The Cline CLI adapter is degraded for session resume and is not the pickup. V-30.2 is closed (P9 + E2E recorded 2026-09-24, `plan/BUG_TICKET_PIPELINE.md` §6.2); V-30.3 is done (live repro verdict on card #2).


Contact model is **A**: OpenCode master **self-serves** meal-audit via shared skill; it does **not** message `@Meal_audit_bot`. Never put `meal_audit` in `bots/registry.json` (Hermes owns that token / single `getUpdates`).

**Binding correction (2026-09-22, mid-course):** `@Android_opencode_bot` must talk to **this Android device’s opencode** (Termux / proot / the interactive phone session) — **not** the VPS. Name = device. The first direct link (token + chat `6218257274` in proot `~/.hermes/profiles/meal_audit/.env`, test reply `opencode online`) was the device path. Enabling `bot-host@android` **on the VPS** was wrong for that intent: it bound the bot to `/home/ubuntu/src/Health-tracker` + VPS opencode. **Change the bot mid-course = flip ownership to the phone and stop the VPS poller.**

| ID | Item | Status / next |
|---|---|---|
| **BOT-1–BOT-8** | Done. Phone bind, one-poller guard, meal-audit dir, souls cleaned. | **HISTORY** — full rows are under Bot history. Do not load. |
| **BOT-9** | Align provider-router + Grok shared pack with **bot-host / `scripts/skills/common`** (inbound-media, `telegram-photo`, Hermes sync) and ship **§14.7 propagation** (Hermes, VPS, Mobile, Grok TG, Collab — common vs bot-specific). Same work as **R-14**. | **PARTIAL 2026-09-24** — common-skill cores landed: `telegram-matrix` (Case D), `telegram-allowance` (Case E discoverability), `telegram-inbound-media` (Case C discoverability); all auto-sync via `sync-hermes-skills.sh`. Still open: per-class propagation/smoke (distribute matrix), live failover wiring in `bot-host.mjs`, Grok-side import/mirror. Do not invent a second photo/matrix stack; Collab stays opt-in. See RELIABILITY.md §14. **Transport hardening (research 2026-09-24): 409-conflict loud exit (second poller must die loudly, not fight over offsets — runtime has no 409 detection) + proactive `X-RateLimit-Remaining` slowdown in `tg-api.mjs`/`tg-throttle.mjs`. Transport DONE 2026-09-24:** 409 exit already in bot-host, now also in collab-bot (plus its object-token constructor fix); `Throttle.noteHeaders` proactive slowdown + `TelegramApi.onHeaders` hook; `assert-tg-transport` 15/15 + `tg-transport.test.ts` 7/7. Still open: per-class propagation/smoke, Grok-side import/mirror. **Live failover wiring DONE 2026-09-24:** bot-host message path runs through `runOpencodeWithFailover` (chat model → bot default, user-visible switch line); `assert-model-failover` 10/10 + `bot-host.test.ts` 126/126. |
| **BOT-10** | Bot succession (2026-09-24): `@Opencode_135_bot` → `@VM_19485_bot` (**LIVE**); new `@VM2_19485_bot` (**LIVE** 2026-09-24 — `vm2.env` synced from master, enabled, `bot-host@vm2` connected, 14 commands); `@Android_opencode_bot` → `@mobile_8768_bot` (**LIVE 2026-09-24 phone** — token at `/root/.config/opencode-bot/mobile.env`, registry `mobile` enabled + `allowedUserIds`, device runtime selectable via `--id`, start `setsid nohup ~/start-mobile-opencode-bot.sh`, connected `@Mobile_8768_bot` 14 commands; **retired 2026-09-25**: registry ids `opencode` + `android` removed after succession). Old handles dropped per succession — VPS door is `@VM_19485_bot` (+ `@VM2_19485_bot`), phone is `@mobile_8768_bot`. **Location rule — the poller stays on the host in its name:** `VM*` pollers run on the VPS (`bot-host` systemd), `mobile*` on the phone (Termux/proot), `collab` on Colab, `hermes*` on the Hermes gateway. Never cross-host a token (BOT-5 one-poller law still applies). **Chat routing is not succession.** `/location` sends a turn to a connected worker. Do not reopen BOT-10, and do not move a token, to do that. Setting `BOT_LOCATION` on the VM is not a location change. Token flow documented in `bots/TOKENS.md` (master → `sync-bot-tokens.mjs` → per-runtime env). | **LIVE 2026-09-25** — succession done: old handles retired from `bots/registry.json` (`opencode`, `android`); remaining: human E2E proof per VPS bot. |
| **BOT-11** | TG skill-propagation test matrix (2026-09-24) — every shared capability must prove itself per bot class (Hermes / VPS / Mobile / Grok TG / Collab) before it counts as propagated. Scopes follow §14.7 (`common` vs `runtime-adapter` vs `bot-specific`); Collab opts in only where listed. **T1 chat capability:** agent answers use native TG copy blocks + copy buttons (`scripts/lib/tg-copy-code.mjs`, `sendCopyable` — already live, has unit test) and table-as-pipeline JSON rendered natively (shared convention still to standardise — no second format per bot). **T2 service usage:** agent discovers a service registry and calls out (today: `meal_audit` self-serve via shared skill, bug → orchestrator via `orchestrator-dispatcher` so the agent doesn't fix it itself); test = dispatch from each class lands in the right queue. **T3 UI capability:** `/` command-menu popup listing instructions (e.g. `/models`) + `...` typing pulse while thinking (`docs/agents/telegram_work.md` V-28: `sendChatAction` every 4s, progress lines end `...`); test = menu visible + dots never gap on long runs. **T4 process management:** crash recovery, concurrent-request ordering, and quota-exhaustion failover with disabled/enabled lane tracking + recovery path — re-use the Grok-built component vendored in `tools/telegram-provider-router` (`FREE_ALLOWANCE_BUCKETS`, `markDepleted`/`isDepleted`, `nextFailoverRoutes`, Busy self-heal) plus `runWithModelFailover` in `agent-opencode.mjs`; test = deplete a lane → same prompt completes on next lane with user-visible switch line. **Learning loop:** failures auto-record (`failure-log.mjs`) and repeats are reviewed (`review-failures.mjs`) under the §14 ratchet — 2nd same-signature failure must yield a sensor or standing update. **T5 tool management:** per-tool interaction rules (Cline / OpenCode / Token Harbor / …) saved per tool in `golden/scorecard/current/FREE_MODEL_TOOL_PICKER.md` + `FREE_CODING_TOOLS_CATALOG.md`; a learning on one tool (model pick, thinking-data quirk) is written there once and all agents inherit it; test = new learning appears in picker and changes the next bake-off pick. **T6 session continuity (added by review):** `/new` / `/compact` / `/abort` + per-chat sessions + crash-safe resume (CB-8 memory still open). **Automation (no manual per-bot checks):** `bots/capabilities.json` is the central registry (19 capabilities, every TG feature mapped, zero orphans as of 2026-09-24) and `node scripts/check-capability-propagation.mjs` gates it — missing core files, bad skill frontmatter, undeclared classes, and orphan skills/libs fail the run (`--strict` also fails `partial`/`open`, for release gates). Continuous intake per §14.7 Case H ladder: `node scripts/add-capability.mjs --id x --test T1 --scope common` scaffolds the entry (all classes `false`) so the checker forces the author through core → per-class rollout → prove before it can go green. Live per-class smoke stays manual per the §14.7 distribute matrix. | **OPEN** — T1 copy path DONE (lib + test); T3 typing DONE (V-28); registry + checker DONE and green; rest unproven per class. Gate per capability: checker green, then one scripted check per affected class, no dual-poller (distribute matrix §14.7). |

| **BOT-12** | Session contract, surface-agnostic. Per-chat id in `sessions.json`. A follow-up resumes from the compact handoff, never the raw transcript. Quote text/caption already ships via `buildQuotedPrompt`. A surface that cannot resume is degraded. The Cline CLI 3.0.65 adapter cannot headless-resume (`--id` forces interactive mode and rejects `--json`). Do not ship a fake `--id`. Do not start here. | **PARTIAL** — quotes done. Cline surface degraded. Not the pickup. |
| **BOT-13** | Retrieved memory. Stores `decisions/`, `dead-ends/`, `facts/`, plus shared `USER.md` under the existing caps. Retrieve only on a build, investigate, or decide turn. Do not inject a whole file. Do not append a `/compact` summary. Missing, over-cap, or stale → a receipt. Count false-fires. | **DONE 2026-09-24.** `scripts/lib/memory-stores.mjs` + `assert-memory-stores` 21/21 + `memory-stores.test.ts` 8/8. |
| **BOT-14** | Skills-bridge repair P3 (2026-09-24): the two dead `shared_skills` paths in `bots/registry.json` (`social-media/telegram-media-delivery`, `autonomous-ai-agents/opencode` — neither exists on disk) become symlinks/copies of `scripts/skills/common` via `sync-hermes-skills.sh` + a Mac-side parity check. Grok box picks up `tools/telegram-provider-router/docs/BOX_ALIGN_PLAN.md`. Gate: no registry skill path missing on disk. | **DONE 2026-09-24.** PR #76. |
| **BOT-15** | One outcome row per dispatch: ticket, surface, provider/model, defect class, tokens, wall-clock, outcome. The pre-action gate reads it in code, beside the file locks, before the edit. The second identical signature writes one test or rule the same day. A prompt footer is not the gate. Hermes `bot-failures.jsonl` is a reader. | **DONE 2026-09-24.** `scripts/lib/run-ledger.mjs` + `assert-run-ledger` 26/26 + `run-ledger.test.ts` 9/9; gate + outcome rows wired into `run-coding-dispatch.sh`. |
| **BOT-16** | Composed soul: `bots/soul.md` base + one `soul` line per capability + `bots/soul.<id>.md` override. Line budgets. The three laws in `docs/agents/bot_work.md` (one defect, the script starts the coder, `named_test` closes the card) live in the shared soul, because the Hermes gateway cwd is `~/.hermes` and a Telegram turn does not load `AGENTS.md`. | **DONE 2026-09-24.** `bots/soul*.md` + `soul-compose.mjs` (budgets 12/4/16/34) + `assert-soul-compose` 52/52 + `soul-compose.test.ts` 9/9; `setup-hermes-global-soul.sh` writes souls only via the composer. |
| **BOT-18** | Silence to a receipt — crash receipt + 409 exit. Write `{chatId, messageId, startedAt, pid}` at run start and update when messageId is created. On boot, edit every orphaned progress message to `restarted mid-run — send it again` and append a `crash-pending` row. On Telegram 409, `process.exit(1)`. | **DONE 2026-09-24.** Tests: 119/119 green. |
| **BOT-17** | Agnostic lane contract. A bot id is a place. The runner for a message is a surface, not an agent. A model is a backend. There is no Cline agent and no Gemini agent. An API-only backend declares no tools and no session. A surface that cannot honor session, memory, the typed ticket, or the crash receipt is marked degraded (the Cline adapter already is, for resume). The dev is a transient process the script spawns — never a bot, never a registry row. Any backend (opencode/cline/grok/agy/human) may fill the Specify, Implement, or Verify role; the card, packet, and gates don't change. | **DONE 2026-09-24. Frozen.** `scripts/lib/lane-contract.mjs` + `assert-lane-contract` 25/25 + `lane-contract.test.ts` 12/12. R-14.1 does not reopen this row. The poller id stays a place. `/location` is a worker preference on that poller, not a new lane and not an Antigravity install. |
| **BOT-19** | Tool-agnostic work-session observability and shared terminal visibility — create a session on demand per active location/chat/workspace, never permanently per bot. `tx on` enables the shared work view; `tx off` hides it without stopping work; `tx status` and `tx debug` inspect the active work session. Generic `/debug`, `/handoff`, and `/abort` work for every bot/backend; `tx` never owns stop/abort semantics. One physical location maps to one tmux session; each bot/workstream maps to a window. For OpenCode, `tx on` attaches the real interactive TUI to the same server-backed session used by the bot; API-only providers expose structured events/transcripts and report live attach as unavailable. `/status` shows work-session, execution surface/provider, controller, and debug capability. Shared observation is default; input is serialized so bot and human do not interleave PTY writes. Lane changes stay in the same work session with handoff. Gate: all supported backends answer the same debug/status probe; terminal backend attaches and shows shared activity; API backend returns an honest event/debug view; handoff/abort preserve state; no raw secrets in Telegram. | **DONE 2026-09-24 (live acceptance passed; see BOT-19 live-observer pickup for the proof log).** The shared observer gate remains green; OpenCode TUI attachment is the corrected live execution surface. |
| **BOT-20** | Pack, then reject. `run-coding-dispatch.sh` calls `scripts/lib/bug-pack.mjs` (`packForDispatch` calling `packCheck` / `splitMultiItemReport`). Input is a versioned `work_item` or the four fields (`page`, `observed`, `expected`, `screenshot`). Multi-item reports split into 1 card + split list. Payloads failing `packCheck` exit non-zero and never pass through as `--task`. Tests: vitest 17/17, assert-bug-pack 31/31. | **DONE 2026-09-24.** |
| **BOT-21** | Coordination-tax log. `dispatch_lock` stops two writers. Log `(ticket, agent, tool, args-hash)`. The same hash twice on one ticket alerts. Two repro verdicts on one card must match or escalate. | **DONE 2026-09-24.** Tests: vitest 123/123 + 35/35, assert-coordination-tax 29/29. |
| **BOT-23** | Journey investigation & pre-dispatch regression gate. Investigate broken meal/portion journey; add `assert-shell-smoke.mjs` and L1 blast-radius check to `scripts/run-coding-dispatch.sh` `check_git_and_tsc()` before commit/push. | **DONE 2026-09-24.** Tests: assert-dev-regression 17/17, dev-regression helper wired into dispatch. |
| **BOT-22** | Grok router session split. `tools/telegram-provider-router` keeps one global session for every chat. Move it to per-chat. Same contract as BOT-12. | **DONE 2026-09-24.** `src/chat-sessions.js` (per-chat map, lossless legacy fallback) + chat-scoped `ensureOcSession`/dispatch/`/new`/status + `test-chat-sessions.mjs` 22/22; full router `npm test` green. |
| **BOT-25** | Bot error log with open/close status + automatic recovery. Stateful layer over `bot-failures.jsonl` (which stays append-only evidence): `scripts/lib/error-log.mjs` (open → recovering → closed, stable signature ids, recovery-rule table with auto/manual actions), `scripts/errorlog.mjs` CLI (`list`/`close`/`report`/`check`), terminal lane failures auto-open a record and the next clean run auto-closes it (`bot-host.mjs` + `run-ledger.mjs` hooks, best-effort). The generated report stays host-local and is never committed. Gate: `node scripts/assert-error-log.mjs` · `npx vitest run tests/error-log.test.ts`. | **IN PROGRESS 2026-09-25** — lib + CLI + hooks + tests + gate green locally. Live acceptance (real Telegram failure → open → clean-run close on the VPS) pending. |
| | Full matrix + target architecture: `plan/AGENT_ALIGNMENT.md` (audited 2026-09-24, prior art §5, three systems §4). Rule for BOT-12…19: shared change in `scripts/lib` or prompt-level — never one-agent patches. | |

### BOT-19 live-observer pickup — DONE 2026-09-24

**Live acceptance log (2026-09-24, VPS, service tree `/home/ubuntu/bot-host` @ `78b571f` + fix).** (1) Event→log fanout: 3 real bot runs recorded run_start/thinking/usage/run_complete; zero prompt/text/input/output/error/reasoning keys in the live log; 0700 dir, 0600 file. (2) Legacy blank window (`pane %1 cmd=bash`) migrated by a non-destructive split: observer pane ran the exact `/usr/bin/tail -n 40 -F` command, `select-pane` on it. (3) **Residual defect found & fixed live:** real tmux returns `pane_start_command` quoted (`"/usr/bin/tail …"`), so the exact-equality matcher never recognized the pane it created — `debugProbe` stayed `observerLive:false`, repeated `/tx on` would spawn duplicates, `/tx off` could never kill one (fake-tmux tests passed because fakes emit unquoted commands). Fix: `unquoteTmuxValue` strips one shell-quote layer in `parseObserverPanes` + 4 regression sensors in `tests/work-session.test.ts`. (4) Post-fix live battery: probe `observerLive:true` on the real pane; idempotent `/tx on` (no duplicate); `/tx off` killed exactly the observer pane, legacy `%1` untouched; `/tx on` re-created it; a real free-model run visibly progressed the pane (run_start → usage/complete with fresh token count); abort path makes zero tmux calls; `bot-host@vm` restarted on the fixed module (18 commands published). Gates: assert-work-session 42/0, assert-model-failover 10/0, bot-host vitest 134/134, work-session 27/27, `tsc` 0.

**Original live failure proof.** On the VPS, VM `/tx on` created `work-vps:ws-vps-6218257274-home-ubuntu-s-fd07e7bc`, but the pane command was `bash` and showed only a prompt. The VM agent still answered and used tools through `runOpencode`; that process is spawned outside tmux with piped stdout. The current probe reports a window as “attached,” not a live observer. This is the defect: session creation shipped, output binding did not.

**Binding architecture — server-backed OpenCode TUI.** Keep one logical work session and one OpenCode server/session; do not launch a second agent.

1. `/tx on` for an OpenCode lane starts or reuses a local `opencode serve` process, creates or reuses one OpenCode session, and runs `opencode attach <server> --dir <workspace> --session <id>` in the exact tmux workstream pane.
2. The bot submits work with `opencode run --attach <server> --session <id> --format json`; both clients use the same OpenCode session, so the TUI shows the actual assistant, tool, and completion UI rather than a JSON projection.
3. `/tx off` removes only the verified TUI pane and does not abort the server session or the current run. `/abort` calls the attached session abort endpoint and still owns the existing child-process cleanup.
4. API-only lanes retain the structured event view and report live attach unavailable. Other headless terminal lanes must not claim to be an interactive TUI.
5. Preserve renderer-first event ordering, model context on failover, private observer metadata, and secret redaction. The private observer log remains diagnostic only; it is not the `/tx on` display.
6. `/tx on` is idempotent, reuses the exact TUI pane, and never uses `send-keys`, `respawn-pane -k`, `kill-window`, or `kill-session` on an occupied/shared target.

**Required sensors.** Unit coverage for server health/session creation, attach arguments, TUI command persistence, secret-free diagnostic formatting, and private paths; fake-tmux coverage for new-window, legacy blank-window migration, idempotent reuse, exact-pane cleanup, and no destructive commands; event-fanout coverage proving renderer-first behavior and no duplicate OpenCode spawn; model-context coverage across failover. Run `node scripts/assert-work-session.mjs`, `node scripts/assert-model-failover.mjs`, `npx vitest run tests/opencode-tui.test.ts tests/work-session.test.ts tests/bot-host.test.ts`, `npx tsc --noEmit`, then the live BOT-19/lane/memory/soul gates from `docs/agent/DOMAIN_REGRESSION_MAP.md`.

**Live acceptance.** On VM, send one ordinary prompt after `/tx on`; `tmux capture-pane` on the exact target must show the real OpenCode TUI and visibly progress through its tool UI and completion state while Telegram receives the same run. Verify one OpenCode server/session and one run client per attempt, `/abort` aborts the attached session, `/tx off` does not kill the server or unrelated `session 1`, repeated `/tx on` creates no duplicate TUI pane, and bot restart preserves honest status. Only then mark BOT-19 done.

**Do not** dual-poll one Telegram token (VPS + phone, or Hermes + bot-host). **Do not** restart `hermes-gateway` from this track unless a named V-28/V-29 task says so. **Do not** run `bot-host@android` on the VPS. Restart phone bot: `setsid nohup ~/start-mobile-opencode-bot.sh </dev/null >/dev/null 2>&1 &` (android: `~/start-android-opencode-bot.sh`, legacy).

Do **not** start: putting curator back on Analyze, reopening FDC, **R-13.4** Worker rewrite, god-file rewrite to look done, a Commercial Cooking Critic LLM, a 10-case live replay queue, **L-5**, **Q-9** rewrite binge, inventing a catalog primitive, Cloud Run, deleting Render, **production SQLite on the VPS**, dual-write D1+SQLite, dropping Firebase Auth, **paying to unpause Supabase**, **R2 photo deletes before D-1**. **R-5** is superseded by Track D (D1 is already primary). **R-13.0** is agent preflight (PASS); **R-13.1 / Track V** is LIVE on VPS-2 since 2026-09-20. **Track D D-1** is DONE 2026-09-25 (unpaid; 402 lifted; dated log in DATA_PLANE.md). **Track D D-5** is `blocked_human` until V-16. **L-5** stays human until a locale is named. **R-14.1 is the only open bot feature.** Do not reopen BOT-1–BOT-23, V-30, CB-6–CB-8, or a new bot per place. Do not install Antigravity. Do not push a coder commit to `origin/main`.  
F-10 lives here + [FOOD.md](./FOOD.md) Process. Track V lives here + [VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md). Track D lives here + [DATA_PLANE.md](./DATA_PLANE.md).

---


### Bot history (do not load)

A cold agent does not read this table.

| ID | Item | Status |
|---|---|---|
| **BOT-1** | `@Android_opencode_bot` ↔ **Android device** opencode | **DONE 2026-09-22 (device).** Registry `android`: workspace `/root/Health-tracker`, `opencodeBin` `/root/.opencode/bin/opencode`, skills `.agents/skills` + `/root/Health-tracker/scripts/skills`. Token: `/root/.config/opencode-bot/android.env` (`ANDROID_OPENCODE_BOT_TOKEN`). Runner: `~/start-android-opencode-bot.sh` (setsid/nohup restart loop; log `~/android-opencode-bot.log`). **Do not** start this id on the VPS. **Auth 2026-09-22:** phone needs `/root/.local/share/opencode/auth.json` (copied from VPS) or `opencode-go/deepseek-v4.1-flash` fails with `Unexpected server error` (no `OPENCODE_API_KEY`). Bot `--dry-run` PASS after auth copy. **Model 2026-09-22:** android overrides to `opencode/muse-spark-1.3-contributor-free` (phone has no opencode-go subscription; free model needs no auth), `variant: null` (drops inherited `high`: -17s), `playwrightOutputDir: null` (no npx Playwright MCP on phone: -16s). Trivial reply 69s -> ~35s e2e, thinking kept. `--dry-run` PASS on muse free. |
| **BOT-1b** | VPS android service (wrong host) | **DONE — disabled.** `systemctl disable --now bot-host@android` on VPS. `@Opencode_135_bot` stays on VPS (correct). One `getUpdates` per token. **Proof 2026-09-22:** VPS journal `[android] connected as @Android_opencode_bot` 22:26 + VPS opencode ran `opencode-go/deepseek-v4.1-flash` 22:42-22:45 — the VM answered the early messages (VPS offset 433856307). Service now **masked** + inactive; only `--id=opencode` runs on VPS. |
| **BOT-1c** | proot long-poll reliability | **DONE in `scripts/lib/tg-api.mjs`:** `AbortSignal.timeout` (poll+10s) so a dead Termux socket cannot hang forever. Phone network is still flaky (`fetch failed` / abort) — restart loop recovers; do not stack a second poller. **Plus 2026-09-22:** startup handshake retries `getMe`/`deleteWebhook` in-process — a down link at boot no longer crash-loops proot. |
| **BOT-2** | Missing `sharedSkills` packs | **DONE 2026-09-22.** Both packs exist with real `SKILL.md` on VPS; synced to phone `/root/.hermes/shared_skills/`; re-added to master + android `sharedSkills`. Dry-run PASS. |
| **BOT-3** | VPS `sync-hermes-skills.sh` | **DONE 2026-09-22** on VPS (orchestrator-dispatcher excluded from meal_audit; telegram-testing linked). Re-run after skill adds. |
| **BOT-4** | Model A E2E from the device | **DONE 2026-09-22.** Phone owned the token and the user confirmed the reply. The renamed handle's remaining human reply is BOT-10. |
| **BOT-5** | One-poller/token guard | **DONE** in `loadRegistry` (duplicate `tokenEnv` throws). Keep: never enable same token on VPS + phone. |
| **BOT-6** | `run-coding-dispatch.sh` `meal_audit` category | **DONE** (`meal_audit) printf 'meal_audit'`). Optional product choice if tickets should land in that chat. |
| **BOT-7** | Stale BOT_ROLES facts | **DONE 2026-09-22 — verified already clean:** global `MEMORY.md` is 3 lines, no Render refs; QA souls have no placeholders; `system_prompt_suffix` only in qa_* backup yamls, not live configs. |
| **BOT-8** | Meal-audit OPEN items (from live handoff) | **DONE 2026-09-22:** (1) canonical = repo `artifacts/meal_audits/` via absolute `--output-dir` (SKILL 2.2.0); (2) `MEDIA:` fence hardened + self-check; `boundingBox2D` field name pinned (gate caught `bbox`); (3) `suite promote` ships (PASS-only unless `--force`, no-overwrite guard); (4) scanner reads `holdout/Meal-*` with `holdout:true`; (5) W2 live run DONE on `job_1789430101458` (oatmeal photo; site invented nasi-uduk dish -> DIVERGED, ledger +34); (6) BotFather path in MEAL_AUDIT_BOT_PLAN §11. |

## Agent Consolidation & Deprecation Strategy (2026-09-03)

The following multi-agent sprawl is scheduled for removal to streamline the architecture:

1. **Biomarker Agents Replacement**:
   - **Agents to be removed**: Lab Parser (`medical` / `agent1`), Range Calibrator (`data_review` / `agent5`), Categoriser (`agent2`), and Biomarker Reviewer (`biomarker_review`).
   - **Single Unified Replacement**: The new Biomarker Agent developed and benchmarked on the biomarker prototype (`prototype/biomarkers/` with cases C1–C7) will replace all four fragmented biomarker agents with a single-dispatch pipeline.
2. **Peripheral Agent Removals**:
   - **Agents to be removed**: Culinary Ideation Agent (`food_idea`) and Daily Actions Agent (`daily_recommendation`).
3. **Front Desk Routing Strategy**:
   - Plan all routing accordingly: Front Desk operates as the primary intake passation gateway and will route directly to:
     - **Unified Biomarker Agent** for clinical lab panels, blood tests, and reference range queries.
     - **Adaptive Meal Agent** (`food`) for all dietary logging and nutritional breakdown.
     - **Health Coach** (`health_baseline`) for metabolic baseline and lifestyle habit planning.
     - **Front Desk Inline** (`general_receptionist`) for direct profile updates, single vitals, and general Q&A.

---

## Track S — Site class-fixes (2026-09-04)

**Standing process for all new work:** [RELIABILITY.md](./RELIABILITY.md) §10. **This table** is only the 2026-09-03 live-pass burn-down. **Test method:** [QUALITY.md](./QUALITY.md).
**Do not** treat unrun live cases (C4, C6, UC-03 to UC-08) as a to-do list. They are examples for the class they hit.

Landed on GitHub `155a49a` (2026-09-04): empty-demo chat wipe, vision-scout heal so Vision Scout Corrupted does not reach the user, some Meal-06/10 EN/ID chrome, receptionist form locale plus empty-reply fallback.

| ID | Class | Status | Gate (inner) | Frozen example (outer, only after green) | Do not |
|---|---|---|---|---|---|
| **S-1** | `LEAK_EN_CHROME` | Landed | `src/utils/i18n.test.ts` plus leftover-string list in that test | One Kosong Front Desk plus one meal chrome check after the list is green | Unpark L-2 to L-5; translate food names |
| **S-2** | `LEAK_EN_AGENT` | Landed | `agents/dietitianInstructions.i18n.test.ts` plus receptionist/coach `withAgentLanguage` | **L-1** one Indonesian meal-log proof (verdict/advice) | Treat old saved English analyses as chrome bugs |
| **S-3** | `SCOUT_PARSE_FATAL` | Landed; live replay pending | `server_vision_scout.test.ts` | One Meal-10 replay only | 10-case food loop; claim first-pass live green |
| **S-4** | `SCOUT_UNDERCOUNT` | Landed | golden meal locks plus card chrome (kcal/P/C/F visible) | Meal-06 / Meal-10 numbers vs GT | Paint expected.json to match the undercount |
| **S-5** | `CHAT_STALE` | Landed | `src/utils/storageUtils.test.ts` | — | Re-find by logging Kosong live every session |
| **S-6** | `HANDOFF_I18N` | Landed | `src/server/receptionist/handoffContract.test.ts` driven by `prototype/receptionist/benchmark/UC-0x.json` | One UC-02 vitality after the test is green | Full receptionist click-through of UC-01 to 09 |

**Parked leftovers under S-1 (do not dump a 50-key i18n pass):** 1 serving; Preparation:; View Diagnostic Logs; receipt internals (Item Sub-Total / Estimated / Printed Packaging Label); Gender/debug chrome.

**Who runs Track S:** OpenCode plus Token Plan Qwen (DeepSeek PAYG after Token Plan is gone) for one class / one PR. Antigravity only on chiwah.liu@gmail.com for a large class-fix. Grok Bot triages a red golden or reviews a short diff and does not click the next seven cases. Skip Aider+Qwen and Alibaba Qwen Code / Lingma.

### Track S (continued) — 2026-09-12 log-issue queue (meal-log journey first)

Found while triaging `debug-job_1789169906811` + red gates. Work in this order:

| ID | Class | Item | Gate (inner) | Do not |
|---|---|---|---|---|
| **S-7** | `MEAL_JOURNEY_OPEN` | **DONE 2026-09-23:** `dialog-inventory.spec.ts` 4/4 PASS on built server AND on dev server — dialog opens, composer appears, no app-open-flow bug. The failures were VPS env: systemic partial `node_modules` (grpc, aws-sdk, react-dom, leaflet, recharts, firebase, @babel/core) repaired via rm+reinstall (`npm install <pkg>` alone does not replace corrupt dirs). Dev servers on :3001/:3002 stopped after proof; prod :3000 untouched. | Spec green (built + dev) | Paint the spec to match a broken dialog; live Gemini in the loop |
| **S-8** | `LEAK_KEY` | Raw i18n keys from meal compose/narration (`ledgerLoggedMeal`, `adviceProbioticSugar`, `balancedMealFallbackName`, `apMealPosition/…`): 10 failing tests in `server_food_dietitian_dispatch.test.ts` + `narration.test.ts` | The 10 tests + `src/utils/i18n.test.ts` parity (en + id) | Touch helper logic; add en without id |
| **S-9** | `CHAT_STALE` | Empty-demo wipe misses prefixes: export `CHAT_MEMORY_PREFIXES` from `storageUtils.ts`, clear `last_sent_payload_` / `active_session_id_` / `jobstore_` / `chat_messages_` (`tests/deskProcess.golden.test.ts` 1 failing) | deskProcess golden | Widen beyond demo-wipe callers; drop `preferred_language` |

**Status 2026-09-12: S-7/S-8/S-9 all green.** Single root cause found: `bca0f80` bulk-overwrote `src/utils/translations.ts` (6,538 lines) with humanized key names and dropped keys. Fix = reverted that file to `bca0f80~1`, deleted tracked junk `scratch_keys.json`. S-7 verified by 3/3 `dialog-inventory.spec.ts` passing with zero spec changes; S-8 by 54/54 i18n+dispatch+narration tests; S-9 by 7/7 deskProcess golden after the prefix export. Class: `TRANSLATION_DUMP_REGRESSION`. Note: `bca0f80` was a 144-file commit that also deleted golden assets (`tests/Golden_meal/7/8/9`, compare sets) — those deletions were NOT restored here (out of blast radius); `src/utils/storageUtils.test.ts` (S-5 gate) still does not exist.

| **S-10** | `PORTION_FUNNEL` | **COMPLETE 2026-09-12.** Portion clarify asked redundantly (stated 100g re-asked) and stayed silent on 28g-vs-180g-pack: `buildPortionClarifyPayload` never saw user text; pack cues missed `Berat Bersih`; halves gated on whole-pack sanity; pack parser blind to `packageLabelText`. Fix: `src/utils/quantityText.ts` locale boundary (structured candidates, one locale table), candidate funnel in `server_portion_clarify.ts` (user > label > visual; adopt/suppress/inject), shared text blob, per-option sanity, scout dispatch leg + `quantityResolution` in debug export. No prompt/schema/ledger changes. | `server_portion_clarify.test.ts` (38) + `quantityText.test.ts` (10) + `portion-funnel.spec.ts` Playwright + shell-smoke 8/8 + Guard PASS | Second LLM for narration; per-country code paths; silent clamping past pack (record overflow, plausibility gate is backstop) |

# Remaining work

## Track B — Biomarkers (active)

**Architecture:** `BIOMARKER_LIFECYCLE.md`  
**Test method:** `QUALITY.md`  
**Laws:** `docs/agent/domains/biomarkers.md`  
**Gate always:** `node scripts/assert-biomarker-lifecycle-m31.mjs`

Ingest **code** for B1–B6 is on GitHub. Ingest **v1 shipped 2026-09-14** — rows below are the criteria record.

### Done — criteria record (all shipped, kept so gates stay citable)

| # | Item | Done when | Class |
|---|---|---|---|
| **B0.1–0.3** | **Shipped 2026-09-14:** Apply smoke CLOSED on `job_medical_1786666223594` | Card shows HDL 50→**1.293**, TG 125→**1.411**, LDL 130→**3.362**, creat 0.9→**79.56**, bili 0.8→**13.68**; Apply writes history + Home; `observationMeta` raw kept; older SI rows (HDL 1.43, creat 100/72, bili 16/13) untouched | `APPLY_MISS` |
| **B0.5** | **Not needed:** Apply hit, no miss | Failing `APPLY_MISS` test, then fix hydrate / `enrichReviewModificationCommands` only | `APPLY_MISS` |
| **B2.1** | **Shipped** | Extract prompt has no second `Chat History:` prefix (`server.ts`) | hygiene |
| **B2.2** | **Shipped** | Schema / prompt no longer ask the model for `updated_at` | — |
| **B2.3** | **Shipped** | `remainingText` gone from extract path (`server.ts` → `LogChat` → `MedicalAgentExecutor` → `serverJobs`) | — |
| **B2.4** | **Shipped** | `lab_extract` vs `symptom_diary` actually route; G-B6 test **calls** the classifier | `WRONG_DOOR` |
| **B2.6** | **Shipped** | G-B3 shifted-columns / UK `109/L` / panel skip exist and call `lexTable` | `CONFORMANCE_SHAPE` |
| **B4.3** | **Shipped** | `lexTable` + `buildIngestBatch` run on the 140-row fixture; assert **class counts from the lexer**, not `expected.json` labels | — |
| **B5.11** | **Shipped** | Same report upserts; no second observation row | `UPSERT_IDENTITY` |
| **B6** | **Shipped** | `golden-from-medical-debug.mjs`; inbox Biomarkers grouped by class (not a G-B1 stub); G-B5/7/9 tests **execute** the door / completeness / image path | — |
| **B7.4** | **Shipped** (`74e29bc`, packet `specs/done/b7-4-pending-store.md`): Real Pending store | Unknown names never become catalog keys; pending not a field on the `customBiomarkers` bag | `COMPLETENESS` |
| **B7.5** | **Shipped** (`93b702d`, packet `specs/done/b7-5-silent-calibrator.md`): Silent Calibrator | Overlay re-runs when demographic fingerprint (`ageBand\|gender\|ethnicity`) changes — product path, not only a helper | `CURRENCY` |
| **B7.6** | **Shipped** (`9080458`, packet `specs/done/b7-6-name-deduper-leftovers.md`): Name Deduper leftovers | Parallel keys from aliases / `metric_N` still in live profiles are merged or tombstoned | `IDENTITY_PARALLEL_KEY` |

**Stop if:** lexer writes observations · G-B4 fails · Parser is sent a high-confidence name.

Weight/height stay `droppedByApply` until a product decision.

### After B6 (do not start to unstick B0–B4)

B7.4 / B7.5 / B7.6 above. Helpers for 7.1–7.3, 7.7, 7.8 already exist — do not rebuild them.

### Landed — do not redo

| Wave | What is already on GitHub |
|---|---|
| **B0.4** | No Home Auto-Fix / Inspect / Review; no Dictionary Auto-Calibrate / Quick Approve |
| **B1** | `IngestTrace` / `ClassId`; passthrough on medical jobs; `tests/Golden_biomarker/`; G-B1 convert locks; `assert-biomarker-ingest.mjs`; inbox Food \| Biomarkers **tab** |
| **B2 (partial)** | `lexTable` / `buildIngestBatch` / `shouldAbortTablePath`; table path in `serverJobs` |
| **B3** | Shared `getMappedBiomarkerKey`; urine ≠ serum; `convertViaTable` only |
| **B4 (partial)** | NHS aliases; leftover unmatched → Parser; abort when 0 high-confidence |
| **B5 (partial)** | Flagged → Review `update_biomarker`; staged apply; new dates can insert; pending filtered from Home/coach |
| **B6 (fixtures)** | G-B5/6/7/9 JSON examples exist — they do **not** yet execute the pipeline |
| **B7.1–7.3, 7.7, 7.8** | Catalog cleanup helper; relabel XOR convert UI; `observationMeta` backfill; telemetry writers stripped; `biomarker_dictionary_store` deprecated |

`customBiomarkers` is still the synced bag. That is why B7.4 remains.

**Ingest v1 ships** when: B0 Apply verified · G-B1 green · G-B2 green **from the lexer** · no high-confidence names in Parser prompt · no `remainingText` · batch confirm · M31 0.

**Lifecycle done** when: ingest v1 + B7.4–7.6 · unknown names never catalog keys · relabel cannot rewrite numbers · Home/coach never consume pending/flagged.

**Out of Track B:** food pipeline, rename agent ids, delete instruction packs, fuzzy auto-approve, `approve_all`, vision required, new health-planning agents until B0 + `USE_SURFACE_LEAK` are green.

**Same agent pattern as F-10:** typical chat is **one** Review / fill-template dispatch. TypeScript owns identity, `convertViaTable`, status labels, and batch size. Expand to Parser chunks / specialists only when n≥20 or `sourceKind` is table/image leftovers (`BIOMARKER_LIFECYCLE.md` §4.3). Do not add Lab Parser + Review + Calibrator on a C1-sized send. Fill-template remaining work: [BIOMARKER_FILL_TEMPLATE_CASES.md](./BIOMARKER_FILL_TEMPLATE_CASES.md) (C1–C7 green **before** modal wiring).

### B8 — One math path, one door (platform continuity)

Does **not** replace B0–B7. Same pillar, same `convertViaTable` law. Trigger: second conversion table + restored Auto-Fix landed after B0.4. Method: `QUALITY.md` §7.

| # | Item | Done when | Class | Who |
|---|---|---|---|---|
| **B8.0** | **Shipped (Option B)** | Auto-Fix banned from Home; warning banner preserved pointing to Health Clean & Sanitize (`CATALOG.json` choice B, onlyComponent null) | product | Human + Gemini |
| **B8.1** | **Shipped** | `computeBiomarkerTelemetryMultiplier` uses `ANALYTE_CONVERSIONS` only; locked `1.293` / `1.411` / `3.362` / `79.56` / `13.68` unchanged | `SECOND_MATH_PATH` | Grok (constants) |
| **B8.2** | **Shipped** | Dictionary toolbar **or** Cleaning menu, not both | `CLONE_UI` | Gemini |
| **B8.3** | **Shipped** | `runGeneralizedBiomarkerAudit` / `detectFlaggedTelemetryErrors` not re-run from Dictionary + Medical History + Trends + LogChat on the same paint | `EAGER_MOUNT` | Gemini after Grok names call sites |

---

## Track F — Food identity quality + create agent

**Architecture:** `FOOD.md` Process (Meal Agent + TS expand) + Part A catalog (do **not** rebuild curator — M30 assert is green)  
**Method:** `QUALITY.md` + `FALSE_FRIEND` / `DISH_DROP` / `OPENING_WRONG` / `SILENT_REPAIR`  
**Laws:** `docs/agent/domains/food-calc.md`

M21/M22 meal document stay. F-5 TypeError `.calories` is **done**.  
Live USDA/FDC is **abandoned** (F-12). Brand catalog self-clean is **F-11**.

| ID | Status | Done when / parked why | Do not |
|---|---|---|---|
| **F-1** | **Abandoned** | 50-meal audit: FDC overwrite is net-negative. Replaced by **F-12** delete | Reopen FDC; “fix USDA” |
| **F-2** | **Abandoned** | Same. Analyze is OCR → brand → Meal Agent | Last-resort USDA; Analyze USDA-first |
| **F-3** | **Shipped 2026-09-15** | DISH_DROP sensor: sole Nasi Uduk dengan-dan dish unrolls to 3 items (packet `specs/done/f-3-dish-drop-nasi-uduk.md`) | `POST /loop` until all-green |
| **F-4** | **Shipped 2026-09-15** | Measured alias hit rate 1.0 over 13-probe list + negation/dangerous-single merge gates (packet `specs/done/f-4-alias-hit-rate.md`) | Silent merge |
| **F-6** | **Shipped 2026-09-15** | FoodCard 3336 under 3800, 0 food-UI lines added; 3 pre-existing god-file budget fails recorded (packet `specs/done/f-6-net-zero-verify.md`) | New food table / +100 lines “enhance” |
| **F-7** | **Gate green** | `assert-budgets.mjs` PROMPT_BUDGET/scout. Keep net-zero on prompt edits (L12) | Prompt-only unit math |

Q-1 (`assert-budgets.mjs`) is **green**. Brand self-clean is **F-11**. USDA delete is **F-12**.

### F-8 — Single-path add/edit (calorie host must die)

**Architecture:** [FOOD_SINGLE_PATH.md](./FOOD_SINGLE_PATH.md) · [FOOD.md](./FOOD.md) Process  
**Laws:** `docs/agent/domains/food-calc.md`

**Shipped (2026-08-30…31):** F-8.1–F-8.9 (gate, finalize map, edit executor, debug, tiles, packaged bind, heal slim, host deleted, thin HTTP adapter, compiler uses finalize, evidence-job TS fixture 1635 g).

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **F-8.10** | **Shipped** | `server_food_analyze_run.ts` split into 150–600 owners (Meal Agent dispatch, DB search, precalc/finalize, responses). Dead backup deleted. HTTP adapter stays ≤700. | 40-line shards; a second kcal writer |
| **F-8.11** | **Superseded by F-10.8** | Do not soak the old always-dietitian create path. Evidence job still required on the F-10 pipeline | Replay scout+dietitian as “done” |
| **F-8.12** | **Shipped 2026-09-15** | Hemaviton HIT with vitamin C locked 6/6 green; residual closed (packet `specs/done/f-8-12-packaged-bind-verify.md`). F-10 does not replace catalog bind | Invent 1000 mg vitamin C |
| **F-8.13** | **Shipped** | JSON run tree (`debugRunTree.ts`) + `dumpContract` on JSON + Contract-first markdown. Gaps A–F in `docs/agent/domains/debug-contract.md`. | Hash-only prompts; hide schema; PNG as contract; LangSmith/LLM-judge |

Execute **one class** per session. Inner = named vitest. Outer = one frozen example, not meal-green.

### F-9 — Job session (one current turn)

**Architecture:** [FOOD.md](./FOOD.md) Process · `docs/agent/domains/sync.md` jobs  
**Class:** `STALE_TURN` (preview/chat shows a previous turn while a new one is running)  
**Not:** food-calc, F-8.10 split, meal-green. Do **not** mix with F-8.10 in the same PR (`App.tsx` / `LogChat.tsx` collision = `8742686`).

F-8 made calories have one owner. F-9 makes “what is on the preview” have one owner: `job.currentTurn` + `status` + `result` (null while not terminal). Flags (`inFlightTurnAt`, `mealSnapshotKey`) remain as fallback until F-9.5 finishes — do not add siblings.

**Shipped in tree (2026-09-01, `3cf21ff`):** F-9.1 laws/vite assert · F-9.2 `jobPreview` + `JobSession.contract.test.ts` (4/4) · F-9.3 `sessionLog` + cloned `useJob` on the card · F-9.4 `current_turn` column/increment/await upsert/LogChat increment · F-9.5 `JobStore.apply` + sync/runner. Named vitest 26/26 + `assert-f9-pr1` + `assert-dev-serves-vite` green.

| ID | Status | Still to do | Do not | Who |
|---|---|---|---|---|
| **F-9.1** | **Shipped** | — | Add flags; `npm run build` as sync | — |
| **F-9.2** | **Shipped** | — | Store-only tests | — |
| **F-9.3** | **Shipped** (residual) | Session section on **debug download**; log `ignored_stale_turn` (today every commit is `accepted`/`completed`) | New modal | Optional later |
| **F-9.4** | **Shipped** (residual) | Flags `inFlightTurnAt` / `mealSnapshotKey` still exist as fallback. App poller does not send `currentTurn`. Delete flags in a later cleanup, not as a god-file rewrite | Infer turn from calories | later |
| **F-9.5** | **Shipped** | App poller status/result → `JobStore.apply` (`PollerPayload` / `AnalyzeFinished` / `AnalyzeFailed`). LogChat food+medical submit → `SubmitStarted`. Wrapper `updateJob` remains for credits/checkpoint/savedToLog | God-file rewrite; second merge path | **Grok** |

Gemini leftover from PR4 (do not treat as architecture): one-shot `patch_*.mjs` / `fix_*.mjs` at repo root — **deleted in this review**. Do not restore.

### F-10 — Adaptive Meal Agent (one role, expand when TS says so)

**Architecture:** [FOOD.md](./FOOD.md) Process · `docs/agent/domains/food-calc.md`  
**Class:** `ALWAYS_SECOND_AGENT` (create always ran Scout then Dietitian)  
**Evidence:** `prototype/meallog/meal/` (`compare_1_vs_2_agent.ts`, `run_all_11_elastic_benchmark.ts`, `BENCHMARK_PERFORMANCE_SUMMARY.md`)  
**Not:** USDA/FDC, putting curator back on Analyze, F-9.5, a Commercial Cooking Critic LLM, LLM-emitted calories.

Production today still **always** dispatches Vision Scout then Dietitian on create (`server_food_analyze_run.ts`). Prototype 1-agent (scout does identity + P/C/F + verdict; TS Atwater) matched or beat the hierarchical 2-agent path on the 11-case set. Elastic COMPLETE/DELEGATE showed simple packaged meals finishing in ~2.5s with one call; complex hotpots needed extra capacity. **Do not copy the prototype blindly:** the model picked DELEGATE poorly (airline tray COMPLETE’d and Na accuracy went to 0%), and the elastic schema emitted `calories` (F-8 forbidden).

Same pattern as biomarkers: one Review for n=1–5; TypeScript decides batch/expand; specialists only when the dispatcher expands.

| ID | Item | Done when | Do not | Who |
|---|---|---|---|---|
| **F-10.1** | **Shipped** | `src/mealBuild/shouldExpandMealAgent.ts` + vitest + `assert-f10-pr1.mjs`. Do not rewrite. | Trust lite-model self-assessment | — |
| **F-10.2** | **Shipped** | `server_derivation.ts` (`calculateDerivedNutrients`) + vitest. P/C/F present → Atwater; agent kcal ignored. | Ship elastic `calories`; carbs-from-energy on the hot path | — |
| **F-10.3** | **Shipped** | `src/mealBuild/workerMerge.ts` + vitest. Workers receive **locked grams + dish crop**, merged strictly by dishId. | Re-OCR; second kcal book | — |
| **F-10.4** | **Shipped** | `src/mealBuild/narration.ts` + vitest. Saved message numbers derive from finalize ledger table. | Dietitian `itemsBreakdown` rebuild; narrate from pre-finalize estimates | — |
| **F-10.5** | **Shipped** | `server_meal_edit.ts` + `ModeDAndEdit.test.ts`. `modificationCommand` / `[]` / `estimate` executor. | New persona; Mode Rewrite | — |
| **F-10.6** | **Shipped** | `diningEnvironment` × `cookingMethod` in `finalizeDishLedger` via `decidePrepAddition`. Honest residual named `prepAddition.reason`. | Default to a second critic LLM; claim 90% fat on Case 4/9 | **Grok** constants |
| **F-10.7** | **Shipped** | `server_food_analyze_run.ts` adaptive create cutover via `shouldExpandMealAgent`. Dietitian LLM skipped on single-agent paths; D8 scale preserved. | Wrap the old dietitian create as fallback forever | — |
| **F-10.8** | Inner named; outer = Q-8.6 | Inner: 11 prototype cases in `server_dish_finalize.test.ts` (restaurant fat residual on 1/4/9 named, not 90%). Outer: `scripts/soak-q8-tier3.md` | `POST /loop`; soak old scout+dietitian; Grok in the wait loop | Grok reviews / human |

**Do not mix** F-10 with F-9.5 (`App.tsx` collision). Catalog bind (F-8.12) stays on finalize. USDA is **F-12**. Brand clean is **F-11**.

### F-12 — Delete live USDA/FDC from Analyze

**Architecture:** [FOOD.md](./FOOD.md) **Part A.3**.  
**Evidence:** 50-meal audit (production ranker): loose FDC overwrite net-negative; strict match ~0–20 kcal, no extra 30-nutrient panel on current logs.  
**Trigger:** F-12.1–12.4 **shipped**. Not Current work.  
**Not:** keeping a “last-resort” hook; making Analyze USDA-first.

| ID | Item | Done when | Do not |
|---|---|---|---|
| **F-12.1** | Remove `searchUSDA` / `fetchUSDAFoodById` / two-round helpers and all Analyze call sites. **DONE 2026-09-13**: 4 defs + rank-import cut from `server.ts`; precalc DI/imports + scout-hint fetch block cut; db_search fan-out/consumption/HIT_UNIQUE-inject/rank-feed cut, curator gets `undefined` for optional `searchUSDAFn` (param removed in F-12.3). Single-path `F-12.1` negatives + rewritten db_search tests green; `tsc` 0; Guard PASS | `rg 'searchUSDA\s*\(' / 'fetchUSDAFoodById\s*\('` empty in `server*.ts` + `src/server/food` (param name + comments cleared in F-12.3). `tsc` baseline 0 | Wrap in a flag |
| **F-12.2** | Remove `collectFdcHintTasks` / `verifiedFdcHintMap` / `suggestedFdcId` merge. **DONE 2026-09-13**: hint collectors + stopword gate cut from `server_food_precalc`; ctx map init + type field cut; scout schema field + 3 merge sites cut (prompt never instructed it); hint unit test removed, single-path forbids all four names. 19/19 vitest, `tsc` 0, Guard PASS | Default precalc never hits FDC. Single-path test forbids `collectFdcHintTasks` | Leave a hint “just in case” |
| **F-12.3** | Stop `dbSource: 'usda'` writes; curator must not take `searchUSDAFn` / `chosenFdcId`. **DONE 2026-09-13**: `searchUSDAFn` param + USDA parametric-fallback block cut from curator; db_search passes 5 args; curator-result source mapping `usda`→`estimated` (OFF barcodes keep `off`); component fallback default `usda`→`estimated`; dead USDA-candidate push removed; `chosenFdcId` allowlist plumbing stays for F-11.2. Single-path F-12.3 sensor green; `tsc` 0; curator + M30 tests green. Historical `usda` reads (aggregation, scoped-match, dish type union) stay | New meals never `usda`. Historical rows stay | Rewrite old food_logs |
| **F-12.4** | **Shipped.** `fdcId` stripped from `CANONICAL_BASE_FOODS`; `getCachedUSDAFood` / `setCachedUSDAFood` / `LOCAL_USDA_CACHE` deleted. Lookup returns local `id` (map key) + nutrients only. | Local ghost-component table has numbers only. No HTTP | Delete the local staple table |

`docs/agent/domains/food-calc.md` rung 3 drops “USDA Atomics” — confirmed before→after with F-12.1. F-1/F-2 stay **Abandoned**.

### F-11 — Brand catalog self-clean (one librarian, off Analyze)

**Architecture:** [FOOD.md](./FOOD.md) **Part A.2**.  
**Trigger:** after F-12 or in parallel if no shared files. Human **go**.  
**Not:** food_items on Analyze, FDC lookup, a second resolver persona, blocking Save.

Today: curator LLM skipped on Analyze. Brand **match** in finalize. Brand **TS self-clean** (F-11.1) runs after ledgers, meal never waits. Curator LLM is **F-11.2**.

| ID | Item | Done when | Do not |
|---|---|---|---|
| **F-11.1** | **Shipped 2026-09-13** (`4a9f129`). TS cleaner unhooked from resolver; per chain+country throttle; soft quarantine; official > ocr > user; skip `usedRowId`. Live needs the `brand_menu_items.status` migration. | Named vitest: same-key clones collapse; unofficial quarantined; meal kcal unchanged | Gemini delete; global 1h throttle; hard delete |
| **F-11.2** | **Shipped 2026-09-16**. Curator LLM only when [FOOD.md](./FOOD.md) **A.2.1** passes. T2 Jaccard ≥ 0.85 + kcal ±10% + no meal/combo superset. TS rejects merge if kcal >15% or official loser. Unit test 11/11 green. | Next same spelling-variant HIT. Big Mac vs Big Mac Meal **not** merged. HIT/MISS/SKIPPED/OCR never call Gemini | Invent SKU; `chosenFdcId`; LLM every meal; write kcal onto this meal |
| **F-11.3** | **Shipped 2026-09-16**. One name: wire `curator` (`t1/curator`, `agent: 'curator'`). Dual-accept `food_resolver` / `resolver`. | Debug `t1/curator` or nothing — never both | Wire id `meal_agent` / `dietitian` (meal agent is `diet`) |

M30 assert retarget = confirmed before→after on `assert-food-curator-m30.mjs` + `food-calc.md` Database Curator (brand-only). Same change as F-11.2/11.3.

### F-13 — Case-12 T2: same-thread meal edit (add/remove)

**Packet:** `specs/active/F-13.md` (locked).  **Evidence:** `golden/meal/Meal_04_log/12_chat_saved_meal/correct_results.md` §4.  **Not:** `App.tsx` (frozen), `JobStore`, per-100g *tag* rescale (gap 1), `brand_menu_local_*` resolution (gap 3).

| ID | Item | Done when | Do not |
|---|---|---|---|
| **F-13.1** | **Shipped 2026-09-17.** `src/utils/foodFollowUpEdit.ts` — text-only follow-up on a blank draft + recent meal ⇒ `submissionMode = 'edit'`, so the existing `activeMeal` fallback (`LogChat.tsx:2498`) supplies the prior meal. 24/24 vitest. | Text-only follow-up reports `mode === 'edit'` with the prior meal's dishes carried | Adopt the newest meal unconditionally — T1 sends a photo and must stay a new scan |
| **F-13.2** | Lock-merge basis consistency in `server_dish_finalize.ts` residual fill. **Not started: no hard evidence** — the golden path succeeded with oats *estimated* (turn-2 capture has zero `per_100g`), so the recorded numbers are prose only. Do not guess math in the sole kcal writer. | A live T2 capture that actually exercises a `per_100g` brand lock at a non-100 g weight | Change `finalizeDishLedger` basis on prose alone |
| **F-13.3** | **DONE 2026-09-23 — live T2 GREEN.** Blank drafts adopt the newest NON-EMPTY succeeded session meal (`newestSucceededFoodJob` + `pendingMealOfJob` incl. persisted messages; `LogChat.tsx` only). Root causes killed: (1) completions only flip JobStore status, meal lives in messages; (2) stale demo seeds with empty breakdowns outranked T1. Live gate 2/2 incl. T2 (oats 40g, Big Mac 508 lock, no coconut, ledger math, persisted). Live spec now uses fresh-signup identity (fixed demo account accumulates seeds across runs). Temp diag breadcrumb removed. | Same-thread edit works on a pristine account; unit 32/32, tsc 0, guard PASS | Widen packet scope or touch `App.tsx`/`JobStore` for this |

---

## Track R — Reliability (core done; start only on trigger)

**Architecture:** `RELIABILITY.md`  
**Laws:** `docs/agent/domains/sync.md`  
**Core:** M23–M28 `assert-free-tier-complete.mjs` **PASS**. Do not re-migrate images or re-kill chat Firestore writes.

| ID | Still to do | Trigger |
|---|---|---|
| **R-1** | Re-measure Firestore writes / Supabase egress | Quota or bill spike |
| **R-2** | Cloudflare Pages for `dist/` only (no API) | Static latency actually hurts. **Go-live is R-13.** |
| **R-3** | Playwright leftover-English plus demo-empty smoke | After **S-1** string list is green; not instead of class goldens |
| **R-4** | Finish `server.ts` router split | Already touching the monolith (`server_routes_{jobs,biomarkers,food}.ts` exist; `server.ts` still huge) |
| **R-5** | D1 as primary SQL | **SUPERSEDED by Track D.** D1 is already the live SQL (Supabase 402). Do not “investigate D1” again. SQLite-on-VPS is **D-5**, not this row. |
| **R-6** | Job recovery soak | Interrupted jobs still orphan (unit test exists; not a soak) |
| **R-8** | **Shipped** | Numbers recorded in `AI_HANDOVER.md` (DOMContentLoaded 1,485ms → 343ms, FCP 1,644ms → 384ms, Load 2,223ms → 1,131ms). Baseline established. | Page feels slow |
| **R-9** | **Shipped** | Defer `startGoldenIngestWatcher` + `hydrateUserJobs` via `requestIdleCallback` (3500–4000ms timeout) + in-flight request deduplication. Zero startup duplicate fetches. | After R-8 baseline |
| **R-10** | Header code-split | `themeRegistry` audit, Drive backup, `FoodCatalogAdminTab`, quota checkers lazy; Header line count may not grow | After R-9 |
| **R-11** | `HomeTab` / `LogChat` stay out of other tabs’ first paint | Already lazy-tabbed; do not eagerly import them from Insights / History | Regression after R-10 |
| **R-12** | One-line stall/503 count (free-tier hang rate) | After F-8.13 JSON tree has `latency_ms` / error on dispatches. A number in `AI_HANDOVER.md`, **not** a metrics product. RELIABILITY.md §11.12 **H** | LangSmith; Grafana; inner-loop Gemini |
| **R-13** | VPS-2 go-live + AI Studio parity | Packet **locked**. R-13.0 agent preflight **PASS**. R-13.1 = Track V Phase 4, `blocked_human` until V-0. Not R-2. Not Cloud Run. |
| **R-14** | **Telegram shared-capability alignment** — one rail for bot-host skills + provider-router + Grok agents (photos, matrix, allowance, self-heal) **+ propagation flow across Hermes / VPS / Mobile / Grok TG / Collab** (§14.7 cases). Plan in [RELIABILITY.md](./RELIABILITY.md) **§14**. | Dual stacks / missing photo-view / matrix not visible to all agents; uneven skill fan-out; after R-13.1 live. Owner: thin PM + free CLI. |
| **R-14.1** | **Location, project, and role.** One poller. `/location` runs the next turn on a connected worker and spends that worker's allowance. `/project 1` is the website. `/project external <n>` is a separate folder that cannot commit or deploy the website. `/role` loads one instruction file. Execute [R14_1_AGENT_PLAN.md](./R14_1_AGENT_PLAN.md). Product shape: [LOCATION_AGNOSTIC_AGENTS.md](./LOCATION_AGNOSTIC_AGENTS.md). The council draft [LOCATION_AGNOSTIC_PROJECT_COUNCIL.md](./LOCATION_AGNOSTIC_PROJECT_COUNCIL.md) is not the spec. | **OPEN.** Registry asserts 55/55 do not close it. `/location mobile` only sets `BOT_LOCATION` on the VM. Live cards 1–9 are the bar. Drive waits until the user names the Google account. |

### R-13 sub-IDs (one at a time after lock)

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **R-13.0** | **Shipped 2026-09-17 (agent).** `scripts/r13-0-preflight.mjs`: D1+R2 exist, R2 CORS applied, Workers Paid not required, secrets stay in env, Dockerfile already `NODE_ENV=production`. Firebase exact-host allowlist is after 13.1 has a URL. | Preflight all PASS | `*.pages.dev` wildcard; `ALLOW_UNAUTH_SYNC=1`; commit `.env` |
| **R-13.1** | **COMPLETE & LIVE (2026-09-20).** Always-on Node on OVH VPS-2 (`node dist/server.cjs` + Caddy). V-0...V-16 complete, public HTTPS on DuckDNS (`health-tracking.duckdns.org`), GitHub webhook CI/CD active. | `npm run dev` still Vite on 3000; public host always-on (no Render splash); job submit → D1 + R2; Google login on exact host; Render in soak mode prior to V-17 | Import `server.ts` into Pages Functions; Cloud Run min-instances=0 as prod; Cloudflare Containers extra URL; skip `listen` on `CF_PAGES`; delete Render before soak PASS |
| **R-13.2** | Loopback SSE `: ping`; keep 180s abort; align stale-fail copy | Silent 180s behind orange-cloud does not 524; `server_sse_json.test.ts` green | Raise Worker CPU to “make 3 min work” on V8 |
| **R-13.3** | `server_auth.ts` localhost-only skip; popup/redirect fallback; preview policy | Spoofed `uid` rejected in prod; Google + email verify + Drive backup on prod host | `NODE_ENV !== 'production'` as a localhost synonym |
| **R-13.4** | Native `env.DB` / `env.BUCKET`; in-process analyze; durable jobs | Worker can analyze without `127.0.0.1` and without `sharp` | Start this to unstick 13.1; D1-as-primary (that is **Track D**, already live) |
| **R-13.5** | Workers Logs; 1102/1027/524 alerts; static excluded from compute | Static `/assets/*` not billed as Functions | Pages Functions as the log host |

### Track V — mobile → VPS-2 → live site (V-0…V-16 COMPLETE & LIVE)

Canonical plan: [VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md). Live host: `https://health-tracking.duckdns.org`.

| ID | Phase | Done when | Status |
|---|---|---|---|
| **V-0** | Buy OVH VPS-2 monthly, Ubuntu 24.04, region human-pick | SSH key login from Mac | **COMPLETE** (Lille, France `51.254.217.163`) |
| **V-1** | Tailscale + ufw; no public :22 | Phone and Mac see the VM on the tailnet | **COMPLETE** (`100.118.148.32`) |
| **V-2** | Node 20, git, tmux, Caddy installed | `node -v` is 20.x | **COMPLETE** (Node v20.18.0) |
| **V-3** | Clone repo, `npm ci` on the VM | `npx tsc --noEmit` exits 0 | **COMPLETE** (`~/src/Health-tracker`) |
| **V-4** | First phone SSH → tmux | Phone attach, `hostname` in the repo | **COMPLETE** (Termius on Android) |
| **V-5** | Live watch (tmux; optional Hermes web on Tailscale) | Watch a process 2 min from the phone | **COMPLETE** (`tmux attach -t dev`) |
| **V-6** | Slim Hermes + Telegram on the VM | Phone Telegram → VM → reply | **COMPLETE** (`@Health-tracker-bot`) |
| **V-7** | Primary instruct=Telegram, watch=tmux; fill Runbook | Runbook has real hostnames | **COMPLETE** (Runbook filled) |
| **V-8** | Grok CLI + `grok login --device-auth` | `grok -p` pong | **COMPLETE** (`~/.grok/bin/grok`) |
| **V-9** | Grok builds on the VM; branch/PR on GitHub | Commit authored on the VM | **COMPLETE** |
| **V-10** | Agy, one task, then stop | Agy not left idle | **COMPLETE** (EU datacenter geoblock noted) |
| **V-11** | OpenCode, one task, then stop | OpenCode not public | **COMPLETE** (`~/.opencode/bin/opencode`) |
| **V-12** | One-CLI house rules; 4 GB swap; watchdog cron | htop under ~6 GB during Grok | **COMPLETE** (`/swapfile` + watchdog) |
| **V-13** | Staging site on Tailscale (Caddy + systemd) | `/api/status` 200 on MagicDNS | **COMPLETE** (`health-tracker.service`) |
| **V-14** | Staging meal + Google login on exact host | One real meal on staging | **COMPLETE** (Full D1/Supabase/R2 sync) |
| **V-15** | Public hostname, Firebase + R2 CORS, deploy loop | `/api/status` 200 off Tailscale | **COMPLETE** (`https://health-tracking.duckdns.org` + Webhook) |
| **V-16** | DNS cutover; Render still up | Cellular load, no Render splash, meal works | **COMPLETE & LIVE** |
| **V-17** | Delete Render; scrub `onrender.com` | Old origin dead | **IN PROGRESS** (24-48h soak before deletion) |
| **V-18** | Confirm Containers/Cloud Run stay off | Runbook matches prod | **PENDING** |

### Track V Phase 6 — Autonomous Journey QA Fleet & Orchestrator Self-Healing Loop

Target architecture: QA bot fleet (`@Meal-journey-QA`, `qa_bio`, `qa_onboarding`) tests live site, detects visual/functional defects, passes tickets to Orchestrator (`@Orchestrator`), which evaluates tool allowances (OpenCode -> Cline -> Grok -> Agy) and dispatches autonomous fixers, auto-deploys via webhook, and signals QA to re-verify with clean screenshots.

| ID | Phase / Gap | Done when | Status |
|---|---|---|---|
| **V-19** | **Screenshot Forwarding (Gap 1 - Critical)**: Pass `--screenshot=${bugData.screenshot}` in `qa-auto-loop.mjs` dispatch call. | Coding agents receive full path to visual screenshot in prompt; prompt instructs inspecting visual defect. | **COMPLETE** |
| **V-20** | **Manual Bug Report Re-Test Loop (Gap 2 - Critical)**: Trigger automated QA re-verification after Workflow B (user-submitted screenshot/bug) completes dispatch and CI/CD deploy. | User reporting a UI bug in Telegram automatically gets verification screenshot once coding agent commits and webhook deploys. | **COMPLETE** |
| **V-21** | **Profile-Aware Telegram Routing (Gap 3 - Critical)**: `telegram-send.sh` accepts `--profile=<name>` to load token and allowed chat ID from matching `~/.hermes/profiles/<name>/.env`. | Bot messages and screenshots never cross-post to wrong bot profile or thread. | **COMPLETE** |
| **V-22** | **Autonomous Escalation Retry Loop (Gap 4 - Important)**: Wrap `qa-auto-loop.mjs` in multi-tier retry (`MAX_RETRIES=2`). First attempt OpenCode; if re-test fails, escalate to Cline with `--thinking=high` and new error diff. | Single failed re-test does not immediately abort to human if secondary high-thinking tier can resolve. | **COMPLETE** |
| **V-23** | **Heartbeat Process Lifecycle (Gap 5 - Reliability)**: Add `trap stop_heartbeat EXIT INT TERM` in `run-coding-dispatch.sh`. | Background Telegram ping process never leaves orphaned subshells on timeouts or script exits. | **COMPLETE** |
| **V-24** | **Dispatch Concurrency Lock (Gap 6 - Reliability)**: Write lockfile `~/.hermes/dispatch_lock` with active `BUG_ID`. | Multiple concurrent QA runs or rapid user reports do not trigger conflicting simultaneous git working-tree mutations. | **COMPLETE** |
| **V-25** | **Global DuckDNS Test Origin (Gap 7 - Config)**: Seed `PLAYWRIGHT_TEST_BASE_URL=https://health-tracking.duckdns.org` in `~/.hermes/.env` globally. | All scripts and bot profiles run headless tests against live production without localhost fallback. | **COMPLETE** |
| **V-26** | **Orchestrator Post-Deploy Re-Verify (Gap 8 - Orchestrator UX)**: When direct `/fix` or dispatch is triggered from Orchestrator bot, dispatch automatically invokes `qa-runner.mjs` after 45s deploy sleep and reports result. | Orchestrator verifies its own commits end-to-end rather than requiring manual QA invocation. | **COMPLETE** |

### Track V Phase 7 — Phone terminal survives a network change (OPEN)

Canonical steps, measured facts, and the do-not list: [VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md) Phase 7. This is the next mobile ID. It does not change the website, Hermes tokens, or `src/`.

| ID | Phase | Done when | Status |
|---|---|---|---|
| **V-27** | Key-only SSH, then public :22 + Mosh UDP, fail2ban, tmux session `health` recreated on boot. Termius uses Mosh to `health-tracking.duckdns.org`, startup `tmux new -A -s health`. Tailscale stays; Tailscale SSH turns off only after an off-tailnet key login works. | Password SSH rejected. Phone switches Wi-Fi ↔ cellular and is back in the same `health` pane within a few seconds, process still running. No Tailscale cache clear. | **DONE 2026-09-24** (human phone check passed). |

### Track V Phase 8 — One job per bot, silent dev agents (OPEN)

Canonical steps: [BOT_ROLES.md](./BOT_ROLES.md). Does not change `src/` or the phone path. Do not redo V-19…V-26. Do not execute V-27 in the same turn.

| ID | Phase | Done when | Status |
|---|---|---|---|
| **V-28** | Short soul per Hermes profile. One preloaded skill per live bot. QA profiles cannot load `orchestrator-dispatcher`. Memory holds only current facts. Dispatch tries `opencode/deepseek-v4.1-flash` once after Muse reports insufficient funds, and skips Antigravity. | The done-when list in BOT_ROLES.md §4 is true. | **COMPLETE** |
| **V-29** | **Atomic QA Bug Dispatch & Orchestrator Observability**: QA bots dispatch one verifiable defect per ticket (never bundle multiple discrepancies). Orchestrator decomposes multi-issue prompts into atomic sub-tasks, attaches target file hints, provides action-aware heartbeats (reporting current investigation activity rather than blind timers), emits structured failure diagnostics, enforces 3m early stagnation circuit breaker, and tunes coder thinking levels. | [BOT_ROLES.md](./BOT_ROLES.md) §6 is implemented; single-defect tickets run in < 60s without overthinking loops, blind heartbeats, or poisoned bundles. | **COMPLETE** |

### Track V Phase 9 — Colab Bot (CB-1–CB-5 done; CB-6–CB-8 do not resume)

Canonical history: [COLLAB_BOT_MOBILE_WORKFLOW.md](./COLLAB_BOT_MOBILE_WORKFLOW.md). CB-1–CB-5 stay done. Do not resume this phase to add a GPU model or a second Telegram poller. A Collab worker for R-14.1 connects outward to the VM.

| ID | Phase | Done when | Status |
|---|---|---|---|
| **CB-1** | Colab Bot identity in `bots/registry.json`, systemd service unit `collab-bot.service`, Termux launcher `start-collab-bot.sh`. | `node scripts/collab-bot.mjs --check-config` passes. | **COMPLETE** |
| **CB-2** | Model switching (`/switch muse-spark-1.3`, `/switch qwen-3.8`, `/switch status`) inside Colab via `scripts/lib/collab-session.mjs`. | Dynamic switcher simulation passes. | **COMPLETE** |
| **CB-3** | Headless Colab compute worker notebook `notebooks/colab_qwen38_vllm.ipynb` with 20m auto-unassign idle watchdog. | Notebook auto-unassigns on idle to preserve 200 compute units. | **COMPLETE & LIVE-VERIFIED** (unassigned at 01:18 to protect 200 units) |
| **CB-4** | Automated verification pipeline: `scripts/run-playwright-headless.sh` running `tsc` + Playwright before git push. | Playwright runner script executable and tested. | **COMPLETE** |
| **CB-5** | Conversational AI Coding Agent Upgrade: `notebooks/colab_worker.py` upgraded to full autonomous OpenCode agent (natural conversation + task execution + on-screen `getpass` token input fallback + 2-line auto-updating launcher in `colab_qwen38_vllm.ipynb`). | Pulls latest GitHub code on every run; responds to conversation and fixes. | **COMPLETE** |
| **CB-6** | Live loop that git-pushes the coder's commit to `origin/main`. | Live verification from a phone. | **SUPERSEDED 2026-09-25.** Do not start. A push to `origin/main` is forbidden. Collab for R-14.1 is an outbound worker session to the VM. It does not poll Telegram and it does not auto-push. |
| **CB-7** | Local Qwen 3.8 GPU inference inside the notebook. | Qwen generates code on the GPU. | **NOT NEXT.** Do not start ahead of R-14.1. |
| **CB-8** | OpenCode session memory inside the Colab poller. | The notebook remembers prior turns. | **NOT NEXT.** Sessions do not roam. R-14.1 carries a pack, not this row. |

### Track V Phase 10 — Bug ticket pipeline for TG agentic development (V-30.1 DONE · V-30.2 DONE 2026-09-24 · V-30.3 DONE 2026-09-24 · V-30.4 DONE 2026-09-24 · V-30.5 DONE 2026-09-25)

**Plan:** [BUG_TICKET_PIPELINE.md](./BUG_TICKET_PIPELINE.md) — the full audit of both existing bug pipelines (the `issue_tags` queue and the TG QA/dispatch lane), the design, the rollout, and sources.
**Status:** **V-30.1 DONE 2026-09-24** (store + CLI + A-f1/A-f5; gates green). **V-30.2 DONE 2026-09-24** — P9 token present, live E2E session `20260924_162828_f191298f` (packed card #2, TG message ids 8/12/14/16), registry `enabled: true` + `username: "@Bug_ticket_bot"`, §6.2 audit follow-up resolved (committed fixture `scripts/fixtures/bug-8449.json` traceable to `bug-backlog.md` + documented/tested packer-only boundary; gate 44/0). **V-30.3 DONE 2026-09-24** — `qa-reproduce` skill, `qa-runner --ticket`, `bugctl repro --check`, §4.6 R2 keys, gate `assert-bug-repro` 57/0; **live verdict posted on card #2**: `repro.status=failed` (exit 1 — defect absent; fixed by `00b8cb1` rounding of `1.1g*7`), derived flag `not_reproducible`, R2 keys `bugs/tag_mufs4t96_wj02x7/1790272128947-*`, `by: qa_meal`; `svc-repro` → `done`. The `confirmed` (known-bad) path is gate-proven and awaits the next genuinely-reproducing card. **V-30.4 DONE 2026-09-24** (row below). **V-30.5 DONE 2026-09-25** — human go received: `scripts/bug-backlog.mjs` (generated backlog; hand-compiled file preserved verbatim as `bug-backlog.legacy.md`; `--check` 6/0), `/resume` on the bot command surface (commands + bot-host handler + tests), capability rows closed from proof (`svc-bug-ticket`, `sess-ticket-resume`) with a **ticket-scoped** `--strict` (`--ids=…`), CI gates (ticket-state / pack-fixture / continuity / capability / retro-audit / dispatch self-commit sensor), `docs/agent/BUG_PIPELINE.md` + `telegram_work.md` §0 ticket-first handoff, retro-audit **6/6 answers from disk** on re-opened card #7 (transcript recorded in BUG_PIPELINE.md; verify left to a non-author), and the `review-failures` fixture signature (`dispatch:unresolved`, hint=#5) sensorized by `tests/dispatch-selfcommit.test.ts` with **zero recurrence since #130**.
**Shape (after V-28/V-29):** **one** new bot — Hermes profile `bug_ticket` (the packer/triager); the **existing** QA profiles are reused for reproduce (no new QA agent, skill + state only); the orchestrator plans, dispatches and verifies through `bugctl`. The `issue_tags` store is the single source of truth — no second tracker.

| ID | Phase | Done when | Status |
|---|---|---|---|
| **V-30.0** | **Decisions P1–P10** — recorded in the **decision sheet (§6.1)** of [BUG_TICKET_PIPELINE.md](./BUG_TICKET_PIPELINE.md). | All P1–P10 rows have a chosen option (§8 mirrors them). | **DECIDED 2026-09-24** |
| **V-30.1** | Store + CLI: new `work_item` fields (`defect`, `repro`, `plan`, `verify`, `surface`, `assignee`, `idem_key`, `reply_to`, `blocked_by`, `duplicate_of`); the `bugState()` projection in `src/utils/bugTicketState.ts` (extends `mapLegacyStatus`, no data migration); artifact endpoints `POST /api/bugs/:id/{defect,repro,plan,verify}` with **no agent-settable state route**; `scripts/bugctl.mjs` (offline JSONL queue); fixes for A-f1 (`/api/bugs/next` pre-slices `LIMIT 100` on `created_at` before severity/occurrence ordering) and A-f5 (write endpoints unauthenticated). | `npx vitest run src/utils/bugTicketState.test.ts` · `node scripts/assert-bug-ticket-continuity.mjs` · `npm run lint` all exit 0, and a scripted session creates → packs → attempts → closes a card through `bugctl` alone, with every state change provably derived from the posted artifact. | **DONE 2026-09-24** — gates green (vitest 25, continuity 33, lint 0); scripted session `new→packed→in_fix→done` via bugctl only |
| **V-30.2** | Packer code merged: `bug-pack.mjs`, `bugctl pack --check`/`--split`, Hermes profile/skill, registry entry, capability rows. **Closed 2026-09-24:** traceable fixture `scripts/fixtures/bug-8449.json` (re-checked row-by-row against `bug-backlog.md` at gate time, driven through the CLI intake path), packer-only boundary documented + asserted, P9 token, `@Bug_ticket_bot` handle, one live E2E reply, `enabled: true`. | Fixtures: (a) BUG-8449's 7-item report → **1 card + a split list**, never a bundle (helper **and** `bugctl pack --split`/`--check`); (b) vague → `needs_repro`; (c) duplicate → merged; plus live E2E before enabling. | **DONE 2026-09-24** — `assert-bug-pack` 44/0; E2E session `20260924_162828_f191298f` card #2 in `AI_HANDOVER.md`; see pipeline §6.2 |
| **V-30.3** | Reproducer on existing QA profiles: `qa-reproduce` skill (preloaded into `qa_meal`), `qa-runner.mjs --ticket=<#n>` (packet → run → §4.6 R2 keys → verdict), `bugctl repro --check`, no new QA bot/token. Reference transcript: stuck meal-analysis card — QA posts `confirmed` + command/exit/`run.log`/`before.png`, never "looks fine in code". | Known-good posts `repro.status=failed` + `run.log` → derived `not_reproducible`; known-bad posts `confirmed` + command/exit/log/`before.png`; both verdicts persist; named gate `assert-bug-repro`. | **DONE 2026-09-24** — gate 57/0 (vocab parity, wiring, §4.6 keys, skill preload, derived-flag vitest walk) + **live verdict on card #2**: `failed` → `not_reproducible`, R2 keys `bugs/tag_mufs4t96_wj02x7/1790272128947-*` (card #2 was already fixed by `00b8cb1` — known-good path live; `confirmed` path gate-proven, awaits a genuinely-bad card); `svc-repro` done; do not confuse `not_needed` with `not_reproducible` |
| **V-30.4** | Orchestrator: packet-driven `run-coding-dispatch.sh --ticket=#n`, plan block, start/end attempt rows, `blocked_reason`, idempotent in-flight guard, verifier separation. Specify role writes `specs/active/<card>.md` from `specs/TEMPLATE.md` (Understanding + Layer + Forbidden patch + two fixtures) — strong model, with packet + repro on the card; you lock (`go`). Reference transcript: `STALE_TURN-card22` spec — Understanding kills wrong-thing fixes, Layer + Forbidden patch make patchy illegal, two fixtures (terminal + saved-meal) prove structure. Packet parity: `buildNow()/buildContinueJob()` still return the legacy payload — extend them or make every consumer call `bugctl packet`, never ship a dispatcher that silently drops `defect/repro/plan/verify`. | Scratch dev-only card reaches `done` only after named gate green; failed dispatch leaves `blocked_reason`; no direct main push/chat-only claim. | **DONE 2026-09-24 — code + live VPS proof.** Code: `--ticket=#n` + `scripts/lib/bug-dispatch.mjs` guard (exit 3 on `in_fix`/blocked/not-repro/duplicate) + plan-before-detach + attempt `start`/`committed(applied)`/`failed` rows + `bugctl block --reason` on all failure paths + prompt carries packet/repro/plan/locked-spec/verification contract; packet-parity **option B**; bugctl reads never queue (`WRITE_OPS`); `orchestrator-dispatcher` v2.1.0 Step 0/5 + `specs/TEMPLATE.md` anti-patch sections; fixture `src/utils/bugDispatchFlow.test.ts` + gate `assert-bug-dispatch` 49/0. **Live:** card #3 `new→packed→in_fix→verifying→done` (plan row + attempts in `specs/bug-journal/3.jsonl`, PR #101, exit-3 double-dispatch refusal, named_test verify by non-author, gate 50/0 on VPS); card #4 failure → `blocked_reason` + guard refusal; offline write queued during API restart → `flush` replayed; proof-found fixes **#98** (stop/heartbeat zombie) + **#102/#103** (journal drops). Ops: zen funds depleted and `opencode-go` is paid → dispatch defaults to free models (`nemotron-3.5-lightning-free`, fallback `space-bunny-free`), never paid `--model=` overrides. |
| **V-30.5** | Memory + ratchet: generated `bug-backlog.mjs`, `/resume`, add `svc-repro` without duplicating existing rows, status transitions from proof, CI gates, `docs/agent/BUG_PIPELINE.md`, `telegram_work.md`, and BUG-8449 retro-audit. | `review-failures` has no repeated fixture signature (post-#130 window clean + sensorized); capability `--strict` exits 0 **ticket-scoped** (§6.2 sanction — the 5 foreign partials stay owned by BOT-11, never marked done); continuity/pack/ticket-state gates run in CI; retro-audit answers §4.10 questions 1–6 from disk/API only. | **DONE 2026-09-25** — human go received; gates: backlog `--check` 6/0, retro-audit 12/0 (6/6 answers from disk, card #7), capability full + scoped-strict 0, continuity 41/0, pack 44/0 (CI-safe fixture HOME), bugTicketState 40/40, self-commit sensor 4/4 (fails on revert, in CI); `svc-bug-ticket` + `sess-ticket-resume` → `done` from proof; fixture signature `dispatch:unresolved` fixed by #130 + sensorized, zero rows since; global `--strict` remains red on exactly the 5 BOT-11 rows by design |

**V-30.0 decisions (all made 2026-09-24) — recorded in the decision sheet (§6.1) of [BUG_TICKET_PIPELINE.md](./BUG_TICKET_PIPELINE.md) (this table is the mirror):**

| # | Decision area | Options | Decision (2026-09-24) | Blocks |
|---|---|---|---|---|
| **P1** | Store / transport | A: D1 `issue_tags` only (bots via `bugctl`) · B: git ticket files own the state · C: D1 writer + git as the bus · D: A + a git-committed journal | A + D | V-30.1 |
| **P2** | **State vocabulary** | S-C derived, full 11 names (precedence list in §4.3.4) · S-C-lite, 5 names + flags (`new/packed/in_fix/verifying/done` + `needs_repro`/`not_reproducible`/`blocked_reason`/`duplicate_of`, §4.3.5) · S-C-lite without `not_reproducible` (folded into `blocked_reason`) | S-C-lite (keeps `not_reproducible`) | V-30.1 |
| **P3** | Write-endpoint auth | shared `BUG_API_TOKEN` header on `POST/PATCH /api/bugs/*` · VPS-local writes only | token header (required by A and C; fixes A-f5) | V-30.1 |
| **P4** | Track numbering | V-30.x (Track V Phase 10, this section) · a BOT-xx range in the bot table | V-30.x — the BOT-xx range is in **active use** by the Hermes-parity program (BOT-12…18 as of 2026-09-24, growing: `17873f2`, `fbe0405`, `fdbf05d`, `971a4cf`), so it must be re-checked at claim time; V-30.x is free and stable | docs only |
| **P5** | Owner of `not_reproducible` | packer decides close vs `blocked_reason=needs_info` · orchestrator triages it | packer (orchestrator must not re-open the free-text hop) | V-30.2 |
| **P6** | Repro depth | command + `run.log` + screenshot per card · a committed Playwright test per ticket | shallow now; Promote path later | V-30.3 |
| **P7** | QA profile wake policy | wake `qa_biomarker` / `qa_onboarding` on the first Health/profile repro (token + memory init + right skills) · `qa_meal` covers all surfaces for now | on demand — keep them asleep until needed | V-30.3 |
| **P8** | Backlog artifact | generated `bug-backlog.md` (keeps the human habit) · `bugctl list` + `docs/agent/BUG_QUEUE.md` | generated | V-30.5 |
| **P9** | Human: create the packer token | BotFather → `HERMES_BUG_TICKET_TOKEN` → master `tokens.env` → `sync-bot-tokens.mjs` | approved human step inside V-30.2, required before the E2E proof | V-30.2 |
| **P10** | Channel model | one ticket room with per-surface topics · per-agent chats with `reply_to` routing | ticket room | V-30.2 / V-30.4 |

**Human-go gate:** V-30.4…V-30.5 each received their explicit human go and are **DONE** (V-30.4 2026-09-24, V-30.5 2026-09-25). V-30.2 closed 2026-09-24 with
`hermes_bug_ticket` **enabled: true**, `@Bug_ticket_bot`, and the E2E session recorded in
`AI_HANDOVER.md`. V-30.3 closed 2026-09-24: gate `assert-bug-repro` 57/0 plus the live verdict
on card #2 (`failed` → `not_reproducible`, R2 evidence keys), so `svc-repro` is `done`.
V-30.5's strict check is **ticket-scoped by design**: the global `--strict` still shows five
unrelated `partial` rows (owned by BOT-11) — do not mark them `done` or weaken the checker;
CI runs `--strict --ids=svc-bug-ticket,proc-ticket-state,sess-ticket-resume,svc-repro`.






### Track D — one database (D1 now; SQLite only after a VPS benchmark)

Canonical plan: [DATA_PLANE.md](./DATA_PLANE.md). **R-5 is superseded** (D1 is already primary; live Supabase is HTTP 402). Do not mix with F-13 or Track V Phase 4. Do **not** treat SQLite as the next execute ID.

| ID | Phase | Status | Done when |
|---|---|---|---|
| **D-0** | Record SoT: Firebase Auth + D1 + R2; index Muse audit | **This plan** | Agents follow DATA_PLANE.md, not “stay on Supabase” |
| **D-1** | Unpaid recovery when 402 lifts (~**2026-09-24**): dump + diff vs D1; insert missing only | **DONE 2026-09-25** — 402 lifted (HTTP 200); 197 missing rows backfilled (food_logs +172, biomarker_logs +13, profiles +5, agent_jobs +7, food_items +422); 31 food_items = by-design `canonical_*` key skips (Supabase rows carry the `[object Object]` nutrients corruption); dumps at `backlogs/supabase-recovery-2026-09-25/`; dated log in DATA_PLANE.md; sensor `scripts/d1-supabase-recovery.test.mjs` 8/8 | Dated recovery log in DATA_PLANE.md (0 gaps is OK). **No extra bill.** |
| **D-2** | Drain dead Supabase **code**; keep the remote project until D-1 | **DONE 2026-09-24** (`specs/done/d-2-supabase-code-drain.md`) — all ledger rows DONE; verified clean-tree `tsc` 0, 60/60 packet vitest, `journey-guard D-2` PASS; residual `golden_cases` has no D1 table (skipped by design) | D1 is the only production SQL path; project still exists |
| **D-3** | Workers Paid ~$5 before ~100 users | `blocked_human` | Free D1 daily cap cannot hard-stop the app |
| **D-4** | Named D1 timing script; record wall vs SQL ms | Mac **2026-09-20** done; VPS pending | Dated Mac + VPS-dev + VPS-prod rows in DATA_PLANE.md |
| **D-5** | **SQLite vs D1 benchmark on the VPS** (read-only copy, not a writer) | `blocked_human` until **V-16** | Table: D1 p50/p90 vs SQLite p50/p90 from that region |
| **D-6** | Human: keep D1 **or** cut over | `blocked_human` until D-5 | Decision box filled in DATA_PLANE.md |
| **D-7** | SQLite WAL + Litestream → R2; freeze D1 | **Not scheduled** (only if D-6 = cut over) | One SQL writer on disk; restore drill PASS |
| **D-8** | Keep D1; delete any SQLite adapter | **Not scheduled** (only if D-6 = keep D1) | No `better-sqlite3` in prod |
| **D-9** | Stop R2 photo **regrowth** (hash reuse; no `_0` twin). Muse audit. No deletes. | **DONE** (`cf19075`) | New uploads do not mint duplicate keys |
| **D-10** | After D-1: apply [R2_DELETE_CANDIDATES.json](./R2_DELETE_CANDIDATES.json), sweeper, debug/logs retention | gate satisfied — **D-1 DONE 2026-09-25**; still `blocked_human` until an explicit human go | Audit re-run; no keys still referenced |

**D-5 / D-6 decision rule:** user-visible sync extra wait **≤ ~100 ms p50** from the VPS → keep D1. **Consistently 500 ms–1 s** on sync/open-app → SQLite is in play. Meal analyze (~8 s Gemini) is not the yardstick. Do not dual-write. Do not keep D1 as a live spare.

R-7 knip / `getBiomarkerStatus` memo as a reliability gate is **abandoned**.  
R-8–R-11 are **client speed**, not a free-tier redo. Do not re-migrate images or re-kill Firestore writes.  
`App.tsx` extract (`useSyncOrchestrator`) stays **parked inside R-4** — only if a later pack already touches that file. God-file splits need a **locked packet** (Q-9 is the pattern). Do not split `App.tsx` / `LogChat.tsx` / `Header.tsx` without one.

---

## Track Q — Quality loop (remaining method work)

**Architecture:** `QUALITY.md`  
**Area PASS/FAIL board:** [`golden/scorecard/instruction/MASTER_SCORECARD.md`](../golden/scorecard/instruction/MASTER_SCORECARD.md) (Localization / Meal Log / Compare / Biomarkers / Receptionist / Reliability). Process: `golden/scorecard/instruction/README.md`. Refresh with `npm run scorecard:debug`, never `npm test`.

Rules unchanged: work item = class · inner = vitest · outer = one example · honest residual · firewall.

**Landed — do not redo:** Q-1 (`assert-budgets.mjs` PASS) · Q-2 (`CATALOG.json` primitives) · Q-3 (`AppModal` + `FilterPills` + tests; Audit uses FilterPills) · QUALITY.md header already “Waves 0–7” · `scripts/golden-from-medical-debug.mjs` exists.

| Still to do | Done when |
|---|---|
| **Q-4** `AgentResultTable` thin | **Shipped.** Packet retired to `specs/done/q-4-agent-result-table.SUPERSEDED.md` (+ q-4a…q-4d splits). Extract-only. |
| **Q-8** Process goldens | **Shipped 8.1–8.6.** |
| **Q-9** Website consolidation | **Shipped 2026-09-16** extract-only (`specs/done/q-9-website-consolidation.md`). Do not rewrite. |
| **Q-10** Dependency consolidation | **Shipped.** Packet retired to `specs/done/q-10-dependency-audit.md`. Hygiene only. **Not** R-7 knip. |

**Landed — recently completed:**
- Make G-B2/5/6/7/9 execute the helper they name
- Inbox by class (Biomarkers tab lists examples grouped by class)
- **Q-5** Delete one-shot patch scripts
- **Q-6** Unified bug queue
- **Q-7** Test + golden hygiene

**Q-8 execute order** (do not skip the audit):

| ID | Do | Done when | Do not |
|---|---|---|---|
| **Q-8.1** | **Shipped.** Food process **audit**: walk QUALITY.md §1.3.1 exits. Dummy row per exit (including ones this dump did not take). Debug follows RELIABILITY.md **§11** + **§11.12** (JSON tree, dialog inventory, correlation id, dispatch signals, handoff record) | Checklist lists every §1.3.1 row + 11.12 A–F; dummy fixture or named residual; Contract emitted from JSON | Live Gemini; one dump = whole suite; screenshot as scorer; Phoenix/LangSmith |
| **Q-8.2** | **Shipped.** Make Soto classes green on dummy data: `QUEUE_LIE`, `DEGRADE_NOT_TERMINAL`, `DISPLAY_LAG`, `COMPLETE_ONCE`, `STALL_NO_FALLBACK`, `STALE_TURN`. Rewrite tests that encoded the bug (stall ⇒ failed) | Named vitest green; historical dumps still classify red via `test-from-debug` | G8 photos; `POST /loop` |
| **Q-8.3** | **Shipped.** `prototype/tests/dialog-inventory.spec.ts` stubs `/api/jobs/*` | Card ≠ Attempt/Retry when stub succeeded with kcal | Live Log Meal; mix with R-3 |
| **Q-8.4** | **Shipped.** `tests/bioProcess.golden.test.ts` | Dummy medical SSE + Apply + table abort + DIAG5-off-lab | Paint G-B1 all_green |
| **Q-8.5** | **Shipped.** `tests/deskProcess.golden.test.ts` | Dummy UC-02 handoff + dropped keys + FD not a meal analyzer | 10 live UC click-through |
| **Q-8.6** | **Shipped 2026-09-16.** Live soak executed per `scripts/soak-q8-tier3.md` (`job_1789535793972`). Inner loop 74/74 passed; 0 stalls / 0 503s. Dumps saved to `golden/scorecard/current/debug/`. | One website **or** API live after 8.2/8.4/8.5. If dump class already a row, inner failed. Grok not in the wait loop | API **and** website for the same meal; Grok bot 3-case loop |

Session replay: **abandoned** (Q-8 is dummy SSE/status, not replaying a browser session).  
Golden-execution Q work is usually **inside** B2/B4/B6 or F-3.  
File-collision rule: B0 and R-9 both touch `App.tsx` → serialize those two only. F-9.5 also touches `App.tsx` — serialize with B0/R-9. **Q-9** serializes with those too. **Q-8.3** must not collide with R-3 (different specs).

### Platform program order (not a fifth pillar)

Same reward change as class-first goldens (`QUALITY.md` §0): green means the **class** is closed, not “the page still works.”

```text
Q-1 + Q-2 + Q-3              ← landed
F-10.1–10.7                  ← shipped
F-9.5 App poller             ← shipped (Grok)
F-10.6 fat/Na TS             ← shipped (Grok)
F-8.13 debug contract        ← shipped
Q-8.1 → 8.5                  ← shipped (Grok)
F-8.10 shards                ← shipped
F-12.1–12.4 USDA gone        ← shipped (local staple table remains, no FDC ids)
F-11.1 brand TS self-clean   ← shipped (live: status migration)
B8.1 convertViaTable only    ← shipped
B0 / fill-template C1–C7     ← shipped
Q-8.6 / F-10.8 outer         ← shipped (2026-09-16 job_1789535793972, 74/74 pass, 0 stalls)
F-11.2 / F-11.3 curator LLM  ← shipped (2026-09-16 brandCurator + t1/curator wire)
Q-9 website consolidation    ← shipped (extract-only)
Q-4 AgentResultTable thin    ← shipped
Q-10 dependency audit        ← shipped
Q-11 App shell decoupling     ← DONE — 11.7/11.10/11.11/11.12 landed (App 350, Header 690)
R-13.1 / Track V             ← LIVE on OVH VPS-2 since 2026-09-20 ([VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md)); Worker health-tracker-2 is a no-build edge proxy; Render soak-pending-delete
Track D (one SQL)            ← PARKED; live = D1 ([DATA_PLANE.md](./DATA_PLANE.md)); R-5 superseded; SQLite = D-5 benchmark after V-16, not a cutover
Cloud Run Option A           ← SUPERSEDED (plan/GCP_FREE_TIER_MIGRATION.md)
```

**Q-11 milestone ladder** (one milestone per commit; move-only; `src/types.ts` frozen;
parity guard green; ratchet `CATALOG.json` when a file shrinks). Measured `main` @ `4acc632`:

```text
q-11-1-pures             appProfileUtils.ts                         DONE
q-11-2-auth-session      useAuthSession.ts (real sign-out)          DONE 818808f
q-11-3a/b/c              useJobRuntime.ts                           DONE acb278e
q-11-4-profile-hook      useAppProfile.ts (loadUserData)            DONE ce20b19
q-11-8-i18n-split        translations/{en,id,fr,zh}.ts             DONE 23ddc83
q-11-restore-auth-profile  real sync + AppShell/Tabs/Modals         DONE 4acc632
                         App.tsx 9,101/373KB → 3,114/135KB
                         (11.5–11.6+11.9-partial; no stubs)
q-11-7-header-profile    Header → ProfileModal                      DONE 31aece2 (residual → 11.12)
q-11-10-app-handlers     use{FoodLog,Biomarker,Report}Actions       DONE e2ab233  App.tsx → 1,098
q-11-11-wiring-ratchet   App.tsx wiring only                        DONE App.tsx → 350 / 14,416 B
q-11-12-header-residual  useThemeCustomizer + 2 screen files        DONE  Header 3,545/208KB → 690/28.8KB
                         node 2 cdbf2cd  DbInteractionsOverlay.tsx (746 lines moved byte-identical)
                         node 1 c92ec49 + 2fb8d88  ThemeCustomizerScreen.tsx 1,616 / useThemeCustomizer.ts 680
q-13-biomarker-dict      panels + DictionaryItem out of dictionary   DONE  BiomarkerDictionaryModal 6,230/345KB → 3,725/180KB
                         145d8e2 DictionaryConsolidationPanel 450f7c4 DictionaryDataAccuracyPanel
                         ad84598 DictionaryAgentPanel      fafc060 DictionaryItem + biomarkerAutoCalibrate
```

Burned: `a14abea` and `7d94def` rewrote instead of moving (deleted AuthScreen, stubbed
sync). Do not retry. `specs/done/q-11-5`…`q-11-9` were marked done without landing —
do not execute those files; use the OPEN ids above.

Always run `node scripts/journey-guard.mjs <id>` (F-13 + R-13 make a bare
`journey-guard` `spec_ambiguous` — pre-existing; pass the id). Do not chain two OPEN
milestones in one working tree.

Do **not** open a Dictionary/FoodCard/`LogChat.tsx` breakup without a **new** locked
packet. Q-9/Q-8.2 are green.

### Who does which

| | **Any agent** (Studio / Antigravity / OpenCode / Cline) | **Grok** (quota-scarce) |
|---|---|---|
| Prefer | Current work: **Q-11 and Q-13 are complete** — the remaining >200 KB file is `LogChat.tsx`, which needs its own packet once the other agent's edits land. Otherwise next pick is `F-13` (food follow-up). **R-13.1 / Track V** stays `blocked_human` until a VPS-2 exists ([VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md)). **Track D** stays on D1; D-1 waits for unpaid 402 lift ~24 Sep; do not start D-5 SQLite until V-16; do not run `R2_DELETE_CANDIDATES.json` ([DATA_PLANE.md](./DATA_PLANE.md)). | Catalog / process lock only when a **new** primitive or new god-file split is needed. |
| Do not | `npm test`; critic LLM; USDA; invent a primitive; live Gemini as inner loop; wait for Grok | Sit in a live wait loop; rewrite binge; re-lock packets other agents are executing |

---

## Track L — Localisation (active)

**Unparked 2026-09-15.** Human: do L-1…L-5. Restore strings from known-good git (`85ce58b` / `95c5640` / `4cd66d1`) — do **not** invent copy. L-5 still needs a named milestone locale before growing `fr`/`zh` to complete.

**Architecture:** `src/utils/translations.ts` (`en` source of truth, `id` key-parity) · `src/utils/i18n.ts` (`t()`, English fallback, `withAgentLanguage` / `withScoutLanguage`) · named gates `src/utils/i18n.test.ts` and `agents/dietitianInstructions.i18n.test.ts`.
**Scope:** English + Indonesian only. `fr` / `zh` stay incomplete and fall back to English. More languages later.

### Landed — do not redo

EN/ID UI chrome for login, home, chat, food history, insights, trends/health, profile menu; status badges; nutrient display names; health category headings; BMI/BMR panel; Insights step blurbs; job Ready/Active/Queued chip; chat empty-state; demo/credits; skip-dietitian verdict/advice templates; agent instructions follow `profile.language`. Food identity names stay untranslated. Native file-picker chrome cannot be translated.

### Still to do (active)

- **L-1 Live Indonesian meal-log proof.** **Landed 2026-09-15.** Live Render PASS (`indo-l1-meal-verdict.live.spec.ts`, job `job_1789418889841_nx1b76vmp`): profile.language=id required; verdict/advice Indonesian (not English Supports Sustained Metabolic Energy). Food names may stay English.
- **L-2 Seeded / demo content.** Pack restore from `85ce58b` landed 2026-09-15 (seed*/outlier*/clinicalActionDesc/dailyBenefitsDesc). Covered by automated preciseCause language test (`81a9651`); no live eyeball needed.
- **L-3 Catalog display names.** `displayBiomarkerName` / `displayConditionName` already wired (MedicalHistoryTab, dictionary, audit). Keep keys English; vitest gates in `i18n.test.ts`.
- **L-4 Admin / leftover widgets.** Pack restore from `85ce58b` landed 2026-09-15 (table*/backup*/audit*/dict*/sanitize*/batch*/img*/del*). Scorecard `i18n_required_chrome` ALL GREEN, sealed 2026-09-15 (705/0/0).
- **L-5 More languages.** Deferred 2026-09-15 (no milestone locale chosen). Keep EN+ID only; do not make fr/zh complete as a side quest.

**Out of Track L:** dish/brand names, JSON keys / nutrient codes / biomarker keys, native Choose File, old saved meal-analysis sentences (re-log to refresh).

**Gates while active:** `npm run scorecard:debug` (`i18n_required_chrome` PASS) + named i18n vitest (`i18n.test.ts`, `dietitianInstructions.i18n.test.ts`) + I18N-A11Y soak into `golden/scorecard/current/a11y/` when chrome changes.

## Track T — Staged-meal compose fixes (2026-09-18 → 2026-09-21, COMPLETE)

Screenshot-reported defects in the Matches / staged-tray / composite-card flow (`LogChat.tsx` Matches dropdown + tray, `compositeFoodCalculation.ts`, `FoodCard.tsx` + `NutritionLabelTable.tsx`). Work in this order. One class, one item, named tests.

**Playwright rule (binding):** new spec file `prototype/tests/staged-tray.spec.ts`, Tier 2 stubbed like `dialog-inventory.spec.ts` (stub `/api/*`, drive DOM, **no live Gemini**). Each item below names its test; **that test must pass for the item to be COMPLETE** — a green vitest alone does not close the item. Per L16, each item also extends the most relevant existing vitest file (no one-off suites) and keeps the run inspectable via the Canonical Run Tree where states/dispatches change.

| ID | Class | Item | Gate (inner vitest + Playwright, both green to complete) | Do not |
|---|---|---|---|---|
| **T-1** | `THUMB_FALLBACK` | Matches + tray thumbnails: real stored/donor photo renders; dead URL falls back to letter tile; proxy-guessed URLs are never used for display | `foodImageSources.test.ts` + `imageResolver` row · PW `staged tray: real photo shown, dead URL falls back, no broken-image icon` | Backfill fake images; live R2 calls in the loop |
| **T-2** | `LEAK_UNREADABLE_CHROME` | Gram inputs readable in dark mode (explicit text color on both Matches inputs) | `i18n.test.ts` untouched (no copy change) · PW `gram inputs keep readable text color in dark mode` | Restyle the whole dock; translate chrome |
| **T-3** | `PORTION_FUNNEL` | Tray gram field clear-to-edit: select-all+delete shows empty (no snap to 1); `0` allowed mid-edit; clamp ≥1 on blur/submit | `quantityText.test.ts` + tray unit in `server_food_multi_composition.test.ts` · PW `tray gram field clears and clamps` | Second LLM; per-country paths |
| **T-4** | `DOUBLE_CONFIRM` | Single confirmation: `+ Add` stages only — chat input must NOT contain the bracket tag afterwards; unstage still cleans text | `bracketPortionParser.test.ts` · PW `add stages without mirroring into chat box` | Keep the mirror as "feature"; touch helper logic |
| **T-5** | `STALE_SUBMIT` | Submit works staged-only: empty input + staged tags sends via instant composite path; staged + plain query text still routes composite (no silent agent-path drop) | `server_food_multi_composition.test.ts` · PW `staged-only submit composes instantly` + PW `staged plus query text still composes` | `POST /loop`; paint expected.json |
| **T-6** | `MEAL_IMAGE_UNIQUE` | Card shows preview AND full image(s): composite `allImages` render as gallery (multi-image meal shows all), preview stays; agent-path thread carries staged photos on the user message (scout input untouched) | `imageResolver.contract.test.ts` · PW `composite card gallery shows every staged image` + PW `agent-path thread carries staged photos` | Duplicate R2 uploads; drop `preferred_language`-style widening |
| **T-7** | `FALSE_FRIEND` | OCR badge on restaged meals: `dbSource`/`labelNutrientsPerServing`/`rawNutritionLabel` propagate tag → calc → card, "Nutrition Facts (OCR Label)" shows with **zero** extra agent calls (assert no unexpected `/api` POSTs in PW) | `brandCurator.test.ts` row + `debugPayload.test.ts` · PW `restaged OCR meal shows label badge with no agent call` | New agent/dispatch for OCR; invent a catalog primitive |
| **T-8** | `THIN_ROW_HYDRATE` | Restaging a past meal from `/api/food/search` hydrates thin API rows (nutrients / images / OCR provenance) from the full saved local log before the composite card renders — no extra network or agent call | `compositeFoodCalculation.test.ts` (`hydratePreviousMealTag` row) · PW `staged tray: T-8 thin restage hydrates nutrients, images and OCR from saved log` | New catalog primitive; live R2/Gemini calls in the loop |

**Status 2026-09-21:** T-1…T-8 landed (`b9a37e1`…`a1b7449`; T-8 `239a6d9`/`a9e9886`). `prototype/tests/staged-tray.spec.ts` is **10/10 green** and wired into `scripts/assert-shell-smoke.mjs`; no Track T item is open.

**Process for Track T:**desk-check each item against `docs/agent/DOMAIN_REGRESSION_MAP.md` matching row; `tsc` + named vitest + the item's PW test per item; `journey-guard` + shell-smoke before COMPLETE. New user-visible copy (if any) goes in `translations.ts` en+id parity.

## Gates (named rows, not a pile)

**Every COMPLETE:** `npx tsc --noEmit` + the [DOMAIN_REGRESSION_MAP.md](../docs/agent/DOMAIN_REGRESSION_MAP.md) row(s) for files you touched. That is the whole default. See `QUALITY.md` §1.4.

**Soak** (`npm test`) is optional and slow (~97 files). Do not make it the inner loop. `tests/golden_inbox.test.ts` stays excluded.

Track-specific (only if that track’s files changed):

```bash
# Track B
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/assert-biomarker-ingest.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts tests/golden_biomarker.test.ts
# Track F curator
node scripts/assert-food-curator-m30.mjs
# Track R sync
node scripts/assert-free-tier-complete.mjs
npx vitest run src/utils/syncUtils.regression.test.ts
# Track Q platform (prompt / god-file size)
node scripts/assert-budgets.mjs
```

Do **not** invent missing `scripts/assert-*.mjs` names from old map rows (Q-7).
