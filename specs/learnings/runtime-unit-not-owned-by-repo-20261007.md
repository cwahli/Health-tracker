---
slug: runtime-unit-not-owned-by-repo-20261007
date: 2026-10-07
class: PROCESS_GAP
node: human
status: draft
---

# Learning: what runs in production must be the copy in the repo, and a checker must prove it

## What happened
- `ht-allowance-watch` ran for eleven days from `/etc/systemd/system/ht-allowance-watch.service` — **658 bytes, dated Sep 26, with no copy in the repo** — while the repo already owned `systemd/bot-host@.service` for the bots. Two of the four facts needed to debug the lane (the unit, and the PATH the daemon ran with) lived only on the box.
- The first repair attempt was invisible for the same reason: it hand-patched the file on the host. Nothing recorded it, nothing could re-apply it, and "nothing was left half-applied" is only knowable by reading the box, not the repo.
- The repair that landed: the unit is committed at `systemd/ht-allowance-watch.service` (ExecStart pointing at the deploy clone), and `tools/telegram-provider-router/scripts/assert-allowance-watch-deployed.mjs` reads the **installed** unit, its ExecStart, wrapper+core sha256, deploy HEAD, sweeps and session ledger. Live: installed unit sha256 `b523a9579bdb9691162679ac6afe5de88a8d9fb1f804dc60b43254fa9d2167b7` equals `origin/main`'s copy (preflight MATCH), MainPID 282577, sweeps `0 due / 0 depleted / 17 lanes — probed 0, flips 0, re-stamps 0, uncertain 0` — the checker reads **7 pass / 0 fail, exit 0**.
- It exits `3` for "no route to the box" so it can never pass by skipping, and its `--self-test` (8/8, offline) runs in the router chain beside `npm run verify:deployed`.

## What the user asked
Make the fix persistent and implemented in the repo, not hand-patched on the VM.

## Keep
- A unit that runs in production lives in `systemd/` in the repo; the box's copy is *installed from* it, never authored on it.
- The deployed-vs-repo checker compares unit bytes, ExecStart, wrapper+core hashes and deploy HEAD, and fails closed — including the distinct "no route" exit — rather than skipping.
- `npm run verify:deployed` (router suite) runs it; its offline `--self-test` runs in the gate chain.

## Propose standing (add only)
```json
{
  "id": "runtime_unit_is_versioned_and_checked",
  "label": "A systemd unit running on the box is the copy in git, and a deployed-vs-repo checker proves it",
  "asked": "repeated",
  "files_must_contain": {
    "systemd/ht-allowance-watch.service": ["/home/ubuntu/deploy/Health-tracker/tools/telegram-provider-router/bin/ht-allowance-watch --daemon"],
    "tools/telegram-provider-router/scripts/assert-allowance-watch-deployed.mjs": ["DEPLOY_CLONE", "undeployed"],
    "tools/telegram-provider-router/package.json": ["verify:deployed"]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: a packet touching a runtime service names the unit file in the repo and the checker that reads the installed copy.
- builder: never fix a host by hand — land the file in the repo, install from it, then prove it with the checker; a hand-edit is a rollback, not a deliverable.
- guard: a service change with no committed unit or no deployed-vs-repo checker is incomplete, not cosmetic.

## Do not
- Delete standing rows
- Merge journey packs
- Edit Guard scripts in this file's promote
