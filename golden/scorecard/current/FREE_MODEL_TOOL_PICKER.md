# Free coding tool picker (Health-tracker)

Last updated: 2026-09-16. Vertex promo ended 2026-09-15 — do **not** use Vertex / `aider-vertex` for this work.

Companion ledger (per-wave rows): [`FREE_MODEL_BAKEOFF.md`](./FREE_MODEL_BAKEOFF.md)  
Overnight wave reports: `tasks/bakeoff/WAVE_*_REPORT.md`

## Quick pick

| Need | Prefer | Avoid |
|---|---|---|
| Always-on free coding / parallel workers | **Muse Spark 1.3 Contributor Free** on **Cline** and/or **OpenCode** | Burning Grok exploratory loops |
| Hard i18n restore / git archaeology / sensors | **DeepSeek V4.1 Flash** (never V4) | `deepseek-v4-flash` / DeepSeek V4 |
| DeepSeek when Cline daily free is capped | **Token Harbor** `deepseek-v4.1-flash:free` (7-day value allowance) | Paying OpenCode DeepSeek without billing |
| Inventory / docs when DeepSeek capped + Muse busy | **Laguna S 2.1 free** (Cline) | Assuming GLM free still works |
| Live Playwright soaks | Harness against Render URL (model-agnostic) | Relying on UI-only soft greens |

**Rotate:** DeepSeek 4.1 (while free open) → Muse Spark free → Laguna free.

## Providers & how to connect

### OpenCode
- **Muse free:** `opencode/muse-spark-1.3-contributor-free` (use `--variant high` when available).
- **Works without payment** for Muse free on this workspace.
- **Blocked without billing:** OpenCode `deepseek-v4-*`, GLM, other non-Muse catalog models (“No payment method”).
- **Quirk:** may refuse writing outside the repo (`external_directory`).

### Cline (Usage-Billing OAuth — not Vertex, not ClinePass)
1. Provider: **Cline Usage-Billing (OAuth)** → Sign in with Cline.
2. Pick **Free** models (not Google Vertex AI).
3. Confirmed Free lineup used overnight: Muse Spark 1.3 Contributor, DeepSeek V4.1 Flash, Laguna S 2.1; Solar also listed earlier.
4. **GLM-5.3-Flash free promo ended** (as of Wave D, 2026-09-15).
5. OAuth tokens ~1h — reauth when expired.
6. **DeepSeek V4.1 Flash** hit a **daily free cap** after Wave H (~22h cooldown). Strong while open; not an all-night sole worker.

### Muse dual wallet
OpenCode Muse + Cline Muse ran **concurrently** with **no shared-quota collision** → treat Muse free allowances as **independent** across the two tools (Wave A+B).

### Token Harbor (API gateway) — verified 2026-09-16
- Site: https://tokenharbor.ai — Free plan $0/mo, no card required.
- Free models (monthly/rotating allowance): **DeepSeek V4.1 Flash**, DeepSeek V4 Flash, MiMo V2.5.
- For Health-tracker coding use **4.1 only** (`deepseek-v4.1-flash:free`), never V4.
- Base URL that worked: `https://tokenharbor.ai/v1` (`/v1/chat/completions`).
- Setup: GitHub OAuth → verify email → enable free models (opt-in; **free routes may retain prompts**) → API key (`thk_live_…`).
- Period: **7×24h** from **first free-model request**; value-based (UI often shows **% used**, not $ remaining).
- Smoke: 1 request / 49 tokens → still **0% used**; reset ~7 days. Looks **larger than Cline’s daily DeepSeek free cap**, but opaque and retention-different from paid routes.
- Paid: wallet top-up / Passes for frontier models — not needed for free DeepSeek 4.1.

## Model scorecard (overnight A–L + Token Harbor)

| Model | Where | Strength | Weakness | Overnight evidence |
|---|---|---|---|---|
| **DeepSeek V4.1 Flash** | Cline Free | Best restore-from-git, sensors, scorecard ratchets | Daily free cap (~22h) | Waves C/E/F/H PASS |
| **DeepSeek V4.1 Flash free** | Token Harbor | Backup DeepSeek when Cline capped; 7-day pot | Opaque value bar; free retention; email verify | 2026-09-16 PONG OK; 0% after 49 tok |
| **Muse Spark 1.3 Contributor Free** | OpenCode + Cline | Always-on workhorse; dual wallets; wire/restore | OpenCode write-outside-repo friction | A (partial live), B/I/J/L PASS |
| **Laguna S 2.1 free** | Cline | Fallback inventory/docs | Not the restore star | Wave D PASS inventory |
| **GLM-5.3-Flash free** | Cline | — | Promo **ended** | Wave D failed → Laguna |
| DeepSeek V4 / `deepseek-v4-flash` | anywhere | — | **Do not use** (user lock: use 4.1) | Forbidden |
| OpenCode non-Muse | OpenCode | — | Needs payment method | C/D blocked |

## Standing workflow (thin coordinator)
1. Grok plans / unblocks / notes bake-off rows — workers do coding/soaks.
2. Prefer high thinking.
3. Append results to `FREE_MODEL_BAKEOFF.md`.
4. Live app: `https://health-tracker-backend-64gt.onrender.com/` (GitHub main → Render).
5. DeepSeek id lock: **4.1 / V4.1 Flash only**.

## Still needs human (not a model pick)
- Invent path: **Adjust portion** (no historical key); §7a residuals; BugTrackerModal title.
- Optional: apply Wave D ROADMAP draft; post-success meal-chrome re-soak; scorecard #9/#10.
