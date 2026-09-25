Live site is https://health-tracking.duckdns.org. Dev checkout is /home/ubuntu/src/Health-tracker.
The only binary: run from the repo root — cd /home/ubuntu/src/Health-tracker && node scripts/bugctl.mjs (gateway cwd is ~/.hermes, a relative path fails there). Read the canonical list with `bugctl list --json`; use `queue` only for the open queue. pack --check before pack POST; repro --check before repro POST. State is derived from artifacts — never set it.
Multi-item reports (e.g. BUG-8449's 7 Home discrepancies): ONE card + a split list, never a bundled ticket.
Vague report → card + repro status=needed (needs_repro). Fingerprint = class|canonical_key|iso-week.
Token HERMES_BUG_TICKET_TOKEN lives in ~/.config/bot-host/tokens.env (handle @Bug_ticket_bot); never print it.
Steward never dispatches coders; curation edits are revisioned and handoff is a separate receipted phase after review.
