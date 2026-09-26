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

## Placement rule (high = coding pool · light = docs/inventory)

**The rule, in one line:** a model is in the **coding pool** when its published benchmark is
**AA ≥ 35**, and in the **light pool** otherwise — which includes **every model with no published
figure at all**, unless it is listed as *demonstrated capable* below.

**Why the rule is shaped that way.** Two failure modes, one in each direction:

- A model with no measurement is not a coding model. Putting it in the coding pool on a vendor
  adjective ("built for coding") is how a fleet ends up writing code with something nobody has
  scored. Light is not a demotion: it is the documented docs/inventory pool, it is still
  reachable, and the walk only falls back to it when no coding lane is free.
- A model with a high measurement and no argument against it should not be argued down. So the
  number decides, and the escape hatch is *evidence*, not preference.

**Why 35.** The published figures cluster with a wide gap: the highest light-pool score is
**30** (Big Pickle, estimated) and the lowest coding-pool score is **39.5** (DeepSeek V4.1 Flash).
Any cut between 31 and 39 gives the same 30 rows, so the exact number is not load-bearing — 35
sits in the middle of the gap. Estimates count as figures, with `~` shown wherever they appear.

**The exception, and it is evidence or it is nothing.** A model with no published figure can
still be placed in the coding pool by being *demonstrated* — meaning it has actually run work on
this fleet, with a document saying so. That is a deliberately short list:

| Model | Tier | Demonstrated by |
|---|---|---|
| Space Bunny | high | `plan/ROADMAP.md` + `plan/BOT_ROLES.md` make it the fleet fallback when a provider returns `insufficient funds`; it answers on this host (workspace, tool use, 1M ctx) |

Nobody else is on it. `ox-alpha` and `x-preview-f` are the closest calls — the community
full-set DeepSWE run puts them around 63%, level with GPT-5.6 Sol mid — but that run's
attribution is disputed and neither model has an Artificial Analysis or LMArena entry, so
today they are light. Promote them by running a bakeoff wave on this repo and adding the row,
not by argument.

### Capability notes (evidence, not placement)

What each model is *documented* to be, kept because it is the reasoning behind a placement and
because it is what a reader needs when a number moves. Placement is the rule above plus the
demonstrated list; this table decides nothing on its own.

| Model | Documented as | Note |
|---|---|---|
| DeepSeek V4.1 Flash | the catalog's rank 1 pick, "best overnight restore/git archaeology" | AA 39.5 |
| Muse Spark 1.3 Contributor | rank 2, "always-on workhorse"; ran waves B–L | AA 48 |
| MiMo V2.6 Flash | the version this host runs; MiMo family described as an omni model "for agents" | AA ~41 |
| Qwen 3.8 Flash | Qwen 3.8 class, hosted on Token Harbor | AA 39.9 |
| Gemini 3.8 Flash | the strongest Gemini tier in the list | AA 41.2 |
| GLM 5.3 Flash | GLM 5.3 coding class | AA 42; the Cline promo row says Dead, but the lane is live and selectable, so the rating places it |
| Space Bunny | "reasoning model for coding, agentic tasks, and tool use", 1M ctx | no figure; demonstrated instead |
| KAT Coder Pro | Cline free coding model, coding by name | no published figure → light |
| North Mini Code | "Cohere coding model for practical software engineering and agentic edits" | no published figure → light |
| Hy3 | "Tencent Hy reasoning model for coding, instruction following, and agent tasks" | no published figure → light |
| Kimi K2.5 | K2 coding family, described for agentic software work | no published figure → light |
| Qwen 3.8 27B | the 27B tier of the Qwen 3.8 class | no published figure → light |
| GLM 4.7 Flash | GLM 4.7 coding class, Cloudflare-hosted | no published figure → light |
| ox-alpha · x-preview-f | "stealth reasoning model for coding, agentic tasks, and tool use"; identified as GLM-5 generation | no AA/LMArena entry; disputed DeepSWE run → light |
| Laguna S 2.1 | rank 6, "Proven light", "Fine for inventory/docs; weaker for restores" | AA ~26 |
| Big Pickle | text-only, the scorecard's least certain cell | AA ~30 (band 25–35) |
| Solar Pro 4 | listed under Freebuff (terminal-only) and Cline | AA 28 |
| Ling 3.0 Flash · Fin · Tiny | "Efficient model for low-latency assistance, extraction, and routine automation" | AA 25 / none |
| MiniMax M3 | — | AA 29 |
| LongCat 2.0 | no description and no benchmark in these catalogs | AA 20 |
| Nemotron 3.5 Lightning | the smaller Nemotron tier, superseded by 3 Ultra where both are free | AA 14 |
| Ring 2.6 1T · Trinity Large Preview | 1T-parameter tier / 131K context, no description | no figure → light |

**Locks still outrank the rule.** `Any DeepSeek V4 — Forbidden` is a user lock and stays
unlisted whatever its score, and Freebuff rows are terminal-only on this host so they are never
offered. `GLM 5.3 Flash`'s `Dead` promo row does **not** hide it: the lane is live and
selectable, so the rating places it like any other.

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
| 2026-09-26 | Placement rule rewritten: the benchmark decides (AA >= 35 = coding pool, otherwise light), **every model with no published figure is light** unless it is *demonstrated capable* — Space Bunny is the only such row today. Capability notes kept as evidence, no longer placement |
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
