# plan/

**Start here:** [ROADMAP.md](./ROADMAP.md)

| File | Pillar |
|---|---|
| [ROADMAP.md](./ROADMAP.md) | Execute — all tracks |
| [BIOMARKER_LIFECYCLE.md](./BIOMARKER_LIFECYCLE.md) | 1 Architecture |
| [FOOD.md](./FOOD.md) | 2 Pipeline + meal |
| [RELIABILITY.md](./RELIABILITY.md) | 3 Infra / quotas |
| [QUALITY.md](./QUALITY.md) | 4 Test method |
| [BIOMARKER_FILL_TEMPLATE_CASES.md](./BIOMARKER_FILL_TEMPLATE_CASES.md) | Fill-template prototype C1–C7 remaining work (not a fifth pillar) |
| [VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md) | Ops — OVH VPS-2, mobile → VM, then live site (not a fifth pillar). **Track V.** |
| [DATA_PLANE.md](./DATA_PLANE.md) | Ops — one SQL (D1 now). SQLite on VPS is a **benchmark gate**, not a cutover. **Track D.** Supersedes R-5. |
| [R2_STORAGE_AUDIT.md](./R2_STORAGE_AUDIT.md) | Muse/OpenCode 2026-09-20 storage audit (D1 vs 402 Supabase vs R2). Input to Track D (**D-1 / D-9 / D-10**). Companion [R2_DELETE_CANDIDATES.json](./R2_DELETE_CANDIDATES.json) is **not** a delete job until D-10. |
| [GCP_FREE_TIER_MIGRATION.md](./GCP_FREE_TIER_MIGRATION.md) | **SUPERSEDED.** Cloud Run free-tier origin. Archive copy in `plan/archive/`. |

`archive/` = completed or abandoned sources (text already merged into the five files above).

Cloudflare **storage** (R2 + D1) stays until Track D says otherwise ([DATA_PLANE.md](./DATA_PLANE.md)). **Live Node origin** is Track V / **R-13.1** on VPS-2 ([VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md)), not Pages Functions and not Cloud Run. Do not add a `plan/CLOUDFLARE.md`. Do not add VPS SQLite as a second live database.

There is **no** `studio/` folder. IDs live on [ROADMAP.md](./ROADMAP.md). AI Studio works that file’s **Current work**. Method: [QUALITY.md](./QUALITY.md) §1.4. `FOOD_SINGLE_PATH.md` is leftover F-8.10/12/13. F-9.5 is App poller only. F-1/F-2 USDA **abandoned** (delete is **F-12**). Brand-catalog self-clean is **F-11** ([FOOD.md](./FOOD.md) Part A). Root `ROADMAP.md` is a stub.
