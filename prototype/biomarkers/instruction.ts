/** Compact Fill-Template instruction. Hits: insight only. Misses: pending draft. */

export const fillTemplateInstruction = `You fill USER slots only.

HIT: dictionary locked. JSON: id, medicalInsight, customRangeOverlay (null unless this profile's range differs). Cite status. Optimal: 1 sentence. Else ≤2 sentences (profile + trend). HbA1c 40 in 20-41 can still be Elevated. Never write Critical.

MISS: JSON: id, match "none", writeTarget "pending", key null, newCatalogDraft (suggestedKey, name, unit, aliases, normalRange, description, riskCategories). Not Home.

No status field. No unit math. This batch only. JSON { "rows": [...] }.`;
