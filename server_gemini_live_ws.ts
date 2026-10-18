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

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { GoogleGenAI, Modality } from '@google/genai';
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
  let lastActivity = Date.now();
  let closed = false;
  let session: Session | null = null;
  let liveModel = PRIMARY_LIVE_MODEL;
  let setupReceived = false;
  let liveCtx: { profile?: any; recentMeals?: any[] } = {};

  const cleanup = (code?: number, reason?: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(setupTimer);
    clearInterval(sweeper);
    try { session?.close(); } catch { /* already closed */ }
    session = null;
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
      if (sc.interrupted) safeSend(client, { type: 'interrupted' });
      const inText = sc.inputTranscription?.text;
      if (typeof inText === 'string' && inText) {
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
      if (sc.turnComplete) safeSend(client, { type: 'turnComplete' });
      if (anyMsg?.toolCall?.functionCalls) {
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
      safeSend(client, { type: 'error', message: 'Live voice is not configured on this server (missing Gemini API key).' });
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
    for (const model of candidates) {
      try {
        session = await openLiveSession({
          apiKey,
          model,
          voice,
          languageCode,
          systemInstruction,
          onmessage: forwardLiveMessage,
          onerror: (err) => {
            console.warn(`[GeminiLiveWS] Google socket error (${model}):`, err?.message || err);
          },
          onclose: () => {
            if (!closed) {
              safeSend(client, { type: 'error', message: 'Voice connection closed. Reopen the receptionist to continue.' });
              cleanup(1000, 'google-closed');
            }
          },
        });
        liveModel = model;
        safeSend(client, { type: 'ready', model, voice });
        console.log(`[GeminiLiveWS] live session open (model=${model} voice=${voice})`);
        return true;
      } catch (err) {
        console.warn(`[GeminiLiveWS] connect failed (${model}):`, (err as Error)?.message);
        session = null;
      }
    }
    safeSend(client, { type: 'error', message: 'Could not reach the live voice engine. Please retry in a moment.' });
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
      if (session) return; // already connected — ignore duplicate setups
      void connectGoogle(frame).then((ok) => {
        if (!ok) cleanup(1000, 'connect-failed');
      });
      return;
    }

    if (!session) {
      safeSend(client, { type: 'error', message: 'Voice session is not ready yet — send setup first.' });
      return;
    }

    try {
      if (frame.type === 'audio' && typeof frame.data === 'string' && frame.data.length > 0) {
        session.sendRealtimeInput({
          audio: { data: frame.data, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (frame.type === 'text' && typeof frame.text === 'string' && frame.text.trim()) {
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
        cleanup(1000, 'client-end');
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
