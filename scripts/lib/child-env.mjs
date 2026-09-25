/**
 * Child process environment for a model turn.
 *
 * A prompt sentence is not a control. The website lane legitimately needs the
 * host's git and deploy credentials, so project 1 keeps inheriting the parent
 * environment. An external project folder must not be able to reach them, so
 * its child is built from a list instead of from everything the host happens
 * to export.
 */

/** Names an external child may inherit from the parent process. */
export const PROJECT_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'TZ',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'XDG_STATE_HOME',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NPM_CONFIG_CACHE',
  'NO_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
];

/**
 * Never reaches an external child, even when a caller passes it explicitly.
 * The Telegram token lets the child impersonate the bot, and the rest are the
 * website's git and deploy credentials.
 */
export const PROJECT_ENV_DENIED = [
  /^TELEGRAM_/,
  /^GITHUB_/,
  /^GH_/,
  /^GIT_(?!TERMINAL_PROMPT$)/,
  /^CLOUDFLARE_/,
  /^CF_/,
  /^RENDER_/,
  /^SUPABASE_/,
  /^FIREBASE_/,
  /^NETLIFY_/,
  /^VERCEL_/,
  /^AWS_/,
  /^DIGITALOCEAN_/,
  /^DO_/,
  /^DEPLOY/,
  /^SSH_/,
  /^GPG_/,
  /PRIVATE_KEY/,
  /SECRET/,
  /PASSWORD/,
  /CREDENTIAL/,
];

function isDenied(name) {
  return PROJECT_ENV_DENIED.some((re) => re.test(name));
}

/**
 * @param {'inherit'|'project'} mode
 *   'inherit' - the website lane: everything the parent has, unchanged.
 *   'project' - an external folder: the passthrough list plus the caller's
 *               explicit additions, minus anything denied.
 */
export function buildChildEnv({ parentEnv = process.env, extraEnv = {}, mode = 'inherit' } = {}) {
  const merged = { ...parentEnv, ...(extraEnv || {}) };
  if (mode !== 'project') return merged;

  const out = {};
  for (const name of Object.keys(merged)) {
    if (isDenied(name)) continue;
    const fromParent = Object.prototype.hasOwnProperty.call(parentEnv, name) && PROJECT_ENV_PASSTHROUGH.includes(name);
    const explicit = Object.prototype.hasOwnProperty.call(extraEnv, name);
    if (fromParent || explicit) out[name] = merged[name];
  }
  // Never let a tool sit waiting on a credential prompt inside a turn.
  out.GIT_TERMINAL_PROMPT = '0';
  return out;
}
