It's a 2 user pass. Contracts: `expected.json`.

1st pass:
No query. User sends the 4 pictures.

Requirement
- OCR the stickers (Granola, Vegetarian wrap, Grilled Chicken & Avocado Salad)
- Identify the 4 dishes: granola pot, vegetarian wrap, chicken avocado salad, croissants
- Resolve components from the dictionary. Do not bind berries to Powerade, almonds to Yolk dessert, raisins to oatmeal, greens to taro, yogurt to water, granola to a Co-op pot, falafel to the whole wrap

2nd pass:
Query: "I ate this croissant"
Photo: Edit croissant.png

Update the croissant row only. Recalc that item and the meal total. Do not start a new meal.
