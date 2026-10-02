# Health room — mission item 6 handoff (2026-10-02)

**State:** `origin/main` `2c016419`. The health-room lane through item 6 is merged:
#469 `2396a5fa`, #470 `a425c974`, #471 `4c003c70`, #472 `69076161`, #474 `c24e1b19`,
#477 `8c1204f0`, and **#479 `1999c12f` (item 6)**. `main-verify 1999c12f` = success and
the red-`main` issue opened against `2597865` (#478) has self-closed, so the merge queue
is open. Full evidence for the last drop: `specs/active/HEALTH-GROUP-5.md`.

**Box (`vps-0a61fae6`).** All three serving trees are at `1999c12f`:
`/home/ubuntu/deploy/Health-tracker` (bot `vm`), `/home/ubuntu/bot-host-r14` (seats
`vm2`/`vm4`/`vm5`/`vm6`/`android`/`opencode`), `/home/ubuntu/bot-host` (bot `vm3`).
All seven `bot-host@*` system units were restarted by SIGTERM and came back active.
SSH access (BatchMode works; a keychain agent hangs, so pin the key):

```
ssh -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes \
    -i ~/.ssh/id_ed25519 -o ConnectTimeout=10 ubuntu@51.254.217.163
```

---

## 1. What the user asked for

> "What's important is that my bot should really be working on the brief above all…
> flexible to answer my questions instead of sending predefined and irrelevant answer."

Five numbered plan items closed over several passes; item 6 (the transcript's own
questions, never re-asked through the live health-room path) was the last open one.
The approved plan is complete. **Do not start new feature work on this lane unless the
user asks.**

## 2. Item 6: what was driven, and the answer contract

The four transcript questions plus the typo'd command were driven on the box through the
same path the live bot runs — `classifyHealthGroupTurn` → brief branch or
`answerHealthGroup` → `runGemini` → reply text — using the serving tree, the box's real
`GEMINI_API_KEY`, and the real workspace `/home/ubuntu/projects/external-health-coach`.

| ask | turn | `usedModel` | `fallbackReason` | reply shape |
| --- | --- | --- | --- | --- |
| "how to clean up the data" | council | `true` | `''` | names H-1, `/health triage`, `/health dashboard` |
| "can you fix the data" | council | `true` | `''` | says the chat can't edit the app/sheet, points at the first repair |
| "What about accurate data for this project. Can you build that out?" | council | `true` | `''` | quotes only figures the record holds (178 vs 163 cm, 74 vs 62 kg) |
| "Can you work on the brief?" | brief | n/a | `''` | the real publisher reply: 8 open repairs, drafts published, analysis withheld |
| "/heath verify" (typo) | router | n/a | n/a | `Unknown command: /heath` + the help that lists `/health` |

**Before the fix, three of the four had fallen back** with
`model failed: Gemini run timed out after 120s.` (twice) and
`model failed: Gemini provider error: code 503`. Cause, measured on the box: the lane's
default engine `gemini-3.7-flash` was stalling at 45 s/120 s and then answering 429
"exceeded your current quota", while `gemini-3.5-flash-lite` answered the same 2,834-char
prompt in ~920 ms. The lane had one model and no failover.

## 3. The fix that is now on main

`scripts/lib/agent-gemini.mjs` gained the failover half of the live-site parity its own
header already claimed (`server_gemini_retry.ts` `nextGeminiFallbackEngine`: fail the
model, not the job): on a transport stall, a 502/503/504 or UNAVAILABLE body, or a 429,
`runGemini` makes **one** hop to `GEMINI_STALL_FALLBACK_MODEL`
(`gemini/gemini-3.5-flash-lite`) — never a second hop, never when the primary already is
the fallback, and a 429 is still never re-asked on the *same* engine. The answering
engine is recorded (`stderr: fallback:…`, plus a `console.warn` naming both). Inject
`fallbackModel: ''` to disable.

Pinned by `scripts/assert-health-group.test.mjs` (**118 pass, 0 fail**, was 90): the four
transcript asks as classification + answer-contract cases, the typo end-to-end through
the host's own `--simulate` route, and the hop (stall, doubly-503, quota, no-self-hop,
disabled, and the 2000 ms retry wait). Red three times and restored: hop off → 6 FAIL,
quota branch off → 3 FAIL, unknown commands dropped silently → 2 FAIL.

## 4. What is left, in order

1. **Handover bullet for #479 in `AI_HANDOVER.md`** — the lane convention is a feature
   PR first and a docs PR after (precedents: #472 for #471, #477 for #474). One bullet
   inserted after `# Status`; everything else untouched; `Next: specs/active/HEALTH-GROUP-5.md#left`
   and an `Author:` trailer in the PR body, or the PR body contract fails.
2. **The real-room re-ask is the user's, not the agent's.** A bot cannot read back its
   own outgoing Telegram messages, so a box-side script cannot drive the transport. The
   instrument when they do ask: `journalctl -u bot-host@vm -f | grep 'fell back'` —
   zero lines is success.
3. **First real renewal.** `health-renewal@vm.timer` is armed, next fire
   `2026-11-01 00:00 UTC`. It fires for real only after the user runs `/health verify`
   (or start it by hand: `systemctl --user start health-renewal@vm.service`). Expected
   journal: one publish of the new snapshot, or
   `No renewal: already renewed from this snapshot`.
4. **The user's data gate H-1…H-8** — the room answers from the open repairs and points
   at `/health triage` / `/health dashboard`; closing the repairs is work only the user
   can do in the app.
5. **Stalled PR #455** owns these files — do not touch them while it is open:
   `scripts/health-runner.mjs`, `scripts/lib/health/docs.mjs`, `scripts/lib/health/sheet.mjs`,
   `scripts/assert-external-health.test.mjs`, `projects/external-health/roles/health_analyst.md`,
   `projects/external-health/templates/00_Health_Dashboard.md`, `templates/01_Health_Snapshot.md`.

## 5. Reproducing the live proof (read-only, no Telegram send)

Run on the box as `ubuntu`; it never writes to the user's workspace (hash before/after
must both be `d1fb7ba7f1ed2ae31481eda2fced3bce39469df7`, 8 files):

```js
const ROOT = '/home/ubuntu/deploy/Health-tracker';
const { classifyHealthGroupTurn, answerHealthGroup } =
  await import(`${ROOT}/scripts/lib/health-group.mjs`);
const { runGemini } = await import(`${ROOT}/scripts/lib/agent-gemini.mjs`);
const turn = classifyHealthGroupTurn({
  kind: 'group',
  addr: { addressed: true, isBroadcast: true, roleId: null },
  text: 'how to clean up the data', projectId: 'external-health',
});
const reply = await answerHealthGroup({ ...turn, workspace: '/home/ubuntu/projects/external-health-coach',
  runModel: async ({ prompt }) => {
    const res = await runGemini({ prompt, model: process.env.COUNCIL_MODEL || 'gemini/gemini-3.7-flash', timeoutMs: 120000 });
    const out = String(res?.finalText || '').trim();
    if (!out) throw new Error(res?.lastError || 'the model returned no text');
    return out;
  }});
console.log(JSON.stringify({ usedModel: reply.usedModel, fallbackReason: reply.fallbackReason, text: reply.text }));
```

Load `GEMINI_API_KEY` first: `set -a; . ~/.config/bot-host/common.env; set +a`.
The brief branch must **not** be called against the real workspace in a script — it runs
the publisher; drive it against a scratch copy of the workspace with a fake store (4
in-place `replace` calls, zero Drive writes), which is what
`specs/active/HEALTH-GROUP-5.md` records.

The typo path, on the real host binary (0.3 s, no model call):

```
cd /home/ubuntu/deploy/Health-tracker
node scripts/bot-host.mjs --simulate="/heath verify" --id=vm
# → [reply] Unknown command: /heath  + help listing /health
```

Restarting the fleet without root (units are `Restart=always`, so SIGTERM is enough;
all seven must report `active` with a new `MainPID` afterwards):

```
for u in vm vm2 vm4 vm5 vm6 android opencode; do
  systemctl show "bot-host@$u" -p MainPID --value | xargs -r kill -TERM
done
```

## 6. Which file owns what

- `scripts/lib/health-group.mjs` — classification of a room message
  (`classifyHealthGroupTurn`, `isBriefAsk`), the prompt, the record checker
  (`acceptHealthReply`), fallback wording, brief-state context. No edits were needed here
  for item 6; it is the contract everything else serves.
- `scripts/lib/agent-gemini.mjs` — the provider lane: key chain, the one 503 retry, the
  404 hop, and now the stall/quota hop. Every model caller shares it.
- `scripts/bot-host.mjs` (5,482 lines) — the command router (`handleCommand`), message
  dispatch, and the health-turn dispatch (brief branch vs seats, busy guard, `fell back:`
  log line).
- `scripts/lib/commands.mjs` — addressing (`resolveGroupAddressing`), command names,
  help text.
- `scripts/assert-health-group.test.mjs` — 118 pins for the room's behavior.
- `specs/active/HEALTH-GROUP-5.md` — packet: gate list, findings, measured evidence.
- `plan/HEALTH_ROOM_ITEM6_HANDOFF.md` — this file.

**Two places where a change landed that does not fully belong** (worth knowing before you
add anything): the failover pins live in `assert-health-group.test.mjs` because the room
is the consumer, but the hop itself is generic provider behavior and has no
`agent-gemini`-specific sensor; and the typo contract for `handleCommand`'s
`default:` branch is pinned only from the health sensor, by spawning
`bot-host.mjs --simulate` — `handleCommand` is not exported, so an in-process pin would
first need an export.

**Hazard if the merge queue blocks:** `merge-agent-pr` refuses every PR while `main`'s
post-merge verification is red, which also blocks the PR that would fix it. The recorded
way out is `gh workflow run auto-merge.yml -f pr=<n> -f allow_red_main=true` — but only
after confirming the red is not yours. On 2026-10-02 the red was #478's landed message
missing `## Summary/Status/Left`, judged from `git log -1` on `main`, so the next
well-formed merge repaired it; the gate that failed is `Landed message keeps the
handover (manual-merge backstop)` in `ci.yml`, and every other step behind it was
skipped rather than failing.
