import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, FoodLog, UserProfile, FoodIdea } from '../types';
import { translations } from '../utils/translations';
import { X, Send, Image, Camera, MessageSquare, Sparkles, Plus, ChevronDown, ChevronUp, Loader, MapPin, Trash2, Check, Table, RotateCcw, AlertTriangle, ShieldAlert } from 'lucide-react';
import { nutrientDefinitions } from '../utils/nutrition';
import { biomarkerDefinitions, getBiomarkerStatus, isAsianEthnicity, getBiomarkerStatusLabel } from '../utils/biomarkers';
import LLMSelector from './LLMSelector';
import { AVAILABLE_LLMS } from '../utils/llm';
import { compressMultipleImages } from '../utils/imageCompressor';
import { getCurrentDateInTimezone } from '../utils/dateUtils';
import ImageSlider from './ImageSlider';
import FullScreenLogViewer from './FullScreenLogViewer';
import FullScreenInstructionViewer from './FullScreenInstructionViewer';
import { InteractivePlacesMap } from './InteractivePlacesMap';
import exifr from 'exifr';
import { auth } from '../firebase';

interface BiomarkerEntry {
  biomarker: string;
  date: string;
  value: number;
  unit: string;
}

function parseYamlOffline(yamlText: string): BiomarkerEntry[] {
  const entries: BiomarkerEntry[] = [];
  if (!yamlText) return entries;
  
  const lines = yamlText.split('\n');
  let currentEntry: Partial<BiomarkerEntry> = {};
  
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('-') || line.startsWith('biomarker:')) {
      if (currentEntry.biomarker) {
        entries.push(currentEntry as BiomarkerEntry);
      }
      currentEntry = {};
    }
    
    const biomarkerMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
    if (biomarkerMatch) {
      currentEntry.biomarker = biomarkerMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
    
    const dateMatch = line.match(/date:\s*([\d-]+)/i);
    if (dateMatch) {
      currentEntry.date = dateMatch[1].trim();
      continue;
    }
    
    const valueMatch = line.match(/value:\s*([\d.]+)/i);
    if (valueMatch) {
      currentEntry.value = parseFloat(valueMatch[1]);
      continue;
    }
    
    const unitMatch = line.match(/unit:\s*(.*)/i);
    if (unitMatch) {
      currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
  }
  
  if (currentEntry.biomarker) {
    entries.push(currentEntry as BiomarkerEntry);
  }
  
  return entries;
}

function getOfflineCategorization(name: string) {
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('alt') || lowerName.includes('ast') || lowerName.includes('alp') || lowerName.includes('bilirubin') || lowerName.includes('liver') || lowerName.includes('ggt')) {
    return {
      riskCategories: ['Liver & hepatitis stress'],
      standardMedicalGrouping: 'Hepatic',
      potentialMedicalConditions: ['Fatty Liver', 'Hepatitis Stress']
    };
  }
  
  if (lowerName.includes('creatinine') || lowerName.includes('egfr') || lowerName.includes('urea') || lowerName.includes('kidney') || lowerName.includes('bun') || lowerName.includes('uric acid')) {
    return {
      riskCategories: ['Kidney & hydration'],
      standardMedicalGrouping: 'Renal',
      potentialMedicalConditions: ['Chronic Kidney Disease', 'Hydration Issues']
    };
  }
  
  if (lowerName.includes('glucose') || lowerName.includes('hba1c') || lowerName.includes('insulin') || lowerName.includes('cholesterol') || lowerName.includes('ldl') || lowerName.includes('hdl') || lowerName.includes('triglycerides') || lowerName.includes('tg') || lowerName.includes('sugar') || lowerName.includes('metabolic')) {
    return {
      riskCategories: ['Metabolic & glycemic', 'Cardiovascular'],
      standardMedicalGrouping: 'Metabolic',
      potentialMedicalConditions: ['Diabetes Risk', 'Insulin Resistance', 'Cardiovascular Risk']
    };
  }
  
  if (lowerName.includes('hemoglobin') || lowerName.includes('hgb') || lowerName.includes('wbc') || lowerName.includes('rbc') || lowerName.includes('platelet') || lowerName.includes('plt') || lowerName.includes('hematocrit') || lowerName.includes('mcv') || lowerName.includes('mch') || lowerName.includes('anemia') || lowerName.includes('iron') || lowerName.includes('ferritin')) {
    return {
      riskCategories: ['Hematology'],
      standardMedicalGrouping: 'Hematology',
      potentialMedicalConditions: ['Anemia', 'Hematology Disbalance']
    };
  }
  
  if (lowerName.includes('weight') || lowerName.includes('height') || lowerName.includes('bmi') || lowerName.includes('bp') || lowerName.includes('blood pressure') || lowerName.includes('heart rate') || lowerName.includes('pulse')) {
    return {
      riskCategories: ['Cardiovascular'],
      standardMedicalGrouping: 'Biometrics',
      potentialMedicalConditions: ['Hypertension', 'Obesity']
    };
  }
  
  return {
    riskCategories: ['General Health'],
    standardMedicalGrouping: 'Other',
    potentialMedicalConditions: ['General Imbalance']
  };
}

function performOfflineDataAssembly(yamlText: string, bucketMapping: any) {
  const entries = parseYamlOffline(yamlText);
  const bucketsMap: Record<string, any> = {
    'Metabolic': [],
    'Hepatic': [],
    'Renal': [],
    'Hematology': [],
    'Biometrics': [],
    'Other': []
  };
  
  const biomarkerHistory: Record<string, { value: number; date: string; unit: string }[]> = {};
  for (const entry of entries) {
    if (!entry.biomarker) continue;
    if (!biomarkerHistory[entry.biomarker]) {
      biomarkerHistory[entry.biomarker] = [];
    }
    biomarkerHistory[entry.biomarker].push({
      value: entry.value,
      date: entry.date,
      unit: entry.unit
    });
  }
  
  for (const [name, history] of Object.entries(biomarkerHistory)) {
    const mapping = bucketMapping[name] || getOfflineCategorization(name);
    const grouping = mapping.standardMedicalGrouping || 'Other';
    
    const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = sortedHistory[0];
    
    const bObj = {
      name,
      riskCategories: mapping.riskCategories || [],
      standardMedicalGrouping: grouping,
      potentialMedicalConditions: mapping.potentialMedicalConditions || [],
      history: history.map(h => {
        const lower = name.toLowerCase();
        let refRange = '0 - 100 ' + h.unit;
        if (lower.includes('glucose')) refRange = '70 - 99 ' + h.unit;
        else if (lower.includes('hba1c')) refRange = '4.0 - 5.6 ' + h.unit;
        else if (lower.includes('alt')) refRange = '7 - 56 ' + h.unit;
        else if (lower.includes('ast')) refRange = '10 - 40 ' + h.unit;
        else if (lower.includes('creatinine')) refRange = '0.6 - 1.2 ' + h.unit;
        
        return {
          date: h.date,
          value: h.value,
          referenceRange: refRange,
          level: "Normal"
        };
      })
    };
    
    if (bucketsMap[grouping]) {
      bucketsMap[grouping].push(bObj);
    } else {
      bucketsMap['Other'].push(bObj);
    }
  }
  
  const buckets = Object.entries(bucketsMap)
    .filter(([_, list]) => list.length > 0)
    .map(([systemName, biomarkers]) => ({
      systemName,
      biomarkers
    }));
    
  return {
    text: "Data successfully processed and categorized offline.",
    entriesCount: entries.length,
    buckets
  };
}

function extractBiomarkerKeysFromYaml(yamlStr: string): string[] {
  if (!yamlStr) return [];
  const keys: string[] = [];
  const lines = yamlStr.split("\n");
  lines.forEach(line => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:-\s*)?biomarker\s*:\s*["']?([^"'\s:]+)["']?/i);
    if (match && match[1]) {
      keys.push(match[1]);
    } else {
      const keyValMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*/);
      if (keyValMatch && keyValMatch[1]) {
        const k = keyValMatch[1].toLowerCase();
        if (k !== 'date' && k !== 'value' && k !== 'unit' && k !== 'biomarker' && k !== 'name') {
          keys.push(keyValMatch[1]);
        }
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}

function extractBiomarkerKeysFromPrioritizedConditions(prioritizedConditions: any[]): string[] {
  if (!Array.isArray(prioritizedConditions)) return [];
  const keys: string[] = [];
  prioritizedConditions.forEach(cond => {
    if (cond) {
      if (Array.isArray(cond.biomarkers)) {
        cond.biomarkers.forEach((m: any) => {
          if (m && typeof m.key === 'string') {
            keys.push(m.key);
          }
        });
      }
      if (Array.isArray(cond.biomarkerKeys)) {
        cond.biomarkerKeys.forEach((k: any) => {
          if (typeof k === 'string') {
            keys.push(k);
          }
        });
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}

function detectBiomarkersInText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const lowerText = text.toLowerCase();
  
  biomarkerDefinitions.forEach(def => {
    const keyLower = def.key.toLowerCase().replace(/_/g, ' ');
    const nameLower = def.name.toLowerCase();
    
    // Check key (as a word boundary if short, otherwise substring)
    const cleanKey = def.key.toLowerCase();
    const isShortKey = cleanKey.length <= 4;
    
    let isKeyInText = false;
    if (isShortKey) {
      const words = lowerText.split(/[^a-zA-Z0-9]/);
      isKeyInText = words.includes(cleanKey);
    } else {
      isKeyInText = lowerText.includes(cleanKey);
    }
    
    const isNameInText = lowerText.includes(nameLower);
    
    if (isNameInText || isKeyInText) {
      found.add(def.name);
    }
  });
  
  return Array.from(found);
}

interface LogChatProps {
  key?: string;
  type: 'food' | 'medical' | 'food_idea';
  profile?: UserProfile | null;
  isOpen: boolean;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  onClose: () => void;
  onLogFood?: (food: FoodLog) => void;
  onLogFoodIdeas?: (ideas: FoodIdea[]) => void;
  onLogMedical?: (
    biomarkers: { [key: string]: number | string }, 
    profileUpdates?: Partial<UserProfile>, 
    date?: string, 
    entries?: { date: string | null; biomarkers: { [key: string]: number | string } }[],
    modificationCommand?: { action: 'update_biomarker' | 'update_profile' | 'remove_biomarker'; keyName: string; newValue?: string | number; date?: string }[]
  ) => void;
  biomarkers?: { [key: string]: number | string };
  foodLogs?: FoodLog[];
  report?: any;
  agentType?: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | null;
  biomarkerHistory?: any[];
  onAgentFinish?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5', agentResult: any) => Promise<void>;
}

const getSessionId = (): string => {
  if (typeof window === 'undefined') return 'global';
  let id = sessionStorage.getItem('app_session_id');
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('app_session_id', id);
  }
  return id;
};

export default function LogChat({ 
  type, 
  profile, 
  isOpen, 
  selectedModelId, 
  onChangeModelId, 
  onClose, 
  onLogFood, 
  onLogFoodIdeas,
  onLogMedical, 
  biomarkers,
  foodLogs,
  report,
  agentType = null,
  biomarkerHistory = [],
  onAgentFinish
}: LogChatProps) {
  const [showDataUsed, setShowDataUsed] = useState(false);
  const [showFullScreenConv, setShowFullScreenConv] = useState(false);
  const [isSendingLogs, setIsSendingLogs] = useState(false);
  const [logsSendStatus, setLogsSendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [activeModalTableRows, setActiveModalTableRows] = useState<any[] | null>(null);
  const [activeModalTitle, setActiveModalTitle] = useState<string>('Consolidated Clinical Biomarker Log');
  const [activeInstructionAgentType, setActiveInstructionAgentType] = useState<string | null>(null);
  const [expandedAudits, setExpandedAudits] = useState<Record<string, boolean>>({});

  const handleSendLogToAdmin = async () => {
    setIsSendingLogs(true);
    setLogsSendStatus('idle');
    try {
      const logsText = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
      const sessionId = auth.currentUser?.uid || 'anonymous';
      
      const res = await fetch('/api/gemini/send-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ logsText })
      });
      
      if (res.ok) {
        setLogsSendStatus('success');
        
        // Native mailto link fallback
        const subject = encodeURIComponent(`Healthy App Food Chat Logs - User ${sessionId}`);
        const body = encodeURIComponent(`Hello Admin,\n\nHere is the compiled food log history for user ${sessionId}:\n\n${logsText}`);
        window.open(`mailto:cwah.liu@gmail.com?subject=${subject}&body=${body}`, '_blank');
      } else {
        setLogsSendStatus('error');
      }
    } catch (err) {
      console.error("Error sending logs:", err);
      setLogsSendStatus('error');
    } finally {
      setIsSendingLogs(false);
      setTimeout(() => setLogsSendStatus('idle'), 4000);
    }
  };

  const payloadStorageKey = agentType ? `last_sent_payload_${type}_${agentType}` : `last_sent_payload_${type}`;
  const chatStorageKey = agentType ? `chat_messages_${type}_${agentType}` : `chat_messages_${type}`;

  const [lastSentPayload, setLastSentPayload] = useState<any>(() => {
    try {
      const saved = sessionStorage.getItem(payloadStorageKey);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (lastSentPayload) {
      sessionStorage.setItem(payloadStorageKey, JSON.stringify(lastSentPayload));
    } else {
      sessionStorage.removeItem(payloadStorageKey);
    }
  }, [lastSentPayload, payloadStorageKey]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = sessionStorage.getItem(chatStorageKey);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved messages:", e);
      }
    }
    return [
      {
        id: `welcome_${type}`,
        role: 'assistant',
        content: type === 'food' 
          ? 'Hello! Tell me or upload a photo of what you are planning to eat, and I will analyze its health benefits, risk factors, and full 30 nutrient breakdown based on your profile.'
          : type === 'food_idea'
            ? 'Hello! Do you have any specific food preferences or cravings today?'
            : agentType === 'agent1'
              ? 'Hello! I am the Clinical Triage Organizer. I can help clean, deduplicate, and organize your raw medical history data.'
              : agentType === 'agent2'
                ? 'Hello! I am the Prognostic Diagnostics agent. I can analyze your biomarker history to project timeline risks and identify testing gaps.'
                : agentType === 'agent3'
                  ? 'Hello! I am the Personalized Reference Ranges agent. I can calibrate normal biomarker reference ranges to your exact demographics.'
                  : agentType === 'agent4'
                    ? 'Hello! I am the Lifestyle Precision Intervention agent. I can translate your diagnostic risk into strict dietary and movement targets.'
                    : agentType === 'agent5'
                      ? 'Hello! I am the Medical Literature Consensus agent. I can scan PubMed and clinical trials to bring recent scientific debate to your context.'
                      : 'Hello! I can help you parse blood report photos, medical test charts, or manual body logs. Let me know what information you would like to enter today.',
        timestamp: new Date().toISOString()
      }
    ];
  });

  useEffect(() => {
    sessionStorage.setItem(chatStorageKey, JSON.stringify(messages));
  }, [messages, chatStorageKey]);

  useEffect(() => {
    if (!isOpen) return;
    
    const savedMessages = sessionStorage.getItem(chatStorageKey);
    const savedPayload = sessionStorage.getItem(payloadStorageKey);

    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (parsed && parsed.length > 0) {
          setMessages(parsed);
          setLastSentPayload(savedPayload ? JSON.parse(savedPayload) : null);
          return;
        }
      } catch (e) {
        console.error("Failed to parse saved messages:", e);
      }
    }

    // No saved messages, initialize with fresh welcome message
    setLastSentPayload(null);
    if (agentType) {
      setMessages([
        {
          id: `welcome_${type}_${agentType}_${Date.now()}`,
          role: 'assistant',
          content: agentType === 'agent1'
            ? "Hello! I am the Clinical Triage Organizer. I can help clean, deduplicate, and organize your raw medical history data into structured physiological buckets before we run analytics.\n\nLet me know what information you would like to enter today."
            : agentType === 'agent2'
              ? 'Hello! I am the Prognostic Diagnostics agent. I can analyze your biomarker history to project timeline risks and identify testing gaps.'
              : agentType === 'agent3'
                ? 'Hello! I am the Personalized Reference Ranges agent. I can calibrate normal biomarker reference ranges to your exact demographics.'
                : agentType === 'agent4'
                  ? 'Hello! I am the Lifestyle Precision Intervention agent. I can translate your diagnostic risk into strict dietary and movement targets.'
                  : agentType === 'agent5'
                    ? 'Hello! I am the Medical Literature Consensus agent. I can scan PubMed and clinical trials to bring recent scientific debate to your context.'
                    : 'Hello! Let me know what you want to do.'
        }
      ]);
    } else {
      setMessages([
        {
          id: `welcome_${type}_default`,
          role: 'assistant',
          content: type === 'food' 
            ? 'Hello! Tell me or upload a photo of what you are planning to eat, and I will analyze its health benefits, risk factors, and full 30 nutrient breakdown based on your profile.'
            : type === 'food_idea'
              ? 'Hello! Do you have any specific food preferences or cravings today?'
              : 'Hello! I can help you parse blood report photos, medical test charts, or manual body logs. Let me know what information you would like to enter today.',
          timestamp: new Date().toISOString()
        }
      ]);
    }
  }, [isOpen, type, agentType, chatStorageKey, payloadStorageKey]);

  const [inputText, setInputText] = useState('');
  const [budget, setBudget] = useState(() => localStorage.getItem('food_budget') || '');
  const [currency, setCurrency] = useState(() => localStorage.getItem('food_currency') || 'GBP');
  const [maxDistance, setMaxDistance] = useState(() => {
    const saved = localStorage.getItem('food_max_distance');
    return saved ? parseFloat(saved) : 3;
  });

  useEffect(() => {
    localStorage.setItem('food_budget', budget);
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('food_currency', currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem('food_max_distance', String(maxDistance));
  }, [maxDistance]);

  useEffect(() => {
    const savedCurrency = localStorage.getItem('food_currency');
    if (!savedCurrency) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const isIndo = tz && (tz.includes('Jakarta') || tz.includes('Makassar') || tz.includes('Jayapura') || tz.includes('Asia/Jakarta') || tz.includes('Asia/Makassar') || tz.includes('Asia/Jayapura'));
      if (isIndo) {
        setCurrency('IDR');
        setBudget('100000');
      } else {
        setCurrency('GBP');
        setBudget('5');
      }
    }
  }, []);

  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [imageDates, setImageDates] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedNutrients, setExpandedNutrients] = useState(false);
  const [isEngineSelectorOpen, setIsEngineSelectorOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const t = translations[profile?.language || 'en'] || translations.en;

  const [loggedMessageIds, setLoggedMessageIds] = useState<string[]>([]);
  const [showPastDiscussion, setShowPastDiscussion] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleDeleteMessagePair = (messageId: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;
      const msgToDelete = prev[idx];
      const newMsgs = [...prev];
      if (msgToDelete.role === 'user') {
        if (idx + 1 < newMsgs.length && newMsgs[idx + 1].role === 'assistant') {
          newMsgs.splice(idx, 2);
        } else {
          newMsgs.splice(idx, 1);
        }
      } else if (msgToDelete.role === 'assistant') {
        if (idx - 1 >= 0 && newMsgs[idx - 1].role === 'user') {
          newMsgs.splice(idx - 1, 2);
        } else {
          newMsgs.splice(idx, 1);
        }
      }
      return newMsgs;
    });
  };

  useEffect(() => {
    if (isOpen) {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg) {
          const msSinceLast = Date.now() - new Date(lastMsg.timestamp).getTime();
          if (msSinceLast > 5 * 60 * 1000) {
            setSessionStartTime(Date.now());
          }
        } else {
          setSessionStartTime(Date.now());
        }

        if (lastMsg && !lastMsg.id.startsWith('welcome_')) {
          return [...prev, {
            id: `welcome_${type}_${Date.now()}`,
            role: 'assistant',
            content: type === 'food' 
              ? 'Hello! Tell me or upload a photo of what you are planning to eat, and I will analyze its health benefits, risk factors, and full 30 nutrient breakdown based on your profile.'
              : type === 'food_idea'
                ? 'Hello! Do you have any specific food preferences or cravings today?'
                : 'Hello! I can help you parse blood report photos, medical test charts, or manual body logs. Let me know what information you would like to enter today.',
            timestamp: new Date().toISOString()
          }];
        }
        return prev;
      });
      setShowPastDiscussion(false);
    }
  }, [isOpen, type]);

  useEffect(() => {
    // Eagerly fetch user location on component mount or whenever chat is active
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setUserLocation({ lat, lng });
        
        const isIndo = lat >= -11 && lat <= 6 && lng >= 95 && lng <= 141;
        const savedCurrency = localStorage.getItem('food_currency');
        if (!savedCurrency && isIndo) {
          setCurrency('IDR');
          setBudget('100000');
        }
      }, (err) => {
        console.warn("Could not get location:", err);
      });
    }
  }, [isOpen, type]);

  const outOfRangeBiomarkers = React.useMemo(() => {
    if (!biomarkers) return [];
    const list: { key: string; name: string; value: any; status: string; normalRange: string; unit: string }[] = [];
    Object.entries(biomarkers).forEach(([key, val]) => {
      const def = biomarkerDefinitions.find(d => d.key === key);
      const customDef = profile?.customBiomarkers?.[key];
      if (!def && !customDef) return;
      
      const normalRange = customDef?.normalRange || def?.normalRange || '';
      const unit = customDef?.unit || def?.unit || '';
      const name = customDef?.name || def?.name || key;
      
      const status = getBiomarkerStatus(key, val, normalRange);
      if (status === 'high' || status === 'low' || status === 'critical') {
        list.push({
          key,
          name,
          value: val,
          status,
          normalRange,
          unit
        });
      }
    });
    return list;
  }, [biomarkers, profile?.ethnicity]);

  const remainingAllowance = React.useMemo(() => {
    const todayStr = getCurrentDateInTimezone(profile?.timezone);
    const todaysFoods = foodLogs ? foodLogs.filter(f => f.date === todayStr) : [];

    const todaysTotals = todaysFoods.reduce((acc, curr) => {
      if (curr.nutrients) {
        Object.keys(curr.nutrients).forEach(k => {
          const key = k as keyof typeof curr.nutrients;
          acc[key] = (Number(acc[key]) || 0) + (Number(curr.nutrients[key]) || 0);
        });
      }
      return acc;
    }, {} as { [key: string]: number });

    const parseTarget = (val: any, fallback: number) => {
      if (val === null || val === undefined) return fallback;
      const cleanStr = String(val).replace(/,/g, '');
      const matches = cleanStr.match(/\d+(\.\d+)?/g);
      if (!matches || matches.length === 0) return fallback;
      const parsed = parseFloat(matches[0]);
      return isNaN(parsed) ? fallback : parsed;
    };

    const activeTargets = {
      calories: Number(todaysTotals.calories || 0),
      caloriesTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800,
      satFat: Number(todaysTotals.saturatedFat || 0),
      satFatTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15,
      sodium: Number(todaysTotals.sodium || 0),
      sodiumTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200,
    };

    return {
      calories: Math.max(0, activeTargets.caloriesTarget - activeTargets.calories),
      saturatedFat: Math.max(0, activeTargets.satFatTarget - activeTargets.satFat),
      sodium: Math.max(0, activeTargets.sodiumTarget - activeTargets.sodium),
      caloriesTarget: activeTargets.caloriesTarget,
      saturatedFatTarget: activeTargets.satFatTarget,
      sodiumTarget: activeTargets.sodiumTarget,
    };
  }, [foodLogs, report, profile?.timezone]);

  useEffect(() => {
    if (!isAnalyzing && messages.length > 1) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 150);
      }
    }
  }, [isAnalyzing, messages]);

  if (!isOpen) return null;

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ''; // Reset input value immediately so same files can be selected again
    
    if (fileList.length > 0) {
      const validFiles = fileList.filter((file: any) => {
        const isDng = file.name.toLowerCase().endsWith('.dng') || file.type.includes('dng') || file.type === 'image/x-adobe-dng';
        return !isDng;
      });

      const dngCount = fileList.length - validFiles.length;
      if (dngCount > 0) {
        alert("DNG (RAW) files are not supported by web browsers. Please select standard images like JPEG, PNG, or WEBP.");
      }

      if (validFiles.length === 0) return;

      setIsCompressing(true);
      setCompressionProgress({ current: 0, total: validFiles.length, percent: 0 });
      try {
        const compressed = await compressMultipleImages(validFiles, (progress) => {
          setCompressionProgress({
            current: progress.currentIndex,
            total: progress.totalCount,
            percent: progress.percentage
          });
        }, 800, 800, 0.75);
        const dates = await Promise.all(validFiles.map(async (f: any) => {
          try {
            const exifData = await exifr.parse(f, ['DateTimeOriginal']);
            if (exifData && exifData.DateTimeOriginal) {
              return new Date(exifData.DateTimeOriginal).toLocaleString();
            }
          } catch (e) {
            console.warn("Could not parse EXIF for", f.name);
          }
          return new Date(f.lastModified).toLocaleString();
        }));
        setSelectedImages(prev => [...prev, ...compressed]);
        setImageDates(prev => [...prev, ...dates]);
      } catch (err) {
        console.error("Error compressing selected images:", err);
      } finally {
        setIsCompressing(false);
      }
    }
  };

  const handleSend = async (overrideText?: string | any) => {
    const textToSend = typeof overrideText === 'string' ? overrideText : inputText;
    if (!textToSend && selectedImages.length === 0) return;

    // Eagerly wait for geolocation if doing food ideas and it's not resolved yet
    let loc = userLocation;
    if (type === 'food_idea' && !loc) {
      if (navigator.geolocation) {
        try {
          console.log("[Geolocation] Awaiting geolocation resolution before food-idea request...");
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc);
        } catch (err) {
          console.warn("[Geolocation] Could not await location during handleSend:", err);
        }
      }
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
      imageUrl: selectedImages[0] || undefined,
      imageUrls: selectedImages.length > 0 ? selectedImages : undefined
    };

    setMessages(prev => [...prev, userMsg]);
    if (typeof overrideText !== 'string') {
      setInputText('');
    }
    const tempImages = [...selectedImages];
    const tempDates = [...imageDates];
    setSelectedImages([]);
    setImageDates([]);
    setIsAnalyzing(true);

    try {
      let endpoint = '';
      if (type === 'food') endpoint = '/api/gemini/food-analyze';
      else if (type === 'food_idea') endpoint = '/api/gemini/food-idea';
      else endpoint = '/api/gemini/medical-analyze';

      const lightProfile = profile ? { ...profile } as any : null;
      if (lightProfile) {
        delete lightProfile.fontSizeTitle;
        delete lightProfile.fontSizeSubtitle;
        delete lightProfile.fontSizeSubtitleSmall;
        delete lightProfile.fontSizeBodySmall;
        delete lightProfile.fontSizeXS;
        delete lightProfile.fontSizeKeyMetric;
        delete lightProfile.fontSizeDescription;
        delete lightProfile.photoUrl;
        delete lightProfile.timezone;
        delete lightProfile.language;
      }

      const bodyData: any = {
        userId: auth.currentUser?.uid || undefined,
        message: userMsg.content,
        image: tempImages[0] || undefined,
        images: tempImages.length > 0 ? tempImages : undefined,
        imageDates: tempDates.length > 0 ? tempDates : undefined,
        history: messages.filter(m => new Date(m.timestamp).getTime() >= sessionStartTime && !m.id.startsWith('welcome_')).slice(-10).map(m => {
          let extra = "";
          if (m.role === 'assistant') {
            if (m.pendingBiomarkers) extra += `\n[Extracted Biomarkers: ${JSON.stringify(m.pendingBiomarkers)}]`;
            if (m.pendingFoodLog) {
               extra += `\n[Extracted Food: ${m.pendingFoodLog.name}, ${m.pendingFoodLog.quantity}, ${m.pendingFoodLog.nutrients?.calories || 0} kcal. (Full nutrient data omitted for brevity)]`;
            }
            if (m.pendingDate) extra += `\n[Extracted Date: ${m.pendingDate}]`;
            if (m.pendingProfile) extra += `\n[Extracted Profile: ${JSON.stringify(m.pendingProfile)}]`;
          }
          return { role: m.role, content: m.content + extra };
        }),
        userProfile: lightProfile,
        engine: selectedModelId
      };
      
      // Clean up undefined fields
      Object.keys(bodyData).forEach(key => {
        if (bodyData[key] === undefined) delete bodyData[key];
      });

      if (type === 'food') {
        const lastFoodLog = [...messages].reverse().find(m => m.pendingFoodLog)?.pendingFoodLog;
        if (lastFoodLog) {
          bodyData.activeMeal = lastFoodLog;
        }
        bodyData.biomarkersNeedingImprovement = outOfRangeBiomarkers.map(b => `${b.name} is ${getBiomarkerStatusLabel(b.key, b.status).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`);
        bodyData.remainingAllowance = {
          calories: remainingAllowance.calories,
          caloriesTarget: remainingAllowance.caloriesTarget,
          saturatedFat: remainingAllowance.saturatedFat,
          saturatedFatTarget: remainingAllowance.saturatedFatTarget,
          sodium: remainingAllowance.sodium,
          sodiumTarget: remainingAllowance.sodiumTarget,
        };
      } else if (type === 'food_idea') {
        bodyData.location = loc;
        bodyData.recentMeals = foodLogs.slice(-20).map(f => f.name);
        bodyData.budget = budget;
        bodyData.currency = currency;
        bodyData.maxDistance = maxDistance;
        
        // Fetch real places from Overpass API (client-side bypasses container blocks)
        if (loc) {
          try {
            const radius = Math.min(Number(maxDistance) * 1000, 5000);
            const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${loc.lat},${loc.lng}););out 30;`;
            const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: "data=" + encodeURIComponent(overpassQuery)
            });
            if (overpassRes.ok) {
              const overpassData = await overpassRes.json();
              if (overpassData && overpassData.elements && overpassData.elements.length > 0) {
                bodyData.clientNearbyPlaces = overpassData.elements
                  .filter((e: any) => e.tags && e.tags.name)
                  .map((e: any) => ({
                    name: e.tags.name,
                    lat: e.lat,
                    lng: e.lon,
                    address: e.tags['addr:street'] ? `${e.tags['addr:street']} ${e.tags['addr:housenumber'] || ''}` : '',
                    opening_hours: e.tags['opening_hours'] || '--'
                  }));
              }
            }
          } catch (e) {
            console.warn("Client side Overpass fetch failed:", e);
          }
        }
      } else if (type === 'medical') {
        bodyData.existingBiomarkers = biomarkers ? Object.keys(biomarkers) : [];
        const lastMsg = [...messages].reverse().find(m => m.lastProcessedItem !== undefined);
        if (lastMsg && lastMsg.lastProcessedItem) {
          bodyData.lastProcessedItem = lastMsg.lastProcessedItem;
        }
        if (agentType) {
          let currentStep = 'agent1_step1';
          if (agentType === 'agent1') {
            // New user-typed text queries must ALWAYS start fresh at Step 1
            currentStep = 'agent1_step1';
            
            // Also find and attach extractedYaml and bucketMapping if available
            const yamlMsg = [...messages].reverse().find(m => m.agentResult?.extractedYaml || m.extractedYaml);
            if (yamlMsg) {
              bodyData.extractedYaml = yamlMsg.agentResult?.extractedYaml || yamlMsg.extractedYaml;
            }
            const mapMsg = [...messages].reverse().find(m => m.agentResult?.bucketMapping || m.bucketMapping);
            if (mapMsg) {
              bodyData.bucketMapping = typeof (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping) === 'string'
                ? (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping)
                : JSON.stringify(mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping);
            }
          } else {
            currentStep = agentType;
          }
          bodyData.agentType = currentStep;
          bodyData.biomarkerHistory = biomarkerHistory || [];
          bodyData.biomarkers = biomarkers || {};
          bodyData.recentMeals = foodLogs ? foodLogs.slice(-20).map(f => f.name) : [];
          bodyData.agentDiagnosticSummary = profile?.agentDiagnosticSummary || '';
        }
      }

      // Save display-friendly payload for debug mode
      const displayPayload = { ...bodyData };
      if (displayPayload.image && typeof displayPayload.image === 'string') {
        displayPayload.image = displayPayload.image.substring(0, 100) + "... [truncated base64]";
      }
      if (displayPayload.images && Array.isArray(displayPayload.images)) {
        displayPayload.images = displayPayload.images.map((img: any) => typeof img === 'string' ? img.substring(0, 100) + "... [truncated base64]" : img);
      }
      setLastSentPayload(displayPayload);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': getSessionId()
        },
        body: JSON.stringify(bodyData)
      });

      const resData = await response.json();
      if (resData.error) throw new Error(resData.error);

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: resData.text || 'Information extracted.',
        timestamp: new Date().toISOString(),
      };
      
      if (type === 'food') {
        if (resData.data) {
          const lastFoodLog = [...messages].reverse().find(m => m.pendingFoodLog)?.pendingFoodLog;
          assistantMsg.pendingFoodLog = {
            ...resData.data,
            date: resData.data.date || lastFoodLog?.date || getCurrentDateInTimezone(profile?.timezone),
            id: `food_${Date.now()}`,
            imageUrl: tempImages.length > 0 ? tempImages[0] : resData.data.imageUrl,
            imageUrls: tempImages.length > 0 ? tempImages : resData.data.imageUrls
          };
        }
      } else if (type === 'food_idea') {
        if (resData.ideas && resData.ideas.length > 0) {
          assistantMsg.pendingFoodIdeas = resData.ideas;
        }
      } else {
        if (agentType) {
          assistantMsg.agentType = agentType;
          assistantMsg.agentResult = resData;
          if (agentType === 'agent1') {
            assistantMsg.agentTypeStep = resData.agentType || 'agent1_step1';
          }
        } else {
          assistantMsg.mode = resData.mode;
          assistantMsg.status = resData.status;
          assistantMsg.planningDetails = resData.planningDetails;
          assistantMsg.lastProcessedItem = resData.lastProcessedItem;
          assistantMsg.modificationCommand = resData.modificationCommand;
          assistantMsg.pendingBiomarkerEntries = resData.entries || [];
          // Legacy fallback
          assistantMsg.pendingBiomarkers = resData.biomarkers;
          assistantMsg.pendingDate = resData.date;
          
          // Merge custom biomarker definitions into profile if any
          let mergedProfile = { ...resData.profile };
          if (resData.customBiomarkerDefs && Object.keys(resData.customBiomarkerDefs).length > 0) {
            mergedProfile.customBiomarkers = {
              ...(profile?.customBiomarkers || {}),
              ...resData.customBiomarkerDefs
            };
          }
          assistantMsg.pendingProfile = mergedProfile;
        }
      }

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error(err);
      const isQuota = err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED");
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: isQuota ? `You have exceeded your Gemini API quota limit. Please check your billing or try again later.` : `Error running analysis: ${err.message || 'Server connection timed out.'}`,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleContinueExtractionChunk = async (msg: any) => {
    setIsAnalyzing(true);
    try {
      const bodyData: any = {
        agentType: 'agent1_step1',
        message: 'continue',
        extractedYaml: msg.agentResult?.extractedYaml || msg.extractedYaml,
        remainingText: msg.agentResult?.remainingText || '',
        engine: selectedModelId
      };

      const response = await fetch('/api/gemini/medical-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errText}`);
      }

      const resData = await response.json();

      setMessages(prev => prev.map(m => {
        if (m.id === msg.id) {
          return {
            ...m,
            content: resData.text || m.content,
            agentResult: {
              ...m.agentResult,
              text: resData.text || m.agentResult?.text,
              extractedYaml: resData.extractedYaml || m.agentResult?.extractedYaml,
              hasMoreMarkers: resData.hasMoreMarkers,
              remainingText: resData.remainingText || ''
            }
          };
        }
        return m;
      }));
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `Error during chunk extraction: ${err.message}`,
          timestamp: new Date().toISOString(),
          isError: true,
          errorStep: 'agent1_step1',
          originalMsg: msg
        }
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAgent1Step = async (step: 'agent1_step2' | 'agent1_step3', msg: any) => {
    setIsAnalyzing(true);
    try {
      const bodyData: any = {
        agentType: step,
        extractedYaml: msg.agentResult?.extractedYaml || msg.extractedYaml,
        bucketMapping: msg.agentResult?.bucketMapping ? JSON.stringify(msg.agentResult.bucketMapping) : msg.bucketMapping ? JSON.stringify(msg.bucketMapping) : undefined,
        message: "Continue processing",
        engine: selectedModelId
      };

      // To grab yaml and mapping correctly from previous messages
      if (!bodyData.extractedYaml) {
         const yamlMsg = [...messages].reverse().find(m => m.agentResult?.extractedYaml || m.extractedYaml);
         bodyData.extractedYaml = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml;
      }
      if (step === 'agent1_step3' && !bodyData.bucketMapping) {
         const mapMsg = [...messages].reverse().find(m => m.agentResult?.bucketMapping || m.bucketMapping);
         bodyData.bucketMapping = JSON.stringify(mapMsg?.agentResult?.bucketMapping || mapMsg?.bucketMapping);
      }

      const displayPayload = { ...bodyData };
      setLastSentPayload(displayPayload);

      const response = await fetch('/api/gemini/medical-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      
      const assistantMsg: ChatMessage & { agentTypeStep?: string } = {
        id: `msg_agent1_${step}_${Date.now()}`,
        role: 'assistant',
        content: resData.text || 'Processing...',
        timestamp: new Date().toISOString(),
        agentType: 'agent1',
        agentResult: resData,
        agentTypeStep: step
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `Error during processing step: ${err.message}`,
          timestamp: new Date().toISOString(),
          isError: true,
          errorStep: step,
          originalMsg: msg
        }
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-4 animation-fade-in font-sans">
      <div id="food-chat-container" className="w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] h-[90vh] sm:h-[80vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800/80 transition-colors duration-200">
        
        {/* Modal Header */}
        <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-950 dark:text-slate-100 font-display">
                {type === 'food' 
                  ? t.addFood 
                  : type === 'food_idea' 
                    ? 'Food ideas' 
                    : agentType === 'agent1' 
                      ? 'Clinical Triage Organizer' 
                      : agentType === 'agent2' 
                        ? 'Prognostic Diagnostics Assessment' 
                        : agentType === 'agent3' 
                          ? 'Personalized Reference Ranges' 
                          : agentType === 'agent4' 
                            ? 'Lifestyle Precision Intervention' 
                            : agentType === 'agent5' 
                              ? 'Medical Literature Consensus' 
                              : t.addMedical}
              </h2>
              <button
                type="button"
                onClick={() => setIsEngineSelectorOpen(!isEngineSelectorOpen)}
                className="flex items-center gap-1 text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold hover:text-indigo-700 transition-colors focus:outline-none cursor-pointer"
              >
                <span>{AVAILABLE_LLMS.find(m => m.id === selectedModelId)?.name || selectedModelId}</span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isEngineSelectorOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`} />
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <button 
              id="close-food-chat-btn"
              onClick={onClose} 
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Expandable Model Selector Dropdown */}
        {isEngineSelectorOpen && (
          <div className="px-4 py-2.5 bg-indigo-50/50 dark:bg-indigo-950/25 border-b border-indigo-100 dark:border-indigo-950/40 animation-slide-down">
            <LLMSelector
              selectedModelId={selectedModelId}
              variant="inline"
              onChangeModelId={(id) => {
                onChangeModelId(id);
                setIsEngineSelectorOpen(false);
              }}
            />
          </div>
        )}

        {/* Chat Message Window */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/20">
          
          {/* Data used by agent inline block */}
          {(type === 'food' || type === 'food_idea' || type === 'medical') && (
            <div className="bg-slate-50 dark:bg-slate-900/55 rounded-xl px-4 py-2.5 mb-4 border border-slate-100 dark:border-slate-800/20">
              <button
                type="button"
                onClick={() => setShowDataUsed(!showDataUsed)}
                className="w-full flex items-center justify-between text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold font-sans text-slate-600 dark:text-slate-300">
                  Data used by agent
                </span>
                <div className="flex items-center text-slate-400 dark:text-slate-500">
                  {showDataUsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </button>
              
              {showDataUsed && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-200/50 dark:border-slate-800/50 space-y-3.5 text-slate-600 dark:text-slate-300 font-sans leading-normal">
                  {/* Profile Stats */}
                  <div className="grid grid-cols-2 gap-2.5 font-size-xs bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30">
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Demographics</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{(profile?.age) || 'Unknown'} yo • {profile?.gender || 'Unknown'} • {profile?.ethnicity || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Body Metrics</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{profile?.weight || 'Unknown'} kg • {profile?.height || 'Unknown'} cm (BMI: {profile?.weight && profile?.height ? (Number(profile.weight) / Math.pow(Number(profile.height) / 100, 2)).toFixed(1) : 'Unknown'})</span>
                    </div>
                  </div>

                  {type === 'food_idea' && (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Budget</span>
                          <input 
                              type="number"
                              value={budget}
                              onChange={(e) => setBudget(e.target.value)}
                              placeholder="Enter budget..."
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                          />
                        </div>
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Currency</span>
                          <select
                              value={currency}
                              onChange={(e) => setCurrency(e.target.value)}
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                          >
                            <option value="IDR" className="bg-slate-100 dark:bg-slate-900">IDR (Rp)</option>
                            <option value="GBP" className="bg-slate-100 dark:bg-slate-900">GBP (£)</option>
                            <option value="USD" className="bg-slate-100 dark:bg-slate-900">USD ($)</option>
                            <option value="EUR" className="bg-slate-100 dark:bg-slate-900">EUR (€)</option>
                            <option value="AUD" className="bg-slate-100 dark:bg-slate-900">AUD ($)</option>
                            <option value="SGD" className="bg-slate-100 dark:bg-slate-900">SGD ($)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Distance</span>
                          <select
                              value={maxDistance}
                              onChange={(e) => setMaxDistance(parseFloat(e.target.value) || 3)}
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                          >
                            <option value="0.5" className="bg-slate-100 dark:bg-slate-900">0.5 km</option>
                            <option value="1" className="bg-slate-100 dark:bg-slate-900">1 km</option>
                            <option value="2" className="bg-slate-100 dark:bg-slate-900">2 km</option>
                            <option value="3" className="bg-slate-100 dark:bg-slate-900">3 km</option>
                            <option value="5" className="bg-slate-100 dark:bg-slate-900">5 km</option>
                            <option value="7" className="bg-slate-100 dark:bg-slate-900">7 km</option>
                            <option value="10" className="bg-slate-100 dark:bg-slate-900">10 km</option>
                          </select>
                        </div>
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Location</span>
                          <span className="font-bold text-slate-700 dark:text-slate-200 truncate block mt-0.5">
                            {userLocation ? `📍 ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : '❌ Not available'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Last 20 Meals</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200 max-h-20 overflow-y-auto block whitespace-pre-wrap">
                          {foodLogs.slice(-20).map(f => f.name).join(', ') || 'No meals logged yet'}
                        </span>
                      </div>
                    </>
                  )}

                  {agentType && (
                    <div className="space-y-2">
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Biomarker History Logs</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200">
                          {biomarkerHistory?.length || 0} historic logs
                        </span>
                      </div>
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Checked Biomarker Values</span>
                        {biomarkers && Object.keys(biomarkers).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mt-1 max-h-32 overflow-y-auto">
                            {Object.entries(biomarkers).map(([key, value]) => {
                              const def = (profile?.customBiomarkers && profile.customBiomarkers[key]) || biomarkerDefinitions[key] || { name: key, unit: '' };
                              return (
                                <span key={key} className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-[10px] font-mono text-slate-700 dark:text-slate-300">
                                  {def.name}: <strong className="text-indigo-600 dark:text-indigo-400">{value}</strong> <span className="text-slate-400">{def.unit}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-450 dark:text-slate-500 italic font-size-xs block mt-1">No biomarker data available.</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Warning Biomarkers */}
                  {(type === 'food' || type === 'food_idea') && (
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Important Biomarkers Needing Improvement</span>
                      {outOfRangeBiomarkers.length > 0 ? (
                        <div className="space-y-1">
                          {outOfRangeBiomarkers.map(b => (
                            <div key={b.key} className="flex items-center justify-between font-size-xs font-mono bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-950/30 px-2 py-1 rounded-lg">
                              <span className="font-sans font-bold text-slate-700 dark:text-slate-300">{b.name}</span>
                              <span className="text-rose-600 dark:text-rose-450 font-black">
                                {b.value} {b.unit} ({getBiomarkerStatusLabel(b.key, b.status).toUpperCase()})
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-450 dark:text-slate-500 italic font-size-xs">All active biomarkers are within normal reference ranges.</span>
                      )}
                    </div>
                  )}

                  {/* Remaining Daily Allowances */}
                  {(type === 'food' || type === 'food_idea') && (
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Today's Remaining Nutrition Allowance</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2 rounded-lg">
                          <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-0.5">Calories</span>
                          <span className="font-mono font-size-xs font-bold text-slate-800 dark:text-slate-200">
                            {remainingAllowance.calories} <span className="font-size-xs text-slate-400">kcal</span>
                          </span>
                          <span className="font-size-xs text-slate-400 dark:text-slate-500 block mt-0.5">/ {remainingAllowance.caloriesTarget} target</span>
                        </div>
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2 rounded-lg">
                          <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-0.5">Sat. Fat</span>
                          <span className={`font-mono font-size-xs font-bold ${remainingAllowance.saturatedFat === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                            {remainingAllowance.saturatedFat.toFixed(1)} <span className="font-size-xs text-slate-400">g</span>
                          </span>
                          <span className="font-size-xs text-slate-400 dark:text-slate-500 block mt-0.5">/ {remainingAllowance.saturatedFatTarget}g max</span>
                        </div>
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2 rounded-lg">
                          <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-0.5">Sodium</span>
                          <span className={`font-mono font-size-xs font-bold ${remainingAllowance.sodium === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                            {remainingAllowance.sodium} <span className="font-size-xs text-slate-400">mg</span>
                          </span>
                          <span className="font-size-xs text-slate-400 dark:text-slate-500 block mt-0.5">/ {remainingAllowance.sodiumTarget}mg max</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Conversation Log History */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-100/50 dark:bg-slate-950/20 p-3 mt-3 space-y-2 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-indigo-650 dark:text-indigo-400 font-bold block text-[10px] uppercase tracking-wider">
                        📡 Real-Time Full Agent Request Payload & Log
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          let logTxt = lastSentPayload ? JSON.stringify(lastSentPayload, null, 2) : messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                          if (type === 'medical') {
                            logTxt = `=== PAYLOAD ===\n` + logTxt;
                          }
                          navigator.clipboard.writeText(logTxt);
                        }}
                        className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                      >
                        Copy Log
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFullScreenConv(true)}
                      className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm animate-fade-in mb-2"
                    >
                      <span>🔍 View Log</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        let targetAgent = 'agent1_step1';
                        if (type === 'food') targetAgent = 'food';
                        else if (type === 'food_idea') targetAgent = 'food_idea';
                        else {
                          // Find latest agent step in messages
                          const lastMsgWithStep = [...messages].reverse().find(m => m.agentTypeStep || m.agentType);
                          targetAgent = lastMsgWithStep?.agentTypeStep || lastMsgWithStep?.agentType || 'agent1_step1';
                        }
                        setActiveInstructionAgentType(targetAgent);
                      }}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 hover:text-white dark:hover:text-white border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm animate-fade-in"
                    >
                      <span>ℹ️ View Programmed Agent Instructions</span>
                    </button>

                    <FullScreenLogViewer
                      isOpen={showFullScreenConv}
                      onClose={() => setShowFullScreenConv(false)}
                      title="Full Agent Request Payload & Log"
                      logsText={(() => {
                        let logTxt = lastSentPayload ? JSON.stringify(lastSentPayload, null, 2) : messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                        if (type === 'medical') {
                          logTxt = `=== PAYLOAD ===\n` + logTxt;
                        }
                        return logTxt;
                      })()}
                      onSendToAdmin={handleSendLogToAdmin}
                      isSendingLogs={isSendingLogs}
                      logsSendStatus={logsSendStatus}
                      onClearLogs={() => {
                        setMessages([]);
                        setLastSentPayload(null);
                        sessionStorage.removeItem(`last_sent_payload_${type}`);
                      }}
                      eventsCount={messages.length}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {(() => {
            const lastWelcomeIndex = messages.length - 1 - [...messages].reverse().findIndex(m => m.id.startsWith('welcome_'));
            const sessionStartIdx = lastWelcomeIndex >= 0 ? lastWelcomeIndex : 0;
            const pastCount = sessionStartIdx;
            const hasPastMessages = pastCount > 0;

            return (
              <>
                {(hasPastMessages || messages.length > 1) && (
                  <div className="flex justify-center items-center gap-2 mb-4 mt-2">
                    {hasPastMessages && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowPastDiscussion(!showPastDiscussion)}
                          className="px-4 py-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-1.5 cursor-pointer bg-slate-100/50 dark:bg-slate-950/20 rounded-xl border border-slate-200/50 dark:border-slate-800/40"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>
                            {showPastDiscussion ? "Hide past discussion" : `View past discussion (${pastCount})`}
                          </span>
                        </button>
                        {showPastDiscussion && (
                          <button 
                            type="button"
                            onClick={() => {
                              const lastWelcome = messages.findLast(m => m.id.startsWith('welcome_'));
                              if (lastWelcome) {
                                setMessages([lastWelcome]);
                              } else {
                                setMessages([messages[messages.length - 1]]);
                              }
                              setShowPastDiscussion(false);
                            }}
                            className="p-1.5 rounded-xl bg-slate-100/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/40 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-500 hover:text-rose-600 transition-colors"
                            title="Clear past discussion history"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {messages.map((msg, idx) => {
                  const isPast = idx < sessionStartIdx;
                  if (isPast && !showPastDiscussion) return null;

                  const isAss = msg.role === 'assistant';
                  if (isAss) {
                  return (
                <div
                  key={msg.id}
                  className="w-full space-y-2.5 px-1 min-w-0 relative group"
                >
                  {!msg.id.startsWith('welcome_') && (
                    <button
                      type="button"
                      onClick={() => handleDeleteMessagePair(msg.id)}
                      className="absolute right-2 top-0 p-1 text-slate-300 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors z-20 cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 opacity-100"
                      title="Delete conversation step"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div className="w-full leading-relaxed font-size-body text-slate-850 dark:text-slate-100 font-medium break-words overflow-x-hidden bg-transparent border-none shadow-none">
                    {msg.imageUrls && msg.imageUrls.length > 0 ? (
                      <div className="mb-2 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700/30 max-w-full">
                        <ImageSlider images={msg.imageUrls} altText="Attached meal pictures" />
                      </div>
                    ) : msg.imageUrl ? (
                      <div className="mb-2 rounded-lg overflow-hidden border border-white/10 max-h-40 max-w-full">
                        <img src={msg.imageUrl} alt="Attached meal" className="w-full h-full object-cover" />
                      </div>
                    ) : null}
                    <p className="whitespace-pre-line break-words">{msg.content}</p>
                    
                    {msg.isError && (
                      <div className="mt-3 p-4 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <h5 className="text-xs font-bold text-amber-700 dark:text-amber-400">
                              Resilient Offline Recovery Mode
                            </h5>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed font-sans">
                              The AI Service is currently experiencing transient spikes in demand. You can seamlessly bypass this error and proceed using our high-fidelity, deterministic offline mapping & data assembly engine.
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row gap-2 font-sans">
                          {msg.errorStep === 'agent1_step2' && (
                            <button
                              type="button"
                              onClick={() => {
                                const yamlMsg = [...messages].reverse().find(m => m.agentResult?.extractedYaml || m.extractedYaml);
                                const yaml = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml;
                                if (!yaml) return;
                                
                                const offlineMapping: Record<string, any> = {};
                                const parsed = parseYamlOffline(yaml);
                                parsed.forEach(p => {
                                  if (p.biomarker) {
                                    offlineMapping[p.biomarker] = getOfflineCategorization(p.biomarker);
                                  }
                                });
                                
                                const fallbackResultMsg: ChatMessage = {
                                  id: `msg_agent1_agent1_step2_fallback_${Date.now()}`,
                                  role: 'assistant',
                                  content: "I have successfully resolved the connection error by engaging our local Clinical Ontologist fallback engine. All unique biomarkers have been categorized and mapped. Please review and continue to assembly below!",
                                  timestamp: new Date().toISOString(),
                                  agentType: 'agent1',
                                  agentResult: {
                                    text: "Biomarkers successfully categorized offline.",
                                    bucketMapping: offlineMapping,
                                    completedStep: false
                                  },
                                  agentTypeStep: 'agent1_step2'
                                };
                                
                                setMessages(prev => [...prev, fallbackResultMsg]);
                              }}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Bypass & Map Offline
                            </button>
                          )}
                          
                          {msg.errorStep === 'agent1_step3' && (
                            <button
                              type="button"
                              onClick={() => {
                                const yamlMsg = [...messages].reverse().find(m => m.agentResult?.extractedYaml || m.extractedYaml);
                                const yaml = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml;
                                const mapMsg = [...messages].reverse().find(m => m.agentResult?.bucketMapping || m.bucketMapping);
                                const mapping = mapMsg?.agentResult?.bucketMapping || mapMsg?.bucketMapping || {};
                                
                                if (!yaml) return;
                                
                                const assembled = performOfflineDataAssembly(yaml, mapping);
                                
                                const fallbackResultMsg: ChatMessage = {
                                  id: `msg_agent1_agent1_step3_fallback_${Date.now()}`,
                                  role: 'assistant',
                                  content: "Data successfully assembled offline! All physiological buckets are prepared. You can now apply and save findings to move to the other clinical analysis agents.",
                                  timestamp: new Date().toISOString(),
                                  agentType: 'agent1',
                                  agentResult: assembled,
                                  agentTypeStep: 'agent1_step3'
                                };
                                
                                setMessages(prev => [...prev, fallbackResultMsg]);
                              }}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Bypass & Assemble Offline
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {msg.id.startsWith('welcome_') && type === 'food_idea' && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => handleSend('Surprise me')}
                          disabled={isAnalyzing}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                        >
                          Surprise Me
                        </button>
                      </div>
                    )}
                    {msg.id.startsWith('welcome_') && agentType && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => handleSend('Start')}
                          disabled={isAnalyzing}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                        >
                          Let's start
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Render extracted Pending Food Log block if assistant has finished parsing */}
                  {/* Render extracted Pending Food Log info */}
                  {type === 'food_idea' && msg.pendingFoodIdeas && (
                    <InteractivePlacesMap
                      ideas={msg.pendingFoodIdeas}
                      onSaveSelected={(selectedIdeas) => {
                        if (onLogFoodIdeas) {
                          onLogFoodIdeas(selectedIdeas);
                          setLoggedMessageIds(prev => [...prev, msg.id]);
                        }
                      }}
                      isLogged={loggedMessageIds.includes(msg.id)}
                    />
                  )}

                  {type === 'food' && msg.pendingFoodLog && !loggedMessageIds.includes(msg.id) && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      {msg.pendingFoodLog.imageUrls && msg.pendingFoodLog.imageUrls.length > 0 && (
                        <div className="rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700/50 shadow-sm mb-3 max-w-full">
                          <ImageSlider images={msg.pendingFoodLog.imageUrls} altText={msg.pendingFoodLog.name || "Pending meal"} />
                        </div>
                      )}
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 pb-2 gap-2">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate min-w-0">
                          {msg.pendingFoodLog.name}
                        </h4>
                        <span className="text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 px-2.5 py-0.5 rounded-full font-bold flex-shrink-0">
                          {msg.pendingFoodLog.weightGrams}g ({msg.pendingFoodLog.quantity})
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs font-medium border-b border-slate-100 dark:border-slate-800/50 pb-2">
                        <span className="text-slate-500">Record Date:</span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">{msg.pendingFoodLog.date}</span>
                      </div>

                      <div className="text-xs space-y-2 text-slate-600 dark:text-slate-300 font-medium">
                        <p><strong>{t.composition}:</strong> {msg.pendingFoodLog.composition}</p>
                        <p className="text-slate-700 dark:text-slate-200"><strong>{t.benefits}:</strong> {msg.pendingFoodLog.benefits}</p>
                        {msg.pendingFoodLog.risks && <p className="text-slate-700 dark:text-slate-200"><strong>{t.risks}:</strong> {msg.pendingFoodLog.risks}</p>}
                        <p><strong>{t.impact}:</strong> {msg.pendingFoodLog.healthImpact}</p>
                      </div>

                      {/* Individual Items Contribution Breakdown Table */}
                      {msg.pendingFoodLog.itemsBreakdown && msg.pendingFoodLog.itemsBreakdown.length > 0 && (
                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/30 dark:bg-slate-900/10">
                          <div className="px-3 py-1.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              📊 Components Contribution Table
                            </span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/30 dark:bg-slate-800/30 text-slate-500 dark:text-slate-400 font-semibold">
                                  <th className="p-2">Item Name</th>
                                  <th className="p-2 text-right">Weight</th>
                                  <th className="p-2 text-right">Calories</th>
                                  <th className="p-2 text-right">Sat Fat</th>
                                  <th className="p-2 text-right">Sodium</th>
                                </tr>
                              </thead>
                              <tbody>
                                {msg.pendingFoodLog.itemsBreakdown.map((item, itemIdx) => (
                                  <tr 
                                    key={itemIdx} 
                                    className="border-b last:border-b-0 border-slate-100 dark:border-slate-800/40 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-850/20 transition-colors"
                                  >
                                    <td className="p-2 font-semibold truncate max-w-[120px]" title={item.name}>
                                      {item.name}
                                    </td>
                                    <td className="p-2 text-right font-mono text-slate-500">
                                      {item.weightGrams}g
                                    </td>
                                    <td className="p-2 text-right font-mono text-amber-600 dark:text-amber-400">
                                      {item.calories} kcal
                                    </td>
                                    <td className="p-2 text-right font-mono text-orange-600 dark:text-orange-400">
                                      {item.saturatedFat}g
                                    </td>
                                    <td className="p-2 text-right font-mono text-teal-600 dark:text-teal-400">
                                      {item.sodium}mg
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Top Nutrients Badge */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-extrabold text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 px-2 py-0.5 rounded-lg border border-orange-100/40 dark:border-orange-900/30">
                          {(msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.calories) || 0} kcal
                        </span>
                        {msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.saturatedFat !== undefined && (
                          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-lg">
                            Sat Fat: {msg.pendingFoodLog.nutrients.saturatedFat}g
                          </span>
                        )}
                        {msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.sodium !== undefined && (
                          <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/30 px-2 py-0.5 rounded-lg">
                            Sodium: {msg.pendingFoodLog.nutrients.sodium}mg
                          </span>
                        )}
                      </div>

                      {/* Display Nutrients - Accordion Style */}
                      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30">
                        <button
                          onClick={() => setExpandedNutrients(!expandedNutrients)}
                          className="w-full px-3 py-2 flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100/50"
                        >
                          <span>Nutrient Breakdown (30 Core Nutrients)</span>
                          {expandedNutrients ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        
                        <div className={`px-3 py-2 space-y-1 text-[11px] font-mono border-t border-slate-200 dark:border-slate-800 ${expandedNutrients ? 'block' : 'hidden'}`}>
                          {nutrientDefinitions.map((nut) => {
                            const val = msg.pendingFoodLog?.nutrients?.[nut.key];
                            return (
                              <div key={nut.key} className="flex justify-between py-0.5 text-slate-600 dark:text-slate-300">
                                <span className="text-slate-500">{nut.labels[profile?.language || 'en'] || nut.labels.en}:</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-100">
                                  {val !== undefined ? `${val} ${nut.unit}` : `--`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Log Action Button */}
                      <button
                        onClick={() => {
                          if (msg.pendingFoodLog && onLogFood) {
                            onLogFood(msg.pendingFoodLog as FoodLog);
                            setLoggedMessageIds(prev => [...prev, msg.id]);
                          }
                        }}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        {t.logThisFood}
                      </button>
                    </div>
                  )}

                  {/* Render Agent Result Blocks */}
                  {msg.agentType && msg.agentResult && !loggedMessageIds.includes(msg.id) && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-4 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800/50">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs tracking-wider uppercase font-display">
                            {msg.agentType === 'agent1' && 'Clinical Triage Organizer'}
                            {msg.agentType === 'agent2' && 'Prognostic Diagnostics Assessment'}
                            {msg.agentType === 'agent3' && 'Personalized Reference Ranges'}
                            {msg.agentType === 'agent4' && 'Lifestyle Precision Intervention'}
                            {msg.agentType === 'agent5' && 'Medical Literature Consensus'}
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const resolvedAgentType = msg.agentTypeStep || msg.agentType;
                            setActiveInstructionAgentType(resolvedAgentType);
                          }}
                          className="text-[9px] font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                        >
                          View Agent Instruction
                        </button>
                      </div>

                      {/* Content details based on Agent type */}
                      {msg.agentType === 'agent1' && (
                        <div className="space-y-3">
                          {msg.agentTypeStep === 'agent1_step1' && (
                            <div className="space-y-2">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400">Step 1: Extracted data</span>
                              <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                                {msg.agentResult.extractedYaml || msg.extractedYaml}
                              </pre>
                              {!msg.agentResult.completedStep && (
                                msg.agentResult.hasMoreMarkers ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleContinueExtractionChunk(msg);
                                    }}
                                    className="w-full py-2 bg-amber-650 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer mt-2"
                                  >
                                    Continue Extracting Remaining Biomarkers
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      msg.agentResult.completedStep = true;
                                      handleAgent1Step('agent1_step2', msg);
                                    }}
                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer mt-2"
                                  >
                                    Continue to Map Data
                                  </button>
                                )
                              )}
                            </div>
                          )}

                          {msg.agentTypeStep === 'agent1_step2' && (
                            <div className="space-y-2">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400">Step 2: Category Mapping</span>
                              <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                                {JSON.stringify(msg.agentResult.bucketMapping || msg.bucketMapping, null, 2)}
                              </pre>
                              {!msg.agentResult.completedStep && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    msg.agentResult.completedStep = true;
                                    handleAgent1Step('agent1_step3', msg);
                                  }}
                                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer mt-2"
                                >
                                  Assemble Data
                                </button>
                              )}
                            </div>
                          )}

                          {(msg.agentTypeStep === 'agent1_step3' || !msg.agentTypeStep) && (
                            <div className="space-y-2">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400">Processed Categories</span>
                              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                {(msg.agentResult.buckets || []).map((bucket: any, cidx: number) => (
                                  <div key={cidx} className="flex flex-col gap-1 p-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-850 text-xs">
                                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{bucket.systemName}</span>
                                    <div className="flex flex-wrap gap-1">
                                      {bucket.biomarkers?.map((b: any, bidx: number) => (
                                        <span key={bidx} className="px-1.5 py-0.5 bg-slate-600 dark:bg-slate-700 text-white text-[9px] font-semibold rounded-md">
                                          {b.name} ({b.history?.length || 0})
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Dynamic Triage Organizer Audit verification */}
                          {(() => {
                            let list1: string[] = [];
                            let list2: string[] = [];

                            if (msg.agentTypeStep === 'agent1_step1') {
                              // Find user's text message
                              const msgIdx = messages.findIndex(m => m.id === msg.id);
                              const precedingUserMsg = msgIdx !== -1 
                                ? [...messages.slice(0, msgIdx)].reverse().find(m => m.role === 'user')
                                : null;
                              const userText = precedingUserMsg?.content || '';
                              list1 = detectBiomarkersInText(userText);
                              
                              const yamlStr = msg.agentResult?.extractedYaml || msg.extractedYaml || '';
                              list2 = extractBiomarkerKeysFromYaml(yamlStr);
                            } else if (msg.agentTypeStep === 'agent1_step2') {
                              const yamlMsg = [...messages].reverse().find(m => m.agentType === 'agent1' && (m.agentResult?.extractedYaml || m.extractedYaml));
                              const yamlStr = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml || '';
                              list1 = extractBiomarkerKeysFromYaml(yamlStr);
                              
                              const mapping = msg.agentResult?.bucketMapping || msg.bucketMapping || {};
                              list2 = Object.keys(mapping);
                            } else if (msg.agentTypeStep === 'agent1_step3' || !msg.agentTypeStep) {
                              const yamlMsg = [...messages].reverse().find(m => m.agentType === 'agent1' && (m.agentResult?.extractedYaml || m.extractedYaml));
                              const yamlStr = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml || '';
                              list1 = extractBiomarkerKeysFromYaml(yamlStr);

                              const buckets = msg.agentResult?.buckets || [];
                              const temp: string[] = [];
                              buckets.forEach((b: any) => {
                                b.biomarkers?.forEach((bio: any) => {
                                  if (bio && bio.name) temp.push(bio.name);
                                });
                              });
                              list2 = temp;
                            }

                            if (list1.length === 0) return null;

                            const isMatch = (a: string, b: string) => {
                              const cleanA = a.toLowerCase().replace(/[^a-z0-9]/g, '');
                              const cleanB = b.toLowerCase().replace(/[^a-z0-9]/g, '');
                              return cleanA.includes(cleanB) || cleanB.includes(cleanA);
                            };
                            const difference = list1.filter(k1 => !list2.some(k2 => isMatch(k1, k2)));
                            const isPerfect = difference.length === 0;
                            const isExpanded = !!expandedAudits[msg.id];

                            return (
                              <div className="mt-3.5 border border-slate-150 dark:border-slate-800/80 rounded-xl overflow-hidden shadow-xs bg-slate-50/50 dark:bg-slate-900/40">
                                <button
                                  type="button"
                                  onClick={() => setExpandedAudits(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                                  className="w-full flex items-center justify-between p-3 bg-slate-100/65 dark:bg-slate-900 hover:bg-slate-150/70 dark:hover:bg-slate-850 transition-all text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer border-b border-slate-150 dark:border-slate-800/60"
                                >
                                  <span className="flex items-center gap-2">
                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Clinical Coverage & Data Integrity Audit</span>
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold uppercase tracking-wide ${
                                    isPerfect ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                                  }`}>
                                    {isPerfect ? '✓ Zero Loss' : '⚠️ Discrepancy'}
                                  </span>
                                </button>
                                
                                {isExpanded && (
                                  <div className={`p-3.5 text-xs space-y-2.5 transition-all ${
                                    isPerfect 
                                      ? 'bg-emerald-500/5 text-emerald-850 dark:text-emerald-300' 
                                      : 'bg-amber-500/5 text-amber-850 dark:text-amber-300'
                                  }`}>
                                    <div className="text-[11px] leading-relaxed text-slate-750 dark:text-slate-350">
                                      <span className="font-bold">{list1.length} biomarker{list1.length !== 1 ? 's' : ''} sent</span> (input from the website not from the agent), then <span className="font-bold">{list2.length} biomarker{list2.length !== 1 ? 's' : ''} received</span>.
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-3 gap-2 text-center text-slate-700 dark:text-slate-350 font-sans font-medium">
                                      <div className="bg-white/60 dark:bg-slate-950/50 p-2 rounded-lg border border-slate-150 dark:border-slate-800">
                                        <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Sent</p>
                                        <p className="text-xs font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">{list1.length}</p>
                                      </div>
                                      <div className="bg-white/60 dark:bg-slate-950/50 p-2 rounded-lg border border-slate-150 dark:border-slate-800">
                                        <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Received</p>
                                        <p className="text-xs font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">{list2.length}</p>
                                      </div>
                                      <div className="bg-white/60 dark:bg-slate-950/50 p-2 rounded-lg border border-slate-150 dark:border-slate-800">
                                        <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Difference</p>
                                        <p className={`text-xs font-extrabold font-mono mt-0.5 ${difference.length > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'}`}>{difference.length}</p>
                                      </div>
                                    </div>

                                    {difference.length > 0 ? (
                                      <div className="text-[10px] leading-normal text-slate-650 dark:text-slate-400 border-t border-slate-150 dark:border-slate-800 pt-2.5">
                                        <strong className="text-amber-700 dark:text-amber-400 font-semibold block mb-1">Omitted from System Analysis (Verification):</strong>
                                        <div className="flex flex-wrap gap-1">
                                          {difference.map((key) => (
                                            <span key={key} className="font-mono text-[9px] font-bold bg-amber-500/10 dark:bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-600 dark:text-amber-400">
                                              {key}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-[10px] leading-normal text-emerald-650 dark:text-emerald-400 font-medium border-t border-slate-150 dark:border-slate-800 pt-2.5">
                                        ✓ Perfect 100% data integrity. All extracted biomarkers were successfully mapped and accounted for in the systemic prognostic analysis.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {msg.agentType === 'agent2' && (
                        <div className="space-y-4">
                          {/* Primary Diagnosis */}
                          {(msg.agentResult.summary?.primaryDiagnosis || msg.agentResult.primaryDiagnosis) && (
                            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-150/60 dark:border-slate-800">
                              <span className="text-[9px] font-bold text-slate-400 block mb-0.5 uppercase tracking-wider">Primary System Diagnosis</span>
                              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-normal">
                                {msg.agentResult.summary?.primaryDiagnosis || msg.agentResult.primaryDiagnosis}
                              </p>
                            </div>
                          )}

                          {/* Timeline Projections */}
                          {(() => {
                            const timeline = msg.agentResult.summary?.timelineProjections || msg.agentResult.timelineProjections;
                            if (!timeline) return null;
                            return (
                              <div className="space-y-3 p-3.5 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-150/60 dark:border-slate-800">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Prognostic Timeline Projections</span>
                                <div className="relative pl-5 border-l border-slate-200 dark:border-slate-800 space-y-4">
                                  {timeline.year2 && (
                                    <div className="relative">
                                      <div className="absolute -left-[24.5px] top-1.5 w-2 h-2 rounded-full bg-indigo-500 ring-4 ring-white dark:ring-slate-900" />
                                      <h4 className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">2-Year Outlook</h4>
                                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-normal mt-0.5">{timeline.year2}</p>
                                    </div>
                                  )}
                                  {timeline.year5 && (
                                    <div className="relative">
                                      <div className="absolute -left-[24.5px] top-1.5 w-2 h-2 rounded-full bg-violet-500 ring-4 ring-white dark:ring-slate-900" />
                                      <h4 className="text-[11px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wide">5-Year Outlook</h4>
                                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-normal mt-0.5">{timeline.year5}</p>
                                    </div>
                                  )}
                                  {timeline.year10 && (
                                    <div className="relative">
                                      <div className="absolute -left-[24.5px] top-1.5 w-2 h-2 rounded-full bg-purple-500 ring-4 ring-white dark:ring-slate-900" />
                                      <h4 className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">10-Year Outlook</h4>
                                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-normal mt-0.5">{timeline.year10}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Gap analysis: received vs output metrics */}
                          {(() => {
                            // Find flat YAML list message
                            const yamlMsg = [...messages].reverse().find(m => m.extractedYaml || m.agentResult?.extractedYaml);
                            const yamlStr = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml || '';
                            const list1 = extractBiomarkerKeysFromYaml(yamlStr);

                            const prioritizedConditions = msg.agentResult.prioritizedConditions || [];
                            const list2 = extractBiomarkerKeysFromPrioritizedConditions(prioritizedConditions);
                            const difference = list1.filter(k1 => !list2.some(k2 => k2.toLowerCase() === k1.toLowerCase()));

                            if (list1.length > 0) {
                              const isPerfect = difference.length === 0;
                              return (
                                <div className={`p-3.5 rounded-xl border text-xs space-y-2.5 transition-all ${
                                  isPerfect 
                                    ? 'bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20 text-emerald-850 dark:text-emerald-300' 
                                    : 'bg-amber-500/10 dark:bg-amber-500/5 border-amber-500/20 text-amber-850 dark:text-amber-300'
                                }`}>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider block">Clinical Coverage & Data Integrity Audit</span>
                                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold uppercase tracking-wide ${
                                      isPerfect ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                                    }`}>
                                      {isPerfect ? '✓ Zero Loss' : '⚠️ Discrepancy'}
                                    </span>
                                  </div>
                                  
                                  {/* Stats Grid */}
                                  <div className="grid grid-cols-3 gap-2 text-center text-slate-700 dark:text-slate-350">
                                    <div className="bg-white/60 dark:bg-slate-900/40 p-2 rounded-lg border border-slate-100 dark:border-slate-800/40">
                                      <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Metrics Submitted</p>
                                      <p className="text-sm font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">{list1.length}</p>
                                    </div>
                                    <div className="bg-white/60 dark:bg-slate-900/40 p-2 rounded-lg border border-slate-100 dark:border-slate-800/40">
                                      <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Metrics Processed</p>
                                      <p className="text-sm font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">{list2.length}</p>
                                    </div>
                                    <div className="bg-white/60 dark:bg-slate-900/40 p-2 rounded-lg border border-slate-100 dark:border-slate-800/40">
                                      <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Difference</p>
                                      <p className={`text-sm font-extrabold font-mono mt-0.5 ${difference.length > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'}`}>{difference.length}</p>
                                    </div>
                                  </div>

                                  {/* Discrepancy details */}
                                  {difference.length > 0 ? (
                                    <div className="text-[10px] leading-normal text-slate-600 dark:text-slate-400">
                                      <strong className="text-amber-700 dark:text-amber-400 font-semibold">Omitted from System Analysis:</strong>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {difference.map((key) => (
                                          <span key={key} className="font-mono text-[9px] font-bold bg-amber-500/10 dark:bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-600 dark:text-amber-400">
                                            {key}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-[10px] leading-normal text-emerald-600 dark:text-emerald-400 font-medium">
                                      ✓ Perfect 100% data integrity. All extracted biomarkers were successfully mapped and accounted for in the systemic prognostic analysis.
                                    </p>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          })()}

                          {/* Proposed Lab Confirmations */}
                          {msg.agentResult.recommendedTests && msg.agentResult.recommendedTests.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[9px] font-mono font-bold text-rose-500 dark:text-rose-400 block uppercase tracking-wider">Proposed Lab Confirmations</span>
                              {msg.agentResult.recommendedTests.map((test: any, tidx: number) => (
                                <div key={tidx} className="p-2.5 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-100 dark:border-rose-900/30 text-xs">
                                  <p className="font-bold text-slate-900 dark:text-white">{test.testName}</p>
                                  <p className="text-[10px] text-slate-600 dark:text-slate-350 leading-normal mt-0.5">{test.reason}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Structured Biomarkers Table Trigger Button */}
                          {(() => {
                            const prioritizedConditions = msg.agentResult.prioritizedConditions || [];
                            const tableRows: Array<{system: string, biomarker: string, result: string, status: string, insight: string}> = [];
                            
                            prioritizedConditions.forEach((cond: any) => {
                              if (cond.biomarkers && Array.isArray(cond.biomarkers)) {
                                cond.biomarkers.forEach((m: any) => {
                                  // Real-time or historical trend insight
                                  let trendInsight = "";
                                  const keyLogs = biomarkerHistory.filter(h => h.biomarkers[m.key] !== undefined);
                                  if (keyLogs.length > 1) {
                                    const sortedLogs = [...keyLogs].sort((a, b) => a.date.localeCompare(b.date));
                                    const firstVal = sortedLogs[0].biomarkers[m.key];
                                    const lastVal = sortedLogs[sortedLogs.length - 1].biomarkers[m.key];
                                    const diff = lastVal - firstVal;
                                    const pct = firstVal !== 0 ? ((diff / firstVal) * 100).toFixed(0) : "0";
                                    trendInsight = `Trend: ${diff > 0 ? '▲' : '▼'} ${Math.abs(Number(pct))}% (${firstVal} → ${lastVal})`;
                                  } else {
                                    trendInsight = cond.clinicalRationale || "Stable or optimal level";
                                  }

                                  tableRows.push({
                                    system: cond.conditionName || 'Other',
                                    biomarker: m.name || m.key,
                                    result: `${m.currentValue !== undefined ? m.currentValue : 'Unset'} ${m.unit || ''}`.trim(),
                                    status: (m.status || 'NORMAL').toUpperCase(),
                                    insight: trendInsight
                                  });
                                });
                              } else if (cond.biomarkerKeys && Array.isArray(cond.biomarkerKeys)) {
                                cond.biomarkerKeys.forEach((key: string) => {
                                  const def = biomarkerDefinitions.find((d: any) => d.key === key);
                                  const val = biomarkers?.[key] !== undefined ? biomarkers[key] : (key === 'weight' ? profile?.weight : (key === 'height' ? profile?.height : undefined));
                                  const hasVal = val !== undefined && val !== '';
                                  const status = hasVal ? getBiomarkerStatus(key, Number(val), def?.normalRange) : 'NORMAL';
                                  
                                  tableRows.push({
                                    system: cond.condition || 'Other',
                                    biomarker: def?.name || key,
                                    result: hasVal ? `${val} ${def?.unit || ''}`.trim() : 'Unset',
                                    status: status.toUpperCase(),
                                    insight: cond.recommendations || "Monitor regularly"
                                  });
                                });
                              }
                            });

                            if (tableRows.length === 0) return null;

                            return (
                              <div className="mt-3">
                                <button
                                  type="button"
                                  onClick={() => setActiveModalTableRows(tableRows)}
                                  className="w-full py-2.5 px-3.5 bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-900/30 rounded-xl flex items-center justify-between text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer group shadow-sm"
                                >
                                  <span className="flex items-center gap-2">
                                    <Table className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                                    <span>Consolidated Biomarker Log</span>
                                  </span>
                                  <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full group-hover:scale-105 transition-transform">
                                    {tableRows.length} Indicators • View ↗
                                  </span>
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {msg.agentType === 'agent3' && msg.agentResult.contextualizedBiomarkers && (
                        <div className="space-y-3">
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            <span className="text-[9px] uppercase font-mono font-bold text-slate-400">Demographic Range Calibrations:</span>
                            <div className="space-y-2">
                              {msg.agentResult.contextualizedBiomarkers.map((bio: any, bidx: number) => (
                                <div key={bidx} className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-150/50 dark:border-slate-800 text-xs space-y-1">
                                  <div className="flex justify-between items-center">
                                    <span className="font-bold text-slate-800 dark:text-slate-200 uppercase">{bio.name}</span>
                                    <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full text-[10px]">
                                      normal: {bio.profileAdjustedNormalRange}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal font-medium">{bio.description}</p>
                                  {bio.specificRiskContext && (
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold leading-normal pt-1 border-t border-slate-100 dark:border-slate-800/40">{bio.specificRiskContext}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Consolidated Table Trigger for Reference Ranges */}
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                const tableRows: any[] = [];
                                (msg.agentResult.contextualizedBiomarkers || []).forEach((bio: any) => {
                                  const key = bio.name?.toLowerCase().replace(/\s+/g, '_') || '';
                                  const val = biomarkers?.[key] !== undefined ? biomarkers[key] : (key === 'weight' ? profile?.weight : (key === 'height' ? profile?.height : undefined));
                                  const hasVal = val !== undefined && val !== '';
                                  
                                  tableRows.push({
                                    biomarker: bio.name || bio.key || '',
                                    result: hasVal ? `${val}` : 'Unset',
                                    status: (bio.status || 'Healthy').toUpperCase(),
                                    refRange: bio.profileAdjustedNormalRange || 'N/A',
                                    insight: `${bio.description || ''}\n\n${bio.specificRiskContext || ''}`.trim()
                                  });
                                });
                                setActiveModalTitle('Demographically Calibrated Reference Ranges');
                                setActiveModalTableRows(tableRows);
                              }}
                              className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold border border-indigo-200/40 dark:border-indigo-800 flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
                            >
                              <Table className="w-4 h-4" />
                              View Consolidated Ranges Table
                            </button>
                          </div>

                          {/* Demographically Adjusted Data Integrity Audit */}
                          {(() => {
                            const yamlMsg = [...messages].reverse().find(m => m.extractedYaml || m.agentResult?.extractedYaml);
                            const yamlStr = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml || '';
                            const list1 = extractBiomarkerKeysFromYaml(yamlStr);

                            const contextualized = msg.agentResult.contextualizedBiomarkers || [];
                            const list2 = contextualized.map((b: any) => (b.name || b.key || '').toLowerCase());
                            const difference = list1.filter(k1 => !list2.some(k2 => k2.toLowerCase() === k1.toLowerCase() || k1.toLowerCase().includes(k2.toLowerCase()) || k2.toLowerCase().includes(k1.toLowerCase())));

                            if (list1.length > 0) {
                              const isPerfect = difference.length === 0;
                              const isExpanded = !!expandedAudits[msg.id];
                              return (
                                <div className="border border-slate-150 dark:border-slate-800/80 rounded-xl overflow-hidden shadow-xs bg-slate-50/50 dark:bg-slate-900/40">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedAudits(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                                    className="w-full flex items-center justify-between p-3 bg-slate-100/65 dark:bg-slate-900 hover:bg-slate-150/70 dark:hover:bg-slate-850 transition-all text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer border-b border-slate-150 dark:border-slate-800/60"
                                  >
                                    <span className="flex items-center gap-2">
                                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 font-mono">Reference Range Data Integrity Audit</span>
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold uppercase tracking-wide ${
                                      isPerfect ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                                    }`}>
                                      {isPerfect ? '✓ Zero Loss' : '⚠️ Discrepancy'}
                                    </span>
                                  </button>
                                  
                                  {isExpanded && (
                                    <div className={`p-3.5 text-xs space-y-2.5 transition-all ${
                                      isPerfect 
                                        ? 'bg-emerald-500/5 text-emerald-850 dark:text-emerald-300' 
                                        : 'bg-amber-500/5 text-amber-850 dark:text-amber-300'
                                    }`}>
                                      <div className="text-[11px] leading-relaxed text-slate-755 dark:text-slate-350">
                                        <span className="font-bold">{list1.length} biomarker{list1.length !== 1 ? 's' : ''} sent</span> (input from the website not from the agent), then <span className="font-bold">{list2.length} biomarker{list2.length !== 1 ? 's' : ''} calibrated</span>.
                                      </div>

                                      {/* Stats Grid */}
                                      <div className="grid grid-cols-3 gap-2 text-center text-slate-700 dark:text-slate-350 font-sans font-medium">
                                        <div className="bg-white/60 dark:bg-slate-950/50 p-2 rounded-lg border border-slate-150 dark:border-slate-800">
                                          <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Sent</p>
                                          <p className="text-xs font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">{list1.length}</p>
                                        </div>
                                        <div className="bg-white/60 dark:bg-slate-950/50 p-2 rounded-lg border border-slate-150 dark:border-slate-800">
                                          <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Calibrated</p>
                                          <p className="text-xs font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">{list2.length}</p>
                                        </div>
                                        <div className="bg-white/60 dark:bg-slate-950/50 p-2 rounded-lg border border-slate-150 dark:border-slate-800">
                                          <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Difference</p>
                                          <p className={`text-xs font-extrabold font-mono mt-0.5 ${difference.length > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'}`}>{difference.length}</p>
                                        </div>
                                      </div>

                                      {difference.length > 0 ? (
                                        <div className="text-[10px] leading-normal text-slate-650 dark:text-slate-400 border-t border-slate-150 dark:border-slate-800 pt-2.5">
                                          <strong className="text-amber-700 dark:text-amber-400 font-semibold block mb-1">Omitted from Calibration (Verification):</strong>
                                          <div className="flex flex-wrap gap-1">
                                            {difference.map((key) => (
                                              <span key={key} className="font-mono text-[9px] font-bold bg-amber-500/10 dark:bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-600 dark:text-amber-400">
                                                {key}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-[10px] leading-normal text-emerald-655 dark:text-emerald-400 font-medium border-t border-slate-150 dark:border-slate-800 pt-2.5">
                                          ✓ Perfect 100% data integrity. All extracted biomarkers were successfully calibrated and demographically mapped.
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}

                      {msg.agentType === 'agent4' && (
                        <div className="space-y-3">
                          {msg.agentResult.nutrientTargets && (
                            <div className="space-y-2">
                              <span className="text-[9px] uppercase font-mono font-bold text-slate-400">Calibrated Daily Allowances:</span>
                              
                              {/* Cards Grid */}
                              <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-[10px]">
                                {['calories', 'saturatedFat', 'totalFibre', 'protein'].map((nutKey) => {
                                  const rawNut = msg.agentResult.nutrientTargets[nutKey];
                                  const isObj = rawNut && typeof rawNut === 'object';
                                  const val = isObj ? rawNut.value : rawNut;
                                  const unit = isObj ? rawNut.unit : (nutKey === 'calories' ? 'kcal' : 'g');
                                  const label = nutKey === 'calories' ? 'Calories' : nutKey === 'saturatedFat' ? 'Sat. Fat' : nutKey === 'totalFibre' ? 'Fibre' : 'Protein';
                                  return (
                                    <div key={nutKey} className="p-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-lg shadow-xs">
                                      <span className="block text-[8px] text-slate-400 font-sans font-bold">{label}</span>
                                      <strong className="text-slate-800 dark:text-slate-200">{val || '—'} <span className="text-[8px] text-slate-500 font-normal">{unit}</span></strong>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Detailed Explanations for Recommended Allowances */}
                              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 pt-1.5 border-t border-slate-100 dark:border-slate-800/40">
                                <span className="text-[9px] font-mono font-bold text-slate-400 block uppercase">Allowances Clinical Rationale:</span>
                                {Object.entries(msg.agentResult.nutrientTargets).map(([nutKey, rawNut]: any) => {
                                  const isObj = rawNut && typeof rawNut === 'object';
                                  if (!isObj || !rawNut.reason) return null;
                                  
                                  const label = nutKey === 'calories' ? 'Calories' : nutKey === 'saturatedFat' ? 'Saturated Fat' : nutKey === 'totalFibre' ? 'Total Fibre' : nutKey === 'protein' ? 'Protein' : nutKey === 'carbs' ? 'Carbohydrates' : nutKey === 'fat' ? 'Total Fat' : nutKey === 'sodium' ? 'Sodium' : nutKey === 'sugar' ? 'Simple Sugar' : nutKey;
                                  return (
                                    <div key={nutKey} className="p-2 bg-slate-50/50 dark:bg-slate-900/60 rounded-lg border border-slate-150/40 dark:border-slate-800/40 text-[10px] space-y-1">
                                      <div className="flex justify-between items-center font-bold">
                                        <span className="text-slate-800 dark:text-slate-200 capitalize font-sans">{label}</span>
                                        {rawNut.duration && (
                                          <span className="font-mono text-indigo-600 dark:text-indigo-400 text-[8px] bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded-md">
                                            Duration: {rawNut.duration}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-slate-500 dark:text-slate-400 leading-normal font-medium">{rawNut.reason}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {msg.agentResult.projections && msg.agentResult.projections.length > 0 && (
                            <div className="space-y-1">
                              <span className="text-[9px] font-mono font-bold text-indigo-600 block">PHYSIOLOGICAL PROJECTIONS</span>
                              <div className="p-2.5 bg-indigo-50/20 dark:bg-indigo-950/10 rounded-xl border border-indigo-100/30 text-[10px] text-indigo-850 dark:text-indigo-300 font-medium space-y-1">
                                {msg.agentResult.projections.map((p: string, pidx: number) => (
                                  <p key={pidx}>&bull; {p}</p>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {msg.agentType === 'agent5' && msg.agentResult.insights && (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          <span className="text-[9px] uppercase font-mono font-bold text-slate-400">Scholarly Consensus Articles:</span>
                          <div className="space-y-2">
                            {msg.agentResult.insights.map((ins: any, iidx: number) => (
                              <div key={iidx} className="p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-150 rounded-xl text-xs space-y-1">
                                <h5 className="font-bold text-slate-900 dark:text-slate-100">{ins.title}</h5>
                                <p className="text-[10px] text-slate-500 leading-normal font-medium">{ins.summary}</p>
                                {ins.link && (
                                  <a href={ins.link} target="_blank" rel="noreferrer" className="text-[9px] text-indigo-600 font-bold block hover:underline">
                                    Primary Source &rarr;
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Confirm Button */}
                      {(msg.agentType !== 'agent1' || msg.agentTypeStep === 'agent1_step3' || !msg.agentTypeStep) && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (onAgentFinish) {
                              await onAgentFinish(msg.agentType!, msg.agentResult);
                              setLoggedMessageIds(prev => [...prev, msg.id]);
                              onClose();
                            }
                          }}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          Apply & Save Agent Findings
                        </button>
                      )}
                    </div>
                  )}

                  {/* Render extracted Pending Medical info */}
                  {type === 'medical' && !loggedMessageIds.includes(msg.id) && (((msg.pendingBiomarkerEntries && msg.pendingBiomarkerEntries.length > 0) || (msg.pendingBiomarkers && Object.keys(msg.pendingBiomarkers).length > 0)) || (msg.pendingProfile && Object.keys(msg.pendingProfile).length > 0) || (msg.mode === 'modify' && msg.modificationCommand && msg.modificationCommand.length > 0)) && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="border-b border-slate-100 dark:border-slate-800/50 pb-2">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs tracking-wider uppercase font-display">
                          {msg.mode === 'modify' ? 'Proposed Modifications' : 'Extracted Information'}
                        </h4>
                      </div>

                      <div className="space-y-4">
                        {msg.mode === 'modify' && msg.modificationCommand && msg.modificationCommand.length > 0 ? (
                          <div className="space-y-1">
                            {msg.modificationCommand.map((cmd, idx) => (
                              <div key={idx} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs px-2">
                                <span className="text-slate-600 dark:text-slate-400 font-medium">
                                  {cmd.action === 'remove_biomarker' ? 'Remove' : 'Update'} {cmd.keyName} {cmd.date ? `(${cmd.date})` : ''}
                                </span>
                                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                  {cmd.action === 'remove_biomarker' ? 'DELETED' : cmd.newValue}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            {msg.pendingProfile && Object.entries(msg.pendingProfile).filter(([k, v]) => typeof v !== 'object' && k !== 'customBiomarkers').length > 0 && (
                              <div className="space-y-1">
                                <h5 className="text-[10px] uppercase font-bold text-slate-500 mb-1">Profile Updates</h5>
                                {Object.entries(msg.pendingProfile)
                                  .filter(([key, val]) => typeof val !== 'object' && key !== 'customBiomarkers')
                                  .map(([key, val]) => (
                                  <div key={key} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs">
                                    <span className="text-slate-600 dark:text-slate-400 font-medium capitalize">
                                      {key}
                                    </span>
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                      {String(val)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.mode === 'plan' && msg.planningDetails && (
                              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-100 dark:border-blue-800/30">
                                <h5 className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400 mb-2">Extraction Plan</h5>
                                <div className="space-y-1.5 text-xs text-blue-800 dark:text-blue-200">
                                  <div className="flex justify-between">
                                    <span>Estimated Metrics:</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.estimatedTotalMetrics || 'Unknown'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Batches Required:</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.batchesRequired || 'Unknown'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Max Per Batch:</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.maxMetricsPerBatch}</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {(msg.pendingBiomarkerEntries && msg.pendingBiomarkerEntries.length > 0 ? msg.pendingBiomarkerEntries : (msg.pendingBiomarkers && Object.keys(msg.pendingBiomarkers).length > 0 ? [{ date: msg.pendingDate || null, biomarkers: msg.pendingBiomarkers }] : [])).map((entry, idx) => (
                              <div key={idx} className="space-y-1">
                                <div className="flex items-center justify-between py-1 bg-slate-50 dark:bg-slate-800/50 px-2 rounded-md mb-2">
                                  <span className="text-slate-500 dark:text-slate-400 font-bold text-[10px] uppercase">Record Date</span>
                                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs">{entry.date || 'Unknown Date'}</span>
                                </div>
                                {Object.entries(entry.biomarkers).map(([key, val]) => {
                                  const def = biomarkerDefinitions.find(d => d.key === key);
                                  const customDef = msg.pendingProfile?.customBiomarkers?.[key] || profile?.customBiomarkers?.[key];
                                  const name = def?.name || customDef?.name || key;
                                  const unit = def?.unit || customDef?.unit || '';
                                  return (
                                    <div key={key} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs px-2">
                                      <span className="text-slate-600 dark:text-slate-400 font-medium">
                                        {name}
                                      </span>
                                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                        {val} {String(val).includes(unit) ? '' : unit}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </>
                        )}
                      </div>

                      {msg.mode !== 'plan' && msg.mode !== 'discussion' && (
                        <div className="pt-2 space-y-2">
                          <button
                            onClick={() => {
                              if (onLogMedical) {
                                onLogMedical(msg.pendingBiomarkers || {}, msg.pendingProfile || {}, msg.pendingDate, msg.pendingBiomarkerEntries, msg.modificationCommand);
                                setLoggedMessageIds(prev => [...prev, msg.id]);
                                if (msg.status === 'needs_continuation') {
                                  handleSend("Proceed with extraction.");
                                } else {
                                  onClose();
                                }
                              }
                            }}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                            {msg.mode === 'modify' ? 'Apply modifications' : msg.status === 'needs_continuation' ? 'Save and continue to next batch' : 'Save extracted data'}
                          </button>
                          
                          <button
                            onClick={() => {
                              setLoggedMessageIds(prev => [...prev, msg.id]);
                              if (msg.status === 'needs_continuation') {
                                handleSend("Cancel extraction.");
                              }
                            }}
                            className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            } else {
              if (msg.content === 'Surprise me') return null;
              return (
                <div
                  key={msg.id}
                  className="flex gap-3 max-w-[85%] w-full min-w-0 ml-auto flex-row-reverse"
                >
                  <div className="space-y-2 flex-1 min-w-0 max-w-full">
                    <div className="relative group rounded-2xl px-3.5 py-2.5 leading-relaxed font-size-body shadow-sm font-medium break-words overflow-x-hidden bg-indigo-600 text-white">
                      <button
                        type="button"
                        onClick={() => handleDeleteMessagePair(msg.id)}
                        className="absolute right-2 top-2 p-1 text-indigo-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-20 cursor-pointer opacity-0 group-hover:opacity-100"
                        title="Delete conversation step"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      {msg.imageUrls && msg.imageUrls.length > 0 ? (
                        <div className="mb-2 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700/30 max-w-full">
                          <ImageSlider images={msg.imageUrls} altText="Attached meal pictures" />
                        </div>
                      ) : msg.imageUrl ? (
                        <div className="mb-2 rounded-lg overflow-hidden border border-white/10 max-h-40 max-w-full">
                          <img src={msg.imageUrl} alt="Attached meal" className="w-full h-full object-cover" />
                        </div>
                      ) : null}
                      <p className="whitespace-pre-line break-words">{msg.content}</p>
                    </div>
                  </div>
                </div>
              );
            }
          })}
        </>
      );
    })()}
        {isAnalyzing && (
          <div className="flex gap-3 mr-auto max-w-[85%]">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 flex-shrink-0 animate-pulse">
              <Loader className="w-4 h-4 animate-spin text-indigo-600" />
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 shadow-sm border border-slate-200 dark:border-slate-800/40">
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 font-medium">
                {type === 'food' ? `Analyzing food values using ${selectedModelId} model...` : `Searching for relevant body information using ${selectedModelId} model...`}
              </p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

        {/* Input Dock */}
        <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800/80 p-3 flex flex-col gap-2 shrink-0">
          {isCompressing && (
            <div className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-xl">
              <Loader className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
              <span className="text-[11px] text-indigo-700 dark:text-indigo-400 font-bold">
                Compressing image {compressionProgress.current} of {compressionProgress.total} ({compressionProgress.percent}%) ...
              </span>
            </div>
          )}

          {selectedImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1 max-w-full">
              {selectedImages.map((imgSrc, idx) => (
                <div key={idx} className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 flex-shrink-0 group">
                  <img src={imgSrc} alt="Preview thumbnail" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0 right-0 bg-slate-900/80 hover:bg-rose-600 text-white p-0.5 rounded-bl-lg transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}



          <div className="flex items-center gap-2">
            <button
              id="food-chat-photo-btn"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0"
              title={t.uploadPhoto}
            >
              <Image className="w-5 h-5" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              multiple
              className="hidden"
            />

            <button
              id="food-chat-camera-btn"
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0"
              title="Take photo from phone camera"
            >
              <Camera className="w-5 h-5" />
            </button>
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              capture="environment"
              className="hidden"
            />

            <input
              id="food-chat-input"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={t.chatPlaceholder}
              className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
            />

            <button
              id="food-chat-send-btn"
              onClick={handleSend}
              className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

      </div>

      {/* Full View Consolidated Log Modal */}
      {activeModalTableRows && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animation-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-scale-up">
            
            {/* Modal Header */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-950 dark:text-slate-100 font-display">
                    {activeModalTitle}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeModalTitle.includes('Reference')
                      ? 'Demographically adjusted reference ranges and risk analysis based on age, gender, and ethnicity'
                      : 'Unified view of system-by-system health indicators and 2-year longitudinal insights'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50/35 dark:bg-slate-950/20 font-sans">
              <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm">
                {/* min-w-[1200px] ensures the table is twice as wide for easier reading */}
                <table className="min-w-[1200px] w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/90 font-bold text-slate-500 dark:text-slate-400 sticky top-0 backdrop-blur-sm">
                    <tr>
                      <th className="px-4 py-3 w-[200px]">
                        {activeModalTitle.includes('Reference') ? 'Calibration Domain' : 'System'}
                      </th>
                      <th className="px-4 py-3 w-[180px]">Biomarker</th>
                      <th className="px-4 py-3 w-[120px] text-center">Result</th>
                      <th className="px-4 py-3 w-[100px] text-center">Status</th>
                      <th className="px-4 py-3 min-w-[600px]">
                        {activeModalTitle.includes('Reference') ? 'Profile Calibrated Ranges & Diagnostic Explanations' : '2-Year Trend / Insight (Twice as Wide)'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 dark:divide-slate-800/60 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-medium">
                    {activeModalTableRows.map((row, idx) => {
                      const stat = row.status.toUpperCase();
                      let badgeStyle = "text-slate-600 bg-slate-50 dark:bg-slate-900 border-slate-150";
                      if (stat === 'CRITICAL') {
                        badgeStyle = "text-rose-600 bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/40";
                      } else if (stat === 'WARNING' || stat === 'AMBER' || stat === 'HIGH' || stat === 'LOW') {
                        badgeStyle = "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/40";
                      } else if (stat === 'NORMAL' || stat === 'OPTIMAL') {
                        badgeStyle = "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/40";
                      }
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
                          <td className="px-4 py-3.5 font-bold text-slate-500 dark:text-slate-400 capitalize">{row.system}</td>
                          <td className="px-4 py-3.5 text-slate-900 dark:text-slate-100 font-bold">{row.biomarker}</td>
                          <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800 dark:text-slate-200">{row.result}</td>
                          <td className="px-4 py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold border ${badgeStyle}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-650 dark:text-slate-400 leading-relaxed font-medium whitespace-pre-line">
                            {row.insight}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Showing {activeModalTableRows.length} biomarker correlations. Tip: Use horizontal scroll on narrow views.
              </span>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Close View
              </button>
            </div>

          </div>
        </div>
      )}

      <FullScreenInstructionViewer
        isOpen={activeInstructionAgentType !== null}
        onClose={() => setActiveInstructionAgentType(null)}
        agentType={activeInstructionAgentType || ''}
      />
    </div>
  );
}
