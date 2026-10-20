// geminiLiveAudioClient.ts — VOICE-LIVE-1 Phase 2: browser Live client.
//
// Manages the full duplex voice path for the receptionist drawer:
//   mic --(AudioWorklet 16kHz PCM16)--> wss /api/gemini/live-ws --> Google Live
//   Google Live --> 24kHz PCM chunks --> gapless AudioContext playback
//
// Lifecycle: connect() on drawer open, disconnect() on drawer close,
// auto-sleep after 45s of conversational inactivity (ephemeral micro-session,
// keeps token burn far under the 65K TPM live quota). Server-side barge-in
// arrives as an `interrupted` frame; local barge-in cancels scheduled speaker
// buffers the moment the user starts talking.

export type LiveVoicePersona = 'Aoede' | 'Charon' | 'Kore';

export interface LiveSessionSetup {
  profile?: any;
  language?: string;
  voice?: LiveVoicePersona;
  recentMeals?: any[];
}

export interface LiveToolCall {
  id?: string;
  name?: string;
  args?: any;
}

export interface LiveAudioClientEvents {
  onReady?: (info: { model: string; voice: string }) => void;
  onInputTranscription?: (text: string) => void;
  onOutputTranscription?: (text: string) => void;
  onAssistantText?: (text: string) => void;
  onInterrupted?: () => void;
  onTurnComplete?: () => void;
  onToolCall?: (calls: LiveToolCall[]) => void;
  onMicLevel?: (level: number) => void;
  onSpeakerLevel?: (level: number) => void;
  onError?: (message: string) => void;
  onClosed?: () => void;
  onAutoSleep?: () => void;
  onStatus?: (message: string) => void;
}

export const LIVE_INPUT_RATE = 16000;
export const LIVE_OUTPUT_RATE = 24000;

// Merge incremental transcript segments without duplicating overlaps
// (Live sends cumulative re-transcriptions as the turn grows).
export function mergeLiveTranscript(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.endsWith(next)) return prev;
  return `${prev} ${next}`;
}
const READY_TIMEOUT_MS = 10 * 1000;
const AUTO_SLEEP_MS = 45 * 1000;
const SPEAKER_METER_MS = 120;

export function isLiveVoiceSupported(): boolean {  if (typeof window === 'undefined') return false;
  const w = window as any;
  const AC = w.AudioContext || w.webkitAudioContext;
  return !!(
    w.WebSocket &&
    AC &&
    navigator?.mediaDevices?.getUserMedia
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return btoa(binary);
}

function base64ToFloat32Pcm16(base64: string): Float32Array | null {
  try {
    const binary = atob(base64);
    const len = binary.length;
    if (len % 2 !== 0 || len === 0) return null;
    const out = new Float32Array(len / 2);
    for (let i = 0; i < out.length; i++) {
      const lo = binary.charCodeAt(i * 2);
      const hi = binary.charCodeAt(i * 2 + 1);
      let v = (hi << 8) | lo;
      if (v >= 0x8000) v -= 0x10000;
      out[i] = v / 0x8000;
    }
    return out;
  } catch {
    return null;
  }
}

export class GeminiLiveAudioClient {
  private events: LiveAudioClientEvents;
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private speakerAnalyser: AnalyserNode | null = null;
  private speakerGain: GainNode | null = null;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;
  private speakerTimer: any = null;
  private sleepTimer: any = null;
  private readyTimer: any = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private connected = false;
  private closed = false;
  private setup: LiveSessionSetup = {};
  private t0 = 0;
  private firstPlaybackMarked = false;
  private pendingMarks: Array<any> = [];
  private lastSpeakerLevel = 0;
  private lastSpeakerChunkAt = 0;

  constructor(events: LiveAudioClientEvents = {}) {
    this.events = events;
  }

  get isConnected(): boolean {
    return this.connected && !this.closed;
  }

  // Browser-side marks forwarded to the relay so one server timeline shows
  // mic/socket/playback timing next to Google TTFB. Marks created before the
  // socket opens are queued and flushed on open.
  private mark(ev: string): void {
    this.sendDebug(ev);
  }

  // One-time audio-route probe (no PII: kinds/counts/booleans only, never
  // device labels or ids). Answers: does the browser honor browser-AEC, is a
  // non-default speaker endpoint routable, can AudioContext sink be set?
  private probeAudioRoute(): void {
    try {
      const supported: string[] = typeof navigator?.mediaDevices?.getSupportedConstraints === 'function'
        ? Object.keys(navigator.mediaDevices.getSupportedConstraints())
        : [];
      const track = this.micStream?.getAudioTracks?.()[0];
      const settings: Record<string, unknown> = {};
      if (track?.getSettings) {
        const s = track.getSettings() as any;
        settings.echoCancellation = s.echoCancellation;
        settings.echoCancellationType = s.echoCancellationType;
        settings.noiseSuppression = s.noiseSuppression;
        settings.sampleRate = s.sampleRate;
        settings.channelCount = s.channelCount;
      }
      const info: Record<string, unknown> = {
        supportedHasEchoType: supported.includes('echoCancellationType'),
        settings,
        hasAudioContextSetSinkId: typeof (this.audioCtx as any)?.setSinkId === 'function',
      };
      if (typeof navigator?.mediaDevices?.enumerateDevices === 'function') {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
          const outputs = (devices || []).filter((d) => d.kind === 'audiooutput');
          const inputs = (devices || []).filter((d) => d.kind === 'audioinput');
          this.sendDebug('audio-route-probe', {
            ...info,
            audioOutputs: outputs.length,
            audioInputs: inputs.length,
          });
        }).catch(() => {
          this.sendDebug('audio-route-probe', info);
        });
      } else {
        this.sendDebug('audio-route-probe', info);
      }
    } catch { /* telemetry never breaks audio */ }
  }

  private sendDebug(ev: string, info?: Record<string, unknown>): void {
    try {
      const tRelMs = Math.round(performance.now() - this.t0);
      const frame: any = { type: 'debug', ev, tRelMs };
      if (info) frame.info = info;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(frame));
      } else {
        this.pendingMarks.push(frame);
      }
    } catch { /* ignore */ }
  }

  private touchActivity(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    if (this.closed) return;
    this.sleepTimer = setTimeout(() => {
      this.events.onAutoSleep?.();
      void this.disconnect('auto-sleep');
    }, AUTO_SLEEP_MS);
  }

  private relayUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/gemini/live-ws`;
  }

  async connect(setup: LiveSessionSetup): Promise<void> {
    if (this.connected) return;
    if (!isLiveVoiceSupported()) {
      throw new Error('Live voice is not supported in this browser.');
    }
    this.closed = false;
    this.setup = setup;
    this.t0 = performance.now();
    this.firstPlaybackMarked = false;
    this.pendingMarks = [];
    this.touchActivity();

    await this.startMicrophone();
    this.mark('mic-ready');

    await new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      const ws = new WebSocket(this.relayUrl());
      this.ws = ws;
      this.readyTimer = setTimeout(() => {
        reject(new Error('Live voice connection timed out.'));
        try { ws.close(); } catch { /* ignore */ }
      }, READY_TIMEOUT_MS);
      ws.onopen = () => {
        this.mark('ws-open');
        ws.send(JSON.stringify({
          type: 'setup',
          profile: setup.profile || null,
          language: setup.language || setup.profile?.language || 'en',
          voice: setup.voice || 'Aoede',
          recentMeals: setup.recentMeals || [],
        }));
        for (const m of this.pendingMarks.splice(0)) {
          try { ws.send(JSON.stringify(m)); } catch { /* ignore */ }
        }
      };
      ws.onmessage = (ev) => this.handleFrame(ev.data);
      ws.onerror = () => {
        this.fail(new Error('Live voice socket error.'));
      };
      ws.onclose = () => {
        if (!this.connected && this.readyReject) {
          this.fail(new Error('Live voice connection closed before ready.'));
        } else {
          this.events.onClosed?.();
          void this.disconnect('browser-socket-closed');
        }
      };
    });
  }

  private fail(err: Error): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    if (reject && !this.connected) {
      reject(err);
    } else if (this.connected) {
      this.events.onError?.(err.message);
    }
    void this.disconnect(`fail:${err.message.slice(0, 60)}`);
  }

  private handleFrame(raw: any): void {
    let frame: any;
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!frame || typeof frame.type !== 'string') return;
    this.touchActivity();

    switch (frame.type) {
      case 'ready':
        this.connected = true;
        this.mark('ready');
        if (this.readyTimer) {
          clearTimeout(this.readyTimer);
          this.readyTimer = null;
        }
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        this.events.onReady?.({ model: frame.model, voice: frame.voice });
        break;
      case 'audio':
        if (typeof frame.data === 'string') this.playPcmChunk(frame.data);
        break;
      case 'inputTranscription':
        if (typeof frame.text === 'string' && frame.text) {
          this.events.onInputTranscription?.(frame.text);
        }
        break;
      case 'outputTranscription':
        if (typeof frame.text === 'string' && frame.text) {
          this.events.onOutputTranscription?.(frame.text);
        }
        break;
      case 'text':
        if (typeof frame.text === 'string' && frame.text) {
          this.events.onAssistantText?.(frame.text);
        }
        break;
      case 'interrupted':
        this.cancelScheduledSpeech();
        this.events.onInterrupted?.();
        break;
      case 'turnComplete':
        this.events.onTurnComplete?.();
        break;
      case 'toolCall':
        if (Array.isArray(frame.functionCalls)) {
          const calls: LiveToolCall[] = frame.functionCalls.map((fc: any) => ({
            id: fc?.id,
            name: fc?.name,
            args: fc?.args,
          }));
          this.events.onToolCall?.(calls);
        }
        break;
      case 'idleTimeout':
        this.events.onAutoSleep?.();
        void this.disconnect('server-idle');
        break;
      case 'status':
        if (typeof frame.message === 'string' && frame.message) {
          this.events.onStatus?.(frame.message);
        }
        break;
      case 'error':
        if (!this.connected) {
          // Transient pre-ready notices (fatal: false) must not kill a
          // session that is still handshaking — the ready frame follows.
          if (frame.fatal === false) break;
          this.fail(new Error(typeof frame.message === 'string' ? frame.message : 'Live voice error.'));
        } else {
          this.events.onError?.(typeof frame.message === 'string' ? frame.message : 'Live voice error.');
        }
        break;
      default:
        break;
    }
  }

  private async startMicrophone(): Promise<void> {
    const w = window as any;
    const AC = w.AudioContext || w.webkitAudioContext;
    this.audioCtx = new AC({ latencyHint: 'interactive' });
    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    // Vendor-sanctioned echo handling (google-gemini/cookbook#356: browser
    // AEC is why AI Studio works on speakers). echoCancellationType browser
    // requests Chrome's software AEC rather than the OS voice path — on some
    // Android builds the OS path reroutes Web Audio to the earpiece. Unknown
    // constraint keys are ignored by browsers, so this is a safe probe: if
    // unhonored, behavior is unchanged.
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        echoCancellationType: 'browser',
        noiseSuppression: true,
        autoGainControl: true,
      } as any,
    });
    this.probeAudioRoute();
    await ctx.audioWorklet.addModule('/audio-worklet-processor.js');
    this.micSource = ctx.createMediaStreamSource(this.micStream);
    this.workletNode = new AudioWorkletNode(ctx, 'live-pcm-processor');
    this.workletNode.port.onmessage = (e: MessageEvent) => {
      const msg = e.data || {};
      if (typeof msg.level === 'number') this.events.onMicLevel?.(msg.level);
      if (msg.type === 'pcm16' && msg.buffer && this.ws?.readyState === WebSocket.OPEN) {
        try {
          let buffer = msg.buffer as ArrayBuffer;
          const micLevel = typeof msg.level === 'number' ? msg.level : 0;
          // Energy gate against speaker bleed: while our own reply is
          // audible the mic mostly hears the speaker, and forwarding that
          // bleed makes Google's VAD think the user is barging in — the
          // interrupt-cancel chop loop. Suppress frames that aren't clearly
          // louder than the speaker output (genuine close-mic interruptions
          // pass easily); send silence so stream timing stays stable.
          const speakerRecent = Date.now() - this.lastSpeakerChunkAt < 800;
          if (speakerRecent && micLevel < Math.max(this.lastSpeakerLevel * 0.6, 12)) {
            buffer = new ArrayBuffer(buffer.byteLength);
          }
          const data = arrayBufferToBase64(buffer);
          this.ws.send(JSON.stringify({ type: 'audio', data }));
          this.touchActivity();
        } catch { /* drop frame */ }
      }
    };
    this.micSource.connect(this.workletNode);
    // Keep the worklet running without feeding the speakers: route through a
    // zero-gain node (a disconnected AudioWorkletNode may be GC-throttled).
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.workletNode.connect(sink);
    sink.connect(ctx.destination);

    // Speaker metering chain (playback sources connect through this).
    this.speakerGain = ctx.createGain();
    this.speakerGain.gain.value = 1;
    this.speakerAnalyser = ctx.createAnalyser();
    this.speakerAnalyser.fftSize = 512;
    this.speakerGain.connect(this.speakerAnalyser);
    this.speakerAnalyser.connect(ctx.destination);
    this.nextPlayTime = ctx.currentTime;
    const meterBuf = new Uint8Array(this.speakerAnalyser.fftSize);
    this.speakerTimer = setInterval(() => {
      try {
        if (!this.speakerAnalyser) return;
        this.speakerAnalyser.getByteTimeDomainData(meterBuf as any);
        let sum = 0;
        for (let i = 0; i < meterBuf.length; i++) {
          const v = (meterBuf[i] - 128) / 128;
          sum += v * v;
        }
        const level = Math.min(100, Math.round(Math.sqrt(sum / meterBuf.length) * 320));
        // Only report audible playback; idle line noise stays at 0.
        const speakerLevel = level < 4 ? 0 : level;
        this.lastSpeakerLevel = speakerLevel;
        this.events.onSpeakerLevel?.(speakerLevel);
      } catch { /* ignore */ }
    }, SPEAKER_METER_MS);
  }

  private playPcmChunk(base64: string): void {
    if (!this.audioCtx || !this.speakerGain) return;
    const ctx = this.audioCtx;
    const samples = base64ToFloat32Pcm16(base64);
    if (!samples || samples.length === 0) return;
    this.lastSpeakerChunkAt = Date.now();
    if (!this.firstPlaybackMarked) {
      this.firstPlaybackMarked = true;
      this.mark('first-playback');
    }
    try {
      const buffer = ctx.createBuffer(1, samples.length, LIVE_OUTPUT_RATE);
      buffer.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.speakerGain);
      const startAt = Math.max(this.nextPlayTime, ctx.currentTime + 0.01);
      src.start(startAt);
      this.nextPlayTime = startAt + buffer.duration;
      this.scheduledSources.push(src);
      src.onended = () => {
        const idx = this.scheduledSources.indexOf(src);
        if (idx >= 0) this.scheduledSources.splice(idx, 1);
        try { src.disconnect(); } catch { /* ignore */ }
      };
      // Bound the queue so a stall can never buffer minutes of audio.
      while (this.scheduledSources.length > 40) {
        const stale = this.scheduledSources.shift();
        try { stale?.stop(); } catch { /* ignore */ }
      }
    } catch { /* drop chunk */ }
  }

  /** Cancel queued + in-flight speaker audio (local barge-in). */
  interrupt(): void {
    this.cancelScheduledSpeech();
  }

  private cancelScheduledSpeech(): void {
    const sources = this.scheduledSources.splice(0);
    for (const src of sources) {
      try { src.stop(); } catch { /* already ended */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    if (this.audioCtx) {
      this.nextPlayTime = this.audioCtx.currentTime;
    }
  }

  sendText(text: string): void {
    if (!text.trim() || this.ws?.readyState !== WebSocket.OPEN) return;
    this.touchActivity();
    this.ws.send(JSON.stringify({ type: 'text', text: text.slice(0, 2000) }));
  }

  sendToolResult(id: string | undefined, name: string, result: any): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.touchActivity();
    this.ws.send(JSON.stringify({
      type: 'toolResponse',
      id,
      name,
      response: result ?? { ok: true },
    }));
  }

  async disconnect(reason = 'unknown'): Promise<void> {
    if (this.closed && !this.ws && !this.audioCtx) return;
    this.closed = true;
    this.connected = false;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    if (this.speakerTimer) {
      clearInterval(this.speakerTimer);
      this.speakerTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.send(JSON.stringify({ type: 'end', reason })); } catch { /* ignore */ }
      try { ws.close(1000, 'bye'); } catch { /* ignore */ }
    }
    this.cancelScheduledSpeech();
    try { this.workletNode?.disconnect(); } catch { /* ignore */ }
    try { this.micSource?.disconnect(); } catch { /* ignore */ }
    this.workletNode = null;
    this.micSource = null;
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      this.micStream = null;
    }
    const ctx = this.audioCtx;
    this.audioCtx = null;
    this.speakerAnalyser = null;
    this.speakerGain = null;
    if (ctx) {
      try { await ctx.close(); } catch { /* ignore */ }
    }
    this.readyResolve = null;
    this.readyReject = null;
  }
}
