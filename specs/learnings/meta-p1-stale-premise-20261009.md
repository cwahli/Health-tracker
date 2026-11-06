# Stale-premise packet: META-1 P1 outlived its own P1 (2026-10-09)

A locked packet written pre-landing (`specs/active/meta-miniapp.md` on
`agent/meta-miniapp-plan`: "create the two files, they do not exist") went
stale when #652 landed its own versions of both files on main. Every
continuation below was measured, not reasoned:

1. Verbatim adoption of the branch versions LOSES work: main's `issueHtk`
   binds (bot,chat,tab); the branch re-exports the gateway token
   (bot,chat only) — while the packet demands the tab binding. Also lost:
   registry `health`/`scopes`, `as const` types, `MINI_APP_IDS` API.
   Zero callers either side, so nothing breaks at runtime; loss is
   tree-content (history keeps `6c4f46bc`).
2. Merged content (re-export validator + keep tab-bound htk + add branch
   helpers) satisfies the packet fully but trips `journey-guard` rewrite
   sensor twice: 273% wholesale, 70% merged (rule: >30% churn on an
   allowed file under `edit_mode: patch`). `tsc` 0, tui-gateway 180/0,
   fleet 17/0, review 19/0 throughout — the code is green, the process is red.
3. The sensor has no waiver mechanism (`edit_mode !== patch` skips it, but
   setting that to fit a diff is weakening Guard to pass). Per AGENTS.md
   L17, two guard fails end building: Reviewer/Learner owns the next move.
4. Separately: the repo-wide TUI fixes-landed ratchet reddened EVERY PR
   while `origin/agent/collab-bug-intake` + `origin/agent/sheet-guard`
   stayed stale. Both verified byte-subsumed by main (branch-only deltas:
   an outdated duckdns fixture; 31 lines identical on main) and
   remote-deleted with SHAs recorded (`9edaf9a3`, `17c3ac59`) under operator
   direction — orphans with no sheet row and no reachable owner cannot be
   "taken over" by anyone else; deletion was the only clean resolution.

Rule for next time: a packet whose P1 premise is "files do not exist" must
be re-checked against main at BUILD time, not just at plan time. #652
landing first made every P1 continuation a rewrite by definition, and no
amount of careful merging changes the meter — only an honestly-scoped
follow-up packet (or a recorded operator override) does.
