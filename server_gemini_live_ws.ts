// server_gemini_live_ws.ts — VOICE-LIVE-1 Phase 1: server WebSocket relay.
//
// Browser (WSS) <---> Express relay (/api/gemini/live-ws) <---> Google AI
// Studio Live API (BidiGenerateContent, via @google/genai `ai.live.connect`).
//
// Why a relay instead of a direct browser connection: the Gemini API key must
// never ship to the browser. The relay authenticates the session, injects the
// user profile / language / recent meals into the Live system instruction,
// and shuffles raw 16kHz PCM chunks up / 24kHz PCM chunks down without ever
// touching the REST TTS endpoint (10 RPD — strictly banned for voice).
//
// Wire protocol (JSON text frames, browser <---> relay):
//   browser -> relay  { type: 'setup', profile?, language?, voice?, recentMeals? }
//   browser -> relay  { type: 'audio', data: '<base64 PCM16 mono 16kHz>' }
//   browser -> relay  { type: 'text', text: '...' }            (typed fallback)
//   browser -> relay  { type: 'toolResponse', id?, name?, response? }
//                     { type: 'toolResponse', functionResponses: [...] }
//   browser -> relay  { type: 'end' }
//   relay -> browser  { type: 'ready', model, voice }
//   relay -> browser  { type: 'audio', data: '<base64 PCM>', mimeType }
//   relay -> browser  { type: 'inputTranscription' | 'outputTranscription', text }
//   relay -> browser  { type: 'text', text }
//   relay -> browser  { type: 'turnComplete' } | { type: 'interrupted' }
//   relay -> browser  { type: 'toolCall', functionCalls: [...] }
//   relay -> browser  { type: 'error', message } | { type: 'idleTimeout' }
//
// Lifecycle: ephemeral micro-sessions. The client owns the 45s-silence
// disconnect; the relay enforces backstops (idle + absolute max) so token
// burn stays far under the 65K TPM live quota.
//
// Trace telemetry: every session gets a short id and emits single-line
// `[GeminiLiveWS:trace]` JSON events (setup, ready, first audio in/out,
// turn summaries, client marks, close). Audio bytes are NEVER logged.
// Tail with: journalctl -u health-tracker -f | grep 'GeminiLiveWS:trace'

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { GoogleGenAI, Modality, StartSensitivity } from '@google/genai';
import type { LiveServerMessage, Session } from '@google/genai';
import { cleanEnvValue, firstEnvValue } from './src/utils/envKey.js';

// The production bundle is CJS (esbuild --format=cjs), where import.meta.url
// is undefined — so never base createRequire on import.meta. A package.json
// path works in both tsx dev (ESM) and the bundled CJS server.
function loadWsServerCtor(): any {
  const g = globalThis as any;
  try {
    if (typeof g.require === 'function') return g.require('ws').WebSocketServer;
  } catch { /* fall through to createRequire */ }
  return createRequire(`${process.cwd()}/package.json`)('ws').WebSocketServer;
}

export const LIVE_WS_PATH = '/api/gemini/live-ws';
// Primary engine (best clinical reasoning + natural voice); safety failover
// carries a 1M TPM cushion if a session ever runs long.
export const PRIMARY_LIVE_MODEL = 'gemini-3.8-live';
export const FALLBACK_LIVE_MODEL = 'gemini-2.5-flash-native-audio';
export const LIVE_INPUT_SAMPLE_RATE = 16000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24000;

export type LiveVoicePersona = 'Aoede' | 'Charon' | 'Kore';
const VALID_VOICES: LiveVoicePersona[] = ['Aoede', 'Charon', 'Kore'];
const DEFAULT_VOICE: LiveVoicePersona = 'Aoede';

// Client owns the 45s-silence disconnect (Phase 2); these are server
// backstops so an abandoned tab can never burn tokens all day.
const SETUP_TIMEOUT_MS = 10 * 1000;
const IDLE_CLOSE_MS = 120 * 1000;
const MAX_SESSION_MS = 10 * 60 * 1000;
const MAX_CLIENT_MESSAGE_BYTES = 2 * 1024 * 1024;

// Minimal socket surface so this file compiles without @types/ws
// (ws arrives transitively via @google/genai; never add it to the browser).
interface RelaySocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

function getLiveApiKey(): string {
  const multi = (process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map((k) => cleanEnvValue(k))
    .find((k) => k) || '';
  return firstEnvValue(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'API_KEY']) || multi;
}

export function normalizeLiveVoice(input: unknown): LiveVoicePersona {
  return typeof input === 'string' &&
    (VALID_VOICES as string[]).includes(input)
    ? (input as LiveVoicePersona)
    : DEFAULT_VOICE;
}

export function normalizeLiveLanguage(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const code = input.trim().slice(0, 12);
  return /^[A-Za-z]{2}(-[A-Za-z]{2,4})?$/.test(code) ? code : undefined;
}

export function buildLiveSystemInstruction(opts: {
  profile?: any;
  language?: string;
  recentMeals?: any[];
}): string {
  const language = typeof opts.language === 'string' && opts.language
    ? opts.language
    : (opts.profile?.language || 'en');
  let profileJson = '{}';
  try {
    profileJson = JSON.stringify(opts.profile || {}).slice(0, 1500);
  } catch { /* keep {} */ }
  let mealsJson = '[]';
  try {
    const meals = Array.isArray(opts.recentMeals) ? opts.recentMeals.slice(0, 5) : [];
    mealsJson = JSON.stringify(meals).slice(0, 1500);
  } catch { /* keep [] */ }
  return [
    'You are the Health Tracker voice receptionist: a warm, concise spoken assistant.',
    `Reply in the user's language (${language}). Keep spoken replies to 1-3 short sentences unless asked for detail.`,
    'You hear the user via speech recognition — you are accurate on medical biomarkers (HbA1c, ApoB, triglycerides, blood pressure) and food terms with weights (e.g. "150g tempeh").',
    'Use tools instead of asking twice: update_profile when the user states age, gender, height, weight, or goals; navigate_tab to move them around the app; handoff_specialist to route clinical or meal-analysis work; log_meal to capture a food they report.',
    `Known user profile: ${profileJson}`,
    `Recent meals: ${mealsJson}`,
  ].join('\n');
}

// Tool declarations the Live model may call mid-stream. The relay forwards
// toolCall frames to the browser, which executes them against app state
// (profile update, tab navigation) and returns toolResponse frames.
export function buildLiveTools(): any[] {
  return [
    {
      functionDeclarations: [
        {
          name: 'update_profile',
          description: 'Persist user-stated profile facts (age, gender, heightCm, weightKg, healthGoal, language, dietaryRestrictions).',
          parametersJsonSchema: {
            type: 'object',
            properties: {
              updates: {
                type: 'object',
                description: 'Profile fields to update, e.g. {"age": 32, "weightKg": 70}.',
              },
            },
            required: ['updates'],
          },
        },
        {
          name: 'navigate_tab',
          description: 'Move the user to an app tab after confirming (home, meals, biomarkers, coach).',
          parametersJsonSchema: {
            type: 'object',
            properties: {
              tab: { type: 'string', description: 'Target tab id.' },
            },
            required: ['tab'],
          },
        },
        {
          name: 'handoff_specialist',
          description: 'Hand the conversation to a specialist agent with context.',
          parametersJsonSchema: {
            type: 'object',
            properties: {
              specialist: { type: 'string', description: 'medical | meal | coach.' },
              context: { type: 'string', description: 'One-line handoff summary.' },
            },
            required: ['specialist'],
          },
        },
        {
          name: 'log_meal',
          description: 'Capture a food the user reports eating, with portion.',
          parametersJsonSchema: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Free-text meal description.' },
              items: {
                type: 'array',
                items: { type: 'string' },
                description: 'Individual items, e.g. ["150g tempeh", "1 bowl rice"].',
              },
            },
            required: ['description'],
          },
        },
      ],
    },
  ];
}

async function openLiveSession(args: {
  apiKey: string;
  model: string;
  voice: LiveVoicePersona;
  languageCode?: string;
  systemInstruction: string;
  onmessage: (msg: LiveServerMessage) => void;
  onerror: (err: any) => void;
  onclose: (ev: any) => void;
  onopen?: () => void;
}): Promise<Session> {
  const ai = new GoogleGenAI({
    apiKey: args.apiKey,
    httpOptions: {
      timeout: 150000,
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
  return ai.live.connect({
    model: args.model,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: args.voice } },
        ...(args.languageCode ? { languageCode: args.languageCode } : {}),
      },
      systemInstruction: args.systemInstruction,
      tools: buildLiveTools(),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Echo-barge guard: without client platform AEC the mic hears the
      // loudspeaker. LOW start sensitivity means muffled speaker bleed is
      // far less likely to be mistaken for the user cutting in (which used
      // to cancel playback every ~0.5s in an infinite chop loop), while
      // genuine close-mic speech still trips detection. End sensitivity
      // stays default so turn-taking latency is untouched.
      // NOTE (2026-10-19): proactivity.proactiveAudio was tried and reverted
      // the same night — the v1beta wire API rejects it at setup with
      // 1007 "Unknown name proactivity". The SDK types declare the field
      // but the server has no such field. Do NOT re-add without a wire
      // check. Echo containment rests on LOW start sensitivity + AEC +
      // the client energy gate.
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
        },
      },
    },
    callbacks: {
      onopen: args.onopen || null,
      onmessage: args.onmessage,
      onerror: args.onerror || null,
      onclose: args.onclose || null,
    },
  });
}

function safeSend(client: RelaySocket, payload: unknown): void {
  try {
    // ws.OPEN === 1; compare numerically so @types/ws stays unnecessary.
    if ((client as any).readyState === 1) {
      client.send(JSON.stringify(payload));
    }
  } catch { /* socket already gone */ }
}

async function handleLiveConnection(clientRaw: unknown): Promise<void> {
  const client = clientRaw as RelaySocket;
  const startedAt = Date.now();
  const sid = `lv_${startedAt.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const trace = (ev: string, extra?: Record<string, unknown>) => {
    try {
      console.log(`[GeminiLiveWS:trace] ${JSON.stringify({ sid, ev, t: Date.now() - startedAt, ...extra })}`);
    } catch { /* logging must never break the relay */ }
  };
  let lastActivity = Date.now();
  let closed = false;
  let session: Session | null = null;
  let liveModel = PRIMARY_LIVE_MODEL;
  let setupReceived = false;
  let liveCtx: { profile?: any; recentMeals?: any[] } = {};
  // Frames arriving during the Google handshake window (setup received,
  // session not yet open). Audio/text are buffered and flushed on ready so
  // the user's first syllable is never eaten; the buffer is tiny because
  // the handshake is ~100-200ms. Tool responses can't precede a tool call.
  const pendingInput: Array<{ kind: 'audio' | 'text'; data: string }> = [];
  const MAX_PENDING_INPUT = 32;
  const flushPendingInput = () => {
    if (!session || pendingInput.length === 0) return;
    const frames = pendingInput.splice(0);
    try {
      for (const f of frames) {
        if (f.kind === 'audio') {
          session.sendRealtimeInput({ audio: { data: f.data, mimeType: 'audio/pcm;rate=16000' } });
        } else {
          session.sendRealtimeInput({ text: f.data });
        }
      }
      trace('pending-input-flushed', { frames: frames.length });
    } catch (err) {
      console.warn('[GeminiLiveWS] pending flush failed:', (err as Error)?.message);
    }
  };
  // Latency anatomy per turn: lastInputAt = latest client->Google stamp
  // (audio frame or typed text); firstAudioOutAt set on the first Google
  // audio chunk after it.
  let lastInputAt = 0;
  let firstAudioOutAt = 0;
  let firstAudioInAt = 0;
  let audioInFrames = 0;
  let audioOutFrames = 0;
  let turnCount = 0;
  let toolCallCount = 0;
  let googleReadyAt = 0;
  trace('accepted');

  const cleanup = (code?: number, reason?: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(setupTimer);
    clearInterval(sweeper);
    try { session?.close(); } catch { /* already closed */ }
    session = null;
    trace('close', {
      reason, turns: turnCount, toolCalls: toolCallCount,
      audioInFrames, audioOutFrames, model: liveModel,
    });
    try {
      if ((client as any).readyState === 1) client.close(code || 1000, reason || 'bye');
    } catch { /* ignore */ }
  };

  const setupTimer = setTimeout(() => {
    if (!setupReceived && !closed) {
      safeSend(client, { type: 'error', message: 'Live voice setup timed out. Reopen the receptionist to retry.' });
      cleanup(1000, 'setup-timeout');
    }
  }, SETUP_TIMEOUT_MS);

  const sweeper = setInterval(() => {
    if (closed) return;
    const now = Date.now();
    if (now - startedAt > MAX_SESSION_MS) {
      safeSend(client, { type: 'error', message: 'Voice session reached its 10-minute limit. Start a fresh one to continue.' });
      cleanup(1000, 'max-session');
    } else if (now - lastActivity > IDLE_CLOSE_MS) {
      safeSend(client, { type: 'idleTimeout' });
      cleanup(1000, 'idle');
    }
  }, 15 * 1000);

  const forwardLiveMessage = (msg: LiveServerMessage) => {
    lastActivity = Date.now();
    try {
      const anyMsg = msg as any;
      const sc = anyMsg?.serverContent;
      if (!sc) {
        if (anyMsg?.toolCall?.functionCalls) {
          safeSend(client, { type: 'toolCall', functionCalls: anyMsg.toolCall.functionCalls });
        }
        if (anyMsg?.toolCallCancellation?.ids) {
          safeSend(client, { type: 'toolCallCancellation', ids: anyMsg.toolCallCancellation.ids });
        }
        if (anyMsg?.goAway?.timeLeft) {
          safeSend(client, { type: 'goAway', timeLeft: anyMsg.goAway.timeLeft });
        }
        return;
      }
      if (sc.interrupted) {
        trace('interrupted', {});
        safeSend(client, { type: 'interrupted' });
      }
      const inText = sc.inputTranscription?.text;
      if (typeof inText === 'string' && inText) {
        // Real user speech detected — stamp it so the next Google audio
        // chunk yields a true end-of-speech → first-audio latency. (Audio
        // frames stream continuously, so they must NOT stamp — that made
        // every TTFB read ~30ms.)
        lastInputAt = Date.now();
        firstAudioOutAt = 0;
        safeSend(client, { type: 'inputTranscription', text: inText });
      }
      const outText = sc.outputTranscription?.text;
      if (typeof outText === 'string' && outText) {
        safeSend(client, { type: 'outputTranscription', text: outText });
      }
      const parts = sc.modelTurn?.parts;
      if (Array.isArray(parts)) {
        let textAcc = '';
        for (const part of parts) {
          const inline = part?.inlineData;
          if (inline?.data && typeof inline.data === 'string' &&
            typeof inline.mimeType === 'string' && inline.mimeType.startsWith('audio/')) {
            if (!firstAudioOutAt) {
              firstAudioOutAt = Date.now();
              trace('audio-out-first', {
                sinceInputMs: lastInputAt ? firstAudioOutAt - lastInputAt : null,
              });
            }
            audioOutFrames += 1;
            safeSend(client, {
              type: 'audio',
              data: inline.data,
              mimeType: inline.mimeType,
              sampleRate: LIVE_OUTPUT_SAMPLE_RATE,
            });
          } else if (typeof part?.text === 'string' && part.text) {
            textAcc += part.text;
          }
        }
        if (textAcc) safeSend(client, { type: 'text', text: textAcc });
      }
      if (sc.turnComplete) {
        turnCount += 1;
        trace('turn-complete', {
          turn: turnCount,
          turnMs: lastInputAt ? Date.now() - lastInputAt : null,
        });
        // Next Google audio starts a fresh latency window.
        lastInputAt = 0;
        firstAudioOutAt = 0;
        safeSend(client, { type: 'turnComplete' });
      }
      if (anyMsg?.toolCall?.functionCalls) {
        toolCallCount += 1;
        trace('tool-call', { names: anyMsg.toolCall.functionCalls.map((fc: any) => fc?.name) });
        safeSend(client, { type: 'toolCall', functionCalls: anyMsg.toolCall.functionCalls });
      }
      if (anyMsg?.toolCallCancellation?.ids) {
        safeSend(client, { type: 'toolCallCancellation', ids: anyMsg.toolCallCancellation.ids });
      }
    } catch (err) {
      console.warn('[GeminiLiveWS] forward failed:', (err as Error)?.message);
    }
  };

  const connectGoogle = async (setup: {
    profile?: any;
    language?: string;
    voice?: unknown;
    recentMeals?: any[];
  }): Promise<boolean> => {
    const apiKey = getLiveApiKey();
    if (!apiKey) {
      safeSend(client, { type: 'error', message: 'Live voice is not configured on this server (missing Gemini API key).', fatal: true });
      return false;
    }
    const voice = normalizeLiveVoice(setup.voice);
    const languageCode = normalizeLiveLanguage(setup.language ?? setup.profile?.language);
    liveCtx = { profile: setup.profile, recentMeals: setup.recentMeals };
    const systemInstruction = buildLiveSystemInstruction({
      profile: setup.profile,
      language: setup.language,
      recentMeals: setup.recentMeals,
    });
    const candidates = [PRIMARY_LIVE_MODEL, FALLBACK_LIVE_MODEL];
    let failedOver = false;
    const openWithModel = async (model: string): Promise<boolean> => {
      const attemptAt = Date.now();
      trace('google-connect-start', { model });
      try {
        session = await openLiveSession({
          apiKey,
          model,
          voice,
          languageCode,
          systemInstruction,
          onmessage: forwardLiveMessage,
          onopen: () => trace('google-socket-open', { model }),
          onerror: (err) => {
            trace('google-socket-error', { model, message: String(err?.message || err).slice(0, 200) });
            console.warn(`[GeminiLiveWS] Google socket error (${model}):`, err?.message || err);
          },
          onclose: (ev: any) => {
            const code = ev?.code;
            const reason = typeof ev?.reason === 'string' ? ev.reason.slice(0, 200) : '';
            trace('google-closed', { model, code, reason });
            if (closed) return;
            // Early drop (handshake accepted, then gone within 15s) usually
            // means the primary model is unavailable for this key — fail over
            // to the fallback inside the same browser session instead of
            // dumping the user to legacy.
            const earlyMs = Date.now() - googleReadyAt;
            if (!failedOver && googleReadyAt > 0 && earlyMs < 15 * 1000) {
              failedOver = true;
              trace('google-early-drop-failover', { from: model, to: FALLBACK_LIVE_MODEL, aliveMs: earlyMs });
              safeSend(client, { type: 'status', message: 'Switching voice engine…' });
              void openWithModel(FALLBACK_LIVE_MODEL);
              return;
            }
            safeSend(client, {
              type: 'error',
              message: `Voice connection closed${code ? ` (code ${code})` : ''}${reason ? `: ${reason}` : ''}. Reopen the receptionist to continue.`,
            });
            cleanup(1000, 'google-closed');
          },
        });
        liveModel = model;
        googleReadyAt = Date.now();
        flushPendingInput();
        safeSend(client, { type: 'ready', model, voice, sid });
        trace('ready', { model, voice, connectMs: Date.now() - attemptAt });
        console.log(`[GeminiLiveWS] live session open (model=${model} voice=${voice})`);
        return true;
      } catch (err) {
        trace('google-connect-failed', { model, message: String((err as Error)?.message).slice(0, 200) });
        console.warn(`[GeminiLiveWS] connect failed (${model}):`, (err as Error)?.message);
        session = null;
        return false;
      }
    };
    for (const model of candidates) {
      if (await openWithModel(model)) return true;
    }
    safeSend(client, { type: 'error', message: 'Could not reach the live voice engine. Please retry in a moment.', fatal: true });
    return false;
  };

  client.on('message', (raw: any) => {
    if (closed) return;
    lastActivity = Date.now();
    let bufLen = 0;
    try {
      bufLen = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(String(raw));
    } catch { bufLen = 0; }
    if (bufLen > MAX_CLIENT_MESSAGE_BYTES) {
      safeSend(client, { type: 'error', message: 'Audio frame too large — dropped.' });
      return;
    }
    let frame: any;
    try {
      frame = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
    } catch {
      return; // binary garbage — ignore
    }
    if (!frame || typeof frame.type !== 'string') return;

    if (frame.type === 'setup') {
      setupReceived = true;
      trace('setup', {
        voice: frame.voice, language: frame.language,
        hasProfile: !!frame.profile,
        recentMeals: Array.isArray(frame.recentMeals) ? frame.recentMeals.length : 0,
      });
      if (session) return; // already connected — ignore duplicate setups
      void connectGoogle(frame).then((ok) => {
        if (!ok) cleanup(1000, 'connect-failed');
      });
      return;
    }

    // Browser-side performance marks (mic open, socket open, first playback)
    // forwarded for the same server-side timeline.
    if (frame.type === 'debug') {
      trace('client', { ev: frame.ev, tClientMs: frame.tRelMs });
      return;
    }

    if (!session) {
      // Handshake window: setup received but Google not open yet. Buffer
      // audio/text and flush on ready — never error, or the client (which
      // hasn't seen `ready`) treats it as fatal and hangs up.
      if (setupReceived && (frame.type === 'audio' || frame.type === 'text')) {
        const data = frame.type === 'audio' ? frame.data : frame.text;
        if (typeof data === 'string' && data.length > 0) {
          if (pendingInput.length < MAX_PENDING_INPUT) {
            pendingInput.push({ kind: frame.type, data: frame.type === 'text' ? data.slice(0, 2000) : data });
          }
        }
        return;
      }
      safeSend(client, { type: 'error', message: 'Voice session is not ready yet — send setup first.', fatal: true });
      return;
    }

    try {
      if (frame.type === 'audio' && typeof frame.data === 'string' && frame.data.length > 0) {
        if (!firstAudioInAt) {
          firstAudioInAt = Date.now();
          trace('audio-in-first', {});
        }
        audioInFrames += 1;
        // Continuous mic streaming: count frames but do NOT stamp lastInputAt
        // here (see inputTranscription). Reset the first-audio window only
        // when a fresh speech onset is plausible — handled via transcription.
        session.sendRealtimeInput({
          audio: { data: frame.data, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (frame.type === 'text' && typeof frame.text === 'string' && frame.text.trim()) {
        lastInputAt = Date.now();
        firstAudioOutAt = 0;
        session.sendRealtimeInput({ text: frame.text.slice(0, 2000) });
      } else if (frame.type === 'toolResponse') {
        const responses = Array.isArray(frame.functionResponses)
          ? frame.functionResponses
          : (frame.id && frame.name
              ? [{ id: frame.id, name: frame.name, response: frame.response ?? { ok: true } }]
              : []);
        if (responses.length > 0) {
          session.sendToolResponse({ functionResponses: responses as any });
          // Apply profile updates server-side context so follow-up turns
          // stay consistent even if the browser state lags.
          for (const r of responses) {
            if (r?.name === 'update_profile' && liveCtx.profile && (r as any)?.response) {
              try {
                const updates = (r as any).response?.updates || (r as any).response;
                if (updates && typeof updates === 'object') {
                  Object.assign(liveCtx.profile, updates);
                }
              } catch { /* non-fatal */ }
            }
          }
        }
      } else if (frame.type === 'end') {
        const why = typeof frame.reason === 'string' && frame.reason ? `:${frame.reason}` : '';
        trace('client-end', { why: why || 'unknown' });
        cleanup(1000, `client-end${why}`);
      }
    } catch (err) {
      console.warn('[GeminiLiveWS] relay send failed:', (err as Error)?.message);
    }
  });

  client.on('close', () => cleanup());
  client.on('error', () => cleanup());
}

// Attach the /api/gemini/live-ws relay to an existing HTTP server.
// Ignores every other upgrade path (Vite HMR etc.) — never hijacks them.
export function setupGeminiLiveWebSocket(server: HttpServer): void {
  let WebSocketServerCtor: any;
  try {
    WebSocketServerCtor = loadWsServerCtor();
  } catch (err) {
    console.warn('[GeminiLiveWS] ws unavailable — live voice relay disabled:', (err as Error)?.message);
    return;
  }
  const wss = new WebSocketServerCtor({ noServer: true });
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '', 'http://localhost').pathname;
    } catch { return; }
    if (pathname !== LIVE_WS_PATH) return;
    wss.handleUpgrade(req, socket as any, head, (ws: unknown) => {
      wss.emit('connection', ws, req);
    });
  });
  wss.on('connection', (ws: unknown) => {
    void handleLiveConnection(ws);
  });
  console.log(`[GeminiLiveWS] relay armed at ${LIVE_WS_PATH} (models: ${PRIMARY_LIVE_MODEL} -> ${FALLBACK_LIVE_MODEL})`);
}
