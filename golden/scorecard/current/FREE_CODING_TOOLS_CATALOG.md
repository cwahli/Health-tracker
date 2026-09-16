# Free coding tools catalog (dynamic)

**Purpose:** Pick the right free worker for Health-tracker. Append new tools/models as rows; bump **Last reviewed** and the changelog.

| Field | Value |
|---|---|
| Last reviewed | 2026-09-16 |
| Companion wave ledger | [`FREE_MODEL_BAKEOFF.md`](./FREE_MODEL_BAKEOFF.md) |
| Short picker | [`FREE_MODEL_TOOL_PICKER.md`](./FREE_MODEL_TOOL_PICKER.md) |
| Live app | https://health-tracker-backend-64gt.onrender.com/ |
| Standing lock | DeepSeek **4.1 / V4.1 Flash only** — never V4 |

## How to use this doc
1. Check **Ranked picks** for today’s default.
2. Check **Tools × free models** for what is actually free and any cap.
3. When a new tool appears, add a row to both tables + a changelog line (do not delete old rows — mark `Status`).

**Usage estimates** are order-of-magnitude for *this* repo’s overnight-style work (restore/wire + vitest + occasional Playwright). They are not vendor SLAs.

---

## Ranked picks (Health-tracker, 2026-09-16)

| Rank | Tool + model | Why this rank | Est. useful free usage | Status |
|---:|---|---|---|---|
| 1 | **Cline Free · DeepSeek V4.1 Flash** | Best overnight restore/git archaeology (waves C/E/F/H) | ~several coding waves / day until **daily free cap** (~22h cooldown after Wave H) | Proven |
| 2 | **OpenCode + Cline Free · Muse Spark 1.3 Contributor** | Always-on workhorse; **independent Muse wallets** when both run | Parallel overnight lanes; no shared Muse collision seen | Proven |
| 3 | **Token Harbor · `deepseek-v4.1-flash:free`** | Backup DeepSeek when Cline capped; API `https://tokenharbor.ai/v1` | **7-day** value pot; 49 tok smoke still **0% used** (opaque $ bar) | Proven smoke |
| 4 | **Freebuff · DeepSeek V4.1 Flash** (id `deepseek/deepseek-v4-flash`) | Live: **100 Freebucks/day** full tier; **15/hr** → ~**6.7h** | Session-hour billing; ads; upstream id is v4-flash | **API+CLI verified** 2026-09-16 |
| 5 | **Freebuff · Muse Spark 1.2** | Claimed ~**6 h/day** full-access share of Freebucks | Same Freebucks pool as above; model is **1.2** not our 1.3 Contributor | Claim only |
| 6 | **Cline · Laguna S 2.1 free** | Fallback when DeepSeek capped + Muse busy | Fine for inventory/docs (Wave D); weaker for restores | Proven light |
| 7 | **Freebuff · GLM 5.3 Flash / MiMo / Solar / GPT-5.6 Luna** | Extra free hours on paper (GLM highest hour equiv.) | Shared Freebucks; GLM free on **Cline** promo already **ended** — Freebuff is a different wallet | Claim only |
| — | OpenCode non-Muse (DeepSeek/GLM) | Needs payment method on this workspace | $0 free path: **no** | Blocked |
| — | Cline Free · GLM-5.3-Flash | Promo ended 2026-09-15 | — | Dead |
| — | Any DeepSeek **V4** | User lock: do not use | — | Forbidden |

**Default rotate:** DeepSeek 4.1 (Cline → else Token Harbor → else Freebuff) → Muse 1.3 (OpenCode/Cline) → Laguna.

---

## Tools × free models (expandable)

| Tool | How to connect | Free models (usable) | Cap / estimate | Data / caveats | Verified |
|---|---|---|---|---|---|
| **OpenCode** | CLI; Muse free works without card | `muse-spark-1.3-contributor-free` (+ high variant) | Untimed Muse free in bakeoff; may refuse writes outside repo | Local agent | 2026-09-15 A |
| **Cline Usage-Billing (OAuth)** | Sign in with Cline → **Free** (not Vertex, not ClinePass) | Muse Spark 1.3 Contributor; DeepSeek V4.1 Flash; Laguna S 2.1 free; Solar listed earlier | DeepSeek: **daily free cap**; Muse: OK overnight; OAuth ~1h | Free tier | 2026-09-15 B–L |
| **Token Harbor** | GitHub/Google → verify email → enable free models → API key | DeepSeek V4.1 Flash, DeepSeek V4 Flash, MiMo V2.5 | **7×24h** from first free request; value-based (% bar); V4.1 marked limited | Free routes **may retain** prompts; skip V4 for us | 2026-09-16 |
| **Freebuff** | freebuff.com · CLI `npm i -g freebuff` · Desktop/Web/Cloud/Chat | Full-access mix: GPT-5.6 Luna (~5h), **DeepSeek V4.1 Flash (~6h)**, Muse Spark **1.2** (~6h), MiMo 2.5 (~10h), Solar Pro 4 (~10h), GLM 5.3 Flash (~20h) — *if all Freebucks spent on that one model* | **100 Freebucks/day US**; **GB/UK 70**; DE/FR… 40; else/VPN **25**. Midnight **Pacific**, no carryover. Limited mode: ~6×1h sessions, subset of models | **Ad-funded**; collects prompts/code/repos/traces; some models **may train** on data. Country/VPN gated | API+CLI 2026-09-16: 100 Freebucks full; DeepSeek 15/hr; ads on. Agent turn soak still open |

### Freebuff Freebucks (from their FAQ JSON)
| Region | Freebucks / day |
|---|---:|
| US | 100 |
| CA, GB, AU, NZ, IE, NO, SE, DK, FI, NL, AT, LU, IS | 70 |
| DE, FR, ES, IT, PT, BE, CH, LI, MT, KR | 40 |
| Everywhere else **or any VPN** | 25 |

Hours in marketing tables assume burning the **whole** daily Freebucks on **one** model — not a sum across models.

---

## Rough usage translation (Health-tracker)

| Work shape | Ballpark tokens / wall | Fits best |
|---|---|---|
| Small restore + vitest (Wave J-sized) | Minutes–~15 min; tens of k tok | Any ranked free model |
| Multi-file i18n restore + sensors (Wave C/F/H) | ~10–20+ min; large context | DeepSeek 4.1 first |
| Live Playwright soak | Wall-clock dominated by Render | Any; model optional |
| All-night parallel lanes | Need dual Muse wallets + DeepSeek backup | Muse×2 + Token Harbor/Freebuff DeepSeek |

---

## Freebuff live verify (2026-09-16, account cwahli)

Authenticated against `https://www.codebuff.com/api/v1/freebuff/session` after CLI login.

| Check | Result |
|---|---|
| Free? | **Yes** — `accessTier: full`, no card required for daily Freebucks |
| Daily Freebucks | **100 / 100** remaining (`spent: 0`) |
| Reset | `2026-09-17T07:00:00.000Z` (midnight America/Los_Angeles) |
| DeepSeek price | **15 Freebucks / session-hour** for model id `deepseek/deepseek-v4-flash` |
| Implied DeepSeek hours | 100÷15 ≈ **6.7 h/day** if all Freebucks spent on DeepSeek (matches ~6h marketing) |
| Muse 1.2 / 1.3 price | **15 Freebucks/hr** each |
| GLM 5.3 Flash price | **5 Freebucks/hr** (≈20 h/day if solo) |
| Ads | CLI shows text ads (claim holds) |
| Session smoke | Model picker reached; full agent turn not completed in automation (TUI). Balance still 100/100 until a session starts |
| Naming caveat | UI label **"DeepSeek V4.1 Flash"** maps to upstream id **`deepseek/deepseek-v4-flash`** in Freebuff prices — not the same product string as Cline/Token Harbor `deepseek-v4.1-flash` |


## Changelog
| Date | Change |
|---|---|
| 2026-09-16 | Freebuff live verify: 100 Freebucks full tier; DeepSeek 15/hr (~6.7h); ads on |
| 2026-09-16 | Initial catalog: OpenCode, Cline, Token Harbor, Freebuff; ranked picks; Freebucks country table |
| 2026-09-15 | Bakeoff waves A–L ledger in `FREE_MODEL_BAKEOFF.md` |

## Template (copy for a new tool)

```md
| **ToolName** | connect steps | model A, model B | cap / estimate | caveats | YYYY-MM-DD |
```

Then add a **Ranked picks** row (or mark Status=`Claim only` until smoked).
