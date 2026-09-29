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
    expect(src).toMatch(/const tuiWatching = tuiIsAttached\(/);
    expect(src).toMatch(/if \(tuiWatching\) \{/);
  });

  it('does not tell the user on a turn with no TUI attached', async () => {
    // The note is inside the presence check, not unconditional — otherwise every
    // ordinary turn in every chat grows a line about a terminal that is not there.
    const src = fs.readFileSync(new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8');
    const start = src.indexOf('const tuiWatching = tuiIsAttached(');
    expect(start).toBeGreaterThan(-1);
    const noteAt = src.indexOf('A TUI is open on this conversation');
    expect(noteAt).toBeGreaterThan(start);
    expect(src.slice(start, noteAt)).toMatch(/if \(tuiWatching\)/);
  });
});
