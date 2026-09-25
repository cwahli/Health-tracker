// === VENDORED FROM scripts/lib/setup-gaps.mjs — DO NOT EDIT ===
// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.

/**
 * Is each provider actually usable on this host, and if not, what fixes it.
 *
 * The allowance surfaces used to advertise lanes that could not run. A lane
 * whose credential is missing was listed as available next to lanes that work,
 * and the only hint was a line in a footer ("Token Harbor: no API key on this
 * box") that named no variable and offered no action. Two of the seventeen
 * ledger lanes on this host were in exactly that state.
 *
 * Every signal here is local: an environment variable, a binary, or an auth
 * file. Nothing probes a provider, because "we could not reach it" and "it is
 * not there" are different answers — conflating them is how a working provider
 * ends up reported as empty.
 *
 * Absence of evidence is not evidence of absence: a provider with no signal
 * here is reported `unknown`, never `not ready`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENV_FILE = path.join('.config', 'bot-host', 'common.env');

function hasEnv(env, name) {
  const value = env?.[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function envFileLine(env, name) {
  return `printf '\\n${name}=…\\n' >> ~/${ENV_FILE}   # then: sudo systemctl restart bot-host@${serviceUnit()}`;
}

/** The service that must restart for a credential change to take effect. */
let _serviceUnit = 'vm';
export function setServiceUnit(id) {
  _serviceUnit = String(id || 'vm').replace(/[^a-z0-9_-]/gi, '') || 'vm';
  return _serviceUnit;
}
function serviceUnit() {
  return _serviceUnit;
}

function binaryOnPath(env, bin) {
  const dirs = String(env?.PATH || '').split(':').filter(Boolean);
  return dirs.some((d) => {
    try {
      fs.accessSync(path.join(d, bin), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Where this host keeps Freebuff credentials. FREEBUFF_CREDS wins, then the
 * paths the freebuff CLI actually uses, resolved against THIS home directory.
 * Returns whether a token is present and which paths were tried, so the fix text
 * can name them instead of guessing.
 */
export function findFreebuffCredentials({ env = process.env, home = os.homedir() } = {}) {
  const searched = [];
  const candidates = [
    env.FREEBUFF_CREDS,
    path.join(home, '.config', 'manicode', 'credentials.json'),
    path.join(home, '.manicode', 'credentials.json'),
    path.join(home, '.config', 'freebuff', 'credentials.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    searched.push(file);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const inner = parsed?.default || parsed || {};
      if (inner.authToken || inner.token || inner.accessToken) return { ok: true, path: file, searched };
    } catch {
      // absent or unreadable: keep looking
    }
  }
  return { ok: false, path: null, searched };
}

/**
 * @returns {Object} provider -> { ready: true|false|'unknown', needs, fix, command }
 */
export function providerReadiness({ env = process.env, home = os.homedir(), location = '', clineReady = null } = {}) {
  const out = {};

  // OpenCode: the free lanes run through the CLI. A TUI or an attaching surface
  // additionally needs a server, which is a separate thing from the CLI being
  // installed — conflating them is what made the router report a working
  // provider as "unreachable" when only its server was missing.
  const ocBin = binaryOnPath(env, 'opencode') || fs.existsSync(path.join(home, '.opencode', 'bin', 'opencode'));
  out.opencode = ocBin
    ? { ready: true, needs: null, fix: null, command: null, note: 'free lanes run through the opencode CLI' }
    : {
        ready: false,
        needs: 'the opencode CLI on this host',
        fix: 'install opencode, then restart the bot',
        command: null,
      };

  if (typeof clineReady === 'function') {
    let ok = false;
    try {
      ok = Boolean(clineReady({ location, env, home }));
    } catch {
      ok = false;
    }
    out.cline = ok
      ? { ready: true, needs: null, fix: null, command: null }
      : {
          ready: false,
          needs: 'a signed-in Cline CLI on this host',
          fix: location === 'mobile'
            ? 'Cline does not run on the mobile worker; use the VM or the notebook'
            : 'run `cline` once on this host and sign in, then restart the bot',
          command: null,
          note: `looked for ${path.join(home, '.cline', 'data', 'settings', 'providers.json')}`,
        };
  }

  if (hasEnv(env, 'TOKEN_HARBOR_API_KEY')) {
    // The key being present does not mean a turn can run right now, and the reason
    // is not a missing credential. Token Harbor's free models share one rolling
    // ~7-day value bar (the table's own resetRule, enforced by the shared
    // `tokenharbor-free` bucket): when the bar is empty the vendor answers 402 and
    // every TH row comes back together a week later. No API exposes the bar, so
    // readiness is the key being wired up, and the bar is reported by /allowance.
    out.tokenharbor = {
      ready: true,
      needs: null,
      fix: null,
      command: null,
      note: 'key accepted — free models share one rolling ~7-day value bar; when it empties every Token Harbor lane pauses together and returns on the weekly reset (/allowance shows the state)',
    };
  } else {
    out.tokenharbor = {
      ready: false,
      needs: 'TOKEN_HARBOR_API_KEY',
      fix: envFileLine(env, 'TOKEN_HARBOR_API_KEY'),
      command: '/setup',
    };
  }

  if (hasEnv(env, 'CLOUDFLARE_WORKERS_AI_TOKEN')) {
    out.cloudflare = { ready: true, needs: null, fix: null, command: null, note: '10k neurons/day, resets 00:00 UTC' };
  } else {
    out.cloudflare = {
      ready: false,
      needs: 'CLOUDFLARE_WORKERS_AI_TOKEN',
      fix: `${envFileLine(env, 'CLOUDFLARE_WORKERS_AI_TOKEN')}   # CLOUDFLARE_ACCOUNT_ID too if you want the account total`,
      command: '/setup',
    };
  }

  if (hasEnv(env, 'GEMINI_API_KEY')) {
    out.gemini = { ready: true, needs: null, fix: null, command: null };
  } else {
    out.gemini = {
      ready: false,
      needs: 'GEMINI_API_KEY',
      fix: envFileLine(env, 'GEMINI_API_KEY'),
      command: '/setup',
    };
  }

  // Freebuff is terminal-only by design, so it is never a turn lane — but
  // "terminal only" is not "not set up". This host has the freebuff CLI and a
  // signed-in credentials file, and the old hardcoded "not signed in" was
  // simply wrong. It is checked the same way the router checks it, except the
  // path is discovered per host: the router's copy was pinned to another
  // machine's home directory and could never be true here.
  const fbCreds = findFreebuffCredentials({ env, home });
  out.freebuff = fbCreds.ok
    ? {
        ready: true,
        needs: null,
        fix: null,
        command: '/unlock',
        terminalOnly: true,
        note: 'signed in · terminal only, never a turn lane',
      }
    : {
        ready: false,
        needs: 'the Freebuff CLI signed in (terminal only, never a turn lane)',
        fix: fbCreds.searched.length
          ? `run \`freebuff login\` on this host (looked in ${fbCreds.searched.join(', ')})`
          : 'install the freebuff CLI, then run `freebuff login` on this host',
        command: '/unlock',
        terminalOnly: true,
      };

  return out;
}

/** Providers that are blocking something, ready to print. */
export function setupGaps(readiness = providerReadiness()) {
  return Object.entries(readiness)
    .filter(([, v]) => v.ready !== true)
    .map(([provider, v]) => ({ provider, ...v }));
}

/** One lane's setup verdict: ready, blocked with a reason, or unknown. */
export function laneSetup(provider, readiness = providerReadiness()) {
  const row = readiness[provider] || readiness[providerOf(provider)];
  if (!row) return { needsSetup: false, unknown: true, reason: null };
  if (row.ready === true) return { needsSetup: false, unknown: false, reason: null };
  if (row.ready === 'unknown') return { needsSetup: false, unknown: true, reason: null };
  // Name the variable when the row knows it, and still say something useful when it
  // does not. "needs undefined" is what a partial readiness object produced, and it
  // is the one string that tells the user nothing about what to do.
  return { needsSetup: true, unknown: false, reason: row.needs ? `needs ${row.needs}` : `${provider || 'provider'} is not set up on this host` };
}

function providerOf(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'openai' || p === 'google') return 'gemini';
  return p;
}
