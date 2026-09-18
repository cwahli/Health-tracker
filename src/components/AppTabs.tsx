import React from 'react';
import { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, FoodIdea, RecommendationReport } from '../types';
import HomeTab from './HomeTab';
import MedicalHistoryTab from './MedicalHistoryTab';
import InsightsTab from './InsightsTab';
import TrendsTab from './TrendsTab';
import { translations } from '../utils/translations';
import { Plus, Utensils } from 'lucide-react';

export interface AppTabsProps {
  activeTab: 'home' | 'insights' | 'food' | 'medical' | 'trends';
  profile: UserProfile;
  foodLogs: FoodLog[];
  setFoodLogs: React.Dispatch<React.SetStateAction<FoodLog[]>>;
  biomarkers: Record<string, number | string>;
  biomarkerHistory: BiomarkerLog[];
  setBiomarkerHistory: React.Dispatch<React.SetStateAction<BiomarkerLog[]>>;
  actions: HealthAction[];
  setActions: React.Dispatch<React.SetStateAction<HealthAction[]>>;
  dailyBenefits: DailyBenefit[];
  setDailyBenefits: React.Dispatch<React.SetStateAction<DailyBenefit[]>>;
  foodIdeas: FoodIdea[];
  setFoodIdeas: React.Dispatch<React.SetStateAction<FoodIdea[]>>;
  report: RecommendationReport | null;
  draftReport: RecommendationReport | null;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  hideSensitive: boolean;
  syncState: string;
  onNavigateToTab: (tab: 'home' | 'insights' | 'food' | 'medical' | 'trends') => void;
  onOpenAgentChat: (agentType: any, options?: any) => void;
  onLogMealClick: () => void;
  onViewJob?: (jobId: string) => void;
  onApplyCalculation?: (updates: any) => void;
  onUpdateReport?: (report: any) => void;
  onAcceptReport?: (report?: any) => Promise<void>;
  onRejectReport?: (report?: any) => Promise<void>;
  onGenerateReport?: (engine?: string) => Promise<void>;
  onSaveProfile?: (profile: UserProfile) => Promise<void>;
}

export default function AppTabs({
  activeTab,
  profile,
  foodLogs,
  setFoodLogs,
  biomarkers,
  biomarkerHistory,
  setBiomarkerHistory,
  actions,
  setActions,
  dailyBenefits,
  setDailyBenefits,
  foodIdeas,
  setFoodIdeas,
  report,
  draftReport,
  selectedModelId,
  onChangeModelId,
  hideSensitive,
  syncState,
  onNavigateToTab,
  onOpenAgentChat,
  onLogMealClick,
  onViewJob,
  onApplyCalculation,
  onUpdateReport,
  onAcceptReport,
  onRejectReport,
  onGenerateReport,
  onSaveProfile
}: AppTabsProps) {
  const t = translations[profile.language] || translations.en;

  if (activeTab === 'home') {
    return (
      <HomeTab
        profile={profile}
        foodLogs={foodLogs}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        actions={actions}
        setActions={setActions}
        dailyBenefits={dailyBenefits}
        setDailyBenefits={setDailyBenefits}
        foodIdeas={foodIdeas}
        setFoodIdeas={setFoodIdeas}
        report={report}
        onNavigateToTab={onNavigateToTab}
        onEditBiomarkerLog={(id, key, val) => {
          setBiomarkerHistory(prev =>
            prev.map(item => item.id === id ? { ...item, [key]: val } : item)
          );
        }}
        onDeleteBiomarkerLog={(id) => {
          setBiomarkerHistory(prev => prev.filter(item => item.id !== id));
        }}
        onLogMedical={(newBiomarkers, profileUpdates) => {
          if (profileUpdates && onSaveProfile) {
            onSaveProfile({ ...profile, ...profileUpdates });
          }
        }}
        onOpenAgentChat={onOpenAgentChat}
        hideSensitive={hideSensitive}
        selectedModelId={selectedModelId}
        onChangeModelId={onChangeModelId}
        onUpdateReport={onUpdateReport}
        onApplyCalculation={onApplyCalculation}
        syncState={syncState}
        onViewJob={onViewJob}
        onLogFood={(f) => setFoodLogs(prev => [f, ...prev])}
      />
    );
  }

  if (activeTab === 'medical') {
    return (
      <MedicalHistoryTab
        profile={profile}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        hideSensitive={hideSensitive}
        selectedModelId={selectedModelId}
        onChangeModelId={onChangeModelId}
        onEditBiomarkerLog={() => {}}
        onDeleteBiomarkerLog={(id) => {
          setBiomarkerHistory(prev => prev.filter(item => item.id !== id));
        }}
        onOpenAgentChat={onOpenAgentChat}
        onViewJob={onViewJob}
      />
    );
  }

  if (activeTab === 'insights') {
    return (
      <InsightsTab
        profile={profile}
        foodLogs={foodLogs}
        biomarkers={biomarkers}
        report={report}
        draftReport={draftReport}
        isGenerating={false}
        selectedModelId={selectedModelId}
        onChangeModelId={onChangeModelId}
        onAcceptReport={onAcceptReport || (async () => {})}
        onRejectReport={onRejectReport || (async () => {})}
        onGenerateReport={onGenerateReport || (async () => {})}
        onOpenAgentChat={onOpenAgentChat}
      />
    );
  }

  if (activeTab === 'trends') {
    return (
      <TrendsTab
        profile={profile}
        foodLogs={foodLogs}
        biomarkerHistory={biomarkerHistory}
        hideSensitive={hideSensitive}
        report={report}
      />
    );
  }

  // activeTab === 'food'
  return (
    <div id="food-tab-view" className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Utensils className="w-5 h-5 text-emerald-500" />
            {profile.language === 'id' ? 'Riwayat Makanan' : 'Food History'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {profile.language === 'id'
              ? 'Pantau asupan nutrisi harian Anda'
              : 'Track and review your daily nutrition and meals'}
          </p>
        </div>
        <button
          id="tab-log-meal-btn"
          onClick={onLogMealClick}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl shadow-sm transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{profile.language === 'id' ? 'Catat Makanan' : 'Log Meal'}</span>
        </button>
      </div>

      {foodLogs.length === 0 ? (
        <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
          <Utensils className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">
            {profile.language === 'id' ? 'Belum ada makanan tercatat' : 'No meals logged yet'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-sm mx-auto">
            {profile.language === 'id'
              ? 'Ambil foto makanan atau ketik menu Anda untuk menganalisis nutrisi.'
              : 'Take a photo or describe your meal to get detailed nutritional breakdowns.'}
          </p>
          <button
            onClick={onLogMealClick}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-all cursor-pointer"
          >
            {profile.language === 'id' ? 'Mulai Catat Makanan' : 'Log Your First Meal'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {foodLogs.map((log: FoodLog, idx) => (
            <div
              key={log.id || idx}
              className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm flex items-center justify-between"
            >
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-slate-100">{log.name || log.mealName || 'Meal'}</h4>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex gap-3">
                  <span>{log.date || 'Today'}</span>
                  {log.nutrients?.calories != null && <span>{log.nutrients.calories} kcal</span>}
                  {log.nutrients?.protein != null && <span>Protein: {log.nutrients.protein}g</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
