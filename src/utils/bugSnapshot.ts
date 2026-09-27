/**
 * Bug snapshot + AI triage helpers (Initiative K).
 * Pure browser/Node-safe utilities: R2 keys, DOM slim, a11y tree, browser console & network ring, digest budget, settings.
 */

import { hydrateWorkItem, publicId } from './bugWorkItem';

export const BUG_SNAPSHOT_SETTINGS_KEY = 'bug_snapshot_enabled';
export const BUG_SNAPSHOT_MAX_SHOTS = 5;
export const BUG_SNAPSHOT_LOG = '[BugSnapshot]';
export const BUG_TRIAGE_LOG = '[BugTriage]';

/** Admin feature default ON for Admin; UI can disable via settings. */
export function isBugSnapshotEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const v = localStorage.getItem(BUG_SNAPSHOT_SETTINGS_KEY);
    if (v === null) return true; // default on
    return v === '1' || v === 'true';
  } catch {
    return true;
  }
}

/**
 * Who may file a bug from the phone.
 *
 * Filing a bug is not an operator action, so this is deliberately NOT the admin
 * check: any signed-in real profile qualifies, which is what makes a screenshot
 * taken on the phone able to become a ticket at all. A Demo profile is excluded
 * so guest sessions do not add noise to the shared queue.
 *
 * The capture kill-switch stays admin-gated — see isBugSnapshotEnabled, whose
 * toggle is rendered by DbInteractionsOverlay only for admins.
 */
export function canFileBugForProfile(profile: { userType?: string } | null | undefined): boolean {
  if (!profile) return false;
  return profile.userType !== 'Demo';
}

export function setBugSnapshotEnabled(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BUG_SNAPSHOT_SETTINGS_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function sanitizePathSegment(raw: string, max = 80): string {
  return (
    String(raw || 'unknown')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, max) || 'unknown'
  );
}

/** R2 object key prefix for a bug tag. */
export function bugTagR2Prefix(category: string, tagId: string): string {
  return `bugs/${sanitizePathSegment(category || 'Other')}/${sanitizePathSegment(tagId)}`;
}

export function bugReportR2Prefix(category: string, tagId: string, reportId: string): string {
  return `${bugTagR2Prefix(category, tagId)}/reports/${sanitizePathSegment(reportId)}`;
}

export function bugShotKey(category: string, tagId: string, reportId: string, index: number, ext = 'jpg'): string {
  const n = String(Math.max(1, index)).padStart(2, '0');
  return `${bugReportR2Prefix(category, tagId, reportId)}/shot-${n}.${ext}`;
}

/**
 * Extension to store a screenshot under.
 *
 * Deliberately png-or-jpg, mirroring what the snapshot path has always written
 * (serverBugSnapshot.ts) and what the artifacts route is willing to serve as an
 * image. A `webp` name would fall through to the text reader and hand binary
 * bytes to a UTF-8 decode, so the extension is normalised rather than passed
 * through. The true content type is still recorded alongside it.
 */
export function bugShotExt(contentType: string): 'png' | 'jpg' {
  return String(contentType || '').includes('png') ? 'png' : 'jpg';
}

/** The content type that matches a normalised shot extension. */
export function bugShotContentType(ext: string): 'image/png' | 'image/jpeg' {
  return ext === 'png' ? 'image/png' : 'image/jpeg';
}

export interface BugReportShotFieldsInput {
  category: string;
  tagId: string;
  reportId: string;
  contentType: string;
  /** The key the upload targeted — always reported, so a failure is diagnosable. */
  shotKey: string;
  /** Public URL, when the upload succeeded. */
  url?: string | null;
  /** False when the bytes never landed. Never claim a shot you cannot serve. */
  ok: boolean;
  error?: string | null;
}

/**
 * The payload fields a bug report must carry for its screenshot to be readable.
 *
 * `GET /api/bugs/:tagId` derives its `reports[]` rows from
 * `issue_tag_links` and then reads `reportId` / `r2_prefix` / `shot_count` (and
 * falls back to `r2_shots.length`) out of the stored payload. Any intake path
 * that attaches an image has to write exactly this set, or the image is
 * invisible: shot_count reads 0 and the artifacts route cannot build a key.
 *
 * On failure `shot_count` is deliberately left unset so the reader falls back to
 * 0 rather than advertising evidence that is not there; the reason is recorded
 * instead of a key that resolves to nothing.
 */
export function bugReportShotFields(input: BugReportShotFieldsInput): Record<string, unknown> {
  const { category, tagId, reportId, contentType, shotKey, url, ok, error } = input;
  const fields: Record<string, unknown> = {
    reportId,
    r2_prefix: bugReportR2Prefix(category, tagId, reportId),
  };
  if (ok) {
    fields.shot_count = 1;
    fields.r2_shots = [{ key: shotKey, url: url || null, contentType }];
  } else {
    fields.shot_upload_error = error || 'upload_failed';
  }
  return fields;
}

/** Dashboard / agent fetch URL. Never use a raw `bugs/...` R2 key as an <img src>. */
export function bugArtifactUrl(tagId: string, reportId: string, name: string, key?: string | null): string {
  const q = new URLSearchParams({
    reportId: String(reportId || ''),
    name: String(name || 'manifest.json'),
  });
  if (key && String(key).startsWith('bugs/')) q.set('key', String(key));
  return `/api/bugs/${encodeURIComponent(tagId)}/artifacts?${q.toString()}`;
}

/** The stored filename for a report screenshot, e.g. `bugs/…/shot-01.jpg` -> `shot-01.jpg`. */
export function bugShotName(keyOrName: string): string {
  const s = String(keyOrName || '');
  const i = s.lastIndexOf('/');
  return i === -1 ? s : s.slice(i + 1);
}
/**
 * Absolute origin for links this server hands to off-origin readers.
 *
 * Never hardcode a host: the same process serves localhost, the duckdns name,
 * and an ephemeral quick-tunnel hostname that changes on every reconnect.
 * `x-forwarded-proto` is honoured because the deploy sits behind a tunnel, so
 * `req.protocol` alone reports http and hands out http links behind https.
 *
 * Pure over a plain header bag so it is testable without an Express request.
 */
export function originFromHeaders(
  headers: Record<string, string | string[] | undefined> | null | undefined,
  fallbackProto = 'https'
): string | null {
  const host = String(headers?.host || '').trim();
  if (!host) return null;
  const raw = headers?.['x-forwarded-proto'] || fallbackProto;
  const proto = String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim() || fallbackProto;
  return `${proto}://${host}`;
}

export interface BugEvidenceTextInput {
  tagId: string;
  currentEvidence?: Record<string, any> | null;
  /** Rows from the reports query: { id, reportId, shot_count, shot_upload_error }. */
  reports?: Array<Record<string, any>>;
  /**
   * Absolute origin to prefix artifact URLs with, e.g.
   * `https://health-tracking.duckdns.org`. Optional on purpose: the in-app
   * browser resolves a relative path fine and must keep doing so, but a chat
   * message cannot — Telegram only auto-links absolute http(s) URLs, so a
   * relative `/api/bugs/...` in `/resume` renders as dead text. Server callers
   * pass the request origin; nothing here should ever hardcode a host.
   */
  origin?: string | null;
}

/**
 * The `## Evidence` block for the plain-text bug packet.
 *
 * The text form is what every non-JSON reader gets — Telegram `/resume` prints
 * it, and so does `bugctl packet --format text`. Evidence used to exist only in
 * the JSON branch, so a card could carry a screenshot and every reader still saw
 * none. Screenshot pointers are rendered through bugArtifactUrl, never as a raw
 * `bugs/...` R2 key, because a key is not a URL a client can fetch.
 *
 * Returns '' when there is genuinely nothing, so callers can filter it out.
 */
export function buildBugEvidenceText(input: BugEvidenceTextInput): string {
  const { tagId, currentEvidence, reports = [], origin } = input;
  const base = String(origin || '').replace(/\/+$/, '');
  const shotUrl = (reportId: string, name: string) => {
    const rel = bugArtifactUrl(tagId, reportId, name);
    return base ? `${base}${rel}` : rel;
  };
  const ev = currentEvidence || {};
  const photos: string[] = Array.isArray(ev.photo_urls) ? ev.photo_urls.filter(Boolean) : [];
  const shotLines: string[] = [];
  let totalShots = 0;
  for (const rep of reports) {
    const count = Number(rep?.shot_count || 0);
    if (!count) {
      if (rep?.shot_upload_error) {
        shotLines.push(`- report ${rep.id}: screenshot upload failed (${rep.shot_upload_error})`);
      }
      continue;
    }
    totalShots += count;
    for (let i = 1; i <= count; i++) {
      const reportId = rep.reportId || rep.id || '';
      shotLines.push(`- report ${rep.id} shot ${i}: ${shotUrl(reportId, `shot-0${i}.jpg`)}`);
    }
  }
  const anyEvidence = photos.length || shotLines.length || ev.debug_url || ev.scout_url || ev.job_id;
  if (!anyEvidence) return '';
  return [
    '## Evidence',
    ev.job_id ? `Job: ${ev.job_id}` : '',
    ...photos.map((u: string) => `Photo: ${u}`),
    ev.debug_url ? `Debug: ${ev.debug_url}` : '',
    ev.scout_url ? `Scout: ${ev.scout_url}` : '',
    totalShots ? `Screenshots (${totalShots}):\n${shotLines.join('\n')}` : '',
    shotLines.length && !totalShots ? shotLines.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function evidencePhotoSrc(tagId: string, photo: string): string {
  const p = String(photo || '');
  if (/^https?:\/\//i.test(p) || p.startsWith('data:') || p.startsWith('/api/')) return p;
  const name = p.split('/').pop() || 'shot-01.jpg';
  const m = p.match(/\/reports\/([^/]+)\//);
  const reportId = m?.[1] || '';
  return bugArtifactUrl(tagId, reportId, name, p.startsWith('bugs/') ? p : null);
}

export function bugManifestKey(category: string, tagId: string, reportId: string): string {
  return `${bugReportR2Prefix(category, tagId, reportId)}/manifest.json`;
}

export function bugMetaKey(category: string, tagId: string): string {
  return `${bugTagR2Prefix(category, tagId)}/meta.json`;
}

export function bugIdentifiedProblemsKey(category: string, tagId: string): string {
  return `${bugTagR2Prefix(category, tagId)}/identified_problems.md`;
}

export interface BugSnapshotManifest {
  version: number;
  reportId: string;
  tagId: string;
  category: string;
  createdAt: string;
  userSymptom?: string;
  env?: any;
  shots: Array<{ key: string; bytes: number; contentType: string }>;
  files: Array<{ name: string; key: string }>;
}

export function parseDataUrl(raw: string): { contentType: string; base64: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  return { contentType: m[1], base64: m[2] };
}

export type BugEnvSnapshot = {
  href: string;
  pathname: string;
  viewport: { w: number; h: number; dpr: number };
  userAgent: string;
  capturedAt: string;
  language?: string;
  online?: boolean;
  activeJobId?: string | null;
  activeMode?: string | null;
  modelId?: string | null;
};

export function captureBugEnv(extra?: Partial<BugEnvSnapshot>): BugEnvSnapshot {
  const w = typeof window !== 'undefined' ? window : (null as any);
  return {
    href: w?.location?.href || '',
    pathname: w?.location?.pathname || '',
    viewport: {
      w: w?.innerWidth || 0,
      h: w?.innerHeight || 0,
      dpr: w?.devicePixelRatio || 1,
    },
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    language: typeof navigator !== 'undefined' ? navigator.language : undefined,
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    capturedAt: new Date().toISOString(),
    activeJobId: extra?.activeJobId ?? null,
    activeMode: extra?.activeMode ?? null,
    modelId: extra?.modelId ?? null,
  };
}

// --------------------------------------------------------------------------
// Browser Console Log Recorder (ring buffer)
// --------------------------------------------------------------------------
export interface BrowserLogEntry {
  timestamp: string;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
}

const browserLogRing: BrowserLogEntry[] = [];
const MAX_BROWSER_LOGS = 120;

export function initBrowserLogRecorder(): void {
  if (typeof window === 'undefined' || (window as any).__bug_snapshot_logger_init) return;
  (window as any).__bug_snapshot_logger_init = true;

  const pushLog = (level: BrowserLogEntry['level'], args: any[]) => {
    const msg = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
        try {
          const str = JSON.stringify(a);
          return str.length > 500 ? str.slice(0, 500) + '…' : str;
        } catch {
          return String(a);
        }
      })
      .join(' ')
      .slice(0, 2500);

    browserLogRing.push({
      timestamp: new Date().toLocaleTimeString(),
      level,
      message: msg,
    });
    if (browserLogRing.length > MAX_BROWSER_LOGS) {
      browserLogRing.shift();
    }
  };

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origInfo = console.info;

  console.log = (...args: any[]) => {
    pushLog('log', args);
    origLog.apply(console, args);
  };
  console.warn = (...args: any[]) => {
    pushLog('warn', args);
    origWarn.apply(console, args);
  };
  console.error = (...args: any[]) => {
    pushLog('error', args);
    origError.apply(console, args);
  };
  console.info = (...args: any[]) => {
    pushLog('info', args);
    origInfo.apply(console, args);
  };

  window.addEventListener('error', (event) => {
    pushLog('error', [`[UncaughtError] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    pushLog('error', [`[UnhandledPromiseRejection] ${event.reason?.message || event.reason}`]);
  });
}

export function getBrowserLogBuffer(): string {
  if (!browserLogRing.length) return '';
  return browserLogRing
    .map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`)
    .join('\n');
}

// --------------------------------------------------------------------------
// Browser Network Fetch Monitor (ring buffer)
// --------------------------------------------------------------------------
export interface NetworkLogEntry {
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  error?: string;
}

const networkLogRing: NetworkLogEntry[] = [];
const MAX_NETWORK_LOGS = 60;

export function initNetworkRecorder(): void {
  if (typeof window === 'undefined' || (window as any).__bug_snapshot_network_init) return;
  (window as any).__bug_snapshot_network_init = true;

  const origFetch = window.fetch;
  window.fetch = async (...args: any[]) => {
    const start = Date.now();
    const input = args[0];
    const init = args[1];
    const method = (init?.method || 'GET').toUpperCase();
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as any)?.url || '';
    const url = rawUrl.length > 250 ? rawUrl.slice(0, 250) + '…' : rawUrl;

    const entry: NetworkLogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      method,
      url,
    };

    try {
      const res = await origFetch.apply(window, args as any);
      entry.status = res.status;
      entry.durationMs = Date.now() - start;
      networkLogRing.push(entry);
      if (networkLogRing.length > MAX_NETWORK_LOGS) networkLogRing.shift();
      return res;
    } catch (err: any) {
      entry.durationMs = Date.now() - start;
      entry.error = err?.message || 'Network Error';
      networkLogRing.push(entry);
      if (networkLogRing.length > MAX_NETWORK_LOGS) networkLogRing.shift();
      throw err;
    }
  };
}

export function getRecentNetworkEntries(): NetworkLogEntry[] {
  return [...networkLogRing];
}

export function getNetworkFailureCount(): number {
  return networkLogRing.filter((n) => n.error || (n.status != null && n.status >= 400)).length;
}

// --------------------------------------------------------------------------
// Interaction ring (clicks + tab/route) — flush on snapshot only
// --------------------------------------------------------------------------
export type InteractionEntry = {
  timestamp: string;
  type: 'click' | 'tab' | 'route';
  target?: string;
  label?: string;
  detail?: string;
};

const interactionRing: InteractionEntry[] = [];
const MAX_INTERACTIONS = 50;

export function initInteractionRecorder(): void {
  if (typeof window === 'undefined' || (window as any).__bug_snapshot_interaction_init) return;
  (window as any).__bug_snapshot_interaction_init = true;

  document.addEventListener(
    'click',
    (ev) => {
      const t = ev.target as HTMLElement | null;
      if (!t || t.closest?.('#bug-snapshot-fab') || t.closest?.('.bug-snapshot-ignore')) return;
      const tag = t.tagName?.toLowerCase?.() || 'el';
      const role = t.getAttribute?.('role') || '';
      const id = t.id ? `#${t.id}` : '';
      const testId = t.getAttribute?.('data-testid') || '';
      const label = (
        t.getAttribute?.('aria-label') ||
        (t as HTMLButtonElement).innerText ||
        t.getAttribute?.('title') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      // skip password fields entirely
      if (t instanceof HTMLInputElement && t.type === 'password') return;
      interactionRing.push({
        timestamp: new Date().toISOString(),
        type: 'click',
        target: `${tag}${id}${testId ? `[${testId}]` : ''}${role ? `[role=${role}]` : ''}`.slice(0, 120),
        label: label || undefined,
      });
      if (interactionRing.length > MAX_INTERACTIONS) interactionRing.shift();
    },
    true
  );
}

export function recordTabInteraction(tab: string): void {
  interactionRing.push({
    timestamp: new Date().toISOString(),
    type: 'tab',
    detail: String(tab || '').slice(0, 40),
  });
  if (interactionRing.length > MAX_INTERACTIONS) interactionRing.shift();
}

export function getInteractionRing(): InteractionEntry[] {
  return [...interactionRing];
}

export function formatInteractionRing(max = 50): string {
  return getInteractionRing()
    .slice(-max)
    .map((e) => `[${e.timestamp}] ${e.type} ${e.target || e.detail || ''} ${e.label || ''}`.trim())
    .join('\n');
}

// --------------------------------------------------------------------------
// Draft form (sessionStorage)
// --------------------------------------------------------------------------
export const BUG_SNAPSHOT_DRAFT_KEY = 'bug_snapshot_draft_v1';
export const BUG_AUTO_TRIAGE_KEY = 'bug_auto_triage_enabled';

export function isBugAutoTriageEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const v = localStorage.getItem(BUG_AUTO_TRIAGE_KEY);
    if (v === null) return true;
    return v === '1' || v === 'true';
  } catch {
    return true;
  }
}

export function setBugAutoTriageEnabled(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BUG_AUTO_TRIAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export type BugSnapshotDraft = {
  category?: string;
  tagId?: string;
  newTitle?: string;
  symptom?: string;
  shots?: string[];
  savedAt?: string;
  snapshotType?: 'bug' | 'meal';
  goldenTitle?: string;
};

export function saveBugSnapshotDraft(draft: BugSnapshotDraft): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const slim: BugSnapshotDraft = {
      ...draft,
      shots: (draft.shots || []).slice(0, BUG_SNAPSHOT_MAX_SHOTS).map((s) =>
        s.length > 400_000 ? s.slice(0, 100) + '…[truncated for draft]' : s
      ),
      savedAt: new Date().toISOString(),
    };
    // avoid quota blow — drop shots if still huge
    let json = JSON.stringify(slim);
    if (json.length > 1_500_000) {
      slim.shots = [];
      json = JSON.stringify(slim);
    }
    sessionStorage.setItem(BUG_SNAPSHOT_DRAFT_KEY, json);
  } catch {
    try {
      sessionStorage.removeItem(BUG_SNAPSHOT_DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function loadBugSnapshotDraft(): BugSnapshotDraft | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(BUG_SNAPSHOT_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearBugSnapshotDraft(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(BUG_SNAPSHOT_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Prefer WebP for capture; JPEG fallback. */
export async function compressToWebpOrJpeg(
  dataUrl: string,
  maxEdge = 1280,
  quality = 0.8
): Promise<string> {
  if (typeof document === 'undefined') return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxEdge) {
        h = Math.round((h * maxEdge) / w);
        w = maxEdge;
      } else if (h >= w && h > maxEdge) {
        w = Math.round((w * maxEdge) / h);
        h = maxEdge;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const webp = canvas.toDataURL('image/webp', quality);
        if (webp.startsWith('data:image/webp')) {
          resolve(webp);
          return;
        }
      } catch {
        /* fall through */
      }
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function scrubPiiText(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/(password|passwd|pwd)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/(authorization|bearer)\s*[:=]?\s*\S+/gi, '$1=[REDACTED]')
    .replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]{100,}/g, '[image base64 redacted]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
}

export type CaptureChecklist = {
  a11y: boolean;
  domainPack: boolean;
  shots: number;
  logs: boolean;
  networkFails: number;
  interactions: number;
};

export function buildCaptureChecklist(flags: CaptureChecklist): string {
  return [
    flags.a11y ? '✓ a11y' : '✗ a11y',
    flags.domainPack ? '✓ domain_pack' : '✗ domain_pack',
    flags.shots ? `✓ shots(${flags.shots})` : '✗ shots',
    flags.logs ? '✓ logs' : '✗ logs',
    flags.networkFails ? `✓ network_fails(${flags.networkFails})` : '· network',
    flags.interactions ? `✓ interactions(${flags.interactions})` : '· interactions',
  ].join(' · ');
}

// --------------------------------------------------------------------------
// Dedicated Accessibility Tree Builder
// --------------------------------------------------------------------------
export interface A11yNode {
  tag: string;
  role?: string;
  name?: string;
  id?: string;
  testId?: string;
  states?: Record<string, any>;
  children?: A11yNode[];
}

export function buildAccessibilityTree(rootElement?: Element | null): {
  tree: A11yNode;
  textOutline: string;
  landmarks: string[];
  headings: { level: number; text: string }[];
} {
  if (typeof document === 'undefined') {
    return {
      tree: { tag: 'none' },
      textOutline: 'No document available',
      landmarks: [],
      headings: [],
    };
  }

  const root = rootElement || document.body;
  const landmarks: string[] = [];
  const headings: { level: number; text: string }[] = [];
  const outlineLines: string[] = ['Accessibility Tree & Landmarks Outline:'];

  const walk = (el: Element, depth: number): A11yNode | null => {
    if (depth > 12) return null;
    const tag = el.tagName?.toLowerCase?.() || 'node';
    if (['script', 'style', 'svg', 'path', 'noscript', 'meta', 'link'].includes(tag)) return null;

    const explicitRole = el.getAttribute('role');
    let implicitRole: string | undefined;
    if (tag === 'button') implicitRole = 'button';
    else if (tag === 'nav') implicitRole = 'navigation';
    else if (tag === 'main') implicitRole = 'main';
    else if (tag === 'header') implicitRole = 'banner';
    else if (tag === 'footer') implicitRole = 'contentinfo';
    else if (tag === 'form') implicitRole = 'form';
    else if (tag === 'dialog') implicitRole = 'dialog';
    else if (tag === 'a' && el.hasAttribute('href')) implicitRole = 'link';
    else if (/^h[1-6]$/.test(tag)) implicitRole = `heading-${tag.slice(1)}`;

    const role = explicitRole || implicitRole;
    const ariaLabel = el.getAttribute('aria-label') || undefined;
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    let labelName = ariaLabel;
    if (!labelName && ariaLabelledBy) {
      const target = document.getElementById(ariaLabelledBy);
      if (target) labelName = (target as HTMLElement).innerText || target.textContent || undefined;
    }
    if (!labelName && el.getAttribute('title')) labelName = el.getAttribute('title') || undefined;
    if (!labelName && el.getAttribute('alt')) labelName = el.getAttribute('alt') || undefined;
    if (!labelName && el.getAttribute('placeholder')) labelName = el.getAttribute('placeholder') || undefined;
    if (!labelName && ['button', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'option'].includes(tag)) {
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3 /* Node.TEXT_NODE */)
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      if (directText) labelName = directText.slice(0, 80);
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag.slice(1), 10);
      const text = ((el as HTMLElement).innerText || el.textContent || '').trim().slice(0, 80);
      if (text) headings.push({ level, text });
    }

    if (['navigation', 'main', 'banner', 'contentinfo', 'dialog', 'form', 'alert'].includes(role || '')) {
      landmarks.push(`[${role}] ${labelName || tag}`);
    }

    const states: Record<string, any> = {};
    ['aria-expanded', 'aria-checked', 'aria-selected', 'aria-hidden', 'aria-disabled', 'aria-invalid', 'aria-live', 'disabled'].forEach((attr) => {
      if (el.hasAttribute(attr)) states[attr] = el.getAttribute(attr);
    });

    const isImportant = !!(role || labelName || Object.keys(states).length > 0 || el.getAttribute('data-testid') || el.id);

    const children: A11yNode[] = [];
    for (const child of Array.from(el.children || []).slice(0, 25)) {
      const childNode = walk(child, depth + 1);
      if (childNode) children.push(childNode);
    }

    const node: A11yNode = {
      tag,
      role,
      name: labelName,
      id: el.id || undefined,
      testId: el.getAttribute('data-testid') || el.getAttribute('data-id') || undefined,
      states: Object.keys(states).length > 0 ? states : undefined,
      children: children.length > 0 ? children : undefined,
    };

    if (isImportant) {
      const indent = '  '.repeat(Math.min(depth, 8));
      const stateStr = Object.entries(states).map(([k, v]) => `${k}=${v}`).join(' ');
      outlineLines.push(
        `${indent}- [${role || tag}] ${labelName ? `"${labelName}"` : ''} ${stateStr ? `(${stateStr})` : ''}`.trimEnd()
      );
    }

    return node;
  };

  const tree = walk(root, 0) || { tag: 'body' };
  return {
    tree,
    textOutline: outlineLines.slice(0, 200).join('\n'),
    landmarks: Array.from(new Set(landmarks)).slice(0, 40),
    headings: headings.slice(0, 40),
  };
}

/** Simplified DOM for triage — not full outerHTML (token/PII control). */
export function buildSimplifiedDom(root?: Element | null, maxNodes = 120): any {
  if (typeof document === 'undefined') return { note: 'no-document' };
  const start =
    root ||
    document.querySelector('[data-unified-modal], [role="dialog"]') ||
    document.body;
  if (!start) return { note: 'empty' };

  let count = 0;
  const walk = (el: Element, depth: number): any | null => {
    if (count >= maxNodes || depth > 8) return null;
    count++;
    const tag = el.tagName?.toLowerCase?.() || 'node';
    if (['script', 'style', 'svg', 'path', 'noscript'].includes(tag)) return null;
    const role = el.getAttribute('role') || undefined;
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-id') || undefined;
    const id = el.id || undefined;
    const aria = el.getAttribute('aria-label') || undefined;
    const cls =
      typeof el.className === 'string'
        ? el.className.split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
        : undefined;
    let text: string | undefined;
    try {
      const t = (el as HTMLElement).innerText || el.textContent || '';
      const clean = t.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (clean && el.children.length === 0) text = clean;
    } catch {
      /* ignore */
    }
    const kids: any[] = [];
    for (const child of Array.from(el.children || []).slice(0, 12)) {
      const n = walk(child, depth + 1);
      if (n) kids.push(n);
      if (count >= maxNodes) break;
    }
    const node: any = { tag };
    if (role) node.role = role;
    if (testId) node.testId = testId;
    if (id) node.id = id;
    if (aria) node.aria = aria;
    if (cls) node.class = cls.slice(0, 120);
    if (text) node.text = text;
    if (kids.length) node.children = kids;
    return node;
  };

  return {
    root: walk(start, 0),
    openDialogs: Array.from(document.querySelectorAll('[role="dialog"], [data-unified-modal]')).map(
      (d) => ({
        id: (d as HTMLElement).id || null,
        aria: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby') || null,
        class: typeof (d as HTMLElement).className === 'string' ? (d as HTMLElement).className.slice(0, 80) : null,
      })
    ),
    title: document.title || '',
  };
}

/** Collapse noisy USDA candidate dumps (same idea as BugTrackerModal.cleanLogText). */
export function cleanBugLogText(rawLog: string, maxChars = 12_000): string {
  if (!rawLog || typeof rawLog !== 'string') return '';
  const lines = rawLog.split('\n');
  const filtered: string[] = [];
  let skippingDbMatches = false;
  let dbMatchCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('=== VERIFIED DATABASE MATCHES ===')) {
      skippingDbMatches = true;
      dbMatchCount = 0;
      filtered.push('=== VERIFIED DATABASE MATCHES === (candidates collapsed)');
      continue;
    }
    if (skippingDbMatches) {
      if (
        line.trim().startsWith('- [USDA]') ||
        line.trim().startsWith('- [OFF]') ||
        line.trim().startsWith('- [WebSearch]') ||
        line.trim().startsWith('- [OpenFoodFacts]')
      ) {
        dbMatchCount++;
        continue;
      } else {
        if (dbMatchCount > 0) {
          filtered.push(`... (${dbMatchCount} database search candidates omitted for brevity) ...`);
          dbMatchCount = 0;
        }
        skippingDbMatches = false;
      }
    }
    filtered.push(line);
  }

  const joined = filtered.join('\n');
  if (joined.length <= maxChars) return joined;
  // Keep head + tail if exceeding max budget
  const half = Math.floor(maxChars / 2) - 40;
  return `${joined.slice(0, half)}\n\n... [${joined.length - maxChars} chars omitted] ...\n\n${joined.slice(-half)}`;
}

/** Keep digest payload under budget — strip heavy images and huge arrays. */
export function budgetPayloadForDigest(payload: any, maxChars = 8_000): string {
  if (!payload) return '';
  if (typeof payload === 'string') return cleanBugLogText(payload, maxChars);
  try {
    const clone = JSON.parse(JSON.stringify(payload));
    delete clone.screenshot_data;
    // Legacy duplicate: FlagIssueModal used to send the same base64 under both
    // names and the scrub above only caught one, so a full-size copy always
    // survived into the digest. The sender is fixed, but keep this list complete
    // so an older client cannot reintroduce the leak.
    delete clone.screenshot_url;
    delete clone.screenshotDataUrl;
    delete clone.image_data;
    delete clone.food_image_data;
    delete clone.raw_image_data;
    const str = JSON.stringify(clone, null, 2);
    if (str.length <= maxChars) return str;
    return cleanBugLogText(str, maxChars);
  } catch {
    return String(payload).slice(0, maxChars);
  }
}

export function briefFromTag(tag: any): {
  id: string;
  title: string;
  category: string;
  status: string;
  identified_problems: string;
  whats_still_open: string;
  resolution_note: string;
  comments_count: number;
  linked_count: number;
  r2_prefix: string;
  updated_at: string;
  public_n: number;
  public_id: string;
  queue: string;
  bug: string;
  class: string | null;
  occurrences: number;
  unmatched: boolean;
  last_commit: any | null;
} {
  const comments = Array.isArray(tag.comments) ? tag.comments : [];
  const wi = hydrateWorkItem(tag);
  return {
    id: tag.id,
    title: tag.title || '',
    category: tag.category || 'foodcart',
    status: tag.status || 'to_fix',
    identified_problems: tag.identified_problems || '',
    whats_still_open: tag.whats_still_open || '',
    resolution_note: tag.resolution_note || '',
    comments_count: comments.length,
    linked_count: tag.linked_count ?? tag.linked_issues?.length ?? 0,
    r2_prefix: bugTagR2Prefix(tag.category || 'foodcart', tag.id),
    updated_at: tag.resolved_at || tag.created_at || new Date().toISOString(),
    public_n: wi.public_n || 0,
    public_id: publicId(wi, tag.id),
    queue: wi.queue,
    bug: wi.bug || '',
    class: wi.class || null,
    occurrences: wi.occurrences || tag.linked_count || 1,
    unmatched: !!wi.unmatched,
    last_commit: wi.commits?.length ? wi.commits[wi.commits.length - 1] : null,
  };
}

/** Primary UI structure for ALL agents (lite + strong). Not raw DOM. */
export const AGENT_STRUCTURE_DEFAULT = 'a11y' as const;
export const A11Y_AGENT_MAX_CHARS = 10_000;
export const DOMAIN_PACK_AGENT_MAX_CHARS = 10_000;
export const TIER1_MAX_SHOTS = 2;

export function buildBugTriageSystemPrompt(): string {
  return `You are the Expert AI Bug Triage & Root Cause Diagnosis Agent for the Health Cockpit application.
Your mission is to perform a precise, highly detailed diagnostic audit that a software engineer or coding agent can immediately use to fix the bug without ambiguity.

STRUCTURE POLICY (binding for ALL models — Flash-lite, Flash, Grok, Claude, Qwen, etc.):
1. Primary UI evidence = Accessibility tree / a11y outline (roles, names, landmarks, dialogs).
2. Primary product evidence = domain_pack.json (food macros/receipt/mode OR biomarker keys/values).
3. Nutrition Calculation & Receipt Table (.md): Exact line-by-line item weights, calories, macros, and source receipts.
4. Active Debug Payload (.json): Internal calculation states, scout items, component breakdown, and pipeline diagnostics.
5. Backend & Live Logs: Execution traces, reality check warnings, invariant logs, and error stacks.

DIAGNOSTIC REQUIREMENTS:
- **Never give generic summaries.** (e.g., do NOT just say "calculations may require verification" or "discrepancies exist").
- **Perform Exact Mathematical Audits**: For food calculation bugs, list each specific dish item, its logged portion (g), calories (kcal), and macros. Show the exact arithmetic discrepancy (e.g., "Item A (102.6 kcal) + Cooking Oil (53 kcal) = 155.6 kcal, but parent logged 0 kcal because composite_dish_suppress_top_level_prep was triggered").
- **Pinpoint Root Cause Mechanism**: Identify the exact algorithm, flag, or condition causing the bug (e.g., truth lock override, cooking multiplier double-application, portion scale mismatch, missing null check, Firestore sync timeout).
- **Name Precise Code Locations**: Cite specific files and functions (e.g., \`src/utils/foodBudgetReconcile.ts:portionAndReconcile()\`, \`server.ts:calculateCompositeTotals()\`).

Format your diagnosis in this exact Markdown structure:

## Symptom
<Concise 1-2 sentence statement of the user symptom and affected entities>

## Expected vs actual
- **Expected:** <Specific numeric/behavioral expectation with exact values>
- **Actual:** <Exact observed values, arithmetic error, or failure state from the logs/payload>

## Suspected layer
(UI | JobQueue | Scout | Budget/Reconcile | Label locks | Sync/R2 | Biomarker | Database | Other)
**<LayerName>**

## Modes affected
(A / D / Edit / N/A) — or medical agent name if biomarker

## Evidence & Mathematical Audit
- <Itemized audit of values from Nutrition Calculation Table and Debug JSON>
- <Exact backend log quotes showing invariant violations or skipped checks>
- <A11y or UI observations confirming rendered output>

## Root Cause Analysis
<Clear technical explanation of why the calculation or component failed, citing exact variables and logic flow>

## Likely code areas
- \`<filepath:function_or_symbol>\` — <why this function is involved and what needs to change>

## What's still open
- [ ] <Concrete coding task or test assertion needed to fix and verify the issue>

## Confidence
(high|medium|low) — <justification based on logs and data certainty>`;
}

export function buildBugTriageUserPrompt(args: {
  tagTitle: string;
  category: string;
  userSymptom?: string;
  priorIdentified?: string;
  stillOpen?: string;
  env?: any;
  logs?: string;
  payloadJson?: string;
  domainPackJson?: string;
  domJson?: string;
  a11yText?: string;
  networkJson?: string;
  overviewMd?: string;
  nutritionTableMd?: string;
  debugJson?: string;
  shotCount?: number;
  reportIds?: string[];
}): string {
  const parts: string[] = [];
  const shots = args.shotCount ?? 0;
  const reports = args.reportIds || [];
  parts.push(`# Bug: ${args.tagTitle}`);
  parts.push(`Category: ${args.category}`);
  parts.push(`Structure default: **a11y** (all agents)`);
  parts.push(`Screenshots available: ${shots} (use ≤${TIER1_MAX_SHOTS} for vision if any)`);
  parts.push(`Report IDs: ${reports.join(', ') || 'none'}`);

  if (args.userSymptom) {
    parts.push(`\n## User symptom\n${args.userSymptom}`);
  }
  if (args.priorIdentified) {
    parts.push(`\n## Prior Identified problems\n${String(args.priorIdentified).slice(0, 3000)}`);
  }
  if (args.stillOpen) {
    parts.push(`\n## What's still open\n${String(args.stillOpen).slice(0, 2000)}`);
  }
  if (args.overviewMd) {
    parts.push(`\n## Overview\n${String(args.overviewMd).slice(0, 4000)}`);
  }
  if (args.nutritionTableMd) {
    parts.push(`\n## Nutrition Calculation & Receipt Table\n${String(args.nutritionTableMd).slice(0, 10_000)}`);
  }
  if (args.debugJson) {
    parts.push(`\n## Active Debug Payload\n\`\`\`json\n${String(args.debugJson).slice(0, 10_000)}\n\`\`\``);
  }
  if (args.env) {
    parts.push(`\n## Environment\n\`\`\`json\n${JSON.stringify(args.env, null, 2).slice(0, 1500)}\n\`\`\``);
  }

  // PRIMARY for all agents
  if (args.a11yText) {
    parts.push(
      `\n## Accessibility tree (PRIMARY structure — all agents)\n\`\`\`\n${String(args.a11yText).slice(0, A11Y_AGENT_MAX_CHARS)}\n\`\`\``
    );
  } else {
    parts.push(`\n## Accessibility tree\n_Not attached — use domain pack + logs._`);
  }

  if (args.domainPackJson) {
    parts.push(
      `\n## Domain pack (PRIMARY product facts)\n\`\`\`json\n${String(args.domainPackJson).slice(0, DOMAIN_PACK_AGENT_MAX_CHARS)}\n\`\`\``
    );
  }

  // Secondary
  if (args.networkJson) {
    parts.push(`\n## Network (failures preferred)\n\`\`\`json\n${String(args.networkJson).slice(0, 3000)}\n\`\`\``);
  }
  if (args.logs) {
    parts.push(`\n## Logs\n\`\`\`\n${cleanBugLogText(args.logs, 10_000)}\n\`\`\``);
  }
  if (args.payloadJson && !args.domainPackJson) {
    parts.push(`\n## Budgeted payload (fallback)\n\`\`\`json\n${String(args.payloadJson).slice(0, 6000)}\n\`\`\``);
  }
  // DOM only if a11y missing
  if (args.domJson && !args.a11yText) {
    parts.push(`\n## Slim DOM (fallback — a11y missing)\n\`\`\`json\n${String(args.domJson).slice(0, 4000)}\n\`\`\``);
  }

  parts.push(`\nWrite Identified problems markdown now. Prefer a11y + domain pack over screenshots.`);
  return parts.join('\n');
}
