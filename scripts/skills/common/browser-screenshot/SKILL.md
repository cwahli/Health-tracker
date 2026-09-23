---
name: browser-screenshot
description: Use when the user asks to browse a web page, open a URL, look something up online, or send a screenshot of a website. Drives the Playwright MCP browser and shares images with MEDIA:.
---

# Browse the web and share screenshots

A Playwright MCP server named `playwright` is available. Use its tools.

## Tools

- `browser_navigate` — open a URL.
- `browser_snapshot` — accessibility tree of the page. Use this to read or
  reason about content; it is far cheaper than a screenshot.
- `browser_take_screenshot` — capture the page. **Omit `filename`** so the file
  is written to the output dir and the tool result returns its absolute path.
- `browser_click`, `browser_type`, `browser_press_key`, `browser_wait_for`,
  `browser_evaluate` — interact with the page.

## Share what you captured

Put the returned screenshot path on its own `MEDIA:` line (see the
`telegram-media-delivery` skill):

```
MEDIA:/tmp/bot-host-shots/page-<timestamp>.png
Here is example.com.
```

## Notes

- The browser is headless and isolated per session.
- Do **not** pass `filename` to `browser_take_screenshot`: an explicit name is
  resolved against the server's working directory, not the output dir.
- For the app's own journeys (meal / biomarker / onboarding) prefer
  `node scripts/qa-runner.mjs --journey=meal`.
