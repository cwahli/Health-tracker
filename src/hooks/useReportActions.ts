import type { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport } from '../types';
import { trackApiCall } from '../utils/apiTracker';
import { auth } from '../firebase';
import { safeAlert } from './useFoodLogActions';

export interface UseReportActionsParams {
  profile: UserProfile | null;
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  actions: HealthAction[];
  dailyBenefits: DailyBenefit[];
  report: RecommendationReport | null;
  saveAndSync: (...args: any[]) => Promise<any>;
  setProfile: (p: any) => void;
  setActions: (a: HealthAction[]) => void;
  setDailyBenefits: (d: DailyBenefit[]) => void;
  setReport: (r: RecommendationReport | null) => void;
  setDraftReport: (r: RecommendationReport | null) => void;
  setActiveTab: (tab: 'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends') => void;
  setIsGenerating: (b: boolean) => void;
}

export function useReportActions(params: UseReportActionsParams) {
  const {
    profile,
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    report,
    saveAndSync,
    setProfile,
    setActions,
    setDailyBenefits,
    setReport,
    setDraftReport,
    setActiveTab,
    setIsGenerating,
  } = params;

  const handleAgentAnalysisSaved = async (agentType: string, agentResult: any, existingId?: string): Promise<string> => {
    if (!profile) return '';
    const newId = existingId || `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const updatedAnalyses = profile.agentAnalyses ? [...profile.agentAnalyses] : [];
    const existingIndex = existingId ? updatedAnalyses.findIndex(a => a.id === existingId) : -1;
    if (existingIndex >= 0) {
      updatedAnalyses[existingIndex] = {
        ...updatedAnalyses[existingIndex],
        result: agentResult
      };
    } else {
      updatedAnalyses.push({
        id: newId,
        agentType: agentType,
        date: new Date().toISOString(),
        result: agentResult
      });
    }
    const updatedProfile = { 
      ...profile,
      agentAnalyses: updatedAnalyses
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: newId });
    return newId;
  };
  const handleDeleteAnalysis = async (id: string) => {
    if (!profile) return;
    if (profile.agentAnalyses) {
      const updatedProfile = {
        ...profile,
        agentAnalyses: profile.agentAnalyses.filter(a => a.id !== id)
      };
      setProfile(updatedProfile);
      await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteAnalysis', targetId: id });
    }
  };
  // Accept and apply recommendations to active dashboard targets
  const handleAcceptReport = async (acceptedReport: RecommendationReport) => {
    setReport(acceptedReport);
    setActions(acceptedReport.actions);
    setDailyBenefits(acceptedReport.dailyBenefits);
    setDraftReport(null);
    
    // Quick, clean targeted sync to database
    await saveAndSync(
      profile,
      foodLogs,
      biomarkers,
      biomarkerHistory,
      acceptedReport.actions,
      acceptedReport.dailyBenefits,
      acceptedReport,
      { type: 'report' }
    );
    
    // Auto-navigate to dashboard for glorious preview of newly updated targets
    setActiveTab('home');
  };
  const handleRejectReport = () => {
    setDraftReport(null);
  };
  // Run On-demand Insights Totality analysis with LLM Selection
  const handleGenerateReport = async (modelId: string, refinement?: { message: string, chatHistory: any[] }) => {
    setIsGenerating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 18000); // 18-second robust timeout
    try {
      trackApiCall('gemini', `Insight Analyze`, auth.currentUser?.email || 'anonymous');
      const excludedKeys = new Set([
        ...Object.keys(profile?.notUsedBiomarkers || {}),
        ...Object.keys(profile?.notUsedInMedicalHistory || {})
      ]);
      const analysisEligibleHistory = excludedKeys.size === 0 ? biomarkerHistory : biomarkerHistory.map(log => {
        if (!log.biomarkers) return log;
        const filtered = { ...log.biomarkers };
        let changed = false;
        Object.keys(filtered).forEach(k => {
          if (excludedKeys.has(k)) { delete filtered[k]; changed = true; }
        });
        return changed ? { ...log, biomarkers: filtered } : log;
      });
      const response = await fetch('/api/gemini/insight-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userProfile: profile,
          foodLogs,
          biomarkerHistory: analysisEligibleHistory,
          engine: modelId,
          refinement
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const resText = await response.text();
      let resData: any = {};
      try {
        resData = JSON.parse(resText);
      } catch {
        throw new Error(`Server returned non-JSON response (${response.status})`);
      }
      if (resData.error) throw new Error(resData.error);
      if (resData.report) {
        setDraftReport(resData.report);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Analysis generation error/timeout:", err);
      if (err.name === 'AbortError') {
        safeAlert('Server took longer than expected to complete profiling. Activating specialized local preventative engine fallback.');
        const fallback = (await import('../utils/fallbackReport')).getLocalFallbackReport(profile);
        setDraftReport(fallback);
      } else {
        safeAlert(`Failed to complete analysis: ${err.message || 'Server timeout. Activating high-fidelity fallback.'}`);
        const fallback = (await import('../utils/fallbackReport')).getLocalFallbackReport(profile);
        setDraftReport(fallback);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    handleAgentAnalysisSaved,
    handleDeleteAnalysis,
    handleAcceptReport,
    handleRejectReport,
    handleGenerateReport,
  };
}
