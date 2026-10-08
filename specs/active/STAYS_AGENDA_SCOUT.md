# Spec: Agenda Bot Mini App & Stays Scout (Hostels & Accommodation)

**Target Audience:** Terminal Coding Agent / Implementer  
**Host & VM:** `ubuntu@health-tracker.co.uk` (Port 8895)  
**Parent Bot:** `@ht_agenda_bot` (Token in `~/.config/bot-host/agenda.env`, Chat ID: `6218257274`)  
**Domain / Route:** `https://agenda.health-tracker.co.uk` (Proxied via Caddy to `127.0.0.1:8895`)  

---

## 1. Executive Summary & Core Requirements

This specification unifies three key workflows into a single high-performance mobile **Telegram Mini App (Web App)** accessible exclusively via the bot’s chat **burger menu** (`setChatMenuButton`), keeping the Telegram message stream completely free of persistent bottom keyboards:

1. **Tab 1: Central Tax & Statutory Calendar**:
   - Replaces walls of text in chat with the dark-mode HTML dashboard layout (`/home/ubuntu/tax/results/dashboard.html` or `/Users/chiwah/.gemini/antigravity/brain/8fda5e5f-352d-4888-b0c1-cc5ac768b3c7/tax_dashboard.html`).
   - Renders 4 executive summary cards (PAYE RTI, VAT, Self Assessment, Corporation Tax) and a chronological status timeline table with live pills (`✔ FILED & ACCEPTED`, `📅 31 days left`, `⚙ OPEN (117d)`).
2. **Tab 2: My Agenda (Google Calendar)**:
   - Displays live personal & business events for `chiwah.liu@gmail.com` (credentials stored at `/home/ubuntu/.config/bot-host/google-user-credentials.json`) alongside statutory HMRC milestones.
3. **Tab 3: Stays Scout (Accommodation Metasearch Engine)**:
   - Queries **Hostelworld**, **Agoda**, and **Booking.com** directly and independently in parallel.
   - Enforces strict dorm room filtering (Male / Mixed only; automatically disqualifies Female-Only dorms like Kensal Green 2).
   - Ranks hostels using a **Tower Bridge Proximity Metric** (`ValueScore = Price + Distance_to_Tower_Bridge_km * 0.8`), heavily favoring central/SE1 locations (e.g. RestUp London at £11, 1.8km to Tower Bridge).
   - Shows photos of actual dorm rooms, bed counts (e.g. 6/8/10/16 bed), review scores, and direct 1-tap checkout deep links to the cheapest platform.

---

## 2. Reused Componentry (from `tgtg-audit`)

Reuse the proven architecture from `/home/ubuntu/tgtg-audit/` (`tgtg.health-tracker.co.uk`):

* **Telegram WebApp SDK Host:** Load `https://telegram.org/js/telegram-web-app.js`, call `Telegram.WebApp.ready()` and `Telegram.WebApp.expand()`.
* **Design System & Palette:** Fixed dark theme:
  - `--bg: #0f1419`
  - `--card: #1a2029`
  - `--field: #121820`
  - `--line: #2a3340`
  - `--green: #7BD389`
  - `--ink: #e6e9ef`
  - `--muted: #9aa4b2`
* **Sticky Control Bar:**
  - Sort dropdown: `Best Value (Tower Bridge)`, `Lowest Price (£)`, `Nearest to Tube`, `Top Rated`.
  - Filter pills: Gender (`Mixed / Male only`), Max dorm size (`≤ 8 beds`, `Any`), Price limit.
* **Card Component:**
  - Dorm photo thumbnail cover.
  - Multi-platform price comparison chips: `Hostelworld £11` (active) | `Agoda £17` | `Booking.com £18`.
  - Tower Bridge distance pill (`1.8 km to Tower Bridge`) + nearest Tube pill.
  - Dorm spec pill (`8-Bed Mixed Dorm`).
  - 1-tap booking button to cheapest platform.

---

## 3. Tower Bridge Distance & Benchmark Leaderboard

Tower Bridge coordinates: `51.5055° N, 0.0754° W`  
Composite Value Formula: `ValueScore = BestPrice + (Distance_km * 0.8)`

| Rank | Accommodation | Dorm Specs | Tube Station | Distance to Tower Bridge | Best Price & Platform | Value Score |
|:---:|---|---|---|:---:|:---:|:---:|
| **1** | **RestUp London** | 8-Bed Mixed | Elephant & Castle (400m) | **1.8 km** | **£11** (Hostelworld) | **12.4** (Top Value) |
| **2** | **Onefam Waterloo** | 8-Bed Mixed | Lambeth North (350m) | **2.7 km** | **£18** (Agoda) | **20.2** |
| **3** | **Bell House Hostel**| 6-Bed Mixed | Edgware Rd (280m) | **6.6 km** | **£15** (Agoda/Booking) | **20.3** |
| **4** | **BacPac Hostel** | 8-Bed Mixed | Hammersmith (49m) | **10.4 km** | **£14** (Agoda) | **22.4** |
| **5** | **Mapesbury Hostel** | 8-Bed Mixed | Kilburn (500m) | **10.0 km** | **£15** (Hostelworld) | **23.0** |
| **6** | **Phoenix Paddington**| 8-Bed Mixed | Edgware Rd (200m) | **6.4 km** | **£18** (Hostelworld/Agoda)| **23.1** |
| **7** | **Astor Hyde Park** | 6-Bed Mixed | South Kensington (500m) | **7.2 km** | **£18** (Agoda) | **23.7** |
| **8** | **Kensal Green 1** | 10-Bed Mixed | Kensal Green (50m) | **10.7 km** | **£16** (Agoda) | **24.5** |
| -- | ~~Kensal Green 2~~ | ⛔ 8-Bed Female | Kensal Green (50m) | 10.7 km | £14 (Filtered Out) | N/A |
| **9** | **Queen Elizabeth** | 12-Bed Mixed | Fulham Broadway (800m) | **8.4 km** | **£20** (Hostelworld/Agoda)| **26.7** |
| **10** | **Clink 261** | 10-Bed Mixed | Kings Cross (300m) | **4.2 km** | **£24** (Agoda/Booking) | **27.4** |

---

## 4. Telegram Burger Menu Integration & Chat Cleanup

* In `/home/ubuntu/tax/bot/agenda_handler.py`:
  - `KEYBOARD_PAYLOAD` set to `{"remove_keyboard": True}` so no permanent buttons clutter the chat bottom.
* Telegram Bot API configuration:
  ```bash
  curl -s -X POST "https://api.telegram.org/bot<TOKEN>/setChatMenuButton" \
    -H "Content-Type: application/json" \
    -d '{"chat_id": 6218257274, "menu_button": {"type": "web_app", "text": "Agenda", "web_app": {"url": "https://agenda.health-tracker.co.uk"}}}'
  ```

---

## 5. Next Steps for Next Coding Agent

1. **Verify Web App Server Setup**:
   - Create Node server `/home/ubuntu/tax/webapp/server.mjs` listening on port `8895`.
   - Add Caddy reverse proxy block in `/etc/caddy/Caddyfile`:
     ```caddy
     agenda.health-tracker.co.uk {
         reverse_proxy 127.0.0.1:8895
     }
     ```
   - Reload Caddy (`sudo systemctl reload caddy`).
2. **Build Scrapers & Normalizer**:
   - `scrapers/hostelworld.mjs`: query London hostels for check-in/check-out dates.
   - `scrapers/agoda.mjs`: query Agoda headless CDP for low-to-high London hostels.
   - `scrapers/booking.mjs`: query Booking.com London hostels.
   - `engine/aggregator.mjs`: normalize by coordinates and name, calculate Tower Bridge distance and `ValueScore`.
3. **Register Menu Button**:
   - Run `setChatMenuButton` and verify tapping ☰ in `@ht_agenda_bot` opens the 3-tab Mini App.
