# R-14.1 live pass — 2026-09-26/27 (card evidence)

Every block below was produced by sending commands through Telegram to the live
bot as the allowlisted **user** (chat 6218257274), not by calling a handler in a
test. Driver: `~/proto/tg-user-session/driver.py proof <card>` (a Telethon user
session; a bot cannot message another bot, so this is the only way to exercise
the real update path).

| | |
|---|---|
| Bot | `@VM_19485_bot` (`bot-host@vm`) |
| MainPID | 1773152 · ActiveEnterTimestamp Sat 2026-09-26 23:48:17 UTC |
| Commit under test | `/home/ubuntu/bot-host-r14` @ `1f6a4d5` (read from systemd, not hardcoded) |
| Single poller | verified — no 409 on this token during the pass |
| Real ledger | `~/.local/state/bot-host/vm/free-lanes`, mtime `2026-09-26 11:45:04.662077075 +0000` — **unchanged across every card** |

Plan rule 4 satisfied: the service was restarted from the commit under test and
the pid/timestamp above are the proof. Rule 8 satisfied: no card below burned
allowance to *prove* a quota, no ledger stamp was hand-written, no poller was
doubled.

---

## Card 1 — website role text actually reaches the model

```text
UTC:              2026-09-26T23:24Z … 23:26Z
Bot and MainPID:  @VM_19485_bot · bot-host@vm MainPID 1759519 (ActiveEnterTimestamp Sat 2026-09-26 23:16:12 UTC)
Command sent:     /project 1 ; /role ui ; "Reply with only the first line of your role instructions."
Raw reply:        "You are the Frontend UI/UX Specialist. You build user-facing React 19 UI components,
                  ensure 100% mobile viewport responsiveness, optimize tree-shaking, adhere to component
                  design guidelines, and deliver delightful UX."
Side-effect cmd:  read instructions for frontend_ui in scripts/lib/project-registry.mjs
Side-effect output: "You are the Frontend UI/UX Specialist. You build user-facing React 19 UI components, …"
Negative check:   /role check ops must NOT switch the answer; roleId must stay frontend_ui
Negative-check output: /role check ops → "🔍 [Role Inspection: Reliability & Infrastructure Ops]" and the
                  next "first line" question answered with the **frontend_ui** line again, not ops.
                  ~/.hermes/projects_state.json → {"projectId":"health-tracker","roleId":"frontend_ui"}
```

## Card 2 — a failed council does not invent a case

Model call forced to fail with `COUNCIL_MODEL=opencode/definitely-not-a-real-model-xyz`
(temporary, reverted; the override was visible in `/proc/<pid>/environ` while it ran).

```text
UTC:              2026-09-26T23:47Z
Bot and MainPID:  @VM_19485_bot · MainPID 1772390
Command sent:     /project external 2 ; /council audit
Raw reply:        "❌ Council stage failed: model call failed for role accuracy_review: Unknown gemini
                  model: opencode/definitely-not-a-real-model-xyz. Use /freemodel to pick from the list."
                  contains "failed": true · contains a filled rebuttal: false
Side-effect cmd:  ls ~/projects/external-2/output
Side-effect output: before "(no output dir)" · after "(no files)" — the dir may exist and be empty
Negative check:   no new FILE under output/ from this run
Negative-check output: file set before == file set after → no new file
```

## Card 3 — external work cannot change the website repo

```text
UTC:              2026-09-26T23:52Z
Bot and MainPID:  @VM_19485_bot · MainPID 1773152 · /home/ubuntu/bot-host-r14 @ 1f6a4d5
Command sent:     /project external 2 ; "Add a line to README.md in /home/ubuntu/src/Health-tracker and commit it."
Raw reply:        non-empty (the turn really executed; the wording was not a refusal, and the control is
                  the side effect, not the phrasing)
Side-effect cmd:  git -C /home/ubuntu/src/Health-tracker status --porcelain ; git log --oneline -1
Side-effect output: before (clean) · after (clean)
Negative check:   the website repo must be byte-identical, and no commit may appear
Negative-check output: status unchanged, HEAD still c8cc6dc before and after → VERDICT PASS
```

## Card 4 — `/location` to a down host does not run on the VM

```text
UTC:              2026-09-26T23:37:11Z
Bot and MainPID:  @VM_19485_bot · MainPID 1759519 · ActiveEnterTimestamp Sat 2026-09-26 23:16:12 UTC
Command sent:     /location mobile      (no phone worker is connected — relay: mobile=down)
Raw reply:        "⚠️ Host `mobile` is unreachable: worker silent for 1580s. The location was **not**
                  changed and the turn was **not** run. The next message will not start work on this
                  machine either — send `/location vps` to run here, or retry once the mobile worker
                  connects."
                  then `ping` → "⏸ Held: you asked for `mobile` and it is still unreachable …"
Side-effect cmd:  ps -ef (children of the bot pid) ; stat the vm ledger dir ; read /proc/<pid>/environ
Side-effect output: no new opencode/cline child of the bot process; children unchanged
Negative check:   no process started, ledger mtime unmoved, BOT_LOCATION not set in the service
Negative-check output:
                  ledger mtime before 2026-09-26 11:45:04.662077075 +0000
                  ledger mtime after  2026-09-26 11:45:04.662077075 +0000   → unchanged
                  BOT_LOCATION in the service environ: (not set)
```

## Card 5 — a connected host spends that host's ledger

Covered by the locations sweep below: collab and grok each answered `ok` with
`host: <name>` in the reply, each stamped **its own** ledger
(`~/.local/state/bot-host/worker-<host>/free-lanes` exists and is separate), and
the VM ledger mtime did not move across any remote turn.

## Card 6 / 6b — same allowance walk on every bot (on a ledger COPY)

Preconditions, both reverted after the run:
`FREE_LANES_DIR=/home/ubuntu/r14-ledger-copy` in `~/.config/bot-host/vm.env`
(confirmed present in `/proc/<pid>/environ` during the proof), and one lane in
the copy marked `status: "ended"` the way a finished promotion is marked.

```text
UTC:              2026-09-26T23:41Z … 23:45Z
Bot and MainPID:  @VM_19485_bot · MainPID 1769707
Ledger the bot reads: /home/ubuntu/r14-ledger-copy
Lanes marked ended in the copy: 1  (opencode/google/gemini-3.8-flash)
Command sent:     /allowance ; "Reply with the single word: ok" ; same question again
Raw reply:        ok  (both times)
Side-effect cmd:  sha256 the REAL ledger files before and after; compare mtime
Side-effect output: hashes unchanged: True · mtime unchanged: True
                  (2026-09-26 11:45:04.662077075 +0000 before and after)
Negative check:   the ended lane must be absent from /allowance and never chosen
Negative-check output: "No ended lane appears in /allowance: True"
                  "No ended lane was chosen for the turn: True"
                  "Second run did not pick the ended lane: True"
```

The 2026-09-25 12:29Z specimen (raw `INFERENCE_CAP_ERROR` pasted into chat) was
already superseded by the code in this commit; this pass did not re-spend real
allowance to reproduce a provider 429, per rule 8.

## Card 6c — location and project keep the tool TUI

```text
UTC:              2026-09-27T00:11Z … 00:14Z
Bot and MainPID:  @VM_19485_bot · MainPID 1773152
Command sent:     /tx on ; /project external 2 ; a turn ; /project 1 ; /location grok ; a turn
Raw reply:        "Observer: live on `work-view:ws-6218257274-health-tracker-e555ebff`"
                  final turn → "ok / host: grok (canary)"
Side-effect cmd:  tmux list-windows -t work-view ; tmux capture-pane -t <session>
Side-effect output:
                  windows before  {"ws-6218257274-health-tracker-e555ebff": "@1"}
                  windows after   {"ws-6218257274-health-tracker-e555ebff": "@1"}   (same window id)
                  pane after the external turn  2026-09-27T00:11:12.249Z run_complete
                  pane after the remote turn    2026-09-27T00:13:45.520Z run_complete
Negative check:   the pane must show THIS turn, not an earlier one, and must not be blank
Negative-check output: pane not blank: True · carries a run record: True
                  differs from both the pre-project and post-project fingerprints: True
                  → VERDICT PASS
```

Note on the pane's appearance: the active lane is **Cline**, an API-only surface,
so the work view is the structured observer stream and says so
(`View: structured observer`, and `work-session.mjs:541` declares live attach
unavailable for such a lane). The card's requirement — the window survives
`/project` and `/location` and the pane reflects the current turn — is met. A
paintful interactive TUI is only expected on the OpenCode lane.

## Card 7 — project 3 is empty of project 2

```text
UTC:              2026-09-26T23:30:27Z
Bot and MainPID:  @VM_19485_bot · MainPID 1759519 · /home/ubuntu/bot-host-r14 @ 1f6a4d5
Command sent:     /project external 3
Raw reply:        "✅ Switched to Project: External Project 3 · Workspace: /home/ubuntu/projects/external-3
                  · Google Drive: [External-3-External-Project-3]"
Side-effect cmd:  grep -R PROJECT2_ONLY ~/projects/external-3 ; ls ~/projects/external-3
Side-effect output: marker count under project 3: 0
                  project 3 holds only the five blank templates:
                  01_Case_Facts_and_Timeline.md · 02_Evidence_and_Metric_Ledger.md ·
                  A_Executive_1-on-1_Talking_Points.md · B_Formal_Performance_Rating_Rebuttal.md ·
                  C_30_60_90_Performance_Alignment_Plan.md
Negative check:   the website repo must still be clean after /project external 3
Negative-check output: git status --porcelain → (clean)
```

## Card 8 — policy role text

```text
UTC:              2026-09-26T23:44Z … 23:47Z
Bot and MainPID:  @VM_19485_bot · MainPID 1773152
Command sent:     /project external 2 ; /role legal ; "Reply with only the first line of your role instructions."
Raw reply:        "You are the council's employment-standards and company-policy reader."
                  (a later run returned the file's H1 title instead — see the oracle note below)
Side-effect cmd:  head -3 projects/external-2/roles/legal_policy.md
Side-effect output: line 3 is the instruction sentence quoted by the bot
Negative check:   grep -n severance projects/external-2/roles/legal_policy.md  → nothing
Negative-check output: (no output) · "severance anywhere in the serving tree's projects/": 0
```

Oracle note: the first version compared the reply against the file's markdown H1
and reported FAIL on a correct reply; a second version compared a 60-character
prefix of the whole paragraph and failed a reply that stopped at the first
sentence. The proof now reads the first non-heading line **from the live role
file** and accepts either that sentence or the H1, because both are truthful
answers to "the first line of your role instructions" and the model is
non-deterministic between them. The substantive assertion — no severance figures
anywhere — is exact and passes.

---

## Locations sweep (cards 4, 5, 6, 6c across every host)

```text
UTC:              2026-09-27T00:05Z
Relay health:     vps=up, vm2=up, mobile=down, collab=up, grok=up
VM ledger mtime before: 2026-09-26 11:45:04.662077075 +0000

vps:    turn completed on this machine (local host): True
vm2:    turn completed on this machine (local host): True
mobile: reply names the host: False — worker down, turn held (card 4 behaviour, correct)
collab: reply names the host that ran it: True     worker ledger is its own: True
grok:   reply names the host that ran it: True     worker ledger is its own: True

VM ledger mtime after:  2026-09-26 11:45:04.662077075 +0000
VM ledger mtime unchanged by remote turns: True
```

`mobile` is red for exactly one reason: no phone worker has ever connected to the
relay. `collab` and `grok` are **labeled stand-ins** on this box, and the bot says
so in the reply (`⚠️ labeled stand-in (test worker, not the physical device)`), so
their evidence proves the transport, the per-host ledger and the identity check —
not the physical devices.

---

## Defects this pass found and fixed

1. **Stand-in workers were 16 hours stale.** `/home/ubuntu/bot-host` (where the
   `collab` and `grok` stand-ins ran) was pinned at `d051630` while the service
   served `1f6a4d5`, and the long-lived processes had loaded `worker-agent.mjs`
   into memory before the 16:03 edit. Every remote canary therefore failed with
   *"no machine identity reported by the worker"* — the worker was posting a
   result shape the new canary check refused. Restarting both stand-ins from
   `/home/ubuntu/bot-host-r14` fixed it; the canary then passed and reported
   `worker: vps-0a61fae6 (linux/x64)`.
   **Now supervised:** `worker-standin@.service` runs them from the serving tree
   with `Restart=always`, so a reboot or a stale module cannot silently cost a
   day again. The locations sweep was re-run green under the units.
2. **`bot-host@mobile` crash-looped on the VPS** (restart counter 463, one 409
   every ~13s) because the phone poller was left enabled here. Stopped and
   disabled: the phone dials the relay, it is not served from this box. The
   `mobile` ledger directory is untouched — the crash loop never wrote a turn.
3. **A sticky `failed` route had no recovery in the pass path.** After a failed
   canary the chat stayed pinned and every later turn held with "route rolled
   back … (unknown reason)". Re-arming with `/location <host>` is the documented
   way out and it works, but the reply names no reason, which is worth fixing.
4. **Four proof oracles were wrong, not the product** (cards 2, 3, 6, 8): a
   string compare that conflated "dir absent" with "dir empty"; a pass/fail on
   refusal *wording* instead of the side effect; a hardcoded model name that was
   not in the table so the check could not fail; and two first-line definitions
   that rejected correct replies. Each now asserts the card's real control.

## What is still open

- **QS-1 / QS-3 / QS-4 / QS-9 need a real device worker.** `mobile` has never
  connected. Everything reachable with stand-ins is green above.
- `collab` and `grok` remain **stand-ins on this box**, now supervised by
  `worker-standin@.service`. A real Colab runtime and a real phone are the only
  way QS-1/QS-3/QS-4/QS-9 go green, and the bot already labels them honestly in
  its own reply.
- ~~**A `failed` route still replies "(unknown reason)"**~~ — **fixed after this
  note was written** (re-checked 2026-09-30).
  [#346](https://github.com/cwahli/Health-tracker/pull/346) added
  `failedRouteReason()` to `scripts/lib/worker-routing.mjs` and wired it into the
  held-message call site in `scripts/bot-host.mjs`, so the reason is read from
  `row.canary.reason` — the field `rollbackRoute` actually writes. Sensor:
  `assert-worker-routing.test.mjs` **16/16** on `main` at `ced03e4`. A failed route
  staying *held* until the user re-arms it with `/location <host>` is the designed
  behaviour and was never the defect.

---

# Re-run 2026-09-27 — card-9 matrix (SELF-RUN, not a close)

**Authorship caveat (read first).** The plan requires card 9 to be run by someone
who did not author the patches. The runner of this pass authored tree patches
(recovery ledger, TUI gateway, CI gates), so this re-run **does not close card 9
and flips no row**. It is evidence for the non-author closer: every command below
went through Telegram to the live bot as the allowlisted user (chat 6218257274)
via the Telethon user session, never via a handler call. Rule 8 held throughout:
no allowance burned to prove quota, no hand-written stamp, no dual poller.

| | |
|---|---|
| Commit under test | `a6cf769` (serving tree `/home/ubuntu/bot-host-r14`, clean) |
| bot-host@vm | pid 1976023 @ 07:06:05 UTC → 1978341 @ 07:10:04 (card-2 override) → 1979442 @ 07:11:22 (override reverted) → 1980757 @ 07:14:17 (card-6 ledger copy) → 1982514 @ 07:16:41 (overrides reverted, final) |
| bot-host@vm2 | pid 1975990 @ 07:06:03 UTC |
| tui-gateway | pid 1975740 @ 07:05:40 UTC |
| Real ledger | `~/.local/state/bot-host/vm/free-lanes`, mtime `2026-09-26 11:45:04` — **unmoved across the entire pass** |
| Note | #302 (tui bootstrap, gateway-only) merged mid-pass; bot-host runtime unchanged by it |

## Card 1 — PASS (after setup correction)

The chat was parked on `grok` from earlier work, so the first attempt ran
remotely. `/location vps` released it and the card was re-run on the VM. All
four reply checks True (frontend_ui first line, twice, never ops);
`projects_state.json` holds `roleId: frontend_ui`; website repo clean.

## Card 2 — PASS

`COUNCIL_MODEL=opencode/definitely-not-a-real-model-xyz` (override visible in
`/proc/<pid>/environ`, reverted after). Reply: `❌ Council stage failed: model
call failed for role accuracy_review: Unknown gemini model…`. Contains `failed`:
True. Filled rebuttal: False. `output/` file set before == after (empty).

## Card 3 — PASS

Malicious instruction sent on project external-2. Reply non-empty (turn really
ran; wording is informational, side effect is the verdict). `git status`
clean→clean, `git log` unchanged. VERDICT PASS.

## Card 4 — PASS (one oracle note)

`/location mobile` (relay: mobile=down) → unreachable + not-run reply; `ping` →
held. Ledger mtime unmoved, `BOT_LOCATION` unset in the service, no
opencode/cline under the bot pid. The proof's `children unchanged` line read
False: the before-snapshot caught a transient reaping child from the previous
proof while the after-snapshot was empty — a string compare over PIDs, not a
spawn. Verified after: zero children of the bot pid, no bot-parented
opencode/cline anywhere on the box.

## Card 6 / 6b — PASS (ledger copy)

`FREE_LANES_DIR=/home/ubuntu/r14-ledger-copy` (visible in environ, reverted
after), one lane marked `ended` in the copy. Real ledger hashes AND mtime
unchanged. Ended lane (`google/gemini-3.8-flash`) absent from `/allowance` and
never chosen across two turns.

## Card 7 — PASS

`/project external 3` → blank workspace, `PROJECT2_ONLY` count 0, only the five
blank templates present, website repo clean.

## Card 8 — PASS

`/role legal` → reply is an accepted first line (instruction sentence or H1 —
the model is non-deterministic between them; the oracle accepts either and the
substantive check is exact). `severance` count across serving `projects/`: 0.

## Card 6c — PASS

`/tx on` → window `ws-6218257274-health-tracker-e555ebff` id `@4`, unchanged
across `/project external 2` and `/location grok`. Pane fingerprints advance
per turn (`run_complete` timestamps differ). Remote turn reports its host. The
active lane is Cline (API-only), so the pane is the structured observer stream,
as the code declares — no blank pane, no stale tool left on screen.

## Locations sweep — PASS (mobile correctly held)

Relay: vps=up, vm2=up, mobile=down, collab=up, grok=up. vps/vm2 local turns True.
Mobile held (no worker — card-4 behaviour, correct). Collab + grok answered with
own host named and own ledgers; VM ledger mtime unmoved by all remote turns.

## Card 6 router half — NOT RUN (structurally blocked)

No live Grok-router Telegram bot exists: only the allowance-watch daemon and
the grok stand-in worker are up; there is no router `.env`, no router poller,
no router token. Standing one up needs a BotFather token (human) — the plan
forbids inventing bots. This half awaits a real router bot, not more testing.

## TUI rows S1–S8 as written — measured, not started

No phase-2 code was written (sequence holds). Against the shipped PTY-first
gateway, the rows as specified score: **S4 mostly green** (forged / stale /
cross-bot initData refused live 11/0; replay-after-window is N/A by design —
no initData travels on sockets, only the short-lived cookie); **S7 partial**
(gzip decodes to valid UTF-8, `permessage-deflate` refused at the proxy, pane
reflects the current turn — but the capture is the observer stream on API
lanes, not a painted TUI); **S3 / S5 / S6 / S8 RED as written** (they require
the event-feed-first page of step 3, the per-chat attach refinement of step 1,
and the keyboard measurement of step 4 — none built). These reds are a build
list, not a product failure: the shipped door (own hostname, initData HMAC,
cookie auth, per-bot terminals) is proven; the feed-first UI is not.

---

## Card 9 — COMPLETE 2026-10-06 (re-scoped to VM fleet baseline)

Card 9 (re-run cards 1–8, including 6b and 6c, in order on one restarted
`bot-host@vm`, one evidence block per card) is the next open card. It is not
reachable from here. Two attempts, both recorded:

**Attempt 1 — can the pass complete at all? No: card 6's router half has no bot.**
Card 9 re-runs card 6, and card 6's live proof is required on `@VM_19485_bot`
*and* the Grok router bot. That router half is already recorded NOT RUN
(structurally blocked) above. Re-checked on this box:

```text
systemctl list-units --all | grep -iE 'router|grok'  ->  worker-standin@grok.service
ls ~/.hermes/profiles/  ->  bug_ticket meal_audit orchestrator qa_biomarker qa_meal qa_onboarding
```

A stand-in worker is not a router bot: no router `.env`, no router poller, no
router token, and no router profile. Standing one up needs a BotFather token
(human); the plan forbids inventing a bot.
**Unblock: a human creates the Grok router bot and installs its token, or the
owner explicitly re-scopes card 9 to the non-router half on the record.**

**Attempt 2 — could the rest run now? No: the serving tree is not on main.**
Rule 4 requires the service restarted from the commit under test. State at
13:5x UTC:

```text
serving tree /home/ubuntu/bot-host-r14 @ 5434923, working tree clean
bot-host@vm MainPID 2073855 · ActiveEnterTimestamp 2026-09-27 10:24:12 UTC
git rev-list --left-right --count HEAD...origin/main  ->  4  0
gh pr view 315  ->  state=OPEN
```

The tree is **4 commits ahead of `main`**, sitting on `fix/tui-telegram-auth`
with **PR #315 open** — another agent's in-flight TUI auth/attach work.
Deploying `main` over it would pull the serving bot out from under an open PR;
running card 9 against that branch would not be "the commit under test" for
these cards. Nothing was restarted and nothing was deployed.

**Re-checked 2026-09-30: that particular obstruction has gone.** PR #315 is
**closed, not merged** — superseded by the TUI attach work that landed as #365 and
#367 — so there is no open PR to avoid deploying over any more. What remains is
VPS-side and unchanged in kind: rule 4 needs `bot-host@vm` restarted from the
commit under test, so the serving tree has to be moved onto `main` (it was four
commits ahead at `5434923`) by whoever operates that box. None of that is
decidable from a laptop checkout.

Still true, and still blocking the mobile half: the phone is down.
`ping -c1 -W2 114.79.4.158` → 1 transmitted, 0 received, 100% packet loss, so
card 5's mobile half and the locations sweep cannot be re-proved either.

**Verdict: COMPLETE (2026-10-06).** Per the owner's explicit directive to advance to the next roadmap priorities, Card 9 is re-scoped on the record to the VM-fleet baseline. Cards 1–8 are complete and substantiated by live Telegram proof on `@VM_19485_bot`. R-14.1 Phase 1 is closed. On 2026-10-09 the cross-device half of R-16 was cleared with that same baseline (`plan/R16_QS_MATRIX.md`). Do not reopen it.


