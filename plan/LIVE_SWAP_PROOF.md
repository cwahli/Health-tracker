# Live swap proof — deployed stack

Run against the services the box actually serves Telegram from (`bot-host@vm`,
`bot-host@vm2`, `worker-relay`, and the mobile/collab/grok worker stand-ins),
at commit `b1884b1`, relay `http://127.0.0.1:8890`. Re-run with:

    node scripts/live-swap-proof.mjs            # 3 real turns, spends quota
    node scripts/live-swap-proof.mjs --dry      # reachability + routing only

Three honest caveats:

- The workers are stand-ins on this VM, so "the pack landed" is proven by the
  real path — relay PUT, worker GET, `applyPack` into the worker's own
  workspace (`REPO_ROOT` there, not the VM's project checkout) — but the two
  directories share one disk. The transport is HTTP either way; a phone or a
  Colab runtime proves the same code across the network.
- The conversation id is identical across all three hops because each hand-off
  is a real export from the relay and import on the worker, not a shared file.
- This exercises the code the Telegram handlers call (`armRoute`,
  `runOnWorker`, `settleCanary`) — not the command parsing and message
  formatting themselves. Sending `/location` by hand in Telegram is the one
  layer left to a human pass.

| # | tick | result | detail |
|---|---|---|---|
| 0 | all three workers are connected | PASS | mobile, collab, grok |
| 10 | preflight cleared before the job existed on mobile | PASS | 11139ms |
| 20 | changed files applied on mobile | PASS | 1 file(s) |
| 25 | the pack landed in mobile's workspace | PASS | /home/ubuntu/bot-host/.live-proof-marker.txt |
| 30 | canary confirmed the route to mobile | PASS | jmuhnpwz84291 |
| 40 | ledger on mobile is its own | PASS | /home/ubuntu/.local/state/bot-host/worker-mobile/free-lanes |
| 50 | conversation id survives the hop to mobile | PASS | ses_f24ddc36cffeAr01SWbtmxwnIR |
| 11 | preflight cleared before the job existed on collab | PASS | 15301ms |
| 21 | changed files applied on collab | PASS | 1 file(s) |
| 26 | the pack landed in collab's workspace | PASS | /home/ubuntu/bot-host/.live-proof-marker.txt |
| 31 | canary confirmed the route to collab | PASS | jmuhnq78te393 |
| 41 | ledger on collab is its own | PASS | /home/ubuntu/.local/state/bot-host/worker-collab/free-lanes |
| 51 | conversation id survives the hop to collab | PASS | ses_f24ddc36cffeAr01SWbtmxwnIR |
| 12 | preflight cleared before the job existed on grok | PASS | 17457ms |
| 22 | changed files applied on grok | PASS | 1 file(s) |
| 27 | the pack landed in grok's workspace | PASS | /home/ubuntu/bot-host/.live-proof-marker.txt |
| 32 | canary confirmed the route to grok | PASS | jmuhnqj687b8d |
| 42 | ledger on grok is its own | PASS | /home/ubuntu/.local/state/bot-host/worker-grok/free-lanes |
| 52 | conversation id survives the hop to grok | PASS | ses_f24ddc36cffeAr01SWbtmxwnIR |
| 60 | one conversation across every host | PASS | 3/3 |
| 61 | the workspace marker was written | PASS | /home/ubuntu/src/Health-tracker/.live-proof-marker.txt |
| 62 | an injected wrong-ledger turn rolls the route back | PASS |  |
| 63 | the rolled-back host re-arms for the next attempt | PASS |  |

| host | ms | code | ledger | packApplied | reply |
|---|---|---|---|---|---|
| mobile | 11139 | 0 | /home/ubuntu/.local/state/bot-host/worker-mobile/free-lanes | 1 | ran on mobile |
| collab | 15301 | 0 | /home/ubuntu/.local/state/bot-host/worker-collab/free-lanes | 1 | ran on collab |
| grok | 17457 | 0 | /home/ubuntu/.local/state/bot-host/worker-grok/free-lanes | 1 | ran on grok |

## Telegram layer, with no human

The Bot API cannot fabricate an inbound message — `getUpdates` only ever
returns what a real client sent, and only one poller may hold them — so the
command side cannot come from Telegram itself. `--inject` feeds the dispatch
loop a synthetic message instead, and the replies go out through the real API.
Run as `node scripts/bot-host.mjs --id=vm --inject="/location mobile"`: it
neither polls nor takes the pid-held lease, so the live bot keeps serving.

| # | step | result | what landed in chat 6218257274 |
|---|---|---|---|
| 70 | `--inject=/status` | PASS | status card: model, agent, session, task |
| 71 | `--inject=/location mobile` | PASS | `✅ Compute location set to: mobile … its first turn is a canary (checked, then confirmed as active)` |
| 72 | `--inject=/location vps` | PASS | `✅ Compute location set to: vps … The next turn runs on vps` |
| 73 | the live poller was not disturbed | PASS | lease row still owned by the live pid — `renew`/`release` refuse any other pid |
| 74 | the live bot's own location is unchanged | PASS | `BOT_LOCATION` is unset in the running process → it is still on `vps`, which is what the last message says |

Env location is per-process, so an inject's `BOT_LOCATION` dies with it. The
pass therefore ends by setting `/location vps` again, which is where the live
bot already was — the chat's last word and the bot's real state agree.
