import React, { useState } from 'react';
import { AVAILABLE_LLMS, LLMModel } from '../utils/llm';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

interface LLMSelectorProps {
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  label?: string;
  variant?: 'card' | 'inline';
}

export default function LLMSelector({ selectedModelId, onChangeModelId, label = "AI LLM Engine", variant = 'card' }: LLMSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const currentModel = AVAILABLE_LLMS.find(m => m.id === selectedModelId) || AVAILABLE_LLMS.find(m => m.isDefault) || AVAILABLE_LLMS[0];

  const handleSelect = (id: string) => {
    onChangeModelId(id);
    setIsOpen(false);
  };

  if (variant === 'inline') {
    return (
      <div className="grid grid-cols-1 gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl shadow-sm max-h-72 overflow-y-auto">
        {AVAILABLE_LLMS.map((m) => {
          const isSelected = m.id === selectedModelId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChangeModelId(m.id)}
              className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1 border ${
                isSelected
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/40 shadow-sm'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 border-transparent'
              }`}
            >
              <div className="flex items-center justify-between w-full gap-2">
                <span className={`font-bold truncate ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}>
                  {m.name}
                  {m.isDefault && <span className="ml-1.5 text-[8px] uppercase tracking-wider text-indigo-500 font-extrabold">(Default)</span>}
                </span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex-shrink-0">
                  {m.rpd}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal text-left font-medium">
                {m.description}
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-800/60">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {label}
        </label>
      </div>

      {/* Selectable Dropdown Header */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl text-left text-xs text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-750 transition-all cursor-pointer font-bold"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <span>{currentModel.name}</span>
          </div>
          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {/* Dropdown Options List */}
        {isOpen && (
          <div className="absolute left-0 right-0 mt-1.5 z-50 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-750 rounded-xl shadow-xl max-h-72 overflow-y-auto p-1.5 space-y-1">
            {AVAILABLE_LLMS.map((m) => {
              const isSelected = m.id === selectedModelId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex flex-col gap-1 ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between w-full gap-2">
                    <span className={`font-bold truncate ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}>
                      {m.name}
                      {m.isDefault && <span className="ml-1.5 text-[8px] uppercase tracking-wider text-indigo-500 font-extrabold">(Default)</span>}
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex-shrink-0">
                      {m.rpd}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal text-left font-medium">
                    {m.description}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
