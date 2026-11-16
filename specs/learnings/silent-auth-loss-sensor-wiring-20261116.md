# Learning: a sensor that no CI script runs is not a sensor

**Date:** 2026-11-16
**Class:** `SILENT_AUTH_LOSS` (and the meta-class `UNRUN_SENSOR`: the ratchet was
written, committed, and executed by nothing)
**Symptom:** A real 451-meal account rendered **"Page 1 Of 3"** forever.
**Fixed by:** PR #901 (`9bba318e`) for the defect; this pass for the ratchet.

---

## How the defect happened (short)

`last_active_email` was treated as "signed in". A device whose `auth_token`
expired (or was cleared) restored a credential-less local session, so
`pullAuthHeaders()` sent nothing, `/api/sync/supabase-pull` answered **401**,
`totalFoodsCount` never arrived, and `FoodHistoryTab` fell back to
`loaded rows / 15` = 3 pages. Nothing was logged, nothing was shown.

`#901` fixed it four ways (refresh token at login, `POST /api/auth/refresh`,
never send an expired token, retry one 401, then `auth_session_expired` when the
credential is genuinely gone) and planted
`src/utils/__tests__/sessionRefresh.test.ts` (13 tests) as the sensor.

## The ratchet gap this pass closes

The sensor **landed, was green locally, and ran in no CI script.** Verified on
`9bba318e`:

```
src/utils/__tests__/sessionRefresh.test.ts    NOT WIRED
src/utils/translations.test.ts                NOT WIRED
server_whatsapp.test.ts                       NOT WIRED
```

`test:sync` — the CI step named "Sync regression" — listed seven suites, none of
the three above. So a later edit could delete the refresh path, the
`sessionExpired` wiring, or the WhatsApp refresh half and every check would stay
green.

This is the exact failure `specs/learnings/food-pagination-count-fallback-20260924.md`
records for the count regression: *"the three pagination sensors existed but ran
in NO CI script — that is how this bug recurred three times."* Same repo, same
shape, a month later. The lesson had been written down and the next class of fix
repeated it.

## What changed

1. `package.json` → `test:sync` now also runs
   `src/utils/__tests__/sessionRefresh.test.ts`, `server_whatsapp.test.ts`, and
   `src/utils/translations.test.ts` (10 files / 129 tests, was 7 / 89).
2. `.github/workflows/ci.yml` → the "Sync regression" step carries the reason
   inline, so the next person adding a silent-collapse sensor knows where it
   belongs.
3. `server_whatsapp.test.ts` → the full-flow test now asserts
   `done.refreshToken` matches `^htr\.` **and** differs from `done.token`. Before
   this, deleting the `refreshToken` field from `server_whatsapp.ts` left all 19
   tests green — the WhatsApp-only user could lose the 90-day half unnoticed.

## Red-proof (each mutation restored, suite green again)

| Mutation | Result |
|---|---|
| `isSessionTokenUsable` returns `true` for any token (expired ones sent as-is) | **FAIL 1/13** — `treats an expired htk token as unusable` |
| `en.ts` session-expired copy text replaced with junk | **FAIL 1/8** — `has not silently changed any copy since the split` |
| `server_whatsapp.ts` drop `refreshToken` from the complete response | **FAIL 1/19** — `expect(done.refreshToken).toMatch(/^htr\./)` (before the new assertion: **19/19 PASS**, i.e. no sensor) |

## Rule this leaves behind

> A fix's sensor must be reachable from a CI step in the same commit. "It passes
> when I run it" is not wiring. Check with
> `grep -l <suite> package.json .github/workflows/*.yml` — empty output means the
> ratchet does not exist yet, regardless of what the test file says.

`docs/agent/standing.json` was **not** edited: this is a wiring repair of an
already-walled class, and standing rows are owner memory, not a Builder artifact.
A named standing row for `SILENT_AUTH_LOSS` is the owner's call if they want the
Guard itself to fail on its removal.
