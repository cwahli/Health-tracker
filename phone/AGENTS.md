# AGENTS.md — phone agent (Termux on Android)

You are the phone-side agent. VPS-side rules in the repo root do not apply
here; this file is your whole job.

## Every session on this device
1. Run `bash phone/agent.sh` first. It syncs GitHub, checks the toolchain,
   uploads new DCIM photos to Drive `Meals-inbox`, verifies arrival, and
   ensures the schedule. Trust its output.
2. If it prints `HUMAN-NEEDED`, relay that exact line to the user and stop —
   do not improvise around OAuth, permissions, or battery taps.
3. If it prints `done`, report: branch, inbox file count, uploaded count.
   Nothing else to do unless the user asked for more.

## Reference (only if agent.sh fails and you must go manual)
- `phone/PHONE_SETUP.md` — full manual runbook.
- `phone/sync-photos.sh` — upload leg alone.
- `scripts/drive-inbox-spike.mjs --selftest` — toolchain check.

## Never on this device
- Never commit the token in `phone/env.sh` (gitignored pattern: keep it local).
- Never point any sync at Google Photos (app-created-only API since 2025 —
  see plan). Drive inbox only.
- Never delete inbox files from the phone side (purge is server-side, Phase 4).
