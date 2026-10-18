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
  Loader
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

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actionTaken?: {
    type: 'profile_updated' | 'navigated' | 'agent_handoff' | 'highlight';
    details: string;
  };
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
  const [isVoiceActive, setIsVoiceActive] = useState(true);
  const [isSpeakingEnabled, setIsSpeakingEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const memoryRef = useRef<any>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Compute missing profile fields
  const missingFields = useMemo(() => {
    if (!profile) return ['all'];
    const missing: { key: string; label: string; prompt: string }[] = [];
    if (!profile.age) missing.push({ key: 'age', label: 'Age', prompt: 'My age is ' });
    if (!profile.gender) missing.push({ key: 'gender', label: 'Gender', prompt: 'My gender is ' });
    if (!profile.ethnicity) missing.push({ key: 'ethnicity', label: 'Ethnicity', prompt: 'My ethnicity is ' });
    if (!profile.height) missing.push({ key: 'height', label: 'Height', prompt: 'My height is ' });
    if (!profile.weight) missing.push({ key: 'weight', label: 'Weight', prompt: 'My current weight is ' });
    const hasGoal = (profile as any).healthGoal || (profile as any).medicalConditions;
    if (!hasGoal) missing.push({ key: 'goal', label: 'Health Goal', prompt: 'My main health goal is ' });
    return missing;
  }, [profile]);

  // Initial welcome greeting
  useEffect(() => {
    if (messages.length === 0) {
      const name = profile?.nickname || profile?.email?.split('@')[0] || 'there';
      const lang = profile?.language || 'en';
      let greeting = `Hello ${name}! I'm your Live Onboarding Receptionist & Concierge. `;
      if (lang === 'id') {
        greeting = `Halo ${name}! Saya Resepsionis & Asisten Live Anda. Saya siap membantu orientasi akun, menjawab pertanyaan seputar makanan Anda, atau menyimpan profil Anda sambil kita mengobrol.`;
      } else if (lang === 'fr') {
        greeting = `Bonjour ${name} ! Je suis votre réceptionniste et concierge santé. Je peux vous guider dans l'application, analyser vos repas ou renseigner votre profil au fil de notre conversation.`;
      } else {
        if (missingFields.length > 0) {
          greeting += `I can guide you through the app, review your meals, or help complete your profile. We still have a few details to set up—feel free to talk or type!`;
        } else {
          greeting += `You're all set up! Ask me about your recent meals, explore your biomarkers, or let me know what you'd like to do.`;
        }
      }

      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          text: greeting,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [profile?.language, profile?.nickname, profile?.email, missingFields.length]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isSpeaking]);

  // Setup Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError('Speech recognition not supported in this browser. Text chat is ready!');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;

      const langCode = profile?.language === 'id' ? 'id-ID' : profile?.language === 'fr' ? 'fr-FR' : 'en-US';
      recognition.lang = langCode;

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript && transcript.trim().length > 0) {
          handleSendMessage(transcript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('[VoiceReceptionist] Speech error:', event.error);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch (err: any) {
      console.warn('[VoiceReceptionist] Failed to init speech recognition:', err);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, [profile?.language]);

  // Handle Speech Synthesis (TTS)
  const speakResponse = (text: string) => {
    if (!isSpeakingEnabled || !window.speechSynthesis) return;

    try {
      window.speechSynthesis.cancel(); // Stop existing speech

      // Clean markdown tags, asterisks, brackets for natural audio speech
      const cleanText = text
        .replace(/[*_#`[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanText) return;

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
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[VoiceReceptionist] Speech synthesis error:', e);
      setIsSpeaking(false);
    }
  };

  // Toggle listening
  const toggleListening = () => {
    if (!recognitionRef.current) {
      setSpeechError('Microphone not supported. You can type in the box below!');
      return;
    }

    // Stop speaking if model is currently talking
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    if (isListening) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
      } catch (err: any) {
        console.warn('Failed to start recognition:', err);
      }
    }
  };

  // Highlight DOM element co-pilot utility
  const highlightElement = (selector: string, note?: string) => {
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

    const userMsg: ChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
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
          message: text.trim(),
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

      // 1. Check if profile was updated (e.g. user provided age, weight, goal)
      if (data.updatedProfile && profile) {
        const nextProfile: UserProfile = { ...profile };
        let hasChanges = false;
        const changeDetails: string[] = [];

        ['age', 'gender', 'ethnicity', 'height', 'weight', 'healthGoal'].forEach((k) => {
          if (data.updatedProfile[k] !== undefined && data.updatedProfile[k] !== null) {
            (nextProfile as any)[k] = data.updatedProfile[k];
            hasChanges = true;
            changeDetails.push(`${k}: ${data.updatedProfile[k]}`);
          }
        });

        // Also check heightCm / weightKg
        if (data.updatedProfile.heightCm && !nextProfile.height) {
          nextProfile.height = data.updatedProfile.heightCm;
          hasChanges = true;
          changeDetails.push(`height: ${data.updatedProfile.heightCm}cm`);
        }
        if (data.updatedProfile.weightKg && !nextProfile.weight) {
          nextProfile.weight = data.updatedProfile.weightKg;
          hasChanges = true;
          changeDetails.push(`weight: ${data.updatedProfile.weightKg}kg`);
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
      }

      // 2. Check for Navigation / Co-Pilot intent in the conversation
      const lowerReply = (replyText + ' ' + text).toLowerCase();
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
      };

      setMessages((prev) => [...prev, botMsg]);

      // Speak response aloud if voice is on
      if (isVoiceActive) {
        speakResponse(replyText);
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

  return (
    <>
      {/* Floating Receptionist Trigger Button (Bottom Right) */}
      {!isOpen && (
        <div className="fixed bottom-24 right-4 sm:bottom-22 sm:right-6 z-40 flex items-center gap-2">
          {missingFields.length > 0 && (
            <div
              onClick={() => setIsOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/90 text-white rounded-full text-xs font-semibold shadow-lg backdrop-blur cursor-pointer hover:bg-indigo-700 transition-all animate-bounce"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>{missingFields.length} profile items to set</span>
            </div>
          )}
          <button
            id="voice-receptionist-fab"
            onClick={() => setIsOpen(true)}
            aria-label="Open Voice Receptionist"
            className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-xl hover:shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-all duration-300 focus:outline-none cursor-pointer"
          >
            {/* Animated soundwave ring when listening/speaking */}
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
        <div className="fixed inset-x-3 bottom-20 sm:inset-auto sm:bottom-22 sm:right-6 sm:w-[420px] max-h-[82vh] z-50 flex flex-col bg-theme-bg-card/95 backdrop-blur-xl border border-theme-border shadow-2xl rounded-3xl overflow-hidden animate-slide-up">
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
                <p className="text-[11px] text-indigo-100 flex items-center gap-1">
                  {isListening ? (
                    <span className="flex items-center gap-1 text-emerald-300 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-ping" /> Listening to you...
                    </span>
                  ) : isSpeaking ? (
                    <span className="text-amber-200 font-medium">Speaking response...</span>
                  ) : isLoading ? (
                    <span className="text-indigo-200">Processing...</span>
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
                  if (isSpeaking) window.speechSynthesis?.cancel();
                  setIsSpeakingEnabled(!isSpeakingEnabled);
                }}
                title={isSpeakingEnabled ? 'Mute voice output' : 'Enable voice output'}
                className="p-1.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
              >
                {isSpeakingEnabled ? <Volume2 className="w-4 h-4 text-white" /> : <VolumeX className="w-4 h-4 text-indigo-200" />}
              </button>

              {/* Close Button */}
              <button
                onClick={() => {
                  if (window.speechSynthesis) window.speechSynthesis.cancel();
                  if (recognitionRef.current && isListening) recognitionRef.current.stop();
                  setIsOpen(false);
                }}
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

                <span className="text-[9px] text-slate-400 mt-0.5 px-1">{m.timestamp}</span>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-xs py-1">
                <Loader className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                <span>Receptionist is thinking & checking your data...</span>
              </div>
            )}
          </div>

          {/* Notice if speech error / not supported */}
          {speechError && (
            <div className="px-3 py-1 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[10px] border-t border-amber-200 dark:border-amber-800 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{speechError}</span>
            </div>
          )}

          {/* Bottom Input & Voice Control Bar */}
          <div className="p-2.5 bg-theme-bg-card border-t border-theme-border flex items-center gap-2">
            {/* Live Mic Button */}
            <button
              id="voice-receptionist-mic-btn"
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

            {/* Text Input for Typing when disconnected/quiet */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSendMessage(inputText);
                }
              }}
              placeholder={isListening ? 'Listening... or type here' : 'Talk aloud or type a message...'}
              className="flex-1 bg-slate-100 dark:bg-slate-800/80 border border-theme-border rounded-full px-3.5 py-2 text-xs text-theme-text focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />

            {/* Send Button */}
            <button
              onClick={() => handleSendMessage(inputText)}
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
