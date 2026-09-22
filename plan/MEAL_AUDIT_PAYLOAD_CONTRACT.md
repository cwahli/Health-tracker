# Meal-Audit Payload & Bundle Contract (v2.1)

**Status:** ACTIVE. Consumed by `scripts/generate-meal-result.mjs`,
`scripts/meal-audit-fetch.mjs`, `scripts/meal-audit-compare.mjs`, and the
`meal-audit-engine` skill. Fixture of record:
`scripts/fixtures/sample_multiturn_meal_audit.json`.

## 1. Input payload (to `generate-meal-result.mjs`)

Top level (single-turn form):

```jsonc
{
  "mealId": "MEAL-…",            // optional; derived if missing
  "bundleName": "Meal-X-01",     // optional; CLI --bundle-name wins
  "timestamp": "ISO-8601",       // optional; clock at write time if missing
  "title": "Chicken Hotpot",     // required in spirit — defaults "Audited Meal"
  "userPrompt": "…",             // optional
  "photos": ["photos/a.jpg"],    // local paths preferred; remote URLs allowed
  "dishes": [ /* ≥1, see §2 */ ],
  "observations": ["…"],         // optional clinical notes
  "generatedBy": {               // optional but recommended (see §4)
    "model": "hermes-free",
    "promptVersion": "meal-audit-engine/2.1.0",
    "date": "2026-09-22"
  }
}
```

Multi-turn form replaces top-level `photos`/`dishes` with `passes[]`:

```jsonc
{
  "title": "…",
  "mode": "multi_turn_flow",     // derived from passes.length
  "passes": [
    {
      "turnIndex": 1,            // required, unique, ascending
      "turnId": "turn_1_initial",// optional; derived
      "userPrompt": "…",         // "" for initial upload
      "addedPhotos": ["photos/turn1_a.jpg"],
      "dishes": [ /* ≥1 per pass once audited */ ],
      "observations": []
    }
  ],
  "generatedBy": { "model": "…", "promptVersion": "…", "date": "…" }
}
```

**Fetch skeleton note:** `meal-audit-fetch.mjs` emits `passes[].dishes = []`
with `_needsAudit: true`. The generator **must** reject an empty dish set on
every pass (fail-loud) — the audit agent fills dishes after reviewing photos.
Placeholder ground truth is forbidden.

## 2. Dish object

```jsonc
{
  "dishIndex": 1,
  "dishName": "Grilled Salmon Bowl",     // exact string; no fuzzy aliases here
  "genericEnglishName": "Grilled Salmon with Rice",
  "sourceImageIndex": 0,                 // index into pass photos
  "boundingBox2D": [ymin, xmin, ymax, xmax], // 0..1000 ints; required iff photos exist
  "estimatedWeightGrams": 420,
  "cookingMethod": "grilled",
  "foods": [
    { "name": "Atlantic Salmon Fillet", "estimatedWeightGrams": 160,
      "cookingMethod": "grilled", "ingredients": ["salmon", "salt"] }
  ],
  "dishNutrients": { /* all 32 NUTRIENT_KEYS — see §3 */ },
  "provenance": {                    // per-field source of truth
    "dishName": "user_confirmed",    // one of the tiers in §5
    "estimatedWeightGrams": "vision_estimate",
    "dishNutrients": "nutrient_db"
  },
  "confidence": "exact"              // "exact" | "estimated"
}
```

- `boundingBox2D`: `[ymin, xmin, ymax, xmax]`, integers in `0..1000`.
  Required when the pass has photos; forbidden-as-placeholder when it has none
  (omit the field or set `null`).
- `aliases[]` (optional, on dish): explicit acronym expansions only
  (e.g. `["OB", "Oatmeal Bowl"]`). Never invent fuzzy matches.

## 3. The 32 canonical nutrients

Source of truth: `src/utils/nutrients.ts` → `NUTRIENT_KEYS` (32 keys).
Core subset for tolerance tiering: `CORE_NUTRIENT_KEYS` (10 keys).
`salt` is display-derived and **not** part of the ledger.

Every `dishNutrients` object and every pass `mealTotals` must carry **all 32
keys** with finite non-negative numbers (1-decimal normalization at write time).

## 4. `generatedBy` harness card

Written into `meal_result.json` top level (and copied into `expected.json`):

```json
{
  "model": "hermes-free | <upgraded-model-id>",
  "promptVersion": "meal-audit-engine/2.1.0",
  "date": "YYYY-MM-DD"
}
```

- Default when omitted: `model: "unknown"`, `promptVersion` from the engine
  skill version, `date` = UTC date at generation.
- CLI override: `--model=<id>` / `MEAL_AUDIT_MODEL` env.
- Every comparison (`meal-audit-compare.mjs`) embeds this card plus site SHA.

## 5. Provenance tiers (priority order)

| Tier | Meaning |
|---|---|
| `user_confirmed` | Bot paused; user confirmed the value |
| `user_provided` | User volunteered the value in chat |
| `ocr_label` | Read from on-image label / package |
| `user_instruction` | From debug conversation (W2 edits; authoritative for edits) |
| `nutrient_db` | Brand/USDA-style lookup by identified food |
| `vision_estimate` | Model guess |

`confidence: "exact"` requires no `estimated`-tier values among **core**
nutrients. Otherwise the bundle is `DRAFT` with gaps listed in `meal_result.md`.

## 6. Pause-for-confirmation protocol (W1)

1. Trigger: the product meal flow asks the user to confirm a dish/weight, OR a
   core nutrient estimate is low-confidence.
2. Bot sends **one** message listing uncertain items + candidate weights.
3. Wait bounded (default 5 min) for the reply.
4. Answers → `user_confirmed` provenance; proceed.
5. No reply → keep `vision_estimate`, mark bundle `DRAFT`, continue.
6. Record the pause and outcome in `Instruction.md` and the pass `userPrompt`.

## 7. Output bundle layout

```
Meal-<slug>-NN/
├── meal_result.json       # canonical ledger + generatedBy + provenance
├── meal_result.md         # human report (+ W3 comparison table when present)
├── Instruction.md         # per-pass replay + pause/confirm record
├── expected.json          # QA contract (tolerances live in compare.mjs §3)
├── comparison.json        # (W3 / post-QA) verdicts + taxonomy codes
├── meal_annotated[_turnN].svg
└── photos/                # LOCAL files only (EXIF/GPS scrubbed before git)
```

Naming: `Meal-<sanitized-title>-NN` with `NN` auto-incrementing on collision
(`01`, `02`, …). Never ship `MEAL-<timestamp>-<rand>` as a bundle name.

## 8. Tolerance matrix (consumed by compare.mjs)

| Check | Tolerance |
|---|---|
| OCR / label text | exact (whitespace-trimmed) |
| Meal / dish name | exact (case/punct/spacing normalized; acronyms via `aliases[]` only) |
| Core nutrients (10) + total weight | ≤10% |
| Remaining nutrients (22) | ≤30% |
| Bounding box (photos present) | IoU ≥ 0.5 |
| Atwater energy balance | ≤10% (always runs) |
| Turn structure | exact — mismatch ⇒ `DIVERGED` |

Failure taxonomy: `name_mismatch, portion_bias, core_nutrient_drift,
micro_nutrient_drift, bbox_drift, edit_not_applied, turn_mismatch, ocr_error`.

## 9. Holdout & Telegram delivery

- Holdout bundles live in `artifacts/meal_audits/holdout/` (gitignored).
- To deliver a report/photo to the user on Telegram, emit a line:

  ```
  MEDIA:/absolute/path/to/meal_result.md
  ```

  on its own line in the bot reply (see `scripts/skills/telegram-photo/SKILL.md`).
  Use absolute paths; never wrap `MEDIA:` in prose or code fences.

## 10. Issue ledger (non-golden findings)

Append one JSON line per finding to
`artifacts/meal_audits/issue_ledger.jsonl`:

```json
{"id":"MAI-YYYYMMDD-NNN","bundle":"Meal-X-01","turn":2,
 "taxonomy":"core_nutrient_drift","key":"protein","expected":46.5,"actual":38.1,
 "deltaPct":18.1,"status":"open","bugId":null,"createdAt":"…","resolvedAt":null}
```

Statuses: `open → ticketed → fixed → verified → closed`.
Promotion into `golden/meal/` is **never** automatic — explicit user request only.
