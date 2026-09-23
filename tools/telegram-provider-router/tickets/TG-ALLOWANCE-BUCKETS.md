# TG-ALLOWANCE-BUCKETS — shared vs per-model free allowance

## Why
`/allowance` and `state.quota` currently mark **per route** (`provider/model`). That misleads when a vendor uses a **shared free bucket**:
- OpenCode Zen free (`opencode/*-free`: Muse, MiMo free, Ling free, Nemotron free, Space Bunny free when available) → **one shared rate/allowance**; Muse “Rate limit exceeded” means sibling Zen-free models are also unavailable.
- Token Harbor `:free` → **one rolling ~7-day free value bar** (shared across free models).
- Cloudflare Workers AI → **shared 10k neurons/day UTC** (already tracked in `cf-neurons.json`).
- Freebuff Freebucks → **shared account daily** (still terminal-only on TG).
- Cline free (`cline-free/*`) → treat as **per-model daily** (separate Muse vs DeepSeek caps).

Space Bunny (`opencode/space-bunny-free`): listed by `opencode models` CLI but **running server** returns `ProviderModelNotFoundError`. Do **not** advertise on `/freemodel` until it appears under `GET /provider` → `opencode.models`. Still include it in the OpenCode Zen-free **bucket membership list** for future when the server picks it up.

## Files
- `/home/box/.config/telegram-opencode/router/src/index.js`
- Report: `/tmp/TG_ALLOWANCE_BUCKETS_REPORT.md`

## Implement

### 1) `FREE_ALLOWANCE_BUCKETS` table
```js
{
  id,                 // e.g. "opencode-zen-free"
  scope: "shared"|"per-model",
  label,              // human
  resetHint,          // "rolling / rate-limit", "00:00 UTC", "Cline UI daily", …
  match(provider, model) -> bool   // or explicit model globs
}
```
Suggested buckets:
| id | scope | matches |
|----|-------|---------|
| `opencode-zen-free` | shared | provider `opencode` + model id contains `opencode/` and ends with `-free` OR is a known zen free id (muse/mimo/ling/nemotron/space-bunny) |
| `tokenharbor-free` | shared | provider tokenharbor OR model `tokenharbor/*:free` / `*:free` on TH |
| `cloudflare-neurons` | shared | cloudflare / `@cf/` models (reuse existing ledger for numbers) |
| `cline-free` | per-model | `cline-free/*` — each model is its own quota key |
| `freebuff-freebucks` | shared | freebuff (informational) |

### 2) Change quota memory
- Store `state.quota[bucketKey]` for shared buckets: `{ depletedUntil, lastError, scope:"shared", hitBy:"provider/model" }`.
- For per-model scope keep `state.quota["cline/cline-free/…"]` as today.
- `markDepleted(provider, model, err)`:
  - resolve bucket; if shared → mark **bucket** (one entry), not only the single model.
  - Parse `try again in Xh Ym` / `until <iso>` from err when present → set `depletedUntil`; else default TTL (keep `QUOTA_TTL_MS`).
- `isDepleted(provider, model)`: true if that route’s **bucket** (shared) or **exact key** (per-model) is still depleted.
- Failover skip (existing) must use this so Muse-hit skips MiMo OpenCode free too when same bucket.

### 3) `/allowance` rewrite (keep CF live/estimate block)
Show sections:
```
Allowance (best-effort)

Buckets
· OpenCode Zen free [shared] — DEPLETED until … (hit by muse-…) · affects: muse, mimo, ling, …
· Token Harbor free [shared] — unknown remaining (dashboard) · depleted? …
· Cline free [per-model]
    – muse-… : depleted until …
    – deepseek-… : OK / unknown
· Cloudflare neurons [shared 10k/UTC] — existing numbers
· Freebuff Freebucks [shared] — UI only / terminal

Active route: …
Failover family: …
```
Never invent remaining counts when the API doesn’t expose them — say `unknown` + dashboard hint. Do invent structure (bucket vs per-model) so estimates/failover stay honest.

### 4) Optional light
If cheap: when marking OpenCode Zen free depleted, Telegram line can say “shared Zen free bucket — Space Bunny/MiMo/Muse on OpenCode will fail until reset”.

## Out of scope
Rewriting whole router; Freebuff TG restore; forcing Space Bunny onto freemodel while Model-not-found.

## Done when
`/tmp/TG_ALLOWANCE_BUCKETS_REPORT.md` with: code pointers, example `/allowance` text, proof that marking `opencode/muse-spark-1.3-contributor-free` depleted makes `isDepleted` true for `opencode/mimo-v2.6-flash-free`, and false for `cline-free/deepseek-v4.1-flash`. Restart **one** router poller if code loaded at boot. No tokens printed.
