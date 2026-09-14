# Required scoreboard dimension: MULTI-AGENT CONTINUITY

This product is a multi-agent process (Front Desk / receptionist → Health Coach → food/meal/compare agents, and back). Scoreboards MUST include explicit PASS/FAIL criteria for continuity **between agents**, not only within one chat turn.

## Must cover (adapt per journey)
1. **Handoff payload integrity** — from/to agent, same jobId/correlation id; required profile keys survive (age/height/weight/lang/goals/targets); keys not silently dropped (ref handoffContract / RELIABILITY receptionist pack).
2. **Downstream uses upstream context** — Health Coach (or food agent) acts on desk-gathered facts; does not re-ask everything already collected; does not invent conflicting vitals.
3. **No wrong-agent leakage** — Front Desk is not a second meal analyzer; meal agent is not a substitute for coach diagnostics when handoff was to coach.
4. **Return / multi-hop continuity** — if user goes desk → coach → meal → desk again, prior meal + targets + persona still known.
5. **Language continuity across agents** — every agent in the chain answers fully in Indonesian when lang=id.
6. **Debug evidence** — helpdesk/multi-agent E2E debug dump shows handoff chain + each agent I/O once.

FAIL examples: coach ignores BMI/guardrail already set by desk; meal log loses profile calorie cap; compare forgets persona; second desk turn blank slate; English reply after Indonesian desk turn.
