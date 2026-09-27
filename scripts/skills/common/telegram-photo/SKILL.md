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
For delivery **verification** (text, photo, HTML, Instant View claims) use the **`telegram-testing`** skill and `scripts/telegram-smoke-test.sh`.

## Minimal pattern

1. Produce or capture the file.
2. Verify it: `ls -la <path> && file <path>` (non-zero size).
3. Reply with the `MEDIA:` line alone, then any short explanation after it:

```
MEDIA:/abs/path/to/image.png
Here is the current meal screen.
```

Use absolute paths. Do not wrap the line in text or a code fence.

## Capturing a picture of the app

There are two different things you might be asked for. Do not confuse them.

**A picture the user took on their phone.** You cannot produce this — it already
exists, in the chat, as an inbound attachment saved under `.bot-media/<chatId>/`.
Use the path you were given. Never describe such an attachment as a "screenshot"
you captured, and never re-derive it by re-running a headless browser: that is a
different image of a different machine at a different viewport.

**A fresh render of the app.** The repo ships a Playwright journey runner:

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

Label this one honestly as a headless render at a fixed desktop viewport. It is a
simulation of the app, not the user's phone.

## Attaching a picture to a bug

If the picture is evidence for a bug, it belongs **on the card**, not only in the
chat. See the `bug-ticket` skill: `bugctl create --screenshot <abs path>`, then
confirm with `bugctl show --id <n> --json` that `reports[].shot_count` is not 0.

## Rules

- At most a few images per turn — Telegram rate-limits photos.
- If the bot replies "Could not send …", report the error instead of retrying.
