import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Send,
  X,
  Sparkles,
  UserCheck,
  Utensils,
  Activity,
  Compass,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader,
  Save,
  Sliders,
  Play,
  Clock
} from 'lucide-react';
import type { UserProfile, FoodLog } from '../types';
import {
  GeminiLiveAudioClient,
  isLiveVoiceSupported,
  mergeLiveTranscript,
} from '../services/geminiLiveAudioClient';
import type { LiveToolCall, LiveVoicePersona } from '../services/geminiLiveAudioClient';

export interface VoiceReceptionistFabProps {
  profile: UserProfile | null;
  setProfile: (profile: UserProfile | null) => void;
  saveAndSync: (...args: any[]) => any;
  foodLogs?: FoodLog[];
  biomarkers?: Record<string, any>;
  biomarkerHistory?: any[];
  activeTab: string;
  setActiveTab: (tab: any) => void;
  onLogMeal?: () => void;
  onCompareMeal?: () => void;
  onOpenMedical?: () => void;
  actions?: any[];
  dailyBenefits?: any[];
  report?: any;
}

interface UIFormField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface UIFormConfig {
  formId: string;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: UIFormField[];
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actionTaken?: {
    type: 'profile_updated' | 'navigated' | 'agent_handoff' | 'highlight';
    details: string;
  };
  uiForm?: UIFormConfig | null;
}

function InlineProfileForm({
  form,
  profile,
  onSave,
}: {
  form: UIFormConfig;
  profile: UserProfile | null;
  onSave: (vals: Record<string, any>) => Promise<void>;
}) {
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    form.fields.forEach((f) => {
      const existing =
        (profile as any)?.[f.name] ??
        (f.name === 'heightCm' ? profile?.height : f.name === 'weightKg' ? profile?.weight : '');
      init[f.name] = existing ?? '';
    });
    return init;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSave(formData);
      setIsSaved(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSaved) {
    return (
      <div className="mt-2.5 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="font-semibold">Profile updated successfully!</span>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2.5 p-3.5 bg-slate-50 dark:bg-slate-900/70 border border-theme-border/80 rounded-2xl space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between border-b border-theme-border/60 pb-1.5">
        <span className="font-bold text-theme-text text-[11px]">{form.title}</span>
        {form.description && (
          <span className="text-[10px] text-slate-400 truncate max-w-[180px]">
            {form.description}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {form.fields.map((f) => (
          <div
            key={f.name}
            className={f.type === 'select' || form.fields.length === 1 ? 'col-span-2' : 'col-span-1'}
          >
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            {f.type === 'select' && f.options ? (
              <select
                value={formData[f.name] || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, [f.name]: e.target.value }))}
                className="w-full bg-white dark:bg-slate-800 border border-theme-border rounded-xl px-2.5 py-1.5 text-xs text-theme-text focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">{f.placeholder || 'Select...'}</option>
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                value={formData[f.name] || ''}
                placeholder={f.placeholder}
                onChange={(e) => setFormData((prev) => ({ ...prev, [f.name]: e.target.value }))}
                className="w-full bg-white dark:bg-slate-800 border border-theme-border rounded-xl px-2.5 py-1.5 text-xs text-theme-text focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            )}
          </div>
        ))}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full mt-2 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
      >
        {isSubmitting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        <span>{form.submitLabel || 'Save Profile'}</span>
      </button>
    </form>
  );
}

export default function VoiceReceptionistFab({
  profile,
  setProfile,
  saveAndSync,
  foodLogs = [],
  biomarkers = {},
  biomarkerHistory = [],
  activeTab,
  setActiveTab,
  onLogMeal,
  onCompareMeal,
  onOpenMedical,
  actions = [],
  dailyBenefits = [],
  report = null,
}: VoiceReceptionistFabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  const [isVoiceActive, setIsVoiceActive] = useState(true);
  const [isSpeakingEnabled, setIsSpeakingEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);

  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ht_receptionist_voice') || '';
    }
    return '';
  });
  const [voiceSpeed, setVoiceSpeed] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ht_receptionist_rate');
      if (saved) return parseFloat(saved) || 1.0;
    }
    return 1.0;
  });
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);

  // VOICE-LIVE-1 Phase 3: native Live voice path (primary) with legacy
  // Web Speech + REST fallback. liveMode drives the header badge and routes
  // typed messages either into the live socket or the legacy REST dispatch.
  const [liveMode, setLiveMode] = useState<'idle' | 'connecting' | 'live' | 'legacy'>('idle');
  const [liveVoice, setLiveVoice] = useState<LiveVoicePersona>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('ht_live_voice');
      if (saved === 'Aoede' || saved === 'Charon' || saved === 'Kore') return saved;
    }
    return 'Aoede';
  });
  const [liveReplyPreview, setLiveReplyPreview] = useState('');
  const liveClientRef = useRef<GeminiLiveAudioClient | null>(null);
  const liveModeRef = useRef<'idle' | 'connecting' | 'live' | 'legacy'>('idle');
  const liveFailedRef = useRef(false);
  const liveUserRef = useRef('');
  const liveAssistantRef = useRef('');
  const liveActionRef = useRef<ChatTurn['actionTaken']>(undefined);
  const speakerActiveRef = useRef(false);
  const speakerQuietTimerRef = useRef<any>(null);

  useEffect(() => {
    liveModeRef.current = liveMode;
  }, [liveMode]);

  const currentlySpeakingTextRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const queuedMessageRef = useRef<string>('');
  const [queuedMessageText, setQueuedMessageText] = useState<string>('');

  const [inputText, setInputText] = useState('');
  const [liveSpokenText, setLiveSpokenText] = useState('');
  const latestTextRef = useRef('');
  const silenceTimerRef = useRef<any>(null);

  const [audioLevel, setAudioLevel] = useState(0);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const memoryRef = useRef<any>(null);
  const isManuallyStoppedRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Dynamic soundwave oscillation when listening, speaking, or recording.
  // In live mode the levels stream straight from the worklet/speaker meter,
  // so the synthetic oscillation stays off.
  useEffect(() => {
    let interval: any = null;
    if (liveMode === 'live') return () => {};
    if (isListening || isRecordingAudio || isSpeaking) {
      interval = setInterval(() => {
        setAudioLevel(() => {
          if (latestTextRef.current || liveSpokenText) {
            return Math.floor(Math.random() * 35) + 65;
          }
          if (isSpeaking) {
            return Math.floor(Math.random() * 30) + 40;
          }
          return Math.floor(Math.random() * 25) + 20;
        });
      }, 120);
    } else {
      setAudioLevel(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isListening, isRecordingAudio, liveSpokenText, isSpeaking, liveMode]);

  // Keep isOpenRef and isLoadingRef in sync
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Compute missing profile fields
  const missingFields = useMemo(() => {
    const missing: { key: string; label: string; prompt: string }[] = [];
    if (!profile?.age) missing.push({ key: 'age', label: 'Age', prompt: 'My age is ' });
    if (!profile?.gender) missing.push({ key: 'gender', label: 'Gender', prompt: 'My gender is ' });
    if (!profile?.ethnicity) missing.push({ key: 'ethnicity', label: 'Ethnicity', prompt: 'My ethnicity is ' });
    if (!profile?.height) missing.push({ key: 'height', label: 'Height', prompt: 'My height is ' });
    if (!profile?.weight) missing.push({ key: 'weight', label: 'Weight', prompt: 'My current weight is ' });
    const hasGoal = (profile as any)?.healthGoal || (profile as any)?.medicalConditions;
    if (!hasGoal) missing.push({ key: 'goal', label: 'Health Goal', prompt: 'My main health goal is ' });
    return missing;
  }, [profile]);

  // Compute welcome greeting text
  const welcomeGreetingText = useMemo(() => {
    const name = profile?.nickname || profile?.email?.split('@')[0] || '';
    const lang = profile?.language || 'en';

    if (lang === 'id') {
      return name
        ? `Halo ${name}! Saya Resepsionis & Asisten Live Anda. Saya siap membantu orientasi akun, menjawab pertanyaan makanan Anda, atau menyimpan profil Anda sambil kita mengobrol.`
        : `Halo! Selamat datang di Health Tracker. Saya Resepsionis Live Anda. Saya siap membantu orientasi dan melengkapi profil kesehatan Anda. Silakan bicara langsung!`;
    } else if (lang === 'fr') {
      return name
        ? `Bonjour ${name} ! Je suis votre réceptionniste santé. Je peux vous guider dans l'application, analyser vos repas ou renseigner votre profil au fil de notre conversation.`
        : `Bonjour et bienvenue ! Je suis votre concierge santé. Parlez-moi pour configurer votre profil ou explorer vos données de santé.`;
    } else {
      if (!profile) {
        return `Hello and welcome to Health Tracker! I'm your Live Onboarding Concierge. I can guide you through the app, answer any questions, or help set up your health profile. Feel free to talk or type!`;
      }
      if (missingFields.length > 0) {
        return `Hello ${name || 'there'}! I'm your Live Onboarding Receptionist & Concierge. I can guide you through the app, review your meals, or help complete your profile. We still have a few details to set up—feel free to talk or type!`;
      }
      return `Hello ${name || 'there'}! You're all set up! Ask me about your recent meals, explore your biomarkers, or let me know what you'd like to do.`;
    }
  }, [profile?.language, profile?.nickname, profile?.email, missingFields.length]);

  // Initial welcome greeting message in transcript
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          text: welcomeGreetingText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [welcomeGreetingText, messages.length]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isSpeaking, liveSpokenText, liveReplyPreview]);

  // Cleanup audio tracks and animation frame
  const cleanupAudioStream = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  // Dynamically load system & neural voices across Android Chrome, iOS Safari, desktop
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        setAvailableVoices(voices);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // Intelligent selection of natural, human-sounding neural voices
  const getOptimalVoice = (
    voices: SpeechSynthesisVoice[],
    preferredUri: string,
    targetLangCode: string
  ): SpeechSynthesisVoice | null => {
    if (!voices || voices.length === 0) return null;

    // 1. Explicit user selection
    if (preferredUri) {
      const found = voices.find((v) => v.voiceURI === preferredUri);
      if (found) return found;
    }

    const baseLang = targetLangCode.split('-')[0].toLowerCase();
    const langVoices = voices.filter((v) => {
      const vLang = v.lang.replace('_', '-').toLowerCase();
      return vLang.startsWith(baseLang);
    });

    const pool = langVoices.length > 0 ? langVoices : voices;

    // Score voices to prioritize human neural voices over robotic offline synthesizers
    const scoreVoice = (v: SpeechSynthesisVoice) => {
      let score = 0;
      const name = v.name.toLowerCase();

      // Neural/Natural voices have high fidelity
      if (name.includes('natural') || name.includes('neural')) score += 100;
      if (name.includes('google') || name.includes('online') || name.includes('network')) score += 50;
      if (name.includes('enhanced') || name.includes('premium')) score += 40;
      if (!v.localService) score += 30; // Android network voice sounds significantly less robotic

      // English regional preferences
      if (baseLang === 'en') {
        if (v.lang.toLowerCase().includes('gb') || name.includes('uk')) score += 20;
        if (name.includes('female') || name.includes('serena') || name.includes('samantha')) score += 10;
      }

      // Penalize legacy robotic offline engines
      if (name.includes('pico') || name.includes('espeak')) score -= 100;

      return score;
    };

    const sorted = [...pool].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return sorted[0] || null;
  };

  const testVoice = (voiceURI: string, speed: number) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const sampleText =
      profile?.language === 'id'
        ? 'Halo! Ini adalah contoh suara saya. Bagaimana menurut Anda?'
        : profile?.language === 'fr'
        ? 'Bonjour ! Voici un exemple de ma voix. Comment me trouvez-vous ?'
        : 'Hello! This is how my voice sounds. I am ready to help you with your health and meals!';
    const utterance = new SpeechSynthesisUtterance(sampleText);
    const lang = profile?.language || 'en';
    utterance.lang = lang === 'id' ? 'id-ID' : lang === 'fr' ? 'fr-FR' : 'en-GB';
    utterance.rate = speed;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.voiceURI === voiceURI) || getOptimalVoice(voices, voiceURI, utterance.lang);
    if (voice) utterance.voice = voice;

    setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  // Handle Speech Synthesis (TTS) - for replying to user
  const speakResponse = (text: string, onComplete?: () => void) => {
    if (!isSpeakingEnabled || typeof window === 'undefined' || !window.speechSynthesis) {
      if (onComplete) onComplete();
      return;
    }

    try {
      window.speechSynthesis.cancel(); // Stop existing speech

      // Clean markdown tags, asterisks, brackets for natural audio speech
      const cleanText = text
        .replace(/[*_#`[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanText) {
        if (onComplete) onComplete();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      const lang = profile?.language || 'en';
      utterance.lang = lang === 'id' ? 'id-ID' : lang === 'fr' ? 'fr-FR' : 'en-GB';
      utterance.rate = voiceSpeed;
      utterance.pitch = 1.0;

      // Find optimal natural voice
      const voices = window.speechSynthesis.getVoices();
      const optimalVoice = getOptimalVoice(voices, selectedVoiceURI, utterance.lang);
      if (optimalVoice) {
        utterance.voice = optimalVoice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        currentlySpeakingTextRef.current = cleanText;
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        currentlySpeakingTextRef.current = '';
        if (onComplete) onComplete();
      };
      utterance.onerror = (e) => {
        console.warn('[VoiceReceptionist] Utterance error:', e);
        setIsSpeaking(false);
        currentlySpeakingTextRef.current = '';
        if (onComplete) onComplete();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[VoiceReceptionist] Speech synthesis error:', e);
      setIsSpeaking(false);
      currentlySpeakingTextRef.current = '';
      if (onComplete) onComplete();
    }
  };

  // Direct Audio Recording Fallback using MediaRecorder & Gemini
  const startAudioRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSpeechError('Microphone audio is not supported in this browser. Please type below.');
      setIsListening(false);
      return;
    }

    try {
      isManuallyStoppedRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus'
        : (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/mp4'))
        ? 'audio/mp4'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        cleanupAudioStream();
        setIsRecordingAudio(false);
        setIsListening(false);

        if (audioChunksRef.current.length === 0) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        if (audioBlob.size < 200) return;

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            try {
              const base64Data = reader.result as string;
              const res = await fetch('/api/gemini/voice-transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audio: base64Data,
                  mimeType,
                  language: profile?.language || 'en',
                }),
              });

              if (res.ok) {
                const data = await res.json();
                if (data.text && data.text.trim()) {
                  const transcribed = data.text.trim();
                  setInputText(transcribed);
                  setLiveSpokenText(transcribed);
                  handleSendMessage(transcribed);
                }
              }
            } catch (postErr) {
              console.error('[VoiceReceptionist] Transcribe post failed:', postErr);
            } finally {
              setIsTranscribing(false);
            }
          };
        } catch (err) {
          console.error('[VoiceReceptionist] Audio read failed:', err);
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecordingAudio(true);
      setIsListening(true);
      setSpeechError(null);
    } catch (err: any) {
      console.warn('[VoiceReceptionist] Audio recording error:', err);
      setSpeechError('Microphone permission blocked. Please allow mic access in browser settings or type below.');
      setIsRecordingAudio(false);
      setIsListening(false);
    }
  };

  const stopAudioRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    cleanupAudioStream();
  };

  // Start Microphone and Speech Recognition immediately (Continuous loop with barge-in & interleave support)
  const startListening = (forceStopAssistant = false) => {
    isManuallyStoppedRef.current = false;
    setSpeechError(null);
    setIsListening(true);

    // Stop assistant speaking only if explicitly instructed (e.g. user gesture)
    if (forceStopAssistant && typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      currentlySpeakingTextRef.current = '';
    }

    const SpeechRecognition =
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    if (!SpeechRecognition) {
      // If Web Speech API is absent (e.g. Firefox Android), use direct audio recording
      startAudioRecording();
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }

      const recognition = new SpeechRecognition();
      // Single utterance loop cleanly catches continuous speech across Android & iOS
      recognition.continuous = false;
      recognition.interimResults = true;

      // Auto-match Android Google Speech engine locale (e.g. en-GB, en-US, id-ID, fr-FR)
      const deviceLang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
      const langCode = profile?.language === 'id'
        ? 'id-ID'
        : profile?.language === 'fr'
        ? 'fr-FR'
        : (profile?.language === 'en' ? (deviceLang.startsWith('en') ? deviceLang : 'en-US') : deviceLang);
      recognition.lang = langCode;

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onaudiostart = () => {
        setIsListening(true);
      };

      recognition.onsoundstart = () => {
        setIsListening(true);
      };

      recognition.onspeechstart = () => {
        setIsListening(true);
      };

      // Spoken text is IMMEDIATELY written into both input and live bubble!
      recognition.onresult = (event: any) => {
        let fullTranscript = '';

        for (let i = 0; i < event.results.length; ++i) {
          const piece = event.results[i][0]?.transcript || '';
          if (piece.trim()) {
            fullTranscript += (fullTranscript ? ' ' : '') + piece.trim();
          }
        }

        const trimmed = fullTranscript.trim();
        if (trimmed) {
          // 1. Barge-in detection: If assistant is speaking aloud, user is cutting in!
          if (isSpeaking) {
            const assistantSpeech = (currentlySpeakingTextRef.current || '').toLowerCase();
            const isEcho =
              assistantSpeech &&
              assistantSpeech.includes(trimmed.toLowerCase()) &&
              trimmed.length < 15;

            if (!isEcho) {
              // Genuine user interruption: Cut off assistant voice immediately!
              if (typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.cancel();
              }
              setIsSpeaking(false);
              currentlySpeakingTextRef.current = '';
            }
          }

          setInputText(trimmed);
          setLiveSpokenText(trimmed);
          latestTextRef.current = trimmed;

          // Auto-scroll to keep live words visible
          if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
          }

          // Debounced auto-send after 1.1 seconds of silence
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(() => {
            if (latestTextRef.current && latestTextRef.current.trim().length > 1) {
              const toSend = latestTextRef.current.trim();
              latestTextRef.current = '';
              setLiveSpokenText('');

              if (isLoadingRef.current) {
                // User spoke while previous request was still analysing!
                const isInterrupt = /^(wait|actually|no|cancel|stop|nevermind|instead|hold on|sorry)/i.test(toSend);
                if (isInterrupt && abortControllerRef.current) {
                  abortControllerRef.current.abort();
                  abortControllerRef.current = null;
                  setIsLoading(false);
                  handleSendMessage(toSend);
                } else {
                  // Queue additional input to run seamlessly once current turn completes
                  queuedMessageRef.current = toSend;
                  setQueuedMessageText(toSend);
                }
              } else {
                handleSendMessage(toSend);
              }
            }
          }, 1100);
        }
      };

      recognition.onerror = (event: any) => {
        const err = event.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          setSpeechError(
            'Microphone permission blocked. In Android Chrome, tap the 🔒 icon beside health-tracker.co.uk in the address bar > Permissions > Microphone > Allow, or record an audio note below.'
          );
          setIsListening(false);
        } else if (err === 'audio-capture') {
          setSpeechError('No microphone detected. Please check audio permissions or type below.');
          setIsListening(false);
        } else if (err === 'network') {
          console.warn('[VoiceReceptionist] Speech network socket unavailable. Switching to direct audio recording.');
          startAudioRecording();
        } else if (err !== 'no-speech' && err !== 'aborted') {
          console.warn('[VoiceReceptionist] Speech error:', err);
          setSpeechError(`Speech notice: ${err}. You can type below.`);
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        // If recognition stops but user had spoken text, send/queue it
        if (latestTextRef.current && latestTextRef.current.trim().length > 1) {
          const toSend = latestTextRef.current.trim();
          latestTextRef.current = '';
          setLiveSpokenText('');

          if (isLoadingRef.current) {
            const isInterrupt = /^(wait|actually|no|cancel|stop|nevermind|instead|hold on|sorry)/i.test(toSend);
            if (isInterrupt && abortControllerRef.current) {
              abortControllerRef.current.abort();
              abortControllerRef.current = null;
              setIsLoading(false);
              handleSendMessage(toSend);
            } else {
              queuedMessageRef.current = toSend;
              setQueuedMessageText(toSend);
            }
          } else {
            handleSendMessage(toSend);
          }
        }

        // Loop seamlessly whenever modal is open (never stops during isLoading or isSpeaking!)
        if (isOpenRef.current && !isManuallyStoppedRef.current) {
          setTimeout(() => {
            if (isOpenRef.current && !isManuallyStoppedRef.current) {
              startListening(false);
            }
          }, 100);
          return;
        }

        setIsListening(false);
      };

      // Anchor to window to prevent JavaScriptCore GC in mobile browsers
      (window as any).__activeVoiceRec = recognition;
      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.warn('[VoiceReceptionist] Failed to start recognition, falling back to direct recording:', err);
      startAudioRecording();
    }
  };

  // Stop listening
  const stopListening = () => {
    isManuallyStoppedRef.current = true;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    if (isRecordingAudio) {
      stopAudioRecording();
    }
    setIsListening(false);
    cleanupAudioStream();
  };

  // Toggle listening button (live pause/resume, or legacy start/stop)
  const toggleListening = () => {
    if (liveModeRef.current === 'connecting') {
      // A tap while handshaking used to kill the session mid-connect (the
      // mic-permission prompt invites exactly this tap). Ignore it instead.
      return;
    }
    if (liveModeRef.current === 'live') {
      // Pause the live session (mic + speaker off) but keep the drawer open.
      isManuallyStoppedRef.current = true;
      const c = liveClientRef.current;
      liveClientRef.current = null;
      if (c) void c.disconnect('mic-toggle');
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch {}
      }
      if (speakerQuietTimerRef.current) {
        clearTimeout(speakerQuietTimerRef.current);
        speakerQuietTimerRef.current = null;
      }
      speakerActiveRef.current = false;
      setLiveMode('legacy');
      setIsListening(false);
      setIsSpeaking(false);
      setLiveSpokenText('');
      setLiveReplyPreview('');
      return;
    }
    if (isSpeaking && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      currentlySpeakingTextRef.current = '';
    }
    if (isListening || isRecordingAudio) {
      isManuallyStoppedRef.current = true;
      stopListening();
    } else {
      isManuallyStoppedRef.current = false;
      // Prefer a fresh live session; fall back to legacy when live failed.
      if (isLiveVoiceSupported() && !liveFailedRef.current && isVoiceActive) {
        void startLiveSession();
      } else {
        setLiveMode('legacy');
        startListening(true);
      }
    }
  };

  // Open FAB: live voice first (sub-400ms studio duplex), legacy fallback.
  const handleOpenFab = () => {
    setIsOpen(true);
    isOpenRef.current = true;
    isManuallyStoppedRef.current = false;
    liveFailedRef.current = false;
    setSpeechError(null);
    setIsListening(true);

    if (isVoiceActive && isLiveVoiceSupported()) {
      void startLiveSession();
      return;
    }

    // Legacy path: prime audio synthesis on user gesture, then listen.
    setLiveMode('legacy');
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        const unlock = new SpeechSynthesisUtterance(' ');
        unlock.volume = 0.01;
        window.speechSynthesis.speak(unlock);
      } catch {}
    }

    // Start listening immediately
    startListening(true);
  };

  // Close Receptionist Modal
  const handleClose = () => {
    isManuallyStoppedRef.current = true;
    const liveClient = liveClientRef.current;
    liveClientRef.current = null;
    if (liveClient) void liveClient.disconnect('drawer-close');
    if (speakerQuietTimerRef.current) {
      clearTimeout(speakerQuietTimerRef.current);
      speakerQuietTimerRef.current = null;
    }
    speakerActiveRef.current = false;
    setLiveMode('idle');
    setLiveReplyPreview('');
    liveUserRef.current = '';
    liveAssistantRef.current = '';
    liveActionRef.current = undefined;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    currentlySpeakingTextRef.current = '';
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    queuedMessageRef.current = '';
    setQueuedMessageText('');
    stopListening();
    setLiveSpokenText('');
    setIsOpen(false);
    isOpenRef.current = false;
  };

  // Highlight DOM element co-pilot utility
  const highlightElement = (selector: string) => {
    try {
      const el = document.querySelector(selector) as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-4', 'ring-indigo-500', 'ring-offset-2', 'animate-pulse');
        setTimeout(() => {
          el.classList.remove('ring-4', 'ring-indigo-500', 'ring-offset-2', 'animate-pulse');
        }, 4000);
      }
    } catch {}
  };

  // ---------- VOICE-LIVE-1 Phase 3: native Live voice path ----------

  const liveTimestamp = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Merge incremental transcript segments without duplicating overlaps.
  // (Single implementation lives in the live client for unit testing.)
  const appendTranscript = (prev: string, next: string): string =>
    mergeLiveTranscript(prev, next);

  // Flush one completed live turn into the transcript (user + assistant).
  const flushLiveTurn = () => {
    const userText = liveUserRef.current.trim();
    const asstText = liveAssistantRef.current.trim();
    if (userText) {
      const userMsg: ChatTurn = {
        id: `lu_${Date.now()}`,
        role: 'user',
        text: userText,
        timestamp: liveTimestamp(),
      };
      setMessages((prev) => [...prev, userMsg]);
    }
    if (asstText || userText) {
      const botMsg: ChatTurn = {
        id: `la_${Date.now()}`,
        role: 'assistant',
        text: asstText || '🎙️ (spoken reply — audio played, transcript unavailable)',
        timestamp: liveTimestamp(),
        actionTaken: liveActionRef.current,
      };
      setMessages((prev) => [...prev, botMsg]);
    }
    liveUserRef.current = '';
    liveAssistantRef.current = '';
    liveActionRef.current = undefined;
    setLiveSpokenText('');
    setLiveReplyPreview('');
    setIsLoading(false);
    setIsSpeaking(false);
    speakerActiveRef.current = false;
  };

  // Execute a Live tool call against app state, then answer the model so it
  // keeps speaking without breaking the audio stream.
  const executeLiveTool = async (call: LiveToolCall) => {
    const client = liveClientRef.current;
    const { id, name } = call;
    const a = (call.args || {}) as Record<string, any>;
    const answer = (result: any) => {
      try {
        client?.sendToolResult(id, name || 'unknown', result);
      } catch {}
    };
    try {
      if (name === 'update_profile') {
        const updates = (a.updates && typeof a.updates === 'object' ? a.updates : a) as Record<string, any>;
        const baseProfile: UserProfile = profile || {
          uid: 'user_' + Date.now(),
          email: '',
          nickname: updates.name || 'User',
          language: 'en',
          unitPreference: 'SI',
        };
        const nextProfile: UserProfile = { ...baseProfile };
        const changeDetails: string[] = [];
        ['age', 'gender', 'ethnicity', 'height', 'weight', 'healthGoal', 'language'].forEach((k) => {
          if (updates[k] !== undefined && updates[k] !== null && updates[k] !== '') {
            (nextProfile as any)[k] = updates[k];
            changeDetails.push(`${k}: ${updates[k]}`);
          }
        });
        if (updates.heightCm && !nextProfile.height) {
          nextProfile.height = Number(updates.heightCm) || updates.heightCm;
          changeDetails.push(`height: ${updates.heightCm}cm`);
        }
        if (updates.weightKg && !nextProfile.weight) {
          nextProfile.weight = Number(updates.weightKg) || updates.weightKg;
          changeDetails.push(`weight: ${updates.weightKg}kg`);
        }
        if (changeDetails.length > 0) {
          setProfile(nextProfile);
          await saveAndSync(
            nextProfile,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report,
            { type: 'profile' }
          );
          liveActionRef.current = {
            type: 'profile_updated',
            details: `Saved to Profile: ${changeDetails.join(', ')}`,
          };
        }
        answer({ ok: true, applied: changeDetails });
      } else if (name === 'navigate_tab') {
        const raw = String(a.tab || '').toLowerCase();
        const tabMap: Record<string, string> = {
          food: 'food',
          meals: 'food',
          biomarker: 'health',
          biomarkers: 'health',
          health: 'health',
          trends: 'trends',
          trend: 'trends',
          insights: 'insights',
          insight: 'insights',
          home: 'home',
        };
        const target = tabMap[raw] || raw;
        if (target) {
          setActiveTab(target);
          highlightElement(`#nav-tab-${target}`);
          liveActionRef.current = { type: 'navigated', details: `Navigated to ${target}` };
        }
        answer({ ok: true, tab: target });
      } else if (name === 'handoff_specialist') {
        const detail = `Handoff to ${a.specialist || 'specialist'}${a.context ? `: ${a.context}` : ''}`;
        liveActionRef.current = { type: 'agent_handoff', details: detail };
        answer({ ok: true });
      } else if (name === 'log_meal') {
        const desc =
          a.description ||
          (Array.isArray(a.items) ? a.items.join(', ') : 'meal');
        liveActionRef.current = { type: 'highlight', details: `Meal noted: ${desc}` };
        answer({ ok: true, noted: desc });
      } else {
        answer({ ok: false, error: `unknown tool: ${name}` });
      }
    } catch (err: any) {
      answer({ ok: false, error: String(err?.message || err) });
    }
  };

  // Open the bidirectional Live session (mic 16kHz up, studio voice down).
  const startLiveSession = async () => {
    if (typeof window === 'undefined' || !isLiveVoiceSupported()) {
      setLiveMode('legacy');
      startListening(true);
      return;
    }
    if (liveClientRef.current) {
      try {
        await liveClientRef.current.disconnect();
      } catch {}
      liveClientRef.current = null;
    }
    setLiveMode('connecting');
    setSpeechError(null);
    const client = new GeminiLiveAudioClient({
      onReady: () => {
        setLiveMode('live');
        isManuallyStoppedRef.current = false;
        setIsListening(true);
        setSpeechError(null);
      },
      onInputTranscription: (text) => {
        liveUserRef.current = appendTranscript(liveUserRef.current, text);
        setLiveSpokenText(liveUserRef.current);
        setIsLoading(true);
      },
      onOutputTranscription: (text) => {
        liveAssistantRef.current = appendTranscript(liveAssistantRef.current, text);
        setLiveReplyPreview(liveAssistantRef.current);
      },
      onAssistantText: (text) => {
        liveAssistantRef.current = appendTranscript(liveAssistantRef.current, text);
        setLiveReplyPreview(liveAssistantRef.current);
      },
      onInterrupted: () => {
        setIsSpeaking(false);
        speakerActiveRef.current = false;
      },
      onTurnComplete: () => {
        flushLiveTurn();
      },
      onToolCall: (calls) => {
        for (const c of calls) void executeLiveTool(c);
      },
      onMicLevel: (level) => {
        if (liveModeRef.current !== 'live') return;
        setAudioLevel(level);
        // Local barge-in: user cutting in over speaker audio.
        if (level > 25 && speakerActiveRef.current) {
          try {
            liveClientRef.current?.interrupt();
          } catch {}
          speakerActiveRef.current = false;
          setIsSpeaking(false);
        }
      },
      onSpeakerLevel: (level) => {
        if (liveModeRef.current !== 'live') return;
        setAudioLevel(level);
        if (level > 0) {
          speakerActiveRef.current = true;
          setIsSpeaking(true);
          if (speakerQuietTimerRef.current) {
            clearTimeout(speakerQuietTimerRef.current);
            speakerQuietTimerRef.current = null;
          }
        } else if (speakerActiveRef.current && !speakerQuietTimerRef.current) {
          speakerQuietTimerRef.current = setTimeout(() => {
            speakerQuietTimerRef.current = null;
            speakerActiveRef.current = false;
            if (liveModeRef.current === 'live') setIsSpeaking(false);
          }, 700);
        }
      },
      onError: (message) => {
        if (liveModeRef.current === 'live') {
          setSpeechError(message);
        } else {
          liveFailedRef.current = true;
          setLiveMode('legacy');
          setSpeechError(`${message} — using basic voice mode.`);
          if (isOpenRef.current && !isManuallyStoppedRef.current) startListening(true);
        }
      },
      onClosed: () => {
        if (liveModeRef.current === 'live' || liveModeRef.current === 'connecting') {
          setLiveMode('legacy');
          setIsListening(false);
          setIsSpeaking(false);
        }
      },
      onAutoSleep: () => {
        setLiveMode('legacy');
        setIsListening(false);
        setIsSpeaking(false);
        setSpeechError('Live session rested after 45s of quiet — tap the mic to resume.');
      },
      onStatus: (message) => {
        setSpeechError(message);
      },
    });
    liveClientRef.current = client;
    const recentMealsSummary = (foodLogs || []).slice(0, 5).map((log) => ({
      date: log.date,
      name: log.name,
      calories: log.nutrients?.calories,
    }));
    try {
      await client.connect({
        profile,
        language: profile?.language || 'en',
        voice: liveVoice,
        recentMeals: recentMealsSummary,
      });
    } catch (err: any) {
      liveFailedRef.current = true;
      liveClientRef.current = null;
      setLiveMode('legacy');
      setSpeechError(`${err?.message || 'Live voice unavailable'} — using basic voice mode.`);
      if (isOpenRef.current && !isManuallyStoppedRef.current) startListening(true);
    }
  };

  // Typed message routing: live socket when connected, legacy REST otherwise.
  const sendLiveText = (text: string) => {
    const t = (text || '').trim();
    if (!t) return;
    setInputText('');
    setLiveSpokenText('');
    latestTextRef.current = '';
    setMessages((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, role: 'user', text: t, timestamp: liveTimestamp() },
    ]);
    // User bubble already appended — don't re-flush it on turnComplete.
    liveUserRef.current = '';
    liveAssistantRef.current = '';
    setIsLoading(true);
    try {
      liveClientRef.current?.sendText(t);
    } catch {}
  };

  const dispatchUserText = (text: string) => {
    if (liveModeRef.current === 'live' && liveClientRef.current?.isConnected) {
      sendLiveText(text);
      return;
    }
    stopListening();
    handleSendMessage(text);
  };

  const changeLiveVoice = (voice: LiveVoicePersona) => {
    setLiveVoice(voice);
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem('ht_live_voice', voice);
    } catch {}
    // Reconnect so the new persona applies immediately.
    if (liveModeRef.current === 'live' && isOpenRef.current) {
      const c = liveClientRef.current;
      liveClientRef.current = null;
      if (c) {
        void c.disconnect('voice-change').then(() => {
          if (isOpenRef.current) void startLiveSession();
        });
      } else {
        void startLiveSession();
      }
    }
  };

  // ---------- legacy REST dispatch (Basic fallback path) ----------

  // Dispatch message to Receptionist Agent
  const handleSendMessage = async (text: string) => {
    if (!text || text.trim().length === 0) return;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Abort previous in-flight request if user is interrupting/overriding
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {}
      abortControllerRef.current = null;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMsgText = text.trim();
    setInputText('');
    setLiveSpokenText('');
    latestTextRef.current = '';

    const userMsg: ChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: userMsgText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Format recent food logs so receptionist has full meal awareness
      const recentMealsSummary = (foodLogs || []).slice(0, 5).map((log) => ({
        date: log.date,
        name: log.name,
        calories: log.nutrients?.calories,
        protein: log.nutrients?.protein,
        carbs: log.nutrients?.carbohydrates,
        fat: log.nutrients?.totalFat,
        sodium: log.nutrients?.sodium,
        recommendation: log.recommendation || log.verdict?.label,
      }));

      const res = await fetch('/api/gemini/front-desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          message: userMsgText,
          profile,
          biomarkers,
          biomarkerHistory,
          foodLogs: recentMealsSummary,
          history: messages.slice(-8).map((m) => ({ role: m.role, content: m.text })),
          engine: 'gemini-3.5-flash-lite',
          existingMemory: memoryRef.current,
          specialistContainers: { activeTab },
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const replyText = data.userResponse || data.text || 'I processed that for you.';
      if (data.memory) {
        memoryRef.current = data.memory;
      }

      let actionTaken: ChatTurn['actionTaken'] = undefined;

      // 1. Check if profile was updated via updatedProfile, modificationCommand, or memory snapshots
      const incomingUpdates: Record<string, any> = {
        ...(data.updatedProfile || {}),
      };

      if (Array.isArray(data.modificationCommand)) {
        for (const cmd of data.modificationCommand) {
          if (cmd.action === 'update_profile' && cmd.keyName) {
            incomingUpdates[cmd.keyName] = cmd.newValue;
          }
        }
      }

      if (data.memory?.userProfileSnapshot) {
        const snap = data.memory.userProfileSnapshot;
        ['age', 'gender', 'ethnicity', 'heightCm', 'weightKg', 'targetWeightKg'].forEach((k) => {
          if (snap[k] !== undefined && snap[k] !== null && incomingUpdates[k] === undefined) {
            incomingUpdates[k] = snap[k];
          }
        });
      }

      const baseProfile: UserProfile = profile || {
        uid: 'user_' + Date.now(),
        email: '',
        nickname: incomingUpdates.name || 'User',
        language: 'en',
        unitPreference: 'SI',
      };
      const nextProfile: UserProfile = { ...baseProfile };
      let hasChanges = false;
      const changeDetails: string[] = [];

      ['age', 'gender', 'ethnicity', 'height', 'weight', 'healthGoal'].forEach((k) => {
        if (incomingUpdates[k] !== undefined && incomingUpdates[k] !== null && incomingUpdates[k] !== '') {
          (nextProfile as any)[k] = incomingUpdates[k];
          hasChanges = true;
          changeDetails.push(`${k}: ${incomingUpdates[k]}`);
        }
      });

      // Also check heightCm / weightKg
      if (incomingUpdates.heightCm && (!nextProfile.height || nextProfile.height !== incomingUpdates.heightCm)) {
        nextProfile.height = Number(incomingUpdates.heightCm) || incomingUpdates.heightCm;
        hasChanges = true;
        changeDetails.push(`height: ${incomingUpdates.heightCm}cm`);
      }
      if (incomingUpdates.weightKg && (!nextProfile.weight || nextProfile.weight !== incomingUpdates.weightKg)) {
        nextProfile.weight = Number(incomingUpdates.weightKg) || incomingUpdates.weightKg;
        hasChanges = true;
        changeDetails.push(`weight: ${incomingUpdates.weightKg}kg`);
      }

      if (hasChanges) {
        setProfile(nextProfile);
        await saveAndSync(
          nextProfile,
          foodLogs,
          biomarkers,
          biomarkerHistory,
          actions,
          dailyBenefits,
          report,
          { type: 'profile' }
        );
        actionTaken = {
          type: 'profile_updated',
          details: `Saved to Profile: ${changeDetails.join(', ')}`,
        };
      }

      // 2. Check for Navigation / Co-Pilot intent in the conversation
      const lowerReply = (replyText + ' ' + userMsgText).toLowerCase();
      if (lowerReply.includes('go to food') || lowerReply.includes('opening food') || lowerReply.includes('food tab')) {
        if (activeTab !== 'food') {
          setActiveTab('food');
          highlightElement('#nav-tab-food');
          actionTaken = { type: 'navigated', details: 'Navigated to Food History' };
        }
      } else if (lowerReply.includes('go to biomarker') || lowerReply.includes('view biomarkers') || lowerReply.includes('health tab')) {
        if (activeTab !== 'health' && activeTab !== 'insights') {
          setActiveTab('health');
          highlightElement('#nav-tab-health');
          actionTaken = { type: 'navigated', details: 'Navigated to Health Biomarkers' };
        }
      } else if (lowerReply.includes('trends tab') || lowerReply.includes('view trends')) {
        if (activeTab !== 'trends') {
          setActiveTab('trends');
          highlightElement('#nav-tab-trends');
          actionTaken = { type: 'navigated', details: 'Navigated to Trends' };
        }
      }

      // 3. Check for Specialist Agent Handoff
      if (data.handoffPayload) {
        if (data.targetAgent === 'medical' && onOpenMedical) {
          actionTaken = { type: 'agent_handoff', details: 'Ready for Medical Specialist Lab Review' };
        } else if (data.targetAgent === 'health_coach') {
          actionTaken = { type: 'agent_handoff', details: 'Handoff to Health Coach' };
        }
      }

      const botMsg: ChatTurn = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actionTaken,
        uiForm: data.uiForm || null,
      };

      setMessages((prev) => [...prev, botMsg]);

      // Speak response aloud and keep listening for continuous conversation!
      if (isVoiceActive && isSpeakingEnabled) {
        speakResponse(replyText, () => {
          if (isOpenRef.current) {
            startListening(false);
          }
        });
      } else if (isOpenRef.current) {
        startListening(false);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        console.log('[VoiceReceptionist] Request was aborted by user steer/interruption');
      } else {
        console.error('[VoiceReceptionist] Dispatch failed:', err);
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            text: "I'm having trouble connecting right now, but feel free to try again or ask me another question.",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;

      // If user spoke additional input while this request was running, dispatch queued message seamlessly!
      if (queuedMessageRef.current) {
        const nextMessage = queuedMessageRef.current;
        queuedMessageRef.current = '';
        setQueuedMessageText('');
        setTimeout(() => {
          handleSendMessage(nextMessage);
        }, 200);
      }
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      const liveClient = liveClientRef.current;
      liveClientRef.current = null;
      if (liveClient) void liveClient.disconnect('unmount');
      cleanupAudioStream();
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  return (
    <>
      {/* Floating Receptionist Trigger Button (Bottom Right) */}
      {!isOpen && (
        <div className="fixed bottom-24 right-4 sm:bottom-22 sm:right-6 z-40 flex items-center gap-2">
          {missingFields.length > 0 && (
            <div
              onClick={handleOpenFab}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/90 text-white rounded-full text-xs font-semibold shadow-lg backdrop-blur cursor-pointer hover:bg-indigo-700 transition-all animate-bounce"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>{missingFields.length} profile items to set</span>
            </div>
          )}
          <button
            id="voice-receptionist-fab"
            onClick={handleOpenFab}
            aria-label="Open Voice Receptionist"
            className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-xl hover:shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-all duration-300 focus:outline-none cursor-pointer"
          >
            {(isListening || isSpeaking) && (
              <span className="absolute inset-0 rounded-full bg-indigo-400 opacity-75 animate-ping" />
            )}
            <div className="relative flex items-center justify-center">
              <Mic className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-white" />
            </div>
          </button>
        </div>
      )}

      {/* Expanded Voice Receptionist Drawer/Panel */}
      {isOpen && (
        <div className="fixed inset-x-2 bottom-18 sm:inset-auto sm:bottom-22 sm:right-6 sm:w-[420px] max-h-[85vh] z-50 flex flex-col bg-theme-bg-card/95 backdrop-blur-xl border border-theme-border shadow-2xl rounded-3xl overflow-hidden animate-slide-up">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white">
            <div className="flex items-center gap-2.5">
              <div className="relative w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-amber-300" />
                {(isListening || isSpeaking) && (
                  <div className="absolute -bottom-0.5 -right-0.5 flex gap-0.5 items-end h-3">
                    <span className="w-0.5 h-2 bg-emerald-300 animate-pulse" />
                    <span className="w-0.5 h-3 bg-emerald-300 animate-pulse delay-75" />
                    <span className="w-0.5 h-1.5 bg-emerald-300 animate-pulse delay-150" />
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-bold leading-tight flex items-center gap-1.5">
                  Health Concierge & Receptionist
                  {liveMode === 'live' ? (
                    <span className="px-1.5 py-px rounded-full bg-emerald-400/90 text-emerald-950 text-[9px] font-extrabold tracking-wide">
                      ● LIVE
                    </span>
                  ) : liveMode === 'connecting' ? (
                    <span className="px-1.5 py-px rounded-full bg-amber-300/90 text-amber-950 text-[9px] font-extrabold tracking-wide animate-pulse">
                      CONNECTING…
                    </span>
                  ) : (
                    <span
                      className="px-1.5 py-px rounded-full bg-white/25 text-white text-[9px] font-extrabold tracking-wide"
                      title="Basic voice mode (browser speech + text engine)"
                    >
                      BASIC
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-indigo-100 flex items-center gap-1.5">
                  {isListening ? (
                    <span className="flex items-center gap-1 text-emerald-300 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
                      Listening now... Speak freely
                    </span>
                  ) : isSpeaking ? (
                    <span className="text-amber-200 font-medium flex items-center gap-1">
                      <Volume2 className="w-3 h-3 animate-pulse" /> Concierge speaking...
                    </span>
                  ) : isLoading ? (
                    <span className="text-indigo-200 flex items-center gap-1">
                      <Loader className="w-3 h-3 animate-spin" /> Processing...
                    </span>
                  ) : (
                    <span>Ready · Tap mic to speak or type</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Voice & Sound Settings Toggle */}
              <button
                type="button"
                onClick={() => setIsVoiceSettingsOpen(!isVoiceSettingsOpen)}
                title="Voice & Speed Settings"
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  isVoiceSettingsOpen ? 'bg-white/30 text-white' : 'hover:bg-white/20 text-white'
                }`}
              >
                <Sliders className="w-4 h-4" />
              </button>

              {/* Speech Output Audio Toggle */}
              <button
                onClick={() => {
                  if (isSpeaking && typeof window !== 'undefined') window.speechSynthesis?.cancel();
                  setIsSpeakingEnabled(!isSpeakingEnabled);
                }}
                title={isSpeakingEnabled ? 'Mute voice output' : 'Enable voice output'}
                className="p-1.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
              >
                {isSpeakingEnabled ? <Volume2 className="w-4 h-4 text-white" /> : <VolumeX className="w-4 h-4 text-indigo-200" />}
              </button>

              {/* Close Button */}
              <button
                onClick={handleClose}
                className="p-1.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          {/* Voice Settings Expandable Panel */}
          {isVoiceSettingsOpen && (
            <div className="p-3 bg-indigo-50 dark:bg-slate-900 border-b border-indigo-200 dark:border-indigo-950 space-y-2.5 text-xs animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-600" /> Receptionist Voice & Sound
                </span>
                <button
                  type="button"
                  onClick={() => setIsVoiceSettingsOpen(false)}
                  className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  Done
                </button>
              </div>

              {/* Live Voice Persona (native studio voices; applies immediately) */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Live Voice Persona (studio voice):
                </label>
                {isLiveVoiceSupported() ? (
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { id: 'Aoede', hint: 'Warm' },
                        { id: 'Charon', hint: 'Deep' },
                        { id: 'Kore', hint: 'Bright' },
                      ] as { id: LiveVoicePersona; hint: string }[]
                    ).map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => changeLiveVoice(v.id)}
                        className={`flex-1 px-2 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${
                          liveVoice === v.id
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-theme-border hover:border-indigo-400'
                        }`}
                      >
                        {v.id}
                        <span className="block text-[9px] font-medium opacity-75">{v.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Live voice needs microphone + WebSocket support — basic mode is active on this browser.
                  </p>
                )}
              </div>

              {/* Voice Selector */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Basic-mode Voice Model ({availableVoices.length > 0 ? `${availableVoices.length} detected` : 'Detecting voices...'}):
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedVoiceURI || getOptimalVoice(availableVoices, '', profile?.language || 'en')?.voiceURI || ''}
                    onChange={(e) => {
                      const newUri = e.target.value;
                      setSelectedVoiceURI(newUri);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('ht_receptionist_voice', newUri);
                      }
                    }}
                    className="flex-1 bg-white dark:bg-slate-800 border border-theme-border rounded-xl px-2.5 py-1.5 text-xs text-theme-text focus:outline-none focus:ring-1 focus:ring-indigo-500 truncate"
                  >
                    {availableVoices.length === 0 ? (
                      <option value="">Default System Voice</option>
                    ) : (
                      [...availableVoices]
                        .sort((a, b) => {
                          const lang = (profile?.language || 'en').toLowerCase();
                          const aMatch = a.lang.toLowerCase().startsWith(lang) ? 1 : 0;
                          const bMatch = b.lang.toLowerCase().startsWith(lang) ? 1 : 0;
                          return bMatch - aMatch;
                        })
                        .map((v) => (
                          <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name} ({v.lang}){!v.localService ? ' ★ HD Online' : ''}
                          </option>
                        ))
                    )}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      const uri = selectedVoiceURI || getOptimalVoice(availableVoices, '', profile?.language || 'en')?.voiceURI || '';
                      testVoice(uri, voiceSpeed);
                    }}
                    title="Audition voice"
                    className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer shadow-sm transition-all"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Test</span>
                  </button>
                </div>
              </div>

              {/* Speed Slider */}
              <div className="pt-1">
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  <span>Speech Rate: {voiceSpeed.toFixed(1)}x</span>
                  <span>{voiceSpeed < 1.0 ? 'Calm & Slow' : voiceSpeed > 1.0 ? 'Brisk' : 'Natural (Normal)'}</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  value={voiceSpeed}
                  onChange={(e) => {
                    const spd = parseFloat(e.target.value);
                    setVoiceSpeed(spd);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('ht_receptionist_rate', String(spd));
                    }
                  }}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Quick Context & Missing Fields Pill Bar */}
          <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-theme-border/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs">
            {missingFields.length > 0 && (
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider shrink-0 mr-1">
                To Complete:
              </span>
            )}
            {missingFields.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setInputText(f.prompt);
                }}
                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-full shrink-0 text-[11px] font-medium transition-colors cursor-pointer"
              >
                + {f.label}
              </button>
            ))}

            {/* Quick Action Pills */}
            <button
              onClick={() => dispatchUserText('Review what I ate today and give me recommendations')}
              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-full shrink-0 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
            >
              <Utensils className="w-3 h-3" /> Review today's meals
            </button>
            <button
              onClick={() => {
                setActiveTab('food');
                dispatchUserText('Take me to my food history');
              }}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full shrink-0 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
            >
              <Compass className="w-3 h-3" /> Go to Food
            </button>
            <button
              onClick={() => {
                setActiveTab('health');
                dispatchUserText('Show my health biomarkers');
              }}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full shrink-0 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
            >
              <Activity className="w-3 h-3" /> Go to Biomarkers
            </button>
          </div>

          {/* Chat Transcript Area */}
          <div
            ref={chatScrollRef}
            className="flex-1 p-3.5 space-y-3 overflow-y-auto max-h-[380px] min-h-[220px] text-xs"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed shadow-sm ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-theme-border/30 text-theme-text rounded-bl-none border border-theme-border/50'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>

                {/* Inline Action Indicator Badge */}
                {m.actionTaken && (
                  <div className="mt-1 flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-[10px] text-emerald-700 dark:text-emerald-300 font-medium">
                    <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-500" />
                    <span>{m.actionTaken.details}</span>
                  </div>
                )}

                {/* Inline Receptionist Interactive UI Form */}
                {m.uiForm && m.uiForm.fields && m.uiForm.fields.length > 0 && (
                  <div className="w-full max-w-[95%]">
                    <InlineProfileForm
                      form={m.uiForm}
                      profile={profile}
                      onSave={async (vals) => {
                        const baseProfile: UserProfile = profile || {
                          uid: 'user_' + Date.now(),
                          email: '',
                          nickname: 'User',
                          language: 'en',
                          unitPreference: 'SI',
                        };
                        const nextProfile: UserProfile = { ...baseProfile, ...vals };
                        if (vals.heightCm) nextProfile.height = Number(vals.heightCm) || vals.heightCm;
                        if (vals.weightKg) nextProfile.weight = Number(vals.weightKg) || vals.weightKg;
                        setProfile(nextProfile);
                        await saveAndSync(
                          nextProfile,
                          foodLogs,
                          biomarkers,
                          biomarkerHistory,
                          actions,
                          dailyBenefits,
                          report,
                          { type: 'profile' }
                        );
                        setMessages((prev) => [
                          ...prev,
                          {
                            id: `f_${Date.now()}`,
                            role: 'assistant',
                            text: 'Thank you! Your profile details have been saved.',
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            actionTaken: {
                              type: 'profile_updated',
                              details: `Saved: ${Object.entries(vals).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
                            },
                          },
                        ]);
                      }}
                    />
                  </div>
                )}

                <span className="text-[9px] text-slate-400 mt-0.5 px-1">{m.timestamp}</span>
              </div>
            ))}

            {/* Real-Time Live Streaming User Speech Bubble */}
            {liveSpokenText && (
              <div className="flex flex-col items-end animate-fade-in">
                <div className="max-w-[85%] rounded-2xl rounded-br-none px-3.5 py-2.5 bg-indigo-600/90 text-white shadow-md border border-indigo-400/50">
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-indigo-200 font-semibold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-ping" />
                    <span>Listening to you...</span>
                  </div>
                  <p className="whitespace-pre-wrap font-medium">
                    {liveSpokenText}
                    <span className="inline-block w-1.5 h-3.5 bg-white animate-pulse ml-1 align-middle" />
                  </p>
                </div>
              </div>
            )}

            {/* Real-Time Live Assistant Streaming Reply (native Live voice) */}
            {liveMode === 'live' && liveReplyPreview && (
              <div className="flex flex-col items-start animate-fade-in">
                <div className="max-w-[85%] rounded-2xl rounded-bl-none px-3.5 py-2.5 bg-purple-600/90 text-white shadow-md border border-purple-400/50">
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-purple-200 font-semibold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                    <span>Live reply...</span>
                  </div>
                  <p className="whitespace-pre-wrap font-medium">{liveReplyPreview}</p>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-xs py-1">
                <Loader className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                <span>
                  {liveMode === 'live'
                    ? 'Live voice is replying...'
                    : 'Receptionist is thinking... (Speak anytime to steer or add)'}
                </span>
              </div>
            )}
          </div>

          {/* Queued Message Banner */}
          {queuedMessageText && (
            <div className="px-3.5 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between">
              <div className="flex items-center gap-1.5 truncate">
                <Clock className="w-3.5 h-3.5 shrink-0 text-amber-600 animate-spin" />
                <span className="truncate">Queued: &ldquo;{queuedMessageText}&rdquo;</span>
              </div>
              <span className="text-[10px] opacity-75 shrink-0">Sending next</span>
            </div>
          )}

          {/* Active Listening / Recording / Speaking Soundwave Bar */}
          {(isListening || isRecordingAudio || isSpeaking) && (
            <div
              className={`px-3.5 py-2 border-t flex items-center justify-between text-xs transition-colors duration-200 ${
                isSpeaking && !liveSpokenText
                  ? 'bg-purple-500/10 border-purple-500/20 text-purple-700 dark:text-purple-300'
                  : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
              }`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Physical Audio Reactive Frequency Equalizer Bars */}
                <div className="flex items-end gap-1 h-4 shrink-0">
                  <span
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isSpeaking && !liveSpokenText ? 'bg-purple-500' : 'bg-red-500'
                    }`}
                    style={{ height: `${Math.max(4, Math.round((audioLevel / 100) * 16))}px` }}
                  />
                  <span
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isSpeaking && !liveSpokenText ? 'bg-purple-500' : 'bg-red-500'
                    }`}
                    style={{ height: `${Math.max(6, Math.round((audioLevel / 100) * 14 + 3))}px` }}
                  />
                  <span
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isSpeaking && !liveSpokenText ? 'bg-purple-500' : 'bg-red-500'
                    }`}
                    style={{ height: `${Math.max(3, Math.round((audioLevel / 100) * 16 + 2))}px` }}
                  />
                  <span
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isSpeaking && !liveSpokenText ? 'bg-purple-500' : 'bg-red-500'
                    }`}
                    style={{ height: `${Math.max(8, Math.round((audioLevel / 100) * 15 + 4))}px` }}
                  />
                </div>
                <span className="font-semibold shrink-0">
                  {isRecordingAudio
                    ? 'Recording voice note...'
                    : isSpeaking && !liveSpokenText
                    ? 'Speaking (Speak to cut in)...'
                    : isLoading
                    ? 'Thinking (Speak to steer)...'
                    : 'Listening...'}
                </span>
                <span className="italic truncate text-slate-700 dark:text-slate-200 font-medium">
                  {liveSpokenText
                    ? `"${liveSpokenText}"`
                    : isSpeaking
                    ? 'Microphone active — interrupt anytime'
                    : isLoading
                    ? 'Add more or say "Wait"...'
                    : 'Speak now...'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {isSpeaking && (
                  <button
                    type="button"
                    onClick={() => {
                      try { liveClientRef.current?.interrupt(); } catch {}
                      speakerActiveRef.current = false;
                      if (typeof window !== 'undefined' && window.speechSynthesis) {
                        window.speechSynthesis.cancel();
                      }
                      setIsSpeaking(false);
                      currentlySpeakingTextRef.current = '';
                    }}
                    className="px-2 py-1 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1"
                    title="Silence assistant speech"
                  >
                    <span>Mute</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (liveModeRef.current === 'live') {
                      // Live streams continuously — the button cuts assistant audio.
                      try { liveClientRef.current?.interrupt(); } catch {}
                      speakerActiveRef.current = false;
                      setIsSpeaking(false);
                      return;
                    }
                    if (isSpeaking && typeof window !== 'undefined' && window.speechSynthesis) {
                      window.speechSynthesis.cancel();
                      setIsSpeaking(false);
                      currentlySpeakingTextRef.current = '';
                    }
                    if (isRecordingAudio) {
                      stopAudioRecording();
                    } else if (latestTextRef.current.trim().length > 0) {
                      const toSend = latestTextRef.current.trim();
                      latestTextRef.current = '';
                      setLiveSpokenText('');
                      if (isLoadingRef.current && abortControllerRef.current) {
                        abortControllerRef.current.abort();
                        abortControllerRef.current = null;
                        setIsLoading(false);
                      }
                      handleSendMessage(toSend);
                    } else if (!isSpeaking) {
                      stopListening();
                    }
                  }}
                  className={`px-2.5 py-1 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1 ${
                    latestTextRef.current.trim().length > 0
                      ? 'bg-red-600 hover:bg-red-700 active:scale-95'
                      : 'bg-slate-500 hover:bg-slate-600'
                  }`}
                >
                  <span>
                    {latestTextRef.current.trim().length > 0
                      ? isLoading
                        ? 'Steer Now'
                        : 'Send Now'
                      : isSpeaking
                      ? 'Interrupt'
                      : 'Stop'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Transcribing Banner */}
          {isTranscribing && (
            <div className="px-3.5 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 border-t border-indigo-200 dark:border-indigo-800 text-[11px] text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
              <Loader className="w-3.5 h-3.5 animate-spin text-indigo-500" />
              <span>Transcribing your audio with AI...</span>
            </div>
          )}

          {/* Notice if speech error / permission needed */}
          {speechError && (
            <div className="px-3.5 py-2 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[11px] border-t border-amber-200 dark:border-amber-800 flex items-start gap-1.5 leading-snug">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <span>{speechError}</span>
                {!isRecordingAudio && (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={startAudioRecording}
                      className="px-2 py-0.5 bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/60 dark:hover:bg-amber-800/80 text-amber-900 dark:text-amber-100 rounded text-[10px] font-semibold transition-all cursor-pointer"
                    >
                      Record Voice Note instead
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bottom Input & Voice Control Bar */}
          <div className="p-2.5 bg-theme-bg-card border-t border-theme-border flex items-center gap-2">
            {/* Live Mic Button */}
            <button
              id="voice-receptionist-mic-btn"
              type="button"
              onClick={toggleListening}
              title={isListening ? 'Stop listening' : 'Start talking aloud'}
              className={`p-2.5 rounded-full transition-all flex items-center justify-center shrink-0 cursor-pointer ${
                isListening
                  ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/40 ring-2 ring-red-400'
                  : 'bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
              }`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Text Input for Typing / Real-time Spoken Text Display */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setLiveSpokenText(e.target.value);
                latestTextRef.current = e.target.value;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  dispatchUserText(inputText);
                }
              }}
              placeholder={isListening ? '🎙️ Listening... Speak now or type' : 'Talk aloud or type a message...'}
              className="flex-1 bg-slate-100 dark:bg-slate-800/80 border border-theme-border rounded-full px-3.5 py-2 text-xs text-theme-text focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />

            {/* Send Button */}
            <button
              type="button"
              onClick={() => {
                dispatchUserText(inputText);
              }}
              disabled={!inputText.trim() || isLoading}
              className="p-2 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-all shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
