---
slug: allowance-hold-without-evidence-20261007
date: 2026-10-07
class: PROCESS_GAP
node: Builder
status: draft
---

# Learning: a lane hold must carry the evidence that created it, and expire with it

## What happened
- The user could not see Muse from Cline for **eleven days**, while Cline's own catalog listed `muse-spark-1.3-contributor` as free. The lane carried a real 429 whose own reset was `2026-09-26T11:59:11Z`; the row read ❌ the whole time and `/freemodel` never offered it.
- Root cause A, in `tools/telegram-provider-router/bin/ht-allowance-watch`: the **uncertain** branch (hang / timeout / no key / unreachable) re-stamped the lane depleted on the default TTL — "still limited" as an assumption. The sweep only ever probes lanes that are already dark, so each uncertain probe reset the clock on a lane whose darkness had already expired: **27 re-stamps in one day, ~46 minutes apart**, off one eleven-day-dead 429. Evidence is the ping record's own outcome strings, `uncertain → default TTL`.
- Root cause B, and why every probe was uncertain: the probe shelled out to a bare `cline` from a unit whose PATH has no `~/.npm-global/bin`, where the CLI actually is (`/home/ubuntu/.npm-global/bin/cline`, 3.0.69). The bot's own `resolveClineBin()` used absolute candidates, so `/freemodel` reported Cline ready while the watcher reported it not installed — two readers of one host disagreeing, each consistent with its own evidence.
- Why nothing caught it: no gate read the **installed** unit, so the daemon that stamped the ledger was a hand-installed file with no copy in the repo, and no sensor pinned the no-write rule on an uncertain probe — the two defects were invisible to every check that existed.

## What the user asked
"I still don't see Muse on Cline" — then: make the fix persistent and implemented in the repo, not hand-patched on the VM.

## Keep
- **Uncertain is not evidence of a limit.** The lane keeps whatever it had, `uncertainProbes` counts the probe, and the message says so (`uncertain → ledger left alone (…)`).
- A hold names the evidence that created it and expires with it; the sweep line prints `due / depleted / probed / flips / re-stamps / uncertain`, so a self-renewing hold is visible in one line.
- The probe resolves the CLI the way the bot does (`resolveCliBin`, absolute candidates), never off the unit's PATH.

## Propose standing (add only)
```json
{
  "id": "allowance_hold_needs_evidence",
  "label": "A lane hold carries the evidence that created it and expires with it; an uncertain probe writes nothing",
  "asked": "repeated",
  "files_must_contain": {
    "tools/telegram-provider-router/bin/ht-allowance-watch": ["uncertainProbes", "ledger left alone"],
    "tools/telegram-provider-router/src/allowance-watch-core.cjs": ["resolveCliBin"]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: any timer or TTL that re-stamps state must name the evidence in the packet; "as a precaution" is not a reason to extend a hold.
- builder: a probe that cannot reach its tool reports *uncertain* and writes nothing; resolve the tool by absolute candidate, never the unit's PATH.
- guard: fail a sweep whose uncertain count is non-zero alongside re-stamps, and assert the no-write branch by name.

## Do not
- Delete standing rows
- Merge journey packs
- Edit Guard scripts in this file's promote
