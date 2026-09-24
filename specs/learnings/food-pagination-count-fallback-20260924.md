# Learning: Food Pagination Count Fallback (Recurring Regression)

**Date:** 2026-09-24  
**Class:** `ALWAYS_COUNT_FALLBACK` — server-side count query failure silently collapses to page-slice length  
**Symptom:** Food history shows ~2 pages on mobile (cellular/slow net) instead of 13 on desktop (fast WiFi)  
**Bug fixed:** At least 3 times without leaving a sensor. Re-appeared after each unrelated edit.

---

## Root Cause

### Layer 1 — `server_db_d1.ts:401-403` (primary)

`d1PullSync` runs 5 D1 queries concurrently via `Promise.all`. The count query:
```ts
const countFoodSql = `SELECT count(*) as cnt FROM food_logs WHERE firebase_uid IN (...)`;
```

When the Cloudflare D1 HTTP API returns an error (rate-limit, network blip, timeout on slow mobile networks), `countFoodRes.success` is `false`, and the fallback is:

```ts
const totalFoodsCount = countFoodRes.success && countFoodRes.results?.[0]?.cnt != null
  ? Number(countFoodRes.results[0].cnt)
  : rawFoods.length;   // ← BUG: rawFoods is only the first page (pageSize=15–30)
```

`rawFoods.length` at initial sync = 15–30 items (1–2 pages). UI shows `Math.ceil(30 / 15) = 2 pages`.

### Layer 2 — `server_routes_sync.ts:516` (amplifier)

```ts
totalFoodsCount: totalFoodsCount ?? activeFoods.length,
```

If D1 is not configured (edge case), `activeFoods.length` is the same small slice.

### Layer 3 — `useAppSync.ts:731` (sticky)

```ts
if (typeof fetchedTotalFoods === 'number' && fetchedTotalFoods > 0) {
  setTotalFoodsCount(fetchedTotalFoods);
}
```

Once a bad value (30) is set, subsequent incremental polls that also return 30 don't correct it.  
A correct 195 value does update it — but only on a full force-pull or a page reload where the count query succeeds.

### Why mobile-only

Mobile (cellular) networks have higher latency + more packet loss. The 5-query `Promise.all` in `d1PullSync` has no per-query timeout. Cloudflare D1 HTTP API on a slow mobile connection is more likely to time out or return a rate-limited error for the `count(*)` query specifically, because all 5 queries fire simultaneously.

---

## Fix Required

**In `server_db_d1.ts` — separate the count query from the main 5-query batch and add a retry:**

```ts
// Separate count query with 1 retry to prevent fallback to rawFoods.length on transient failure
let countFoodRes = await d1Query<any>(countFoodSql, possibleUids);
if (!countFoodRes.success) {
  // Retry once after brief wait — transient D1 HTTP failure
  await new Promise(r => setTimeout(r, 300));
  countFoodRes = await d1Query<any>(countFoodSql, possibleUids);
}
```

Or change the fallback to `undefined` rather than `rawFoods.length`, so the UI keeps its previous good value instead of regressing to a small number.

**In `server_routes_sync.ts` — never fall back to `activeFoods.length` for totalFoodsCount:**
```ts
totalFoodsCount: totalFoodsCount,  // omit if undefined; client keeps last good value
```

**In `useAppSync.ts` — keep the existing guard `> 0` but also protect against downward regression:**
```ts
if (typeof fetchedTotalFoods === 'number' && fetchedTotalFoods > (totalFoodsCount ?? 0)) {
  setTotalFoodsCount(fetchedTotalFoods);
}
```

---

## Sensor Required (Hashimoto's Ratchet — Rule L17)

**Must be added to `docs/agent/standing.json` as a named vitest row:**

File: `src/utils/__tests__/foodPaginationCount.test.ts` (create new)

```ts
describe('food-pagination count fallback', () => {
  it('totalFoodsCount from supabase-pull always >= foods.length returned in same response', () => {
    // Simulate the D1 count failing and falling back to rawFoods.length
    // Assert that the server never returns totalFoodsCount < actual DB total
    // (This is a contract test against the server response shape)
  });
  
  it('FoodHistoryTab totalPages uses totalFoodsCount not filteredLogs.length when no search', () => {
    // Unit test: render FoodHistoryTab with totalFoodsCount=195, combinedItems=15
    // Assert totalPages = Math.ceil(195/15) = 13
    // Assert pagination shows "Page 1 of 13"
  });
});
```

**Must also add a Playwright check to `prototype/tests/food-history-pagination.spec.ts`:**
- Navigate to the food history tab on a fresh session (simulate mobile viewport)
- Assert that the page count shown is equal to `Math.ceil(totalFoodsCount / 15)`, not 2

---

## Proposed Standing Rows

```json
{
  "id": "food-pagination-count-not-fallback-to-slice",
  "suite": "node scripts/assert-shell-smoke.mjs",
  "description": "FoodHistoryTab totalPages computed from DB count, never from page-slice rawFoods.length",
  "sensor": "src/utils/__tests__/foodPaginationCount.test.ts",
  "class": "ALWAYS_COUNT_FALLBACK",
  "added": "2026-09-24"
}
```

---

## Prevention

1. The `d1PullSync` count query must **always** be retried at least once before using `rawFoods.length` as a fallback.
2. The `totalFoodsCount` on the server response should never be set to `activeFoods.length` — if the count is unknown, omit the field (`undefined`), so the client retains its last good value.
3. The client must never regress `totalFoodsCount` downward (the `> prev` guard).
4. A Playwright smoke test on mobile viewport must assert page count ≥ 3 for a user with >30 food logs.

---

## Why It Keeps Re-Appearing

- **No sensor existed** in `docs/agent/standing.json` for FoodHistoryTab pagination.
- **No Playwright spec** in `prototype/tests/` targeted pagination count accuracy.
- The `assert-shell-smoke.mjs` suite does not test the food history tab's page count.
- Builders touching `FoodHistoryTab.tsx`, `useAppSync.ts`, or `server_routes_sync.ts` had no guard telling them they broke the pagination invariant.
- The fix is easy to undo accidentally: any change to `server_routes_sync.ts` that touches the response shape or any change to `d1PullSync` that changes the query batch can silently re-introduce the fallback.

---

## Promote to Standing

Add the sensor row above to `docs/agent/standing.json`. The Builder that implements the fix must run `node scripts/assert-shell-smoke.mjs` (which must include the new Playwright spec) before pushing.
