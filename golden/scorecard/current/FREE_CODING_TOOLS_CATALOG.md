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

## Model tiers (high = coding-agent capable · light = docs/inventory)

**Why this table exists.** `/freemodel` and `/allowance` have to separate coding-capable
models from light ones so a reader can see which pool a turn will draw from. R-16
(Tier + catalog law) says that split "follows `FREE_CODING_TOOLS_CATALOG.md` Ranked picks +
Tools × free models and `FREE_MODEL_TOOL_PICKER.md` defaults … no new tier file, no per-bot
tier fork" — so the tiers live here, in this file, and nowhere else.

**Reading rules, in order.**
1. A **lock outranks a tier**: `Any DeepSeek V4 — Forbidden`, `GLM 5.3 Flash — Dead`, and every
   Freebuff row stay unlisted whatever a tier below would say. Freebuff is terminal-only on
   this host and is never selectable, so it has no tier.
2. A **Ranked picks rank is a tier**: rank 1–5 are `high` unless the row calls itself a
   docs/inventory fallback, and rank 6 (Laguna S 2.1, "Proven light") is `light`. That is why
   Muse Spark 1.3 Contributor is `high` here at rank 2 even though an earlier draft of this
   catalog called it unscored and put it in `light` — this file's own rank is the newer
   statement, and it is the repo's #2 pick.
3. This table fills in every model the ranked picks do not mention. A row here wins over the
   Tools × free models guess, because it is per-model rather than per-tool.

**Which basis is allowed.** A tier needs a *stated* basis, and only two kinds count: a vendor or
cache description of what the model is for, or a position in the ranked picks above. An
unmeasured model is `light`, not `high` — light is the documented docs/inventory tier and it is
still reachable, so an unmeasured model is never dropped and never quietly promoted into the
pool that writes code. Benchmark *numbers* are deliberately not a basis here: the score rendered
on `/freemodel` comes from `FREE_MODEL_BAKEOFF.md` (QS-7), and a number that is not in that
ledger is not rendered anywhere.

| Model | Tier | Basis |
|---|---|---|
| DeepSeek V4.1 Flash | high | Rank 1 pick; the catalog's standing default rotate starts here |
| DeepSeek V4 Flash | high | the non-1.1 V4 Flash tier, same family; the bare `DeepSeek V4` above stays Forbidden and is deliberately absent here |
| Hy3 | high | "Tencent Hy reasoning model for coding, instruction following, and agent tasks" |
| Muse Spark 1.3 Contributor | high | Rank 2 pick; ran waves B–L, "always-on workhorse" |
| Kimi K2.5 | high | K2 coding family, described for agentic software work |
| MiMo V2.6 | high | the version this host runs; MiMo family described as an omni model "for agents" |
| MiMo V2.5 | high | same family as V2.6 |
| MiMo V2 Flash | high | same family as V2.6 |
| MiMo V2 Pro | high | same family as V2.6 |
| MiMo V2 Omni | high | same family as V2.6 |
| Qwen 3.8 Flash | high | Qwen 3.8 Flash class, hosted on Token Harbor |
| Qwen 3.8 27B | high | the 27B tier of the Qwen 3.8 class above |
| GLM 4.7 Flash | high | GLM 4.7 coding class, Cloudflare-hosted |
| Space Bunny | high | UNSCORED, but described as a reasoning model for coding/agentic tasks and tool use, and `plan/ROADMAP.md` + `plan/BOT_ROLES.md` make it the fleet fallback |
| ox-alpha | high | "Stealth reasoning model for coding, agentic tasks, and tool use", 1M ctx |
| x-preview-f | high | same stealth-reasoning description as ox-alpha |
| Hy3 Preview | high | same Hy family, no description of its own |
| North Mini Code | high | "Cohere coding model for practical software engineering and agentic edits" |
| KAT Coder Pro | high | Cline free coding model, coding by name; no published score |
| MiniMax M2.5 | high | M2 family positioned for agentic coding |
| MiniMax M2.1 | high | M2 family positioned for agentic coding |
| Nemotron 3 Ultra | high | the larger Nemotron tiers |
| Nemotron 3 Super | high | the larger Nemotron tiers |
| Laguna S 2.1 | light | Rank 6, "Proven light", "Fine for inventory/docs; weaker for restores" |
| Ling 3.0 Flash | light | "Efficient model for low-latency assistance, extraction, and routine automation" |
| Ling 3.0 Flash Fin | light | same Ling 3.0 Flash description; the "fin" variant is not a larger model |
| Ling 3.0 Tiny | light | "Compact MoE … responsive agents, instruction following"; below 3.0 Flash |
| Ling 2.6 Flash | light | Ling family, low-latency assistance and extraction |
| Trinity Large Preview | light | 131K context, the smallest in the list, no description |
| LongCat 2.0 | light | no description and no published benchmark in these catalogs |
| Ring 2.6 1T | light | a 1T-parameter open-weights tier with no description and no published benchmark in these catalogs |
| MiniMax M3 | light | no description and no published benchmark in these catalogs |
| Nemotron 3.5 Lightning | light | the smaller Nemotron tier; superseded by 3 Ultra where both are free |
| Solar Pro 4 | light | listed under Freebuff (terminal-only) and Cline; no published benchmark |
| Big Pickle | light | the scorecard's least certain cell, text-only, and the handover records that only `--variant low` replies |
| Gemini 3.7 Flash | light | between 3.5 Flash Lite and 3.8 Flash; no score of its own |
| Gemini 3.8 Flash | high | the strongest Gemini tier in the list |

Not listed on purpose: `grok-code` (coding by name, but it is not a `-free` model and has no
place on a free list), and every model this table does not name — unlisted means unranked, which
renders as `unranked` and sorts between the two tiers, never as a guess.

## Benchmarks (external — informational, never a tier basis)

**What this table is for.** You asked where the benchmark rating went: it went when the
in-code ratings table was deleted, because R-16 says the score *shown* comes from the bakeoff
ledger. These are the external published numbers, kept here in the catalog so there is still
exactly one place a number can come from, and shown next to the bakeoff label rather than
instead of it.

**The metric.** Unless a row says otherwise, the number is **Artificial Analysis Intelligence
Index v4.3** — a composite of 10 evals (AA-Briefcase, GDPval-AA v2, AutomationBench-AA,
Terminal-Bench 4.0, SciCode, HLE, GDP.pdf, CritPt, AA-Omniscience, AA-LCR v1.1). Only v4.3
figures are comparable to each other; earlier index versions are not, which is why Nemotron 3
Super's older 36 is not a v4.3 number and its row is an estimate.

**The rules.**
- Every figure carries its **source** and the date it was checked. A number with no source is
  not printed.
- `~` means an estimate from a measured relative, never a measurement.
- **No published figure means no number.** Not zero, not a neighbour's score, not a guess.
  `ox-alpha` has no Artificial Analysis or LMArena entry at all, and its circulating
  DeepSWE numbers come from a 10-task slice and a disputed full run — so its row says so.
- These numbers **do not place a model in a tier.** The tier comes from the Model tiers table
  above, on stated capability. A benchmark is evidence you can argue with, not a ranking we
  invented; that separation is why a 48 can sit beside a 29 and both be right.

| Model | AA Index v4.3 | Other published figures | Source | Checked |
|---|---|---|---|---|
| Muse Spark 1.3 | 48 | — | artificialanalysis.ai, AA v4.3 | 2026-09-23 |
| DeepSeek V4.1 Flash | 39.5 | — | AA v4.3 via `qa-evidence/model-comparison.json` | 2026-09-23 |
| Qwen 3.8 Flash | 39.9 | — | AA v4.3 via the scorecard | 2026-09-23 |
| GLM 5.3 Flash | 42 | DeepSWE v1.1 63.4 (vendor-reported) | artificialanalysis.ai | 2026-09-26 |
| Gemini 3.8 Flash | 41.2 | — | AA v4.3 via the scorecard | 2026-09-23 |
| Gemini 3.5 Flash Lite | 22.0 | — | AA v4.3 via the scorecard | 2026-09-23 |
| MiMo V2.6 Flash | ~41 (est.) | Pro sibling 46.3 measured; Flash not published | scorecard | 2026-09-23 |
| MiniMax M3 | 29 | — | artificialanalysis.ai model comparison | 2026-09-26 |
| Ling 3.0 Flash | 25 (AA's own estimate) | Ling 3.0 Tiny / 2.6 Flash: no figure | artificialanalysis.ai model comparison | 2026-09-26 |
| Nemotron 3 Ultra | 23 | — | artificialanalysis.ai model comparison | 2026-09-26 |
| Nemotron 3.5 Lightning | 14 | — | artificialanalysis.ai (BF16 serving) | 2026-09-26 |
| Nemotron 3 Super | ~18 (est.) | older index ≈ 36 — NOT v4.3, not comparable | scorecard | 2026-09-23 |
| Laguna S 2.1 | ~26 (est.) | SWE Atlas 46.2, Terminal-Bench 2.1 70.2 | scorecard | 2026-09-23 |
| Big Pickle | ~30 (est., band 25–35) | SWE Atlas 50.8% (self-reported, single trial) | scorecard | 2026-09-23 |
| Solar Pro 4 | 28 | — | scorecard | 2026-09-23 |
| LongCat 2.0 | 20 | — | scorecard | 2026-09-23 |
| GLM 5.2 | 34 | — | scorecard | 2026-09-23 |
| ox-alpha · x-preview-f | **no published figure** | DeepSWE ~63% full-set community run (attribution disputed); Kingbench 87.5; a 96.6% Terminal-Bench 2.1 claim has no methodology attached. No AA and no LMArena entry. | community forensics, Aug 2026 | 2026-09-26 |
| Space Bunny · KAT Coder Pro · North Mini Code · Hy3 · Kimi K2.5 · Ring 2.6 1T · Trinity Large Preview · Qwen 3.8 27B · GLM 4.7 Flash | **no published figure** | none found on AA, LMArena or a vendor card | searched 2026-09-26 | 2026-09-26 |

**Discrepancies worth knowing about**, because they are why this table has a *Checked* column:
the repo scorecard (2026-09-23) says Ling 3.0 Flash 21, MiniMax M3 30 and Nemotron 3.5
Lightning 13; Artificial Analysis' own pages now say 25 (its own estimate), 29 and 14. The
live pages win, and the scorecard should be corrected to match.

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
| 2026-09-26 | Benchmarks table added (external AA Intelligence Index v4.3 + other published figures, each with source and checked date). Shown beside the bakeoff label; still never a tier basis |
| 2026-09-26 | Model tiers table added (high/light per model) so `/freemodel` and `/allowance` can group the list; tiers read from this file, never from code |
| 2026-09-16 | Freebuff live verify: 100 Freebucks full tier; DeepSeek 15/hr (~6.7h); ads on |
| 2026-09-16 | Initial catalog: OpenCode, Cline, Token Harbor, Freebuff; ranked picks; Freebucks country table |
| 2026-09-15 | Bakeoff waves A–L ledger in `FREE_MODEL_BAKEOFF.md` |

## Template (copy for a new tool)

```md
| **ToolName** | connect steps | model A, model B | cap / estimate | caveats | YYYY-MM-DD |
```

Then add a **Ranked picks** row (or mark Status=`Claim only` until smoked).
