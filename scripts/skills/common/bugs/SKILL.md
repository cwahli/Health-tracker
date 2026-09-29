---
name: bugs
description: Open the shared bug board Mini App - the same live list the site shows.
version: 1.0.0
---

## When invoked

The user typed `/bugs` or asked for the board. Hand them the live board, not a prose list.

- If the platform supports reply buttons, attach a `web_app` button opening
  `<gateway>/bugs/?bot=bug_ticket` alongside a one-line caption, where
  `<gateway>` is the same host the vm bot's `/bugs` button uses. The gateway
  validates the opener's own Telegram initData (auto-matching any configured
  bot token), so no secret is needed in chat. If the button fails to render,
  report it once as a platform limitation and fall back to the pointer below.
- Never paste the board URL as a plain link: a plain browser open carries no
  initData and lands on a dead bootstrap page.
- If buttons are unavailable, or the gateway is not serving `/bugs`, end the
  answer with: `Ask the VM bot for /bugs — it serves the bug board button.`
  Never invent a gateway URL.
- Do not run `bugctl list` for `/bugs`: the board itself is live. Keep the
  reply to the caption plus the button or pointer.
