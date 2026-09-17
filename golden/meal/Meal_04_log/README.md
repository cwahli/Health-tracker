# Meal_04_log — Mode A meal-log golden suite

Canonical **meal log** benchmark reference (parity with Meal_03_compare’s rigor).

**Required model:** `gemini-3.5-flash-lite`

## Cases
| Slug | Proto | Input types |
|---|---|---|
| `08_oats_label` | 08 | nutrition_label, portion_clarify_edit |
| `02_lidl_packaged` | 02 | brand_packaging, prepared_plate |
| `10_barcode_hotpot` | 10 | barcode, grocery_receipt_prep |
| `11_seafood_oats` | 11 | receipt_ocr, ingredients_photo, bracket_text_edit |
| `06_menu_receipt_log` | 06 | restaurant_menu, receipt |
| `09_restaurant_plates` | 09 | restaurant_plate, multi_image |
| `01_branded_plate` | 01 | branded_restaurant_plate |
| `12_chat_saved_meal` | — (app chat journey) | chat_compose_photo, brand_autocomplete_chip, saved_meal_chip, intray_portion_edit, photo_note, post_log_add_remove_edit |

## Artifacts per case
`photos/`, `Instruction.md`, `expected.json`, `correct_results.md`, `benchmark_result.md`, `MODEL.md`, `debug_runs/`

## Harness
Prototype runner: `prototype/meallog/runner.ts` — **harness only**. Truth lives here under `golden/meal/`.

## Related
- Edit multi-turn: `golden/meal/Meal_01`
- Multi-photo split: `golden/meal/Meal_02`
- Compare Mode D: `golden/meal/Meal_03_compare`
