# Privacy — agent Google Workspace store

**Canonical page:** [https://health-tracking.duckdns.org/privacy](https://health-tracking.duckdns.org/privacy) — served from the project's own domain, which is
what the Google OAuth consent screen links to. This file is the source of truth for
its content and edit history; the served page is generated from it.

## What this store is

A working folder in Google Drive, used by the agent fleet (the bots and worker agents
in this repository) to keep the artefacts they produce: turn logs, quota and
depletion events, model bakeoff results, generated weekly summaries, and evidence
captures from live tests.

## What it holds

- **Turn metadata** — date and time, chat and project identifier, which location ran
  the turn, which lane or model was used, and the outcome (ok, depleted, error class).
- **Short text summaries** of what a turn did, written by the agent.
- **Quota events and benchmark results** — provider usage state and model comparisons.
- **Evidence captures** from tests: timestamps, commands, API response identifiers,
  and the side effects observed.

## What it never holds

- **No credentials.** API keys, tokens and private keys live only in the host
  configuration directory and are never written to Drive, Sheets or Docs.
- **No photos, binaries or database dumps.** Those belong to the application's own
  storage (Cloudflare R2 and D1 — see `plan/DATA_PLANE.md`), not to this store.

## Who can read it

The store is owned by the single Google account that authorized the fleet. Anyone
with access to that account, and anyone that account owner shares the folder with,
can read it. The agents read and write it by acting as that account — there is no
separate agent identity and no other copy of the data.

## Retention

Append-only. Nothing is edited in place; corrections are new rows. Sheet tabs are
archived to Drive after 90 days. Files are never overwritten: a second write is a
second, separately named object.

## Contact

`cwah.liu@gmail.com` — the account owner. Raise questions or deletion requests here.

## Changes

This document lives in the repository, so its full edit history is public. Material
changes should be noted in the commit message.
