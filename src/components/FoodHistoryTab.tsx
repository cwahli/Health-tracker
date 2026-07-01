import React, { useState, useRef, useEffect } from 'react';
import { UserProfile, FoodLog, NutrientBreakdown } from '../types';
import { translations } from '../utils/translations';
import { Edit2, Trash2, Calendar, Search, ChevronDown, ChevronUp, Image as ImageIcon, Save, Check, Plus, Loader, X, Camera } from 'lucide-react';
import { nutrientDefinitions } from '../utils/nutrition';
import { db, auth } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { compressMultipleImages } from '../utils/imageCompressor';
import { getCurrentDateInTimezone } from '../utils/dateUtils';
import ImageSlider from './ImageSlider';
import { resolveFoodImage, resolveFoodImages } from '../utils/imageResolver';

interface FoodHistoryTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  onUpdateFoodLog: (food: FoodLog) => void;
  onDeleteFoodLog: (id: string) => void;
  onLogFood?: (food: FoodLog) => void;
  onEditingActiveChange?: (active: boolean) => void;
  isManualEntryOpen?: boolean;
  onManualEntryOpenChange?: (open: boolean) => void;
}

function cleanData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    return value === undefined ? null : value;
  }));
}

const formatLogDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[2], 10);
    const monthIndex = parseInt(parts[1], 10) - 1;
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = months[monthIndex] || parts[1];
    return `${day} ${monthName}`;
  }
  return dateStr;
};

export default function FoodHistoryTab({
  profile,
  foodLogs,
  onUpdateFoodLog,
  onDeleteFoodLog,
  onLogFood,
  onEditingActiveChange,
  isManualEntryOpen: propIsManualEntryOpen,
  onManualEntryOpenChange
}: FoodHistoryTabProps) {
  const t = translations[profile.language] || translations.en;
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  
  // Photo and compression states inside card edit
  const [cardCompressingLogId, setCardCompressingLogId] = useState<string | null>(null);
  const [cardCompressingProgress, setCardCompressingProgress] = useState({ current: 0, total: 0, percent: 0 });

  // Drag and drop sorting state for photos
  const [draggedPhotoIndex, setDraggedPhotoIndex] = useState<number | null>(null);

  // Editing states
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editLogState, setEditLogState] = useState<FoodLog | null>(null);

  useEffect(() => {
    if (onEditingActiveChange) {
      onEditingActiveChange(!!editingLogId);
    }
  }, [editingLogId, onEditingActiveChange]);

  // Manual Entry States
  const [localManualEntryOpen, setLocalManualEntryOpen] = useState(false);
  const isManualEntryOpen = propIsManualEntryOpen !== undefined ? propIsManualEntryOpen : localManualEntryOpen;
  const setIsManualEntryOpen = (val: boolean) => {
    setLocalManualEntryOpen(val);
    if (onManualEntryOpenChange) {
      onManualEntryOpenChange(val);
    }
  };
  const [manualCompressing, setManualCompressing] = useState(false);
  const [manualCompressingProgress, setManualCompressingProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [manualLog, setManualLog] = useState<Partial<FoodLog>>({
    date: getCurrentDateInTimezone(profile.timezone),
    name: '',
    composition: '',
    weightGrams: 150,
    quantity: '1 serving',
    benefits: 'Custom manually logged food.',
    risks: 'None reported.',
    healthImpact: 'Supports daily nutritional goals.',
    recommendation: 'neutral',
    imageUrls: [],
    nutrients: {
      calories: 0,
      protein: 0,
      totalFat: 0,
      saturatedFat: 0,
      unsaturatedFat: 0,
      omega3: 0,
      carbohydrates: 0,
      addedSugar: 0,
      totalFibre: 0,
      solubleFibre: 0,
      sodium: 0,
      potassium: 0,
      magnesium: 0,
      calcium: 0,
      iron: 0,
      zinc: 0,
      selenium: 0,
      iodine: 0,
      phosphorus: 0,
      vitaminD: 0,
      vitaminB12: 0,
      folate: 0,
      vitaminC: 0,
      vitaminE: 0,
      vitaminK: 0,
      vitaminA: 0,
      vitaminB6: 0,
      thiamine: 0,
      riboflavin: 0,
      niacin: 0
    }
  });

  const updateField = (field: keyof FoodLog, value: any) => {
    if (!editLogState) return;
    setEditLogState({
      ...editLogState,
      [field]: value
    });
  };

  const updateNutrient = (nutrientKey: keyof NutrientBreakdown, value: number) => {
    if (!editLogState) return;
    setEditLogState({
      ...editLogState,
      nutrients: {
        ...(editLogState.nutrients || {}),
        [nutrientKey]: value
      } as NutrientBreakdown
    });
  };

  // Drag-and-drop Photo sorting
  const handlePhotoDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPhotoIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePhotoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedPhotoIndex === null || draggedPhotoIndex === index || !editLogState) return;

    const currentUrls = editLogState.imageUrls ? [...editLogState.imageUrls] : (editLogState.imageUrl ? [editLogState.imageUrl] : []);
    const updatedUrls = [...currentUrls];
    
    // Perform splice
    const [draggedItem] = updatedUrls.splice(draggedPhotoIndex, 1);
    updatedUrls.splice(index, 0, draggedItem);
    
    setDraggedPhotoIndex(index);
    setEditLogState({
      ...editLogState,
      imageUrls: updatedUrls,
      imageUrl: updatedUrls[0] || ''
    });
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoIndex(null);
  };

  // Drag-and-drop for manual log photos
  const handleManualPhotoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedPhotoIndex === null || draggedPhotoIndex === index) return;

    const currentUrls = manualLog.imageUrls ? [...manualLog.imageUrls] : [];
    const updatedUrls = [...currentUrls];
    
    const [draggedItem] = updatedUrls.splice(draggedPhotoIndex, 1);
    updatedUrls.splice(index, 0, draggedItem);
    
    setDraggedPhotoIndex(index);
    setManualLog({
      ...manualLog,
      imageUrls: updatedUrls,
      imageUrl: updatedUrls[0] || ''
    });
  };

  const filteredLogs = [...foodLogs]
    .filter(log => {
      const name = log.name || '';
      const composition = log.composition || '';
      const healthImpact = log.healthImpact || '';
      return name.toLowerCase().includes(searchTerm.toLowerCase()) ||
             composition.toLowerCase().includes(searchTerm.toLowerCase()) ||
             healthImpact.toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;
      return b.id.localeCompare(a.id);
    });

  const handleStartEdit = (log: FoodLog) => {
    setEditingLogId(log.id);
    setEditLogState(JSON.parse(JSON.stringify(log)));
  };

  const handleSaveEdit = () => {
    if (editLogState) {
      onUpdateFoodLog(editLogState);
    }
    setEditingLogId(null);
    setEditLogState(null);
  };

  const handleSaveManualLog = () => {
    if (!manualLog.name?.trim()) {
      alert("Please provide a name for the manual log.");
      return;
    }
    if (onLogFood) {
      const fullLog: FoodLog = {
        ...manualLog,
        id: `food_manual_${Date.now()}`,
        date: manualLog.date || getCurrentDateInTimezone(profile.timezone),
        name: manualLog.name,
        composition: manualLog.composition || 'Manually logged ingredients',
        weightGrams: Number(manualLog.weightGrams) || 100,
        quantity: manualLog.quantity || '1 serving',
        benefits: manualLog.benefits || 'Manually logged food benefits.',
        risks: manualLog.risks || 'No reported risks.',
        healthImpact: manualLog.healthImpact || 'Supports biomarker balances.',
        recommendation: manualLog.recommendation || 'neutral',
        imageUrls: manualLog.imageUrls || [],
        imageUrl: manualLog.imageUrls?.[0] || undefined,
        nutrients: manualLog.nutrients as NutrientBreakdown
      };
      onLogFood(fullLog);
    }
    // Reset manual state
    setManualLog({
      date: getCurrentDateInTimezone(profile.timezone),
      name: '',
      composition: '',
      weightGrams: 150,
      quantity: '1 serving',
      benefits: 'Custom manually logged food.',
      risks: 'None reported.',
      healthImpact: 'Supports daily nutritional goals.',
      recommendation: 'neutral',
      imageUrls: [],
      nutrients: {
        calories: 0,
        protein: 0,
        totalFat: 0,
        saturatedFat: 0,
        unsaturatedFat: 0,
        omega3: 0,
        carbohydrates: 0,
        addedSugar: 0,
        totalFibre: 0,
        solubleFibre: 0,
        sodium: 0,
        potassium: 0,
        magnesium: 0,
        calcium: 0,
        iron: 0,
        zinc: 0,
        selenium: 0,
        iodine: 0,
        phosphorus: 0,
        vitaminD: 0,
        vitaminB12: 0,
        folate: 0,
        vitaminC: 0,
        vitaminE: 0,
        vitaminK: 0,
        vitaminA: 0,
        vitaminB6: 0,
        thiamine: 0,
        riboflavin: 0,
        niacin: 0
      }
    });
    setIsManualEntryOpen(false);
  };


  return (
    <div className="space-y-4 pb-24 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-slate-900">
      
      {/* Search Input and Manual Entry Link */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
          <input
            id="food-search-input"
            type="text"
            placeholder="Search logged food items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-2xl pl-10 pr-28 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm"
          />
          <button
            type="button"
            onClick={() => setIsManualEntryOpen(true)}
            className="absolute right-2.5 top-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Manual Entry
          </button>
        </div>
      </div>

      {/* Manual Entry Form Dialog (Modal) */}
      {isManualEntryOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animation-fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600">
                  <Edit2 className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Manual Food Entry</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsManualEntryOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-left">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Food Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Avocado Toast"
                    value={manualLog.name || ''}
                    onChange={(e) => setManualLog({ ...manualLog, name: e.target.value })}
                    className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date *</label>
                  <input
                    type="date"
                    value={manualLog.date || ''}
                    onChange={(e) => setManualLog({ ...manualLog, date: e.target.value })}
                    className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Weight (grams)</label>
                  <input
                    type="number"
                    placeholder="e.g. 150"
                    value={manualLog.weightGrams || ''}
                    onChange={(e) => setManualLog({ ...manualLog, weightGrams: Number(e.target.value) || 0 })}
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Quantity / Portion</label>
                  <input
                    type="text"
                    placeholder="e.g. 1 plate, 1 slice"
                    value={manualLog.quantity || ''}
                    onChange={(e) => setManualLog({ ...manualLog, quantity: e.target.value })}
                    className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Composition / Ingredients</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Avocado, whole wheat sourdough, pinch of red pepper flakes, olive oil"
                  value={manualLog.composition || ''}
                  onChange={(e) => setManualLog({ ...manualLog, composition: e.target.value })}
                  className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:outline-none resize-none"
                />
              </div>

              {/* Recommendation selection */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Recommendation Rating</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['good', 'neutral', 'bad'] as const).map((rec) => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => setManualLog({ ...manualLog, recommendation: rec })}
                      className={`py-1.5 px-3 rounded-xl text-xs font-bold capitalize transition-all border ${
                        manualLog.recommendation === rec
                          ? rec === 'good'
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-sm'
                            : rec === 'bad'
                              ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-500 text-rose-600 dark:text-rose-400 shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 border-slate-400 text-slate-600 dark:text-slate-300 shadow-sm'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-850'
                      }`}
                    >
                      {rec}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photos attachment helper inside Manual Entry */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Add Photos (drag to reorder)</label>
                <div className="flex flex-wrap gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/50 dark:border-slate-800">
                  {manualLog.imageUrls && manualLog.imageUrls.map((img, idx) => (
                    <div
                      key={idx}
                      draggable={true}
                      onDragStart={(e) => handlePhotoDragStart(e, idx)}
                      onDragOver={(e) => handleManualPhotoDragOver(e, idx)}
                      onDragEnd={handlePhotoDragEnd}
                      className={`relative w-14 h-14 rounded-xl overflow-hidden border bg-slate-100 dark:bg-slate-950 transition-all ${
                        draggedPhotoIndex === idx ? 'border-indigo-500 scale-105 opacity-50' : 'border-slate-200 dark:border-slate-850'
                      } cursor-grab active:cursor-grabbing`}
                    >
                      <img src={img} className="w-full h-full object-cover pointer-events-none" referrerPolicy="no-referrer" />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (manualLog.imageUrls || []).filter((_, i) => i !== idx);
                          setManualLog({
                            ...manualLog,
                            imageUrls: updated,
                            imageUrl: updated[0] || undefined
                          });
                        }}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white shadow"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}

                  <label className="w-14 h-14 rounded-xl border border-dashed border-slate-300 dark:border-slate-750 flex flex-col items-center justify-center bg-white dark:bg-slate-850 text-slate-400 hover:text-indigo-500 transition-all cursor-pointer flex-shrink-0">
                    <Plus className="w-4 h-4 mb-0.5" />
                    <span className="text-[8px] font-bold">Add</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={async (e) => {
                        const fileList = e.target.files ? Array.from(e.target.files) : [];
                        e.target.value = '';
                        if (fileList.length > 0) {
                          const validFiles = fileList.filter((file: any) => {
                            const isDng = file.name.toLowerCase().endsWith('.dng') || file.type.includes('dng') || file.type === 'image/x-adobe-dng';
                            return !isDng;
                          });
                          if (validFiles.length === 0) return;

                          setManualCompressing(true);
                          setManualCompressingProgress({ current: 0, total: validFiles.length, percent: 0 });
                          try {
                            const compressed = await compressMultipleImages(validFiles, (progress) => {
                              setManualCompressingProgress({
                                current: progress.currentIndex,
                                total: progress.totalCount,
                                percent: progress.percentage
                              });
                            }, 800, 800, 0.75);
                            const currentUrls = manualLog.imageUrls || [];
                            setManualLog({
                              ...manualLog,
                              imageUrls: [...currentUrls, ...compressed]
                            });
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setManualCompressing(false);
                          }
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                {manualCompressing && (
                  <div className="text-[9px] text-indigo-500 font-bold flex items-center gap-1.5 pt-0.5 px-1 animate-pulse">
                    <Loader className="w-3 h-3 animate-spin" />
                    Compressing photo {manualCompressingProgress.current}/{manualCompressingProgress.total} ({manualCompressingProgress.percent}%)
                  </div>
                )}
              </div>

              {/* Core 30 Nutrients editing inside Manual Entry */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30">
                <div className="p-3 bg-slate-100/50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-850">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Nutrients (30 Core Nutrients)</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs p-3 max-h-60 overflow-y-auto">
                  {nutrientDefinitions.map((nut) => {
                    const val = manualLog.nutrients?.[nut.key] || 0;
                    return (
                      <div key={nut.key} className="flex items-center justify-between gap-1 py-0.5">
                        <span className="text-slate-500 font-medium truncate max-w-[95px]" title={nut.labels[profile.language] || nut.labels.en}>
                          {nut.labels[profile.language] || nut.labels.en}
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="any"
                            placeholder="0"
                            value={val === 0 ? '' : val}
                            onChange={(e) => {
                              const updatedNutrients = {
                                ...(manualLog.nutrients || {}),
                                [nut.key]: Number(e.target.value) || 0
                              };
                              setManualLog({ ...manualLog, nutrients: updatedNutrients as NutrientBreakdown });
                            }}
                            className="w-14 text-right px-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono font-bold text-slate-950 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          <span className="text-[10px] text-slate-400 font-mono w-5">{nut.unit}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-900/40">
              <button
                type="button"
                onClick={() => setIsManualEntryOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-150 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveManualLog}
                className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all cursor-pointer"
              >
                Log Food Manually
              </button>
            </div>
          </div>
        </div>
      )}

      {filteredLogs.length === 0 ? (
        <div id="food-history-empty" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-8 text-center shadow-sm">
          <ImageIcon className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
            {t.emptyHistory}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            const isEditing = editingLogId === log.id;
            const resolvedImg = resolveFoodImage(log.imageUrl, foodLogs);
            const resolvedImgs = resolveFoodImages(log.imageUrls, foodLogs);
            
            return (
              <div
                key={log.id}
                id={`food-log-item-${log.id}`}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] overflow-hidden shadow-sm transition-all"
              >
                {/* Large visual rendering of attached meal images */}
                {(resolvedImgs.length > 0 || resolvedImg) ? (
                  <div className="w-full h-48 overflow-hidden relative">
                    <ImageSlider 
                      images={resolvedImgs} 
                      singleImage={resolvedImg} 
                      altText={log.name || "Meal log"} 
                    />
                  </div>
                ) : null}

                <div className="p-5 space-y-3">
                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                        <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold text-left">Editing Food Log Details</h4>
                      </div>

                      {/* Basic details */}
                      <div className="space-y-3 text-left">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Food Name</label>
                            <input
                              type="text"
                              value={editLogState?.name || ''}
                              onChange={(e) => updateField('name', e.target.value)}
                              className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Date Logged</label>
                            <input
                              type="date"
                              value={editLogState?.date ? editLogState.date.substring(0, 10) : ''}
                              onChange={(e) => updateField('date', e.target.value)}
                              className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Weight (grams)</label>
                            <input
                              type="number"
                              value={editLogState?.weightGrams ?? ''}
                              onChange={(e) => updateField('weightGrams', Number(e.target.value) || 0)}
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Portion / Quantity</label>
                            <input
                              type="text"
                              value={editLogState?.quantity || ''}
                              onChange={(e) => updateField('quantity', e.target.value)}
                              className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">Ingredients / Composition</label>
                          <textarea
                            rows={2}
                            value={editLogState?.composition || ''}
                            onChange={(e) => updateField('composition', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                          />
                        </div>

                        {/* Manage Pictures directly inside the Edit Pen */}
                        <div className="space-y-2 mt-3">
                          <label className="text-[10px] font-bold text-slate-400 block">Manage Pictures (drag to reorder)</label>
                          <div className="flex flex-wrap gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/50 dark:border-slate-800">
                            {((editLogState?.imageUrls && editLogState.imageUrls.length > 0) || editLogState?.imageUrl) ? (
                              (editLogState?.imageUrls || (editLogState?.imageUrl ? [editLogState?.imageUrl] : [])).map((img, idx) => {
                                if (!img) return null;
                                return (
                                  <div
                                    key={idx}
                                    draggable={true}
                                    onDragStart={(e) => handlePhotoDragStart(e, idx)}
                                    onDragOver={(e) => handlePhotoDragOver(e, idx)}
                                    onDragEnd={handlePhotoDragEnd}
                                    className={`relative w-16 h-16 rounded-xl overflow-hidden border bg-slate-100 dark:bg-slate-950 transition-all ${
                                      draggedPhotoIndex === idx ? 'border-indigo-500 scale-105 opacity-50' : 'border-slate-200 dark:border-slate-850'
                                    } cursor-grab active:cursor-grabbing`}
                                  >
                                    <img src={resolveFoodImage(img, foodLogs) || img} className="w-full h-full object-cover pointer-events-none" referrerPolicy="no-referrer" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentUrls = editLogState.imageUrls ? [...editLogState.imageUrls] : (editLogState.imageUrl ? [editLogState.imageUrl] : []);
                                        const updatedUrls = currentUrls.filter((_, i) => i !== idx);
                                        setEditLogState({
                                          ...editLogState,
                                          imageUrls: updatedUrls,
                                          imageUrl: updatedUrls[0] || ''
                                        });
                                      }}
                                      className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white transition-colors cursor-pointer shadow-md z-10"
                                      title="Remove picture"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                );
                              })
                            ) : null}

                            <label className="w-16 h-16 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500/60 flex flex-col items-center justify-center bg-white dark:bg-slate-850 text-slate-400 hover:text-indigo-500 transition-all cursor-pointer flex-shrink-0">
                              <Plus className="w-4 h-4 mb-0.5" />
                              <span className="text-[8px] font-bold">Add</span>
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                onChange={async (e) => {
                                  const fileList = e.target.files ? Array.from(e.target.files) : [];
                                  e.target.value = '';
                                  if (fileList.length > 0) {
                                    const validFiles = fileList.filter((file: any) => {
                                      const isDng = file.name.toLowerCase().endsWith('.dng') || file.type.includes('dng') || file.type === 'image/x-adobe-dng';
                                      return !isDng;
                                    });
                                    const dngCount = fileList.length - validFiles.length;
                                    if (dngCount > 0) {
                                      alert("DNG (RAW) files are not supported. Please select standard images like JPEG, PNG, or WEBP.");
                                    }
                                    if (validFiles.length === 0) return;

                                    setCardCompressingLogId(log.id);
                                    setCardCompressingProgress({ current: 0, total: validFiles.length, percent: 0 });
                                    try {
                                      const compressed = await compressMultipleImages(validFiles, (progress) => {
                                        setCardCompressingProgress({
                                          current: progress.currentIndex,
                                          total: progress.totalCount,
                                          percent: progress.percentage
                                        });
                                      }, 800, 800, 0.75);
                                      const currentUrls = editLogState.imageUrls ? [...editLogState.imageUrls] : (editLogState.imageUrl ? [editLogState.imageUrl] : []);
                                      const updatedUrls = [...currentUrls, ...compressed];
                                      setEditLogState({
                                        ...editLogState,
                                        imageUrls: updatedUrls,
                                        imageUrl: updatedUrls[0] || ''
                                      });
                                    } catch (err) {
                                      console.error("Error compressing images in pen:", err);
                                    } finally {
                                      setCardCompressingLogId(null);
                                    }
                                  }
                                }}
                                className="hidden"
                              />
                            </label>
                          </div>
                          {cardCompressingLogId === log.id && (
                            <div className="text-[9px] text-indigo-500 font-bold flex items-center gap-1.5 pt-0.5 px-1 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block animate-ping"></span>
                              Compressing photo {cardCompressingProgress.current}/{cardCompressingProgress.total} ({cardCompressingProgress.percent}%)
                            </div>
                          )}
                        </div>
                      </div>

                      {/* AI Diagnostics */}
                      <div className="space-y-3 bg-indigo-50/20 dark:bg-indigo-950/10 p-3.5 rounded-2xl border border-indigo-100/30 dark:border-indigo-900/10 text-left">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-indigo-500 block">AI Diagnostic Fields</label>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400 font-semibold">Recommendation:</span>
                            <select
                              value={editLogState?.recommendation || 'neutral'}
                              onChange={(e) => updateField('recommendation', e.target.value)}
                              className="text-[11px] font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-0.5 text-slate-900 dark:text-slate-100 focus:outline-none cursor-pointer"
                            >
                              <option value="good" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Good</option>
                              <option value="neutral" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Neutral</option>
                              <option value="bad" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Bad</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-1">Specific Benefits</label>
                          <textarea
                            rows={2}
                            value={editLogState?.benefits || ''}
                            onChange={(e) => updateField('benefits', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-1">Specific Risks / Warnings</label>
                          <textarea
                            rows={2}
                            value={editLogState?.risks || ''}
                            onChange={(e) => updateField('risks', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-1">Health Impact Overview</label>
                          <textarea
                            rows={2}
                            value={editLogState?.healthImpact || ''}
                            onChange={(e) => updateField('healthImpact', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>

                      {/* Nutrients editable list */}
                      <div className="space-y-2 text-left">
                        <label className="text-[10px] font-bold text-slate-400 block">Edit Core 30 Nutrients</label>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-800 max-h-60 overflow-y-auto">
                          {nutrientDefinitions.map((nut) => {
                            const val = editLogState?.nutrients ? editLogState.nutrients[nut.key] : 0;
                            return (
                              <div key={nut.key} className="flex items-center justify-between gap-1 py-0.5">
                                <span className="text-slate-500 font-medium truncate max-w-[90px]" title={nut.labels[profile.language] || nut.labels.en}>
                                  {nut.labels[profile.language] || nut.labels.en}
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="any"
                                    value={val === 0 ? '' : val}
                                    onChange={(e) => updateNutrient(nut.key as any, Number(e.target.value) || 0)}
                                    className="w-14 text-right px-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono font-bold text-slate-950 dark:text-slate-100"
                                  />
                                  <span className="text-[10px] text-slate-400 font-mono w-5">{nut.unit}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sticky floating actions on the bottom right of the screen */}
                      <div className="fixed bottom-24 right-5 z-50 flex flex-row gap-3 items-center">
                        {/* Cancel/Cross Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLogId(null);
                            setEditLogState(null);
                          }}
                          className="w-14 h-14 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-slate-500/10 cursor-pointer"
                          title="Cancel Editing"
                        >
                          <X className="w-6 h-6 stroke-[2.5px]" />
                        </button>
                        
                        {/* Save/Tick Button */}
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          className="w-full sm:w-14 w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/20 cursor-pointer"
                          title="Save All Changes"
                        >
                          <Check className="w-6 h-6 stroke-[2.5px]" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start">
                        <div className="min-w-0 flex-1 text-left">
                          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                            {log.name}
                          </h3>
                          
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {formatLogDate(log.date)}
                            </span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              log.recommendation === 'good' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                              log.recommendation === 'bad' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' :
                              'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                              {log.recommendation || 'neutral'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(log)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                            title="Edit food log"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteFoodLog(log.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                            title="Delete entry"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium text-left">
                        {log.healthImpact}
                      </p>

                      {/* Calories Badge & Top Targets & Expand Indicator */}
                      <div className="flex flex-wrap items-center justify-between pt-1 gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-extrabold text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 px-2 py-0.5 rounded-lg border border-orange-100/40 dark:border-orange-900/30">
                            {(log.nutrients && log.nutrients.calories) || 0} kcal
                          </span>
                          {log.nutrients && log.nutrients.saturatedFat !== undefined && (
                            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-lg">
                              Sat Fat: {log.nutrients.saturatedFat}g
                            </span>
                          )}
                          {log.nutrients && log.nutrients.sodium !== undefined && (
                            <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/30 px-2 py-0.5 rounded-lg">
                              Sodium: {log.nutrients.sodium}mg
                            </span>
                          )}
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          className="text-xs text-slate-400 hover:text-indigo-600 flex items-center gap-1 font-bold"
                        >
                          <span>{isExpanded ? 'Hide' : 'View all'}</span>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>

                      {/* Detailed 30 Nutrients Panel & AI Diagnostics */}
                      {isExpanded && (
                        <div className="space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 animation-slide-down">
                          {/* Weight & Portion Details inside Show-Hide */}
                          <div className="flex flex-wrap items-center gap-3 text-xs bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-left">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Weight:</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200">{log.weightGrams}g</span>
                            {log.quantity && (
                              <>
                                <span className="text-slate-300 dark:text-slate-700">|</span>
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Portion/Quantity:</span>
                                <span className="font-semibold text-slate-850 dark:text-slate-200">{log.quantity}</span>
                              </>
                            )}
                          </div>

                          {/* Composition Block inside Show-Hide */}
                          {log.composition && (
                            <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-left space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Composition & Ingredients</span>
                              <p className="text-xs text-slate-750 dark:text-slate-300 font-semibold leading-relaxed">{log.composition}</p>
                            </div>
                          )}

                          {/* AI Diagnostics Tracking Area */}
                          <div className="bg-indigo-50/40 dark:bg-indigo-950/10 rounded-2xl p-4 border border-indigo-100/30 dark:border-indigo-900/10 space-y-2 text-left">
                            <div className="flex items-center justify-between border-b border-indigo-100/10 pb-1.5">
                              <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-500 font-bold flex items-center gap-1">
                                <span>✨ AI Diagnostic Track</span>
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                log.recommendation === 'good' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                                log.recommendation === 'bad' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' :
                                'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}>
                                {log.recommendation || 'neutral'}
                              </span>
                            </div>
                            
                            {log.benefits && (
                              <div className="text-[11px] leading-relaxed text-slate-650 dark:text-slate-300">
                                <strong className="text-emerald-600 dark:text-emerald-400 font-bold block">Key Benefits:</strong>
                                <p className="mt-0.5">{log.benefits}</p>
                              </div>
                            )}
                            {log.risks && (
                              <div className="text-[11px] leading-relaxed text-slate-650 dark:text-slate-300">
                                <strong className="text-rose-600 dark:text-rose-400 font-bold block">Potential Risks / Warnings:</strong>
                                <p className="mt-0.5">{log.risks}</p>
                              </div>
                            )}
                            {log.healthImpact && (
                              <div className="text-[11px] leading-relaxed text-slate-650 dark:text-slate-300">
                                <strong className="text-indigo-600 dark:text-indigo-400 font-bold block">Prevention & Biomarker Impact:</strong>
                                <p className="mt-0.5">{log.healthImpact}</p>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono py-2 bg-slate-50 dark:bg-slate-900/40 rounded-2xl px-3.5">
                            {nutrientDefinitions.map((nut) => {
                              const val = log.nutrients ? log.nutrients[nut.key] : undefined;
                              return (
                                <div key={nut.key} className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/20 text-left">
                                  <span className="text-slate-400 font-medium truncate max-w-[120px]">
                                    {nut.labels[profile.language] || nut.labels.en}
                                  </span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                                    {val !== undefined ? `${val} ${nut.unit}` : '--'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
