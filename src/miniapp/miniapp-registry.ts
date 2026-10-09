/**
 * One list for the ten Telegram mini-apps (META-1 P1).
 *
 * Nothing imports this yet. A later phase derives the shell, the gateway
 * allowlist, and the help text from it. Add an app by one line. Hide an app
 * with `enabled: false` on that line. This file does not change a live route.
 *
 * The name is `miniapp-registry` so it cannot be confused with
 * `bots/registry.json`.
 */

export const MINI_APPS = [
  { id: 'bugs', title: 'Bugs', icon: 'bug', route: '/bugs', kind: 'native', enabled: true, scopes: ['bugs:read'], health: '/bugs/app' },
  { id: 'fleet', title: 'Fleet', icon: 'radio', route: '/fleet', kind: 'native', enabled: true, scopes: ['fleet:read'], health: '/fleet/api/state' },
  { id: 'review', title: 'Review', icon: 'check', route: '/review', kind: 'native', enabled: true, scopes: ['review:read', 'review:write'], health: '/review/api/state' },
  { id: 'tgtg', title: 'Too Good To Go', icon: 'bag', route: '/tgtg', kind: 'native', enabled: false, scopes: ['tgtg:read'], health: 'https://tgtg.health-tracker.co.uk/' },
  { id: 'calendar', title: 'Calendar', icon: 'calendar', route: '/calendar', kind: 'native', enabled: false, scopes: ['calendar:read'], health: '/calendar' },
  { id: 'agenda', title: 'Agenda', icon: 'list', route: '/agenda', kind: 'native', enabled: false, scopes: ['agenda:read'], health: '/agenda' },
  { id: 'stays', title: 'Stays', icon: 'bed', route: '/stays', kind: 'native', enabled: false, scopes: ['stays:read'], health: '/stays' },
  { id: 'tui', title: 'Terminal', icon: 'terminal', route: '/tui', kind: 'tty', enabled: true, scopes: ['tui:attach'], health: '/tui' },
  { id: 'forge', title: 'Forge', icon: 'hammer', route: '/forge', kind: 'native', enabled: true, scopes: ['forge:use'], health: '/forge' },
  { id: 'web', title: 'Web', icon: 'globe', route: 'https://web.health-tracker.co.uk/', kind: 'external', enabled: false, scopes: ['web:open'], health: 'https://web.health-tracker.co.uk/' },
] as const;

export type MiniAppDef = (typeof MINI_APPS)[number];
export type MiniAppId = MiniAppDef['id'];
export type MiniAppKind = MiniAppDef['kind'];

export const MINI_APP_IDS: readonly MiniAppId[] = MINI_APPS.map((app) => app.id);

export function miniAppById(id: string): MiniAppDef | undefined {
  return MINI_APPS.find((app) => app.id === id);
}

export function enabledMiniApps(): readonly MiniAppDef[] {
  return MINI_APPS.filter((app) => app.enabled);
}
