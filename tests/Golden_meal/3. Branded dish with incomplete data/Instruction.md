It's a 2 user pass:

1st pass:
No query, user send 2 pictures

Requirement
- Must be able to correctly identify the brand food and match them against existing Yolk database with correct meal
- Must be able to work with some meal having 8 core nutrition data and other having only calorie then extrapolate the full 32 nutrients calculation from it
- Scout calorie estimation will be overwrite when brand data is present but kept when it isn't

2nd pass:
"I only ate half of the potatoes"

The final result should be able to correctly update the calculation with new recommendation and new nutrients calculation.