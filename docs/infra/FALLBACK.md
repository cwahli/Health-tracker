# Fallback Plan — If is-a.dev PR #55238 is Delayed or Rejected

**Context:** The primary path is `health-tracker.is-a.dev` (PR [#55238](https://github.com/is-a-dev/register/pull/55238)).
All checks pass, and the volunteer review SLA is typically 2 hours to 3 days.

If the PR is delayed past your acceptable window or denied under volunteer software policies, here are the three ready fallbacks:

---

## Option 1: Zero-Cost Immediate Fallback via sslip.io (5 minutes)
`sslip.io` provides wildcard DNS resolution directly mapping IP addresses to hostnames without any registration or review.

- **Domain:** `51-254-217-163.sslip.io` (resolves to `51.254.217.163` worldwide instantly).
- **Caddy snippet:**
  ```caddy
  51-254-217-163.sslip.io {
      handle /privacy* {
          root * /srv/www-legal
          rewrite * /privacy.html
          file_server
      }
      handle /terms* {
          root * /srv/www-legal
          rewrite * /terms.html
          file_server
      }
      handle {
          reverse_proxy 127.0.0.1:3000
      }
  }
  ```
- **Pro:** Instant zero-friction deployment with automatic Let's Encrypt TLS.
- **Risk:** Some strict corporate proxies block `*.sslip.io` as dynamic DNS.

---

## Option 2: Low-Cost Custom Domain ($3–$8/year, Most Resilient)
Purchase a clean, dedicated domain from Cloudflare Registrar, Namecheap, or Porkbun (e.g. `chiwah-health.dev` or `cw-tracker.xyz`).

- **Pro:** 100% control, zero volunteer gatekeepers, instant DNS propagation, guaranteed clean domain reputation that corporate firewalls (FortiGuard, Zscaler, Cloudflare Gateway) never flag.
- **Setup:** Point `A @ 51.254.217.163`, add block to Caddyfile, reload Caddy.

---

## Option 3: Alternative Free Developer Subdomains
- **js.org:** Free subdomain for JavaScript projects (requires GitHub Pages / frontend repo).
- **is-a.bot:** Subdomain for bots / services (`is-a.bot` by the same team, launched recently).
- **eu.org:** Free domain registry (though queue times can also be long).
