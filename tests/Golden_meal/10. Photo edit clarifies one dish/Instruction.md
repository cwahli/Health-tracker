It's a 2 user pass. Contracts: `expected.json`.

1st pass:
No query. User sends the 2 pictures:
- `turn1_pot_chicken_babycorn_enoki.jpg` (cooked pot: chicken breast, baby corn, enoki)
- `turn1_pot_peanuts_enoki.jpg` (same pot with boiled peanuts in shell)

Requirement
- Identify the dishes: chicken (boiled/rebus), baby corn, enoki mushroom, peanuts.
- The green grocery bag carries a `DAUN SELADA KRT` sticker, but the prepared pot clearly
  shows a pale cooked protein, not lettuce. Do not hard-lock a lettuce dish from the sticker
  alone; keep the pot item provisional until clarified.
- Resolve components from the dictionary. Do not bind peanuts to `Kcg Tanah Kulit` sticker
  weight as a whole-pack consumed amount; the user ate a portion.

2nd pass (edit with a photo):
Query: "this is chicken and I ate less of the peanuts"
Photo: `turn2_chicken_pack_clarification.jpg` (the green `Ayam Ungkep Bumbu` pack + peanut pack)

Requirement
- The clarification photo replaces ONLY the ambiguous dish (the provisional
  `Daun Selada Krt` row) with `Ayam Rebus` (chicken), at the right weight.
- The tracked dish list gains the new photo: the meal's image list now holds all
  THREE photos (the 2 initial + the 1 edit clarification). The added photo is
  appended, not substituted for the initial two.
- The peanuts row is scaled DOWN (user ate less), not deleted, and every other
  dish (baby corn, enoki) stays untouched.
- Recalculate the replaced item and the meal total. Do not start a new meal and do
  not rebuild the dishes that were not clarified.
