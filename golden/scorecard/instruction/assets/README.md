# Scorecard assets (imagery)

Do not duplicate meal binaries here. Canonical photos live under `golden/meal/`. Journeys use those files; this table is the agent map.

## Meal log (Mode A)

| Case | Photos |
|---|---|
| Meal_01 multi-turn | `golden/meal/Meal_01/photo_01.jpg` … `photo_05.jpg` |
| Meal_04 01 Yolk panini | `golden/meal/Meal_04_log/01_branded_plate/photos/01_yolk_panini_wrap.jpg` |
| Meal_04 02 Lidl muffin | `golden/meal/Meal_04_log/02_lidl_packaged/photos/02_lidl_chicken_muffin.jpg` |
| Meal_04 06 Indo menu | `golden/meal/Meal_04_log/06_menu_receipt_log/photos/06_indonesian_menu_page_1.jpg` + `_2.jpg` |
| Meal_04 08 oats | `golden/meal/Meal_04_log/08_oats_label/photos/08_rolled_oats_1.jpg` + `_2.jpg` |
| Meal_04 09 plates | `golden/meal/Meal_04_log/09_restaurant_plates/photos/09_steak_fish_chips_1.jpg` + `_2.jpg` |
| Meal_04 10 barcode hotpot | `golden/meal/Meal_04_log/10_barcode_hotpot/photos/` |
| Meal_04 11 seafood + oats | `golden/meal/Meal_04_log/11_seafood_oats/photos/` |

Instruction + expected per case: `golden/meal/Meal_04_log/<case>/`.

## Compare (Mode D) — 6 sets

Photos: `golden/meal/Meal_03_compare/set1_*.jpg` … `set6_*.jpg`.  
Contract: `golden/meal/Meal_03_compare/expected.json` + `Instruction.md`.  
Do not score J-ID-02 Silverqueen as the 6-set.

## Indo journeys (Localization + meal/compare/desk)

Contracts (not photos): `instruction/journeys/J-ID-01_*`, `J-ID-02_*`, `J-ID-03_*`.  
Persona lock: Sari F18 / **140 cm** / **40 kg** / **1350 kcal** / `preferred_language=id`.  
Live dumps from prior soaks: `golden/scorecard/past/live_debug/`. New live dumps: `golden/scorecard/current/debug/`.

## i18n leak evidence

Screenshots of raw keys on auth/profile (class `LEAK_KEY`): `instruction/i18n/evidence/`.
