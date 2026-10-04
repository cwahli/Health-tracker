// Uniform TUI plumbing for every bot: one generator, no hand-wiring.
//
// Each TUI-capable bot needs exactly three things, all derived from its id:
//   1. a ttyd unit (own port, TUI_BOT_ID, tmux name, canonical tree)
//   2. a Caddy socket handle (path -> upstream port, forward_auth first)
//   3. gateway env rows (token presence, upstream URL, route path)
//
// Live 2026-10-04: the three existing units drifted (vm2 on bot-host-r14,
// vm3 on bot-host) because each was written by hand. This file is the single
// shape; `check` audits drift, `emit` prints the canonical pieces for review.
// Installing (systemd + Caddy + gateway restart) stays an explicit ops step:
// the gateway restart drops live viewers, so it never happens implicitly.

export const CANONICAL_TREE = '/home/ubuntu/bot-host-r14';
export const TTYD_CRED = 'tui:vqBsHTWmvZUxmD49YnuDtBvk';
// Routes the gateway knows without env rows (its TTYD_ROUTES defaults).
// Mirrored here so the audit does not demand env for vm/vm2; if the gateway
// defaults ever move, this check fails loudly on the live file, not silently.
export const DEFAULT_ROUTES = { vm: '/tty/', vm2: '/tty2/' };
export const SHARED_UPSTREAM_PORT = '8896';

export function tmuxNameFor(botId) {
  return botId === 'vm' ? 'VM-tui' : `VM-tui-${botId}`;
}

export function tokenEnvFor(botId) {
  return `TUI_BOT_TOKEN_${String(botId).toUpperCase()}`;
}

export function unitFor(botId, { port, route, tree = CANONICAL_TREE } = {}) {
  const base = String(route || '').replace(/\/+$/, '');
  return `[Unit]
Description=Typeable TUI terminal for the ${botId} bot's chats (ttyd, behind the gateway)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=${tree}
Environment=HOME=/home/ubuntu
Environment=PATH=/home/ubuntu/.opencode/bin:/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=TUI_BOT_ID=${botId}
Environment=TUI_STATE_ROOT=/home/ubuntu/.local/state/bot-host
Environment=TUI_WORKTREE=${tree}
Environment=OPENCODE_BIN=/home/ubuntu/.opencode/bin/opencode
Environment=TUI_TMUX_NAME=${tmuxNameFor(botId)}
EnvironmentFile=-/home/ubuntu/.config/bot-host/tui-ttyd.env
ExecStart=/usr/bin/ttyd --port ${port} --interface 127.0.0.1 --base-path ${base} \\
  --writable --max-clients 0 --once=false \\
  -c \${TUI_TTYD_USER}:\${TUI_TTYD_PASSWORD} \\
  --check-origin --terminal-type xterm-256color \\
  --client-option fontSize=13 \\
  --ping-interval 20 \\
  ${tree}/scripts/mobile/tui-attach.sh
Restart=always
RestartSec=5
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
`;
}

export function caddyFor(botId, { port, route } = {}) {
  const base = String(route || '').replace(/\/+$/, '');
  return `    # ${botId} socket (generated — see scripts/tui-bot-plumbing.mjs).
    handle ${base}/ws {
        forward_auth 127.0.0.1:8897 {
            uri /authz
        }
        reverse_proxy 127.0.0.1:${port} {
            header_up Authorization "Basic ${Buffer.from(TTYD_CRED).toString('base64')}"
        }
    }
`;
}

export function envFor(botId, { port, route } = {}) {
  const key = String(botId).toUpperCase();
  return `TUI_TTYD_URL_${key}=http://127.0.0.1:${port}\nTUI_ROUTE_${key}_PATH=${String(route || '').endsWith('/') ? route : `${route}/`}\n`;
}

// Audit one bot against the canonical shape. Readers are injectable so the
// sensor runs on fixtures; production passes the real ones.
export function checkBot(botId, {
  readUnit = () => null,
  unitActive = () => false,
  readCaddy = () => '',
  gatewayEnv = {},
} = {}) {
  const items = {};
  items.token = Boolean(String(gatewayEnv[tokenEnvFor(botId)] || '').trim());
  const unit = readUnit(botId);
  items.unitFile = Boolean(unit);
  items.unitActive = unitActive(botId);
  items.unitTree = unit
    ? (unit.includes(`WorkingDirectory=${CANONICAL_TREE}`) && unit.includes(`${CANONICAL_TREE}/scripts/mobile/tui-attach.sh`))
    : false;
  const key = String(botId).toUpperCase();
  const caddy = String(readCaddy() || '');
  const routeRow = String(gatewayEnv[`TUI_ROUTE_${key}_PATH`] || '').trim();
  const envUrl = String(gatewayEnv[`TUI_TTYD_URL_${key}`] || '').trim();
  const unitBase = unit ? ((unit.match(/--base-path\s+(\S+)/) || [])[1] || '') : '';
  // Env route wins; gateway defaults cover vm/vm2; the unit's own base-path
  // is the last resort (it is what ttyd actually serves).
  const base = (routeRow || DEFAULT_ROUTES[botId] || unitBase).replace(/\/+$/, '');
  items.route = Boolean(base);
  // This bot's own socket handle, not just any handle: a shared-file grep
  // would pass vm4 on vm2's stanza. forward_auth must be in the file too.
  items.caddyHandle = Boolean(base) && caddy.includes(`handle ${base}/ws`) && caddy.includes('forward_auth');
  items.upstreamUrl = Boolean(envUrl);
  // Effective upstream: per-bot URL wins, shared fallback otherwise (gateway
  // ttydFor). Reported, not gated: portsMatch already verifies the effective
  // port against the unit.
  items.upstreamEffective = envUrl || 'http://127.0.0.1:8896';
  const unitPort = unit ? (unit.match(/--port\s+(\d+)/) || [])[1] || '' : '';
  const envPort = (envUrl.match(/:(\d+)$/) || [])[1] || SHARED_UPSTREAM_PORT;
  items.portsMatch = Boolean(unitPort && unitPort === envPort);
  const ok = ['token', 'unitFile', 'unitActive', 'unitTree', 'route', 'caddyHandle', 'portsMatch']
    .every((k) => items[k]);
  return { bot: botId, ok, items };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raw = process.argv.slice(2);
  const kv = {};
  for (let i = 0; i < raw.length; i++) {
    const a = String(raw[i]).replace(/^--/, '');
    const eq = a.indexOf('=');
    if (eq !== -1) kv[a.slice(0, eq)] = a.slice(eq + 1);
    else if (i + 1 < raw.length) kv[a] = String(raw[++i]).replace(/^--/, '');
  }
  const [cmd, botId] = [raw[0], raw[1]];
  if (cmd === 'emit' && botId) {
    const o = { port: kv.port, route: kv.route };
    process.stdout.write(`--- tui-ttyd-${botId}.service ---\n${unitFor(botId, o)}\n`);
    process.stdout.write(`--- caddy stanza ---\n${caddyFor(botId, o)}\n`);
    process.stdout.write(`--- gateway env ---\n${envFor(botId, o)}`);
  } else if (cmd === 'check' && botId) {
    const fs = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const env = {};
    try {
      for (const line of fs.readFileSync('/home/ubuntu/.config/bot-host/tui-gateway.env', 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
        if (m) env[m[1]] = m[2].trim();
      }
    } catch {}
    let caddy = '';
    try { caddy = fs.readFileSync('/etc/caddy/Caddyfile', 'utf8'); } catch {}
    const r = checkBot(botId, {
      readUnit: (b) => {
        try { return execFileSync('systemctl', ['cat', `tui-ttyd-${b}.service`], { encoding: 'utf8' }); }
        catch { return null; }
      },
      unitActive: (b) => {
        try { return execFileSync('systemctl', ['is-active', `tui-ttyd-${b}.service`], { encoding: 'utf8' }).trim() === 'active'; }
        catch { return false; }
      },
      readCaddy: () => caddy,
      gatewayEnv: env,
    });
    console.log(JSON.stringify(r));
  } else {
    console.error('usage: tui-bot-plumbing.mjs emit <bot> --port N --route /ttyN/ | check <bot>');
    process.exit(2);
  }
}
