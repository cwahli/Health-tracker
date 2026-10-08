---
id: dispatch-cli-flag
status: done
class: BIND_MISS
skill: verify
edit_mode: patch
allowed_files:
  - scripts/run-coding-dispatch.sh
  - specs/active/card-19.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
gate:
  - bash -n scripts/run-coding-dispatch.sh
---

# dispatch-cli-flag — `opencode run` takes no `--dir`, so every opencode dispatch died at launch

## Goal
`run-coding-dispatch.sh` must invoke the coder tool in a way the installed CLI
actually accepts, so a dispatch starts an agent instead of exiting immediately.

## Understanding (what this bug is NOT) — V-30.4 anti-patch field
- Mechanism: the dispatcher passed `opencode run --auto --dir <path>`, and the
  installed `opencode run` has no `--dir` (nor `--cwd`) flag. It exits with
  `Unrecognized flag: --dir in command opencode run` **before the agent starts**.
- Not this: adding a `--cwd` flag or a shim binary. The CLI resolves its project
  from the process working directory, which the script already sets with `cd`, so
  the flag was never needed — only wrong.
- Not this: treating "No code changes produced by opencode" as a lazy agent and
  retrying harder. The agent never ran; the failure is in the invocation, and a
  retry burns the attempt cap on a tool that cannot start.
- Evidence: `/home/ubuntu/.hermes/logs/dispatch_#19_opencode.log` —
  `ERROR Unrecognized flag: --dir in command opencode run`, immediately followed by
  `[Dispatcher] No code changes produced by opencode.` and
  `[ToolAllowance] Recorded failed for opencode.` The allowance was charged against
  the agent rather than the broken command line.
- Non-goal: do not change which model or thinking level is chosen, and do not
  change the worktree layout — `CODER_DIR` is still created and still used as cwd.

## Layer (pick ONE; siblings are frozen) — V-30.4 anti-patch field
- Layer: data
- Frozen: display, calc — no UI or nutrition arithmetic is touched.

## Forbidden patch (named) — V-30.4 anti-patch field
- No symptom-hide: catching the launch failure and reporting "agent declined"
- No new feature flag
- No renamed locator
- No second merge/write path

## Two-sided fixture (prove structure, not symptom)
- Broken input → correct output: `bash -n` passes AND the emitted `opencode_argv`
  (the `--print-plan` line) contains no `--dir`, because that printed string is
  what misled the diagnosis in the first place.
- Adjacent input → unchanged: `REG_HELPER --dir=` and `spec-path --dir=` keep their
  flags — those are the project's own Node helpers, not the opencode CLI, and
  stripping them would break the plan stage.

## In scope
- The coder-launch argv and the `--print-plan` echo of it.
- `specs/active/card-19.md` — the locked packet for the DISH_DROP card this
  unblocks, which the dispatcher refuses to run without (`no allowed_files`).

## Out of scope
- Model selection, cascade, and the Telegram reporting path.
- The bug store's `blocked_reason` lifecycle. Note for the record: `bugctl unblock`
  clears `blocked_reason` but leaves the legacy `queue: blocked`, and the guard
  re-derives `queue_blocked` from it — so a card blocked by a *failed launch*
  needs both cleared before it will re-dispatch.

## Invariants
- The coder still runs inside its own worktree (`agent/dispatch-<area>`).
- `--print-plan` output still describes the command that will actually run.

## Prior art (do not reimplement)
- `cd "$CODER_DIR" && ...` on the launch line was already correct; only the flag
  was wrong.

## Done when
1. `bash -n scripts/run-coding-dispatch.sh` exits 0 and the `--print-plan` line
   shows no `--dir`.
2. `git diff --name-only` ⊆ allowed_files
3. Gate command exits 0.

<!-- closed 2026-10-02: bash -n green and the --print-plan output carries no --dir; the fix that stopped every coder dispatch dying at launch is on main -->
