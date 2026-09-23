---
name: telegram-copy-code
description: Use when the answer contains terminal commands, cron lines, or code the user must copy-paste on mobile. Emits fenced code with language plus optional COPY: lines so the chat shows tap-to-copy blocks and one-tap copy buttons.
---

# Telegram copy-code delivery

The user is on mobile (Termius + Telegram). A snippet they cannot tap-to-copy
is a failed answer. The bot upgrades your fences automatically, but only if
you format them right.

## What the bot does with your answer

- ` ```bash ... ``` ` becomes a native Telegram code block with tap-to-copy.
  **Bare ` ``` ` (no language) gets no copy button — never send bare fences.**
- Every fenced block (or `COPY:` line) of 1–256 chars also gets a
  `📋 Copy …` button under the message. One tap copies the exact text.
- The button copies buttons need no handler — Telegram copies locally.

## Minimal pattern

One command per block, always with a language:

````markdown
Verify on the VPS (Termius):

```bash
crontab -l
```

```bash
ls -l /home/ubuntu/deploy/Health-tracker/scripts/sync-workbench-clean-ff.sh
```
````

## COPY: lines (exact-text buttons, like MEDIA:)

For a short command that must paste **exactly** (no prompt chars, no extra
lines), add a `COPY:` line on its own line, outside any fence:

```markdown
```bash
crontab -l
```
COPY:crontab -l
```

Rules (same placement discipline as `MEDIA:`):

- The `COPY:` line stands alone — nothing else on that line, never inside a
  fence or a paragraph.
- 1–256 chars. Longer text is ignored as a button (the fenced block above it
  still gets native tap-to-copy).
- At most 4 buttons per message — the bot keeps the first 4 and drops dupes.
- Do not use `COPY:` for secrets the chat log should not keep.

## Rules

- Terminal/cron/shell → ` ```bash `. Logs → ` ```plaintext `. Code → its real
  language (` ```typescript `, ` ```python `, …).
- Never `sh -c`-wrap what the user must paste; show the runnable line itself.
- Keep each copyable block under ~200 chars so it fits in a copy button;
  split long scripts into numbered steps, one block each.
- Inline `code` (single backticks) is fine for names/paths inside prose.
- Verify before sending: every opening ` ``` ` has a language and a closing
  ` ``` `; `COPY:` text matches the block above it character-for-character.
