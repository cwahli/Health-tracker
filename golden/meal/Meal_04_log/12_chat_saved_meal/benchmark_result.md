# Benchmark result — chat-modal meal (case 12)

**Model:** gemini-3.5-flash-lite
**Status:** LIVE PASS (2026-09-17, local `:3000`, 8 s + 8 s)
**Ground truth:** [correct_results.md](./correct_results.md) (FINAL, 32-key ledger)

| Metric | Target | Live | Pass |
|---|---|---|---|
| Turn-1 identity (3 dishes, no phantoms) | coffee + Big Mac + coconut | 3/3 | ✅ |
| Turn-1 Big Mac label lock | 508 kcal @215 g exact | 508 | ✅ |
| Turn-1 unsweetened note honored | reply confirms no added sugar | confirmed | ✅ |
| Turn-2 coconut removed | absent | absent | ✅ |
| Turn-2 oats added | 40 g row present | 130 kcal est. | ✅ |
| Turn-2 retained rows verbatim | coffee 43 + burger 508 | exact | ✅ |
| Turn-2 column sums = totals | 681 / 33 / 73 / 27.7 / 952 | exact | ✅ |
| Estimates in bands | coffee + oats bands | inside | ✅ |
| Debug captures | turn0/1/2 md+json | 6 files | ✅ |

Eval owner = frozen GT + script (builder ≠ scorer): reruns assert
`expected.json` bands + exact turn-2 sums via
`tests/golden_meal12_chat_saved_meal.test.ts`; live soak behind server + key.
