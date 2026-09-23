import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compressReasoning, cleanReasoning } from '../scripts/lib/reasoning-compress.mjs';
import { Throttle } from '../scripts/lib/tg-throttle.mjs';
import {
  mapOpencodeEvent,
  buildOpencodeArgs,
  buildOpencodeEnv,
  expandSkillPath,
} from '../scripts/lib/agent-opencode.mjs';
import {
  clamp,
  chunkText,
  MAX_MESSAGE_CHARS,
  TelegramApi,
  mediaMethod,
  mediaField,
  isSendableMedia,
} from '../scripts/lib/tg-api.mjs';
import { loadRegistry, getBot, resolveToken, normalizeConfig } from '../scripts/lib/registry.mjs';
import {
  parseCommand,
  BOT_COMMANDS,
  COMMAND_NAMES,
  toTelegramCommands,
  assertValidCommands,
  parseAgentList,
  parseModelsVerbose,
  modelKeyboard,
  sortModelsFreeFirst,
  isFreeModel,
  agentKeyboard,
  variantKeyboard,
  decodeCallback,
  helpText,
  statusText,
  formatModelList,
  formatUsage,
  formatTokens,
  extractMedia,
} from '../scripts/lib/commands.mjs';
import {
  buildStatusSnapshot,
  formatStatusPlain,
  compactUnsupported,
  formatAgo,
  COMPACT_SUMMARY_PROMPT,
} from '../scripts/lib/bot-status.mjs';

describe('reasoning-compress', () => {
  it('strips code fences and markdown noise', () => {
    const cleaned = cleanReasoning('Look at ```ts\nconst x = 1\n``` and `y` *here*');
    expect(cleaned).not.toContain('```');
    expect(cleaned).not.toContain('`');
    expect(cleaned).toContain('Look at');
  });

  it('keeps the lead sentence and decision lines within the cap', () => {
    const trace = [
      'The user reports a meal calc bug.',
      'Some unrelated background about the history of the file that is long and not useful.',
      'I should check server_food_catalog.ts because the source union is wrong.',
      'Then I will patch the type and run tsc.',
    ].join(' ');
    const out = compressReasoning(trace, { maxChars: 220 });
    expect(out.startsWith('The user reports a meal calc bug.')).toBe(true);
    expect(out).toContain('I should check');
    expect(out.length).toBeLessThanOrEqual(220);
  });

  it('never exceeds maxChars even without sentence boundaries', () => {
    const out = compressReasoning('x'.repeat(500), { maxChars: 50 });
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('...')).toBe(true);
  });

  it('keeps the text inside inline code instead of deleting it', () => {
    const cleaned = cleanReasoning('The command is `/models` (plural), not `/model`.');
    expect(cleaned).toContain('/models');
    expect(cleaned).toContain('/model');
    expect(cleaned).not.toContain('`');
  });

  it('returns empty for empty input', () => {
    expect(compressReasoning('')).toBe('');
    expect(compressReasoning(null)).toBe('');
  });
});

describe('tg-throttle', () => {
  const fakeClock = () => {
    let t = 0;
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    };
    return { now: () => t, sleep, sleeps };
  };

  it('does not delay the first submit but spaces the second', async () => {
    const clock = fakeClock();
    const throttle = new Throttle({ minIntervalMs: 2500, now: clock.now, sleep: clock.sleep });
    await throttle.submit(async () => 'a');
    await throttle.submit(async () => 'b');
    expect(clock.sleeps).toEqual([2500]);
  });

  it('defers submits until retry_after elapses', async () => {
    const clock = fakeClock();
    const throttle = new Throttle({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    throttle.pause(30);
    await throttle.submit(async () => 'x');
    expect(clock.sleeps).toEqual([30000]);
  });
});

describe('normalizeConfig', () => {
  it('preserves external-dir and shared-skill settings', () => {
    const cfg = normalizeConfig(
      {
        id: 'opencode',
        telegram: { tokenEnv: 'T', allowedUserIds: ['1'] },
        agent: {
          kind: 'opencode',
          workspace: '/ws',
          allowExternalDirectory: true,
          sharedSkills: ['.agents/skills'],
          playwrightOutputDir: '/tmp/shots',
        },
      },
      { defaultWorkspace: '/default' },
    );
    expect(cfg.agent.allowExternalDirectory).toBe(true);
    expect(cfg.agent.sharedSkills).toEqual(['.agents/skills']);
    expect(cfg.agent.playwrightOutputDir).toBe('/tmp/shots');
    expect(cfg.telegram.allowedUserIds).toEqual([1]);
  });

  it('defaults external dir off, skills empty, and workspace to the default', () => {
    const cfg = normalizeConfig(
      { id: 'x', telegram: { tokenEnv: 'T' }, agent: { kind: 'opencode' } },
      { defaultWorkspace: '/d' },
    );
    expect(cfg.agent.allowExternalDirectory).toBe(false);
    expect(cfg.agent.sharedSkills).toEqual([]);
    expect(cfg.agent.workspace).toBe('/d');
  });
});

describe('buildOpencodeEnv', () => {
  it('allows external directories and resolves shared skill paths', () => {
    const env = buildOpencodeEnv({ workspace: '/ws', allowExternalDirectory: true, sharedSkills: ['.agents/skills'] });
    expect(env.OPENCODE_CONFIG_CONTENT).toBeDefined();
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    expect(cfg.permission).toEqual({ external_directory: 'allow' });
    expect(cfg.skills).toEqual({ paths: ['/ws/.agents/skills'] });
  });

  it('returns an empty env when nothing is configured', () => {
    expect(buildOpencodeEnv({})).toEqual({});
  });

  it('expands ~ and keeps absolute skill paths', () => {
    expect(expandSkillPath('scripts/skills', '/ws')).toBe('/ws/scripts/skills');
    expect(expandSkillPath('/abs/skills', '/ws')).toBe('/abs/skills');
    expect(expandSkillPath('~/.hermes/shared_skills', '/ws')).toBe(
      path.join(os.homedir(), '.hermes/shared_skills'),
    );
    expect(expandSkillPath('', '/ws')).toBe('');
  });

  it('adds the playwright MCP server when an output dir is set', () => {
    const env = buildOpencodeEnv({ workspace: '/ws', playwrightOutputDir: '/tmp/shots' });
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    expect(cfg.mcp.playwright.type).toBe('local');
    expect(cfg.mcp.playwright.enabled).toBe(true);
    expect(cfg.mcp.playwright.command).toContain('--output-dir');
    expect(cfg.mcp.playwright.command).toContain('/tmp/shots');
  });

  it('omits mcp when no output dir is set', () => {
    const env = buildOpencodeEnv({ workspace: '/ws', allowExternalDirectory: true });
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).mcp).toBeUndefined();
  });
});

describe('agent-opencode event mapping', () => {
  it('maps reasoning and text parts', () => {
    expect(mapOpencodeEvent({ type: 'reasoning', part: { text: 'thinking' } })).toEqual({
      kind: 'reasoning',
      text: 'thinking',
    });
    expect(mapOpencodeEvent({ type: 'text', part: { text: 'answer' } })).toEqual({
      kind: 'text',
      text: 'answer',
    });
  });

  it('maps tool, step_finish and error', () => {
    expect(
      mapOpencodeEvent({ type: 'tool', part: { tool: 'bash', state: { status: 'completed' } } }),
    ).toMatchObject({ kind: 'tool', tool: 'bash', status: 'completed' });
    expect(mapOpencodeEvent({ type: 'step_finish', part: { cost: 0.01 } })).toMatchObject({
      kind: 'step_finish',
    });
    expect(
      mapOpencodeEvent({ type: 'error', error: { data: { message: 'boom' } } }),
    ).toMatchObject({ kind: 'error', message: 'boom' });
    expect(mapOpencodeEvent(null)).toBeNull();
  });

  it('builds args with thinking, variant and model, prompt last', () => {
    const args = buildOpencodeArgs({
      prompt: 'fix it',
      model: 'opencode-go/deepseek-v4.1-flash',
      variant: 'high',
      thinking: true,
      extraArgs: ['--session', 'ses_1'],
    });
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--thinking',
      '--variant',
      'high',
      '-m',
      'opencode-go/deepseek-v4.1-flash',
      '--session',
      'ses_1',
      'fix it',
    ]);
  });
});

describe('tg-api clamp', () => {
  it('truncates to the Telegram limit', () => {
    const out = clamp('y'.repeat(MAX_MESSAGE_CHARS + 100));
    expect(out.length).toBe(MAX_MESSAGE_CHARS);
    expect(out.endsWith('...')).toBe(true);
    expect(clamp('short')).toBe('short');
  });
});

describe('registry', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bot-registry-'));
  const file = path.join(tmp, 'registry.json');

  it('loads multiple bots and resolves by id', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        bots: [
          { id: 'opencode', enabled: true, telegram: { tokenEnv: 'A' }, agent: { kind: 'opencode' } },
          { id: 'second', enabled: true, telegram: { tokenEnv: 'B' }, agent: { kind: 'opencode' } },
        ],
      }),
    );
    const registry = loadRegistry(file);
    expect(registry.bots).toHaveLength(2);
    expect(getBot(registry, 'second').id).toBe('second');
    expect(getBot(registry).id).toBe('opencode');
  });

  it('rejects duplicate ids', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        bots: [
          { id: 'dup', telegram: { tokenEnv: 'A' }, agent: { kind: 'opencode' } },
          { id: 'dup', telegram: { tokenEnv: 'B' }, agent: { kind: 'opencode' } },
        ],
      }),
    );
    expect(() => loadRegistry(file)).toThrow(/Duplicate/);
  });

  it('reports a missing token clearly', () => {
    const bot = { id: 'opencode', telegram: { tokenEnv: 'MISSING_TOKEN_ENV' } };
    expect(() => resolveToken(bot, {})).toThrow(/MISSING_TOKEN_ENV/);
    expect(resolveToken(bot, { MISSING_TOKEN_ENV: 'abc' })).toBe('abc');
  });
});

describe('commands', () => {
  it('parses slash commands and strips the bot suffix', () => {
    expect(parseCommand('/models')).toEqual({ name: 'models', args: '', raw: '/models' });
    expect(parseCommand('/model opencode-go/deepseek-v4.1-flash')).toEqual({
      name: 'model',
      args: 'opencode-go/deepseek-v4.1-flash',
      raw: '/model opencode-go/deepseek-v4.1-flash',
    });
    expect(parseCommand('/help@Opencode_135_bot').name).toBe('help');
    // Any leading slash must classify as a command, never as a prompt to the LLM.
    expect(parseCommand('/foobar').name).toBe('foobar');
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('lists the real command surface in help', () => {
    const config = {
      name: 'OpenCode Bot',
      agent: { model: 'opencode-go/deepseek-v4.1-flash', variant: 'high' },
    };
    const text = helpText(config, { model: 'opencode-go/muse-spark-1.3' });
    for (const cmd of ['/new', '/status', '/model', '/models', '/abort', '/help']) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain('opencode-go/muse-spark-1.3');
  });

  it('shows the effective model in status', () => {
    const config = {
      agent: { model: 'opencode-go/deepseek-v4.1-flash', variant: 'high', workspace: '/tmp' },
    };
    expect(statusText(config, { sessionId: 'ses_1', model: 'opencode-go/muse-spark-1.3' })).toContain(
      'opencode-go/muse-spark-1.3',
    );
    expect(statusText(config, {})).toContain('session: (none)');
  });

  it('formats and caps the model list', () => {
    expect(formatModelList([])).toBe('No models found.');
    const many = Array.from({ length: 5 }, (_, i) => `p/m${i}`);
    const text = formatModelList(many, { max: 3 });
    expect(text.split('\n')).toHaveLength(4);
    expect(text).toContain('... and 2 more');
  });

  it('shows every model when no cap is set', () => {
    const many = Array.from({ length: 100 }, (_, i) => `p/m${i}`);
    const text = formatModelList(many);
    expect(text.split('\n')).toHaveLength(100);
    expect(text).toContain('p/m99');
    expect(text).not.toContain('more');
  });
});

describe('pickers', () => {
  it('parses primary agents and ignores the permission dump', () => {
    const raw = [
      'build (primary)',
      '  [',
      '  {',
      '    "permission": "*",',
      '    "action": "allow"',
      '  }',
      'plan (primary)',
      'explore (subagent)',
    ].join('\n');
    expect(parseAgentList(raw)).toEqual([
      { name: 'build', type: 'primary' },
      { name: 'plan', type: 'primary' },
      { name: 'explore', type: 'subagent' },
    ]);
  });

  it('parses model variants from --verbose output', () => {
    const raw = [
      'opencode/big-pickle',
      '{',
      '  "id": "big-pickle",',
      '  "variants": {',
      '    "low": { "reasoningEffort": "low" },',
      '    "high": { "reasoningEffort": "high" }',
      '  }',
      '}',
      'opencode-go/deepseek-v4.1-flash',
      '{',
      '  "id": "deepseek-v4.1-flash",',
      '  "variants": { "low": {}, "medium": {}, "high": {} }',
      '}',
    ].join('\n');
    const models = parseModelsVerbose(raw);
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({ id: 'opencode/big-pickle', variants: ['low', 'high'] });
    expect(models[1].variants).toEqual(['low', 'medium', 'high']);
  });

  it('captures the context limit from --verbose output', () => {
    const raw = [
      'opencode/big-pickle',
      '{',
      '  "id": "big-pickle",',
      '  "limit": { "context": 200000 }',
      '}',
    ].join('\n');
    expect(parseModelsVerbose(raw)).toEqual([{ id: 'opencode/big-pickle', variants: [], context: 200000 }]);
  });

  it('paginates the model keyboard with compact callback data', () => {
    const models = Array.from({ length: 20 }, (_, i) => `p/m${i}`);
    const page0 = modelKeyboard(models, { page: 0, pageSize: 8 });
    expect(page0.inline_keyboard).toHaveLength(9);
    expect(page0.inline_keyboard[0][0].callback_data).toBe('m:0');
    expect(page0.inline_keyboard[8].some((b: { callback_data: string }) => b.callback_data === 'mp:1')).toBe(true);
    const page2 = modelKeyboard(models, { page: 2, pageSize: 8 });
    expect(page2.inline_keyboard[0][0].callback_data).toBe('m:16');
    for (const row of page0.inline_keyboard) {
      for (const button of row) {
        expect(button.callback_data.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('sorts free models first and marks them in the keyboard', () => {
    const models = [
      'opencode/deepseek-v4-flash',
      'opencode/minimax-m2.7',
      'opencode/muse-spark-1.3-contributor-free',
      'opencode/nemotron-3.5-lightning-free',
    ];
    expect(isFreeModel('opencode/muse-spark-1.3-contributor-free')).toBe(true);
    expect(isFreeModel('opencode/deepseek-v4-flash')).toBe(false);
    const sorted = sortModelsFreeFirst(models);
    expect(sorted.slice(0, 2)).toEqual([
      'opencode/muse-spark-1.3-contributor-free',
      'opencode/nemotron-3.5-lightning-free',
    ]);
    const kb = modelKeyboard(sorted, { page: 0, pageSize: 8 });
    expect(kb.inline_keyboard[0][0].text).toMatch(/^\u2713 /);
    expect(kb.inline_keyboard[0][0].callback_data).toBe('m:0');
    expect(kb.inline_keyboard[2][0].text).toBe('opencode/deepseek-v4-flash');
  });

  it('builds a shared status snapshot for any bot platform', () => {
    const now = Date.now();
    const snap = buildStatusSnapshot({
      bot: { id: 'android', name: 'Android OpenCode Bot' },
      platform: 'opencode',
      capabilities: { compact: true },
      effective: { model: 'opencode/muse-spark-1.3-contributor-free', agent: 'build', variant: null },
      session: { id: 'ses_0123456789abcdef' },
      handoff: false,
      usage: { tokens: { total: 22700 }, cost: 0, contextLimit: 1000000, agent: 'build' },
      totals: { runs: 5, tokens: 118000, cost: 0.0042 },
      runtime: { bootedAt: now - 192 * 60 * 1000, taskState: 'idle', lock: null },
      health: { okAt: now - 4000, errAt: 0, err: '' },
    });
    const text = formatStatusPlain(snap);
    expect(text).toContain('Android OpenCode Bot (android)');
    expect(text).toContain('model: \u2713 opencode/muse-spark-1.3-contributor-free (free)');
    expect(text).toContain('session: ses_01234567\u2026');
    expect(text).toContain('chat total: 5 runs');
    expect(text).toContain('poll: ok 4s ago');
    expect(text).toContain('/compact');
    const failing = formatStatusPlain(
      buildStatusSnapshot({ health: { okAt: now - 900000, errAt: now - 60000, err: 'fetch failed' } }),
    );
    expect(failing).toContain('poll: FAILING since 1m ago (fetch failed)');
    expect(formatAgo(0)).toBe('never');
    expect(COMPACT_SUMMARY_PROMPT.length).toBeGreaterThan(20);
    expect(compactUnsupported('collab', 'gpu tunnels')).toContain('/compact');
  });

  it('keeps one command source of truth including /free + /compact', async () => {
    expect(assertValidCommands()).toBe(true);
    // every advertised command has a handler case in opencode-bot.mjs
    const src = (await import('node:fs')).readFileSync(
      new URL('../scripts/opencode-bot.mjs', import.meta.url), 'utf8',
    );
    for (const name of COMMAND_NAMES) {
      expect(src).toContain(`case '${name}'`);
    }
    expect(COMMAND_NAMES).toContain('free');
    expect(COMMAND_NAMES).toContain('compact');
    expect(helpText({ name: 'b', agent: {} }, {})).toContain('/free');
    expect(toTelegramCommands().find((c) => c.command === 'free')?.description.length).toBeGreaterThan(0);
    expect(BOT_COMMANDS.length).toBe(new Set(COMMAND_NAMES).size);
    const shim = await import('../scripts/lib/bot-commands.mjs');
    expect(shim.BOT_COMMANDS).toEqual(BOT_COMMANDS);
    expect(shim.COMMAND_NAMES).toEqual(COMMAND_NAMES);
  });

  it('builds agent and variant keyboards and decodes callbacks', () => {
    const agents = agentKeyboard([{ name: 'build', type: 'primary' }]);
    expect(agents.inline_keyboard[0][0]).toEqual({ text: 'build (primary)', callback_data: 'a:0' });
    const variants = variantKeyboard(['low', 'high']);
    expect(variants.inline_keyboard[1][0]).toEqual({ text: 'high', callback_data: 'v:1' });
    expect(decodeCallback('m:5')).toEqual({ kind: 'm', value: '5' });
    expect(decodeCallback('noop')).toEqual({ kind: 'noop', value: undefined });
  });
});

describe('usage formatting', () => {
  it('formats context percent, tokens and cost', () => {
    const text = formatUsage({ tokens: { total: 7805 }, cost: 0.00117165, contextLimit: 200000, agent: 'build' });
    expect(text).toBe('build · ctx 3.9% (7.8k/200k) · cost $0.00117');
  });

  it('omits context percent when the limit is unknown', () => {
    expect(formatUsage({ tokens: { total: 1200 }, cost: 0 })).toBe('ctx 1.2k tokens');
  });

  it('formats token magnitudes', () => {
    expect(formatTokens(200000)).toBe('200k');
    expect(formatTokens(1000000)).toBe('1M');
    expect(formatTokens(999)).toBe('999');
  });
});

describe('media delivery', () => {
  it('pulls MEDIA: lines out of the text', () => {
    const { text, media } = extractMedia('MEDIA:/tmp/a.png\nHere it is.\nMEDIA:/tmp/b.pdf');
    expect(media).toEqual(['/tmp/a.png', '/tmp/b.pdf']);
    expect(text).toBe('Here it is.');
  });

  it('ignores inline MEDIA mentions', () => {
    const { text, media } = extractMedia('see MEDIA:/tmp/a.png inline');
    expect(media).toEqual([]);
    expect(text).toBe('see MEDIA:/tmp/a.png inline');
  });

  it('maps file extensions to telegram methods', () => {
    expect(mediaMethod('/a/b.png')).toBe('sendPhoto');
    expect(mediaMethod('/a/b.mp4')).toBe('sendVideo');
    expect(mediaMethod('/a/b.ogg')).toBe('sendAudio');
    expect(mediaMethod('/a/b.zip')).toBe('sendDocument');
    expect(mediaField('sendPhoto')).toBe('photo');
    expect(mediaField('sendDocument')).toBe('document');
  });

  it('only sends absolute paths that exist', () => {
    expect(isSendableMedia('/tmp/x.png', { exists: () => true })).toBe(true);
    expect(isSendableMedia('/tmp/x.png', { exists: () => false })).toBe(false);
    expect(isSendableMedia('rel/x.png', { exists: () => true })).toBe(false);
    expect(isSendableMedia('', { exists: () => true })).toBe(false);
  });

  it('uploads a file via the matching telegram method', async () => {
    const file = path.join(os.tmpdir(), `ocb-media-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const calls: Array<{ url: string; init: { body: unknown } }> = [];
    const fetchImpl = async (url: string, init: { body: unknown }) => {
      calls.push({ url, init });
      return { json: async () => ({ ok: true, result: { message_id: 7 } }) };
    };
    const api = new TelegramApi('tok', { fetchImpl });
    await api.sendMediaFile(123, file);
    expect(calls[0].url).toContain('/bottok/sendPhoto');
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    fs.unlinkSync(file);
  });
});

describe('tg-api sendChatAction', () => {
  it('posts the typing action for the chat', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { json: async () => ({ ok: true, result: true }) };
    };
    const api = new TelegramApi('token', { fetchImpl });
    await api.sendChatAction(123, 'typing');
    expect(calls[0].url).toContain('/bottoken/sendChatAction');
    expect(calls[0].body).toEqual({ chat_id: 123, action: 'typing' });
  });
});

describe('tg-api chunkText', () => {
  it('keeps short text as a single chunk', () => {
    expect(chunkText('hi')).toEqual(['hi']);
  });

  it('splits long text under the limit, preferring newlines', () => {
    const line = 'x'.repeat(100);
    const text = Array.from({ length: 60 }, () => line).join('\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    }
    expect(chunks.join('\n')).toBe(text);
  });
});
