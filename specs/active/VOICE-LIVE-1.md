---
id: VOICE-LIVE-1
status: closed-for-now
class: VOICE_STREAMING_ARCHITECTURE
edit_mode: patch
skill: builder
auto_go: false
allowed_files:
  - server.ts
  - server_gemini_live_ws.ts
  - src/components/VoiceReceptionistFab.tsx
  - src/components/VoiceReceptionistFab.test.tsx
  - src/services/geminiLiveAudioClient.ts
  - public/audio-worklet-processor.js
  - plan/ROADMAP.md
  - AI_HANDOVER.md
frozen_files:
  - agents/**
  - server_dish_finalize.ts
  - server_derivation.ts
  - src/jobs/JobStore.ts
  - src/jobs/SupabaseJobSync.ts
  - .github/workflows/ci.yml
gate:
  - npx tsc --noEmit
  - npx vitest run src/components/VoiceReceptionistFab.test.tsx
  - node scripts/assert-shell-smoke.mjs
---

# VOICE-LIVE-1 — Ephemeral Gemini 3.8 Live WebSocket Voice Receptionist

## 1. Executive Summary & Objective

The current voice receptionist implementation uses the browser's native Web Speech API (`webkitSpeechRecognition` + `window.speechSynthesis`) chained to a unary REST endpoint (`POST /api/gemini/front-desk`). On mobile Android devices, this suffers from three fatal user-experience flaws:
1. **Uncomfortable Latency (3.5s – 5.0s):** Caused by silence debounce delays, HTTP round-trips, and synchronous LLM JSON generation.
2. **Robotic, Monotone Audio:** Android OS routes `SpeechSynthesis` to low-fidelity local system synthesizers (Pico/offline TTS) with mechanical cadence.
3. **High Recognition Error Rate:** Generic browser speech typing frequently hallucinates or fails on medical biomarkers (`HbA1c`, `ApoB`, `triglycerides`) and food terminology, regularly dropping out with `no-speech` errors.

**Goal:** Upgrade the Voice Receptionist to **native bidirectional speech-to-speech** using Google AI Studio's flagship **`gemini-3.8-live`** over a secure WebSocket relay, delivering **sub-400ms turnaround**, **expressive studio-grade human voice**, and **accurate medical/food recognition** with zero REST TTS rate-limit penalties.

---

## 2. API Quotas & Architecture Realities

Live rate limits in the project console govern model routing:
* **REST TTS (Flash TTS):** 3 RPM, 10 RPD, 10K TPM $\rightarrow$ **10 requests per day (FATAL for voice chat). Strictly banned.**
* **REST Flash (3.8 Flash):** 5 RPM, 20 RPD $\rightarrow$ **20 requests per day. Strictly banned for voice turns.**
* **REST Flash Lite (3.5 Flash Lite):** 15 RPM, 500 RPD, 250K TPM $\rightarrow$ **Reserved for background non-voice tasks (photo OCR, heavy calorie reconciler).**
* **Live API: `Gemini 3.8 Live`:** **UNLIMITED RPM, UNLIMITED RPD, 65K TPM.**
* **Live API: `Gemini 2.5 Flash Native Audio Dialog`:** **UNLIMITED RPM, UNLIMITED RPD, 1,000,000 TPM.**

### Use-Case Token Strategy (Ephemeral Micro-Sessions)
Real user interactions with the receptionist are short question bursts (**1 to 3 turns, 30 to 90 seconds**).
* A 90-second voice burst consumes only **~3,500 tokens** (under 6% of the 65,000 TPM limit).
* By closing the WebSocket when the user closes the drawer or after 45s of silence, rolling TPM resets to 0 before the user returns.
* **Primary Engine:** `gemini-3.8-live` (best clinical reasoning, natural voice).
* **Automatic Failover:** `gemini-2.5-flash-native-audio` (1M TPM safety net if a session exceeds 10 continuous minutes).

---

## 3. System Architecture & Components

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Mobile Browser (Android)                      │
│                                                                        │
│   [Mic] ──(Web Audio AudioWorklet)──> [16kHz PCM Frames]               │
│                                               │                        │
│   [Speaker] <──(24kHz PCM Playback)───────────┼────────────────────┐   │
│                                               │                    │   │
│   [UI State / Profile Form] <─────────────────┼──────┐             │   │
└───────────────────────────────────────────────┼──────┼─────────────┼───┘
                                                │ (WSS)│             │
                                                ▼      │             │
┌──────────────────────────────────────────────────────┴─────────────┴───┐
│              Express Server Relay (server_gemini_live_ws.ts)            │
│                 Route: /api/gemini/live-ws                             │
│                                                                        │
│   • Authenticates session & injects UserProfile / recent meals         │
│   • Relays raw 16kHz PCM chunks to Google BidiGenerateContent          │
│   • Relays 24kHz audio chunks & live transcripts back to client        │
│   • Handles tool calling events (update_profile, navigate_tab)         │
└───────────────────────────────────────────────┬────────────────────────┘
                                                │
                                                ▼ (Secure WSS with GEMINI_API_KEY)
┌────────────────────────────────────────────────────────────────────────┐
│                     Google AI Studio Live API                          │
│               wss://generativelanguage.googleapis.com/...              │
│                                                                        │
│   Model: gemini-3.8-live (fallback: gemini-2.5-flash-native-audio)    │
│   Voice: Aoede / Charon / Kore                                         │
│   Native Barge-in: Automatic server-side interruption                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Plan & Phases

### Phase 1: Server WebSocket Relay (`server_gemini_live_ws.ts`)
1. Create `server_gemini_live_ws.ts` exporting `setupGeminiLiveWebSocket(server: http.Server)`.
2. Connect client WebSocket `/api/gemini/live-ws` to Google AI Studio's `BidiGenerateContent` endpoint:
   `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`
3. Initialize the session handshake with `BidiGenerateContentSetup`:
   - Model: `models/gemini-3.8-live` (fallback: `models/gemini-2.5-flash-native-audio`).
   - Generation config: `responseModalities: ["AUDIO"]`, voice config: `Aoede` (warm, natural feminine) or `Charon` (natural masculine).
   - System instruction: Injected with user profile, language preference, dietary restrictions, and recent meals.
   - Tool declarations: `update_profile`, `navigate_tab`, `handoff_specialist`, `log_meal`.
4. Relay audio input chunks (`realtimeInput.mediaChunks` with `mimeType: "audio/pcm;rate=16000"`) from client to Gemini.
5. Relay audio output chunks and text parts from Gemini back to the client.
6. Handle `toolCall` / `toolResponse` frames for profile updates without breaking the audio stream.

### Phase 2: Client Web Audio & Worklet (`src/services/geminiLiveAudioClient.ts`)
1. Create `public/audio-worklet-processor.js`:
   - Downsamples incoming microphone audio from hardware rate (44.1/48kHz) to 16,000Hz 16-bit PCM little-endian.
   - Posts PCM buffers to the main thread via `MessagePort`.
2. Create `src/services/geminiLiveAudioClient.ts`:
   - Manages WebSocket connection to `/api/gemini/live-ws`.
   - Schedules incoming 24kHz PCM chunks via `AudioContext.createBuffer()` and `AudioBufferSourceNode` for click-free continuous playback.
   - Native Barge-In: If Gemini sends an interruption frame or user speaks, immediately cancels pending scheduled audio buffers.
   - Lifecycle management: Clean `disconnect()` on modal close, auto-sleep after 45 seconds of inactivity.

### Phase 3: UI Integration (`src/components/VoiceReceptionistFab.tsx`)
1. Replace legacy `webkitSpeechRecognition` and `window.speechSynthesis` loops with `geminiLiveAudioClient`.
2. Keep visual indicators reactive:
   - Soundwave bars respond dynamically to outgoing microphone volume and incoming assistant audio volume.
   - Live transcript box updates as Gemini returns transcript text tokens.
3. Tool execution bindings:
   - `update_profile(args)`: Updates React `profile` state and calls `saveAndSync()`. Shows inline confirmation badge.
   - `navigate_tab(tab)`: Calls `setActiveTab(tab)` and highlights navigation elements.
4. Voice Settings drawer: Allow selecting between voice personas (`Aoede`, `Charon`, `Kore`) and adjusting speech rate.

### Phase 4: Verification, Sensors, & Proof
1. `npx tsc --noEmit` must pass with 0 errors.
2. `npx vitest run src/components/VoiceReceptionistFab.test.tsx` passes with updated button and live audio assertions.
3. `node scripts/assert-shell-smoke.mjs` runs clean.
4. On-device Android mobile verification:
   - Open receptionist drawer $\rightarrow$ live session connects in <300ms.
   - Speak medical and food terms: *"My HbA1c is 5.4% and I ate 150g tempeh."*
   - Verify speech recognition accuracy and natural, non-robotic studio voice response.
   - Verify instantaneous barge-in when interjecting mid-sentence.
   - Verify zero calls to REST TTS endpoints (preserving 10 RPD limit).

---

## 5. Definition of Done

**Closed for now (2026-10-29, owner).** Do not run the Android proof. The boxes below stay the original list. Echo cancellation stays off. Reopen only if the owner asks.

* [ ] Server WebSocket relay `/api/gemini/live-ws` connected and handling bidirectional audio with Google AI Studio.
* [ ] Client `VoiceReceptionistFab.tsx` streaming 16kHz PCM in and playing 24kHz PCM out with hardware echo cancellation.
* [ ] Zero browser dictation errors (`no-speech` eliminated).
* [ ] Turnaround latency under 500ms on Android mobile.
* [ ] Quota compliance: All voice turns run on Live API (Unlimited RPM/RPD); REST TTS usage is 0.
