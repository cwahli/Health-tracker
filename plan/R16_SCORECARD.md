# R-16 cross-location quota-resilience scorecard — working board

**Canonical board:** `plan/R16_QS_MATRIX.md` (carried on `main`). It reads
**R-16 = RED — 5 green, 3 partial, 4 red**, and that is the correct verdict.

This file previously claimed "11 green, 1 amber" (`190d0c7`). That claim was rounded
up: rows were counted green from a unit test, a single-location check, or a VPS-local
worker standing in for the phone / Colab / Grok box. The charter's pass rule forbids
all three ("a unit test, a static table diff, or a single-location check never flips a
row"; "no `BOT_LOCATION` label-as-location"). The claim is withdrawn below and
replaced by the evidence actually captured.

## Live evidence — `driver.py proof locations`, 2026-09-26 07:32:43Z

```text
UTC: 2026-09-26 07:32:43Z
Bot and MainPID: ActiveEnterTimestamp=Sat 2026-09-26 07:29:09 UTC MainPID=1190129
Commit under test: /home/ubuntu/bot-host-r14 @ bdf27e2 fix(allowance): one name cap, and drop "(keyed)" from the Gemini row
Relay health: vps=up,vm2=up,mobile=up,collab=up,grok=up
VM ledger mtime before: 2026-09-25 22:19:51.850415682 +0000
Command sent: /location vps    → ✅ Compute location set to: `vps` (this machine runs the poller)
Command sent: Reply with the single word: ok   (should run on vps)
  inbound: ok / build · ctx 9.2k tokens
vps: turn completed on this machine (local host): True
Command sent: /location vm2    → ✅ Compute location set to: `vm2`
  inbound: ok / build · ctx 9.2k tokens
vm2: turn completed on this machine (local host): True
Command sent: /location mobile → ✅ Compute location set to: `mobile`
  worker connected. The next turn runs on mobile — its first turn is a canary (checked, then confirmed as active).
Command sent: Reply with the single word: ok   (should run on mobile)
  inbound: ok / host: mobile (canary)
mobile: the reply names the host that ran it: True
mobile: worker ledger exists and is its own: True
Command sent: /location collab → ✅ Compute location set to: `collab` (canary armed)
Command sent: Reply with the single word: ok   (should run on collab)
  inbound: ok / host: collab (canary)
collab: the reply names the host that ran it: True
collab: worker ledger exists and is its own: True
Command sent: /location grok   → ✅ Compute location set to: `grok` (canary armed)
Command sent: Reply with the single word: ok   (should run on grok)
  inbound: ok / host: grok (canary)
grok: the reply names the host that ran it: True
grok: worker ledger exists and is its own: True
VM ledger mtime after: 2026-09-25 22:19:51.850415682 +0000
VM ledger mtime unchanged by remote turns: True
```

Commands reached the live bot through the real Telegram update path (user session,
`~/proto/tg-user-session/driver.py`), not through a test harness.

## What this run proves, and what it cannot

**Proves (mechanics, live):** all five locations accept `/location <host>` and run the
next turn; remote turns name the host that ran them (`host: <h> (canary)`); each
worker keeps its own ledger; the VM ledger does not move when a remote host runs.

**Does not prove (why the rows stay red):** `mobile`, `collab` and `grok` here are
VPS-local `worker-agent` processes, not the phone, the notebook, or the Grok box. QS-5
requires each host's *own* probe output — a probe run on this box would be exactly the
"inferred from another host" failure the row forbids — and QS-1 / QS-3 / QS-4 / QS-9
need those real devices connected with quota. QS-11 still needs a genuine mid-stream
quota death, which must never be manufactured.

## Proof-harness defects found and fixed (2026-09-26)

1. `_common.head_commit()` read `/home/ubuntu/bot-host` while the live service serves
   `/home/ubuntu/bot-host-r14`, so every evidence block named the wrong commit. It now
   derives the tree from `systemctl show bot-host@<id> -p WorkingDirectory`.
2. `proofs/locations.py` required the remote `host:` footer on the local hosts
   (`vps`, `vm2`), printing `False` for a correct local turn. Local hosts now assert
   that the turn completed instead.
3. `driver.py` could not run at all: system `python3.14` has no `pip` and no `telethon`.
   A venv at `~/proto/tg-user-session/.venv` now carries `telethon 1.45.0`.

## Live-stack defect found and fixed (2026-09-26 07:38Z)

**Dual poller.** Two `node src/index.js` router processes (started 2026-09-25 20:23
and 20:34 out of tmux) carried the *same* `TELEGRAM_BOT_TOKEN` — identical sha256 —
and both held a Telegram connection. The charter forbids dual-polling a token, and
duplicate `getUpdates` consumers race the update offset, which makes any live proof
unreliable. The 20:34 duplicate was stopped; pid 757798 remains the single poller.

## Gates on this branch (2026-09-26)

| gate | result |
|---|---|
| `check-capability-propagation.mjs` | 26 capabilities, 0 failures (QS-12) |
| `probe-free-lanes.mjs` (zero burn, vps host) | exit 0 |
| `assert-r16-failover.test.mjs` | 25/0 |
| `assert-freemodel-tiers.test.mjs` | 10/0 |
| `assert-cooldown-and-dead-ends.test.mjs` | 47/0 |
| `assert-one-allowance-model.test.mjs` | 125/0 |
| `assert-setup-gaps.test.mjs` | 63/0 |
| `assert-lane-contract.mjs` | 33/0 |
| `assert-model-failover.mjs` | 10/0 |
| `assert-worker-relay.test.mjs` | 32/0 |
| `assert-session-key.test.mjs` | 24/0 |
| `assert-work-session.mjs` | 50/0 |
| `assert-location-needs-a-worker.test.mjs` | 36/0 (2 stale regex literals retargeted to the `location`→`host` rename; pass meaning unchanged) |
| `assert-allowance-walk.test.mjs` | **38/1** — `an exhausted host is told nothing ran` (open on `agent/r14-card-1`, not this branch) |

## Score

**R-16 = RED**, same verdict as the canonical board: 5 green, 3 partial, 4 red. The
four red rows and the three partials each need a real device or a real quota event;
nothing on this box can turn them green without the charter's "no label-as-location"
and "never burn live quota to prove exhaustion" rules being broken.
