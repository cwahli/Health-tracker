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
  Save
} from 'lucide-react';
import type { UserProfile, FoodLog } from '../types';

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

  // Dynamic soundwave oscillation when listening without locking hardware mic
  useEffect(() => {
    let interval: any = null;
    if (isListening || isRecordingAudio) {
      interval = setInterval(() => {
        setAudioLevel(() => {
          if (latestTextRef.current || liveSpokenText) {
            return Math.floor(Math.random() * 35) + 65;
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
  }, [isListening, isRecordingAudio, liveSpokenText]);

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
  }, [messages, isLoading, isSpeaking, liveSpokenText]);

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
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      // Find matching voice if available
      const voices = window.speechSynthesis.getVoices();
      const matchedVoice = voices.find(
        (v) => v.lang.startsWith(lang) || v.lang.replace('_', '-').startsWith(utterance.lang)
      );
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        if (onComplete) onComplete();
      };
      utterance.onerror = (e) => {
        console.warn('[VoiceReceptionist] Utterance error:', e);
        setIsSpeaking(false);
        if (onComplete) onComplete();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[VoiceReceptionist] Speech synthesis error:', e);
      setIsSpeaking(false);
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

  // Start Microphone and Speech Recognition immediately (WebKit/Android-safe single-shot loop)
  const startListening = () => {
    isManuallyStoppedRef.current = false;
    setSpeechError(null);
    setIsListening(true);

    // Stop assistant speaking before listening
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
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
      // Continuous = false (single utterance loop) reliably emits interim and final results across all mobile & desktop browsers!
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
          setInputText(trimmed);
          setLiveSpokenText(trimmed);
          latestTextRef.current = trimmed;

          // Auto-scroll to keep live words visible
          if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
          }

          // Debounced auto-send after 1.8 seconds of silence
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(() => {
            if (latestTextRef.current && latestTextRef.current.trim().length > 1 && !isLoadingRef.current) {
              const toSend = latestTextRef.current.trim();
              latestTextRef.current = '';
              setLiveSpokenText('');
              stopListening();
              handleSendMessage(toSend);
            }
          }, 1800);
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
        // If recognition stops but user had spoken text, send it
        if (latestTextRef.current && latestTextRef.current.trim().length > 1 && !isLoadingRef.current) {
          const toSend = latestTextRef.current.trim();
          latestTextRef.current = '';
          setLiveSpokenText('');
          handleSendMessage(toSend);
          return;
        }

        // If modal is still open and not manually stopped, cleanly loop with fresh recognition
        if (isOpenRef.current && !isManuallyStoppedRef.current && !isLoadingRef.current) {
          setTimeout(() => {
            if (isOpenRef.current && !isManuallyStoppedRef.current && !isLoadingRef.current) {
              startListening();
            }
          }, 150);
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

  // Toggle listening button
  const toggleListening = () => {
    if (isListening || isRecordingAudio) {
      isManuallyStoppedRef.current = true;
      stopListening();
    } else {
      isManuallyStoppedRef.current = false;
      startListening();
    }
  };

  // Open FAB & Immediately Start Listening (DO NOT talk first)
  const handleOpenFab = () => {
    setIsOpen(true);
    isOpenRef.current = true;
    isManuallyStoppedRef.current = false;
    setIsListening(true);
    setSpeechError(null);

    // Prime audio synthesis on user gesture for later assistant responses if needed
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        const unlock = new SpeechSynthesisUtterance(' ');
        unlock.volume = 0.01;
        window.speechSynthesis.speak(unlock);
      } catch {}
    }

    // Do NOT get the agent to talk first. Start listening immediately!
    startListening();
  };

  // Close Receptionist Modal
  const handleClose = () => {
    isManuallyStoppedRef.current = true;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
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

  // Dispatch message to Receptionist Agent
  const handleSendMessage = async (text: string) => {
    if (!text || text.trim().length === 0 || isLoading) return;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

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

      // Speak response aloud and then auto-resume listening for continuous conversation!
      if (isVoiceActive && isSpeakingEnabled) {
        speakResponse(replyText, () => {
          if (isOpenRef.current) {
            startListening();
          }
        });
      } else if (isOpenRef.current) {
        startListening();
      }
    } catch (err: any) {
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
    } finally {
      setIsLoading(false);
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
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
                <h3 className="text-sm font-bold leading-tight">Health Concierge & Receptionist</h3>
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
              onClick={() => handleSendMessage('Review what I ate today and give me recommendations')}
              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-full shrink-0 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
            >
              <Utensils className="w-3 h-3" /> Review today's meals
            </button>
            <button
              onClick={() => {
                setActiveTab('food');
                handleSendMessage('Take me to my food history');
              }}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full shrink-0 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
            >
              <Compass className="w-3 h-3" /> Go to Food
            </button>
            <button
              onClick={() => {
                setActiveTab('health');
                handleSendMessage('Show my health biomarkers');
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
            {isListening && liveSpokenText && (
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

            {isLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-xs py-1">
                <Loader className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                <span>Receptionist is thinking & checking your data...</span>
              </div>
            )}
          </div>

          {/* Active Listening / Recording Soundwave Bar */}
          {(isListening || isRecordingAudio) && (
            <div className="px-3.5 py-2 bg-red-500/10 border-t border-red-500/20 flex items-center justify-between text-xs text-red-600 dark:text-red-400">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Physical Audio Reactive Frequency Equalizer Bars */}
                <div className="flex items-end gap-1 h-4 shrink-0">
                  <span
                    className="w-1 bg-red-500 rounded-full transition-all duration-75"
                    style={{ height: `${Math.max(4, Math.round((audioLevel / 100) * 16))}px` }}
                  />
                  <span
                    className="w-1 bg-red-500 rounded-full transition-all duration-75"
                    style={{ height: `${Math.max(6, Math.round((audioLevel / 100) * 14 + 3))}px` }}
                  />
                  <span
                    className="w-1 bg-red-500 rounded-full transition-all duration-75"
                    style={{ height: `${Math.max(3, Math.round((audioLevel / 100) * 16 + 2))}px` }}
                  />
                  <span
                    className="w-1 bg-red-500 rounded-full transition-all duration-75"
                    style={{ height: `${Math.max(8, Math.round((audioLevel / 100) * 15 + 4))}px` }}
                  />
                </div>
                <span className="font-semibold shrink-0">
                  {isRecordingAudio ? 'Recording voice note...' : 'Listening...'}
                </span>
                <span className="italic truncate text-slate-700 dark:text-slate-200 font-medium">
                  {liveSpokenText ? `"${liveSpokenText}"` : 'Speak now...'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isRecordingAudio) {
                    stopAudioRecording();
                  } else if (latestTextRef.current.trim().length > 0) {
                    const toSend = latestTextRef.current.trim();
                    latestTextRef.current = '';
                    setLiveSpokenText('');
                    stopListening();
                    handleSendMessage(toSend);
                  } else {
                    stopListening();
                  }
                }}
                className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:underline ml-2 shrink-0 cursor-pointer"
              >
                Done
              </button>
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
                  stopListening();
                  handleSendMessage(inputText);
                }
              }}
              placeholder={isListening ? '🎙️ Listening... Speak now or type' : 'Talk aloud or type a message...'}
              className="flex-1 bg-slate-100 dark:bg-slate-800/80 border border-theme-border rounded-full px-3.5 py-2 text-xs text-theme-text focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />

            {/* Send Button */}
            <button
              type="button"
              onClick={() => {
                stopListening();
                handleSendMessage(inputText);
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
