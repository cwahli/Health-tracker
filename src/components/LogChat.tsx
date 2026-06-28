import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, FoodLog, UserProfile, FoodIdea } from '../types';
import { translations } from '../utils/translations';
import { X, Send, Image, Camera, MessageSquare, Sparkles, Plus, ChevronDown, ChevronUp, Loader, MapPin } from 'lucide-react';
import { nutrientDefinitions } from '../utils/nutrition';
import { biomarkerDefinitions, getBiomarkerStatus, isAsianEthnicity, getBiomarkerStatusLabel } from '../utils/biomarkers';
import LLMSelector from './LLMSelector';
import { compressMultipleImages } from '../utils/imageCompressor';
import { getCurrentDateInTimezone } from '../utils/dateUtils';
import ImageSlider from './ImageSlider';
import { InteractivePlacesMap } from './InteractivePlacesMap';
import exifr from 'exifr';

interface LogChatProps {
  type: 'food' | 'medical' | 'food_idea';
  profile?: UserProfile | null;
  isOpen: boolean;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  onClose: () => void;
  onLogFood?: (food: FoodLog) => void;
  onLogFoodIdeas?: (ideas: FoodIdea[]) => void;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string) => void;
  biomarkers?: { [key: string]: number | string };
  foodLogs?: FoodLog[];
  report?: any;
}

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
  report
}: LogChatProps) {
  const [showDataUsed, setShowDataUsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = sessionStorage.getItem(`chat_messages_${type}`);
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
            : 'Hello! I can help you parse blood report photos, medical test charts, or manual body logs. Let me know what information you would like to enter today.',
        timestamp: new Date().toISOString()
      }
    ];
  });

  useEffect(() => {
    sessionStorage.setItem(`chat_messages_${type}`, JSON.stringify(messages));
  }, [messages, type]);

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
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
    if (isOpen && type === 'food_idea') {
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
      
      const status = getBiomarkerStatus(key, Number(val), normalRange);
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
      const clean = String(val).replace(/,/g, '').replace(/[^\d]/g, '');
      const parsed = parseInt(clean, 10);
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

      const bodyData: any = {
        message: userMsg.content,
        image: tempImages[0] || null,
        images: tempImages.length > 0 ? tempImages : null,
        imageDates: tempDates.length > 0 ? tempDates : null,
        history: messages.map(m => {
          let extra = "";
          if (m.role === 'assistant') {
            if (m.pendingBiomarkers) extra += `\n[Extracted Biomarkers: ${JSON.stringify(m.pendingBiomarkers)}]`;
            if (m.pendingFoodLog) extra += `\n[Extracted Food: ${JSON.stringify(m.pendingFoodLog)}]`;
            if (m.pendingDate) extra += `\n[Extracted Date: ${m.pendingDate}]`;
            if (m.pendingProfile) extra += `\n[Extracted Profile: ${JSON.stringify(m.pendingProfile)}]`;
          }
          return { role: m.role, content: m.content + extra };
        }),
        userProfile: profile,
        engine: selectedModelId
      };

      if (type === 'food') {
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
        bodyData.location = userLocation;
        bodyData.recentMeals = foodLogs.slice(-20).map(f => f.name);
        bodyData.budget = budget;
        bodyData.currency = currency;
        bodyData.maxDistance = maxDistance;
        
        // Fetch real places from Overpass API (client-side bypasses container blocks)
        if (userLocation) {
          try {
            const radius = Math.min(Number(maxDistance) * 1000, 5000);
            const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${userLocation.lat},${userLocation.lng}););out 30;`;
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
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            imageUrl: tempImages[0] || lastFoodLog?.imageUrl || undefined,
            imageUrls: tempImages.length > 0 ? tempImages : (lastFoodLog?.imageUrls || undefined)
          };
        }
      } else if (type === 'food_idea') {
        if (resData.ideas && resData.ideas.length > 0) {
          assistantMsg.pendingFoodIdeas = resData.ideas;
        }
      } else {
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

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `Error running analysis with selected engine: ${err.message || 'Server connection timed out.'}`,
          timestamp: new Date().toISOString()
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
        <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-950 dark:text-slate-100 font-display">{type === 'food' ? t.addFood : type === 'food_idea' ? 'Food ideas' : t.addMedical}</h2>
              <button
                type="button"
                onClick={() => setIsEngineSelectorOpen(!isEngineSelectorOpen)}
                className="flex items-center gap-1 text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold hover:text-indigo-700 transition-colors focus:outline-none cursor-pointer"
              >
                <span>{selectedModelId === 'gemini-3.1-flash-lite' ? 'Gemini 3.1 flash lite' : 
                       selectedModelId === 'gemini-1.5-pro' ? 'Gemini 1.5 pro' :
                       selectedModelId === 'gemini-1.5-flash' ? 'Gemini 1.5 flash' :
                       selectedModelId === 'gemini-2.5-flash' ? 'Gemini 2.5 flash' : 'Gemini 3.1 flash lite'}</span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isEngineSelectorOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`} />
              </button>
            </div>
          </div>
          
          <button 
            id="close-food-chat-btn"
            onClick={onClose} 
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
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
          {(type === 'food' || type === 'food_idea') && (
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
              
              {loggedMessageIds.length > 0 && (
                <div className="flex items-center justify-center mt-2 pt-1 border-t border-slate-100 dark:border-slate-800/10">
                   <button
                      type="button"
                      onClick={() => setShowPastDiscussion(!showPastDiscussion)}
                      className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>{showPastDiscussion ? "Hide past discussion" : "View past discussion"}</span>
                    </button>
                </div>
              )}
              
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

                  {/* Warning Biomarkers */}
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

                  {/* Remaining Daily Allowances */}
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
                {hasPastMessages && (
                  <div className="flex justify-center mb-4 mt-2">
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
                  className="w-full space-y-2.5 px-1 min-w-0"
                >
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
                    {msg.id.startsWith('welcome_') && type === 'food_idea' && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => handleSend('Surprise me')}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-indigo-600/10 flex items-center gap-1.5 animate-pulse"
                        >
                          Surprise Me
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
                        <p className="text-indigo-600 dark:text-indigo-400"><strong>{t.benefits}:</strong> {msg.pendingFoodLog.benefits}</p>
                        {msg.pendingFoodLog.risks && <p className="text-rose-600 dark:text-rose-400"><strong>{t.risks}:</strong> {msg.pendingFoodLog.risks}</p>}
                        <p><strong>{t.impact}:</strong> {msg.pendingFoodLog.healthImpact}</p>
                      </div>

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

                  {/* Render extracted Pending Medical info */}
                  {type === 'medical' && !loggedMessageIds.includes(msg.id) && ((msg.pendingBiomarkers && Object.keys(msg.pendingBiomarkers).length > 0) || (msg.pendingProfile && Object.keys(msg.pendingProfile).length > 0)) && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="border-b border-slate-100 dark:border-slate-800/50 pb-2">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs tracking-wider uppercase font-display">
                          Extracted Information
                        </h4>
                      </div>

                      <div className="space-y-1">
                        {msg.pendingDate && (
                          <div className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs">
                            <span className="text-slate-600 dark:text-slate-400 font-medium">Record Date</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{msg.pendingDate}</span>
                          </div>
                        )}
                        {msg.pendingProfile && Object.entries(msg.pendingProfile)
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
                        {msg.pendingBiomarkers && Object.entries(msg.pendingBiomarkers).map(([key, val]) => {
                          const def = biomarkerDefinitions.find(d => d.key === key);
                          const customDef = msg.pendingProfile?.customBiomarkers?.[key] || profile?.customBiomarkers?.[key];
                          const name = def?.name || customDef?.name || key;
                          const unit = def?.unit || customDef?.unit || '';
                          return (
                            <div key={key} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs">
                              <span className="text-slate-600 dark:text-slate-400 font-medium">
                                {name}
                              </span>
                              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                {val} {unit}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Log Action Button */}
                      <button
                        onClick={() => {
                          if (onLogMedical) {
                            onLogMedical(msg.pendingBiomarkers || {}, msg.pendingProfile || {}, msg.pendingDate);
                            setLoggedMessageIds(prev => [...prev, msg.id]);
                            onClose();
                          }
                        }}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        Add to my profile
                      </button>
                    </div>
                  )}
                </div>
              );
            } else {
              return (
                <div
                  key={msg.id}
                  className="flex gap-3 max-w-[85%] w-full min-w-0 ml-auto flex-row-reverse"
                >
                  <div className="space-y-2 flex-1 min-w-0 max-w-full">
                    <div className="rounded-2xl px-3.5 py-2.5 leading-relaxed font-size-body shadow-sm font-medium break-words overflow-x-hidden bg-indigo-600 text-white">
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
        <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800/80 p-3 flex flex-col gap-2">
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
    </div>
  );
}
