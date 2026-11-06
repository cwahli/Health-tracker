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
  page?: string;
  authState?: 'logged-in' | 'logged-out';
  authMode?: 'login' | 'signup';
}

export interface LiveToolCall {
  id?: string;
  name?: string;
  args?: any;
}

export interface LiveAudioClientEvents {
  onReady?: (info: { model: string; voice: string; resumed?: boolean }) => void;
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
  onReconnecting?: (attempt: number) => void;
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
  // Auto-reconnect state. wantConnection survives socket drops (retry with
  // backoff); only an explicit disconnect() clears it. resumeHandle is the
  // Google session handle for transparent resume across reconnects.
  private wantConnection = false;
  private retryTimer: any = null;
  private retryAttempt = 0;
  private socketGen = 0;
  private resumeHandle: string | null = null;
  private t0 = 0;
  private firstPlaybackMarked = false;
  private pendingMarks: Array<any> = [];
  private lastSpeakerLevel = 0;
  private lastSpeakerChunkAt = 0;
  // Half-duplex uplink mute: performance.now() horizon until which mic
  // frames are replaced with silence because our own reply is audible.
  private speakerUntilMs = 0;
  private mutedFrames = 0;
  private passedFrames = 0;

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
    // Explicit connect = fresh session: drop any stale resume handle.
    this.closed = false;
    this.wantConnection = true;
    this.retryAttempt = 0;
    this.resumeHandle = null;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setup = setup;
    this.t0 = performance.now();
    this.firstPlaybackMarked = false;
    this.pendingMarks = [];
    this.touchActivity();

    await this.startMicrophone();
    this.mark('mic-ready');

    await this.openSocket();
  }

  // Max 6 attempts: ~0.4s, 0.8s, 1.6s, 3.2s, 5s, 5s + jitter (~16s total).
  // Then give up to the legacy fallback instead of retrying forever.
  private static readonly MAX_RETRY_ATTEMPTS = 6;

  private scheduleReconnect(why: string): void {
    if (!this.wantConnection || this.retryTimer) return;
    if (this.retryAttempt >= GeminiLiveAudioClient.MAX_RETRY_ATTEMPTS) {
      this.giveUp(`reconnects-exhausted:${why}`);
      return;
    }
    const delay = Math.min(400 * 2 ** this.retryAttempt, 5000);
    const jittered = Math.round(delay * (0.75 + Math.random() * 0.5));
    this.retryAttempt += 1;
    this.touchActivity();
    try {
      this.events.onReconnecting?.(this.retryAttempt);
    } catch { /* ignore */ }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.wantConnection) return;
      this.mark('reconnect-attempt');
      void this.openSocket().catch(() => { /* handled via schedule/giveUp */ });
    }, jittered);
  }

  private giveUp(reason: string): void {
    this.wantConnection = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    try {
      this.events.onClosed?.();
    } catch { /* ignore */ }
    void this.disconnect(`giveup:${reason}`);
  }

  private openSocket(): Promise<void> {
    const gen = ++this.socketGen;
    const setup = this.setup;
    return new Promise<void>((resolve, reject) => {
      if (!this.wantConnection) {
        reject(new Error('Live voice connection cancelled.'));
        return;
      }
      this.readyResolve = resolve;
      this.readyReject = reject;
      const ws = new WebSocket(this.relayUrl());
      this.ws = ws;
      this.readyTimer = setTimeout(() => {
        // Handshake stall (the setup-timeout case): close the socket and
        // let the normal retry path handle it instead of failing outright.
        try { ws.close(); } catch { /* ignore */ }
        this.scheduleReconnect('ready-timeout');
      }, READY_TIMEOUT_MS);
      ws.onopen = () => {
        if (gen !== this.socketGen) return;
        this.mark('ws-open');
        ws.send(JSON.stringify({
          type: 'setup',
          profile: setup.profile || null,
          language: setup.language || setup.profile?.language || 'en',
          voice: setup.voice || 'Aoede',
          recentMeals: setup.recentMeals || [],
          page: setup.page || 'unknown',
          authState: setup.authState || (setup.profile ? 'logged-in' : 'logged-out'),
          ...(setup.authMode ? { authMode: setup.authMode } : {}),
          ...(this.resumeHandle ? { resumeHandle: this.resumeHandle } : {}),
        }));
        for (const m of this.pendingMarks.splice(0)) {
          try { ws.send(JSON.stringify(m)); } catch { /* ignore */ }
        }
      };
      ws.onmessage = (ev) => {
        if (gen !== this.socketGen) return;
        this.handleFrame(ev.data);
      };
      ws.onerror = () => {
        if (gen !== this.socketGen) return;
        // Errors are almost always followed by close; let the close handler
        // drive a single retry decision instead of double-scheduling here.
        this.mark('socket-error');
      };
      ws.onclose = () => {
        if (gen !== this.socketGen) return;
        if (!this.wantConnection) return;
        if (!this.connected) {
          this.scheduleReconnect('closed-before-ready');
        } else {
          this.scheduleReconnect('socket-closed');
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
    this.wantConnection = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
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
        this.retryAttempt = 0;
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
          this.retryTimer = null;
        }
        this.mark('ready');
        if (frame.resumed) this.mark('resumed');
        if (this.readyTimer) {
          clearTimeout(this.readyTimer);
          this.readyTimer = null;
        }
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        this.events.onReady?.({ model: frame.model, voice: frame.voice, resumed: !!frame.resumed });
        break;
      case 'sessionUpdate':
        if (typeof frame.handle === 'string' && frame.handle.length > 0) {
          this.resumeHandle = frame.handle;
        }
        break;
      case 'goAway':
        // The relay owns Google-side graceful migration; the browser socket
        // stays up, so there is nothing to do here but note it.
        this.mark('goaway-noted');
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
        if (this.mutedFrames > 0 || this.passedFrames > 0) {
          this.sendDebug('uplink', { muted: this.mutedFrames, passed: this.passedFrames });
        }
        this.mutedFrames = 0;
        this.passedFrames = 0;
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
    // Half-duplex uplink mute (field-proven pattern: ElevenLabs-style
    // widgets disable STT/VAD while the agent speaks; OpenAI documents the
    // same push-to-talk shape). Rationale, verified on-device 2026-10-20:
    // (a) platform AEC puts this Android build in voice-communication mode
    // whose output is the earpiece — so AEC stays OFF to keep the
    // loudspeaker media path; (b) the LiveKit mobile-echo thread (#3758)
    // shows AGC boosts and AEC warm-up gaps make software-only echo
    // cancellation unreliable on phones, so instead of filtering echo we
    // never transmit during our own playback. autoGainControl is also OFF:
    // field reports show AGC volume boosts re-amplify residual echo into
    // false speech onsets. Voice barge-in during playback is via the
    // Interrupt button (clears the mute horizon immediately).
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false,
      },
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
          // Half-duplex: while our own reply is audible (inside the mute
          // horizon set per played chunk) the uplink carries silence. The mic
          // physically hears the speaker on this device and no client-side
          // filter proved sufficient, so we never transmit during playback —
          // echo becomes impossible by construction. Voice barge-in during
          // playback is via the Interrupt button, which clears the horizon.
          if (performance.now() < this.speakerUntilMs) {
            buffer = new ArrayBuffer(buffer.byteLength);
            this.mutedFrames += 1;
          } else {
            // Second layer for the hangover edge: suppress frames that aren't
            // clearly louder than the speaker output. Genuine close-mic
            // interruptions pass easily; send silence so timing stays stable.
            const speakerRecent = Date.now() - this.lastSpeakerChunkAt < 800;
            if (speakerRecent && micLevel < Math.max(this.lastSpeakerLevel * 0.6, 12)) {
              buffer = new ArrayBuffer(buffer.byteLength);
            }
            this.passedFrames += 1;
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
    this.speakerGain.gain.value = 0.85; // -1.4dB: less echo coupling, still clearly audible
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
      // Keep the uplink muted until this chunk has finished playing, plus a
      // hangover for room echo tail. performance.now and AudioContext time
      // share the time origin, so the conversion is exact.
      this.speakerUntilMs = performance.now() + Math.max(0, (this.nextPlayTime - ctx.currentTime) * 1000) + 400;
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
    this.speakerUntilMs = 0;
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
    if (this.closed && !this.ws && !this.audioCtx && !this.retryTimer && !this.wantConnection) return;
    this.closed = true;
    this.connected = false;
    this.wantConnection = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.readyReject) {
      try {
        this.readyReject(new Error('Live voice disconnected.'));
      } catch { /* ignore */ }
      this.readyReject = null;
      this.readyResolve = null;
    }
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
