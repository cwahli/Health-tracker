# Resuming the paused hard-task benchmark

Paused on request (chiwah: Colab is for real work). The driver was stopped by exact PID right after the run in flight was recorded and pushed to the `bakeoff-results` branch.

## State
- Driver: `/content/bakeoff/harness/hard_driver.py`. State is derived from `/content/bakeoff/results.jsonl`, so it is resumable: finished runs are skipped.
- Rounds: `/content/bakeoff/hard_rounds.json` = [11, 6, 7, 12]. t11 is the REVISED v2 task (see `suite/T11-revision.md`); the 18 v1 t11 rows are archived in `suite/archive/t11-v1/` and do not count.
- `suspect_tasks.json` and `capgap_tasks.json` are `[]`. Eliminations are recomputed from results.jsonl on start.
- Log: `/content/jobs/harddriver/out.log`.

## Resume command (run on the Colab box, as root)
```bash
tmux new-window -d -t colabjob-harddriver -n driver4 'cd /content/bakeoff && python3 /content/bakeoff/harness/hard_driver.py 2>&1 | tee -a /content/jobs/harddriver/out.log'
```
(If the tmux session `colabjob-harddriver` is gone: `tmux new-session -d -s colabjob-harddriver '<same command>'`.)

Before resuming, check no other job is using the GPU (`nvidia-smi`, `ollama ps`) and that no stray driver is running (`ps -eo pid,cmd | grep '[h]ard_driver.py'`). Stop it again the same way: wait until the log shows a `  -> ` result line followed by `persisted:`, then `kill <exact driver PID>`; never `pkill -f`.

Startup `restore()` pulls results.jsonl from the `bakeoff-results` branch if the branch has more rows than the local file, so keep the branch and local file in sync (run `persist()` after any manual change to results.jsonl).

## Real-work scoreboard
Separate, continuous, never paused: `REALWORK.md` (format and logging helper), ledger `realwork.jsonl`, ranking block in `RESULTS.md`.

## Known risks
- T12's check takes about 270-305 s against hardbench's fixed 420 s check timeout; if a T12 row says "check failed: timeout", rerun `suite/tert/tertcheck.js` by hand.
- MiMo (ceiling reference) hangs silently at times (0-byte events); those should be recorded as unavailable and retried or replaced with DeepSeek.

## Pause record
- Paused 20:31 UTC (Europe/London, UTC+0) on 2026-10-28. Last recorded run: ollama/bench-qwen38r t11 r1 (FAIL, timeout 1803 s, 0 edits). results.jsonl = 126 rows.
- The auto-watcher raced (driver started t11 r2 in the same second it persisted r1), so I killed driver PID 670867 and its opencode child PID 692579 by exact PID; r2 was never recorded and will be redone on resume. quizrepo was clean.
