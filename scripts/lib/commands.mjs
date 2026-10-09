/**
 * Telegram command list for the "/" autocomplete popup.
 *
 * Telegram shows the popup from BotFather / setMyCommands, NOT from what
 * the bot code handles. This list is published via `setMyCommands` on
 * startup in bot-host.mjs. Keep COMMAND_NAMES in sync with the
 * `handleCommand` switch cases below.
 */

/** @type {{ command: string, description: string }[]} */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Start the bot and show help' },
  { command: 'help', description: 'Show available commands' },
  { command: 'status', description: 'Show session, model, agent, usage' },
  { command: 'status_all', fleetRead: true, description: 'Show fleet-wide status across agents in this chat' },
  { command: 'new', description: 'Start a fresh session' },
  { command: 'compact', description: "Compact this chat's session in place (stays on it)" },
  { command: 'model_light_free', description: 'Pick a free model from the light pool (a quota hit moves inside light only)' },
  { command: 'model_free', description: 'Pick a free model: coding-capable lanes only (rating at or above 35)' },
  { command: 'model_go', description: 'Pick a lane on the paid Go plan (never moves on its own)' },
  { command: 'allowance', description: 'Show free-lane allowance (shared ledger)' },
  { command: 'agent', description: 'Pick an agent' },
  { command: 'build', description: 'Switch to the build agent' },
  { command: 'plan', description: 'Switch to the plan agent' },
  { command: 'thinking', description: 'Pick the thinking level (variant)' },
  { command: 'skills', description: 'List /do-* skills you can type here' },
  { command: 'tui', description: 'Open the opencode TUI for this conversation (Mini App)' },
  { command: 'bugs', description: 'Open the shared bug board (Mini App)' },
  { command: 'fleet', description: 'Open the live fleet dashboard (Mini App)' },
  { command: 'review', description: 'Review finished work: proof screenshots, approve or comment (Mini App)' },
  { command: 'forge', description: 'Create a new bot, one click (Mini App)' },
  { command: 'debug', description: 'Show the active work-session debug view' },
  { command: 'handoff', description: 'Checkpoint this work session for continuation' },
  { command: 'resume', description: 'Print the current bug-ticket packet' },
  { command: 'tx', description: 'Shared work view on|off|status|debug for this chat' },
  { command: 'project', description: 'View or switch project (e.g. /project external 1)' },
  { command: 'council', description: 'Run a council stage by name or number (/council <stage>, /council all, /council status)' },
  { command: 'role', description: 'Switch active agent role (/role legal, /role sim, etc.)' },
  { command: 'health', description: 'Personal Health Coach: /health status | verify | ingest | refresh | analyze | readiness | link ["which document"] | research "<what to look up>" | doctor' },
  { command: 'tax', description: 'Chiwah LTD tax: /tax snapshot | sweep | status | deadlines | saving | doc' },
  { command: 'location', description: 'Show or switch active compute location / pool' },
  { command: 'tell', description: 'Send one bounded message to another seat (/tell <bot> <text> --ref <ticket>)' },
  { command: 'notify', description: 'Finish alerts for runs started elsewhere on|off|status (web UI, TUI)' },
];

/** Names handled by bot-host.mjs handleCommand (kept in sync). */
export const COMMAND_NAMES = BOT_COMMANDS.map((c) => c.command);

/**
 * Handled-but-unpublished commands. These have a `case` in handleCommand and
 * stay reachable by typing, but are deliberately NOT in BOT_COMMANDS (no menu
 * popup entry). Each needs a reason — an undocumented hidden command is how
 * dead surface accumulates. The parity gate (assert-command-parity.mjs)
 * enforces: every handled command is either published or listed here.
 */
export const HIDDEN_COMMANDS = {
  // The one free list became three pools (2026-10-07). Both old spellings stay
  // handled so muscle memory reaches the pointer instead of falling through to
  // the tool as a prompt — `isKnownCommand` is what decides that, and an
  // unpublish alone would have made `/freemodel` a model question.
  freemodel: 'moved: the one free list became /model_light_free, /model_free and /model_go — answers as a pointer',
  freemodels: 'moved: plural of the old /freemodel; answers the same pointer',
  // The unconstrained setter and its list. Deleting the names would make
  // isKnownCommand() false, so a typed /model would fall through as a prompt.
  model: 'moved: the setter became /model_light_free, /model_free and /model_go — answers as a pointer and does not set or clear a model',
  models: 'moved: the model list became the three pool pickers — answers the same pointer',
  store: 'ops: store queue status/flush is a background concern, typed on demand',
  setup: 'ops: provider readiness gaps, surfaced via /allowance and typed to fix',
};

/**
 * Per-command help usage. BOT_COMMANDS owns the menu popup (via
 * toTelegramCommands); this map owns the `/help` arguments line. helpText()
 * below renders one line per BOT_COMMANDS entry, so adding a command there
 * automatically adds it to /help — no second list to remember. `args` is the
 * argument shape, `text` the one-line blurb, `extra` optional continuation
 * lines (used by /tui subcommands). A missing entry falls back to the menu
 * description so a new command is visible immediately; the parity gate fails
 * until a proper usage line is written.
 */
export const HELP_USAGE = {
  tell: {
    args: '<bot> <text> --ref <key>',
    text: [
      'send ONE bounded message to another seat (bot-to-bot, Telegram 10.0+)',
      '  /tell pm "the current tab has no card rows" --ref spec:fleet-current-tab',
      '  the target must be a seat this bot may address; --ref is required',
      '  the receiver files a proposal for its owner — it does not act on it',
    ].join('\n'),
  },
  start: { args: '', text: 'start the bot and show help' },
  help: { args: '', text: 'show available commands' },
  status: { args: '', text: 'show session, model, agent, workspace, usage' },
  status_all: { args: '', text: 'fleet-wide status table across agents in this chat' },
  new: { args: '', text: 'start a fresh session' },
  compact: { args: '', text: "compact this chat's session in place (stays on it)" },
  model_light_free: { args: '', text: 'pick from the light pool — a quota hit moves inside light only' },
  model_free: { args: '', text: 'pick from the coding pool (rating at or above 35) — a quota hit moves inside coding only' },
  model_go: { args: '', text: 'pick a lane on the paid Go plan — it never moves on its own' },
  allowance: { args: '[table]', text: 'shared free-lane allowance (same ledger as router)' },
  agent: { args: '[name]', text: 'pick an agent' },
  build: { args: '', text: 'switch to the build agent' },
  plan: { args: '', text: 'switch to the plan agent' },
  thinking: { args: '[level]', text: 'pick the thinking level (variant)' },
  skills: { args: '', text: 'list /do-* skills you can type here (typed, not buttons)' },
  tui: {
    args: '', text: 'open this conversation in a real terminal (Mini App button)',
    extra: [
      '/tui status      name the open pane, who is attached, how long it has been up',
      '/tui off         close that pane (add force to close it mid-turn)',
    ],
  },
  bugs: { args: '', text: 'open the shared bug board (Mini App button)' },
  fleet: { args: '', text: 'open the live fleet dashboard across all machines (Mini App button)' },
  review: { args: '', text: 'review finished work: proof screenshots, approve with 👍 or comment back (Mini App button)' },
  forge: { args: '', text: 'create a new bot in one click (Mini App forge)' },
  debug: { args: '', text: 'show the active work-session debug view' },
  handoff: { args: '', text: 'checkpoint this work session for continuation' },
  resume: { args: '[n]', text: 'print the current bug-ticket packet (n = card #)' },
  tx: { args: '[on|off|status|debug]', text: 'shared work view for this chat' },
  project: { args: '[name]', text: 'view or switch project (/project external 1)' },
  council: { args: '[stage]', text: 'run a council stage by name or number (all | run | status)' },
  role: { args: '[name]', text: 'switch bot role (/role accountant) or project persona (/role legal)' },
  health: { args: '[sub]', text: 'health coach: verify · ingest · refresh · analyze · readiness · research · doctor · status · triage · dashboard' },
  tax: { args: '[sub]', text: 'Chiwah LTD tax: snapshot · sweep · status · deadlines · saving · doc' },
  location: { args: '[name]', text: 'show or switch compute location / quota pool' },
  notify: { args: '[on|off|status]', text: 'finish alerts for runs started outside Telegram (web UI, TUI)' },
};

/** Payload for Telegram `setMyCommands` (strips nothing — already valid). */
/**
 * Menu-only skill entries. Telegram commands allow [a-z0-9_] (no hyphens),
 * so the shared skills (do-github-sync, …) cannot appear verbatim: they are
 * published in underscore form purely so they autocomplete. They are NOT bot
 * commands — COMMAND_NAMES is untouched, so a tapped entry still falls
 * through to the turn path as a prompt (M3), and normalizeSkillCommand below
 * restores the hyphen form the skill library expects. Static on purpose: the
 * menu must be identical on every host, not host-dependent.
 */
export const SKILL_MENU_COMMANDS = [
  { command: 'do_check_source', description: 'check a plan against literature and best practice' },
  { command: 'do_github_sync', description: 'sync checkouts with GitHub, signed and recorded' },
  { command: 'do_plan_handoff', description: 'pack a plan for another agent and push to GitHub' },
  { command: 'do_verify', description: 'verify actions before mutating commands and commits' },
];

/**
 * `/do_github_sync …` -> `/do-github-sync …`: restore the hyphen form of a
 * menu-tapped skill line. Only the command word is touched; the rest of the
 * line (arguments, prose) passes through byte-identical.
 */
export function normalizeSkillCommand(text) {
  const m = /^\/do_([A-Za-z0-9_]+)/.exec(String(text || ''));
  if (!m) return text;
  return `/do-${m[1].replace(/_/g, '-')}${String(text).slice(m[0].length)}`;
}

export function toTelegramCommands() {
  return BOT_COMMANDS.map(({ command, description }) => ({ command, description }))
    .concat(SKILL_MENU_COMMANDS.map(({ command, description }) => ({ command, description })));
}

/**
 * Deep-link routing: `t.me/<bot>?start=<payload>` arrives as `/start <payload>`.
 * A `bugs` payload routes to the board handler so one tap from another chat
 * lands on the button. Pure (tested in tests/bot-host.test.ts); add new
 * payloads here, not as `case` branches in bot-host.mjs.
 */
/**
 * Spellings that route to a published command without being one.
 *
 * Kept out of BOT_COMMANDS on purpose: the popup and /help list what this bot
 * does, and two names for one screen is one too many there. A reader who types
 * the near-miss gets the screen, not a menu telling them they got it wrong.
 *
 * Currently empty, and the reason is worth keeping: the only alias was
 * `freemodels → freemodel`, and an alias target must be a PUBLISHED command.
 * The picker is three pool commands now and `/freemodel` is deliberately not
 * published, so both old spellings are declared in HIDDEN_COMMANDS and answer
 * as pointers (same outcome, and `isKnownCommand` still finds them).
 */
export const COMMAND_ALIASES = {};

/** One reply for every retired model-picker name. No keyboard, no setter. */
export const POOL_POINTER_LINES = [
  'The model picker is three pools — pick the one this chat should stay in:',
  '`/model_light_free` — light lanes only; a quota hit moves inside light',
  '`/model_free` — coding-capable lanes only (rating 35 and above)',
  '`/model_go` — the paid Go plan; it never moves on its own',
];
export const POOL_POINTER = POOL_POINTER_LINES.join('\n');

/** The way out of a pool, now that /model no longer clears one. */
export const POOL_EXIT_NOTE = 'Pick another pool command to leave this one.';

export function resolveCommandName(cmd) {
  const name = String(cmd?.name || '').toLowerCase();
  if (name === 'start'
    && String(cmd?.args || '').trim().toLowerCase() === 'bugs') {
    return 'bugs';
  }
  // The plural is the spelling a reader actually types. `/freemodels` reached the
  // switch as its own name, matched no case, and came back "Unknown command" with
  // the whole menu — a wall of text instead of the one screen they asked for.
  // An alias makes the near-miss land on the same handler rather than as a second
  // `case`, so the command-parity gate still sees one command and not two. Empty
  // today (see COMMAND_ALIASES): a moved name is declared hidden instead, because
  // an alias target has to be published and `/freemodel` is not any more.
  if (COMMAND_ALIASES[name]) return COMMAND_ALIASES[name];
  return cmd?.name;
}

/**
 * The chat-answer contract used to live here: one bracketed line appended to
 * every turn prompt (`opencode run` has no --system flag, so per-turn text was
 * the only channel). Removed 2026-10-04 at the operator's call: it rendered
 * verbatim in the shared session the TUI shows, same as the ping scaffolding
 * before it. Spread the risk knowingly — without it, open answers may drift
 * back toward status narrative and "want me to…" solicitations; if that
 * regresses, the fix must be a channel that never lands in the transcript,
 * not another per-turn suffix.
 */

/**
 * True when the name is a bot command (published, hidden, or alias target).
 * A leading `/` that is NOT known here is forwarded to the tool as the user
 * prompt (plan/TG_TOOL_SURFACE.md M3) — that is how typed `/do-*` skills
 * reach the tool instead of dying as "Unknown command". Bot commands win.
 */
export function isKnownCommand(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  if (COMMAND_NAMES.includes(n)) return true;
  if (Object.hasOwn(HIDDEN_COMMANDS, n)) return true;
  if (Object.hasOwn(COMMAND_ALIASES, n)) return true;
  if (Object.values(COMMAND_ALIASES).includes(n)) return true;
  return false;
}

/** Validate against Telegram Bot API limits; throws on violation. */
export function assertValidCommands(commands = BOT_COMMANDS) {
  const seen = new Set();
  for (const entry of commands) {
    if (!/^[a-z0-9_]{1,32}$/.test(entry.command)) {
      throw new Error(`Invalid bot command "${entry.command}" (must match /^[a-z0-9_]{1,32}$/)`);
    }
    if (seen.has(entry.command)) throw new Error(`Duplicate bot command "${entry.command}"`);
    seen.add(entry.command);
    const desc = String(entry.description ?? '');
    if (!desc || desc.length > 256) {
      throw new Error(`Invalid description for /${entry.command} (1-256 chars required)`);
    }
  }
  return true;
}

/**
 * Bare-greeting detector (plan: cleaner answers + connectivity checks).
 *
 * The operator uses "hi" to check the whole chain is alive, so a greeting
 * must exercise the real turn path — it just does so cheaply (see the
 * substitution in handleMessage). Only an exact bare greeting matches:
 * anything with content ("hi, can you…") is untouched, and skill lines
 * never match this map.
 */
const GREETING_RES = [
  /^(hi|hello|hey|yo|hiya|howdy)$/,
  /^(thanks|thank you|thx)$/,
  /^(ok|okay|k|got it|noted)$/,
];

export function greetingReply(text) {
  let t = String(text ?? '').trim().toLowerCase();
  if (t.startsWith('/')) t = t.slice(1).trim();
  t = t.replace(/[!?.,…]+$/, '').trim();
  for (const re of GREETING_RES) {
    if (re.test(t)) return t;
  }
  return null;
}


  /**
 * `fleetRead: true` marks a command whose answer is ABOUT THE ROOM rather than
 * about the bot that ran it — one table for every agent present in this chat.
 *
 * Such a command must produce exactly one reply in a group. A bare one is
 * addressed to nobody (see resolveGroupAddressing), so on a group with no master
 * seat every bot dropped it and the room saw nothing. The gate now elects one
 * renderer from the agents that are actually present, keyed off this flag — so
 * marking a command here is all it takes to make it work in any group, and no
 * command name is hardcoded anywhere else.
 */
export function isFleetReadCommand(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return false;
  return BOT_COMMANDS.some((c) => c.command === key && c.fleetRead === true);
}

/** Every agent that has observed this chat, in registry order. */
export function parseCommand(text) {
    const raw = String(text ?? '').trim();
    if (!raw.startsWith('/')) return null;
    let normalized = raw;
    if (/^\/status_all\s*$/i.test(raw)) return { name: 'status_all', args: 'all', raw };
    const [head, ...rest] = normalized.split(/\s+/);
    const name = head.slice(1).toLowerCase().replace(/@[A-Za-z0-9_]+$/, '');
    return { name, args: rest.join(' ').trim(), raw };
  }

/**
 * Group-chat addressing: which bot (if any) owns this message.
 *
 * Five bots in one group must never all answer everything — that is 5x quota
 * burn and five overlapping replies. So in a group a bot acts only when it is
 * *addressed*: a command suffixed with its name (`/project@vm_19485_bot`), an
 * @mention of it in the entities, or a reply to one of its own messages. A bare
 * command or plain text in a group belongs to no one, by Telegram convention and
 * by this rule. Direct chats are unaffected: everything there is addressed.
 */
export function chatKind(message) {
  const t = String(message?.chat?.type || 'private');
  return t === 'group' || t === 'supergroup' ? 'group' : 'direct';
}

export function commandSuffix(text) {
  const m = String(text ?? '').trim().match(/^\/\S+@([A-Za-z0-9_]+)/);
  return m ? m[1].toLowerCase() : '';
}

export function mentionsUs(message, username) {
  const want = String(username || '').replace(/^@/, '').toLowerCase();
  if (!want) return false;
  for (const e of message?.entities || []) {
    if (e?.type !== 'mention') continue;
    const text = String(message?.text || '');
    const mention = text.slice(e.offset, e.offset + e.length).replace(/^@/, '').toLowerCase();
    if (mention === want) return true;
  }
  return false;
}

export const KNOWN_COUNCIL_ROLES = {
  data_steward: {
    id: 'data_steward',
    name: 'Data Steward',
    aliases: ['data steward', 'data_steward', 'datasteward', 'steward', 'data'],
  },
  health_analyst: {
    id: 'health_analyst',
    name: 'Health Analyst',
    aliases: ['health analyst', 'health_analyst', 'healthanalyst', 'analyst'],
  },
  test_planner: {
    id: 'test_planner',
    name: 'Test Planner',
    aliases: ['test planner', 'test_planner', 'testplanner', 'planner', 'test plan', 'tests'],
  },
  research_lead: {
    id: 'research_lead',
    name: 'Research Lead',
    aliases: ['research lead', 'research_lead', 'researchlead', 'research', 'literature'],
  },
  safety_reviewer: {
    id: 'safety_reviewer',
    name: 'Safety Reviewer',
    aliases: ['safety reviewer', 'safety_reviewer', 'safetyreviewer', 'safety', 'guardrail', 'guardrails'],
  },
  doctor: {
    id: 'doctor',
    name: 'Doctor',
    aliases: ['doctor', 'dr', 'doc', 'audit', 'auditor'],
  },
  tax_accountant: {
    id: 'tax_accountant',
    name: 'Tax Accountant',
    aliases: ['tax accountant', 'tax_accountant', 'accountant', 'maker', 'companies house', 'company house'],
  },
  tax_verifier: {
    id: 'tax_verifier',
    name: 'Tax Verifier',
    aliases: ['tax verifier', 'tax_verifier', 'verifier', 'checker'],
  },
  lifestyle: {
    id: 'health_analyst',
    name: 'Lifestyle & Nutrition Specialist',
    aliases: ['lifestyle', 'nutrition', 'diet', 'nutritionist', 'dietitian'],
  },
  all: {
    id: 'all',
    name: 'Full Council',
    aliases: ['all', 'council', 'team', 'everyone', 'consolidated', 'orchestrator'],
  },
};

export function extractAllRoleMentions(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return { roles: [], cleanText: '', isAll: false, hasMultiple: false };
  }

  const rawMatches = [];
  for (const [, def] of Object.entries(KNOWN_COUNCIL_ROLES)) {
    const sorted = [...def.aliases].sort((a, b) => b.length - a.length);
    for (const alias of sorted) {
      const escaped = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '[_\\s]+');
      const re = new RegExp(`(^|\\s)@(${escaped})([:;,\\s]|$)`, 'gi');
      let m;
      while ((m = re.exec(raw)) !== null) {
        const prefixLen = m[1].length;
        const matchedAlias = m[2];
        const suffixPunct = m[3].match(/^[:;,]/) ? m[3][0] : '';
        const startIndex = m.index + prefixLen;
        const endIndex = startIndex + 1 + matchedAlias.length + suffixPunct.length;
        rawMatches.push({
          startIndex,
          endIndex,
          roleId: def.id,
          roleName: def.name,
          matched: `@${matchedAlias}`,
          isAll: def.id === 'all',
        });
      }
    }
  }

  // Sort by start index ascending, and by length descending
  rawMatches.sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
  });

  // Filter overlapping matches
  const nonOverlapping = [];
  let lastEnd = -1;
  for (const item of rawMatches) {
    if (item.startIndex >= lastEnd) {
      nonOverlapping.push(item);
      lastEnd = item.endIndex;
    }
  }

  // Build clean text by excluding the matched spans
  let cleanText = '';
  let cursor = 0;
  for (const span of nonOverlapping) {
    cleanText += raw.slice(cursor, span.startIndex);
    cursor = span.endIndex;
  }
  cleanText += raw.slice(cursor);
  cleanText = cleanText
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .replace(/^(?:and\s+|,\s*)+/i, '')
    .trim();

  // Deduplicate roles preserving first appearance
  const seenRoles = new Set();
  const uniqueRoles = [];
  for (const item of nonOverlapping) {
    if (!seenRoles.has(item.roleId)) {
      seenRoles.add(item.roleId);
      uniqueRoles.push({
        roleId: item.roleId,
        roleName: item.roleName,
        matched: item.matched,
        isAll: item.isAll,
      });
    }
  }

  return {
    roles: uniqueRoles,
    cleanText,
    isAll: uniqueRoles.some((r) => r.isAll),
    hasMultiple: uniqueRoles.length > 1,
  };
}

export function extractRoleMention(text) {
  const all = extractAllRoleMentions(text);
  if (!all.roles.length) return null;
  const allRole = all.roles.find((r) => r.isAll);
  const primary = allRole || all.roles[0];
  return {
    roleId: primary.roleId,
    roleName: primary.roleName,
    matched: primary.matched,
    cleanText: all.cleanText,
    isAll: primary.isAll,
  };
}

export const ACTIVE_THREAD_WINDOW_MS = 120_000; // 2 minutes

const activeThreads = new Map();

export function recordActiveThread(chatId, info = {}) {
  if (!chatId) return;
  const key = String(chatId);
  activeThreads.set(key, {
    roleId: info.roleId || null,
    botId: info.botId != null ? String(info.botId) : null,
    isCouncil: Boolean(info.isCouncil),
    jointRoles: Array.isArray(info.jointRoles) ? [...info.jointRoles] : [],
    lastActivityMs: Number(info.timestamp) || Date.now(),
  });
}

export function getActiveThread(chatId, opts = {}) {
  if (!chatId) return null;
  const key = String(chatId);
  const entry = activeThreads.get(key);
  if (!entry) return null;
  const now = Number(opts.now) || Date.now();
  const windowMs = Number(opts.windowMs) || ACTIVE_THREAD_WINDOW_MS;
  if (now - entry.lastActivityMs > windowMs) {
    activeThreads.delete(key);
    return null;
  }
  return entry;
}

export function clearActiveThread(chatId) {
  if (!chatId) return;
  activeThreads.delete(String(chatId));
}

export function clearAllActiveThreads() {
  activeThreads.clear();
}

/**
 * The coordinator adopts a named seat only when no enabled bot owns it.
 *
 * `dedicatedRoleIds` is the per-seat list (the live fleet). `hasDedicatedRoleBots:
 * false` is the older single-bot switch: the coordinator adopts every seat.
 * Passing neither leaves the coordinator quiet, which is what the bare addressing
 * tests rely on.
 */
function masterAdoptsUnownedRole(roleId, isMaster, opts) {
  if (!isMaster || !roleId || roleId === 'all') return false;
  if (Array.isArray(opts.dedicatedRoleIds)) return !opts.dedicatedRoleIds.includes(roleId);
  return opts.hasDedicatedRoleBots === false;
}

export function resolveGroupAddressing(message, self, opts = {}) {
  const rawText = String(message?.text || message?.caption || '').trim();
  const username = String(self?.username || '').replace(/^@/, '').toLowerCase();
  const id = Number(self?.id) || 0;
  const myRole = String(opts.role || self?.role || '').toLowerCase();
  const myRoles = new Set(
    [myRole, ...(Array.isArray(opts.roles) ? opts.roles : [])]
      .map((role) => String(role || '').toLowerCase())
      .filter(Boolean),
  );
  const myName = String(opts.name || self?.name || '').toLowerCase();
  const isMaster = Boolean(opts.isMaster || self?.isMaster || self?.id === 'vm');
  const now = Number(opts.now) || Date.now();
  const chatId = message?.chat?.id;

  // Direct chat:
  if (chatKind(message) !== 'group') {
    const extracted = extractAllRoleMentions(rawText);
    const roleId = extracted.roles.length ? extracted.roles[0].roleId : null;
    return {
      addressed: true,
      roleId: roleId !== 'all' ? roleId : null,
      isBroadcast: extracted.isAll,
      cleanText: extracted.roles.length ? extracted.cleanText : rawText,
      jointRoles: extracted.roles.map((r) => r.roleId),
      turnOrder: 0,
      delayMs: 0,
    };
  }

  // 1. Suffix check: /command@bot
  const suffix = commandSuffix(rawText);
  if (suffix) {
    const isOurs = username ? suffix === username : true;
    return {
      addressed: isOurs,
      roleId: isOurs ? (myRole || null) : null,
      isBroadcast: false,
      cleanText: rawText,
      jointRoles: [],
      turnOrder: 0,
      delayMs: 0,
    };
  }

  // 2. Explicit role mentions (@test planner, @doctor, @all, @analyst @doctor)
  // Law of Explicit Beats Ambient: Explicit mentions have highest priority over replies and ambient threads.
  const extracted = extractAllRoleMentions(rawText);
  if (extracted.roles.length > 0) {
    if (extracted.isAll) {
      return {
        addressed: isMaster,
        roleId: null,
        isBroadcast: true,
        cleanText: extracted.cleanText,
        jointRoles: ['all'],
        turnOrder: 0,
        delayMs: 0,
      };
    }

    const matchedIndex = extracted.roles.findIndex((r) => {
      const rId = r.roleId;
      const rName = r.roleName.toLowerCase();
      return (myRoles.has(rId)) ||
        (myName && myName.includes(rName)) ||
        (username && username.includes(rId.replace(/_/g, ''))) ||
        masterAdoptsUnownedRole(rId, isMaster, opts);
    });

    if (matchedIndex !== -1) {
      const matchedRole = extracted.roles[matchedIndex];
      const turnOrder = matchedIndex;
      const delayMs = matchedIndex * 2500;
      return {
        addressed: true,
        roleId: matchedRole.roleId,
        isBroadcast: false,
        cleanText: extracted.cleanText,
        jointRoles: extracted.roles.map((r) => r.roleId),
        turnOrder,
        delayMs,
      };
    } else {
      return {
        addressed: false,
        roleId: null,
        isBroadcast: false,
        cleanText: extracted.cleanText,
        jointRoles: extracted.roles.map((r) => r.roleId),
        turnOrder: 0,
        delayMs: 0,
      };
    }
  }

  // 3. Direct @username mention check
  if (username && mentionsUs(message, username)) {
    return {
      addressed: true,
      roleId: myRole || null,
      isBroadcast: false,
      cleanText: rawText,
      jointRoles: [],
      turnOrder: 0,
      delayMs: 0,
    };
  }

  // If another bot is explicitly @mentioned by username in entities, this message is for them, not us
  if (message?.entities) {
    for (const e of message.entities) {
      if (e?.type === 'mention') {
        const mention = rawText.slice(e.offset, e.offset + e.length).replace(/^@/, '').toLowerCase();
        if (username && mention !== username) {
          return { addressed: false, roleId: null, isBroadcast: false, cleanText: rawText, jointRoles: [], turnOrder: 0, delayMs: 0 };
        }
      }
    }
  }

  // 4. Reply to our message
  if (id && Number(message?.reply_to_message?.from?.id) === id) {
    return {
      addressed: true,
      roleId: myRole || null,
      isBroadcast: false,
      cleanText: rawText,
      jointRoles: [],
      turnOrder: 0,
      delayMs: 0,
    };
  }

  // If reply to another bot/user
  if (message?.reply_to_message?.from?.id && Number(message.reply_to_message.from.id) !== id) {
    return {
      addressed: false,
      roleId: null,
      isBroadcast: false,
      cleanText: rawText,
      jointRoles: [],
      turnOrder: 0,
      delayMs: 0,
    };
  }

  // 5. Active Thread Follow-Up (Within TTL window, continuous dialogue without re-tagging)
  if (opts.useActiveThread !== false && chatId) {
    const thread = getActiveThread(chatId, { now, windowMs: opts.windowMs });
    if (thread) {
      if (thread.isCouncil) {
        if (isMaster) {
          return {
            addressed: true,
            roleId: null,
            isBroadcast: true,
            isContinuous: true,
            cleanText: rawText,
            jointRoles: ['all'],
            turnOrder: 0,
            delayMs: 0,
          };
        } else {
          return { addressed: false, roleId: null, isBroadcast: false, cleanText: rawText, jointRoles: [], turnOrder: 0, delayMs: 0 };
        }
      } else {
        const botMatchesThread = (thread.roleId && myRoles.has(thread.roleId)) ||
          (thread.botId && (String(id) === String(thread.botId) || username === String(thread.botId).toLowerCase())) ||
          (opts.hasDedicatedRoleBots === false && isMaster && (!thread.botId || String(thread.botId) === String(id))) ||
          (Array.isArray(opts.dedicatedRoleIds) && masterAdoptsUnownedRole(thread.roleId, isMaster, opts));
        if (botMatchesThread) {
          return {
            addressed: true,
            roleId: thread.roleId || myRole || null,
            isBroadcast: false,
            isContinuous: true,
            cleanText: rawText,
            jointRoles: thread.roleId ? [thread.roleId] : [],
            turnOrder: 0,
            delayMs: 0,
          };
        } else {
          return { addressed: false, roleId: null, isBroadcast: false, cleanText: rawText, jointRoles: [], turnOrder: 0, delayMs: 0 };
        }
      }
    }
  }

  // 6. Bare message with no @mention in a group (Scenario 2 broadcast):
  // When allowGroupBroadcast is true on master, master takes it to provide consolidated answer.
  if (isMaster && Boolean(opts.allowGroupBroadcast)) {
    return {
      addressed: true,
      roleId: null,
      isBroadcast: true,
      cleanText: rawText,
      jointRoles: ['all'],
      turnOrder: 0,
      delayMs: 0,
    };
  }

  return { addressed: false, roleId: null, isBroadcast: false, cleanText: rawText, jointRoles: [], turnOrder: 0, delayMs: 0 };
}

export function isAddressedToUs(message, self, opts = {}) {
  return resolveGroupAddressing(message, self, opts).addressed;
}

export function parseAgentList(text) {
  const seen = new Set();
  const agents = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = line.trim().match(/^([A-Za-z0-9_.:-]+)\s+\((primary|subagent)\)$/);
    if (!match) continue;
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    agents.push({ name: match[1], type: match[2] });
  }
  return agents;
}

export function parseModelsVerbose(text) {
  const lines = String(text ?? '').split('\n');
  const models = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const isId =
      line && !line.startsWith('{') && !line.startsWith('[') && !line.startsWith('}') && !line.startsWith('"');
    if (!isId) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith('{')) j += 1;
    let depth = 0;
    let started = false;
    const buf = [];
    while (j < lines.length) {
      const l = lines[j];
      buf.push(l);
      depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
      if (l.includes('{')) started = true;
      if (started && depth <= 0) break;
      j += 1;
    }
    let variants = [];
    let context = 0;
    try {
      const obj = JSON.parse(buf.join('\n'));
      if (obj && obj.variants && typeof obj.variants === 'object') variants = Object.keys(obj.variants);
      if (obj && obj.limit && Number(obj.limit.context) > 0) context = Number(obj.limit.context);
    } catch {
      // ignore malformed block
    }
    models.push(context ? { id: line, variants, context } : { id: line, variants });
    i = j + 1;
  }
  return models;
}

export function isFreeModel(modelId) {
  return /free/i.test(String(modelId ?? ''));
}

export function sortModelsFreeFirst(models) {
  const free = [];
  const paid = [];
  for (const m of models) (isFreeModel(m) ? free : paid).push(m);
  return [...free, ...paid];
}

export function modelKeyboard(models, { page = 0, pageSize = 8, kind = 'm', all = false, footer = null } = {}) {
  // `all: true` puts every model in one keyboard, the way the Grok router's
  // /freemodel does — one button per row, no paging. With 50+ lanes on a host,
  // paging eight at a time means seven taps of "Next" to see the list, which is
  // the thing the router's single list avoids.
  const total = models.length;
  const pages = all ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const current = all ? 0 : Math.min(Math.max(0, page), pages - 1);
  const slice = all ? models : models.slice(current * pageSize, current * pageSize + pageSize);
  // Embed the route identity in `callback_data` instead of a bare index, so taps
  // stay valid even if the list was refetched/re-sorted between showing the
  // keyboard and tapping it. Old `m:<index>` buttons still decode via the index
  // fallback in handleCallback.
  //
  // The payload is the *route* (`{ text, data }`), never the label. It used to be
  // the label, and the moment a label grew — R-16's bakeoff label on every
  // /freemodel button — the whole keyboard came back `BUTTON_DATA_INVALID`,
  // because Telegram caps callback_data at 64 bytes. A display string is not an
  // identity, and BOT-24's own notes already ask for stable route identities in
  // bot-host callbacks.
  const LIMIT = 64;
  const rows = slice.map((model, i) => {
    const text = typeof model === 'string' ? model : String(model?.text ?? '');
    const want = typeof model === 'string' ? model : String(model?.data ?? text);
    // `noop` is a whole callback, not a value: the tap handler dispatches on the
    // kind prefix and answers `noop` silently. Prefixing it produced "fm:noop",
    // which the freemodel handler read as a model named "noop" and answered
    // "Expired, run /freemodel again" when a reader tapped a group heading.
    const payload = want === 'noop' ? 'noop' : `${kind}:${want}`;
    // Too long for Telegram: fall back to a position in this keyboard, which the
    // handler resolves against the same ordered list it rendered.
    const data = Buffer.byteLength(payload, 'utf8') <= LIMIT ? payload : `${kind}:#${i}`;
    return [{ text, callback_data: data }];
  });
  if (all) {
    if (footer) rows.push([footer]);
    return { inline_keyboard: rows };
  }
  const nav = [];
  if (current > 0) nav.push({ text: 'Prev', callback_data: `${kind}p:${current - 1}` });
  nav.push({ text: `${current + 1}/${pages}`, callback_data: 'noop' });
  if (current < pages - 1) nav.push({ text: 'Next', callback_data: `${kind}p:${current + 1}` });
  if (nav.length > 1 || pages > 1) rows.push(nav);
  return { inline_keyboard: rows };
}

export function agentKeyboard(agents) {
  // Embed the agent name (short, e.g. "build") instead of a bare index so
  // taps stay valid even if `opencode agent list` output changes between
  // showing the keyboard and tapping it. Old `a:<index>` buttons still
  // decode via the index fallback in handleCallback.
  return {
    inline_keyboard: agents.map((agent) => [
      { text: `${agent.name} (${agent.type})`, callback_data: `a:${agent.name}` },
    ]),
  };
}

export function variantKeyboard(variants, { selected = null, columns = 2 } = {}) {
  // Embed the variant name (short, e.g. "low"/"high") instead of a bare
  // index so taps stay valid even if the cached model list was refetched
  // or reordered between showing the keyboard and tapping it.
  // Old `v:<index>` buttons still decode via the index fallback.
  const list = [...new Set((Array.isArray(variants) ? variants : []).map((v) => String(v ?? '').trim()).filter(Boolean))];
  // The level in force is marked in the label, so the keyboard answers "what am
  // I on" by itself. It stays tappable — a tap on the current level is a no-op
  // re-set, not an error — and callback_data is untouched, so an old tap still
  // decodes to the same level.
  const buttons = list.map((variant) => ({
    text: variant === selected ? `✅ ${variant}` : variant,
    callback_data: `v:${variant}`,
  }));
  // Two per row: five levels in five rows is a column of text on a phone, and
  // every model that offers levels offers several.
  const perRow = Math.max(1, Math.min(columns, buttons.length || 1));
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return { inline_keyboard: rows };
}

export function decodeCallback(data) {
  const raw = String(data ?? '');
  const splitAt = raw.indexOf(':');
  if (splitAt < 0) return { kind: raw, value: undefined };
  return { kind: raw.slice(0, splitAt), value: raw.slice(splitAt + 1) };
}

export function helpText(config, { model, agent, variant } = {}) {
  // Single source of truth: one line per BOT_COMMANDS entry, in menu order.
  // A new command added to BOT_COMMANDS appears here automatically; HELP_USAGE
  // supplies the argument shape and blurb, falling back to the menu
  // description so nothing renders blank before its usage line is written.
  const heads = BOT_COMMANDS.map((c) => {
    const usage = HELP_USAGE[c.command];
    return `/${c.command}${usage?.args ? ` ${usage.args}` : ''}`;
  });
  const width = Math.max(...heads.map((h) => h.length));
  const lines = BOT_COMMANDS.flatMap((c, i) => {
    const usage = HELP_USAGE[c.command];
    const main = `${heads[i].padEnd(width, ' ')} ${(usage?.text || c.description).trim()}`;
    return usage?.extra?.length ? [main, ...usage.extra] : [main];
  });
  return [
    config.name,
    `model: ${model || config.agent.model}`,
    `agent: ${agent || config.agent.defaultAgent || 'build'}`,
    `thinking: ${variant || config.agent.variant || '(default)'}`,
    '',
    'Send any message to run opencode.',
    '',
    'Commands:',
    ...lines,
  ].join('\n');
}

export function formatTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return String(value);
}

export function extractMedia(text) {
  const lines = String(text ?? '').split('\n');
  const media = [];
  const kept = [];
  for (const line of lines) {
    const match = line.match(/^\s*MEDIA:(.+?)\s*$/);
    if (match) {
      const file = match[1].trim();
      if (file) media.push(file);
      continue;
    }
    kept.push(line);
  }
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, media };
}

export function extractCodeBlocks(text) {
  const source = String(text ?? '');
  const blocks = [];
  const re = /```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const lang = match[1] || '';
    const code = match[2].replace(/\s+$/, '');
    if (code.trim()) blocks.push(lang ? `\`\`\`${lang}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``);
  }
  return blocks;
}

export function formatUsage({ tokens, cost, contextLimit, agent } = {}) {
  const parts = [];
  if (agent) parts.push(agent);
  const total = Number(tokens?.total) || 0;
  const limit = Number(contextLimit) || 0;
  if (limit > 0 && total > 0) {
    const pct = (total / limit) * 100;
    const pctText = pct < 10 ? pct.toFixed(1) : pct.toFixed(0);
    parts.push(`ctx ${pctText}% (${formatTokens(total)}/${formatTokens(limit)})`);
  } else if (total > 0) {
    parts.push(`ctx ${formatTokens(total)} tokens`);
  }
  const spend = Number(cost) || 0;
  if (spend > 0) parts.push(`cost $${spend.toFixed(spend < 0.01 ? 5 : 4)}`);
  return parts.join(' · ');
}

export function statusText(config, { sessionId, model, agent, variant, usage } = {}) {
  const lines = [
    `model: ${model || config.agent.model}`,
    `agent: ${agent || config.agent.defaultAgent || 'build'}`,
    `thinking: ${variant || config.agent.variant || '(default)'}`,
    `workspace: ${config.agent.workspace}`,
    `session: ${sessionId || '(none)'}`,
  ];
  if (usage) lines.push(`last run: ${usage}`);
  return lines.join('\n');
}

export function formatModelList(models, { max = 0 } = {}) {
  const list = Array.isArray(models) ? models.map((m) => String(m).trim()).filter(Boolean) : [];
  if (!list.length) return 'No models found.';
  const shown = (max > 0 ? list.slice(0, max) : list).map((m) => `- ${m}`);
  if (max > 0 && list.length > max) shown.push(`... and ${list.length - max} more`);
  return shown.join('\n');
}
