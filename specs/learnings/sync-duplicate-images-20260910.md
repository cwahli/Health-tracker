---
slug: sync-duplicate-images
date: 2026-09-10
class: PROCESS_GAP
node: Builder
status: promoted
---

# Learning: first image fix was tested on Sync, not Log

## What happened
User: duplicate photo after Sync. Planner hypothesized r2.dev vs `/photos/` same key.
Builder shipped `uniqueMealImageUrls` keyed by `photoKeyFromUrl` + tests for that pair only.
Guard: named vitest for that pair PASS. User still reviewed live.
User then: duplicate **worse on Log** — two tofu + peanuts. Evidence: `data:image/…` (capture) kept next to `/photos/job_….jpg` (upload). Different keys, so unique-by-key did not collapse.
Second repair: drop `data:`/`blob:` when any durable URL exists. Tests added. User should not have been the second test runner.

Reviewer was **not** invoked after the first incomplete fix (skill says second Guard fail or human ask). Guard had not failed on the log path because **no test encoded it**.

## What the user asked
Stop live-reproducing basic display bugs. Learner should look at the run and improve tests/process. Image dup should be proven in vitest before human review.

## Keep
- `uniqueMealImageUrls` durable-over-ephemeral
- Test: data: + `/photos/` → only `/photos/`
- Test: data:-only (pre-upload) still shows
- Do not require the human as ImageSlider QA

## Propose standing (add only)
```json
{
  "id": "meal_image_unique",
  "label": "Meal image lists: one URL per capture; drop data:/blob: when /photos/ or https exists",
  "asked": "repeated",
  "files_must_contain": {
    "src/utils/foodImageSources.ts": ["uniqueMealImageUrls", "startsWith('data:')"],
    "src/utils/foodImageSources.test.ts": [
      "drops data: copies once the same captures exist on /photos/",
      "keeps local data: URLs when nothing has been uploaded yet"
    ]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: For DISPLAY_DUP / photos, packet Test plan must include **Log** (`data:` + `/photos/`) and **Sync** (r2 vs proxy), not only the first hypothesis.
- builder: Do not ask the human to reload until those two uniqueMealImageUrls cases PASS. ImageSlider must call uniqueMealImageUrls, not a second unshift of `singleImage`.
- guard: If `foodImageSources` / `foodLogDedupe` / `ImageSlider` changed, run `npx vitest run src/utils/foodImageSources.test.ts src/utils/foodLogDedupe.test.ts` (not only Playwright chrome).

## Do not
- Delete standing rows
- Merge journey packs
- Edit Guard scripts in this file’s promote
- Use the human as the log-path test
