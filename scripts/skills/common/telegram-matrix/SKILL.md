---
name: telegram-matrix
description: Use when the user asks what bots can do, for the capability matrix/table, or to compare bot features. Renders the shared matrix from public/capability-matrix.html and delivers it with the MEDIA: convention.
---

# Telegram capability matrix

One source of truth: `public/capability-matrix.html` in the repo. Never hand-write
a competing table in chat — render and deliver this file so every bot class shows
the same matrix.

## Deliver it

1. Screenshot the page (headless, no app server needed — it is a static file):
   ```bash
   node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:700,height:900}});await p.goto('file://' + process.cwd() + '/public/capability-matrix.html');await p.screenshot({path:'/tmp/capability-matrix.png',fullPage:true});await b.close();})()"
   ```
2. Verify: `ls -la /tmp/capability-matrix.png && file /tmp/capability-matrix.png`.
3. Reply with the `MEDIA:` line alone, then one short line:
   ```
   MEDIA:/tmp/capability-matrix.png
   Current bot capabilities — same table on every bot.
   ```

Rules: absolute paths, `MEDIA:` line alone on its line. Full delivery rules live in
the **`telegram-photo`** skill; verification rules in **`telegram-testing`**.

## Per-class adapters

- **Hermes / VPS / Mobile:** PNG via `MEDIA:` as above.
- **Grok TG:** same PNG if the host can upload; otherwise link the live page.
- **Collab:** link-only reply is enough —
  `https://health-tracking.duckdns.org/capability-matrix` — do not burn GPU
  units screenshotting a static page.

## Updating the matrix

Edit `public/capability-matrix.html` on `main`, then follow the distribute matrix
in `plan/RELIABILITY.md` §14.7 (Case D). One file, all bots.
