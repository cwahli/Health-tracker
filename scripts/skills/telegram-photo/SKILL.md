---
name: telegram-photo
description: Use when the user asks to see, send, share, or show a picture, image, screenshot, or photo in this Telegram chat. Captures live app screenshots and delivers files with the MEDIA: convention.
---

# Telegram photo / screenshot sharing

Deliver images and files to the **current Telegram chat** by putting a line
`MEDIA:<absolute-path>` on its own line in your final answer. The bot uploads
each path automatically (photos, video, audio, or documents by extension) and
strips the `MEDIA:` lines from the text.

See the shared **`telegram-media-delivery`** skill for the authoritative rules.

## Minimal pattern

1. Produce or capture the file.
2. Verify it: `ls -la <path> && file <path>` (non-zero size).
3. Reply with the `MEDIA:` line alone, then any short explanation after it:

```
MEDIA:/abs/path/to/image.png
Here is the current meal screen.
```

Use absolute paths. Do not wrap the line in text or a code fence.

## Capture a live app screenshot

The repo ships a Playwright journey runner:

```bash
node scripts/qa-runner.mjs --journey=meal
```

It writes full-page PNGs to `qa-evidence/` (e.g.
`qa-evidence/clean_meal_<ts>.png`). Then emit the newest one:

```
MEDIA:/home/ubuntu/src/Health-tracker/qa-evidence/clean_meal_<ts>.png
```

Journeys: `meal`, `biomarker`, `onboarding`; add `--url=<base>` to target a
specific host (defaults to the live app).

## Rules

- At most a few images per turn — Telegram rate-limits photos.
- If the bot replies "Could not send …", report the error instead of retrying.
