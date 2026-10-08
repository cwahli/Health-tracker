---
id: TUI-TOKEN-RENEW
status: locked
class: live-tui-cannot-survive-its-own-token
edit_mode: patch
skill: debug-contract
auto_go: true
allowed_files:
  - scripts/tui-gateway.mjs
  - scripts/assert-tui-token-renew.test.mjs
  # The gateway's own suite is 900+ lines and edit_mode: patch caps churn at 30%,
  # so the renewal cases get their own file rather than growing that one.
frozen_files:
  - scripts/tui-ttyd-vm.service
  - src/App.tsx
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
gate:
  - node scripts/assert-tui-token-renew.test.mjs
  - node scripts/assert-tui-gateway.test.mjs
  - npx tsc --noEmit
  - node scripts/journey-guard.mjs TUI-TOKEN-RENEW
---

# TUI-TOKEN-RENEW — a live terminal must survive its own token

goal: >
  A terminal page the operator is still using must survive the expiry of its own
  auth token, and must be able to renew it without the human tapping /tui again.
  Symptom on the phone: "Press ⏎ to Reconnect", looping forever, while the page
  itself renders fine.

findings:
  - id: root-cause
    text: >
      Measured on the live gateway 2026-10-05. Last successful admission 11:56:05
      (bot=vm2); the first refusal 12:20:24; 26 refusals and no landing since.
      The log names the failure twice per attempt:
      `GET /tty2/token -> token refused (bad token)` and
      `GET /authz -> authz refused (token expired)`.
      TUI_SESSION_TTL_SEC=900, so the token died 15 minutes after the landing,
      while the terminal page stayed open.
  - id: why-it-loops-forever
    text: >
      All three hops verify the SAME 900s token: the page at <base>/, the
      ./token fetch the page makes for ttyd's AuthToken, and Caddy's /authz
      before the websocket upgrade. When it expires, ttyd drops the socket and
      shows the reconnect prompt; the retry re-presents the same dead token, so
      every attempt is refused. There is no path from the page back to a minted
      token, so the loop cannot terminate.
  - id: why-the-page-cannot-fix-it-alone
    text: >
      The only thing that can mint a token is the landing request, and that
      carries Telegram initData — which is itself refused after MAX_AGE_SEC =
      5 * 60. By the time the 15-minute token expires the initData is long dead,
      so a client-side re-auth is impossible and the renewal has to be
      server-side.
  - id: why-this-endpoint
    text: >
      The page already re-fetches ./token on every reconnect attempt — that retry
      loop IS the failure. Making ./token renew turns the existing retry into the
      repair. It is also a browser-initiated fetch, so Set-Cookie on that
      response actually reaches the browser; a Set-Cookie on the /authz response
      would go to Caddy's auth_request, not the client.

build:
  - verifyToken gains an opt-in renewal grace: a correctly-signed token that is
    past `exp` is admitted for RENEWAL ONLY, and only inside a bounded grace.
    Refusal stays the default everywhere else.
  - <base>token renews: on a grace-admitted token it mints a replacement with the
    full TTL, sets the cookie, and returns ttyd's credential as before.
  - The grace is finite and configured (TUI_TOKEN_RENEW_GRACE_SEC, default 3600),
    so an abandoned page still dies. A sliding session with no cliff at all
    would be a permanent credential.

left:
  - The /authz hop is deliberately NOT given the grace: its response is consumed
    by Caddy's auth_request, so a Set-Cookie there cannot reach the browser. It
    passes because ./token has already refreshed the cookie by then.
