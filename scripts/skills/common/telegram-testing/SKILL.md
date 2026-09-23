---
name: telegram-testing
description: Use when testing, verifying, or debugging Telegram delivery (text, Markdown, photos, files/HTML, links, Instant View, server routes, MEDIA:, telegram-send.sh). Gives the correct pass/fail checks so claims are grounded in curl/API evidence, not guesses.
---

# Telegram testing (correct pass/fail)

Goal: never say “sent / works / Instant View works” without a command that proves it.

## Capability matrix (pick the right channel)

| User goal | Correct path | Not this |
|-----------|--------------|----------|
| Short reply / bold/italic | `telegram-send.sh --text=` (hardcodes `parse_mode=Markdown`) | HTML tags (not supported by script) |
| Table in chat (quick) | Code fence / monospace in `--text`, or PNG via `MEDIA:` | Raw `\| a \| b \|` pipes (render as junk) |
| Table as file | Write HTML/CSV → `MEDIA:/abs/path.ext` | Expect Telegram to render `.html` in-app |
| Screenshot / image | `MEDIA:/abs/path.png` or `--photo=` | Text description of UI |
| Long article + tables in TG reader | Public HTTPS URL + Instant View template (or Telegraph) | `localhost` URL; raw `.html` upload |
| Interactive HTML in TG | Mini App button | Static file download |
| Native bot tables (Bot API 10.1+) | `sendRichMessage` (not in `telegram-send.sh` yet) | Assuming script supports it |

`telegram-send.sh` flags only: `--text`, `--photo`, `--caption`, `--action`, `--thread-id`, `--chat-id`, `--profile`, `--token`. No `--parse-mode`. No `sendRichMessage`.

## 1. Text / Markdown send test

```bash
bash /home/ubuntu/bot-host/scripts/telegram-send.sh \
  --profile="${PROFILE:-orchestrator}" \
  --text="TG-TEST markdown *bold* \`code\` $(date -u +%H:%M:%SZ)"
```

**PASS:** exit 0 and stdout contains `Message delivered`  
**FAIL:** stderr `can't parse entities` (script should retry plain) or `ERROR: Failed`  
If plain fallback runs, Markdown path is broken — do not claim Markdown works.

Avoid bare `_`, unmatched `*`, raw URLs with `_` in test strings unless intentional.

## 2. Photo test

```bash
# use a real non-empty PNG
ls -la /path/to.png && file /path/to.png
bash .../telegram-send.sh --profile=... --photo=/path/to.png --caption="TG-TEST photo"
```

**PASS:** `Photo delivered:`  
**FAIL:** `Photo file not found` or API error JSON.

## 3. File / HTML attach test (`MEDIA:`)

In the **final agent reply** (bot extracts lines):

```
MEDIA:/absolute/path/to/report.html
Optional one-line note.
```

Or direct API via bot path (bot-host `TelegramApi.sendMediaFile`): extension decides method — `.png/.jpg` → photo, else **document**.

Verify file first:

```bash
test -s /absolute/path/to/report.html && file /absolute/path/to/report.html
```

**PASS (delivery):** bot uploads; user sees a document bubble.  
**PASS (open outside TG):** user downloads and opens in browser — you cannot automate that; say so.  
**FAIL:** path not absolute, file missing, or `MEDIA:` wrapped in a code fence / not on its own line.

**Telegram does not render `.html` as a page in-app.** Do not claim Instant View from a document upload.

## 4. Public URL / Instant View test (only if that is the goal)

```bash
# 1) Body must be YOUR content, not the SPA shell
curl -sS https://health-tracking.duckdns.org/nutrient-table | head -c 200
# PASS if unique marker e.g. "Baked Salmon" or <title> you set
# FAIL if <title>Biomarker and Nutrient Tracker</title> (SPA catch-all won)

# 2) Distinguish SPA vs asset
curl -sS -o /dev/null -w "%{http_code}\n" https://health-tracking.duckdns.org/nutrient-table
# 200 alone is NOT a pass — always grep a unique string from your page

# 3) Instant View only if:
#    - HTTPS public URL (never 127.0.0.1 / localhost from a phone)
#    - IV template for that domain OR t.me/iv?url=...&rhash=...
#    Otherwise: ordinary link preview / browser open only
```

**Route debug checklist (server.ts):**

1. File exists where the handler reads it (`public/...` vs `dist/` cwd).
2. Route registered **before** SPA `app.get('*')` / static index fallback.
3. Process actually restarted with **rebuilt** code (`npm run build` → service restart).
4. Deploy tree: changes in `/home/ubuntu/src/Health-tracker` do **not** go live until **push to main**; `/home/ubuntu/deploy/Health-tracker` resets from origin.
5. Confirm on **prod URL**, not only localhost.

```bash
# after fix: must NOT return SPA title
curl -sS https://health-tracking.duckdns.org/<route> | grep -F '<unique-marker>'
```

## 5. Chat action / typing

```bash
bash .../telegram-send.sh --profile=... --action=typing
# PASS: "Action 'typing' sent"
```

Pulse every ~4s during long work (see `docs/agents/telegram_work.md`).

## 6. Evidence rules (before you claim done)

| Claim | Minimum evidence |
|-------|------------------|
| Text delivered | script stdout `Message delivered` or API `"ok":true` |
| Markdown works | same + no plain-fallback warning |
| Photo/file delivered | `Photo delivered` / document message id / `MEDIA:` accepted |
| Route serves page | curl body contains **unique** page marker, not SPA title |
| Prod live | curl **https://health-tracking.duckdns.org/...** after deploy |
| Instant View | public HTTPS + template/rhash — else say “link only” |

Never: “should work”, “I restarted but didn’t re-curl”, HTTP 200 without body check.

## 7. Common failures → fix

| Symptom | Likely cause |
|---------|----------------|
| SPA HTML on custom route | Catch-all/static order; old process; not deployed |
| Works localhost, fails phone | localhost not public |
| `can't parse entities` | Legacy Markdown vs `_`/`*`/URLs |
| `MEDIA:` ignored | Not absolute path; inside code fence |
| HTML file “won’t open in TG” | Expected — download or use URL/IV/Mini App |
| Expect native tables | Script has no `sendRichMessage` |

## 8. Smoke test one-shot

```bash
bash /home/ubuntu/bot-host/scripts/telegram-smoke-test.sh --profile=orchestrator
```

Runs text, action, and optional photo/document checks; prints PASS/FAIL per case.

## Related

- Delivery conventions: `telegram-photo`, shared `telegram-media-delivery`
- Progress/typing standards: `docs/agents/telegram_work.md`
- Script under test: `scripts/telegram-send.sh`
