# GCP Cloud Run (Option A) — SUPERSEDED

**Status:** SUPERSEDED 2026-09-19.  
**Replacement:** [plan/VPS2_MOBILE_DEV.md](./VPS2_MOBILE_DEV.md) (OVH VPS-2, mobile → VM, then live site).  
**Archive copy:** [plan/archive/GCP_FREE_TIER_MIGRATION.md](./archive/GCP_FREE_TIER_MIGRATION.md)

Do not deploy Cloud Run `min-instances = 0` as the production origin. It still scales to zero (first-hit pause; in-memory meal jobs die). Do not start a second Cloud Run go-live in the same tree as Track V or R-13.1.

R-13.1 host is the VPS (`node dist/server.cjs` behind Caddy), not Cloud Run and not Cloudflare Containers.
