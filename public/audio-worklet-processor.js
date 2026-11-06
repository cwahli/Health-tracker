/**
 * AudioWorklet processor for VOICE-LIVE-1 Phase 2.
 *
 * Runs off the main thread. Takes microphone Float32 samples at the hardware
 * rate (44.1/48kHz), downsamples to 16kHz mono 16-bit PCM little-endian, and
 * posts transferable ArrayBuffers to the main thread for relay over
 * /api/gemini/live-ws. Also reports an RMS volume level per chunk so the UI
 * soundwave stays reactive without a separate AnalyserNode on the mic path.
 *
 * Main thread usage:
 *   await audioContext.audioWorklet.addModule('/audio-worklet-processor.js');
 *   const node = new AudioWorkletNode(audioContext, 'live-pcm-processor');
 *   node.port.onmessage = (e) => {
 *     if (e.data.type === 'pcm16') sendToRelay(e.data.buffer); // ArrayBuffer
 *     if (typeof e.data.level === 'number') renderLevel(e.data.level);
 *   };
 */

// Plain script (no modules/exports) — AudioWorkletGlobalScope has no DOM.
class LivePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Hardware capture rate of this AudioContext (e.g. 44100 / 48000).
    this._inputRate = sampleRate;
    this._targetRate = 16000;
    // ~128ms of 16kHz audio per emitted chunk: good relay granularity.
    this._emitFrames = 2048;
    this._leftover = new Float32Array(0);
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'configure' && typeof msg.targetRate === 'number' &&
          msg.targetRate >= 8000 && msg.targetRate <= 48000) {
        this._targetRate = msg.targetRate;
        this._leftover = new Float32Array(0);
      }
    };
  }

  _rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      sum += s * s;
    }
    if (samples.length === 0) return 0;
    // Scale so normal speech lands ~20-80 on a 0-100 meter.
    return Math.min(100, Math.round(Math.sqrt(sum / samples.length) * 220));
  }

  process(inputs) {
    const input = inputs && inputs[0];
    const channel = input && input[0];
    if (!channel || channel.length === 0) return true;

    const level = this._rms(channel);

    // Stitch leftover from the previous quantum onto the new samples.
    let frames;
    if (this._leftover.length > 0) {
      frames = new Float32Array(this._leftover.length + channel.length);
      frames.set(this._leftover, 0);
      frames.set(channel, this._leftover.length);
      this._leftover = new Float32Array(0);
    } else {
      frames = channel;
    }

    // Linear-interpolation downsample to the target rate.
    const ratio = this._inputRate / this._targetRate;
    const outLen = Math.floor(frames.length / ratio);
    if (outLen < this._emitFrames) {
      // Not enough for a full chunk yet — hold everything for next quantum.
      const hold = new Float32Array(frames.length);
      hold.set(frames, 0);
      this._leftover = hold;
      return true;
    }

    const resampled = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = frames[idx] || 0;
      const b = frames[idx + 1] !== undefined ? frames[idx + 1] : a;
      const sample = a + (b - a) * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      resampled[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    // Keep the tail (< 1 sample step) for continuity; drop whole emitted
    // chunks and retain any partial remainder.
    const consumed = outLen * ratio;
    const consumedIdx = Math.floor(consumed);
    if (consumedIdx < frames.length) {
      this._leftover = frames.slice(consumedIdx);
    }

    let offset = 0;
    while (offset < outLen) {
      const end = Math.min(offset + this._emitFrames, outLen);
      const chunk = resampled.slice(offset, end).buffer;
      this.port.postMessage(
        { type: 'pcm16', buffer: chunk, level: level, sampleRate: this._targetRate },
        [chunk]
      );
      offset = end;
    }
    return true;
  }
}

registerProcessor('live-pcm-processor', LivePcmProcessor);
