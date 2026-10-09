/**
 * META-1 P1 — mini-app registry: the single source of truth for the meta shell.
 *
 * One entry per Telegram surface. The shell burger (`src/miniapp/app.tsx`,
 * P2), the gateway allowlist, and the bot `web_app` buttons all derive from
 * this list. Add = one line. Remove = `enabled: false` (or delete the line).
 *
 * P1 scope: this file has no callers yet. Zero behavior change by construction.
 * Do NOT import `bots/registry.json` here — that is the bot-fleet registry
 * (places, tokens, pollers); this one is the user-visible app list.
 */

export type MiniAppKind = 'native' | 'tty' | 'external';

export interface MiniAppDef {
  /** Stable id. Also the `?tab=` value in deep-links. */
  id: string;
  /** Burger + header label. */
  title: string;
  /** Burger glyph. No emoji font dependency: plain text symbols only. */
  icon: string;
  /** Gateway route serving this tab (native/tty). */
  route: string;
  /** native = React adapter tab · tty = terminal frame · external = openLink. */
  kind: MiniAppKind;
  /** Absolute URL for `external` only. Never embedded in an iframe. */
  url?: string;
  /** `false` hides the entry everywhere (burger, allowlist, buttons). */
  enabled: boolean;
  /** OAuth scopes the tab needs (e.g. Google). Empty = Telegram auth only. */
  scopes?: string[];
}

export const MINI_APPS: MiniAppDef[] = [
  { id: 'bugs', title: 'Project', icon: '▦', route: '/app/bugs', kind: 'native', enabled: true },
  { id: 'fleet', title: 'Fleet', icon: '◉', route: '/app/fleet', kind: 'native', enabled: true },
  { id: 'review', title: 'Review', icon: '✓', route: '/app/review', kind: 'native', enabled: true },
  { id: 'tgtg', title: 'Bags', icon: '◍', route: '/app/tgtg', kind: 'native', enabled: true },
  { id: 'calendar', title: 'Calendar', icon: '▤', route: '/app/calendar', kind: 'native', enabled: true, scopes: ['google.calendar'] },
  { id: 'agenda', title: 'Agenda', icon: '≡', route: '/app/agenda', kind: 'native', enabled: true, scopes: ['google.calendar'] },
  { id: 'stays', title: 'Stays', icon: '⌂', route: '/app/stays', kind: 'native', enabled: true },
  { id: 'tui', title: 'Terminal', icon: '⌨', route: '/tui', kind: 'tty', enabled: true },
  { id: 'forge', title: 'Forge', icon: '+', route: '/forge', kind: 'native', enabled: true },
  {
    id: 'web', title: 'Code', icon: '⟩', route: '/app/web',
    kind: 'external', url: 'https://web.health-tracker.co.uk', enabled: false,
  },
];

/** Entries the burger renders, in order. */
export function enabledApps(): MiniAppDef[] {
  return MINI_APPS.filter((a) => a.enabled);
}

/** Lookup by `?tab=` value. Returns undefined for unknown or disabled ids. */
export function appById(id: string): MiniAppDef | undefined {
  return MINI_APPS.find((a) => a.id === id && a.enabled);
}
