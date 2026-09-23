# Telegram + coding tools — best practice (2026-09-23)

## Core rule
**One Telegram bot token ⇒ one long-poller.** Never run `opencode-telegram-bot` and `cline connect telegram` and a custom router on the same token at once — Telegram allows only one `getUpdates` consumer.

## Architecture (recommended)
```
Telegram (your phone)
    │  long-poll
    ▼
tg-provider-router  (this box)
    ├─ /switch opencode|cline|tokenharbor|freebuff
    ├─ /model  (list/set free models for active provider)
    └─ message → active backend
         ├─ OpenCode HTTP :4096  (Muse free — already proven)
         ├─ Cline CLI/RPC        (DeepSeek/Muse free wallets)
         ├─ Token Harbor API     (DeepSeek :free backup)
         └─ Freebuff CLI         (session Freebucks; optional)
```

## Existing options ranked for this box
| Option | Fit | Notes |
|--------|-----|-------|
| **Custom router (building)** | Best for multi-provider `/switch` | One bot; you pick backend |
| `@grinev/opencode-telegram-bot` | Best OpenCode-only UX | Models, plan/build, compact, schedules — still one poller |
| `opencode-telegram-session-control` | Good in-session plugin | Needs agent to `telegram_connect`; not multi-provider |
| Stock `opencode-telegram-bot` | Already running | OpenCode only; keep as fallback |
| `cline connect telegram` | Strong for Cline-only | Steals the same token if used alone |

## Paid value (only if free lanes fail)
1. **OpenCode Go (~$10/mo)** — best pay fit: DeepSeek in the same harness as Muse; Telegram router just `/switch opencode` + `/model deepseek…`.
2. Freebuff Starter — weak value vs Go for this workflow.
3. Hermes-style always-on agents — wrong shape for thin PM + CLI workers.

**Pay trigger:** Cline DeepSeek daily capped *and* Token Harbor 7-day pot empty *and* you still need DeepSeek from Telegram daily.

## Pull from multiple places (phone, box, VM)

Telegram is already on your phone. The question is where **OpenCode serve** and the **long-poller** live.

### Rule
| Piece | How many | Where it should live |
|-------|----------|----------------------|
| Telegram bot token / long-poller | **Exactly one** | A machine that stays up (this Grok Bot computer, a VPS, or a always-on Mac/VM) |
| OpenCode `serve` | One **active** target at a time (or several, switched) | Box, phone, or VM — poller points `--url` / router backend at it |
| OpenCode UI on phone | Many clients OK | OpenCode Mobile / `opencode attach <url>` talking to that serve |

### Patterns that work

**A — Phone as Telegram client only (what you have now)**  
Phone → Telegram → poller on this box → `opencode serve` on this box.  
No OpenCode install needed on the phone for coding via TG.

**B — Phone runs OpenCode UI, compute stays elsewhere (best for “OpenCode on my phone”)**  
1. On box/VM: `OPENCODE_SERVER_PASSWORD=… opencode serve --hostname 127.0.0.1 --port 4096`  
2. Expose privately with **Tailscale Serve** (preferred) or same-Wi‑Fi LAN IP — not a naked public port.  
3. On phone: OpenCode Mobile (or Termux `opencode attach https://…`) enters that URL + password.  
Same sessions; Telegram poller can keep using the same serve URL.

**C — Phone *is* the OpenCode server (Termux / on-device)**  
Possible but awkward: phone must stay awake, and the **poller** (on the box) must reach the phone over Tailscale (`http://100.x.x.x:4096`). Carrier NAT makes public URLs painful. Use only if you want local files on the phone.

**D — Switch backends without a second bot**  
Keep one poller (our router). Add `/switch` targets or env URLs:
- `opencode` → box `:4096`
- `opencode-phone` → Tailscale IP of phone serve  
Never start a second `getUpdates` poller on the same bot token.

### What does *not* work well
- Two pollers (stock OpenCode bot + Cline TG + router) on one token  
- Pointing the bot at `localhost` on the phone while the poller runs on the box  
- Exposing `:4096` to the open internet without password + tunnel

### Practical recommendation for you
1. Keep the **router on this box** (or move it later to a small always-on host).  
2. Treat phone OpenCode as a **client** (pattern B) via Tailscale → same Muse/DeepSeek wallets.  
3. Only if you need on-phone files, run serve on the phone and add a router URL for that Tailscale address (pattern C).
