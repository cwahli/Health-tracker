# Biomarker fill-template prototype

**Contract (do not fork):** [TEMPLATE.md](./TEMPLATE.md) · `template.ts`

Hits: back-office locks dictionary slots and computes **sanitized** status; the agent only writes **medical insight** (and overlay if needed). Optimal = one sentence; else status + profile + trend.  
Misses: pending `newCatalogDraft`.  
Turns: TypeScript packs rows from an **output-token budget** (`OUTPUT_TOKEN_BUDGET` in `template.ts`). Hits are cheap so more fit in one turn than new-key drafts. The model does not pick batch size.

```bash
./node_modules/.bin/tsx prototype/biomarkers/runner.ts --only C2 --dry-run
./node_modules/.bin/tsx prototype/biomarkers/runner.ts --only C2
```

Loads `GEMINI_API_KEY` from this repo `.env` or `~/src/Health-tracker/.env`.
