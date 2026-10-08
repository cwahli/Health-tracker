# Meal live proof — mandatory for every meal/food-entry bug fix

A meal ticket is NOT solved without this process. Unit tests green is not
proof. A fix merged is not proof. Only a live meal run with a screenshot
counts, and the screenshot must show the result as the user sees it.

## The 6 steps (in order, no skipping)

1. **Look up the job work.** Find the card in `bugctl queue --json`
   (or the packet: `bugctl packet --id #N --json`). Note the `job_id`.
2. **Look at the debug file.** Read the debug bundle on the card
   (`photo_urls`, `debug_url`) and any `qa-evidence/` material for the run.
   If the job/debug aged out of the queue, re-file the meal live first
   (labeled PROOF card, cleaned up after) so steps 3–5 run on real bytes.
3. **Reproduce the exact meal entered.** Same picture uploaded, same exact
   user message — verbatim, never a paraphrase, never a synthetic stand-in.
4. **Pass it live.** Run it through the live app chain with live data
   (dev server against live backends or prod where the packet says so).
5. **Screenshot live (chromium/headless).** Capture the loaded result
   screen showing the bug is fixed — loaded-with-data, seen. One shot per
   proof point. `meal-qa-l18.mjs` is the reference for app-picture capture.
6. **File + review.** PNGs go in the ticket's Drive `Work done/<key>/`
   folder, link in `Completion proof`, then `Status=review`. Text-only
   proof (logs, JSON, md) never closes a meal ticket.

## Standing rule

Terminal-only evidence (vitest, assert scripts, `tsc`) proves the code;
only the 6-step live meal run proves the fix. A `done`/`Done` without
the PNGs is invalid and must be reopened and redone.
