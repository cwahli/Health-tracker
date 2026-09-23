---
name: telegram-inbound-media
description: Use when the user uploads a photo, image, or document and expects the agent to see it. Downloads Telegram uploads into the workspace via the shared inbound-media lib so every bot class views uploads the same way.
---

# Telegram inbound media (viewing uploads)

One lib: `scripts/lib/inbound-media.mjs`. Never implement a second downloader —
import or mirror this one (see `plan/RELIABILITY.md` §14.7 Case C).

## bot-host (VPS / Mobile) — automatic

Uploads are downloaded to `.bot-media/<chatId>/` in the workspace and the file
path is attached to the agent prompt. Nothing to do in chat: when the user sends
a photo, reference the attached path in your answer. If no path arrived, say the
upload did not come through and ask them to resend — do not guess at contents.

## Hermes profiles

Ensure the profile uses the same download helper (or documents its equivalent
attachment injection). Same contract: absolute path in prompt, never a bare
`file_id`.

## Grok TG (provider-router)

**Import** `scripts/lib/inbound-media.mjs` into the router, *or* mirror files
into the box `inbox/photos/` directory for Read. Same contract as above.

## Collab

Usually N/A — Collab is commands (`/fix`, `/switch`, `/project`), not photo
workflows — unless a future `/vision` flag opts in.

## Smoke test (per class, after enabling)

Send a photo to the bot → its prompt/logs must contain the downloaded absolute
path. No path = not working, regardless of what the chat claims. Verification
rules live in the **`telegram-testing`** skill.
