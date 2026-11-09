# Gemini / Antigravity

Same process as Grok and AI Studio. Do not invent a second one.

1. Read **`AGENTS.md`** first (load map + journey rule 6).
2. Open-ended “review / improve / journey” → **`docs/agent/JOURNEY.md`**. Planner packet, then **wait for go**.
3. Skills (load one): `.agents/skills/{planner,builder,guard,reviewer}/SKILL.md`
4. Guard is a script, not a vibe: `node scripts/journey-guard.mjs`
5. Standing: `docs/agent/standing.json` — do not drop rows to pass.

Execute remaining product work from `plan/ROADMAP.md` **Current work**. Locked packets in `specs/active/` are pre-approved **go** — do not wait for Grok quota. Git is shared memory across Studio, Antigravity, OpenCode, Cline, and Grok.
## Proto-first (2026-11-09)

All user-visible work lands on `proto.health-tracker.co.uk/ht/` first, with live proof. Only the human's **`go for dev`** promotes it to `health-tracker.co.uk` (`main` + deploy). See `docs/agent/PROTO_FIRST.md`. Sensor: `node scripts/assert-proto-first.test.mjs`. Every surface reads the same file — do not invent a second preview URL.
