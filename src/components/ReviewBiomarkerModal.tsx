import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage, UserProfile, BiomarkerLog } from '../types';
import { translations } from '../utils/translations';
import { X, Send, Sparkles, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerColor } from '../utils/biomarkers';
import LLMSelector from './LLMSelector';

interface ReviewBiomarkerModalProps {
  profile: UserProfile;
  isOpen: boolean;
  biomarkerKey: string;
  currentValue: number | string;
  onClose: () => void;
  onUpdateBiomarker: (key: string, value: string | number, proposal?: any) => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  initialMessages?: ChatMessage[];
  onUpdateMessages?: (msgs: ChatMessage[]) => void;
}

export default function ReviewBiomarkerModal({ 
  profile, 
  isOpen, 
  biomarkerKey, 
  currentValue, 
  onClose, 
  onUpdateBiomarker,
  selectedModelId,
  onChangeModelId,
  initialMessages,
  onUpdateMessages
}: ReviewBiomarkerModalProps) {
  const t = translations[profile.language] || translations.en;
  
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (initialMessages && initialMessages.length > 0) {
      return initialMessages;
    }
    return [];
  });
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isEngineSelectorOpen, setIsEngineSelectorOpen] = useState(false);
  const [showDataUsed, setShowDataUsed] = useState(false);
  const [hasLoadedPrevious, setHasLoadedPrevious] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Combine standard definitions and custom definitions
  const allDefinitions = useMemo(() => {
    const combined = biomarkerDefinitions.map(d => ({
      ...d,
      descriptions: { ...d.descriptions }
    }));
    
    if (profile.customBiomarkers) {
      Object.entries(profile.customBiomarkers).forEach(([key, def]) => {
        const existing = combined.find(d => d.key === key);
        if (existing) {
          existing.normalRange = def.normalRange || existing.normalRange;
          existing.unit = def.unit || existing.unit;
          if (def.description) {
            existing.descriptions = { ...existing.descriptions, en: def.description };
          }
          if (def.benefitRisk) {
            (existing as any).benefitRisk = def.benefitRisk;
          }
        } else {
          combined.push({
            key,
            name: def.name || key,
            category: 'other',
            unit: def.unit || '',
            normalRange: def.normalRange || 'Unknown',
            descriptions: {
              en: def.description || ''
            },
            benefitRisk: def.benefitRisk
          } as any);
        }
      });
    }
    return combined;
  }, [profile.customBiomarkers]);

  const def = allDefinitions.find(d => d.key === biomarkerKey);
  const status = getBiomarkerStatus(biomarkerKey, currentValue, def?.normalRange || '');
  const descriptionText = def ? (def.descriptions[profile.language] || def.descriptions.en) : '';

  useEffect(() => {
    if (isOpen && def && messages.length === 0) {
      setMessages([
        {
          id: `welcome_${biomarkerKey}`,
          role: 'assistant',
          content: `Let's review your data for **${def.name}**.\n\nCurrent Value: ${currentValue} ${def.unit}\nStatus: ${status}\nNormal Range: ${def.normalRange}\n\nWhat would you like to discuss or correct about this?`,
          timestamp: new Date().toISOString()
        }
      ]);
    }
  }, [isOpen, biomarkerKey, def]);

  // Sync messages back to parent using a safe ref pattern to completely avoid infinite re-render loops
  const onUpdateMessagesRef = useRef(onUpdateMessages);
  useEffect(() => {
    onUpdateMessagesRef.current = onUpdateMessages;
  }, [onUpdateMessages]);

  useEffect(() => {
    if (onUpdateMessagesRef.current && messages.length > 0) {
      onUpdateMessagesRef.current(messages);
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAnalyzing]);

  if (!isOpen || !def) return null;

  const handleSend = async () => {
    if (!inputText.trim() && !isAnalyzing) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsAnalyzing(true);

    try {
      const historyContext = messages.map(m => ({ role: m.role, content: m.content }));
      
      const payload = {
        message: userMsg.content,
        history: historyContext,
        profile,
        biomarkerDef: {
          ...def,
          description: descriptionText
        },
        currentValue,
        modelId: selectedModelId
      };

      const res = await fetch('/api/gemini/review-biomarker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let errJson;
        try {
          errJson = await res.json();
        } catch (_) {}
        throw new Error(errJson?.error || `HTTP ${res.status} ${res.statusText}`);
      }
      
      const data = await res.json();
      
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply,
        pendingBiomarkers: data.pendingBiomarkers || (data.proposedValue !== undefined && data.proposedValue !== null ? { [biomarkerKey]: data.proposedValue } : undefined),
        proposal: data.proposal || undefined,
        timestamp: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error(err);
      const errorCode = err.name || "API_ERROR";
      const errorMsg = err.message || "Unknown error occurred during API communication";
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, there was an error processing your request. Please try again. [Error Code: ${errorCode} - ${errorMsg}]`,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/40 backdrop-blur-sm sm:p-4 p-0">
      <div className="flex-1 bg-white dark:bg-slate-900 sm:rounded-[32px] rounded-none shadow-2xl flex flex-col overflow-hidden max-w-3xl w-full mx-auto relative border border-slate-200 dark:border-slate-800">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800/60 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 leading-tight">Review Biomarker</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-slate-500 font-medium">Discussing {def.name}</span>
                <span className="text-[10px] text-slate-300 dark:text-slate-700">•</span>
                <button
                  type="button"
                  onClick={() => setIsEngineSelectorOpen(!isEngineSelectorOpen)}
                  className="flex items-center gap-1 text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold hover:text-indigo-700 transition-colors focus:outline-none cursor-pointer"
                >
                  <span>{selectedModelId === 'gemini-3.1-flash-lite' ? 'Gemini 3.1 flash lite' : 
                         selectedModelId === 'gemini-1.5-pro' ? 'Gemini 1.5 pro' :
                         selectedModelId === 'gemini-1.5-flash' ? 'Gemini 1.5 flash' :
                         selectedModelId === 'gemini-2.5-flash' ? 'Gemini 2.5 flash' : selectedModelId}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isEngineSelectorOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`} />
                </button>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Expandable Model Selector Dropdown */}
        {isEngineSelectorOpen && (
          <div className="px-4 py-2.5 bg-indigo-50/50 dark:bg-indigo-950/25 border-b border-indigo-100 dark:border-indigo-950/40">
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

        {/* Expandable Data Used by Agent Block */}
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setShowDataUsed(!showDataUsed)}
            className="w-full flex items-center justify-between text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold cursor-pointer transition-colors py-1.5"
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold font-sans text-slate-600 dark:text-slate-300">
              Data used by agent
            </span>
            <div className="flex items-center text-slate-400 dark:text-slate-500">
              {showDataUsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>
          
          {showDataUsed && (
            <div className="mt-2 pt-3 pb-2 border-t border-slate-100 dark:border-slate-800/40 flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/30 p-3 rounded-xl">
              <div><strong className="text-slate-800 dark:text-slate-200">Biomarker:</strong> {def.name} ({def.key})</div>
              <div><strong className="text-slate-800 dark:text-slate-200">Current:</strong> {currentValue} {def.unit}</div>
              <div><strong className="text-slate-800 dark:text-slate-200">Range:</strong> {def.normalRange}</div>
              <div><strong className="text-slate-800 dark:text-slate-200">User Profile:</strong> Age {profile.age || 'N/A'} • {profile.gender || 'N/A'} • {(() => {
                if (profile.weight && profile.height) {
                  const heightInMeters = Number(profile.height) / 100;
                  const bmi = Number(profile.weight) / (heightInMeters * heightInMeters);
                  return `BMI: ${bmi.toFixed(1)}`;
                }
                return "BMI: N/A";
              })()} • {profile.ethnicity || 'N/A'}</div>
              <div className="w-full mt-1 pt-1.5 border-t border-slate-150 dark:border-slate-800/40"><strong className="text-slate-800 dark:text-slate-200">Description:</strong> {descriptionText}</div>
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {initialMessages && initialMessages.length > 1 && !hasLoadedPrevious && (
            <div className="flex justify-center pb-2 border-b border-slate-100 dark:border-slate-800/40">
              <button 
                type="button"
                onClick={() => {
                  setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m.id));
                    const uniquePrevious = initialMessages.filter(m => !existingIds.has(m.id));
                    return [...uniquePrevious, ...prev].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
                  });
                  setHasLoadedPrevious(true);
                }}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-full cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                View previous conversation
              </button>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] rounded-2xl p-3.5 text-sm font-medium leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 rounded-tr-sm' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm'
              }`}>
                <p className="whitespace-pre-line break-words">{msg.content}</p>
              </div>
              
              {/* Detailed Proposal Block */}
              {msg.role === 'assistant' && msg.proposal && (
                <div className="mt-3 bg-indigo-50/70 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700/60 rounded-2xl p-4 max-w-[85%] w-full shadow-md animate-fade-in">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-indigo-100/50 dark:border-slate-700/40">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">Proposed Correction Details</span>
                  </div>
                  
                  <div className="space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Biomarker</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{msg.proposal.name}</span>
                      </div>
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Proposed Value</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">{msg.proposal.value} {msg.proposal.metric}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Metric / Unit</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{msg.proposal.metric}</span>
                      </div>
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Healthy Range</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{msg.proposal.range}</span>
                      </div>
                    </div>

                    <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Description</span>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">{msg.proposal.description}</p>
                    </div>

                    <div className="bg-indigo-50/40 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100/40 dark:border-indigo-950/30">
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 block uppercase font-bold tracking-wide">Profile Benefit & Risk Assessment</span>
                      <p className="text-slate-700 dark:text-slate-200 font-semibold leading-relaxed mt-1 text-[11px]">{msg.proposal.benefitRisk}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 justify-end pt-3 border-t border-indigo-100/30 dark:border-slate-700/30">
                    <button
                      onClick={onClose}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        const textarea = document.querySelector('textarea');
                        if (textarea) {
                          textarea.focus();
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      Keep Discussing
                    </button>
                    <button
                      onClick={() => {
                        const valToUse = msg.pendingBiomarkers && msg.pendingBiomarkers[biomarkerKey] !== undefined
                          ? msg.pendingBiomarkers[biomarkerKey]
                          : msg.proposal?.value;
                        if (valToUse !== undefined) {
                          onUpdateBiomarker(biomarkerKey, valToUse, msg.proposal);
                        }
                      }}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm shadow-indigo-600/10 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                    >
                      Approve & Replace
                    </button>
                  </div>
                </div>
              )}

              {/* Simple Proposal Block Fallback */}
              {msg.role === 'assistant' && !msg.proposal && msg.pendingBiomarkers && msg.pendingBiomarkers[biomarkerKey] !== undefined && (
                <div className="mt-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-xl p-3 max-w-[85%] w-full flex items-center justify-between">
                  <div>
                    <span className="block text-[10px] text-indigo-500 font-bold uppercase tracking-wide">Proposed Update</span>
                    <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{msg.pendingBiomarkers[biomarkerKey]} {String(msg.pendingBiomarkers[biomarkerKey]).includes(def.unit) ? '' : def.unit}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const textarea = document.querySelector('textarea');
                        if (textarea) textarea.focus();
                      }}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      Keep Discussing
                    </button>
                    <button 
                      onClick={() => {
                        onUpdateBiomarker(biomarkerKey, msg.pendingBiomarkers![biomarkerKey]);
                        onClose();
                      }}
                      className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {isAnalyzing && (
            <div className="flex items-start">
              <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-sm p-4 text-slate-500 flex items-center gap-2">
                <Loader className="w-4 h-4 animate-spin text-indigo-600" />
                <span className="text-xs font-semibold animate-pulse">Analyzing...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Box */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-1 shadow-inner focus-within:ring-2 focus-within:ring-indigo-500/20 transition-shadow">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask about this biomarker or propose a correction..."
              className="flex-1 bg-transparent px-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none resize-none h-10 max-h-32 min-h-10"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || isAnalyzing}
              className="p-2 ml-1 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
