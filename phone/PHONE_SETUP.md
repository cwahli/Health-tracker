# Phone-side setup: Drive upload leg run by mobile opencode (no manual work except 3 taps)

Goal: the phone itself uploads DCIM to Drive `Meals-inbox` on schedule, using
only tools the mobile agent can drive from this repo. Replaces the FolderSync
install path (P4 automation becomes first-class here).

## Human taps (unavoidable, ~10 min total — everything else is agent-run)
1. Install Termux + Termux:API (+ Termux:Boot for schedule persistence).
2. One `rclone config` OAuth consent in the browser (Google requires the
   account holder to click consent — no API bypasses this).
3. Battery exemption taps for Termux + allow Files/media permission when
   `termux-setup-storage` prompts.

## Agent runbook (mobile opencode executes top to bottom)
```bash
# 0. Sync this repo on the phone (PR branch until merged to main)
git clone -b agent/snap-drive https://github.com/cwahli/Health-tracker.git tracker
cd tracker

# 1. Toolchain (Termux)
pkg update -y && pkg install -y git nodejs rclone termux-api cronie
node scripts/drive-inbox-spike.mjs --selftest   # must print PASS

# 2. Storage permission (prompts the human tap from step 3 above, once)
termux-setup-storage

# 3. Rclone remote (the ONE OAuth consent; human clicks Allow in browser)
rclone config   # New remote > name: gdrive > Storage: drive > client_id/secret: blank
                # scope: 1 (full) > root_folder_id: blank > service_account: no
                # Use auto config: Yes > copy the gdrive token into Termux

# 4. Configure (copy and keep local, never commit)
cp phone/env.example phone/env.sh   # edit GDRIVE_REMOTE/GDRIVE_INBOX if needed
source phone/env.sh

# 5. Test upload: take 2 photos with the stock camera, then
bash phone/sync-photos.sh
rclone lsf gdrive:Meals-inbox | tail -n 5   # both new files must list

# 6. Schedule (every 2 h; persists across reboots via Termux:Boot)
(crontab -l 2>/dev/null; echo "17 */2 * * * cd $PWD && bash phone/sync-photos.sh >> \$HOME/drive-sync.log 2>&1") | crontab -
termux-boot-startup 2>/dev/null || true
```

## How it maps to the plan
- Upload leg: this runbook (phone-side, rclone, idempotent via
  `--ignore-existing`). No FolderSync, no per-photo taps.
- Poll + dedupe + triage-manifest: `scripts/drive-inbox-spike.mjs` (VPS or
  phone with node; needs a Drive token — VPS uses the app OAuth client from
  Phase 2, phone reuses the rclone token only for upload).
- Analyze + save: Phase 3 locked packet (unchanged).

## Troubleshooting (agent-readable)
- `rclone lsf` empty after sync: remote misnamed — `rclone listremotes`.
- Sync never fires on schedule: battery exemption missing (human tap) or
  cronie not running — `pgrep crond || crond`.
- `permission denied` on DCIM: re-run `termux-setup-storage`, accept the tap.
- Over-quota: sync errors grow the log — stop rule is 2 GB free (Phase 0).
