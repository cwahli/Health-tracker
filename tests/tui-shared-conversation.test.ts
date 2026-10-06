// A TUI and the Telegram bot are two clients of ONE opencode service driving
// ONE session. The server serialises their turns, so an attached terminal must
// never stop the bot from working — which is exactly what the lease used to do:
// while a terminal was open, every chat message was queued and nothing ran until
// the Mini App closed.
//
// These tests pin the two halves of that: presence is still observable (so the
// bot can tell the user a turn is visible in the terminal), and presence is not
// a lock.
//
// HOME is redirected before importing bot-host.mjs because stateDir() resolves
// ~/.local/state/bot-host at module load. The real state directory must never be
// written by a test — the earlier lease suite left dozens of `test-lease-*`
// directories in it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  tuiSurfaceFor,
  normalizeSurface,
  surfaceForModel,
  sessionIdMatchesSurface,
  resolveTuiLaunch,
  tuiLaunchCommand,
  latestClineSessionId,
} from '../scripts/lib/tui-surface.mjs';

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-shared-'));
const PRIOR_HOME = process.env.HOME;
process.env.HOME = SANDBOX_HOME;

type TuiModule = { tuiIsAttached: (botId: string, sessionId: string) => boolean };
let mod: TuiModule;

const BOT = 'vm2';
const SESSION = 'ses_shared';
const leaseFile = () => path.join(SANDBOX_HOME, '.local', 'state', 'bot-host', BOT, 'tui-lease.json');

function writeLease(payload: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(leaseFile()), { recursive: true });
  fs.writeFileSync(leaseFile(), JSON.stringify(payload));
}

beforeAll(async () => {
  mod = (await import('../scripts/bot-host.mjs')) as unknown as TuiModule;
});

afterAll(() => {
  if (PRIOR_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = PRIOR_HOME;
  fs.rmSync(SANDBOX_HOME, { recursive: true, force: true });
});

describe('TUI presence is observable', () => {
  it('reports an attached TUI for the session it is attached to', () => {
    writeLease({ session: SESSION, pid: 1234, heartbeat: Date.now() });
    expect(mod.tuiIsAttached(BOT, SESSION)).toBe(true);
  });

  it('ignores a lease held on a different session', () => {
    writeLease({ session: 'ses_someone_else', pid: 1234, heartbeat: Date.now() });
    expect(mod.tuiIsAttached(BOT, SESSION)).toBe(false);
  });

  it('treats a lease with no session id as present rather than guessing', () => {
    writeLease({ pid: 1234, heartbeat: Date.now() });
    expect(mod.tuiIsAttached(BOT, SESSION)).toBe(true);
  });

  it('reads a lease whose heartbeat has expired as gone', () => {
    // A phone that dies mid-session must not leave a permanent mark. 90s is
    // TUI_LEASE_MAX_AGE_MS; go well past it.
    writeLease({ session: SESSION, pid: 1234, heartbeat: Date.now() - 10 * 60_000 });
    expect(mod.tuiIsAttached(BOT, SESSION)).toBe(false);
  });

  it('reads a corrupt lease as gone instead of throwing', () => {
    fs.mkdirSync(path.dirname(leaseFile()), { recursive: true });
    fs.writeFileSync(leaseFile(), '{not json');
    expect(mod.tuiIsAttached(BOT, SESSION)).toBe(false);
  });

  it('reports absent when there is no lease at all', () => {
    fs.rmSync(leaseFile(), { force: true });
    expect(mod.tuiIsAttached(BOT, SESSION)).toBe(false);
  });
});

describe('lifecycle: naming, status and closing a pane', () => {
  const writeLiveLease = (extra: Record<string, unknown> = {}) =>
    writeLease({ session: SESSION, pid: 1234, heartbeat: Date.now(), ...extra });

  it('reports no pane when nothing is open', async () => {
    const { tuiStatusLine } = (await import('../scripts/bot-host.mjs')) as unknown as {
      tuiStatusLine: (bot: string, session: string) => string;
    };
    fs.rmSync(leaseFile(), { force: true });
    expect(tuiStatusLine(BOT, SESSION)).toMatch(/none open/);
  });

  it('names the pane, the client count and the age', async () => {
    const { tuiStatusLine } = (await import('../scripts/bot-host.mjs')) as unknown as {
      tuiStatusLine: (bot: string, session: string) => string;
    };
    const twoHoursAgo = Date.now() - 2 * 60 * 60_000;
    writeLiveLease({ pane: 'VM-tui-vm2', bot: 'vm2', clients: 2, since: twoHoursAgo });
    const line = tuiStatusLine(BOT, SESSION);
    expect(line).toContain('VM-tui-vm2');
    expect(line).toContain('2 clients attached');
    expect(line).toContain('up 2h 0m');
  });

  it('says so when a pane is open but nobody is attached', async () => {
    const { tuiStatusLine } = (await import('../scripts/bot-host.mjs')) as unknown as {
      tuiStatusLine: (bot: string, session: string) => string;
    };
    writeLiveLease({ pane: 'VM-tui', clients: 0, since: Date.now() - 22 * 60_000 });
    const line = tuiStatusLine(BOT, SESSION);
    expect(line).toContain('no client attached');
    expect(line).toContain('up 22m');
  });

  it('reports the age in days for a pane that has been up a long time', async () => {
    // This is the case that went wrong once already: a day-old pane read as
    // stale when it was in fact the live terminal.
    const { tuiStatusLine } = (await import('../scripts/bot-host.mjs')) as unknown as {
      tuiStatusLine: (bot: string, session: string) => string;
    };
    writeLiveLease({ pane: 'VM-tui-vm2', clients: 1, since: Date.now() - (25 * 60 * 60_000 + 30 * 60_000) });
    expect(tuiStatusLine(BOT, SESSION)).toContain('up 1d 1h');
  });

  it('never invents a pane name when the lease predates the field', async () => {
    // A lease with no `pane` must not be reported under a guessed name: a wrong
    // name is what would make /tui off kill the wrong session.
    const { tuiStatusLine } = (await import('../scripts/bot-host.mjs')) as unknown as {
      tuiStatusLine: (bot: string, session: string) => string;
    };
    writeLiveLease({});
    expect(tuiStatusLine(BOT, SESSION)).toContain('unknown pane');
  });

  it('documents both subcommands in help', async () => {
    const help = fs.readFileSync(new URL('../scripts/lib/commands.mjs', import.meta.url), 'utf8');
    expect(help).toMatch(/\/tui status/);
    expect(help).toMatch(/\/tui off/);
  });
});

// This file's whole premise is "a TUI and the bot are two clients of ONE
// session". That is true of opencode and FALSE of cline, and the terminal used
// to be opencode unconditionally — so a chat on cline opened an opencode TUI on
// a stale opencode session id: a different agent on a different thread from the
// one answering in Telegram (live 2026-09-29, prefs said
// cline:cline-free/deepseek-v4.1-flash, the pane read "Build · MiMo-V2.6-Flash
// Free OpenCode"). These cases pin the lane decision and the honesty split.
describe('the terminal launches the lane the chat is on', () => {
  it('reads the surface off the model, not off the bot default', () => {
    expect(tuiSurfaceFor('opencode/space-bunny-free').surface).toBe('opencode');
    expect(tuiSurfaceFor('cline:cline-free/deepseek-v4.1-flash').surface).toBe('cline');
    expect(tuiSurfaceFor('gemini:gemini-2.5-pro').surface).toBe('gemini');
    // An unrecognised ref must not invent a lane; opencode is the default.
    expect(tuiSurfaceFor('').surface).toBe('opencode');
    expect(tuiSurfaceFor(undefined).surface).toBe('opencode');
  });

  it('accepts a bare surface name as well as a model ref', () => {
    // Two sources feed the decision: the live prefs model and the surface
    // snapshot bot-host writes into tui-open.json. They are spelled differently.
    expect(normalizeSurface('cline')).toBe('cline');
    expect(normalizeSurface('cline:cline-free/x')).toBe('cline');
    expect(normalizeSurface('CLINE')).toBe('cline');
    expect(normalizeSurface('nonsense')).toBe('opencode');
    expect(surfaceForModel('gemini:gemini-2.5-pro')).toBe('gemini');
  });

  it('keeps session ids of one tool from being handed to another', () => {
    expect(sessionIdMatchesSurface('ses_f227779acffe', 'opencode')).toBe(true);
    expect(sessionIdMatchesSurface('1790714599861_80trx', 'opencode')).toBe(false);
    expect(sessionIdMatchesSurface('1790714599861_80trx', 'cline')).toBe(true);
    expect(sessionIdMatchesSurface('ses_f227779acffe', 'cline')).toBe(false);
    expect(sessionIdMatchesSurface('', 'cline')).toBe(false);
  });

  it('opens the cline TUI on the chat lane, resumed onto its own session', () => {
    const launch = resolveTuiLaunch({
      surface: 'cline',
      model: 'cline-free/deepseek-v4.1-flash',
      sessionId: '1790_abc',
      workspace: '/ws',
      opencodeBin: '/oc',
      clineBin: '/cl',
    });
    expect(launch.argv).toEqual(['/cl', '-i', '-P', 'cline', '-m', 'cline-free/deepseek-v4.1-flash', '-c', '/ws', '--id', '1790_abc']);
    expect(tuiLaunchCommand(launch)).toBe("'/cl' '-i' '-P' 'cline' '-m' 'cline-free/deepseek-v4.1-flash' '-c' '/ws' '--id' '1790_abc'");
  });

  it('strips this repo s surface prefix before handing a model to the cline CLI', () => {
    // `cline:` is our own prefix, not cline's spelling. The CLI wants
    // `cline-free/deepseek-v4.1-flash`; the prefixed form fails like an unknown
    // model, and the terminal would then be on a different model from the chat.
    const launch = resolveTuiLaunch({ surface: 'cline', model: 'cline:cline-free/x', clineBin: '/cl' });
    expect(launch.argv).toContain('cline-free/x');
    expect(launch.argv).not.toContain('cline:cline-free/x');
  });

  it('leaves the opencode argv exactly as it was', () => {
    const launch = resolveTuiLaunch({ surface: 'opencode', sessionId: 'ses_abc', opencodeBin: '/oc' });
    expect(launch.argv).toEqual(['/oc', '--session', 'ses_abc']);
    expect(tuiLaunchCommand(launch)).toBe("'/oc' '--session' 'ses_abc'");
  });

  it('refuses an API-only lane instead of falling back to opencode', () => {
    // A silent fallback IS the defect wearing a different hat. Gemini has no
    // screen; a scraped PTY with a badge is not a terminal.
    const launch = resolveTuiLaunch({ surface: 'gemini' });
    expect(launch.argv).toBeNull();
    expect(launch.reason).toMatch(/no terminal/i);
    expect(tuiLaunchCommand(launch)).toBe('');
  });

  it('refuses an unknown surface rather than guessing opencode', () => {
    const launch = resolveTuiLaunch({ surface: 'nope' });
    expect(launch.argv).toBeNull();
    expect(launch.reason).toMatch(/unknown surface/i);
  });

  it('still opens a bare cline TUI when no session has been recorded', () => {
    const launch = resolveTuiLaunch({ surface: 'cline', clineBin: '/cl' });
    expect(launch.argv).toEqual(['/cl', '-i']);
    expect(launch.note).toMatch(/fresh Cline session/i);
  });

  it('shares a session on opencode and never on cline', () => {
    // The claim is the other half of the bug: a turn must never be advertised as
    // visible in a terminal that cannot see it.
    expect(tuiSurfaceFor('opencode/space-bunny-free').sharedSession).toBe(true);
    expect(tuiSurfaceFor('cline:cline-free/deepseek-v4.1-flash').sharedSession).toBe(false);
    expect(tuiSurfaceFor('gemini:gemini-2.5-pro').sharedSession).toBe(false);
    expect(tuiSurfaceFor('gemini:gemini-2.5-pro').terminal).toBe(false);
  });

  it('resumes the newest cline thread for the same workspace, and no other', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-sessions-'));
    const write = (id: string, cwd: string, startedAt: string) => {
      fs.mkdirSync(path.join(dir, id), { recursive: true });
      fs.writeFileSync(path.join(dir, id, `${id}.json`), JSON.stringify({ cwd, started_at: startedAt }));
    };
    write('100_old', '/ws', '2026-01-01T00:00:00.000Z');
    write('200_new', '/ws', '2026-05-01T00:00:00.000Z');
    write('300_elsewhere', '/other', '2026-09-01T00:00:00.000Z');
    try {
      // The newest session overall belongs to a different checkout and must not
      // be shown as this chat's thread.
      expect(latestClineSessionId({ workspace: '/ws', dir })).toBe('200_new');
      expect(latestClineSessionId({ workspace: '/nowhere', dir })).toBe('');
      expect(latestClineSessionId({ workspace: '/ws', dir: '/nonexistent' })).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the turn note tells the truth about the terminal', () => {
  const src = () => fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');

  it('does not claim a shared session on a lane that has none', () => {
    // "Same session, so it shows up in both" is only true for opencode. On a
    // cline chat the terminal resumes the LAST cline thread and each new message
    // starts a fresh one, so the claim would be a lie the user finds by watching
    // a turn that never appears.
    expect(src()).toMatch(/openSurface\.sharedSession/);
    expect(src()).toMatch(/cannot resume a thread headlessly/);
  });

  it('names the lane in the /tui reply instead of hardcoding opencode', () => {
    // The literal it replaced: `*opencode TUI*` on a chat that was on cline.
    expect(src()).not.toMatch(/\*opencode TUI\*/);
    expect(src()).toMatch(/tuiSurface\.label/);
  });

  it('refuses a Mini App button for a lane with no terminal', () => {
    expect(src()).toMatch(/if \(!tuiSurface\.terminal\)/);
  });

  it('records the surface and that lane s own session id in tui-open.json', () => {
    // One file, one chat: the attach cannot be told the lane any other way, and
    // a cline id in sessions.json would be handed to `opencode run --session`.
    expect(src()).toMatch(/cline-sessions\.json/);
    expect(src()).toMatch(/surface: tuiSurface\.surface/);
  });
});

describe('presence is not a lock', () => {
  it('exports no function that gates a turn on the TUI', async () => {
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/tuiHoldsConversation/);
    // The deferral had exactly one shape: a queue-and-return branch. If it comes
    // back, it will bring that branch with it.
    expect(src).not.toMatch(/The TUI has this conversation/);
  });

  it('has no drain timer left over from the deferral', async () => {
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/scheduleTuiQueueDrain|tuiDrainTimers/);
  });

  it('still tells the user a TUI is watching, or the turn looks like it ran twice', async () => {
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(turnSessionId && tuiIsAttached\(config\.id, turnSessionId\)\) \{/);
  });

  it('reads presence per session, so a terminal on another project is not claimed', async () => {
    // Presence is scoped to a session id. Checking a bare chat-wide id made a
    // terminal on one project claim to be watching a turn in another.
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/tuiIsAttached\(config\.id, sessions\.get\(/);
  });

  it('does not tell the user on a turn with no TUI attached', async () => {
    // The note is inside the presence check, not unconditional — otherwise every
    // ordinary turn in every chat grows a line about a terminal that is not there.
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    const guard = 'if (turnSessionId && tuiIsAttached(config.id, turnSessionId)) {';
    const start = src.indexOf(guard);
    expect(start).toBeGreaterThan(-1);
    const noteAt = src.indexOf('A TUI is open on this conversation');
    expect(noteAt).toBeGreaterThan(start);
    // The note sits between the guard and its closing brace, so it cannot fire
    // on a turn with no terminal attached.
    const body = src.slice(start + guard.length, noteAt);
    expect(body).not.toMatch(/\}\s*$/);
    expect(body.trim()).not.toMatch(/^\}/);
  });
});

describe('a chat session belongs to exactly one workspace', () => {
  // The 2026-09-29 defect: three bots had their chat row pointing at PIP Defense
  // Council sessions while /tui advertised /home/ubuntu/src/Health-tracker, so
  // the terminal showed a council conversation and the bot answered from the
  // website repo. sessions.json held one bare id per chat with nothing recording
  // which project it belonged to, so nothing could notice.
  const HT = '/home/ubuntu/src/Health-tracker';
  const EXT = '/home/ubuntu/projects/external-2';
  let mod: {
    sessionForWorkspace: (s: Map<string, string>, c: string, w: string) => string | null;
    bindSessionForWorkspace: (s: Map<string, string>, c: string, w: string, id: string) => boolean;
  };

  beforeAll(async () => {
    mod = (await import('../scripts/bot-host.mjs')) as never;
  });

  it('returns the session when the workspace matches', () => {
    const s = new Map<string, string>();
    mod.bindSessionForWorkspace(s, '1', HT, 'ses_a');
    expect(mod.sessionForWorkspace(s, '1', HT)).toBe('ses_a');
  });

  it('returns nothing after a project switch, so the next turn starts fresh', () => {
    const s = new Map<string, string>();
    mod.bindSessionForWorkspace(s, '1', HT, 'ses_a');
    expect(mod.sessionForWorkspace(s, '1', EXT)).toBeNull();
  });

  it('never hands back another project session after switching back and forth', () => {
    const s = new Map<string, string>();
    mod.bindSessionForWorkspace(s, '1', HT, 'ses_a');
    mod.bindSessionForWorkspace(s, '1', EXT, 'ses_ext');
    expect(mod.sessionForWorkspace(s, '1', HT)).toBeNull();
    expect(mod.sessionForWorkspace(s, '1', EXT)).toBe('ses_ext');
  });

  it('treats a bare id from before scoping as belonging to nothing', () => {
    // Every existing row on disk looks like this. Guessing its project is how the
    // council sessions got adopted in the first place.
    const s = new Map([['1', 'ses_legacy']]);
    expect(mod.sessionForWorkspace(s, '1', HT)).toBeNull();
    expect(mod.sessionForWorkspace(s, '1', EXT)).toBeNull();
  });

  it('treats a different directory under the same project as a different session', () => {
    // The vm bot runs from deploy/Health-tracker while its registry says
    // src/Health-tracker. Those are different conversations to opencode.
    const s = new Map<string, string>();
    mod.bindSessionForWorkspace(s, '1', HT, 'ses_a');
    expect(mod.sessionForWorkspace(s, '1', '/home/ubuntu/deploy/Health-tracker')).toBeNull();
  });

  it('keeps one row per chat, so a switch cannot leave two behind', () => {
    const s = new Map<string, string>();
    mod.bindSessionForWorkspace(s, '1', HT, 'ses_a');
    mod.bindSessionForWorkspace(s, '1', EXT, 'ses_ext');
    expect(s.size).toBe(1);
  });

  it('refuses to bind an empty session id', () => {
    const s = new Map<string, string>();
    expect(mod.bindSessionForWorkspace(s, '1', HT, '')).toBe(false);
    expect(s.size).toBe(0);
  });

  it('leaves no unscoped read of this chat session in the turn path', async () => {
    // Every reader has to go through the scoped helper, or one of them will hand
    // back a foreign project's session and the two drift apart again.
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/sessions\.get\(chatId\)/);
  });

  it('passes the resolved session to the run instead of leaving it undefined', async () => {
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    // This was `viewMode === 'tui' ? … : undefined`, so a turn with no tx view ran
    // with no session at all and opencode picked its own — the original split.
    expect(src).not.toMatch(/sessionId: workSession\.viewMode === 'tui'/);
    expect(src).toMatch(/sessionId: turnSessionId,/);
  });

  it('tells tui-attach.sh which workspace to open', async () => {
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/workspace: tuiWorkspace,/);
  });

  it('makes tui-attach.sh prefer the recorded workspace over the static guess', async () => {
    const sh = fs.readFileSync(new URL('../scripts/mobile/tui-attach.sh', import.meta.url), 'utf8');
    expect(sh).toMatch(/tui-open\.json/);
    expect(sh).toMatch(/SESSION_WORKSPACE="\$TUI_SESSION_WORKSPACE"/);
    // The fallback must be the env var, never the other way round.
    expect(sh).toMatch(/\[ -n "\$SESSION_WORKSPACE" \] \|\| SESSION_WORKSPACE="\$WORKTREE"/);
    // A recorded-but-missing directory is refused out loud rather than silently
    // opening the wrong project.
    expect(sh).toMatch(/\[ ! -d "\$SESSION_WORKSPACE" \]/);
  });
});
