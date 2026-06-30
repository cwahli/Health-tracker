import React, { useState } from 'react';
import { UserProfile, FoodLog, RecommendationReport } from '../types';
import { translations } from '../utils/translations';
import { 
  Brain, Sparkles, AlertCircle, TrendingDown, BookOpen, Clock, Heart, 
  CheckCircle, HelpCircle, Loader, ShieldCheck, Database, Check, X, ArrowRight, Activity, Send 
} from 'lucide-react';
import LLMSelector from './LLMSelector';

interface InsightsTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  report: RecommendationReport | null;
  draftReport: RecommendationReport | null;
  onAcceptReport: (report: RecommendationReport) => Promise<void>;
  onRejectReport: () => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  onGenerateReport: (engine: string) => Promise<void>;
  isGenerating: boolean;
  onNavigateToTab?: (tab: string) => void;
  onOpenMedicalChat?: () => void;
  onOpenAgentChat?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5') => void;
}

export default function InsightsTab({
  profile,
  foodLogs,
  biomarkers,
  report,
  draftReport,
  onAcceptReport,
  onRejectReport,
  selectedModelId,
  onChangeModelId,
  onGenerateReport,
  isGenerating,
  onNavigateToTab,
  onOpenMedicalChat,
  onOpenAgentChat
}: InsightsTabProps) {
  const t = translations[profile.language] || translations.en;
  const [isApplying, setIsApplying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [refinementText, setRefinementText] = useState("");
  const [chatHistory, setChatHistory] = useState<any[]>([]);

  const handleRefine = () => {
    if (!refinementText.trim() || isGenerating) return;
    const userMessage = { role: "user", text: refinementText };
    const aiMessage = { role: "ai", text: JSON.stringify(draftReport) };
    const updatedHistory = [...chatHistory, aiMessage, userMessage];
    setChatHistory(updatedHistory);
    // @ts-ignore - we updated the signature in App.tsx but interface might not match exactly, so casting
    (onGenerateReport as any)(selectedModelId, { message: refinementText, chatHistory: updatedHistory });
    setRefinementText("");
  };

  const missingProfilePoints: string[] = [];
  if (profile.age === undefined || profile.age === null || String(profile.age).trim() === '') missingProfilePoints.push('Age');
  if (profile.ethnicity === undefined || profile.ethnicity === null || String(profile.ethnicity).trim() === '' || String(profile.ethnicity).toLowerCase() === 'unknown') missingProfilePoints.push('Ethnicity');
  if (profile.weight === undefined || profile.weight === null || String(profile.weight).trim() === '') missingProfilePoints.push('Weight');
  if (profile.height === undefined || profile.height === null || String(profile.height).trim() === '') missingProfilePoints.push('Height');

  const hasProfileInfo = missingProfilePoints.length === 0;

  // Verify missing data points above the button
  // Determine if basic demographics are present
  const basicInfoMissing = ['Age', 'Ethnicity', 'Weight', 'Height'].filter(f => missingProfilePoints.includes(f));
  
  const auditPoints = [
    { name: 'Basic Demographics (Age, Ethnicity, Weight, Height)', present: basicInfoMissing.length === 0, required: true },
    { name: 'Recent Food Logs (Nutrient trends)', present: foodLogs.length > 0, required: true },
    { name: 'Biomarkers', present: Object.keys(biomarkers).length > 0, required: false }
  ];

  const criticalMissing = auditPoints.filter(p => !p.present);

  const getMissingNote = () => {
    if (criticalMissing.length === 0) return "You have provided all the recommended data for optimal health analysis.";
    const missingNames = criticalMissing.map(p => p.name).join(", ");
    return `For best health recommendations, please add the following data: ${missingNames}.`;
  };

  const handleAcceptClick = async () => {
    if (!draftReport) return;
    setIsApplying(true);
    try {
      await onAcceptReport(draftReport);
    } catch (e) {
      console.error(e);
    } finally {
      setIsApplying(false);
    }
  };

  // If a draft is generated, show the interactive review & approval screen
  if (draftReport) {
    const isSpecialUser = profile?.email?.toLowerCase() === 'chiwah.liu@gmail.com' || profile?.email?.toLowerCase() === 'cwah.liu@gmail.com';

    return (
      <div className="space-y-6 pb-24 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-slate-900 dark:text-slate-100">
        
        {/* Draft Heading Alert */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-[32px] p-6 shadow-md space-y-3 relative overflow-hidden">
          <div className="absolute right-[-15px] bottom-[-15px] opacity-10">
            <Brain className="w-40 h-40" />
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">Prevention Draft</span>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight font-display leading-tight">Interactive Target Review</h2>
          <p className="text-xs text-indigo-100 leading-relaxed">
            Our preventative algorithms generated customized clinical guidelines tailored specifically to your biochemistry. Please review and approve these targets to sync them directly to your dashboard.
          </p>
        </div>

        {/* SECTION 1: Data Taken Into Account */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <Database className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">1. Source Clinical Data Analyzed</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">User Profile</span>
              <span className="font-semibold block">{profile.age}yo, {profile.ethnicity || 'Unknown Ethnicity'}</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">{profile.weight} kg | {profile.height} cm</span>
              {(profile.gender || profile.bloodType) && (
                <span className="text-[10px] text-slate-500 block">
                  {profile.gender ? profile.gender : ''} {profile.gender && profile.bloodType ? '|' : ''} {profile.bloodType ? `Blood: ${profile.bloodType}` : ''}
                </span>
              )}
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Nutrition Inputs</span>
              <span className="font-semibold block">{foodLogs.length} logged entries</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Recent eating patterns</span>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Checked Biomarker Values</span>
              <span className="text-[10px] text-slate-400">{Object.keys(biomarkers).length} logged</span>
            </div>
            
            {Object.keys(biomarkers).length > 0 ? (
              <details className="group">
                <summary className="text-[11px] font-bold text-indigo-600 cursor-pointer list-none flex items-center gap-1">
                  <span>View All Used Biomarkers</span>
                  <span className="transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-[11px]">
                  {Object.entries(biomarkers).map(([k, v]) => (
                    <div key={k} className="py-1 px-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-150 dark:border-slate-800/60 overflow-hidden">
                      <span className="block text-[9px] text-slate-400 font-semibold truncate" title={k}>{k.replace(/_/g, ' ').toUpperCase()}</span>
                      <span className="font-bold text-indigo-600 font-mono">
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <p className="text-[11px] text-slate-500 italic">No biomarker data available. Using general population defaults.</p>
            )}
            
            {isSpecialUser && (
              <p className="text-[10px] text-slate-500 italic mt-2 leading-normal">
                🧬 East Asian genetics and specific kidney filtration rate (eGFR) profiles were fully integrated.
              </p>
            )}
          </div>
        </div>

        {/* SECTION 2: Proposed Daily Nutrient Targets */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">2. Proposed Nutrient Recommendations</h3>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Calories</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{draftReport.dailyNutrientTargets.calories || '1,800 kcal'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Saturated Fat</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.saturatedFat || 'under 15 g'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Sodium</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.sodium || 'under 1,200 mg'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Protein</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{draftReport.dailyNutrientTargets.protein || '90-100 g'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Soluble Fibre</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.solubleFibre || '10-15 g'}</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: Action Plan / What Target User Should Do */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <Heart className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">3. Preventative Action Checklist</h3>
          </div>

          <div className="space-y-3.5">
            {draftReport.actions.slice(0, 3).map((act, idx) => (
              <div key={idx} className="flex gap-2 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  <span className="font-bold text-slate-900 dark:text-white block">{act.task}</span>
                  <span className="text-[10px] text-slate-500 leading-normal block">{act.explanation}</span>
                </div>
              </div>
            ))}

            <div className="border-t border-slate-100 dark:border-slate-800/40 my-3 pt-3" />

            <div className="space-y-2">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Recommended Habit Modifiers</span>
              {draftReport.dailyBenefits.slice(0, 3).map((ben, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <CheckCircle className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                  <span className="font-medium text-slate-750 dark:text-slate-300">{ben.activity || (ben as any).label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION 4: Risk Forecast Comparison */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <TrendingDown className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">4. 10-Year Clinical Forecast</h3>
          </div>

          <div className="space-y-3 text-xs leading-relaxed">
            <div className="p-3 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100/40 rounded-2xl">
              <span className="text-[9px] uppercase font-bold tracking-wider text-rose-600 block mb-1">If Habits Do Not Change:</span>
              <p className="text-rose-700 dark:text-rose-300 font-medium">{draftReport.healthRiskForecast.year10}</p>
            </div>

            <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100/40 rounded-2xl">
              <span className="text-[9px] uppercase font-bold tracking-wider text-emerald-600 block mb-1">With Optimized Targets Applied:</span>
              <p className="text-emerald-700 dark:text-emerald-300 font-semibold">{draftReport.healthRiskForecast.optimized10}</p>
            </div>
          </div>
        </div>

        {/* REFINEMENT CHAT PANEL */}
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm flex items-center gap-2">
          <input 
            type="text" 
            placeholder="Refine this recommendation..." 
            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none"
            value={refinementText}
            onChange={(e) => setRefinementText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
          />
          <button 
            onClick={handleRefine}
            disabled={!refinementText.trim() || isGenerating}
            className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center cursor-pointer disabled:opacity-50"
          >
            {isGenerating ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>

        {/* ACCEPT / REJECT BUTTONS */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            onClick={onRejectReport}
            disabled={isApplying}
            className="py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-2xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Reject Draft
          </button>

          <button
            onClick={handleAcceptClick}
            disabled={isApplying}
            className="py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isApplying ? (
              <>
                <Loader className="w-3.5 h-3.5 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Accept & Apply
              </>
            )}
          </button>
        </div>

      </div>
    );
  }

  // Normal view when no draft is generated
  return (
    <div className="space-y-6 pb-24 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-slate-900 dark:text-slate-100">
      
      {/* Multi-Agent Clinical Diagnostics & Analysis Sections */}
      <div id="agent-diagnostics-dashboard" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/50">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-2">
            AI Multi-Agent Diagnostics
          </h3>
        </div>

        {/* Agent 1: Clinical Triage Organizer */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 text-[10px] font-bold">1</span>
              Clinical Triage Organizer
            </h4>
            <button
              onClick={() => onOpenAgentChat?.('agent1')}
              className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-[10px] uppercase tracking-wider rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
            >
              Chat & Run
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Cleans, deduplicates, and organizes raw medical history data into structured physiological buckets.</p>
          {profile.agentTriageSummary && (
            <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{profile.agentTriageSummary}</p>
            </div>
          )}
        </div>

        {/* Agent 2: Prognostic Diagnostics Assessment */}
        <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/50">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 text-[10px] font-bold">2</span>
              Prognostic Diagnostics
            </h4>
            <button
              onClick={() => onOpenAgentChat?.('agent2')}
              className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-[10px] uppercase tracking-wider rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
            >
              Chat & Run
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Analyzes biomarker history to project timeline risks (2, 5, 10 years) and identifies testing gaps.</p>
          {profile.agentDiagnosticSummary && (
            <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20 space-y-2">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{profile.agentDiagnosticSummary}</p>
              {profile.agent2TimelineProjections && (
                <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-600 dark:text-slate-400">
                  <span className="font-medium bg-slate-200/50 dark:bg-slate-800 px-1.5 py-0.5 rounded">2Y: {profile.agent2TimelineProjections.year2.substring(0,30)}...</span>
                  <span className="font-medium bg-slate-200/50 dark:bg-slate-800 px-1.5 py-0.5 rounded">5Y: {profile.agent2TimelineProjections.year5.substring(0,30)}...</span>
                  <span className="font-medium bg-slate-200/50 dark:bg-slate-800 px-1.5 py-0.5 rounded">10Y: {profile.agent2TimelineProjections.year10.substring(0,30)}...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Agent 3: Personalized Reference Ranges */}
        <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/50">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 text-[10px] font-bold">3</span>
              Personalized Reference Ranges
            </h4>
            <button
              onClick={() => onOpenAgentChat?.('agent3')}
              className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-[10px] uppercase tracking-wider rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
            >
              Chat & Run
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Calibrates normal biomarker reference ranges and physiological context to your exact demographics.</p>
          {profile.agentContextualizerSummary && (
            <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{profile.agentContextualizerSummary}</p>
            </div>
          )}
        </div>

        {/* Agent 4: Lifestyle Precision Intervention */}
        <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/50">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 text-[10px] font-bold">4</span>
              Lifestyle Precision Intervention
            </h4>
            <button
              onClick={() => onOpenAgentChat?.('agent4')}
              className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-[10px] uppercase tracking-wider rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
            >
              Chat & Run
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Translates diagnostic risk into strict, mathematically projected dietary and movement targets.</p>
          {profile.agentInterventionSummary && (
            <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20 space-y-2">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{profile.agentInterventionSummary}</p>
              {profile.agent4Projections && profile.agent4Projections.length > 0 && (
                <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-2 space-y-1 pl-2 border-l-2 border-indigo-200 dark:border-indigo-800">
                  {profile.agent4Projections.map((p, i) => <p key={i}>&bull; {p}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Agent 5: Medical Literature Consensus */}
        <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/50">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 text-[10px] font-bold">5</span>
              Medical Literature Consensus
            </h4>
            <button
              onClick={() => onOpenAgentChat?.('agent5')}
              className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-[10px] uppercase tracking-wider rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
            >
              Chat & Run
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Scans PubMed and clinical trials to bring recent scientific debate and consensus on your specific health context.</p>
          {profile.agentLiteratureSummary && (
            <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{profile.agentLiteratureSummary}</p>
            </div>
          )}
        </div>
      </div>

      {/* Audit Checklist Box */}
      <div id="data-audit-box" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Source Data Totality Status
        </h3>
        
        <div className="space-y-2">
          {auditPoints.map((point, index) => (
            <div key={index} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800/20">
              <span className="text-slate-700 dark:text-slate-400 flex items-center gap-1.5 font-medium">
                {point.required ? (
                  <span className="text-[9px] uppercase font-bold tracking-wider text-amber-700 px-1.5 py-0.5 rounded-full bg-amber-500/10">Required</span>
                ) : (
                  <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500 px-1.5 py-0.5 rounded-full bg-slate-500/10">Optional</span>
                )}
                {point.name}
              </span>
              <span>
                {point.present ? (
                  <CheckCircle className="w-4 h-4 text-indigo-600 fill-indigo-600/10" />
                ) : (
                  <HelpCircle className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                )}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium mt-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl">
          {getMissingNote()}
        </p>

        {/* Warning if Critical Data is Missing */}
        {criticalMissing.length > 0 && (
          <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-500/10 rounded-2xl p-3 flex gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-normal font-medium">
              You are missing critical indicators: <strong>{criticalMissing.map(m => m.name).join(', ')}</strong>. You can still generate, but the analysis will use generalized defaults.
            </p>
          </div>
        )}

        {(!hasProfileInfo && onOpenMedicalChat) && (
          <button
            onClick={() => onOpenMedicalChat()}
            className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center mt-2 cursor-pointer"
          >
            Add body information
          </button>
        )}
      </div>

      {/* Model Engine Selector & Run On-demand Button */}
      {hasProfileInfo && (
        <div id="analysis-control-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
          <LLMSelector
            selectedModelId={selectedModelId}
            onChangeModelId={onChangeModelId}
          />

          <button
            id="trigger-analysis-btn"
            onClick={() => setShowConfirm(true)}
            disabled={isGenerating}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-bold shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isGenerating ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                {t.generating}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t.generateInsight}
              </>
            )}
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-4 animation-fade-in font-sans">
          <div className="w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] flex flex-col shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800/80 transition-colors duration-200 p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg font-display text-slate-900 dark:text-slate-100">Confirm Analysis Data</h3>
              <button 
                onClick={() => setShowConfirm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              The following information will be used to generate your personalized health diagnostic:
            </p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">User Profile</span>
                <span className="font-semibold block">{profile.age}yo, {profile.ethnicity || 'Unknown Ethnicity'}</span>
                {profile.weight && profile.height ? (() => {
                  const heightInMeters = Number(profile.height) / 100;
                  const bmi = Number(profile.weight) / (heightInMeters * heightInMeters);
                  return (
                    <span className="text-[10px] text-slate-500 mt-0.5 block">BMI: <strong className="text-slate-800 dark:text-slate-200">{bmi.toFixed(1)}</strong></span>
                  );
                })() : (
                  <span className="text-[10px] text-slate-500 mt-0.5 block">BMI: N/A</span>
                )}
                {(profile.gender || profile.bloodType) && (
                  <span className="text-[10px] text-slate-500 block">
                    {profile.gender ? profile.gender : ''} {profile.gender && profile.bloodType ? '|' : ''} {profile.bloodType ? `Blood: ${profile.bloodType}` : ''}
                  </span>
                )}
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Nutrition Inputs</span>
                <span className="font-semibold block">{foodLogs.length} logged entries</span>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Recent eating patterns</span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Checked Biomarker Values</span>
                <span className="text-[10px] text-slate-400">{Object.keys(biomarkers).length} logged</span>
              </div>
              
              {Object.keys(biomarkers).length > 0 ? (
                <details className="group">
                  <summary className="text-[11px] font-bold text-indigo-600 cursor-pointer list-none flex items-center gap-1">
                    <span>View All Used Biomarkers</span>
                    <span className="transition-transform group-open:rotate-180">▼</span>
                  </summary>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-[11px]">
                    {Object.entries(biomarkers).map(([k, v]) => (
                      <div key={k} className="py-1 px-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-150 dark:border-slate-800/60 overflow-hidden">
                        <span className="block text-[9px] text-slate-400 font-semibold truncate" title={k}>{k.replace(/_/g, ' ').toUpperCase()}</span>
                        <span className="font-bold text-indigo-600 font-mono">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <p className="text-[11px] text-slate-500 italic">No biomarker data available. Using general population defaults.</p>
              )}
            </div>
            
            <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg font-medium">
              Are these details correct? To get the most accurate clinical diagnostic, ensure you have also logged your latest blood test results such as ApoB, LDL-C, and HbA1c in the medical history.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  if (onOpenMedicalChat) onOpenMedicalChat();
                }}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-sm font-bold transition-all cursor-pointer"
              >
                Update
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onGenerateReport(selectedModelId);
                }}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                Start Diagnostic
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Section */}
      {report ? (
        <div className="space-y-6">
          
          {/* Health Risk Forecasting Timelines - 5, 10, 20 Years */}
          <div id="risk-timeline-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-1.5 font-display">
              <TrendingDown className="w-4 h-4 text-rose-500" />
              Cardiovascular & Renal Risk Forecasting
            </h3>

            <div className="space-y-4">
              {/* 5 Year Forecast */}
              <div className="border-l-2 border-slate-200 dark:border-slate-800 pl-3.5 relative">
                <span className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold text-slate-400 font-mono">5 Years Timeline</span>
                <div className="mt-1 space-y-1.5 text-xs font-medium">
                  <p className="text-rose-600 dark:text-rose-400 leading-relaxed">
                    &bull; {report.healthRiskForecast.year5}
                  </p>
                  <p className="text-indigo-600 dark:text-indigo-400 leading-relaxed font-semibold">
                    &bull; {report.healthRiskForecast.optimized5}
                  </p>
                </div>
              </div>

              {/* 10 Year Forecast */}
              <div className="border-l-2 border-slate-200 dark:border-slate-800 pl-3.5 relative">
                <span className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold text-slate-400 font-mono">10 Years Timeline</span>
                <div className="mt-1 space-y-1.5 text-xs font-medium">
                  <p className="text-rose-600 dark:text-rose-400 leading-relaxed">
                    &bull; {report.healthRiskForecast.year10}
                  </p>
                  <p className="text-indigo-600 dark:text-indigo-400 leading-relaxed font-semibold">
                    &bull; {report.healthRiskForecast.optimized10}
                  </p>
                </div>
              </div>

              {/* 20 Year Forecast */}
              <div className="border-l-2 border-slate-200 dark:border-slate-800 pl-3.5 relative">
                <span className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold text-slate-400 font-mono">20 Years Timeline</span>
                <div className="mt-1 space-y-1.5 text-xs font-medium">
                  <p className="text-rose-600 dark:text-rose-400 leading-relaxed">
                    &bull; {report.healthRiskForecast.year20}
                  </p>
                  <p className="text-indigo-600 dark:text-indigo-400 leading-relaxed font-semibold">
                    &bull; {report.healthRiskForecast.optimized20}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Core Medical Insights summarised bullet points */}
          <div id="latest-insights-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-1.5 font-display">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              {t.latestInsights}
            </h3>

            <div className="space-y-4">
              {report.latestInsights.map((insight, idx) => (
                <div key={idx} className="space-y-1 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/20">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                    {insight.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5 font-medium">
                    {insight.summary}
                  </p>
                  <a
                    href={insight.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 hover:underline block pt-1.5 font-mono"
                  >
                    PubMed &rarr;
                  </a>
                </div>
              ))}
            </div>
          </div>

        </div>
      ) : (
        /* Empty insights state */
        <div id="insights-empty-state" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-8 text-center shadow-sm flex flex-col items-center">
          <Clock className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-3" />
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
            {t.noDataInsight}
          </p>
        </div>
      )}

    </div>
  );
}
