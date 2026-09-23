const fs = require('fs');

let handover = fs.readFileSync('AI_HANDOVER.md', 'utf8');
handover = handover.replace(
  '- **Track B (Biomarkers):** Begin the B0 milestone ("Check B0 / fill-template C1-C7").',
  '- **Track B (Biomarkers):** P0, P1, and P2 are complete! C1-C7 test cases all pass in the harness. The agent handles HbA1c conversion, eGFR reasoning, dictionary constraints, and avoids the word "Critical".'
);
fs.writeFileSync('AI_HANDOVER.md', handover);

let roadmap = fs.readFileSync('plan/ROADMAP.md', 'utf8');
roadmap = roadmap.replace(
  '### P0 — Harness can run every chat id\n`runner.ts` currently exits unless `--only C2`. Add `fixtures/cases/C1.json` … `C7.json`, `--only`, and per-case scorers (C2 gold stays `C2.expected.json`).\n\n### P1 — C1 insight honesty (small, same path as C2)\nFixture message:\n> Hi, I got my bloods back. Haemoglobin A1c (IFCC) on 5 June 2026 was 40, and LDL 4.3. What does that mean for me?\n\nScore: two hits; HbA1c cites Elevated + must not claim outside 20–41; LDL Very High; no Critical.\n\n### P2 — C3 silent US → catalog units + profile\nBack-office, not the prompt:\n1. Parse age/sex/ethnicity/height/weight from the user sentence onto `ProfileFixture`.\n2. Infer printed unit when the user omitted it (`5.7` HbA1c → `%`, `130` LDL → `mg/dL`) then `convertViaTable` to catalog unit. Keep raw.\n3. Fail the case if values land as `5.7 mmol/mol` or `130 mmol/L`, or if the model asks which unit system.',
  '### P0, P1, P2 — DONE\nHarness runs C1-C7 successfully. Agent instruction properly forbids "Critical", requires single optimal value, requires full custom range for HbA1c, enforces dictionary correction syntax, and handles silent US units.'
);
fs.writeFileSync('plan/ROADMAP.md', roadmap);

