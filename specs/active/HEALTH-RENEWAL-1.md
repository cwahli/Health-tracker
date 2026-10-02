---
id: HEALTH-RENEWAL-1
status: locked
class: RENEWAL_SCHEDULE
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/health-renewal.mjs
  - scripts/assert-health-renewal.test.mjs
  - systemd/health-renewal@.service
  - systemd/health-renewal@.timer
  - specs/active/HEALTH-RENEWAL-1.md
frozen_files:
  - scripts/health-runner.mjs
  - scripts/lib/health/docs.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/assert-external-health.test.mjs
  - scripts/lib/commands.mjs
  - bots/registry.json
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-health-renewal.test.mjs
  - node scripts/assert-external-health.test.mjs
  - npx vitest run tests/bot-host.test.ts
  - npm run test:prepush
  - node scripts/assert-spec-diff.mjs HEALTH-RENEWAL-1
---

# HEALTH-RENEWAL-1 — the charter's monthly renewal runs on a schedule

## Goal

The charter promises the four living documents renew on a monthly cadence, and
nothing in the repo scheduled that: they only ever refreshed when someone asked
in Telegram. This drop adds the smallest thing that makes the promise true — a
runner that decides whether a renewal is due and, when it is, calls the **one**
refresh path that already exists (`runHealthRefresh`), plus a systemd oneshot +
timer following the repo's unit pattern (`systemd/pm-sweep@.service` /
`systemd/tui-ttyd-vm.service`).

## What changes

- **`scripts/health-renewal.mjs`** (new) — `renewalDecision()` is pure: a
  renewal is due when the verify snapshot is **inside the publisher's own
  renewal window** (`STALE_AFTER_DAYS`, 31) **and** the last refresh receipt did
  not already publish it (`receipt.verify.at >= artifact.at` ⇒ not due; a dry
  run's receipt is not evidence). A snapshot past the window is never
  republished — republishing it would stamp documents whose analysis is withheld
  — and the skip names `/health verify`, the user's gate. When due,
  `runHealthRenewal()` calls `runHealthRefresh`, which verifies first, publishes
  in place by doc id, and writes the usual receipt (`result/health-refresh.json`
  + `result/health-refresh.md`). The runner adds no publisher, no writer and no
  artifact of its own. CLI: `--workspace=`, `--project=`, `--env-file=`,
  `--json`; exit 0 renewed-or-skipped, 3 refused (the repo's "refused on
  purpose" code), 1 threw.
- **`systemd/health-renewal@.service`** (new) — `Type=oneshot`, `User=ubuntu`,
  `WorkingDirectory=/home/ubuntu/deploy/Health-tracker`, the same
  `EnvironmentFile=` pair every bot unit uses, and
  `Environment=HEALTH_ENV_FILE=/home/ubuntu/deploy/Health-tracker/.env` so the
  read-only D1 snapshot resolves — the same path `/health readiness` names for
  `/health verify`. `NoNewPrivileges=true`.
- **`systemd/health-renewal@.timer`** (new) — `OnCalendar=monthly`,
  `Persistent=true`, `Unit=health-renewal@%i.service`,
  `WantedBy=timers.target`. A fire missed while the box was down happens once at
  the next boot; an early fire is a no-op because the runner decides.
- **`scripts/assert-health-renewal.test.mjs`** (new) — drives the runner with
  the **real** publisher and only the network seams injected (fixture D1 fetch,
  fake store, real templates), so "refreshes exactly once" is judged on the
  store calls the publisher actually made.

## Findings (the decisions worth not re-deriving)

- **The runner must not be a second publisher.** `health-runner.mjs` owns
  verify→plan→publish, idempotence by doc id, the gate/doctor/citation rules and
  the receipt. The renewal is a *schedule*, not a pipeline, so it reuses that
  path whole — and the sensor pins that it imports no publisher internals.
- **"Refresh only when the snapshot sits inside the renewal window" cannot be
  read as "run the refresh while stale".** A stale snapshot's refresh stamps
  documents whose analysis is withheld by the staleness rule; the honest fix is
  `/health verify`, which no timer can run for the user (the gate is theirs).
  So outside the window the runner does nothing and says why. The monthly
  cadence falls out of the same rule: verify moves the snapshot, each current
  snapshot is published once.
- **"Idempotent so a no-change run writes nothing" has two layers, and the
  no-change case is the *snapshot*, not the bytes.** The runner's own no-change
  case (snapshot already published) must write nothing at all — no document, no
  receipt — because a timer that rewrites the receipt every quiet day churns
  the workspace. The publisher's byte-level idempotence (four skips ⇒ no Drive
  write) is kept as the second layer and proved through the runner by removing
  the receipt and forcing a same-day refresh: the store sees zero writes.
- **A no-change run must not even reach Drive for a decision it cannot change.**
  The runner's skip returns before the publisher runs, so the quiet day makes no
  network call at all; the sensor proves it by counting the injected refresh.
- **The install is a host step, and it is documented, not faked.** `ubuntu` is
  in neither `sudo` nor `empower`, and `systemctl restart` is polkit-denied
  (measured 2026-10-02), so the units land in `systemd/` with the install
  command recorded below; the user installs them. Linger is already on and
  `pm-sweep@vm.timer` runs as a **user** unit — the same shape works here.
- **#455 owns the health runner's siblings.** `scripts/health-runner.mjs`,
  `scripts/lib/health/docs.mjs`, `scripts/lib/health/sheet.mjs` and
  `scripts/assert-external-health.test.mjs` are in the stalled PR #455's
  changed-file set (claim-guard: one file, one owner), so this packet reads
  them and changes none; the renewal sensor is a new file, which is why it is
  its own sensor rather than a section appended to the health sensor.

## Evidence (measured on this box, 2026-10-02)

- `node scripts/assert-health-renewal.test.mjs` → **46 pass, 0 fail**.
  Covers: the pure decision (unpublished-current due; published not due; newer
  than receipt due; dry-run receipt not evidence; the 31-day boundary inside and
  one day past outside; no snapshot names `/health verify`); inside the window
  one renewal, the publisher called exactly once, four creates, the receipt
  pinned to the snapshot and `dryRun: false`, the human log beside it; the
  second run a skip with the publisher not called again and the `result/` tree
  byte-identical; the forced same-day refresh writing no document (four skips);
  outside the window the publisher never called and nothing written; a refused
  publisher reported with its stage and nothing written; the CLI exit 3 with
  `verify/config`, nothing written; and the units' wiring (oneshot, env files,
  `HEALTH_ENV_FILE`, `NoNewPrivileges`, monthly, persistent, activates the
  service, documents the packet).
- **Red twice, each restored to 46/0**: the runner's skip returned *after*
  calling the publisher (a quiet day then makes a call, and a stale snapshot
  renews) → **4 FAIL**; the staleness branch removed so a stale snapshot is
  renewed → **5 FAIL**.
- Gates: `assert-external-health` **690/0** (untouched, re-run as the frozen
  neighbour), `vitest run tests/bot-host.test.ts` 162/162, `npm run
  test:prepush` exit 0, `assert-spec-diff HEALTH-RENEWAL-1` pass, identity and
  no-undo clean.
- Not live: no renewal was run against the real workspace (the user's folder is
  read-only to this pass), and the timer is not installed — `ubuntu` cannot
  install units without a privilege path (see Findings).

## Install (the host step, exact)

```bash
# as the user who owns the units (ubuntu), on the box:
cp /home/ubuntu/deploy/Health-tracker/systemd/health-renewal@.service \
   /home/ubuntu/deploy/Health-tracker/systemd/health-renewal@.timer \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now health-renewal@vm.timer
systemctl --user list-timers health-renewal@vm.timer
# prove one fire by hand (writes only when a current snapshot is unpublished):
systemctl --user start health-renewal@vm.service
journalctl --user -u health-renewal@vm.service -n 40
```

A system-wide install (`/etc/systemd/system/` + `systemctl enable --now`) is
equivalent and needs root; the user-unit shape matches the existing
`pm-sweep@vm.timer`, which is the pattern this box already runs.

## Left

- **Install the timer** (the command above) — the only unexercised half; the
  units are landed and their wiring pinned, but nothing is scheduled until the
  install runs.
- **The first real renewal** happens when the user runs `/health verify` after
  the install: the next timer fire (or the manual `start`) publishes the new
  snapshot once and writes the receipt.
- **Mission item 6** (the live re-ask in the room) and everything outside the
  plan — the TUI deploy, the H-1…H-8 gate items — stay untouched.

Next: specs/active/HEALTH-RENEWAL-1.md#left
