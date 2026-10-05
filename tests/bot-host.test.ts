import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { compressReasoning, cleanReasoning } from '../scripts/lib/reasoning-compress.mjs';
import {
  canonicalString,
  argsHash,
  normalizeTicket,
  recordCoordination,
  readCoordinationLog,
  evaluateReproVerdicts as evaluateCoordinationReproVerdicts,
} from '../scripts/lib/coordination-tax.mjs';
import { Throttle } from '../scripts/lib/tg-throttle.mjs';
import { sessionKey, tmuxWindowFor } from '../scripts/lib/work-session.mjs';
import {
  mapOpencodeEvent,
  buildOpencodeArgs,
  buildOpencodeEnv,
  expandSkillPath,
  humanizeRunError,
  isTimeoutError,
  extractLogError,
  parseRetryAfter,
  isQuotaOrLimitError,
  runWithModelFailover,
} from '../scripts/lib/agent-opencode.mjs';
import {
  buildFailure,
  recordFailure,
  loadFailures,
  groupFailures,
} from '../scripts/lib/failure-log.mjs';
import {
  clamp,
  chunkText,
  MAX_MESSAGE_CHARS,
  TelegramApi,
  TelegramError,
  mediaMethod,
  mediaField,
  isSendableMedia,
} from '../scripts/lib/tg-api.mjs';
import { loadRegistry, getBot, resolveToken, normalizeConfig } from '../scripts/lib/registry.mjs';
import {
  parseModelRef,
  toModelRef,
  formatFreeLabel,
  listFreeOpenCode,
  buildFreeModelList,
  CLINE_FREE_MODELS,
  GEMINI_MODELS,
} from '../scripts/lib/freemodels.mjs';
import {
  runGemini,
  resolveGeminiKey,
  geminiModelId,
  mapGeminiError,
} from '../scripts/lib/agent-gemini.mjs';
import {
  buildClineArgs,
  mapClineEvent,
  resolveClineBin,
  CLINE_THINKING_LEVELS,
  runCline,
  pickClineSessionId,
  listClineSessionIds,
  clineSessionsDir,
  CLINE_SESSION_ID_RE,
} from '../scripts/lib/agent-cline.mjs';
import {
  parseCommand,
  resolveCommandName,
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
  extractCodeBlocks,
} from '../scripts/lib/commands.mjs';
import {
  ProgressRenderer,
  fanoutProgressEvent,
  buildQuotedPrompt,
  loadLeases,
  saveLeases,
  recordRunStart,
  recordRunFinish,
  sweepOrphanedLeases,
  selectTurnLanes,
  formatFreemodelWithDepletion,
} from '../scripts/bot-host.mjs';
import { isHardModelFailure, ensureBotLedger, withCatalogLanes, stampCooldown, CONNECTION_FAILED_COOLDOWN_MS, HARD_MODEL_FAILURE_COOLDOWN_MS, canonicalAllowanceLanes, planCodeForLane } from '../scripts/lib/free-lanes.mjs';
import {
  buildStatusSnapshot,
  formatStatusPlain,
  compactUnsupported,
  formatAgo,
} from '../scripts/lib/bot-status.mjs';
import { classifyInboundSender, machineLocation, sendPeerHandoff } from '../scripts/bot-host.mjs';

describe('telegram reply quote prompt', () => {
  it('prepends a direct text reply while preserving the new request', () => {
    expect(buildQuotedPrompt('What does it mean?', { text: '  Explain this phrase.  ' })).toBe(
      '[Quoted Telegram message]\nExplain this phrase.\n\n[New message]\nWhat does it mean?',
    );
  });

  it('uses a direct caption quote when text is absent', () => {
    expect(buildQuotedPrompt('Translate it', { caption: 'Bonjour' })).toContain('[Quoted Telegram message]\nBonjour');
  });

  it('returns the original request when there is no quote', () => {
    expect(buildQuotedPrompt('Continue', undefined)).toBe('Continue');
  });

  it('ignores media-only quoted messages', () => {
    expect(buildQuotedPrompt('Continue', { photo: [{ file_id: 'photo' }] })).toBe('Continue');
  });
});

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

  it('routes the small model when one is configured', () => {
    const env = buildOpencodeEnv({ workspace: '/ws', smallModel: 'opencode-go/deepseek-v4.1-flash' });
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).small_model).toBe('opencode-go/deepseek-v4.1-flash');
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

  it('maps tool, tool_use, step_finish and error', () => {
    expect(
      mapOpencodeEvent({ type: 'tool', part: { tool: 'bash', state: { status: 'completed' } } }),
    ).toMatchObject({ kind: 'tool', tool: 'bash', status: 'completed' });
    expect(
      mapOpencodeEvent({ type: 'tool_use', part: { tool: 'read', state: { status: 'running', input: { path: 'README.md' } } } }),
    ).toMatchObject({ kind: 'tool', tool: 'read', status: 'running', input: { path: 'README.md' } });
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
    // The variant rides in the model string and --log-level is lowercase:
    // CLI 2.0.18 rejects both a bare `--variant` flag and "ERROR" by printing
    // help and exiting 1, which is what made every turn report "the model
    // returned no text output" (2026-09-28).
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--print-logs',
      '--log-level',
      'error',
      '--thinking',
      '-m',
      'opencode-go/deepseek-v4.1-flash#high',
      '--session',
      'ses_1',
       'fix it',
     ]);
   });

   it('never emits a flag the opencode CLI rejects', () => {
    const args = buildOpencodeArgs({
      prompt: 'hi',
      model: 'opencode/space-bunny-free',
      variant: 'xhigh',
      thinking: true,
      sessionId: 'ses_1',
    });
    // Guards the class, not the instance: opencode answers an unknown flag by
    // printing help and exiting 1 with no JSON on stdout, which the bot can
    // only report as "no text output".
    expect(args).not.toContain('--variant');
    expect(args.join(' ')).not.toMatch(/--log-level\s+ERROR/);
    expect(args[args.indexOf('-m') + 1]).toBe('opencode/space-bunny-free#xhigh');
   });

   it('leaves the model alone when there is no variant', () => {
    const args = buildOpencodeArgs({ prompt: 'hi', model: 'opencode/mimo', thinking: false });
    expect(args[args.indexOf('-m') + 1]).toBe('opencode/mimo');
   });

   it('never passes a server flag, so the turn shares the service with the TUI', () => {
    const args = buildOpencodeArgs({
      prompt: 'fix it',
      sessionId: 'ses_tui',
      thinking: false,
    });
    // No --attach and no --server. Both were checked against the installed CLI
    // (v2.0.19) and both fail: `--attach` is not a flag at all, so the CLI
    // prints help and exits 1 with no output on stdout — the "model returned no
    // text output" dead end. `--server` exists but demands OPENCODE_PASSWORD
    // against a service that requires one, and the bot holds no such password.
    // With neither, the run goes to the opencode background service, which is
    // the same server the TUI terminal uses — the whole point, since that shared
    // server is what lets a chat turn and a terminal prompt both run on one
    // session.
    expect(args.join(' ')).not.toMatch(/--attach/);
    expect(args.join(' ')).not.toMatch(/--server/);
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--print-logs',
      '--log-level',
      'error',
      '--session',
      'ses_tui',
      'fix it',
    ]);
  });
});

describe('extractLogError', () => {
  // --log-level is requested in lowercase, so the lines the CLI prints are
  // `level=error`. A pattern pinned to `level=ERROR` matches nothing and the
  // user loses the reason the turn failed, so both spellings must work.
  it('reads a lowercase level=error line', () => {
    expect(extractLogError('level=error error.error="AI_APICallError: out of credits"'))
      .toContain('out of credits');
  });

  const rateLimitLog =
    'timestamp=2026-09-23T20:53:03.552Z level=ERROR run=692ab56a message="stream error" ' +
    'providerID=opencode modelID=big-pickle small=false agent=build mode=primary ' +
    'error.error="AI_APICallError: Rate limit exceeded. Please try again later."';

  it('turns a rate-limit log line into an actionable reason', () => {
    const out = extractLogError(rateLimitLog);
    expect(out).toContain('rate limit');
    expect(out).toContain('Rate limit exceeded');
  });

  it('prefers the real model error over the earlier small-model error', () => {
    const out = extractLogError(
      'level=ERROR modelID=gpt-5.4-nano small=true error.error="Insufficient account funds"\n' + rateLimitLog,
    );
    expect(out).toContain('rate limit');
    expect(out).not.toContain('out of funds');
  });

  it('reports out-of-funds and missing payment method', () => {
    expect(extractLogError('level=ERROR error.error="AI_APICallError: Insufficient account funds"')).toContain(
      'out of funds',
    );
    expect(
      extractLogError('level=ERROR error.error="No payment method. Add a payment method here: https://x/y"'),
    ).toContain('no payment method');
  });

  it('ignores stderr without an ERROR line, and empty input', () => {
    expect(extractLogError('')).toBeNull();
    expect(extractLogError('level=INFO message="booting location services"')).toBeNull();
    expect(extractLogError(null)).toBeNull();
  });

  // Vocabulary shared with tools/telegram-provider-router isQuotaOrLimitError
  // (plan/RELIABILITY.md §14) — free lanes are the recommended path, so the
  // free-tier wording must classify, not fall through as a raw string.
  it('classifies free-tier limit wording', () => {
    const out = extractLogError(
      'level=ERROR error.error="AI_APICallError: free_tier_limit reached — subscribe to Go"',
    );
    expect(out).toContain('Free-tier allowance');
    expect(out).toContain('free_tier_limit');
  });

  it('classifies out-of-credits and quota wording', () => {
    expect(extractLogError('level=ERROR error.error="out of credits"')).toContain('out of funds');
    expect(extractLogError('level=ERROR error.error="daily cap reached"')).toContain('quota or capacity');
  });
});

describe('parseRetryAfter', () => {
  it('reads an ISO reset stamp', () => {
    const future = new Date(Date.now() + 3 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    const out = parseRetryAfter(`quota exceeded, resets at ${future}`);
    expect(out).toMatch(/Retry in ~3h/);
  });

  it('reads "try again in Xh Ym" hints', () => {
    expect(parseRetryAfter('rate limited, try again in 3h 20m')).toBe('Retry in ~3h 20m.');
    expect(parseRetryAfter('try again in 2h')).toBe('Retry in ~2h.');
    expect(parseRetryAfter('try again in 45m')).toBe('Retry in ~45m.');
  });

  it('returns empty string when the provider gives no hint', () => {
    expect(parseRetryAfter('Rate limit exceeded. Please try again later.')).toBe('');
    expect(parseRetryAfter('')).toBe('');
    expect(parseRetryAfter(null)).toBe('');
  });

  it('appends the hint to a classified reason for the user', () => {
    const out = extractLogError(
      'level=ERROR error.error="AI_APICallError: Rate limit exceeded, try again in 3h 20m"',
    );
    expect(out).toContain('rate limit');
    expect(out).toContain('Retry in ~3h 20m.');
  });
});

describe('small-model errors are not fatal', () => {
  // Measured on the VPS: opencode runs a cosmetic "small" model for session
  // titles BEFORE the model the user asked for. Its failure is not fatal — a run
  // logged `small=true ... Insufficient account funds` and still answered.
  it('ignores small=true title-agent failures when the real run succeeds', () => {
    const log =
      'level=ERROR modelID=gpt-5.4-nano small=true agent=title error.error="AI_APICallError: Insufficient account funds"';
    expect(extractLogError(log)).toBeNull();
  });

  it('still reports the real (small=false) model failure', () => {
    const log = [
      'level=ERROR modelID=gpt-5.4-nano small=true agent=title error.error="AI_APICallError: Insufficient account funds"',
      'level=ERROR modelID=big-pickle small=false agent=build error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
    ].join('\n');
    const out = extractLogError(log);
    expect(out).toContain('rate limit');
    expect(out).not.toContain('out of funds');
  });
});

describe('isQuotaOrLimitError', () => {
  it('recognises lane-unavailable wording (router vocabulary)', () => {
    for (const msg of [
      'AI_APICallError: Rate limit exceeded. Please try again later.',
      'AI_APICallError: Upstream request failed: Insufficient account funds',
      'quota exceeded',
      'free_tier_limit reached',
      'neuron limit reached',
      'HTTP 429 Too Many Requests',
    ]) {
      expect(isQuotaOrLimitError(msg)).toBe(true);
    }
  });

  it('does not treat a transport error or empty value as a lane failure', () => {
    expect(isQuotaOrLimitError('')).toBe(false);
    expect(isQuotaOrLimitError(null)).toBe(false);
    expect(isQuotaOrLimitError('fetch failed')).toBe(false);
  });
});

describe('runWithModelFailover', () => {
  const quota = (model) => ({ finalText: '', lastError: 'Rate limit exceeded', _model: model });
  const ok = (model) => ({ finalText: 'PONG', lastError: null, _model: model });

  it('re-runs the SAME prompt on the next lane after a quota failure', () => {
    const prompts = [];
    return runWithModelFailover({
      models: ['a/one', 'b/two'],
      makeRun: (model) => {
        prompts.push(model);
        return Promise.resolve(model === 'a/one' ? quota(model) : ok(model));
      },
    }).then(({ result, attempts }) => {
      expect(prompts).toEqual(['a/one', 'b/two']);
      expect(result.finalText).toBe('PONG');
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toMatchObject({ model: 'a/one', ok: false });
      expect(attempts[1]).toMatchObject({ model: 'b/two', ok: true });
    });
  });

  it('stops at the first success and does not burn the rest', async () => {
    const prompts = [];
    const { result } = await runWithModelFailover({
      models: ['a/one', 'b/two', 'c/three'],
      makeRun: (model) => {
        prompts.push(model);
        return Promise.resolve(ok(model));
      },
    });
    expect(prompts).toEqual(['a/one']);
    expect(result._model).toBe('a/one');
  });

  it('never auto-retries a timeout — re-running would just wait again', async () => {
    const prompts = [];
    const { attempts } = await runWithModelFailover({
      models: ['a/one', 'b/two'],
      makeRun: (model) => {
        prompts.push(model);
        return Promise.resolve({ finalText: '', lastError: 'timed out after 900000ms' });
      },
    });
    expect(prompts).toEqual(['a/one']);
    expect(attempts).toHaveLength(1);
  });

  it('reports the switch so the chat can show what happened', async () => {
    const switches = [];
    await runWithModelFailover({
      models: ['a/one', 'b/two'],
      makeRun: (model) => Promise.resolve(model === 'a/one' ? quota(model) : ok(model)),
      onSwitch: (info) => switches.push(info),
    });
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatchObject({ from: 'a/one', to: 'b/two' });
  });

  it('dedupes candidates and needs at least one', async () => {
    let calls = 0;
    await runWithModelFailover({
      models: ['a/one', 'a/one', null],
      makeRun: (model) => {
        calls += 1;
        return Promise.resolve(ok(model));
      },
    });
    expect(calls).toBe(1);
    await expect(runWithModelFailover({ models: [], makeRun: () => {} })).rejects.toThrow(
      /at least one model/,
    );
  });

  it('does not fail over when text was already delivered to the user', async () => {
    const prompts = [];
    await runWithModelFailover({
      models: ['a/one', 'b/two'],
      makeRun: (model) => {
        prompts.push(model);
        return Promise.resolve({ finalText: 'partial answer', lastError: 'Rate limit exceeded' });
      },
    });
    expect(prompts).toEqual(['a/one']);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-host-registry-'));
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

  it('tolerates foreign-runtime pointers without agent.kind (tg_provider_router outage)', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        bots: [
          { id: 'opencode', enabled: true, telegram: { tokenEnv: 'A' }, agent: { kind: 'opencode' } },
          {
            id: 'box-router',
            enabled: true,
            runtime: 'tg-provider-router',
            telegram: { tokenEnv: 'BOX' },
            path: 'tools/telegram-provider-router',
          },
        ],
      }),
    );
    const registry = loadRegistry(file);
    expect(registry.bots).toHaveLength(2);
    expect(getBot(registry, 'opencode').id).toBe('opencode');
    expect(getBot(registry).id).toBe('opencode');
    expect(() => getBot(registry, 'box-router')).toThrow(/not runnable by bot-host/);
  });

  it('loads the real registry despite foreign-runtime entries', () => {
    expect(() => loadRegistry('bots/registry.json')).not.toThrow();
  });
});

describe('commands', () => {
  it('parses slash commands and strips the bot suffix', () => {
    expect(parseCommand('/models')).toEqual({ name: 'models', args: '', raw: '/models' });
    expect(parseCommand('/model cline:cline-free/kat-coder-pro')).toEqual({
      name: 'model',
      args: 'cline:cline-free/kat-coder-pro',
      raw: '/model cline:cline-free/kat-coder-pro',
    });
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

  it('routes deep links (/start bugs) to the board handler', () => {
    expect(resolveCommandName(parseCommand('/start bugs'))).toBe('bugs');
    expect(resolveCommandName(parseCommand('/start BUGS'))).toBe('bugs');
    expect(resolveCommandName(parseCommand('/start'))).toBe('start');
    expect(resolveCommandName(parseCommand('/start foo'))).toBe('start');
    expect(resolveCommandName(parseCommand('/bugs'))).toBe('bugs');
  });

  it('lists the real command surface in help', () => {
    const config = {
      name: 'OpenCode Bot',
      agent: { model: 'opencode-go/deepseek-v4.1-flash', variant: 'high' },
    };
    const text = helpText(config, { model: 'opencode-go/muse-spark-1.3' });
    for (const cmd of ['/new', '/status', '/model', '/models', '/freemodel', '/help', '/resume']) {
      expect(text).toContain(cmd);
    }
    // Run controls are gone: no /abort or /watch anywhere on the surface.
    expect(text).not.toContain('/abort');
    expect(text).not.toContain('/watch');
    expect(COMMAND_NAMES).not.toContain('abort');
    expect(COMMAND_NAMES).not.toContain('watch');
    expect(text).toContain('opencode-go/muse-spark-1.3');
  });

  it('advertises /resume with a handler, help line, and telegram payload (V-30.5)', async () => {
    expect(COMMAND_NAMES).toContain('resume');
    const entry = BOT_COMMANDS.find((c) => c.command === 'resume');
    expect(entry?.description.length).toBeGreaterThan(0);
    expect(toTelegramCommands().find((c) => c.command === 'resume')?.description).toBe(entry?.description);
    expect(helpText({ name: 'b', agent: {} }, {})).toContain('/resume [n]');
    const src = (await import('node:fs')).readFileSync(
      new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8',
    );
    // handler exists and is read-only (queue/packet reads, no second store).
    expect(src).toContain("case 'resume'");
    expect(src).toContain('resumePacketText');
    expect(src).toMatch(/runBugctl\(\['queue', '--json'\]\)/);
    expect(src).toMatch(/runBugctl\(\['packet', `--id=#\$\{id\}`, '--format=text'\]\)/);
    expect(parseCommand('/resume 5')).toEqual({ name: 'resume', args: '5', raw: '/resume 5' });
  });

  it('/bugs reads the live store in the handler and formats count + cards deterministically', async () => {
    const src = (await import('node:fs')).readFileSync(
      new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8',
    );
    // The reply body is code, not model prose: the handler reads the store and
    // the button rides alongside. A stale session can be wrong about phrasing,
    // but not about this number (measured 2026-09-30: 4 cards quoted, 15 live).
    expect(src).toContain("case 'bugs'");
    expect(src).toMatch(/runBugctl\(\['list', '--json'\]\)/);
    expect(src).toContain('bugsListText');
    expect(src).toContain('formatBugsListText');
  });

  it('formatBugsListText quotes count, generated_at, and one line per card in number order', async () => {
    const { formatBugsListText } = await import('../scripts/bot-host.mjs');
    const text = formatBugsListText({
      source: 'canonical-bug-list',
      count: 3,
      generated_at: '2026-09-30T22:34:55.138Z',
      rows: [
        { public_n: 7, title: 'Seventh', state: 'packed', queue: 'ready' },
        { public_n: 1, title: 'First', state: 'in_fix', queue: 'in_progress' },
        { public_n: 4, title: 'Fourth', state: 'packed', queue: 'blocked' },
      ],
    });
    expect(text).toContain('3 cards');
    expect(text).toContain('2026-09-30T22:34:55.138Z');
    const lines = text.split('\n');
    expect(lines.findIndex((l) => l.startsWith('#1 '))).toBeLessThan(lines.findIndex((l) => l.startsWith('#4 ')));
    expect(lines.findIndex((l) => l.startsWith('#4 '))).toBeLessThan(lines.findIndex((l) => l.startsWith('#7 ')));
    expect(text).toContain('#1 First (in_fix/in_progress)');
    expect(text).toContain('#4 Fourth (packed/blocked)');
  });

  it('formatBugsListText says empty with count 0, and unreachable without inventing cards', async () => {
    const { formatBugsListText } = await import('../scripts/bot-host.mjs');
    const empty = formatBugsListText({ source: 'canonical-bug-list', count: 0, generated_at: '2026-09-30T22:34:55.138Z', rows: [] });
    expect(empty).toContain('0 cards');
    expect(empty).not.toContain('#');
    const down = formatBugsListText({ error: 'connect ECONNREFUSED' });
    expect(down).toMatch(/unreachable/i);
    expect(down).not.toMatch(/#\d/);
    expect(down).toContain('ECONNREFUSED');
  });

  it('formatBugsListText caps long queues behind the board button', async () => {
    const { formatBugsListText } = await import('../scripts/bot-host.mjs');
    const rows = Array.from({ length: 45 }, (_, i) => ({ public_n: i + 1, title: `Card ${i + 1}`, state: 'new', queue: 'ready' }));
    const text = formatBugsListText({ source: 'canonical-bug-list', count: 45, generated_at: 'x', rows });
    expect(text).toContain('45 cards');
    expect(text).toContain('#40 ');
    expect(text).not.toContain('#41 ');
    expect(text).toMatch(/\+5 more/);
    expect(text.length).toBeLessThan(4096);
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
    expect(page0.inline_keyboard[0][0].callback_data).toBe('m:p/m0');
    expect(page0.inline_keyboard[8].some((b: { callback_data: string }) => b.callback_data === 'mp:1')).toBe(true);
    const page2 = modelKeyboard(models, { page: 2, pageSize: 8 });
    expect(page2.inline_keyboard[0][0].callback_data).toBe('m:p/m16');
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
    expect(kb.inline_keyboard[0][0].text).toBe('opencode/muse-spark-1.3-contributor-free');
    expect(kb.inline_keyboard[0][0].callback_data).toBe('m:opencode/muse-spark-1.3-contributor-free');
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
    expect(compactUnsupported('collab', 'gpu tunnels')).toContain('/compact');
  });

  it('declares the turn seat outside the try so the finally can read it', async () => {
    // The finished-turn record in `finally` reads `activeRole`. Declared inside
    // the try block it is out of scope there, so every recorded turn threw
    // "activeRole is not defined" and the thread was never recorded.
    const src = (await import('node:fs')).readFileSync(
      new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8',
    );
    const decl = src.indexOf('let activeRole = null;');
    expect(decl).toBeGreaterThan(-1);
    const storeFacts = src.indexOf('const storeFacts =');
    expect(decl).toBeGreaterThan(storeFacts);
    // Same statement list as storeFacts, i.e. BEFORE the turn's `try {`.
    expect(decl).toBeLessThan(src.indexOf('try {', storeFacts));
    // Assigned, not redeclared, inside the try.
    expect(src).toContain('activeRole = getChatRole(chatId);');
    expect(src).not.toContain('let activeRole = getChatRole(chatId);');
    // And the consumer the crash came from is still there.
    expect(src).toContain('roleId: activeRole || addr?.roleId || null,');
  });

  it('keeps one command source of truth including /compact', async () => {
    expect(assertValidCommands()).toBe(true);
    // every advertised command has a handler case in bot-host.mjs
    const src = (await import('node:fs')).readFileSync(
      new URL('../scripts/bot-host.mjs', import.meta.url), 'utf8',
    );
    for (const name of COMMAND_NAMES) {
      expect(src).toContain(`case '${name}'`);
    }
    expect(COMMAND_NAMES).toContain('compact');
    // every advertised command has a help line (menu/help/handlers stay one surface)
    const help = helpText({ name: 'b', agent: {} }, {});
    for (const name of COMMAND_NAMES) {
      expect(help).toContain(`/${name}`);
    }
    // /free was removed on 2026-10-03: it was the raw-catalog text list that
    // /freemodel replaced with the canonical lane list and a tappable keyboard.
    // It must not come back through any of the three surfaces at once — the
    // popup, /help, or a handler case. Asserted as an absence because that is
    // the whole shape of the change: there is no `case 'free'` left to find.
    expect(COMMAND_NAMES).not.toContain('free');
    // Boundary-matched, because "/free" is a prefix of "/freemodel" — a plain
    // substring check fails on the replacement command, which is the whole point
    // of keeping it.
    expect(help).not.toMatch(/\/free(?![A-Za-z0-9_-])/);
    expect(toTelegramCommands().find((c) => c.command === 'free')).toBeUndefined();
    expect(src).not.toContain("case 'free'");
    // The replacement is still there and still published — removing the old name
    // must not have taken the surface the reader is meant to use instead.
    expect(COMMAND_NAMES).toContain('freemodel');
    expect(toTelegramCommands().find((c) => c.command === 'freemodel')?.description.length).toBeGreaterThan(0);
    expect(BOT_COMMANDS.length).toBe(new Set(COMMAND_NAMES).size);
    const shim = await import('../scripts/lib/bot-commands.mjs');
    expect(shim.BOT_COMMANDS).toEqual(BOT_COMMANDS);
    expect(shim.COMMAND_NAMES).toEqual(COMMAND_NAMES);
  });

  it('builds agent and variant keyboards and decodes callbacks', () => {
    const agents = agentKeyboard([{ name: 'build', type: 'primary' }]);
    expect(agents.inline_keyboard[0][0]).toEqual({ text: 'build (primary)', callback_data: 'a:build' });
    const variants = variantKeyboard(['low', 'high']);
    expect(variants.inline_keyboard[1][0]).toEqual({ text: 'high', callback_data: 'v:high' });
    expect(decodeCallback('m:5')).toEqual({ kind: 'm', value: '5' });
    expect(decodeCallback('noop')).toEqual({ kind: 'noop', value: undefined });
  });

  it('keeps default m/mp callbacks and supports fm/fmp for free models', () => {
    const models = Array.from({ length: 12 }, (_, i) => `p/m${i}`);
    const page0 = modelKeyboard(models, { page: 0, pageSize: 8 });
    expect(page0.inline_keyboard[0][0].callback_data).toBe('m:p/m0');
    expect(page0.inline_keyboard[8].some((b: { callback_data: string }) => b.callback_data === 'mp:1')).toBe(true);
    const free = modelKeyboard(['a', 'b'], { kind: 'fm' });
    expect(free.inline_keyboard[0][0].callback_data).toBe('fm:a');
    const freePage = modelKeyboard(models, { page: 1, pageSize: 8, kind: 'fm' });
    expect(freePage.inline_keyboard[0][0].callback_data).toBe('fm:p/m8');
    expect(freePage.inline_keyboard.at(-1)?.some((b: { callback_data: string }) => b.callback_data === 'fmp:0')).toBe(true);
  });
});

describe('freemodels', () => {
  it('parses cline: and opencode: refs and formats labels', () => {
    expect(parseModelRef('cline:cline-free/muse-spark-1.3-contributor')).toEqual({
      surface: 'cline',
      id: 'cline-free/muse-spark-1.3-contributor',
      raw: 'cline:cline-free/muse-spark-1.3-contributor',
    });
    expect(parseModelRef('opencode:opencode/big-pickle')).toEqual({
      surface: 'opencode',
      id: 'opencode/big-pickle',
      raw: 'opencode:opencode/big-pickle',
    });
    expect(parseModelRef('opencode-go/minimax-m2.7')).toEqual({
      surface: 'opencode',
      id: 'opencode-go/minimax-m2.7',
      raw: 'opencode-go/minimax-m2.7',
    });
    expect(toModelRef('cline', 'cline-free/kat-coder-pro')).toBe('cline:cline-free/kat-coder-pro');
    expect(toModelRef('opencode', 'opencode/big-pickle')).toBe('opencode/big-pickle');
    expect(formatFreeLabel('cline:cline-free/muse-spark-1.3-contributor')).toBe(
      'cline:muse spark 1.3 contributor (free)',
    );
    expect(formatFreeLabel('opencode/big-pickle')).toBe('opencode:big-pickle (free)');
  });

  it('filters zero-cost authorized opencode models from the cache', () => {
    const readJson = (file: string) => {
      if (file.endsWith('models.json')) {
        return {
          opencode: {
            models: {
              'big-pickle': { cost: { input: 0, output: 0 } },
              'mimo-v2.6-flash-free': { cost: { input: 0, output: 0 } },
              'paid-model': { cost: { input: 1, output: 2 } },
            },
          },
          unauthorized: {
            models: { 'free-but-no-auth': { cost: { input: 0, output: 0 } } },
          },
        };
      }
      if (file.endsWith('auth.json')) return { opencode: { key: 'x' } };
      return null;
    };
    const refs = listFreeOpenCode({ modelsCachePath: '/x/models.json', authPath: '/x/auth.json', readJson });
    expect(refs).toEqual(['opencode/big-pickle', 'opencode/mimo-v2.6-flash-free']);
  });

  it('lists cline free models first, only when the local CLI and auth are usable', () => {
    const readJson = (file: string) => {
      if (String(file).endsWith('providers.json')) {
        return { providers: { cline: { settings: { auth: { accessToken: 'x' } } } } };
      }
      return null;
    };
    const entries = buildFreeModelList({
      modelsCachePath: '/missing-models.json',
      authPath: '/missing-auth.json',
      readJson,
      clineBin: process.execPath,
      opencodeBin: '/definitely/not/installed',
    });
    const cline = entries.filter((e) => e.surface === 'cline');
    expect(cline.map((e) => e.ref)).toEqual(CLINE_FREE_MODELS.map((id) => `cline:${id}`));
    // Asserted on the entries, not on rendered text: the renderer that turned
    // this list into prose was formatFreeModelText, removed with /free because
    // /freemodel's keyboard is the only surface that lists free models now.
    expect(cline.filter((e) => e.selectable !== false)).toHaveLength(CLINE_FREE_MODELS.length);
    expect(cline.some((e) => String(e.note || '').includes('daily free cap'))).toBe(true);
  });

  it('omits cline models when the local CLI or auth is missing', () => {
    const entries = buildFreeModelList({
      modelsCachePath: '/missing-models.json',
      authPath: '/missing-auth.json',
      readJson: () => null,
      clineBin: '/definitely/not/installed',
      opencodeBin: '/definitely/not/installed',
    });
    expect(entries.filter((e) => e.surface === 'cline').every((e) => e.selectable === false)).toBe(true);
    expect(entries.some((e) => String(e.pendingAction || '').includes('Install the Cline CLI'))).toBe(true);
  });

  it('parses gemini: refs and marks legacy labels as moved to opencode', () => {
    expect(parseModelRef('gemini:gemini/gemini-3.8-flash')).toEqual({
      surface: 'gemini',
      id: 'gemini/gemini-3.8-flash',
      raw: 'gemini:gemini/gemini-3.8-flash',
    });
    expect(toModelRef('gemini', 'gemini/gemini-3.1-pro')).toBe('gemini:gemini/gemini-3.1-pro');
    expect(formatFreeLabel('gemini:gemini/gemini-3.5-flash-lite')).toBe(
      'gemini:gemini-3.5-flash-lite (moved to opencode)',
    );
    expect(GEMINI_MODELS).toHaveLength(4);
  });

  it('exposes gemini through opencode only when the local catalog has it', () => {
    const readJson = (file: string) => {
      if (String(file).endsWith('models.json')) {
        return {
          google: {
            models: {
              'gemini-3.5-flash-lite': { cost: { input: 0, output: 0 } },
              'gemini-3.7-flash': { cost: { input: 0, output: 0 } },
            },
          },
        };
      }
      if (String(file).endsWith('auth.json')) return { google: { apiKey: 'x' } };
      return null;
    };
    const entries = buildFreeModelList({
      modelsCachePath: '/cache/models.json',
      authPath: '/cache/auth.json',
      readJson,
      opencodeBin: process.execPath,
      clineBin: '/definitely/not/installed',
    });
    // No standalone gemini picker entries — Gemini rides the OpenCode surface.
    expect(entries.some((e) => e.surface === 'gemini')).toBe(false);
    const gemini = entries.filter((e) => e.provider === 'gemini');
    expect(gemini.map((e) => e.ref).sort()).toEqual(['google/gemini-3.5-flash-lite', 'google/gemini-3.7-flash']);
    expect(gemini.every((e) => e.surface === 'opencode')).toBe(true);
  });

  it('marks gemini pending (not listed) when the local catalog lacks it', () => {
    const entries = buildFreeModelList({
      modelsCachePath: '/missing-models.json',
      authPath: '/missing-auth.json',
      readJson: () => null,
      opencodeBin: '/definitely/not/installed',
      clineBin: '/definitely/not/installed',
    });
    // No SELECTABLE standalone gemini picker entries — only the pending setup row.
    expect(entries.filter((e) => e.surface === 'gemini').every((e) => e.selectable === false)).toBe(true);
    expect(entries.some((e) => String(e.pendingAction || '').includes('GEMINI_API_KEY'))).toBe(true);
  });
});

describe('vm5 failover refs (live 2026-10-03)', () => {
  it('keeps the vendor on bare chat-only lane ids', () => {
    // Live: the ledger's `tokenharbor` lane with model `mimo-v2.6-flash:free`
    // was emitted bare, and every turn burned on `Invalid model reference`.
    expect(toModelRef('tokenharbor', 'mimo-v2.6-flash:free')).toBe('tokenharbor/mimo-v2.6-flash:free');
    expect(toModelRef('cloudflare', 'qwen3.8-flash:free')).toBe('cloudflare/qwen3.8-flash:free');
    expect(toModelRef('opencode', 'opencode/big-pickle')).toBe('opencode/big-pickle');
    expect(toModelRef('opencode', 'tokenharbor/deepseek-v4.1-flash:free')).toBe(
      'tokenharbor/deepseek-v4.1-flash:free',
    );
    expect(toModelRef('cline', 'cline-free/kat-coder-pro')).toBe('cline:cline-free/kat-coder-pro');
    // `google/` catalog rows execute through the direct Gemini runner: the
    // OpenCode `google/` provider is unwired on this host (live 2026-10-03).
    expect(toModelRef('google', 'gemini-3.8-flash')).toBe('gemini:gemini/gemini-3.8-flash');
    expect(toModelRef('gemini', 'gemini-3.8-flash')).toBe('gemini:gemini/gemini-3.8-flash');
    expect(toModelRef('gemini', 'gemini/gemini-3.1-pro')).toBe('gemini:gemini/gemini-3.1-pro');
    // The go-plan pool is its own quota: a bare id keeps the vendor.
    expect(toModelRef('opencode-go', 'space-bunny-free')).toBe('opencode-go/space-bunny-free');
  });

  it('treats an invalid model reference as a hard model failure', () => {
    expect(isHardModelFailure('Invalid model reference: mimo-v2.6-flash:free')).toBe(true);
    expect(isHardModelFailure('Model unavailable: tokenharbor/deepseek-v4.1-flash:free')).toBe(true);
    expect(isHardModelFailure('429 Too Many Requests')).toBe(false);
    expect(isHardModelFailure('')).toBe(false);
  });

  it('walks a qualified tokenharbor ref and hides vendors with no credential', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5-home-'));
    const lanesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5-lanes-'));
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5-shared-'));
    const oldHome = process.env.HOME;
    const oldLanes = process.env.FREE_LANES_DIR;
    const oldShared = process.env.FREE_LANES_SHARED_DIR;
    process.env.HOME = homeDir;
    process.env.FREE_LANES_DIR = lanesDir;
    process.env.FREE_LANES_SHARED_DIR = sharedDir;
    try {
      const { dir } = ensureBotLedger('vm5test');
      const lane = (pref: number, provider: string, model: string) => ({
        pref,
        family: `f${pref}`,
        provider,
        model,
        label: model,
        bucket: `${provider}-test`,
        tg: true,
        resetRule: 'test',
        status: 'available',
        nextReset: '-',
        nextResetAt: null,
        cooldownLeft: '-',
      });
      const table = {
        version: 3,
        failover: 'test',
        updatedAt: null,
        buckets: {},
        lanes: [
          lane(1, 'opencode', 'opencode/space-bunny-free'),
          lane(2, 'tokenharbor', 'mimo-v2.6-flash:free'),
          lane(3, 'opencode', 'cloudflare/@cf/qwen/qwen3.8-27b'),
        ],
      };
      fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table));
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ quota: {} }));
      const ready = (overrides = {}) => ({
        opencode: { ready: true },
        cline: { ready: true },
        tokenharbor: { ready: true },
        cloudflare: { ready: true },
        gemini: { ready: true },
        freebuff: { ready: true },
        ...overrides,
      });
      const open = selectTurnLanes({
        botId: 'vm5test',
        model: 'opencode/space-bunny-free',
        fallback: 'cline:cline-free/deepseek-v4.1-flash',
        readiness: ready(),
      });
      expect(open.models).toContain('tokenharbor/mimo-v2.6-flash:free');
      expect(open.models).not.toContain('mimo-v2.6-flash:free');
      const closed = selectTurnLanes({
        botId: 'vm5test',
        model: 'opencode/space-bunny-free',
        fallback: 'cline:cline-free/deepseek-v4.1-flash',
        readiness: ready({
          tokenharbor: { ready: false, needs: 'a Token Harbor key', fix: 'set it', command: null },
          cloudflare: { ready: false, needs: 'a Cloudflare token', fix: 'set it', command: null },
        }),
      });
      expect(closed.models).toEqual(['opencode/space-bunny-free']);
      expect(closed.skipped.some((s) => /needs a Token Harbor key/.test(s.why || ''))).toBe(true);
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldLanes === undefined) delete process.env.FREE_LANES_DIR;
      else process.env.FREE_LANES_DIR = oldLanes;
      if (oldShared === undefined) delete process.env.FREE_LANES_SHARED_DIR;
      else process.env.FREE_LANES_SHARED_DIR = oldShared;
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(lanesDir, { recursive: true, force: true });
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  });

  it('folds provider-distinct catalog rows but keeps shared-bar twins single', () => {
    const table = {
      version: 3,
      failover: 'test',
      buckets: {},
      lanes: [
        { pref: 1, family: 'f1', provider: 'opencode', model: 'opencode/space-bunny-free', label: 'Space Bunny', bucket: 'opencode-zen-free', tg: true },
        { pref: 2, family: 'f2', provider: 'opencode', model: 'tokenharbor/mimo-v2.6-flash:free', label: 'MiMo', bucket: 'tokenharbor-free', tg: true },
      ],
    };
    const { table: folded, added } = withCatalogLanes(table, [
      'opencode-go/space-bunny-free',
      'google/gemini-3.8-flash',
      'tokenharbor/mimo-v2.6-flash:free',
    ]);
    const refs = added.map((l) => `${l.provider}/${l.model}`);
    // The go-plan pool is separate quota: its own row. The tokenharbor twin
    // shares one bar: still a single row.
    expect(refs).toContain('opencode-go/space-bunny-free');
    expect(refs).toContain('google/gemini-3.8-flash');
    expect(refs.filter((r) => /mimo-v2\.6-flash/.test(r))).toHaveLength(0);
    expect(folded.lanes).toHaveLength(4);
    const go = folded.lanes.find((l) => l.provider === 'opencode-go');
    expect(go.model).toBe('space-bunny-free');
  });

  it('walks folded go-plan and gemini lanes in executable form', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5b-home-'));
    const lanesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5b-lanes-'));
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5b-shared-'));
    const oldHome = process.env.HOME;
    const oldLanes = process.env.FREE_LANES_DIR;
    const oldShared = process.env.FREE_LANES_SHARED_DIR;
    process.env.HOME = homeDir;
    process.env.FREE_LANES_DIR = lanesDir;
    process.env.FREE_LANES_SHARED_DIR = sharedDir;
    try {
      const { dir } = ensureBotLedger('vm5fold');
      const table = {
        version: 3,
        failover: 'test',
        updatedAt: null,
        buckets: {},
        lanes: [
          { pref: 1, family: 'f1', provider: 'opencode', model: 'opencode/space-bunny-free', label: 'Space Bunny', bucket: 'opencode-zen-free', tg: true, resetRule: 't', status: 'available', nextReset: '-', nextResetAt: null, cooldownLeft: '-' },
        ],
      };
      fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table));
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ quota: {} }));
      const readiness = {
        opencode: { ready: true },
        cline: { ready: true },
        tokenharbor: { ready: true },
        cloudflare: { ready: true },
        gemini: { ready: true },
        freebuff: { ready: true },
      };
      const choice = selectTurnLanes({
        botId: 'vm5fold',
        model: 'opencode/space-bunny-free',
        fallback: 'cline:cline-free/deepseek-v4.1-flash',
        readiness,
        catalogEntries: ['opencode-go/space-bunny-free', 'google/gemini-3.8-flash'],
      });
      expect(choice.models).toContain('opencode-go/space-bunny-free');
      expect(choice.models).toContain('gemini:gemini/gemini-3.8-flash');
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldLanes === undefined) delete process.env.FREE_LANES_DIR;
      else process.env.FREE_LANES_DIR = oldLanes;
      if (oldShared === undefined) delete process.env.FREE_LANES_SHARED_DIR;
      else process.env.FREE_LANES_SHARED_DIR = oldShared;
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(lanesDir, { recursive: true, force: true });
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  });

  it('stamps a keyed gemini quota error instead of re-burning it', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5c-home-'));
    const lanesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5c-lanes-'));
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5c-shared-'));
    const oldHome = process.env.HOME;
    const oldLanes = process.env.FREE_LANES_DIR;
    const oldShared = process.env.FREE_LANES_SHARED_DIR;
    process.env.HOME = homeDir;
    process.env.FREE_LANES_DIR = lanesDir;
    process.env.FREE_LANES_SHARED_DIR = sharedDir;
    try {
      const { dir } = ensureBotLedger('vm5quota');
      const table = {
        version: 3,
        failover: 'test',
        updatedAt: null,
        buckets: {},
        lanes: [
          { pref: 1, family: 'f1', provider: 'opencode', model: 'opencode/space-bunny-free', label: 'Space Bunny', bucket: 'opencode-zen-free', tg: true, resetRule: 't', status: 'available', nextReset: '-', nextResetAt: null, cooldownLeft: '-' },
        ],
      };
      fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table));
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ quota: {} }));
      const { trackRunQuota } = await import('../scripts/bot-host.mjs');
      const stamped = trackRunQuota({
        botId: 'vm5quota',
        modelRef: 'gemini:gemini-3.8-flash',
        result: { finalText: '', stderr: '', lastError: '429 Resource exhausted, retry in 20s' },
      });
      expect(stamped?.stamped).toBe(true);
      const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
      expect(session.quota['gemini/gemini-3.8-flash']?.depletedUntil).toBeGreaterThan(Date.now());
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldLanes === undefined) delete process.env.FREE_LANES_DIR;
      else process.env.FREE_LANES_DIR = oldLanes;
      if (oldShared === undefined) delete process.env.FREE_LANES_SHARED_DIR;
      else process.env.FREE_LANES_SHARED_DIR = oldShared;
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(lanesDir, { recursive: true, force: true });
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  });

  it('rests dead lanes for hours, transport blips for minutes', () => {    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5d-home-'));
    const lanesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5d-lanes-'));
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5d-shared-'));
    const oldHome = process.env.HOME;
    const oldLanes = process.env.FREE_LANES_DIR;
    const oldShared = process.env.FREE_LANES_SHARED_DIR;
    process.env.HOME = homeDir;
    process.env.FREE_LANES_DIR = lanesDir;
    process.env.FREE_LANES_SHARED_DIR = sharedDir;
    try {
      const { dir } = ensureBotLedger('vm5ttl');
      const table = {
        version: 3, failover: 'test', updatedAt: null, buckets: {},
        lanes: [
          { pref: 1, family: 'f1', provider: 'opencode', model: 'x', label: 'X', bucket: 'b', tg: true, resetRule: 't', status: 'available', nextReset: '-', nextResetAt: null, cooldownLeft: '-' },
          { pref: 2, family: 'f2', provider: 'opencode', model: 'y', label: 'Y', bucket: 'b', tg: true, resetRule: 't', status: 'available', nextReset: '-', nextResetAt: null, cooldownLeft: '-' },
        ],
      };
      fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table));
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ quota: {} }));
      // Live VM5 2026-10-03: user retries ~35min apart re-burned every dead
      // lane whose 10min stamp had just expired. Dead lanes must outlast that.
      const t0 = Date.now();
      expect(stampCooldown({ stateDir: dir, provider: 'opencode', model: 'x', errText: 'connect ECONNREFUSED 1.2.3.4', now: t0 }).stamped).toBe(true);
      expect(stampCooldown({ stateDir: dir, provider: 'opencode', model: 'y', errText: 'Model unavailable: y', kind: 'model-unavailable', now: t0 }).stamped).toBe(true);
      const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
      expect(session.quota['opencode/x'].kind).toBe('connection-failed');
      expect(session.quota['opencode/x'].depletedUntil).toBeLessThanOrEqual(t0 + CONNECTION_FAILED_COOLDOWN_MS + 5000);
      expect(session.quota['opencode/y'].kind).toBe('model-unavailable');
      expect(session.quota['opencode/y'].depletedUntil).toBeGreaterThan(t0 + CONNECTION_FAILED_COOLDOWN_MS);
      expect(session.quota['opencode/y'].depletedUntil).toBeLessThanOrEqual(t0 + HARD_MODEL_FAILURE_COOLDOWN_MS + 5000);
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldLanes === undefined) delete process.env.FREE_LANES_DIR;
      else process.env.FREE_LANES_DIR = oldLanes;
      if (oldShared === undefined) delete process.env.FREE_LANES_SHARED_DIR;
      else process.env.FREE_LANES_SHARED_DIR = oldShared;
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(lanesDir, { recursive: true, force: true });
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  });

  it('codes the go-plan pool OG so its row survives beside the zen row', () => {
    expect(planCodeForLane({ provider: 'opencode-go', model: 'space-bunny-free' })).toBe('OG');
    expect(planCodeForLane({ provider: 'opencode', model: 'opencode/space-bunny-free' })).toBe('OC');
    expect(planCodeForLane({ provider: 'opencode', model: 'tokenharbor/x:free' })).toBe('TH');
  });

  it('lists go-plan in /freemodel and parks keyed gemini last', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5e-home-'));
    const lanesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5e-lanes-'));
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm5e-shared-'));
    const oldHome = process.env.HOME;
    const oldLanes = process.env.FREE_LANES_DIR;
    const oldShared = process.env.FREE_LANES_SHARED_DIR;
    process.env.HOME = homeDir;
    process.env.FREE_LANES_DIR = lanesDir;
    process.env.FREE_LANES_SHARED_DIR = sharedDir;
    try {
      const { dir } = ensureBotLedger('vm5keys');
      const table = {
        version: 3, failover: 'test', updatedAt: null, buckets: {},
        lanes: [
          { pref: 1, family: 'f1', provider: 'opencode', model: 'opencode/space-bunny-free', label: 'Space Bunny', bucket: 'opencode-zen-free', tg: true, resetRule: 't', status: 'available', nextReset: '-', nextResetAt: null, cooldownLeft: '-' },
        ],
      };
      const folded = withCatalogLanes(table, ['opencode-go/space-bunny-free', 'google/gemini-3.8-flash']).table;
      fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(folded));
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ quota: {} }));
      const readiness = {
        opencode: { ready: true }, cline: { ready: true }, tokenharbor: { ready: true },
        cloudflare: { ready: true }, gemini: { ready: true }, freebuff: { ready: true },
      };
      // The walk spends free lanes before the keyed one.
      const choice = selectTurnLanes({
        botId: 'vm5keys', model: 'opencode/space-bunny-free', fallback: 'x',
        readiness, catalogEntries: [],
      });
      const refs = choice.models;
      expect(refs).toContain('opencode-go/space-bunny-free');
      expect(refs).toContain('gemini:gemini/gemini-3.8-flash');
      expect(refs.indexOf('opencode-go/space-bunny-free')).toBeLessThan(refs.indexOf('gemini:gemini/gemini-3.8-flash'));
      // The keyboard shows both, keyed last.
      const canonical = canonicalAllowanceLanes({ table: folded, session: { quota: {} }, readiness, location: 'test' });
      const body = formatFreemodelWithDepletion([], [], { current: '', location: 'test', canonical, tableLanes: folded.lanes });
      const rowButtons = (body.buttons || []).filter((b) => !b.header);
      const texts = rowButtons.map((b) => String(b.text || ''));
      expect(texts.some((t) => /\bOG\b/.test(t))).toBe(true);
      expect(texts.some((t) => /\bGM\b/.test(t))).toBe(true);
      expect(/\bGM\b/.test(texts[texts.length - 1])).toBe(true);
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldLanes === undefined) delete process.env.FREE_LANES_DIR;
      else process.env.FREE_LANES_DIR = oldLanes;
      if (oldShared === undefined) delete process.env.FREE_LANES_SHARED_DIR;
      else process.env.FREE_LANES_SHARED_DIR = oldShared;
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(lanesDir, { recursive: true, force: true });
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  });
});

describe('agent-gemini', () => {
  it('resolves the key from opts env or process env', () => {
    expect(resolveGeminiKey({ GEMINI_API_KEY: ' k ' })).toBe('k');
    expect(resolveGeminiKey({})).toBe(process.env.GEMINI_API_KEY?.trim() || '');
  });

  it('mirrors the live-site key chain (GOOGLE_API_KEY, API_KEY, GEMINI_API_KEYS[0])', () => {
    const saved = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      API_KEY: process.env.API_KEY,
      GEMINI_API_KEYS: process.env.GEMINI_API_KEYS,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.API_KEY;
    delete process.env.GEMINI_API_KEYS;
    try {
      expect(resolveGeminiKey({ GOOGLE_API_KEY: 'g' })).toBe('g');
      expect(resolveGeminiKey({ API_KEY: 'a' })).toBe('a');
      expect(resolveGeminiKey({ GEMINI_API_KEYS: ' first , second ' })).toBe('first');
      expect(resolveGeminiKey({})).toBe('');
      process.env.GOOGLE_API_KEY = 'env-g';
      expect(resolveGeminiKey({})).toBe('env-g');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('validates refs against the catalog', () => {
    expect(geminiModelId('gemini:gemini/gemini-3.7-flash')).toBe('gemini-3.7-flash');
    expect(geminiModelId('gemini/gemini-3.1-pro')).toBe('gemini-3.1-pro');
    expect(geminiModelId('gemini:gemini/nope')).toBeNull();
    expect(geminiModelId('opencode/big-pickle')).toBeNull();
  });

  it('maps auth/quota/not-found provider errors', () => {
    expect(mapGeminiError({ status: 401, body: 'invalid api key' })).toMatch(/auth failed/i);
    expect(mapGeminiError({ status: 429, body: 'quota exceeded' })).toMatch(/quota or rate limit/i);
    expect(mapGeminiError({ status: 404, body: 'model not found' })).toMatch(/not found/i);
  });

  it('fails closed without a key and never calls fetch', async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const result = await runGemini({
        prompt: 'hi',
        model: 'gemini/gemini-3.7-flash',
        env: {},
        fetchImpl: async () => {
          throw new Error('must not call fetch');
        },
      });
      expect(result.finalText).toBe('');
      expect(result.sessionID).toBeNull();
      expect(result.lastError).toMatch(/GEMINI_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    }
  });

  it('returns text and usage on success', async () => {
    let seen: any = null;
    const fetchImpl = async (_url: string, opts: any) => {
      seen = { url: _url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'PONG' } }], usage: { total_tokens: 42 } }),
      };
    };
    const result = await runGemini({
      prompt: 'hi',
      model: 'gemini:gemini/gemini-3.8-flash',
      system: 'You are a test system.',
      env: { GEMINI_API_KEY: 'k' },
      fetchImpl,
    });
    expect(result).toMatchObject({ code: 0, finalText: 'PONG', lastError: null, sessionID: null });
    expect(result.usage.tokens).toEqual({ total: 42 });
    expect(seen.body.model).toBe('gemini-3.8-flash');
    expect(seen.body.messages).toEqual([
      { role: 'system', content: 'You are a test system.' },
      { role: 'user', content: 'hi' },
    ]);
    expect(seen.auth).toBe('Bearer k');
  });

  it('falls back to gemini-2.5-flash once on 404 (live-site parity)', async () => {
    const models: string[] = [];
    const fetchImpl = async (_url: string, opts: any) => {
      const model = JSON.parse(opts.body).model;
      models.push(model);
      if (model !== 'gemini-2.5-flash') {
        return { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'FB' } }], usage: {} }),
      };
    };
    const result = await runGemini({
      prompt: 'hi',
      model: 'gemini/gemini-3.7-flash',
      env: { GEMINI_API_KEY: 'k' },
      fetchImpl,
    });
    expect(models).toEqual(['gemini-3.7-flash', 'gemini-2.5-flash']);
    expect(result.finalText).toBe('FB');
    expect(result.stderr).toContain('fallback:gemini-2.5-flash');
  });

  it('classifies provider 429 as quota without throwing', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'quota exceeded' } }),
    });
    const result = await runGemini({
      prompt: 'hi',
      model: 'gemini/gemini-3.1-pro',
      env: { GEMINI_API_KEY: 'k' },
      fetchImpl,
    });
    expect(result.finalText).toBe('');
    expect(result.lastError).toMatch(/quota or rate limit/i);
  });
});

describe('agent-cline', () => {
  it('builds cline args with provider, model, json and prompt last', () => {
    const args = buildClineArgs({
      prompt: 'Say OK',
      model: 'cline-free/deepseek-v4.1-flash',
      variant: 'low',
      plan: true,
      timeoutMs: 90000,
      workspace: '/ws',
    });
    expect(args).toEqual([
      '-P', 'cline',
      '-m', 'cline-free/deepseek-v4.1-flash',
      '--json', '--auto-approve', 'true',
      '--thinking', 'low',
      '-p',
      '-t', '90',
      '-c', '/ws',
      'Say OK',
    ]);
  });

  it('drops invalid variants and omits plan/timeout flags when unset', () => {
    const args = buildClineArgs({ prompt: 'hi', model: 'cline-free/kat-coder-pro', variant: 'auto' });
    expect(args).toEqual(['-P', 'cline', '-m', 'cline-free/kat-coder-pro', '--json', '--auto-approve', 'true', 'hi ']);
    expect(CLINE_THINKING_LEVELS).toContain('xhigh');
    expect(typeof resolveClineBin('/custom/cline')).toBe('string');
    expect(resolveClineBin('/custom/cline')).toBe('/custom/cline');
  });

  it('maps run_result, error and tool events', () => {
    expect(
      mapClineEvent({
        type: 'run_result',
        text: 'OK',
        usage: { totalCost: 0, inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
        model: 'deepseek',
      }),
    ).toMatchObject({ kind: 'run_result', text: 'OK' });
    expect(mapClineEvent({ type: 'error', message: 'boom' })).toEqual({ kind: 'error', message: 'boom' });
    expect(
      mapClineEvent({ type: 'agent_event', event: { type: 'tool_use', tool: 'bash', status: 'running' } }),
    ).toMatchObject({ kind: 'tool', tool: 'bash' });
    expect(mapClineEvent(null)).toBeNull();
  });
});

// A Cline run has to report the session it created, or there is nothing for the
// /tui terminal to resume. Before this, runCline resolved `sessionID: null` for
// every run, so `sessions.json` kept a stale opencode id from before the chat
// moved to Cline and the terminal opened that instead — a different agent on a
// different thread. Cline cannot be TOLD which id to use (measured on 3.0.65:
// `--id` with `--json` answers "interactive mode is unsupported", `--id` without
// a TTY answers "interactive mode requires a TTY"), so the id can only be read
// back out of the sessions directory.
describe('cline session id capture', () => {
  const meta = (rows: Record<string, { cwd: string; started_at: string }>) => {
    const table = rows;
    return (id: string) => {
      const row = table[id];
      return row ? { ...row, started_at_epoch: Date.parse(row.started_at) } : null;
    };
  };

  it('takes the id this run created', () => {
    expect(
      pickClineSessionId({
        before: ['1_a'],
        after: ['1_a', '2_b'],
        workspace: '/w',
        readMeta: meta({ '2_b': { cwd: '/w', started_at: '2026-01-01T00:00:00Z' } }),
      }),
    ).toBe('2_b');
  });

  it('never returns an id the run did not create', () => {
    // The before-snapshot is taken before the spawn, so everything in it belongs
    // to an earlier run. Returning one of those resumes a stale conversation.
    expect(
      pickClineSessionId({
        before: ['1_a', '2_b'],
        after: ['1_a', '2_b'],
        workspace: '/w',
        readMeta: meta({
          '1_a': { cwd: '/w', started_at: '2026-01-01T00:00:00Z' },
          '2_b': { cwd: '/w', started_at: '2026-01-02T00:00:00Z' },
        }),
      }),
    ).toBeNull();
  });

  it('skips another workspace, because the directory is shared host-wide', () => {
    // A run in /a and a run in /b both land in ~/.cline/data/sessions. An id
    // from the wrong checkout resumes a conversation with nothing to do with
    // this chat, and the TUI would show it as this chat's thread.
    expect(
      pickClineSessionId({
        before: [],
        after: ['9_z'],
        workspace: '/w',
        readMeta: meta({ '9_z': { cwd: '/other', started_at: '2026-06-01T00:00:00Z' } }),
      }),
    ).toBeNull();
  });

  it('picks the newest when several runs land in the same workspace', () => {
    expect(
      pickClineSessionId({
        before: [],
        after: ['1_a', '2_b', '3_c'],
        workspace: '/w',
        readMeta: meta({
          '1_a': { cwd: '/w', started_at: '2026-01-01T00:00:00Z' },
          '2_b': { cwd: '/w', started_at: '2026-03-01T00:00:00Z' },
          '3_c': { cwd: '/w', started_at: '2026-02-01T00:00:00Z' },
        }),
      }),
    ).toBe('2_b');
  });

  it('recognises only real cline session directory names', () => {
    expect(CLINE_SESSION_ID_RE.test('1790714599861_80trx')).toBe(true);
    expect(CLINE_SESSION_ID_RE.test('ses_f227779acffe')).toBe(false);
    expect(CLINE_SESSION_ID_RE.test('README')).toBe(false);
  });

  it('reads nothing rather than throwing when the directory is absent', () => {
    expect(listClineSessionIds('/nonexistent/cline/sessions')).toEqual([]);
    expect(clineSessionsDir('/explicit/dir')).toBe('/explicit/dir');
  });

  it('runCline resolves the id its own run created', async () => {
    // The real seam, not the helper: a before/after pair of the sessions
    // directory, exactly what runCline sees around the spawn.
    const listings: string[][] = [['1_old'], ['1_old', '2_new']];
    let call = 0;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => {},
    });
    const result = await runCline({
      prompt: 'hi',
      model: 'cline-free/deepseek-v4.1-flash',
      workspace: '/w',
      clineBin: '/fake/cline',
      spawnImpl: () => {
        // Emit one run_result line, then close, the way the real CLI does.
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'run_result', text: 'ok' })}\n`));
          child.emit('close', 0);
        });
        return child;
      },
      listSessionIds: () => listings[Math.min(call++, listings.length - 1)],
      readSessionMeta: () => ({ cwd: '/w', started_at: '2026-05-01T00:00:00Z' }),
    });
    expect(result.sessionID).toBe('2_new');
    expect(result.finalText).toBe('ok');
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

describe('extractCodeBlocks', () => {
  it('returns fenced blocks verbatim for the standalone snippet message', () => {
    const answer = [
      'Here is the fix:',
      '```ts',
      'export const x = 1;',
      '```',
      'Done.',
    ].join('\n');
    expect(extractCodeBlocks(answer)).toEqual(['```ts\nexport const x = 1;\n```']);
  });

  it('keeps every block in order and handles missing language tags', () => {
    const answer = ['```js', 'a();', '```', 'text', '```', 'b();', '```'].join('\n');
    expect(extractCodeBlocks(answer)).toEqual(['```js\na();\n```', '```\nb();\n```']);
  });

  it('returns nothing when there is no fenced code', () => {
    expect(extractCodeBlocks('just prose instructions')).toEqual([]);
    expect(extractCodeBlocks('')).toEqual([]);
    expect(extractCodeBlocks(null)).toEqual([]);
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

describe('ProgressRenderer finish (bot restart/timeout truthfulness)', () => {
  const makeRenderer = () => {
    const sent: string[] = [];
    const api = {
      sendMessage: async (_chatId: unknown, text: string, _extra?: unknown) => {
        sent.push(text);
        return { message_id: sent.length };
      },
    };
    const renderer = new ProgressRenderer({ api: api as never, chatId: 1 });
    return { renderer, sent };
  };

  it('killed before any output says Interrupted (not misleading Done)', async () => {
    const { renderer, sent } = makeRenderer();
    await renderer.finish({ code: null, finalText: '', lastError: '', stderr: '' });
    expect(sent.join('\n')).toContain('Interrupted before the model produced output');
  });

  it('provider timeout is humanized (no raw ms) and keeps a retry hint', async () => {
    const { renderer, sent } = makeRenderer();
    await renderer.finish({ code: null, finalText: '', lastError: 'timed out after 90000ms', stderr: '' });
    const all = sent.join('\n');
    expect(all).toContain('⏱ Timed out after 90s — the model didn\'t finish.');
    expect(all).not.toContain('90000ms');
    expect(all).toContain('/thinking medium');
    expect(all).toContain('/new');
  });

  it('provider timeout at the 900s wall reads as 15m, never raw ms', async () => {
    const { renderer, sent } = makeRenderer();
    await renderer.finish({ code: null, finalText: '', lastError: 'timed out after 900000ms', stderr: '' });
    const all = sent.join('\n');
    expect(all).toContain('Timed out after 15m');
    expect(all).not.toContain('900000ms');
    expect(all).toContain('/model');
  });

  it('non-timeout errors keep the Error: prefix unchanged', async () => {
    const { renderer, sent } = makeRenderer();
    await renderer.finish({ code: 1, finalText: '', lastError: 'spawn opencode ENOENT', stderr: '' });
    expect(sent.join('\n')).toContain('Error: spawn opencode ENOENT');
  });

  it('partial output is delivered and the error is not swallowed', async () => {
    const { renderer, sent } = makeRenderer();
    await renderer.finish({ code: null, finalText: 'partial answer', lastError: 'timed out after 90000ms', stderr: '' });
    const all = sent.join('\n');
    expect(all).toContain('partial answer');
    expect(all).toContain('Finished with an error after partial output');
    expect(all).toContain('90s');
    expect(all).not.toContain('90000ms');
  });

  it('timeout with partial output says where it got to and how to continue', async () => {
    const sent: string[] = [];
    const api = {
      sendMessage: async (_chatId: unknown, text: string, _extra?: unknown) => {
        sent.push(text);
        return { message_id: sent.length };
      },
      editMessageText: async () => ({}),
      sendChatAction: async () => ({}),
    };
    const throttle = { submit: (fn: () => unknown) => Promise.resolve().then(fn), pause: () => {} };
    const renderer = new ProgressRenderer({ api: api as never, throttle: throttle as never, chatId: 1 });
    renderer.onEvent({ kind: 'tool', tool: 'shell', status: 'running', input: { command: 'npm run build' } });
    renderer.onEvent({ kind: 'text', text: 'first output chunk' });
    await renderer.finish({ code: null, finalText: 'partial answer', lastError: 'timed out after 900000ms', stderr: '' });
    const all = sent.join('\n');
    expect(all).toContain('partial answer');
    expect(all).toContain('Finished with an error after partial output');
    expect(all).toContain('15m');
    expect(all).toContain('Last:');
    expect(all).toContain('shell');
    expect(all).toContain('continue the same session');
    renderer.stopTyping();
  });

  it('timeout with no output still reports last activity', async () => {
    const sent: string[] = [];
    const api = {
      sendMessage: async (_chatId: unknown, text: string, _extra?: unknown) => {
        sent.push(text);
        return { message_id: sent.length };
      },
      editMessageText: async () => ({}),
      sendChatAction: async () => ({}),
    };
    const throttle = { submit: (fn: () => unknown) => Promise.resolve().then(fn), pause: () => {} };
    const renderer = new ProgressRenderer({ api: api as never, throttle: throttle as never, chatId: 1 });
    renderer.onEvent({ kind: 'tool', tool: 'shell', status: 'running', input: { command: 'npm run build' } });
    await renderer.finish({ code: null, finalText: '', lastError: 'timed out after 900000ms', stderr: '' });
    const all = sent.join('\n');
    expect(all).toContain('Timed out after 15m');
    expect(all).toContain('shell');
    expect(all).toContain('continue the same session');
    renderer.stopTyping();
  });

  it('clean empty run keeps the legacy Done message', async () => {
    const { renderer, sent } = makeRenderer();
    await renderer.finish({ code: 0, finalText: '', lastError: '', stderr: '' });
    expect(sent.join('\n')).toContain('no text output');
  });
});

describe('humanizeRunError / isTimeoutError', () => {
  it('maps the 900000ms wall to minutes without raw ms', () => {
    const out = humanizeRunError('timed out after 900000ms');
    expect(out).toMatch(/15m/);
    expect(out).not.toMatch(/900000ms/);
  });

  it('maps sub-minute timeouts to seconds', () => {
    expect(humanizeRunError('timed out after 30000ms')).toMatch(/30s/);
  });

  it('passes non-timeout errors through unchanged', () => {
    expect(humanizeRunError('quota exceeded')).toBe('quota exceeded');
    expect(humanizeRunError('')).toBe('');
  });

  it('isTimeoutError detects only timeout strings', () => {
    expect(isTimeoutError('timed out after 900000ms')).toBe(true);
    expect(isTimeoutError('quota exceeded')).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});

describe('failure learning loop', () => {
  it('buildFailure truncates long kinds/hints', () => {
    const f = buildFailure({ lane: 'a/one', kind: 'x'.repeat(500), hint: 'y'.repeat(500) });
    expect(f.kind).toHaveLength(160);
    expect(f.hint).toHaveLength(160);
    expect(f.at).toMatch(/^20\d{2}-/);
  });

  it('record/load roundtrips and skips corrupt lines', () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fail-')), 'f.jsonl');
    expect(recordFailure({ lane: 'a/one', kind: 'Rate limit exceeded' }, p)).toBe(true);
    fs.appendFileSync(p, 'not json\n');
    expect(recordFailure({ lane: 'b/two', kind: 'Rate limit exceeded' }, p)).toBe(true);
    const rows = loadFailures(p);
    expect(rows).toHaveLength(2);
    expect(groupFailures(rows)[0]).toMatchObject({ kind: 'Rate limit exceeded', count: 2 });
  });

  it('recording is disabled and safe', () => {
    expect(recordFailure({ kind: 'x' }, null)).toBe(false);
    expect(loadFailures('/nonexistent/path.jsonl')).toEqual([]);
  });

  it('groups by kind with per-lane counts', () => {
    const groups = groupFailures([
      buildFailure({ lane: 'a/one', kind: 'out of funds' }),
      buildFailure({ lane: 'b/two', kind: 'out of funds' }),
      buildFailure({ lane: 'a/one', kind: 'CB-8 flipped' }),
    ]);
    expect(groups[0]).toMatchObject({ kind: 'out of funds', count: 2 });
    expect(groups[0].lanes).toEqual({ 'a/one': 1, 'b/two': 1 });
  });
});

describe('cline single-word prompts (VM2 Hi outage)', () => {
  const base = { model: 'm', workspace: '/tmp' };
  it('forces prompt parsing for single-token prompts', () => {
    const args = buildClineArgs({ ...base, prompt: 'Hi' });
    expect(args.slice(-1)).toEqual(['Hi ']);
  });

  it('leaves multi-word and empty prompts untouched', () => {
    expect(buildClineArgs({ ...base, prompt: 'fix the tests' }).slice(-1)).toEqual(['fix the tests']);
    expect(buildClineArgs({ ...base, prompt: '' }).slice(-1)).toEqual(['']);
  });
});

describe('VM2 transcript error shapes', () => {
  const modelNotFoundLine =
    'timestamp=2026-09-23T23:55:56.723Z level=ERROR run=897a105f message="share subscriber failed" ' +
    'type=message.updated cause="Cause([Fail(ProviderModelNotFoundError: Model not found: opencode/glm-4.7-free. Did you mean: glm-5, glm-5.1, glm-5.2?)])"';

  it('classifies ProviderModelNotFound with its suggestion, deduped', () => {
    const out = extractLogError(`${modelNotFoundLine}\n${modelNotFoundLine}`);
    expect(out).toContain('Model not found');
    expect(out).toContain('/freemodel');
    expect(out).toContain('glm-5');
    expect(out).not.toContain('timestamp=');
    expect(out.indexOf('glm-4.7-free')).toBe(out.lastIndexOf('glm-4.7-free'));
  });

  it('strips ANSI color before matching', () => {
    const out = extractLogError('\x1b[31mlevel=ERROR error.error="AI_APICallError: Rate limit exceeded"\x1b[0m');
    expect(out).toContain('rate limit');
    expect(out).not.toContain('\x1b');
  });
});

describe('ProgressRenderer coalescing (VM2 thinking-spam outage)', () => {
  const makeRenderer = (opts = {}) => {
    const sent = [];
    const edited = [];
    const api = {
      sendMessage: async (_c, text) => {
        sent.push(text);
        return { message_id: sent.length };
      },
      editMessageText: async (_c, _id, text) => {
        edited.push(text);
        return true;
      },
    };
    const throttle = { submit: (fn) => Promise.resolve().then(fn), pause: () => {} };
    const renderer = new ProgressRenderer({ api, throttle, chatId: 1, maxEdits: 40, ...opts });
    const flush = async () => {
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    };
    return { renderer, sent, edited, flush };
  };

  it('creates one progress message no matter how many reasoning events arrive', async () => {
    const { renderer, sent, flush } = makeRenderer();
    for (let i = 0; i < 25; i += 1) {
      renderer.onEvent({ kind: 'reasoning', text: `exploring the repository structure part ${i}` });
    }
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('⏳');
    expect(sent[0]).toContain('thinking…');
  });

  it('drops compressor fragments and repeats', async () => {
    const { renderer, sent, flush } = makeRenderer();
    for (const noise of ['.', '/', 'check', 'meal', 'at', ':', '`/']) {
      renderer.onEvent({ kind: 'reasoning', text: noise });
    }
    await flush();
    expect(sent).toHaveLength(0);
    renderer.onEvent({ kind: 'reasoning', text: 'checking the food logs table in D1 for the latest meal' });
    renderer.onEvent({ kind: 'reasoning', text: 'checking the food logs table in D1 for the latest meal' });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('enforces maxEdits instead of editing forever', async () => {
    const { renderer, edited, flush } = makeRenderer({ maxEdits: 3 });
    renderer.onEvent({ kind: 'reasoning', text: 'first substantive exploration of the codebase structure' });
    await flush();
    for (let i = 0; i < 10; i += 1) {
      renderer.onEvent({ kind: 'reasoning', text: `follow-up investigation number ${i} into test files` });
    }
    await flush();
    expect(edited.length).toBeLessThanOrEqual(3);
  });

  it('survives a failed create without spawning a message per event', async () => {    const sent = [];
    const api = {
      sendMessage: async () => {
        sent.push(1);
        return null;
      },
    };
    const throttle = { submit: (fn) => Promise.resolve().then(fn), pause: () => {} };
    const renderer = new ProgressRenderer({ api, throttle, chatId: 1 });
    for (let i = 0; i < 10; i += 1) {
      renderer.onEvent({ kind: 'reasoning', text: `substantive exploration round ${i} of the food database` });
    }
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
  });

  it('shows one shared working headline: provider + model + elapsed + usage', async () => {
    const { renderer, sent, flush } = makeRenderer();
    renderer.setHeadline({ providerLabel: 'Cline', modelLabel: 'glm-4.7-free' });
    renderer.onEvent({ kind: 'reasoning', text: 'substantive exploration of the food database tables' });
    renderer.onEvent({ kind: 'step_finish', tokens: 39321 });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('⏳ Cline glm-4.7-free');
    expect(sent[0]).toContain('working…');
    expect(sent[0]).toContain('- 39.3K/131.1K (30%)');
  });
});

describe('BOT-18 — silence to a receipt and 409 conflict handling', () => {
  it('detects Telegram 409 Conflict via isConflict', () => {
    const conflict = new TelegramError('getUpdates', 409, 'Conflict: terminated by other getUpdates request');
    expect(conflict.isConflict).toBe(true);
    expect(conflict.isRateLimit).toBe(false);

    const rateLimit = new TelegramError('getUpdates', 429, 'Too Many Requests', { retry_after: 5 });
    expect(rateLimit.isConflict).toBe(false);
    expect(rateLimit.isRateLimit).toBe(true);

    const other = new TelegramError('sendMessage', 400, 'Bad Request: message is too long');
    expect(other.isConflict).toBe(false);
  });

  it('records run lease at start and deletes on finish', () => {
    const testBotId = `test-lease-${Date.now()}`;
    const startedAt = Date.now();
    recordRunStart(testBotId, { chatId: 4242, messageId: null, startedAt, pid: process.pid });

    let leases = loadLeases(testBotId);
    expect(leases.get('4242')).toEqual({ chatId: 4242, messageId: null, startedAt, pid: process.pid });

    // Update with messageId once created
    recordRunStart(testBotId, { chatId: 4242, messageId: 9999, startedAt, pid: process.pid });
    leases = loadLeases(testBotId);
    expect(leases.get('4242')).toEqual({ chatId: 4242, messageId: 9999, startedAt, pid: process.pid });

    // Delete on finish
    recordRunFinish(testBotId, 4242);
    leases = loadLeases(testBotId);
    expect(leases.has('4242')).toBe(false);
  });

  it('ProgressRenderer calls onMessageId when progress message is created', async () => {
    let capturedId = null;
    const api = {
      sendMessage: async () => ({ message_id: 7777 }),
      editMessageText: async () => ({}),
    };
    const throttle = { submit: (fn) => Promise.resolve().then(fn), pause: () => {} };
    const renderer = new ProgressRenderer({
      api,
      throttle,
      chatId: 5555,
      onMessageId: (msgId) => {
        capturedId = msgId;
      },
    });

    renderer.onEvent({ kind: 'reasoning', text: 'substantive reasoning exploration for database' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(capturedId).toBe(7777);
  });

  it('sweepOrphanedLeases edits message to terminal receipt and records crash-pending', async () => {
    const testBotId = `test-sweep-${Date.now()}`;
    const tmpFailLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fail-sweep-')), 'failures.jsonl');
    const prevLogEnv = process.env.BOT_FAILURE_LOG;
    process.env.BOT_FAILURE_LOG = tmpFailLog;

    try {
      // Seed an orphaned lease from an older run
      const olderTime = Date.now() - 50000;
      recordRunStart(testBotId, {
        chatId: 8888,
        messageId: 3333,
        startedAt: olderTime,
        pid: process.pid - 1,
      });

      const edited = [];
      const mockApi = {
        editMessageText: async (chatId, messageId, text) => {
          edited.push({ chatId, messageId, text });
          return {};
        },
      };

      const sweptCount = await sweepOrphanedLeases({
        api: mockApi,
        config: { id: testBotId, agent: { model: 'opencode/test-model' } },
        bootTime: Date.now(),
      });

      expect(sweptCount).toBe(1);
      expect(edited).toHaveLength(1);
      expect(edited[0]).toEqual({
        chatId: 8888,
        messageId: 3333,
        text: 'restarted mid-run — send it again',
      });

      // Lease should be cleared
      const leases = loadLeases(testBotId);
      expect(leases.has('8888')).toBe(false);

      // crash-pending failure row should be recorded
      const failures = fs
        .readFileSync(tmpFailLog, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        bot: testBotId,
        lane: 'opencode/test-model',
        kind: 'crash-pending',
      });
      expect(failures[0].hint).toContain('chat 8888');
    } finally {
      process.env.BOT_FAILURE_LOG = prevLogEnv;
      fs.rmSync(path.dirname(tmpFailLog), { recursive: true, force: true });
    }
  });
});

describe('BOT-21 — Coordination Tax Logger & Repro Consensus', () => {
  it('canonicalString produces deterministic key ordering and canonical JSON', () => {
    const objA = { z: 1, a: 2, m: { y: 'bar', x: 'foo' } };
    const objB = { a: 2, z: 1, m: { x: 'foo', y: 'bar' } };
    expect(canonicalString(objA)).toBe(canonicalString(objB));
    expect(canonicalString(JSON.stringify(objA))).toBe(canonicalString(objB));
    expect(argsHash(objA)).toBe(argsHash(objB));
    expect(argsHash(objA)).toHaveLength(16);
  });

  it('normalizeTicket normalizes ticket identifiers', () => {
    expect(normalizeTicket('12')).toBe('12');
    expect(normalizeTicket('#12')).toBe('12');
    expect(normalizeTicket('BUG-12')).toBe('12');
    expect(normalizeTicket('#BUG-12')).toBe('12');
  });

  it('recordCoordination logs invocations and alerts on repeated args-hash on same ticket', () => {
    const tmpLog = path.join(os.tmpdir(), `coord_tax_test_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
    try {
      const args1 = { task: 'fix typo', tool: 'opencode', model: 'flash' };
      // First call on ticket 101 -> count 1, alert false
      const r1 = recordCoordination({
        ticket: '101',
        agent: 'orchestrator',
        tool: 'opencode',
        args: args1,
        logPath: tmpLog,
      });
      expect(r1.ok).toBe(true);
      expect(r1.count).toBe(1);
      expect(r1.alert).toBe(false);

      // Second call with IDENTICAL args on same ticket -> count 2, alert true, alertReason REPEAT_ARGS_HASH
      const r2 = recordCoordination({
        ticket: '101',
        agent: 'orchestrator',
        tool: 'opencode',
        args: args1,
        logPath: tmpLog,
      });
      expect(r2.ok).toBe(true);
      expect(r2.count).toBe(2);
      expect(r2.alert).toBe(true);
      expect(r2.alertReason).toBe('REPEAT_ARGS_HASH');

      // Call on DIFFERENT ticket with same args -> count 1, alert false (per-ticket tracking)
      const r3 = recordCoordination({
        ticket: '102',
        agent: 'orchestrator',
        tool: 'opencode',
        args: args1,
        logPath: tmpLog,
      });
      expect(r3.count).toBe(1);
      expect(r3.alert).toBe(false);

      // Call on ticket 101 with DIFFERENT args -> count 1 for new hash, alert false
      const r4 = recordCoordination({
        ticket: '101',
        agent: 'orchestrator',
        tool: 'opencode',
        args: { task: 'different task' },
        logPath: tmpLog,
      });
      expect(r4.count).toBe(1);
      expect(r4.alert).toBe(false);

      // readCoordinationLog filters by ticket
      const list101 = readCoordinationLog({ ticket: '101', logPath: tmpLog });
      expect(list101).toHaveLength(3);
      const listAll = readCoordinationLog({ logPath: tmpLog });
      expect(listAll).toHaveLength(4);
    } finally {
      if (fs.existsSync(tmpLog)) fs.unlinkSync(tmpLog);
    }
  });

  it('evaluateReproVerdicts enforces matching verdicts or escalates to orchestrator', () => {
    // Matching confirmed verdicts
    const matchConfirmed = evaluateCoordinationReproVerdicts([
      { status: 'confirmed', by: 'qa1' },
      { status: 'confirmed', by: 'qa2' },
    ]);
    expect(matchConfirmed.match).toBe(true);
    expect(matchConfirmed.escalated).toBe(false);
    expect(matchConfirmed.consensus).toBe('confirmed');

    // Matching failed verdicts
    const matchFailed = evaluateCoordinationReproVerdicts([
      { status: 'failed', by: 'qa1' },
      { status: 'failed', by: 'qa2' },
    ]);
    expect(matchFailed.match).toBe(true);
    expect(matchFailed.escalated).toBe(false);
    expect(matchFailed.consensus).toBe('failed');

    // Conflicting verdicts (confirmed vs failed) -> escalate!
    const conflict = evaluateCoordinationReproVerdicts([
      { status: 'confirmed', by: 'qa1' },
      { status: 'failed', by: 'qa2' },
    ]);
    expect(conflict.match).toBe(false);
    expect(conflict.escalated).toBe(true);
    expect(conflict.blocked_reason).toBe('repro_verdict_conflict');
    expect(conflict.escalation_assignee).toBe('orchestrator');

    // Ambiguous verdict -> escalate!
    const ambiguous = evaluateCoordinationReproVerdicts([
      { status: 'confirmed', by: 'qa1' },
      { status: 'ambiguous', by: 'qa2' },
    ]);
    expect(ambiguous.match).toBe(false);
    expect(ambiguous.escalated).toBe(true);
    expect(ambiguous.blocked_reason).toBe('repro_verdict_conflict');
  });
});


describe('BOT-9 live failover wiring', () => {
  it('fans out renderer first and isolates observer failures', () => {
    const order = [];
    const context = { model: 'm1', attempt: 1 };
    fanoutProgressEvent({
      renderer: { onEvent: () => { order.push('renderer'); throw new Error('renderer failure'); } },
      observer: { onEvent: (event, receivedContext) => { order.push(['observer', event.kind, receivedContext]); } },
      event: { kind: 'reasoning', text: 'not persisted' },
      context,
    });
    expect(order).toEqual(['renderer', ['observer', 'reasoning', context]]);
    expect(() => fanoutProgressEvent({
      renderer: { onEvent: () => order.push('renderer') },
      observer: { onEvent: () => { throw new Error('observer failure'); } },
      event: { kind: 'tool' },
    })).not.toThrow();
  });


  it('failoverModels collapses duplicates and drops empties', async () => {
    const { failoverModels } = await import('../scripts/lib/agent-opencode.mjs');
    expect(failoverModels('m1', 'm1')).toEqual(['m1']);
    expect(failoverModels('m1', 'm2')).toEqual(['m1', 'm2']);
    expect(failoverModels('m1', '')).toEqual(['m1']);
    expect(failoverModels('', null)).toEqual([]);
  });

  it('runOpencodeWithFailover switches lanes with a user-visible line', async () => {
    const { EventEmitter } = await import('node:events');
    const { runOpencodeWithFailover } = await import('../scripts/bot-host.mjs');
    const oldLog = process.env.BOT_FAILURE_LOG;
    process.env.BOT_FAILURE_LOG = `${os.tmpdir()}/failover_test_${Date.now()}.jsonl`;
    try {
      const modelsSeen = [];
      const spawnImpl = (bin, args) => {
        const model = String(args[args.indexOf('-m') + 1]);
        modelsSeen.push(model);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => { child.emit('close', 1); };
        queueMicrotask(() => {
          if (model === 'm1') {
            child.stderr.emit('data', Buffer.from('level=ERROR msg="run failed" error.error="rate limit exceeded, retry later"\n'));
          } else {
            child.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"fixed it"}}\n'));
          }
          child.emit('close', model === 'm1' ? 1 : 0);
        });
        return child;
      };
      const sent = [];
      const api = { sendMessage: async (chatId, text) => { sent.push(text); return {}; } };
      const result = await runOpencodeWithFailover({
        api, chatId: 7, prompt: 'fix x', models: ['m1', 'm2'],
        workspace: '/tmp', timeoutMs: 5000, spawnImpl,
      });
      expect(modelsSeen).toEqual(['m1', 'm2']);
      expect(result.finalText).toBe('fixed it');
      expect(sent.length).toBe(1);
      expect(sent[0]).toMatch(/m1.*switching to.*m2/);
    } finally {
      if (oldLog === undefined) delete process.env.BOT_FAILURE_LOG;
      else process.env.BOT_FAILURE_LOG = oldLog;
    }
  });

  it('attaches model and attempt context to every failover run', async () => {
    const { EventEmitter } = await import('node:events');
    const { runOpencodeWithFailover } = await import('../scripts/bot-host.mjs');
    const starts = [];
    const completes = [];
    const events = [];
    const modelsSeen = [];
    let currentModel = '';
    const spawnImpl = (bin, args) => {
      const model = String(args[args.indexOf('-m') + 1]);
      modelsSeen.push(model);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => child.emit('close', 1);
      queueMicrotask(() => {
        if (model === 'm1') {
          child.stdout.emit('data', Buffer.from('{"type":"error","error":{"message":"rate limit exceeded"}}\n'));
        } else {
          child.stdout.emit('data', Buffer.from('{"type":"reasoning","part":{"text":"private"}}\n'));
          child.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"done"}}\n'));
        }
        child.emit('close', model === 'm1' ? 1 : 0);
      });
      return child;
    };
    const oldLog = process.env.BOT_FAILURE_LOG;
    process.env.BOT_FAILURE_LOG = '0';
    try {
      const result = await runOpencodeWithFailover({
        api: { sendMessage: async () => ({}) },
        chatId: 7,
        prompt: 'fix x',
        models: ['m1', 'm2'],
        workspace: '/tmp',
        timeoutMs: 5000,
        spawnImpl,
        onEvent: (event) => events.push(`${currentModel}:${event.kind}`),
        onAttemptStart: ({ model, attempt }) => { currentModel = `${model}:${attempt}`; starts.push(currentModel); },
        onAttemptComplete: ({ model, attempt, result: attemptResult }) => completes.push(`${model}:${attempt}:${attemptResult.finalText ? 'complete' : 'failed'}`),
      });
      expect(result.finalText).toBe('done');
      expect(modelsSeen).toEqual(['m1', 'm2']);
      expect(starts).toEqual(['m1:1', 'm2:2']);
      expect(completes).toEqual(['m1:1:failed', 'm2:2:complete']);
      expect(events).toEqual(['m1:1:error', 'm2:2:reasoning', 'm2:2:text']);
    } finally {
      if (oldLog === undefined) delete process.env.BOT_FAILURE_LOG;
      else process.env.BOT_FAILURE_LOG = oldLog;
    }
  });

  it('single-model chain behaves like a direct call with no switch line', async () => {
    const { EventEmitter } = await import('node:events');
    const { runOpencodeWithFailover } = await import('../scripts/bot-host.mjs');
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"done"}}\n'));
        child.emit('close', 0);
      });
      return child;
    };
    const sent = [];
    const api = { sendMessage: async (chatId, text) => { sent.push(text); return {}; } };
    const result = await runOpencodeWithFailover({
      api, chatId: 7, prompt: 'fix x', models: ['m1'], workspace: '/tmp', timeoutMs: 5000, spawnImpl,
    });
    expect(result.finalText).toBe('done');
    expect(sent).toEqual([]);
  });
});

describe('BOT-19 /tx wiring', () => {
  const OLD_WS = process.env.WORK_SESSIONS;
  const OLD_LOC = process.env.BOT_LOCATION;
  const OLD_OBSERVERS = process.env.WORK_OBSERVERS;
  let wsFile;
  let observerRoot;
  beforeEach(() => {
    wsFile = `${os.tmpdir()}/tx_test_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
    observerRoot = `${os.tmpdir()}/tx_observer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    process.env.WORK_SESSIONS = wsFile;
    process.env.WORK_OBSERVERS = observerRoot;
    process.env.BOT_LOCATION = 'testbox';
  });
  afterEach(() => {
    if (OLD_WS === undefined) delete process.env.WORK_SESSIONS;
    else process.env.WORK_SESSIONS = OLD_WS;
    if (OLD_LOC === undefined) delete process.env.BOT_LOCATION;
    else process.env.BOT_LOCATION = OLD_LOC;
    if (OLD_OBSERVERS === undefined) delete process.env.WORK_OBSERVERS;
    else process.env.WORK_OBSERVERS = OLD_OBSERVERS;
    try { fs.unlinkSync(wsFile); } catch {}
    try { fs.rmSync(observerRoot, { recursive: true, force: true }); } catch {}
  });

  const fakeCfg = (kind = 'opencode') => ({ agent: { workspace: '/ws', kind } });
  const fakeTui = async () => ({
    serverUrl: 'http://127.0.0.1:4096',
    serverPid: 123,
    opencodeSessionId: 'ses_test',
    command: "'opencode' attach 'http://127.0.0.1:4096' --dir '/ws' --session 'ses_test'",
  });
  const fakeApi = (sent) => ({ sendMessage: async (chatId, text) => { sent.push(text); return {}; } });
  const fakeTxTmux = (initial = {}) => {
    const sessions = new Map(Object.entries(initial).map(([name, windows]) => [name, new Set(windows)]));
    const panes = new Map();
    const calls = [];
    let nextPane = 1;
    const targetKey = (target) => String(target).replace(/:$/, '');
    const addPane = (target, command) => {
      const id = `%${nextPane++}`;
      panes.set(`${targetKey(target)}\t${id}`, { target: targetKey(target), id, command });
      return id;
    };
    const run = (args) => {
      calls.push(args);
      if (args[0] === 'has-session') return sessions.has(args[2]);
      if (args[0] === 'list-windows') return [...(sessions.get(args[2]) || [])].join('\n');
      if (args[0] === 'new-session') {
        const session = args[3];
        sessions.set(session, new Set([args[5]]));
        addPane(`${session}:${args[5]}`, args.at(-1));
        return true;
      }
      if (args[0] === 'new-window') {
        const session = args[3].replace(/:$/, '');
        const windows = sessions.get(session) || new Set();
        windows.add(args[5]);
        sessions.set(session, windows);
        addPane(`${session}:${args[5]}`, args.at(-1));
        return true;
      }
      if (args[0] === 'list-panes') {
        return [...panes.values()].filter((pane) => pane.target === targetKey(args[2])).map((pane) => `${pane.id}\t${pane.command}`).join('\n');
      }
      if (args[0] === 'split-window') return addPane(args[3], args.at(-1));
      if (args[0] === 'select-pane' || args[0] === 'kill-pane') {
        if (args[0] === 'kill-pane') {
          const entry = [...panes.entries()].find(([, pane]) => pane.id === args[2]);
          if (entry) panes.delete(entry[0]);
        }
        return true;
      }
      return false;
    };
    for (const [session, windows] of sessions) {
      for (const window of windows) addPane(`${session}:${window}`, 'bash');
    }
    return { calls, run, sessions, panes };
  };

  it('/tx on creates and reports the exact workstream target', async () => {
    const { handleTxCommand } = await import('../scripts/bot-host.mjs');
    const sent = [];
    const tmux = fakeTxTmux();
    await handleTxCommand({ api: fakeApi(sent), config: fakeCfg(), chatId: 9, arg: 'on', tmux: tmux.run, ensureTui: fakeTui });
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('ON');
    expect(sent[0]).toMatch(/tmux attach -t work-view:ws-/);
    expect(sent[0]).toContain('9|/ws');
    expect(sent[0]).not.toContain('testbox|9|');
    expect(tmux.calls.map((args) => args[0])).toEqual(['has-session', 'new-session', 'has-session', 'list-windows', 'list-panes', 'select-pane', 'list-panes', 'list-panes']);
    expect(tmux.calls.flat().some((arg) => /kill|respawn|send-keys/.test(String(arg)))).toBe(false);
  });

  it('/tx on migrates a legacy blank workstream window and removes its extra pane', async () => {
    const { handleTxCommand } = await import('../scripts/bot-host.mjs');
    const sent = [];
    const legacyWindow = tmuxWindowFor(sessionKey({ location: 'testbox', chat: '9', workspace: '/ws' }));
    const tmux = fakeTxTmux({ 'work-view': [legacyWindow] });
    await handleTxCommand({ api: fakeApi(sent), config: fakeCfg(), chatId: 9, arg: 'on', tmux: tmux.run, ensureTui: fakeTui });
    expect(tmux.sessions.get('work-view')).toEqual(new Set([legacyWindow]));
    expect(tmux.calls.map((args) => args[0])).toContain('split-window');
    expect(tmux.calls.map((args) => args[0])).toContain('kill-pane');
    expect(tmux.calls.flat().some((arg) => /kill-window|kill-session|respawn-pane|send-keys/.test(String(arg)))).toBe(false);
  });

  it('/tx off disables without stopping', async () => {
    const { handleTxCommand } = await import('../scripts/bot-host.mjs');
    const sent = [];
    const tmux = fakeTxTmux();
    await handleTxCommand({ api: fakeApi(sent), config: fakeCfg(), chatId: 9, arg: 'on', tmux: tmux.run, ensureTui: fakeTui });
    await handleTxCommand({ api: fakeApi(sent), config: fakeCfg(), chatId: 9, arg: 'off', tmux: tmux.run });
    expect(sent[1]).toContain('OFF');
    expect(tmux.sessions.get('work-view').size).toBe(1);
  });

  it('/tx status reports without creating a session', async () => {
    const { handleTxCommand } = await import('../scripts/bot-host.mjs');
    const sent = [];
    const tmux = fakeTxTmux();
    await handleTxCommand({ api: fakeApi(sent), config: fakeCfg(), chatId: 9, arg: '', tmux: tmux.run });
    expect(sent[0]).toContain('No work session');
    expect(tmux.calls).toEqual([]);
  });

  it('/tx on reports no tmux target for an API-only lane', async () => {
    const { handleTxCommand } = await import('../scripts/bot-host.mjs');
    const sent = [];
    const tmux = fakeTxTmux();
    await handleTxCommand({ api: fakeApi(sent), config: fakeCfg('gemini'), chatId: 9, arg: 'on', tmux: tmux.run, ensureTui: fakeTui });
    expect(sent[0]).toContain('ON');
    expect(sent[0]).toContain('Live attach: unavailable');
    expect(sent[0]).not.toContain('tmux attach');
    expect(tmux.calls).toEqual([]);
  });

  it('/tx usage on unknown subcommand', async () => {
    const { handleTxCommand } = await import('../scripts/bot-host.mjs');
    const sent = [];
    const tmux = fakeTxTmux();
    await handleTxCommand({ api: fakeApi(sent), config: fakeCfg(), chatId: 9, arg: 'nope', tmux: tmux.run });
    expect(sent[0]).toContain('Usage: /tx on|off|status|debug|help');
    expect(tmux.calls).toEqual([]);
  });
});

describe('provider switching (opencode <-> cline)', () => {
  it('labels the provider from the effective model surface', async () => {
    const { providerLabelForModel } = await import('../scripts/bot-host.mjs');
    expect(providerLabelForModel('cline:cline-free/muse-spark-1.3-contributor')).toBe('Cline');
    expect(providerLabelForModel('gemini:gemini/gemini-3.5-flash-lite')).toBe('Gemini');
    expect(providerLabelForModel('opencode/nemotron-3.5-lightning-free')).toBe('OpenCode');
    expect(providerLabelForModel('nemotron-3.5-lightning-free')).toBe('OpenCode');
  });

  it('fails over from a quota-hit cline lane to the opencode fallback', async () => {
    const { runOpencodeWithFailover } = await import('../scripts/bot-host.mjs');
    const seen = [];
    const runModel = (model) => {
      seen.push(model);
      if (String(model).startsWith('cline:')) {
        return Promise.resolve({
          code: 1, sessionID: null, finalText: '',
          lastError: 'Error 429: Daily free limit reached on model meta/muse-spark-1.3-contributor. Try again in 22h 46m',
          stderr: '', usage: { cost: 0, tokens: null },
        });
      }
      return Promise.resolve({
        code: 0, sessionID: null, finalText: 'ok', lastError: null, stderr: '', usage: { cost: 0, tokens: null },
      });
    };
    const sent = [];
    const result = await runOpencodeWithFailover({
      api: { sendMessage: async (chatId, text) => { sent.push(text); return {}; } },
      chatId: 9,
      prompt: 'Reply with exactly: ok',
      models: ['cline:cline-free/muse-spark-1.3-contributor', 'opencode/space-bunny-free'],
      runModel,
    });
    expect(seen).toEqual(['cline:cline-free/muse-spark-1.3-contributor', 'opencode/space-bunny-free']);
    expect(result.finalText).toBe('ok');
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatch(/switching to/);
    expect(sent[0]).toMatch(/free limit/);
    expect(sent[0]).not.toMatch(/[{}]/);
  });

  it('never auto-retries a cline timeout onto the next lane', async () => {
    const { runOpencodeWithFailover } = await import('../scripts/bot-host.mjs');
    const seen = [];
    const result = await runOpencodeWithFailover({
      api: { sendMessage: async () => ({}) },
      chatId: 9,
      prompt: 'x',
      models: ['cline:cline-free/muse-spark-1.3-contributor', 'opencode/space-bunny-free'],
      runModel: (model) => {
        seen.push(model);
        return Promise.resolve({
          code: 1, sessionID: null, finalText: '', lastError: 'timed out after 120000ms', stderr: '', usage: {},
        });
      },
    });
    expect(seen).toEqual(['cline:cline-free/muse-spark-1.3-contributor']);
    expect(result.finalText).toBe('');
  });

  it('summarizes a cline daily-cap failure without raw JSON', async () => {
    const { formatProviderFailure } = await import('../scripts/bot-host.mjs');
    const out = formatProviderFailure({
      surface: 'cline',
      model: 'cline:cline-free/muse-spark-1.3-contributor',
      lastError: 'Error 429: Daily free limit reached on model meta/muse-spark-1.3-contributor. Try again in 22h 46m',
      stderr: '{"ts":"2026-09-25T12:29:04.094Z","type":"error","message":"Daily free model limit reached"}',
    });
    expect(out.message).toMatch(/daily free limit/i);
    expect(out.message).toMatch(/22h/);
    expect(out.message).not.toMatch(/[{}]/);
    expect(out.stderr).toBe('');
  });
});

describe('provider-switch tx reconcile', () => {
  const OLD_WS = process.env.WORK_SESSIONS;
  const OLD_LOC = process.env.BOT_LOCATION;
  const OLD_OBSERVERS = process.env.WORK_OBSERVERS;
  let wsFile;
  let observerRoot;
  beforeEach(() => {
    wsFile = `${os.tmpdir()}/switch_tx_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
    observerRoot = `${os.tmpdir()}/switch_tx_obs_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    process.env.WORK_SESSIONS = wsFile;
    process.env.WORK_OBSERVERS = observerRoot;
    process.env.BOT_LOCATION = 'switchbox';
  });
  afterEach(() => {
    if (OLD_WS === undefined) delete process.env.WORK_SESSIONS;
    else process.env.WORK_SESSIONS = OLD_WS;
    if (OLD_LOC === undefined) delete process.env.BOT_LOCATION;
    else process.env.BOT_LOCATION = OLD_LOC;
    if (OLD_OBSERVERS === undefined) delete process.env.WORK_OBSERVERS;
    else process.env.WORK_OBSERVERS = OLD_OBSERVERS;
    try { fs.unlinkSync(wsFile); } catch {}
    try { fs.rmSync(observerRoot, { recursive: true, force: true }); } catch {}
  });

  const TUI_CMD = "'opencode' attach 'http://127.0.0.1:4096' --dir '/ws' --session 'ses_test'";
  const fakeSwitchTmux = (initialPanes = []) => {
    const calls = [];
    const panes = new Map(initialPanes.map((p, i) => [`%${i + 1}`, p]));
    const windows = new Set(['ws-switchbox-1']);
    let next = initialPanes.length + 1;
    const run = (args) => {
      calls.push(args);
      if (args[0] === 'has-session') return true;
      if (args[0] === 'list-windows') return [...windows].join('\n');
      if (args[0] === 'new-window') {
        windows.add(args[5]);
        const id = `%${next++}`;
        panes.set(id, args.at(-1));
        return true;
      }
      if (args[0] === 'list-panes') {
        return [...panes.entries()].map(([id, command]) => `${id}\t${command}`).join('\n');
      }
      if (args[0] === 'split-window') {
        const id = `%${next++}`;
        panes.set(id, args.at(-1));
        return id;
      }
      if (args[0] === 'select-pane') return true;
      if (args[0] === 'kill-pane') return panes.delete(args[2]);
      return false;
    };
    return { calls, panes, run };
  };

  it('drops a stale opencode TUI pane when the lane moves to cline', async () => {
    const { reconcileWorkViewForLane } = await import('../scripts/bot-host.mjs');
    const { resolveSession, setWorkView, getSession } = await import('../scripts/lib/work-session.mjs');
    const session = resolveSession({ location: 'switchbox', chat: '9', workspace: '/ws', lane: 'opencode' });
    setWorkView(session.id, { tx: true, viewMode: 'tui', viewCommand: TUI_CMD });
    const tmux = fakeSwitchTmux([TUI_CMD]);
    const updated = await reconcileWorkViewForLane({ session: getSession(session.id), lane: 'cline', workspace: '/ws', tmux: tmux.run });
    expect(updated.viewMode).toBe('observer');
    expect(updated.viewCommand).toBeNull();
    expect(tmux.calls.some((args) => args[0] === 'kill-pane')).toBe(true);
    expect(tmux.panes.size).toBe(1);
  });

  it('recreates the opencode TUI view when the lane moves back', async () => {
    const { reconcileWorkViewForLane } = await import('../scripts/bot-host.mjs');
    const { resolveSession, setWorkView, getSession } = await import('../scripts/lib/work-session.mjs');
    const session = resolveSession({ location: 'switchbox', chat: '9', workspace: '/ws', lane: 'cline' });
    setWorkView(session.id, { tx: true, viewMode: 'observer', viewCommand: null });
    const tmux = fakeSwitchTmux();
    const tuiCommand = "'opencode' attach 'http://127.0.0.1:4100' --dir '/ws' --session 'ses_back'";
    const updated = await reconcileWorkViewForLane({
      session: getSession(session.id),
      lane: 'opencode',
      workspace: '/ws',
      tmux: tmux.run,
      ensureTui: async () => ({
        serverUrl: 'http://127.0.0.1:4100', serverPid: 4242, opencodeSessionId: 'ses_back', command: tuiCommand,
      }),
    });
    expect(updated.viewMode).toBe('tui');
    expect(updated.viewCommand).toBe(tuiCommand);
    expect(updated.opencodeSessionId).toBe('ses_back');
  });
});

describe('ledger depletion visibility (stamped routes)', () => {
  it('shows a stamped route as depleted even with no table lane row', async () => {
    const { isFreemodelEntryDepleted, annotateFreemodelEntries } = await import('../scripts/lib/free-lanes.mjs');
    const now = Date.now();
    const table = { lanes: [] };
    const session = {
      quota: {
        'cline/cline-free/muse-spark-1.3-contributor': {
          depletedUntil: now + 22 * 3600 * 1000,
          lastError: 'Error 429: Daily free limit reached',
          scope: 'per-model',
          depletedObservedAt: new Date(now).toISOString(),
        },
      },
    };
    const entry = { ref: 'cline:cline-free/muse-spark-1.3-contributor', label: 'x', selectable: true };
    expect(isFreemodelEntryDepleted(entry, table, session, { now })).toBe(true);
    const [annotated] = annotateFreemodelEntries([entry], table, session, { now });
    expect(annotated.depleted).toBe(true);
    expect(annotated.resetIn).toMatch(/22h/);
  });

  it('ignores expired or doc-noise stamps on table-less routes', async () => {
    const { isFreemodelEntryDepleted } = await import('../scripts/lib/free-lanes.mjs');
    const now = Date.now();
    const table = { lanes: [] };
    const entry = { ref: 'cline:cline-free/muse-spark-1.3-contributor', selectable: true };
    expect(isFreemodelEntryDepleted(entry, table, {
      quota: { 'cline/cline-free/muse-spark-1.3-contributor': { depletedUntil: now - 1000, lastError: '429' } },
    }, { now })).toBe(false);
    expect(isFreemodelEntryDepleted(entry, table, {
      quota: { 'cline/cline-free/muse-spark-1.3-contributor': { depletedUntil: now + 3600000, lastError: '| Tool | Installed |\n|---|---|\nlimit depleted' } },
    }, { now })).toBe(false);
    expect(isFreemodelEntryDepleted(entry, table, { quota: {} }, { now })).toBe(false);
  });

  it('carries the vendor retry countdown into the stamp', async () => {
    const { trackRunQuota } = await import('../scripts/bot-host.mjs');
    const OLD_HOME = process.env.HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-home-'));
    process.env.HOME = home;
    try {
      const stamped = trackRunQuota({
        botId: 'probe-bot',
        modelRef: 'cline:cline-free/muse-spark-1.3-contributor',
        result: {
          finalText: '',
          lastError: 'Error 429: Daily free limit reached on model meta/muse-spark-1.3-contributor. Try again in 22h 26m',
          stderr: '',
        },
      });
      expect(stamped?.stamped).toBe(true);
      const session = JSON.parse(fs.readFileSync(
        path.join(home, '.local', 'state', 'bot-host', 'probe-bot', 'free-lanes', 'session.json'), 'utf8'));
      const rec = session.quota['cline/cline-free/muse-spark-1.3-contributor'];
      expect(rec.countdownHint).toMatch(/22h/);
      expect(rec.depletedUntil - Date.now()).toBeGreaterThan(20 * 3600 * 1000);
    } finally {
      process.env.HOME = OLD_HOME;
      try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    }
  });
});


/* ---------------------------------------------------------------- B2B-1 ---
 * Bot-to-bot ingress. The contract under test is the classification, because
 * the whole loop defence on the receive side is "a bot-sourced update files a
 * proposal and never becomes a turn". Anything less than three outcomes here is
 * a fleet-wide loop waiting for a misread message.
 */
describe('B2B-1 bot-to-bot ingress classification', () => {
  const PEERS = { vm3: { pm: { maxDepth: 2, cooldownMs: 60_000, ttlMs: 1_800_000 } } };
  let stateRoot: string;
  const OLD_HOME = process.env.HOME;

  const envelopeText = (over: Record<string, string> = {}) => {
    const head = [
      '[b2b v1]',
      `kind=${over.kind === undefined ? 'ask' : over.kind}`,
      `ref=${over.ref === undefined ? 'spec:fleet-current-tab' : over.ref}`,
      `depth=${over.depth || '1'}`,
      `from=${over.from || 'vm3'}`,
      `to=${over.to || 'pm'}`,
      `expires=${new Date(Date.now() + 1_800_000).toISOString()}`,
      `id=${over.id === undefined ? 'msg00001' : over.id}`,
      `reply_to=${over.reply_to || '-'}`,
    ].join(' ');
    return `${head}\n${over.body || 'the current tab has no card rows — is D1 the source or the sheet?'}`;
  };

  const message = (over: Record<string, unknown> = {}) => ({
    from: { id: 777000, is_bot: true, username: 'ht_vm3_bot', ...(over.from || {}) },
    chat: { id: 6218257274 },
    text: envelopeText(over.envelope || {}),
  });

  beforeEach(() => {
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b2b-ingress-'));
    fs.mkdirSync(path.join(stateRoot, 'vm3'), { recursive: true });
    fs.writeFileSync(
      path.join(stateRoot, 'vm3', 'identity.json'),
      JSON.stringify({ id: 'vm3', username: 'ht_vm3_bot', telegramId: 777000 }),
    );
  });

  afterEach(() => {
    try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch {}
  });

  it('passes a human update straight through, untouched by the policy', () => {
    const v = classifyInboundSender({
      message: { from: { id: 6218257274, is_bot: false }, chat: { id: 1 }, text: 'hi' },
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(v.kind).toBe('human');
  });

  it('never treats an update with no sender id as anything but unknown', () => {
    const v = classifyInboundSender({ message: { chat: { id: 1 }, text: 'x' }, stateDirPath: stateRoot, self: 'pm' });
    expect(v.kind).toBe('unknown');
  });

  it('refuses a bot sender by default, before any peers lookup', () => {
    const v = classifyInboundSender({ message: message(), stateDirPath: stateRoot, self: 'pm' });
    expect(v.kind).toBe('bot-refused');
    expect(v.code).toBe('POLICY_HUMANS_ONLY');
  });

  it('refuses a bot that no seat has claimed, even with the policy on', () => {
    const v = classifyInboundSender({
      message: message({ from: { username: 'stranger_bot' } }),
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(v.kind).toBe('bot-refused');
    expect(v.code).toBe('SENDER_UNKNOWN_SEAT');
  });

  it('refuses a claimed bot that has no peers edge to this seat', () => {
    const v = classifyInboundSender({
      message: message(),
      stateDirPath: stateRoot,
      self: 'vm4',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(v.kind).toBe('bot-refused');
    expect(v.code).toBe('PEER_NOT_ALLOWED');
  });

  it('accepts an allowlisted, in-bounds envelope as a handoff — not a turn', () => {
    const v = classifyInboundSender({
      message: message(),
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(v.kind).toBe('bot-handoff');
    expect(v.seat).toBe('vm3');
    expect(v.envelope.kind).toBe('ask');
    expect(v.envelope.ref).toBe('spec:fleet-current-tab');
    // The classification carries no turn handle at all: there is nothing for a
    // caller to dispatch, which is the point.
    expect(Object.keys(v)).not.toContain('run');
    expect(v.ledger.seen['in:msg00001']).toBeGreaterThan(0);
  });

  it('refuses an envelope addressed to another seat', () => {
    const v = classifyInboundSender({
      message: message({ envelope: { to: 'vm4' } }),
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(v.kind).toBe('bot-refused');
    expect(v.code).toBe('TARGET_UNKNOWN');
  });

  it('refuses an envelope whose from= lies about the sender', () => {
    const v = classifyInboundSender({
      message: message({ envelope: { from: 'vm4' } }),
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(v.kind).toBe('bot-refused');
    expect(v.code).toBe('FROM_MISMATCH');
  });

  it('refuses plain text from a bot, and a bot handoff with no ref', () => {
    const plain = classifyInboundSender({
      message: { from: { id: 777000, is_bot: true, username: 'ht_vm3_bot' }, chat: { id: 1 }, text: 'hello there' },
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(plain.code).toBe('BAD_HEADER');
    const noRef = classifyInboundSender({
      message: message({ envelope: { ref: '' } }),
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(noRef.code).toBe('NO_REF'); // a well-formed header with no tracked work behind it
  });

  it('receives the same message id once: the second is a duplicate', () => {
    const first = classifyInboundSender({
      message: message(),
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(first.kind).toBe('bot-handoff');
    const replay = classifyInboundSender({
      message: message(),
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
      ledger: first.ledger,
    });
    expect(replay.kind).toBe('bot-refused');
    expect(replay.code).toBe('DUPLICATE');
  });

  it('refuses an expired question rather than acting on stale intent', () => {
    const stale = {
      from: { id: 777000, is_bot: true, username: 'ht_vm3_bot' },
      chat: { id: 1 },
      text: `[b2b v1] kind=ask ref=spec:x depth=1 from=vm3 to=pm expires=${new Date(Date.now() - 1000).toISOString()} id=old00001 reply_to=-\ntoo late`,
    };
    const v = classifyInboundSender({
      message: stale,
      stateDirPath: stateRoot,
      self: 'pm',
      policy: 'humans-and-allowlisted-bots',
      peers: PEERS,
    });
    expect(v.kind).toBe('bot-refused');
    expect(v.code).toBe('EXPIRED');
  });
});

/* --------------------------------------------------------------- B2B-1 /tell ---
 * The send side is refusal-first. These cases never touch the network: each one
 * asserts that a refusal returned text and sent nothing, because a bound that
 * fires *after* the send is not a bound.
 */
describe('B2B-1 /tell send path', () => {
  const PEERS = { vm3: { pm: { maxDepth: 2, cooldownMs: 60_000, ttlMs: 1_800_000 } } };
  let stateRoot: string;

  const OLD_DL = process.env.TG_DEAD_LETTER_DIR;

  beforeEach(() => {
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b2b-tell-'));
    // Dead letters go to the throwaway dir: a sensor must never write into the
    // repo, and the production path keeps its documented location.
    process.env.TG_DEAD_LETTER_DIR = path.join(stateRoot, 'dead-letter');
    fs.mkdirSync(path.join(stateRoot, 'pm'), { recursive: true });
    fs.writeFileSync(
      path.join(stateRoot, 'pm', 'identity.json'),
      JSON.stringify({ id: 'pm', username: 'ht_pm_bot', telegramId: 555 }),
    );
    fs.mkdirSync(path.join(stateRoot, 'vm3'), { recursive: true });
  });

  afterEach(() => {
    if (OLD_DL === undefined) delete process.env.TG_DEAD_LETTER_DIR;
    else process.env.TG_DEAD_LETTER_DIR = OLD_DL;
    try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch {}
  });

  const config = { id: 'vm3' } as never;
  const ON = 'humans-and-allowlisted-bots';
  let calls: Array<Record<string, unknown>> = [];
  const fakeApi = { call: async (_m: string, payload: Record<string, unknown>) => { calls.push(payload); return { message_id: 4242 }; } };

  beforeEach(() => { calls = []; });

  it('refuses without a --ref and sends nothing', async () => {
    const v = await sendPeerHandoff({ config, args: 'pm hello there', api: fakeApi, stateDirPath: stateRoot, policy: ON, peers: PEERS });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('NO_REF');
    expect(calls).toHaveLength(0);
  });

  it('refuses malformed usage and sends nothing', async () => {
    const v = await sendPeerHandoff({ config, args: 'pm', api: fakeApi, stateDirPath: stateRoot, policy: ON, peers: PEERS });
    expect(v.code).toBe('BAD_ARGS');
    expect(calls).toHaveLength(0);
  });

  it('refuses an unlisted target and names the addressable peers', async () => {
    const v = await sendPeerHandoff({ config, args: 'vm4 take this --ref Sheet-03', api: fakeApi, stateDirPath: stateRoot, policy: ON, peers: PEERS });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('PEER_NOT_ALLOWED');
    expect(v.text).toContain('pm');
    expect(calls).toHaveLength(0);
  });

  it('refuses when the policy is humans-only, even for a listed peer', async () => {
    const v = await sendPeerHandoff({ config, args: 'pm hello --ref Sheet-03', api: fakeApi, stateDirPath: stateRoot, policy: 'humans-only', peers: PEERS });
    expect(v.code).toBe('POLICY_HUMANS_ONLY');
    expect(calls).toHaveLength(0);
  });

  it('refuses a target with no identity file rather than guessing a username', async () => {
    const v = await sendPeerHandoff({ config, args: 'ghost hello --ref Sheet-03', api: fakeApi, stateDirPath: stateRoot, policy: ON, peers: { vm3: { ghost: {} } } });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('PEER_NO_IDENTITY_CACHE');
    expect(calls).toHaveLength(0);
  });

  it('sends one addressed envelope to the resolved @username and reports the depth', async () => {
    const v = await sendPeerHandoff({
      config,
      args: 'pm "the current tab has no card rows" --ref spec:fleet-current-tab',
      api: fakeApi,
      stateDirPath: stateRoot,
      policy: ON,
      peers: PEERS,
    });
    expect(v.ok).toBe(true);
    expect(v.messageId).toBe(4242);
    expect(calls).toHaveLength(1);
    expect(calls[0].chat_id).toBe('@ht_pm_bot');
    expect(String(calls[0].text)).toContain('[b2b v1] kind=ask ref=spec:fleet-current-tab depth=1 from=vm3 to=pm');
    expect(String(calls[0].text)).not.toContain('--ref');
  });

  it('a second send inside the cooldown is refused before the network', async () => {
    const args = 'pm hello --ref Sheet-03';
    const first = await sendPeerHandoff({ config, args, api: fakeApi, stateDirPath: stateRoot, policy: ON, peers: PEERS });
    expect(first.ok).toBe(true);
    calls = [];
    const second = await sendPeerHandoff({ config, args: 'pm again --ref Sheet-03', api: fakeApi, stateDirPath: stateRoot, policy: ON, peers: PEERS });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('COOLDOWN');
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------- B2B-1 inbox naming ---
 * A proposal filed where nobody looks is the same as no proposal. The duty
 * tells agents to read inbox-<location>.md and every sweep reads
 * ~/.agents/location, so the writer must use the machine's own name — not
 * workLocation(), which answers "which compute pool" and says `vps` here.
 */
describe('B2B-1 machine location naming', () => {
  const OLD_MACHINE = process.env.BOT_MACHINE;
  afterEach(() => {
    if (OLD_MACHINE === undefined) delete process.env.BOT_MACHINE;
    else process.env.BOT_MACHINE = OLD_MACHINE;
  });

  it('prefers ~/.agents/location over the compute pool', () => {
    expect(machineLocation()).toBe('vps-france');
  });

  it('BOT_MACHINE overrides, for tests and for a box with no location file', () => {
    process.env.BOT_MACHINE = 'somewhere-else';
    expect(machineLocation()).toBe('somewhere-else');
  });

  it('the file really is the one the sweeps read', () => {
    const declared = fs.readFileSync(path.join(os.homedir(), '.agents', 'location'), 'utf8').trim().split(/\s+/)[0];
    expect(machineLocation()).toBe(declared);
    expect(declared).not.toBe('vps'); // the pool name is the bug this test pins
  });
});

/* --------------------------------------------------- B2B-1 notify default ---
 * The send is LOUD unless TG_B2B_NOTIFY=0. It shipped silent, which made a
 * working channel indistinguishable from a broken one — three hops went past
 * unseen. The cooldown and the global budget are what stop this being spam,
 * not the mute.
 */
describe('B2B-1 handoff notifications', () => {
  const OLD = process.env.TG_B2B_NOTIFY;
  let stateRoot: string;
  let calls: Array<Record<string, unknown>>;
  const api = { call: async (_m: string, p: Record<string, unknown>) => { calls.push(p); return { message_id: 99 }; } };

  beforeEach(() => {
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b2b-notify-'));
    fs.mkdirSync(path.join(stateRoot, 'pm'), { recursive: true });
    // the sender's own ledger directory, or the send refuses with LEDGER_WRITE
    // — it will not put a message on the wire it cannot record
    fs.mkdirSync(path.join(stateRoot, 'vm3'), { recursive: true });
    fs.writeFileSync(
      path.join(stateRoot, 'pm', 'identity.json'),
      JSON.stringify({ id: 'pm', username: 'ht_pm_bot', telegramId: 7 }),
    );
    process.env.TG_DEAD_LETTER_DIR = path.join(stateRoot, 'dl');
    calls = [];
  });

  afterEach(() => {
    if (OLD === undefined) delete process.env.TG_B2B_NOTIFY;
    else process.env.TG_B2B_NOTIFY = OLD;
    try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch {}
  });

  it('notifies by default — silence made a working channel look broken', async () => {
    delete process.env.TG_B2B_NOTIFY;
    const v = await sendPeerHandoff({
      config: { id: 'vm3' } as never,
      args: 'pm hello --ref Sheet-03',
      api: api as never,
      stateDirPath: stateRoot,
      policy: 'humans-and-allowlisted-bots',
      peers: { vm3: { pm: {} } },
    });
    expect(v.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].disable_notification).toBe('false');
  });

  it('TG_B2B_NOTIFY=0 goes back to silent without a deploy', async () => {
    process.env.TG_B2B_NOTIFY = '0';
    const v = await sendPeerHandoff({
      config: { id: 'vm3' } as never,
      args: 'pm hello again --ref Sheet-04',
      api: api as never,
      stateDirPath: stateRoot,
      policy: 'humans-and-allowlisted-bots',
      peers: { vm3: { pm: {} } },
    });
    expect(v.ok).toBe(true);
    expect(calls[0].disable_notification).toBe('true');
  });
});
