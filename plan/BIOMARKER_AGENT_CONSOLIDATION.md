# Biomarker agents — seven names, task packs

**Product:** one `LogChat` modal. **Picker:** seven agents. **`task`** selects the instruction pack. Opposite write-laws never share a prompt.

Canonical ids: `front_desk` · `agent1` · `biomarker_review` · `catalog_clean` · `data_review` · `health_baseline` · `agent4`.

See `src/utils/biomarkerAgentPacks.ts` and `docs/agent/domains/biomarkers.md` §3.

| n after TypeScript | Agent | Task |
|---|---|---|
| 1–5 add/fix/flagged | Review | `fix` |
| Incoming vs current diff | Review | `compare` |
| Report leftovers | Lab Parser | `lab_extract` (15–25) |
| Hygiene leftover of one field | Catalog Cleaner | one of `units` / `category` / `aliases` / `default_range` |
| Overlay stale ∩ `rangeVariesBy` | Range Calibrator | `overlay` |
| Use | Health Coach / Test Planner | `targets`/`today` · `gaps`/`literature` |
| Route / profile | Front Desk | `route` — **no lab writes** |

Shipped in this tree: leftover-only Parser / overlay-stale Calibrator on the LogChat wire; Diagnostic leftover buttons open LogChat; Home Coach today; in-chat seven-agent switcher; instruction viewer display names; Catalog apply no longer rewrites log numbers.

Still aliased (not deleted): `server.ts` instruction blocks; Insight `/insight-analyze` remains the structured report endpoint for Coach targets.
