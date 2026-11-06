# VPS retirement record — vps-france → the current VM

**Updated:** 2026-10-18

The OVH box that hosted production until October 2026 is retired. This file is
the short record of what moved, what was cleaned up, and what is still owed by
a human. The domain detail lives in [DOMAINS.md](./DOMAINS.md) and the cutover
ledger in [COUK_MIGRATION.md](./COUK_MIGRATION.md).

---

## 1. Before and after

| | Before | After |
|---|---|---|
| Host | OVH VPS `51.254.217.163`, "vps-france", host `vps-0a61fae6` | `standar-c3r3a-1845`, public IP `103.147.32.117` |
| Publish path | Caddy on the box, Let's Encrypt, public A records | Cloudflare Tunnel `85b56df3-da06-4521-9b4d-d90c593e3846` → `127.0.0.1:80` |
| TLS | Caddy / Let's Encrypt | Cloudflare edge; origin Caddy serves plain HTTP on `:80` |
| Canonical names | `health-tracker.co.uk` + `health-tracking.duckdns.org` twins | `health-tracker.co.uk` + `*.health-tracker.co.uk` |
| SSH from outside | `ubuntu@51.254.217.163` | see `docs/agent/WORKTREES.md` (the provider maps its own port; check it, do not assume `:22`) |

Because the tunnel is the only ingress, origin access logs show `127.0.0.1` for
every request. Client IPs now only exist at the Cloudflare edge, so the old
"soak the duckdns blocks until the log goes quiet" method cannot be repeated
here — the blocks are gone with the host.

## 2. Machine identity

`~/.agents/location` on this box is `vps-id` (it was `vps-france`). The old name
still matches as an alias in `scripts/lib/fleet-status.mjs`
(`LOCATION_OWNER_KEYS` / `matchesLocation`) and in `scripts/startup-card.mjs`,
so tickets written `@ vps-france` keep landing on the VM pane. `~/.agents/
registry.json` registers `vps-id` as a location, and the nudge inbox is
`~/.agents/nudges/inbox-vps-id.md` — the sweeps read the file name from
`~/.agents/location`, so a rename here without the file rename silently files
proposals where no agent reads them.

## 3. Migration snapshots — archived, branches deleted

The re-home moved each box's working tree by committing it as
`migrate: fr snapshot` and pushing a `migrate-<box>-fr-20261017` branch. Those
branches were transport, not feature work, and are gone. The tips are kept as
annotated tags so nothing is unreachable:

| Branch (deleted 2026-10-18) | Tip | Archive tag |
|---|---|---|
| `migrate-src-fr-20261017` | `ee539999` | `archive/migrate-fr-20261017-src` |
| `migrate-bothost-fr-20261017` | `32471363` | `archive/migrate-fr-20261017-bothost` |
| `migrate-deploy-fr-20261017` | `d219fce1` | `archive/migrate-fr-20261017-deploy` |

Notes for whoever goes looking:

- `migrate-deploy-fr-20261017` had **zero** commits that were not already on
  `main` — its tip is an ancestor of `main`.
- The other two carry one `fr snapshot` commit each, plus (for `src`) the
  i18n-wave work that also lives on the open PR branch
  `agent/meal-qa-queue`. That wave was **not** the road `main` took: `main`
  split the dictionary into per-language packs (`refactor(q-11.8)`,
  `feat(l10n): fill fr + zh packs`). The snapshot's translation entries are
  therefore superseded, not pending.
- `migrate-fr-20261017` in the `tax` and `tgtg-audit` checkouts was the same
  mechanism for the two projects that had no remote yet. `tax` is now
  `cwahli/chiwah-tax` (private) with `main` at the snapshot tip; `tgtg-audit`
  points at its GitHub remote again and its default branch is `main`.

## 4. Silent breakages repaired in the same pass

1. **Root-owned `.git` metadata.** `/home/ubuntu/src-ht/.git` and
   `/home/ubuntu/tgtg-audit/.git/index` had root-owned entries
   (`FETCH_HEAD`, `index`, `refs/remotes/**`, `logs/**`), which made every
   `git fetch` fail and made the 5-minute workbench cron log
   `SKIP /home/ubuntu/src/Health-tracker: fetch failed (offline?)`. Fixed with
   `chown -R ubuntu:ubuntu`.
2. **Single-branch fetch refspecs.** `/home/ubuntu/src-ht` and
   `/home/ubuntu/bot-host` were cloned with
   `+refs/heads/migrate-<box>-fr-20261017:refs/remotes/origin/...` as the only
   `remote.origin.fetch`. With those branches deleted, `git fetch` would have
   pulled **nothing**, silently. Both now use the standard
   `+refs/heads/*:refs/remotes/origin/*`.
3. **Google API gems landed in the wrong Ruby.** Ruby on the box is 3.3.8
   (gem home `/var/lib/gems/3.3.0`) but the Google gems were provisioned under
   `/var/lib/gems/3.2.0`, so `require 'google/apis/sheets_v4'` failed for every
   consumer: all five `do-github-sync` sweeps (`sweep_stale`, `watch_activity`,
   `proof_linker`, `pending_sweep`, `session_link`) exited through
   `ruby_boot`, and `~/bin/pull_drive_shot.rb` died on `google/apis/drive_v3`
   every 2 minutes. The box could not file a ticket into
   `~/.agents/nudges/inbox-vps-id.md` and could not see screenshots dropped in
   Drive. Fixed by installing, into 3.3, the same versions the 3.2 tree
   carried — `google-apis-sheets_v4 0.49.0`, `google-apis-drive_v3 0.88.0`,
   `googleauth 1.17.5` — after which all five sweeps and the mirror run.
4. **A missing log directory.** `/tmp/opencode/sweep/` did not exist and the
   four sweep cron lines append into it, so the shell failed before the script
   ran. Recreated.

## 5. Still owed

- **Human, DNS:** delete the `health-tracking.duckdns.org` A record at the
  DuckDNS dashboard. Checked 2026-10-29: it still resolves to the dead OVH IP
  and times out. This host has no DuckDNS token, so the record was not deleted.
- **Console, 2026-10-29:** `/privacy` and `/terms` were 404 because
  `/srv/www-legal` was empty. The pages from `/home/ubuntu/www-legal` were
  installed and both return 200. Supabase, Firebase, and Health Connect
  dashboards were not opened. The Firefox/Safari gateway login pass is still
  a phone check.
- **Serving trees on migration branches.** `/home/ubuntu/bot-host` (the live
  `tui-gateway` tree) and `/home/ubuntu/tgtg-audit` (the live `tgtg-audit`
  service) still sit on their `migrate-*` branches, and the bot-host tree
  carries main's gateway files **uncommitted** as a serving-tree patch. Each
  should be reconciled onto `main` deliberately — they are live, so this is a
  production change, not a cleanup.
- **Firebase authorised domain:** if `/app/login`'s Google popup reports
  `unauthorized-domain`, add `app.health-tracker.co.uk` in the Firebase console
  for project `health-tracker-b04dd`.
- **Unrelated, observed while auditing this box:** `~/flight-loop.log` reports
  `colab down/stalled (hb s, last report 0B)` on the 07/27/47 run, last line
  2026-10-18 09:47. Nothing in the re-home touches it; it wants its own ticket.
