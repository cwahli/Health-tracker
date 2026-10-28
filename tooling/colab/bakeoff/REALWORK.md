# Real-work ledger (continuous model scoring)

Every real Colab coding job (real Sage tasks, not the fixed bake-off tasks) gets ONE row in `/content/bakeoff/realwork.jsonl` when it finishes.
The ranking lives in `/content/bakeoff/RESULTS.md` between `<!-- REALWORK:BEGIN -->` and `<!-- REALWORK:END -->` and is rebuilt on every logged row.

## Row format (JSON Lines, append-only)

| field | meaning |
|---|---|
| `ts` | time logged, Europe/London with offset |
| `job` | tmux job id, e.g. `mtd-quiz-figma-2` (optional) |
| `task` | short task id or title |
| `model` | exactly as opencode names it, e.g. `ollama/bench-qwen38r`, `opencode/mimo-v2.6-flash-free` |
| `difficulty` | `easy` or `hard`. **hard** = multi-file, layout/Figma, or test-preserving work (must keep existing tests/checks green). Anything else is easy. |
| `hard_reason` | for hard rows: `multi-file`, `layout/figma`, `test-preserving` (or a combination, comma separated) |
| `verified` | `true` / `false` from the REAL check or live verification (Playwright, the repo's gates, a visual check against Figma). `null` = not verified yet (kept out of the rates until you append a corrected row, see below). Never `true` just because the model said so. |
| `how` | the check you ran, e.g. `node tooling/check-spacing.js --selftest + playwright live spec` |
| `fake_success` | `true` if the model claimed done/passing but verification failed, or it changed nothing |
| `retries` | extra attempts after the first (0 = one-shot) |
| `wall_s` | total wall seconds for the job including retries |
| `notes` | one line, no secrets |

Fixing a row: do not edit the file; append a new row for the same `job`+`task`+`model`. When the summary is rebuilt, the LAST row per (job, task, model) wins (so a `null` row is replaced by the verified one).

## How a job coordinator logs a row

Python:
```python
import sys; sys.path.insert(0, '/content/bakeoff/harness')
import realwork
realwork.log_row(model='ollama/bench-qwen38r', task='mtd-quiz-figma-2', difficulty='hard', hard_reason='layout/figma,multi-file',
                 verified=True, how='quizcheck.js + live Playwright at 1280x720', wall_s=1260, fake_success=False, retries=1, job='mtd-quiz-figma-2')
```
Shell:
```bash
python3 /content/bakeoff/harness/realwork.py log --model ollama/bench-qwen38r --task mtd-quiz-figma-2 --difficulty hard \
  --hard-reason layout/figma,multi-file --verified true --how 'quizcheck.js + live Playwright' --wall-s 1260 --retries 1 --job mtd-quiz-figma-2
# --verified pending  logs an unverified row; --fake-success flags a claimed-but-failed job
python3 /content/bakeoff/harness/realwork.py summary   # rebuild the RESULTS.md block only
```
Appends are file-locked, so several coordinators can log at once.

## How the ranking works
Per model, separately for easy and hard jobs: verified success rate (verified passes / verified jobs) ranks first; more verified jobs ranks next (more evidence); median wall time of passing jobs is only the last tiebreak. Fakes and retries are shown but do not change the rank.
Pushing: run `persist()` from `harness/bench.py` (or the usual bakeoff push) to publish `RESULTS.md`; `realwork.jsonl` is copied by the summarize/persist step as noted in `RESUME.md`.
