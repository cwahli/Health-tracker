# R-16 live evidence — 2026-09-26 Telegram pass (appendix)

Serving tree for every capture below: `/home/ubuntu/bot-host-r14`
(production service `bot-host@vm`), unless noted. Chat 6218257274.
Single poller verified before and after (zero 409s).

## QS-2 + QS-10 live: full failover cascade in one turn (vps)

`Reply with the single word: ok` answered through four lanes, each announced:

- `🔀 cline:cline-free/deepseek-v4.1-flash failed (free limit hit (Retry in
  ~2h 16m.)) — switching to opencode/muse-spark-1.3-contributor-free…`
- `🔀 opencode/muse-spark-1.3-contributor-free failed (free limit hit) —
  switching to opencode/mimo-v2.6-flash-free…`
- `🔀 opencode/mimo-v2.6-flash-free failed (free limit hit) — switching to
  opencode/space-bunny-free…`
- `ok` + usage footer.

No raw JSON anywhere. Tier walk observed in the wild (coding lanes in
preference order, light fallback last). Cost, disclosed: the pass consumed
real daily free quota — DeepSeek V4.1 Flash depleted until 14:00Z, Muse 1.3
until ~12:00Z. Live proof spends quota; there is no free way to watch
failover fire.

## QS-2 tap path live: depleted-lane button

Tapping the ❌ Muse CL button (Telethon click on the live keyboard) replied:
`That lane is depleted (reset in 18m). Next up: cline:deepseek v4.1 flash
(free) (cline:cline-free/deepseek-v4.1-flash)` + refreshed tier-grouped
allowance table. Buttons carry tier words + bakeoff scores live (QS-6/7
visible in the keyboard itself).

## QS-6/7 live render

`/freemodel`: `Total: 30 · 28 usable`, `Coding-agent capable 11 · Light ·
docs/inventory 19` breakdown line; `/allowance`: same 30 rows in tier-grouped
monospace table with AA scores. Parity eyeball-matched.

## NEW DEFECT (found live, open): stale session row holds every remote turn

After the roam, every `/location mobile|collab|grok` turn holds at preflight:
`session ses_f227779acffeXj1OcLC4RXXWTW is not on this host`. Facts:
- The bot's sessions map (`~/.local/state/bot-host/vm/sessions.json`) points
  chat 6218257274 at `ses_f227…`.
- The relay's opencode store holds 64 sessions, but NOT `ses_f227…`.
- So a thread id outlived its conversation (created elsewhere / compacted /
  rotated), and the row now fails closed forever: no remote turn can pass
  preflight until the row is repaired (`/new` or equivalent). There is no
  self-healing path — fail-closed with no recovery is a hold that never clears.
- Proposed repair (not yet implemented): on session-404 at preflight, offer an
  explicit fresh start (`sessionId=''` + notice naming the lost thread) instead
  of holding indefinitely. Running blank *with* a notice is honest; holding
  forever on a ghost id is a stuck chat. Needs a product decision — it changes
  hold semantics owned by the turn path.

## Machine identity live

`/location <host>` now answers `worker: unknown machine` for the VPS-local
stand-ins, and canary settlement treats them accordingly. A real device will
be distinguishable by hostname on the record. No real device worker has ever
connected: QS-1/QS-3/QS-4/QS-9 stay red for exactly that reason.
