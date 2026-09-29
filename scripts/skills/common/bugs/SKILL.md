---
name: bugs
description: Open the shared bug board Mini App - the same live list the site shows.
version: 1.0.0
---

## When invoked

The user typed `/bugs` or asked for the board. Hand them the live board, not a prose list.

- Emit the board button as an own-line marker (the gateway converts it to a
  `web_app` button; the host comes from the gateway, never invent a URL):
  `MINIAPP: 🐛 Open bug board | /bugs/?bot=bug_ticket`
  alongside a one-line caption. The gateway validates the opener's own
  Telegram initData, so no secret is needed in chat.
- If no button renders, hand this deep link instead:
  `https://t.me/VM_19485_bot?start=bugs` — one tap opens the VM bot, one more
  tap on START serves the board button. Final fallback: `Ask the VM bot for
  /bugs — it serves the bug board button.`
- Never paste the board URL as a plain link: a plain browser open carries no
  initData and lands on a dead bootstrap page.
- If buttons are unavailable, or the gateway is not serving `/bugs`, end the
  answer with: `Ask the VM bot for /bugs — it serves the bug board button.`
  Never invent a gateway URL.
- Do not run `bugctl list` for `/bugs`: the board itself is live. Keep the
  reply to the caption plus the button or pointer.
